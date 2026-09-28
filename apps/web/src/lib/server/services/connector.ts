import { createHash, randomBytes, randomInt } from "node:crypto";
import { connectorSecretContext, createConnectorClient, decrypt, encrypt, hasRole, type ConnectorClient } from "@mendwell/core";
import { createRepositories } from "@mendwell/db";
import { connectorTransport, createSafeFetch, SafeFetchError } from "@mendwell/scanner/net";
import { server } from "../context";
import { AppError, notFound } from "../errors";
import type { OrgContext } from "../session";
import { getSite } from "./sites";

export const PAIRING_CODE_TTL_MS = 15 * 60 * 1000;
const PAIRING_CODES_PER_HOUR = 10;
// No 0/O, 1/I/L: codes are read off one screen and typed into another.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const secretContext = connectorSecretContext;
export const hashPairingCode = (normalized: string) => createHash("sha256").update(normalized).digest("hex");

/** "abcd efgh-jklm" → "ABCD-EFGH-JKLM", or null. Must match the plugin's normalize_code. */
export function normalizePairingCode(raw: string): string | null {
  const code = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!/^[A-Z0-9]{8,32}$/.test(code)) return null;
  return code.match(/.{1,4}/g)?.join("-") ?? null;
}

function newPairingCode(): string {
  const chars = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return chars.match(/.{4}/g)?.join("-") ?? chars;
}

const siteFetch = () => createSafeFetch({ ...server().net, userAgent: "MendwellBot/1.0", timeoutMs: 15_000 });

/** Admin + owner: a one-time code for this site, shown once, stored hashed (15 minutes, single use). */
export async function createPairingCode(ctx: OrgContext, siteId: string) {
  const { repos } = server();
  const site = await getSite(ctx, siteId);
  if (!hasRole(ctx.role, "admin")) throw new AppError("forbidden", "Only admins and owners can connect a site.", 403);
  if ((await repos.pairingCodes.countSince(ctx.orgId, site.id, new Date(Date.now() - 3_600_000))) >= PAIRING_CODES_PER_HOUR) {
    throw new AppError("rate_limited", "Too many pairing codes for this site in the last hour. Try again later.", 429);
  }
  const code = newPairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
  await repos.pairingCodes.revokeUnused(ctx.orgId, site.id);
  await repos.pairingCodes.create(ctx.orgId, { siteId: site.id, codeHash: hashPairingCode(code), expiresAt });
  await repos.audit.record(ctx.orgId, { actor: `user:${ctx.user.id}`, action: "pairing_code.created", entity: "site", entityId: site.id });
  return { code, expiresAt };
}

const hostKey = (url: string) => new URL(url).hostname.toLowerCase().replace(/^www\./, "");

/**
 * Fetch the plugin's unsigned status on the site's own URL and compare the challenge
 * (PROJECT_SPEC §8.1 step 4). Tries /wp-json first, then ?rest_route= for plain permalinks.
 */
async function checkChallenge(siteUrl: string, challenge: string): Promise<"pretty" | "query" | null> {
  const safeFetch = siteFetch();
  const base = new URL(siteUrl);
  const prefix = base.pathname.replace(/\/+$/, "");
  const attempts: ["pretty" | "query", string][] = [
    ["pretty", `${base.origin}${prefix}/wp-json/mendwell/v1/status`],
    ["query", `${base.origin}${prefix}/?rest_route=${encodeURIComponent("/mendwell/v1/status")}`],
  ];
  for (const [mode, url] of attempts) {
    try {
      const res = await safeFetch(url, { headers: { accept: "application/json" }, maxBytes: 64 * 1024 });
      if (res.status !== 200) continue;
      const body = JSON.parse(res.body.toString("utf8")) as { plugin?: string; challenge?: string | null };
      if (body.plugin === "mendwell-connector" && typeof body.challenge === "string" && body.challenge === challenge) return mode;
      return null; // the plugin answered, but with another challenge: stop here
    } catch (error) {
      if (error instanceof SafeFetchError && error.code.startsWith("blocked")) return null;
    }
  }
  return null;
}

/**
 * POST /api/connector/pair, called by the plugin (no session). The one-time code identifies the
 * org and site; the challenge proves the plugin runs on that site's own URL; then a new 256-bit
 * secret is encrypted at rest and returned exactly once.
 */
