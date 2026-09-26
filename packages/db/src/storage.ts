import { AwsClient } from "aws4fetch";

/** Where evidence screenshots live. R2 in production, memory in tests. */
export type ObjectStore = {
  put: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
  get: (key: string) => Promise<{ body: Uint8Array; contentType: string } | null>;
};

export type R2Config = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };

const KEY = /^[a-z0-9][a-z0-9/._-]{0,511}$/i;

function assertKey(key: string) {
  if (!KEY.test(key) || key.includes("..") || key.includes("//")) throw new Error("Invalid object key");
}

/** R2 (S3-compatible) over aws4fetch. The endpoint comes from config, never from user input. */
export function createR2Store(config: R2Config, fetchImpl: typeof fetch = fetch): ObjectStore {
  const client = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: "s3", region: "auto" });
  const base = `https://${config.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(config.bucket)}`;
  const url = (key: string) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;

  return {
    put: async (key, body, contentType) => {
      assertKey(key);
      // Copy into an ArrayBuffer-backed view: fetch BodyInit rejects SharedArrayBuffer-backed arrays.
      const signed = await client.sign(url(key), { method: "PUT", body: new Uint8Array(body), headers: { "content-type": contentType } });
      const res = await fetchImpl(signed);
      // Status only: never echo keys or response bodies into logs (hard rule 8).
      if (!res.ok) throw new Error(`R2 upload failed (HTTP ${res.status})`);
    },
    get: async (key) => {
      assertKey(key);
      const res = await fetchImpl(await client.sign(url(key), { method: "GET" }));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`R2 read failed (HTTP ${res.status})`);
      return { body: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
    },
  };
}

export function createMemoryStore(): ObjectStore & { objects: Map<string, { body: Uint8Array; contentType: string }> } {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    objects,
    put: async (key, body, contentType) => {
      assertKey(key);
      objects.set(key, { body, contentType });
    },
    get: async (key) => {
      assertKey(key);
      return objects.get(key) ?? null;
    },
  };
}

/** One screenshot per issue, overwritten each scan (kept 90 days by an R2 lifecycle rule, SECURITY.md T14). */
export function evidenceKey(orgId: string, siteId: string, fingerprint: string): string {
  return `evidence/${orgId}/${siteId}/${fingerprint}.png`;
}

/**
 * Used when R2 isn't configured (development). Uploads fail, so no evidence key is recorded and
 * the UI never promises a screenshot it can't show.
 */
export function createUnconfiguredStore(): ObjectStore {
  return {
    put: async () => {
      throw new Error("Object storage (R2) is not configured");
    },
    get: async () => null,
  };
}
