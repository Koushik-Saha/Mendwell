import { describe, expect, it } from "vitest";
import {
  decideBucket,
  fixCategoryForRule,
  initialBucket,
  isDownAfterConsecutiveFailures,
  isProtectedPage,
  localTime,
  pageCapForPlan,
  reconcileIssues,
  ruleLabel,
  sslAlertThreshold,
  wooProtectedUrls,
  type KnownIssue,
} from "./policy";

describe("pageCapForPlan", () => {
  it("caps paid plans at 100, the public scan at 10, unknown plans conservatively", () => {
    expect(pageCapForPlan("agency")).toBe(100);
    expect(pageCapForPlan("solo")).toBe(100);
    expect(pageCapForPlan("trial")).toBe(100);
    expect(pageCapForPlan("public")).toBe(10);
    expect(pageCapForPlan("something-new")).toBe(25);
  });
});

describe("isProtectedPage", () => {
  it.each([
    "https://shop.test/cart/",
    "https://shop.test/checkout/order-received/123/",
    "https://shop.test/my-account/orders/",
    "https://shop.test/wp-login.php?action=lostpassword",
    "https://shop.test/wp-admin/",
    "https://shop.test/store/checkout/", // WordPress in a subfolder
    "https://shop.test/CART/",
  ])("protects %s by default", (url) => {
    expect(isProtectedPage(url)).toBe(true);
  });

  it.each(["https://shop.test/", "https://shop.test/cartography/", "https://shop.test/blog/checking-out-our-new-range/", "https://shop.test/smartcart"])(
    "leaves %s alone",
    (url) => {
      expect(isProtectedPage(url)).toBe(false);
    },
  );

  it("adds the customer's own paths, with or without slashes", () => {
    expect(isProtectedPage("https://x.test/members/area/", ["members"])).toBe(true);
    expect(isProtectedPage("https://x.test/donate/", ["/donate/"])).toBe(true);
    expect(isProtectedPage("https://x.test/about/", ["", "  "])).toBe(false);
    expect(isProtectedPage("not a url", ["x"])).toBe(false);
  });
});

describe("initialBucket", () => {
  it("puts fixable issues in approval and everything else in alert, never auto at scan time", () => {
    for (const rule of ["image-alt", "meta-description-missing", "meta-title-duplicate", "link-broken-internal", "link-broken-external"]) {
      expect(initialBucket({ rule }), rule).toBe("approval");
    }
    for (const rule of ["color-contrast", "html-has-lang", "label", "link-name", "button-name", "og-tags-missing", "ssl-expiring", "uptime-down"]) {
      expect(initialBucket({ rule }), rule).toBe("alert");
    }
  });

  it("maps fixable rules to their fix category", () => {
    expect(fixCategoryForRule("role-img-alt")).toBe("alt_text");
    expect(fixCategoryForRule("meta-title-too-long")).toBe("meta");
    expect(fixCategoryForRule("color-contrast")).toBeNull();
  });
});

describe("ruleLabel", () => {
  it("names rules in plain English and never claims compliance", () => {
    expect(ruleLabel("image-alt")).toBe("Image without alt text");
    expect(ruleLabel("unknown-rule")).toBe("unknown-rule");
  });
});

describe("reconcileIssues", () => {
  const issue = (fingerprint: string, over: Partial<KnownIssue> = {}): KnownIssue => ({
    id: `id-${fingerprint}`,
    fingerprint,
    status: "open",
    rule: "image-alt",
    pageUrl: "https://x.test/a/",
    ...over,
  });

  it("classifies new, persisting, reopened and resolved", () => {
    const result = reconcileIssues({
      existing: [issue("keep"), issue("gone"), issue("back", { status: "resolved" }), issue("muted", { status: "ignored" })],
      foundFingerprints: ["keep", "back", "muted", "fresh"],
      checkedPageUrls: ["https://x.test/a/"],
      siteChecksRan: true,
    });
    expect(result).toEqual({ created: ["fresh"], reopened: ["back"], persisting: ["keep", "muted"], resolved: ["id-gone"] });
  });

  it("doesn't resolve issues on pages this scan didn't re-check (page cap, failed load)", () => {
    const result = reconcileIssues({
      existing: [issue("elsewhere", { pageUrl: "https://x.test/not-crawled/" })],
      foundFingerprints: [],
      checkedPageUrls: ["https://x.test/a/"],
      siteChecksRan: true,
    });
    expect(result.resolved).toEqual([]);
  });

  it("matches pages after URL normalization", () => {
    const result = reconcileIssues({
      existing: [issue("x", { pageUrl: "https://X.test/a/?utm_source=mail" })],
      foundFingerprints: [],
      checkedPageUrls: ["https://x.test/a/#top"],
      siteChecksRan: false,
    });
    expect(result.resolved).toEqual(["id-x"]);
  });

  it("resolves site-level issues only when the site checks ran", () => {
    const existing = [issue("ssl", { rule: "ssl-expiring", pageUrl: "https://x.test/" })];
    expect(reconcileIssues({ existing, foundFingerprints: [], checkedPageUrls: ["https://x.test/"], siteChecksRan: false }).resolved).toEqual([]);
    expect(reconcileIssues({ existing, foundFingerprints: [], checkedPageUrls: [], siteChecksRan: true }).resolved).toEqual(["id-ssl"]);
  });

  it("never resolves ignored issues", () => {
    const result = reconcileIssues({
      existing: [issue("muted", { status: "ignored" })],
      foundFingerprints: [],
      checkedPageUrls: ["https://x.test/a/"],
      siteChecksRan: true,
    });
    expect(result.resolved).toEqual([]);
  });
});