export async function pairConnector(input: { code: string; siteUrl: string; challenge: string; versions: { plugin?: string | null; wordpress?: string | null } }) {
  const { repos, keyring, db } = server();
  if (!keyring) throw new AppError("pairing_unavailable", "Pairing isn't set up on this server yet.", 503);
  const code = normalizePairingCode(input.code);
  if (!code) throw notFound("That pairing code");
  const pending = await repos.pairingCodes.findUsableByHash(hashPairingCode(code));
  if (!pending) throw notFound("That pairing code"); // wrong, expired or used: all look the same

  const site = await repos.sites.get(pending.orgId, pending.siteId);
  if (!site) throw notFound("That pairing code");
  if (hostKey(input.siteUrl) !== hostKey(site.url)) {
    throw new AppError("site_mismatch", `This code is for ${new URL(site.url).hostname}. Install the plugin on that site, or add this site in Mendwell.`, 422);
  }
  const restMode = await checkChallenge(site.url, input.challenge);
  if (!restMode) {
    throw new AppError("challenge_failed", "Mendwell couldn't confirm the plugin on your site's public address. Check the site is reachable over HTTPS and try again.", 403);
  }

  const secret = randomBytes(32).toString("hex");
  const secretEnc = encrypt(keyring, secret, secretContext(site.id));
  const paired = await db.transaction(async (tx) => {
    const r = createRepositories(tx);
    if (!(await r.pairingCodes.consume(pending.orgId, pending.id))) return null; // someone else won the race
    await r.sites.markPaired(pending.orgId, site.id, { secretEnc, connectorVersion: input.versions.plugin ?? null, restMode });
    await r.audit.record(pending.orgId, {
      actor: "system",
      action: "connector.paired",
      entity: "site",
      entityId: site.id,
      meta: { pluginVersion: input.versions.plugin ?? null, wordpress: input.versions.wordpress ?? null, restMode },
    });
    return true;
  });
  if (!paired) throw notFound("That pairing code");
  return { siteId: site.id, secret };
}

/** A signed client for a paired site, or null. The secret is decrypted in memory only. */
export async function connectorFor(ctx: Pick<OrgContext, "orgId">, siteId: string): Promise<ConnectorClient | null> {
  const { repos, keyring } = server();
  const site = await repos.sites.get(ctx.orgId, siteId);
  const stored = await repos.sites.getConnectorSecret(ctx.orgId, siteId);
  if (!site || site.connection !== "connector" || !stored?.secretEnc || !keyring) return null;
  const secret = decrypt(keyring, stored.secretEnc, secretContext(site.id));
  const safeFetch = siteFetch();
  return createConnectorClient({
    siteUrl: site.url,
    secret,
    restMode: site.connectorRestMode === "query" ? "query" : "pretty",
    transport: connectorTransport(safeFetch),
  });
}

/**
 * Pause or resume changes for a site. Mendwell's own flag is authoritative (the worker checks it
 * before every write); telling the plugin is best effort and reported back.
 */
export async function setWritesPaused(ctx: OrgContext, siteId: string, paused: boolean) {
  const { repos } = server();
  const site = await getSite(ctx, siteId);
  if (!hasRole(ctx.role, "admin")) throw new AppError("forbidden", "Only admins and owners can pause or resume changes.", 403);
  await repos.sites.update(ctx.orgId, site.id, { writesPaused: paused });
  let syncedToPlugin: boolean | null = null;
  const client = await connectorFor(ctx, site.id);
  if (client) {
    try {
      await (paused ? client.pause() : client.resume());
      syncedToPlugin = true;
    } catch {
      syncedToPlugin = false;
    }
  }
  await repos.audit.record(ctx.orgId, {
    actor: `user:${ctx.user.id}`,
    action: paused ? "site.paused" : "site.resumed",
    entity: "site",
    entityId: site.id,
    meta: { syncedToPlugin },
  });
  return { paused, syncedToPlugin };
}

export async function disconnectConnector(ctx: OrgContext, siteId: string) {
  const { repos } = server();
  const site = await getSite(ctx, siteId);
  if (!hasRole(ctx.role, "admin")) throw new AppError("forbidden", "Only admins and owners can disconnect a site.", 403);
  await repos.sites.disconnect(ctx.orgId, site.id);
  await repos.audit.record(ctx.orgId, { actor: `user:${ctx.user.id}`, action: "connector.disconnected", entity: "site", entityId: site.id });
}
