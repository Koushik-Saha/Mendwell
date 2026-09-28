import { connectorSecretContext, createConnectorClient, decrypt, type ConnectorClient, type ConnectorTransport, type Keyring, type OrgId } from "@mendwell/core";
import { createRepositories, type Db } from "@mendwell/db";
import { connectorTransport, createSafeFetch, type Resolver, type SafeFetch, type TestAllow } from "@mendwell/scanner";

export type NetDeps = { userAgent: string; net?: { resolver?: Resolver; testAllow?: TestAllow } };

export function siteFetch(deps: NetDeps): SafeFetch {
  return createSafeFetch({ ...deps.net, userAgent: deps.userAgent, timeoutMs: 15_000 });
}

/**
 * A signed client for a paired site, or null. The secret is decrypted in memory for this task
 * only (SECURITY.md §2 Worker) and every request goes through the SSRF-safe fetcher.
 */
export async function siteConnector(
  deps: NetDeps & { db: Db; keyring: Keyring | null; connectorTransport?: ConnectorTransport },
  orgId: OrgId,
  site: { id: string; url: string; connection: string; connectorRestMode: string },
): Promise<ConnectorClient | null> {
  if (site.connection !== "connector" || !deps.keyring) return null;
  const stored = await createRepositories(deps.db).sites.getConnectorSecret(orgId, site.id);
  if (!stored?.secretEnc) return null;
  return createConnectorClient({
    siteUrl: site.url,
    secret: decrypt(deps.keyring, stored.secretEnc, connectorSecretContext(site.id)),
    restMode: site.connectorRestMode === "query" ? "query" : "pretty",
    transport: deps.connectorTransport ?? connectorTransport(siteFetch(deps)),
  });
}
