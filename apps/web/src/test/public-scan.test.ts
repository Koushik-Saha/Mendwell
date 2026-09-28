import { publicScans } from "@mendwell/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as optOutRoute from "@/app/api/bot/opt-out/route";
import * as viewRoute from "@/app/api/public-scan/[slug]/route";
import * as scanRoute from "@/app/api/public-scan/route";
import { normalizePublicUrl } from "@/lib/server/services/publicScan";
import { createHarness, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

let visitor = 0;
const scan = (url: string, opts: { ip?: string; token?: string | null } = {}) => {
  const headers = new Headers({ "x-forwarded-for": opts.ip ?? `203.0.113.${++visitor % 250}` });
  return h.call(scanRoute.POST, { method: "POST", headers, body: { url, ...(opts.token === null ? {} : { turnstileToken: opts.token ?? "turnstile-ok" }) } });
};

describe("normalizePublicUrl", () => {
  it("accepts what people type and refuses what isn't a public website", () => {
    expect(normalizePublicUrl("Example.com")).toBe("https://example.com/");
    expect(normalizePublicUrl("http://www.example.com/blog?x=1#y")).toBe("http://www.example.com/blog/");
    for (const bad of ["localhost", "http://10.0.0.1", "https://169.254.169.254/", "user:pw@example.com", "example.com:8443", "intranet", "printer.local", "ftp://example.com", "[::1]"]) {
      expect(() => normalizePublicUrl(bad), bad).toThrow();
    }
  });
});

describe("POST /api/public-scan", () => {
  it("queues a scan and returns a share slug; the result page reads it", async () => {
    const res = await scan("first-site.example");
    expect(res.status, res.text).toBe(202);
    const slug = (res.json as { slug: string }).slug;
    expect(slug).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const [row] = await h.db.select().from(publicScans).where(eq(publicScans.shareSlug, slug));
    expect(h.publicScanJobs).toContain(row?.id);
    expect(row?.ipHash).toMatch(/^hash:/); // never the raw address
    expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect((await h.call(viewRoute.GET, { params: { slug } })).json).toMatchObject({ state: "pending", url: "https://first-site.example/" });
  });

  it("needs a passed Turnstile check", async () => {
    expect((await scan("turnstile.example", { token: null })).status).toBe(400);
    expect((await scan("turnstile.example", { token: "forged" })).status).toBe(400);
  });

  it("limits each visitor to 5 an hour and each host to 3 a day", async () => {
    for (let i = 0; i < 5; i++) expect((await scan(`visitor-${i}.example`, { ip: "198.51.100.7" })).status).toBe(202);
    const sixth = await scan("visitor-6.example", { ip: "198.51.100.7" });
    expect(sixth.status).toBe(429);
    expect(sixth.json).toMatchObject({ error: { code: "rate_limited" } });

    for (let i = 0; i < 3; i++) expect((await scan(`busy-host.example/page-${i}`)).status).toBe(202);
    expect((await scan("busy-host.example/page-4")).status).toBe(429);
  });

  it("reuses a finished scan of the same address from the last day instead of scanning again", async () => {
    const first = await scan("reuse.example");
    const slug = (first.json as { slug: string }).slug;
    await h.db.update(publicScans).set({ status: "succeeded", result: { version: 1, total: 0 } }).where(eq(publicScans.shareSlug, slug));
    const again = await scan("https://reuse.example");
    expect(again.status).toBe(200);
    expect(again.json).toEqual({ slug, reused: true });
  });

  it("respects opt-outs from /bot (for the domain and its subdomains)", async () => {
    expect((await h.call(optOutRoute.POST, { method: "POST", body: { host: "https://www.owner-said-no.example/", turnstileToken: "turnstile-ok" } })).json).toEqual({ host: "owner-said-no.example" });
    expect((await h.call(optOutRoute.POST, { method: "POST", body: { host: "other.example" } })).status).toBe(400); // human check
    const res = await scan("blog.owner-said-no.example");
    expect(res.status).toBe(403);
  });

  it("shows expired and unknown results as such", async () => {
    const res = await scan("expired.example");
    const slug = (res.json as { slug: string }).slug;
    await h.db.update(publicScans).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(publicScans.shareSlug, slug));
    expect((await h.call(viewRoute.GET, { params: { slug } })).json).toEqual({ state: "expired" });
    expect((await h.call(viewRoute.GET, { params: { slug: "does-not-exist-aaaaaa" } })).status).toBe(404);
  });
});
