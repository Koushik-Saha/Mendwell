import { describe, expect, it, vi } from "vitest";
import { createMemoryStore, createR2Store, evidenceKey } from "./storage";

const config = { accountId: "acc123", accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret", bucket: "mendwell-evidence" };

describe("createR2Store", () => {
  it("signs a PUT to the account's R2 endpoint with SigV4", async () => {
    const fetch = vi.fn(async (_req: Request | string | URL) => new Response(null, { status: 200 }));
    await createR2Store(config, fetch).put("evidence/o/s/abc.png", new Uint8Array([137, 80]), "image/png");
    const req = fetch.mock.calls[0]?.[0] as Request;
    expect(req.method).toBe("PUT");
    expect(req.url).toBe("https://acc123.r2.cloudflarestorage.com/mendwell-evidence/evidence/o/s/abc.png");
    expect(req.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request/);
    expect(req.headers.get("content-type")).toBe("image/png");
    // aws4fetch uses UNSIGNED-PAYLOAD for S3 bodies (valid SigV4; TLS protects the body).
    expect(req.headers.get("x-amz-content-sha256")).toMatch(/^([0-9a-f]{64}|UNSIGNED-PAYLOAD)$/);
  });

  it("returns null for a missing object and the bytes for a present one", async () => {
    const missing = createR2Store(config, vi.fn(async () => new Response(null, { status: 404 })));
    expect(await missing.get("evidence/x.png")).toBeNull();
    const present = createR2Store(config, vi.fn(async () => new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/png" } })));
    expect(await present.get("evidence/x.png")).toEqual({ body: new Uint8Array([1, 2]), contentType: "image/png" });
  });

  it("reports failures by status only", async () => {
    const store = createR2Store(config, vi.fn(async () => new Response("AccessDenied <Key>secret-key</Key>", { status: 403 })));
    await expect(store.put("evidence/x.png", new Uint8Array(), "image/png")).rejects.toThrow(/^R2 upload failed \(HTTP 403\)$/);
  });

  it.each(["../etc/passwd", "evidence//x.png", "/abs.png", "evidence/<script>.png", ""])("refuses unsafe key %j", async (key) => {
    await expect(createMemoryStore().put(key, new Uint8Array(), "image/png")).rejects.toThrow("Invalid object key");
  });
});

describe("evidenceKey", () => {
  it("namespaces screenshots by org and site", () => {
    expect(evidenceKey("org-1", "site-2", "a".repeat(64))).toBe(`evidence/org-1/site-2/${"a".repeat(64)}.png`);
  });
});

describe("createUnconfiguredStore", () => {
  it("refuses uploads and has nothing to read", async () => {
    const { createUnconfiguredStore } = await import("./storage");
    const store = createUnconfiguredStore();
    await expect(store.put("evidence/x.png", new Uint8Array(), "image/png")).rejects.toThrow(/not configured/);
    expect(await store.get("evidence/x.png")).toBeNull();
  });
});