describe("alert thresholds", () => {
  it.each([
    [30, null],
    [22, null],
    [21, 21],
    [8, 21],
    [7, 7],
    [2, 7],
    [1, 1],
    [0, 1],
    [-3, 1],
  ] as const)("SSL with %s days left → %s", (days, threshold) => {
    expect(sslAlertThreshold(days)).toBe(threshold);
  });

  it("calls a site down only after 2 consecutive failures", () => {
    expect(isDownAfterConsecutiveFailures([{ up: false }])).toBe(false);
    expect(isDownAfterConsecutiveFailures([{ up: false }, { up: true }])).toBe(false);
    expect(isDownAfterConsecutiveFailures([{ up: true }, { up: false }])).toBe(false);
    expect(isDownAfterConsecutiveFailures([{ up: false }, { up: false }, { up: true }])).toBe(true);
  });
});

describe("localTime", () => {
  const now = new Date("2026-09-26T06:30:00Z");
  it("gives the local hour and date in the site's timezone", () => {
    expect(localTime(now, "UTC")).toEqual({ hour: 6, date: "2026-09-26" });
    expect(localTime(now, "America/Los_Angeles")).toEqual({ hour: 23, date: "2026-09-25" });
    expect(localTime(now, "Asia/Kolkata")).toEqual({ hour: 12, date: "2026-09-26" });
  });

  it("falls back to UTC for an invalid timezone", () => {
    expect(localTime(now, "Mars/Olympus_Mons")).toEqual({ hour: 6, date: "2026-09-26" });
  });
});

describe("decideBucket", () => {
  const base = {
    category: "alt_text" as const,
    categoryState: "auto" as const,
    pageUrl: "https://shop.test/about/",
    protectedPaths: [],
    autoWritesToday: 0,
    dailyCap: 25,
  };

  it("is auto only when graduated, unprotected, reviewed-free and under the cap", () => {
    expect(decideBucket(base)).toEqual({ bucket: "auto", reason: "graduated" });
    expect(decideBucket({ ...base, categoryState: "eligible" })).toEqual({ bucket: "approval", reason: "not_graduated" });
    expect(decideBucket({ ...base, categoryState: "approval" })).toEqual({ bucket: "approval", reason: "not_graduated" });
    expect(decideBucket({ ...base, autoWritesToday: 25 })).toEqual({ bucket: "approval", reason: "daily_cap" });
    expect(decideBucket({ ...base, dailyCap: 0 })).toEqual({ bucket: "approval", reason: "daily_cap" });
    expect(decideBucket({ ...base, needsReview: true })).toEqual({ bucket: "approval", reason: "needs_review" });
    expect(decideBucket({ ...base, category: "external_link" })).toEqual({ bucket: "approval", reason: "external_link" });
  });

  it("never auto-fixes protected pages: defaults, the customer's list, and WooCommerce pages from the connector", () => {
    expect(decideBucket({ ...base, pageUrl: "https://shop.test/checkout/" }).reason).toBe("protected_page");
    expect(decideBucket({ ...base, pageUrl: "https://shop.test/members/area/", protectedPaths: ["/members/"] }).reason).toBe("protected_page");
    const woo = wooProtectedUrls({
      active: true,
      pages: { cart: { id: 5, url: "https://shop.test/basket/" }, checkout: { id: 6, url: "https://shop.test/pay/" }, myaccount: { id: 7, url: "https://shop.test/konto/" }, shop: { id: 4, url: "https://shop.test/store/" } },
    });
    expect(woo).toEqual(["https://shop.test/basket/", "https://shop.test/pay/", "https://shop.test/konto/"]);
    expect(decideBucket({ ...base, pageUrl: "https://shop.test/basket/", protectedUrls: woo }).reason).toBe("protected_page");
    expect(decideBucket({ ...base, pageUrl: "https://shop.test/konto/orders/", protectedUrls: woo }).reason).toBe("protected_page");
    expect(decideBucket({ ...base, pageUrl: "https://shop.test/store/", protectedUrls: woo }).bucket).toBe("auto");
    expect(wooProtectedUrls({ active: false, pages: {} })).toEqual([]);
    expect(wooProtectedUrls(null)).toEqual([]);
  });
});
