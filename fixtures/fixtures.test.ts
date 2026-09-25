import { readFileSync } from "node:fs";
import { contrastRatio } from "@mendwell/ui-preset";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import manifest from "./manifest.json" with { type: "json" };
import { SITE_NAMES, startFixtureServer } from "./serve.mjs";

type Issue = (typeof manifest.sites)[keyof typeof manifest.sites]["issues"][number] & {
  href?: string;
  foreground?: string;
  background?: string;
  duplicateOf?: string[];
  value?: string;
  protected?: boolean;
};

let base = "";
let close: () => Promise<void> = async () => {};
const html = new Map<string, string>();

beforeAll(async () => {
  ({ url: base, close } = await startFixtureServer({ port: 0 }));
  for (const site of Object.values(manifest.sites)) {
    for (const page of site.pages) {
      const res = await fetch(base + page);
      expect(res.status, page).toBe(200);
      html.set(page, await res.text());
    }
  }
});
afterAll(() => close());

const page = (path: string) => {
  const body = html.get(path);
  if (body === undefined) throw new Error(`page not in manifest: ${path}`);
  return body;
};
const imgTags = (body: string) => [...body.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
const hasAlt = (tag: string) => /\balt\s*=/.test(tag);
const title = (body: string) => /<title>([^<]*)<\/title>/.exec(body)?.[1];
const hasMetaDescription = (body: string) => /<meta\s+name="description"\s+content="[^"]+"/.test(body);
const hasLang = (body: string) => /<html\b[^>]*\blang="[^"]+"/.test(body);
const internalHrefs = (body: string) =>
  [...body.matchAll(/<a\b[^>]*href="(\/[^"]*)"/g)].map((m) => m[1]).filter((h): h is string => Boolean(h));
const externalHrefs = (body: string) =>
  [...body.matchAll(/<a\b[^>]*href="(https?:\/\/[^"]*)"/g)].map((m) => m[1]).filter((h): h is string => Boolean(h));

describe("fixture server", () => {
  it("serves an index of all sites", async () => {
    const res = await fetch(`${base}/`);
    const body = await res.text();
    for (const name of SITE_NAMES) expect(body).toContain(`/${name}/`);
  });

  it("returns 404 for missing pages and blocks path traversal", async () => {
    expect((await fetch(`${base}/messy/contact/`)).status).toBe(404);
    expect((await fetch(`${base}/%2e%2e/package.json`)).status).toBe(404);
    expect((await fetch(`${base}/..%2fserve.mjs`)).status).toBe(404);
  });

  it("redirects directories to their trailing-slash permalink", async () => {
    const res = await fetch(`${base}/clean/about`, { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/clean/about/");
  });

  it("disables caching so verification sees fresh content", async () => {
    const res = await fetch(`${base}/clean/`);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("manifest matches the planted HTML", () => {
  const all = Object.entries(manifest.sites).flatMap(([site, s]) => s.issues.map((i) => [site, i as Issue] as const));

  it.each(all.map(([site, i]) => [i.id, site, i] as const))("%s is present", async (_id, site, issue) => {
    const body = page(issue.page);
    switch (issue.check) {
      case "img-alt-missing": {
        const src = /src=\\?"([^"\\]+)/.exec(issue.target)?.[1];
        const tag = imgTags(body).find((t) => t.includes(`src="${src}"`));
        expect(tag, issue.target).toBeDefined();
        expect(hasAlt(tag ?? "")).toBe(false);
        break;
      }
      case "meta-description-missing":
        expect(hasMetaDescription(body)).toBe(false);
        break;
      case "html-lang-missing":
        expect(hasLang(body)).toBe(false);
        break;
      case "title-duplicate":
        for (const other of issue.duplicateOf ?? []) expect(title(page(other))).toBe(title(body));
        expect(title(body)).toBe(issue.value);
        break;
      case "link-broken-internal":
        expect(body).toContain(`href="${issue.href}"`);
        expect((await fetch(base + issue.href)).status).toBe(404);
        break;
      case "link-broken-external": {
        expect(body).toContain(`href="${issue.href}"`);
        // RFC 2606: .invalid never resolves, so the link is deterministically broken without network access.
        expect(new URL(issue.href ?? "").hostname.endsWith(".invalid")).toBe(true);
        break;
      }
      case "color-contrast": {
        const cls = issue.target.split(".")[1] ?? "";
        expect(body).toContain(`class="${cls}"`);
        const css = readFileSync(new URL(`./sites/${site}/style.css`, import.meta.url), "utf8");
        expect(css).toMatch(new RegExp(`\\.${cls}\\b[^{]*\\{[^}]*color:\\s*${issue.foreground}`));
        expect(contrastRatio(issue.foreground ?? "", issue.background ?? "")).toBeLessThan(4.5);
        break;
      }
      default:
        throw new Error(`unknown check ${issue.check}`);
    }
  });

  it("marks every issue on a protected path as protected, and no others", () => {
    for (const site of Object.values(manifest.sites)) {
      for (const issue of site.issues as Issue[]) {
        const onProtected = site.protectedPaths.some((p) => issue.page.startsWith(p));
        expect(Boolean(issue.protected), issue.id).toBe(onProtected);
      }
    }
  });
});

describe("manifest is complete (nothing unplanted slips in)", () => {
  for (const [name, site] of Object.entries(manifest.sites)) {
    const issues = site.issues as Issue[];
    const listed = (check: string, pagePath: string) => issues.filter((i) => i.check === check && i.page === pagePath);

    it(`${name}: every image without alt is listed`, () => {
      for (const p of site.pages) {
        const missing = imgTags(page(p)).filter((t) => !hasAlt(t));
        expect(missing.length, p).toBe(listed("img-alt-missing", p).length);
      }
    });

    it(`${name}: every missing description and lang is listed`, () => {
      for (const p of site.pages) {
        expect(!hasMetaDescription(page(p)), p).toBe(listed("meta-description-missing", p).length === 1);
        expect(!hasLang(page(p)), p).toBe(listed("html-lang-missing", p).length === 1);
      }
    });

    it(`${name}: duplicate titles are exactly the listed ones`, () => {
      const byTitle = new Map<string, string[]>();
      for (const p of site.pages) byTitle.set(title(page(p)) ?? "", [...(byTitle.get(title(page(p)) ?? "") ?? []), p]);
      const dupes = [...byTitle.values()].filter((ps) => ps.length > 1).flat().sort();
      const fromManifest = issues
        .filter((i) => i.check === "title-duplicate")
        .flatMap((i) => [i.page, ...(i.duplicateOf ?? [])])
        .sort();
      expect(dupes).toEqual(fromManifest);
    });

    it(`${name}: every internal link resolves unless listed as broken`, async () => {
      const broken = new Set(issues.filter((i) => i.check === "link-broken-internal").map((i) => i.href));
      for (const p of site.pages) {
        for (const href of internalHrefs(page(p))) {
          const status = (await fetch(base + href)).status;
          expect(status === 404, `${p} -> ${href}`).toBe(broken.has(href));
        }
      }
    });

    it(`${name}: every external link is listed as broken (fixtures stay offline)`, () => {
      const broken = new Set(issues.filter((i) => i.check === "link-broken-external").map((i) => i.href));
      for (const p of site.pages) for (const href of externalHrefs(page(p))) expect(broken.has(href), href).toBe(true);
    });
  }

  it("the clean site has zero issues", () => {
    expect(manifest.sites.clean.issues).toHaveLength(0);
  });
});
