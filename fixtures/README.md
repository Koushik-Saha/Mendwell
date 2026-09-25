# Fixture sites

Three small static sites with issues planted on purpose. The scanner, verifier and e2e tests run against them. Every planted issue is listed below and in machine-readable form in [`manifest.json`](./manifest.json). `fixtures.test.ts` fails if the HTML and the manifest ever drift apart, in either direction.

```
pnpm fixtures:serve        # http://localhost:4000
```

| Site | URL | Purpose |
|---|---|---|
| clean | http://localhost:4000/clean/ | Control. Passes every v1 check. Any finding here is a false positive. |
| messy | http://localhost:4000/messy/ | Brochure site. Every v1 check fires at least once. |
| woocommerce | http://localhost:4000/woocommerce/ | WooCommerce-like shop. Cart, checkout and my-account are **protected pages**: issues there must be reported and must never be auto-fixed. |

## Notes for test authors

- **All three sites share one origin** (`localhost:4000`), so a site's scope is its path prefix (`/messy/`). Links between prefixes are out of scope for that site, not "internal".
- **Broken external links use the `.invalid` TLD** (RFC 2606), which never resolves. They fail deterministically as DNS errors, with no network access and no traffic to real third parties.
- **The SSRF-safe fetcher blocks loopback by design.** Scanner tests must opt in to `localhost:4000` through an explicit test-only allowlist, never by weakening the production blocklist.
- The server sends `Cache-Control: no-store` so verification always sees fresh content. It 301-redirects `/path` to `/path/` like WordPress permalinks and 404s anything else.
- Planted low-contrast colors are in each site's `style.css`, next to a comment giving the ratio.

## Planted issues

Check IDs are the ones used in `manifest.json`.

### clean: none

Deliberate non-issues that must **not** be flagged:
- `/clean/`: `img/divider.svg` has `alt=""`, which is correct for a decorative image.
- Every page has a unique title, a meta description and `lang="en"`. All links resolve.

### messy

| ID | Check | Page | Where | Detail |
|---|---|---|---|---|
| messy-lang-home | html-lang-missing | `/messy/` | `<html>` | No `lang` attribute |
| messy-meta-home | meta-description-missing | `/messy/` | `<head>` | |
| messy-meta-blog | meta-description-missing | `/messy/blog/` | `<head>` | |
| messy-title-dup | title-duplicate | `/messy/` + `/messy/services/` | `<title>` | Both are "Home" |
| messy-alt-logo | img-alt-missing | `/messy/` | `img/logo.svg` | Header logo, so the fix is alt text that names the business |
| messy-alt-team | img-alt-missing | `/messy/` | `img/team.svg` | |
| messy-alt-van | img-alt-missing | `/messy/` | `img/van.svg` | |
| messy-alt-boiler | img-alt-missing | `/messy/services/` | `img/boiler.svg` | |
| messy-link-contact | link-broken-internal | `/messy/` | `a[href="/messy/contact/"]` | 404. Linked twice (nav + body), so it should be reported once |
| messy-link-reviews | link-broken-external | `/messy/` | `https://reviews.example.invalid/rivera-plumbing` | DNS failure |
| messy-contrast-home | color-contrast | `/messy/` | `p.faint` | `#b0b0b0` on `#ffffff` = 2.14:1 |
| messy-contrast-services | color-contrast | `/messy/services/` | `p.faint` | Same rule as above. It's a theme-level issue, so "alert" and not fixable |

### woocommerce

Protected pages: `/woocommerce/cart/`, `/woocommerce/checkout/`, `/woocommerce/my-account/`.

| ID | Check | Page | Where | Detail |
|---|---|---|---|---|
| woo-meta-shop | meta-description-missing | `/woocommerce/shop/` | `<head>` | |
| woo-alt-shop-apron | img-alt-missing | `/woocommerce/shop/` | `img/apron.svg` | Inside a product link that has text, so decorative (`alt=""`) is a valid proposal |
| woo-alt-shop-mug | img-alt-missing | `/woocommerce/shop/` | `img/mug.svg` | Same pattern as above |
| woo-link-mug | link-broken-internal | `/woocommerce/shop/` | `a[href="/woocommerce/product/stoneware-mug/"]` | 404. Deleted product |
| woo-link-care | link-broken-external | `/woocommerce/product/linen-apron/` | `https://care-guides.example.invalid/linen` | DNS failure |
| woo-contrast-stock | color-contrast | `/woocommerce/product/linen-apron/` | `p.stock` | `#9a9a9a` on `#fdfdfd` = 2.73:1 |
| woo-meta-cart | meta-description-missing | `/woocommerce/cart/` | `<head>` | **Protected** |
| woo-alt-cart | img-alt-missing | `/woocommerce/cart/` | `img/apron.svg` | **Protected** |
| woo-meta-checkout | meta-description-missing | `/woocommerce/checkout/` | `<head>` | **Protected** |
| woo-alt-checkout | img-alt-missing | `/woocommerce/checkout/` | `img/card-logos.svg` | **Protected** |
| woo-contrast-checkout | color-contrast | `/woocommerce/checkout/` | `p.fine-print` | **Protected**. Same `#9a9a9a` rule |
| woo-meta-account | meta-description-missing | `/woocommerce/my-account/` | `<head>` | **Protected** |
| woo-alt-account | img-alt-missing | `/woocommerce/my-account/` | `img/avatar.svg` | **Protected** |

Totals: messy 12, woocommerce 13 (7 on protected pages), clean 0.

## Adding an issue

1. Plant it in `sites/<site>/…`.
2. Add it to `manifest.json` (and mark `"protected": true` if it's on a protected path).
3. Add a row above.
4. Run `pnpm --filter @mendwell/fixtures test`. It fails until all three agree.
