# Mendwell — Product & Technical Specification (v1)

Scope: everything needed for pilots, paid launch and the YC application. Anything not listed here is **out of scope for v1**.

---

## 1. Product principles

1. **Verify before claim.** A fix is "done" only after the live page is re-fetched and the original check passes.
2. **Every write is reversible.** Before-values are stored; undo is one click; a kill switch stops all writes.
3. **Trust is earned per category, per site.** Fix types start in approval mode and graduate to auto only when the customer opts in.
4. **Protected areas are never auto-edited.** Checkout, cart, account, login, and any path the customer marks.
5. **AI proposes, rules decide.** The model generates text (alt text, meta descriptions). Deterministic code decides *what* is allowed to change and *whether* it passed.
6. **Honest reporting.** The Friday report says what was fixed, what's waiting, what we can't fix, and never claims compliance.

---

## 2. Users and roles

| Role | Can |
|---|---|
| Owner (org) | Everything incl. billing, delete org |
| Admin | Sites, approvals, settings, team |
| Member | View, approve/reject fixes |
| Report recipient (no login) | Receives Friday email; approve/reject via signed one-time links |

Org types: **Solo** (one owner, sites billed individually) and **Agency** (many sites, optional "client" grouping for reports).

---

## 3. The agent loop

```
             ┌──────────── schedule (daily / hourly) ────────────┐
             ▼                                                    │
 SENSE  → crawl + checks → Issues (typed, fingerprinted, evidence)│
             ▼                                                    │
 DECIDE → policy engine → bucket: auto | approval | alert         │
             ▼                                                    │
 PROPOSE→ generator (AI or rule) → validator → Fix(proposed)      │
             ▼                                                    │
 GATE   → auto? → apply   |  approval? → queue → human decision   │
             ▼                                                    │
 APPLY  → connector write (logged, before-value saved) → cache purge
             ▼                                                    │
 VERIFY → re-fetch live page (cache-busted, 3 tries / 10 min)     │
          → re-run the exact check                                │
          → pass: VERIFIED   fail: ROLLBACK → verify rollback → ESCALATE
             ▼                                                    │
 LEARN  → approvals/rejections/rollbacks update graduation state ─┘
             ▼
 REPORT → Friday email + dashboard
```

---

## 4. Check catalog (v1)

| Check | Frequency | Source | Bucket |
|---|---|---|---|
| Uptime (homepage HEAD/GET, 2 regions if possible) | Hourly | HTTP | Alert |
| SSL validity + days to expiry (alert at 21/7/1 days) | Daily | TLS | Alert |
| Crawl: sitemap + same-origin links, ≤100 pages (Agency ≤100/site), robots.txt respected | Daily | Playwright | — |
| Images missing alt (axe `image-alt`, `input-image-alt`, `role-img-alt`) | Daily | axe-core | Fix: alt text |
| Empty links/buttons, missing form labels, color contrast, missing `lang` | Daily | axe-core | Alert (theme/plugin-level; plain-English instructions) |
| Meta title missing / duplicate / >60 chars; meta description missing / duplicate / >160 chars | Daily | HTML parse | Fix: meta |
| Open Graph title/description/image missing | Daily | HTML parse | Alert (auto-resolves when meta fixed via SEO plugin) |
| Internal broken links (4xx/5xx after 2 retries) | Daily | HTTP | Fix: internal link (only if resolvable) |
| External broken links | Daily (cached 7d per URL) | HTTP | Approval (suggest removal or archived URL) |
| Lighthouse performance / accessibility / SEO on 3 pages (home + top 2) | Daily | Lighthouse | Trend only |

**Issue identity:** `fingerprint = sha256(siteId + rule + normalizedUrl + targetSelector|targetUrl)`. Each scan marks issues `new`, `persisting`, or `resolved` against the previous scan.

**Evidence** stored per issue: rule id, WCAG ref (if any), page URL, selector, HTML snippet (≤1 KB), element screenshot (R2 key), measured values.

---

## 5. Fix catalog (v1)

### 5.1 Alt text for informative images
- **Generator:** vision model receives the image (downscaled ≤1024px) + context: page title, nearest heading, caption/surrounding text (≤500 chars), filename, link target if the image is a link.
- **Rules for output (validator enforces):** 5–125 chars; no "image of"/"picture of"; no file names; no keyword stuffing (≤2 repeats of any word); no HTML; **never identifies people by name** unless the name appears in the caption/surrounding text; for linked images, describes the link destination.
- **Decorative images:** model may return `{decorative: true}` → becomes an **approval-only** proposal for `alt=""`.
- **Apply:** attachment `alt_text` (media library) **and** `alt` in every Gutenberg `core/image` block / classic `<img>` referencing that attachment in published posts/pages.
- **Verify:** re-fetch page, locate the same image (by `src` basename / attachment id class), confirm `alt` equals applied value and axe `image-alt` passes for that node.

### 5.2 Meta title and description
- **Generator:** page's main text (≤2,000 chars), H1, site name. Title ≤60 chars, description 120–155 chars, no clickbait, no claims not present in page text, no ALL CAPS.
- **Apply:** write to the detected SEO plugin's field — Yoast (`_yoast_wpseo_title`, `_yoast_wpseo_metadesc`), Rank Math (`rank_math_title`, `rank_math_description`), SEOPress (`_seopress_titles_title`, `_seopress_titles_desc`). If no SEO plugin: connector stores values in its own post meta and prints tags in `wp_head` **only when no other plugin prints them**.
- **Verify:** re-fetch, parse `<title>` and `<meta name="description">`, exact match (after entity decoding).

### 5.3 Internal broken links (only when unambiguous)
- **Resolver (deterministic, no AI):** (a) WordPress `_wp_old_slug` lookup → current permalink; (b) exact redirect target known from an existing redirect plugin; (c) exactly one published post/page whose slug matches the broken path's last segment. If none or more than one → approval with candidates, or alert.
- **Apply:** replace the `href` in the source post's content (creates a WP revision).
- **Verify:** re-fetch source page; link now resolves 200 (≤2 redirects).

### 5.4 Bucket rules
| Situation | Bucket |
|---|---|
| Category not graduated for this site | Approval |
| Category graduated + page not protected + under daily cap | Auto |
| Page is cart / checkout / my-account / login / customer-listed protected path | Approval (never auto) |
| Decorative-image (empty alt), external links, >1 link candidate | Approval |
| Theme/plugin-level issues (contrast, lang, labels), SSL, downtime | Alert |
| Daily auto-write cap reached (default 25/site/day) | Approval |

### 5.5 Graduation
- Per site × category state: `approval` → `eligible` → `auto`.
- `eligible` when ≥10 approvals and 0 rejections among the last 20 decisions in that category.
- Customer must **explicitly opt in** ("Turn on auto-fix for alt text on this site?"). Agency admins can opt in across sites.
- Any rejection, user undo, or failed verification in `auto` → back to `approval` + notify.

### 5.6 v1.1 (after pilots, not before)
Image compression (approval-only, original preserved), heading-order fixes (approval), white-label agency reports, Shopify read-only scans.

---

## 6. Fix lifecycle

```
proposed ─┬─(auto)────────────────┐
          └─(approval) pending ─┬─ approved ─┤
                                ├─ edited ───┤ (human-edited value, still validated)
                                └─ rejected (terminal)
applying → applied → verifying ─┬─ verified (terminal, undoable)
                                └─ verify_failed → rolling_back → rolled_back (escalated)
apply_failed (escalated) · conflict (human changed field since; never overwrite) · undone (by user) · superseded
```
Every transition writes an `audit_log` row. All steps are idempotent (keyed by `fix.id`).

---

## 7. Architecture

```
                 ┌───────────────────── Vercel ─────────────────────┐
 Browser ───────▶│ apps/web (Next.js 15)                            │
 (owner/agency)  │  landing · free scan · dashboard · approvals     │
                 │  /api: auth, sites, issues, fixes, approvals,    │
                 │        connector pairing, Stripe webhooks        │
                 └───────┬───────────────────────────┬──────────────┘
                         │ enqueue                    │ Drizzle
                         ▼                            ▼
               ┌──────────────────┐          ┌──────────────────┐
               │ Trigger.dev v4   │─────────▶│ Neon Postgres    │
               │ apps/worker      │          └──────────────────┘
               │  scan.site       │──▶ Cloudflare R2 (evidence, screenshots)
               │  scan.public     │──▶ Anthropic API (generators)
               │  uptime.ping     │──▶ Resend (emails)
               │  fix.propose     │
               │  fix.apply/verify│──HMAC-signed HTTPS──▶ WordPress site
               │  report.weekly   │                      mendwell-connector plugin
               └──────────────────┘
```

**Why Trigger.dev:** durable scheduled/long-running tasks with retries and observability, and an official Playwright build extension for headless Chromium. Pin the Playwright version in both `package.json` and the extension config (recent Playwright releases have broken the extension's auto-detection). Lighthouse runs against the same Chromium via `chrome-launcher` (`CHROME_PATH`). Only scan sites whose ownership is verified (paid) or the limited public scan — see SECURITY.md. **Fallback:** if the Playwright build fails, run the same task code in a Docker worker on Railway/Fly using the official Playwright image.

### 7.1 Repo layout
```
apps/web            Next.js 15 app + API
apps/worker         Trigger.dev tasks (imports packages/*)
packages/core       types, policy, graduation, lifecycle, validators, verification comparators
packages/scanner    crawler, checks (axe, meta, links, ssl, uptime), Lighthouse runner
packages/generators prompt builders + model calls + output schemas (alt, meta)
packages/db         Drizzle schema, migrations, repositories
packages/email      React Email templates (Friday report, alerts, onboarding)
packages/ui-preset  Tailwind tokens shared by web + emails
plugins/mendwell-connector   WordPress plugin (PHP) + PHPUnit tests (wp-env)
fixtures/sites      local static test sites with known issues (for scanner + verify tests)
```

### 7.2 Stack
Next.js 15, TypeScript strict, Tailwind v4 + shadcn/ui · Neon + Drizzle · Better Auth (email magic link + Google; orgs) · Trigger.dev v4 · Playwright + @axe-core/playwright + Lighthouse · Anthropic SDK (model per task via env) · Resend + React Email · Stripe Billing · Cloudflare R2 · Cloudflare Turnstile (free scan form) · Sentry · Vitest + Playwright test · PHP 7.4+/WP 6.2+ for connector.

---

## 8. WordPress connector plugin

**Purpose:** the only way Mendwell writes to a site. Small, auditable, allowlisted.

### 8.1 Pairing
1. User clicks "Add site" in Mendwell → gets a one-time **pairing code** (valid 15 min).
2. Installs plugin (zip in v1; WordPress.org listing later) → Settings → Mendwell → pastes code.
3. Plugin calls `POST https://app/api/connector/pair` with code + site URL + WP/plugin versions.
4. Server verifies code, confirms the site URL responds with the plugin's public `/status` challenge, generates a 256-bit shared secret, returns it once. Both sides store it (server: encrypted; plugin: encrypted with WP salts in `wp_options`, autoload off).
5. Pairing proves ownership (only an admin can install plugins).

### 8.2 Request signing (Mendwell → site)
Headers: `X-Mendwell-Timestamp`, `X-Mendwell-Nonce`, `X-Mendwell-Signature = HMAC_SHA256(secret, method + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + sha256(body))`. Reject if timestamp skew >300s, nonce seen in last 10 min, or signature mismatch (constant-time compare). HTTPS only.

### 8.3 REST routes (`/wp-json/mendwell/v1/…`)
| Route | Purpose |
|---|---|
| `GET status` | versions, SEO plugin, cache plugins, WooCommerce page IDs, paused flag |
| `GET media/{id}/usage` | posts/pages referencing an attachment |
| `GET resolve-path?path=` | old-slug / slug resolution for broken links |
| `POST fix/alt` | `{fixId, attachmentId, value, expectedCurrent}` |
| `POST fix/meta` | `{fixId, postId, title?, description?, expectedCurrent}` |
| `POST fix/link` | `{fixId, postId, oldHref, newHref}` |
| `POST undo/{fixId}` | restore before-value only if current == applied value, else `409 conflict` |
| `POST cache/purge` | `{urls[]}` for WP Rocket, W3TC, LiteSpeed, WP Super Cache, SiteGround, Breeze (best effort) |
| `POST pause` / `POST resume` | kill switch (also settable from WP admin) |

Every write: checks `paused`, checks `expectedCurrent` (optimistic concurrency), stores a row in `{prefix}mendwell_log` (fix_id, object_type, object_id, field, before, after, applied_at, undone_at), uses core APIs (`update_post_meta`, `wp_update_post` → creates revisions). **No** file writes, no arbitrary SQL, no `eval`, no plugin/theme installs, no user creation.

### 8.4 Admin screen (single page)
Pairing status · **Pause all changes** toggle · last 20 changes with "undo" links · disconnect button · link to source code / changelog.

### 8.5 Tests
PHPUnit via `@wordpress/env`: signature validation, replay rejection, each fix route, undo + conflict, pause, Gutenberg block alt update, classic editor alt update, Yoast/Rank Math/no-plugin meta paths, uninstall cleanup.

---

## 9. Data model (Drizzle / Postgres)

UUID PKs, `timestamptz` (UTC), `created_at/updated_at` on all tables. Every tenant table has `org_id` and every query filters by it.

```
organizations      id, name, type('solo'|'agency'), plan, founding bool
memberships        org_id, user_id, role('owner'|'admin'|'member')
clients            id, org_id, name, report_recipients text[]            -- agency grouping
sites              id, org_id, client_id?, url, name, platform('wordpress'|'other'),
                   connection('none'|'connector'), connector_version?, secret_enc?,
                   ownership_verified_at?, writes_paused bool, timezone,
                   protected_paths text[], daily_write_cap int default 25,
                   report_recipients text[], status('active'|'paused'|'archived')
site_categories    site_id, category, state('approval'|'eligible'|'auto'), updated_at
scans              id, site_id?, public_scan_id?, kind('daily'|'manual'|'public'),
                   status, started_at, finished_at, pages_crawled, counts jsonb,
                   lighthouse jsonb, error?, worker_seconds int
pages              id, site_id, url, url_hash, last_status, is_protected, wp_object jsonb?
issues             id, site_id, fingerprint, rule, category, severity, page_url, target jsonb,
                   evidence jsonb, evidence_key?, bucket, status('open'|'resolved'|'ignored'),
                   first_scan_id, last_scan_id, resolved_at?     unique(site_id, fingerprint)
fixes              id, site_id, issue_id, category, status, bucket_at_creation,
                   proposed_value jsonb, final_value jsonb, before_value jsonb,
                   generator_model?, prompt_version?, validation jsonb,
                   connector_log_id?, applied_at?, verify_attempts int, verified_at?,
                   verification jsonb, rolled_back_at?, rollback_reason?, undone_at?, cost_usd numeric
approvals          id, fix_id, user_id?, via('app'|'email_link'), decision, edited_value?, reason?, decided_at
reports            id, org_id, site_id?, client_id?, period_start, period_end, content jsonb,
                   sent_at?, opened_at?, provider_id?
alerts             id, site_id, type, severity, message, created_at, acknowledged_at?
public_scans       id, url, host, ip_hash, status, share_slug, result jsonb, created_at, expires_at
subscriptions      org_id, stripe_customer_id, stripe_subscription_id, plan, site_quantity,
                   status, trial_ends_at?, coupon?
pairing_codes      code_hash, org_id, site_id, expires_at, used_at?
ai_usage           id, org_id, site_id?, fix_id?, model, input_tokens, output_tokens, cost_usd, at
audit_log          id, org_id, actor('user:<id>'|'system'|'worker'), action, entity, entity_id, meta jsonb, at
```

---

## 10. API (Next.js route handlers, Zod-validated)

```
Public
  POST /api/public-scan               {url, turnstileToken} → {id}     (rate-limited)
  GET  /api/public-scan/:id           status + result (share link page /r/:slug)

App (session, org-scoped)
  GET/POST /api/sites · GET/PATCH/DELETE /api/sites/:id
  POST /api/sites/:id/pairing-code
  POST /api/sites/:id/scan-now
  POST /api/sites/:id/pause · /resume
  GET  /api/sites/:id/issues?status=&category=
  GET  /api/sites/:id/fixes?status=
  GET  /api/approvals?siteId=          pending queue
  POST /api/fixes/:id/approve {editedValue?} · /reject {reason} · /undo
  POST /api/fixes/batch {ids[], action}
  PATCH /api/sites/:id/categories/:category {state:'auto'|'approval'}
  GET  /api/reports · GET /api/reports/:id
  CRUD /api/clients · /api/members
  POST /api/billing/checkout · /api/billing/portal

Connector
  POST /api/connector/pair            {code, siteUrl, versions}

Signed email links
  GET  /a/:token                      one-time approve/reject (expires 7 days, single use)

Webhooks
  POST /api/webhooks/stripe           (signature verified)
  POST /api/webhooks/resend           (opens/bounces, signature verified)
```

---

## 11. Screens

1. **Landing** — hero + URL box (free scan), how it works, verify/undo demo, pricing, honest FAQ.
2. **Free scan result** (`/r/:slug`) — score-free summary by category, top 10 issues with evidence, "Fix these automatically" CTA. No compliance language.
3. **Onboarding** — create org → add site → download connector → pairing code → live "waiting for plugin…" state → first scan progress → first proposals review.
4. **Dashboard** — sites grid (health, open issues, pending approvals, verified fixes this week), alerts strip.
5. **Site** — tabs: Issues · Fixes timeline · Approvals · Settings (categories & graduation toggles, protected paths, daily cap, recipients, pause).
6. **Approvals queue** — cards: before/after, evidence screenshot, editable value, Approve / Edit & approve / Reject (reason chips). Batch approve by category.
7. **Fix detail** — lifecycle timeline, verification evidence, undo.
8. **Reports** — list + web view of each Friday report.
9. **Billing & team.**

Design direction: calm, trustworthy, dense but readable (think Linear/Stripe dashboard, not marketing gradients). Use the `frontend-design` skill. Green = verified, amber = waiting on you, red = alert/rolled back — always with icons and text, never color alone. Run a11y-autofix on your own app before launch.

---

## 12. Friday report (email + web)

Sent Friday 8:00 in the site's timezone. Agency mode: one email per client (to client recipients, optional) + one roll-up to the agency.

```
Subject: [Site]: 18 fixes verified this week, 3 need your OK

This week
✓ 18 issues fixed and re-checked on your live site
  • 12 images now have descriptive alt text
  • 5 pages got meta descriptions
  • 1 broken link repaired
⏳ 3 changes waiting for your approval  [Review in 1 click]
⚠ 1 thing we can't fix for you: SSL certificate expires in 14 days — contact your host.

Trend: open issues 64 → 41 (-36%)
What we didn't touch and why: 6 color-contrast issues come from your theme — here's what to ask your developer.

Mendwell fixes common issues and verifies each fix. It does not certify ADA/WCAG compliance.
```

---

## 13. Non-functional requirements

- Scan of 100 pages completes < 10 min; free scan (≤10 pages) < 90 s.
- Crawl politeness: ≤2 concurrent requests per host, respect `robots.txt` and `Crawl-delay`, identify with `User-Agent: MendwellBot/1.0 (+https://<domain>/bot)`.
- Worker writes to a given site are serialized (one fix at a time per site).
- 99.5% availability target for the app; scans are retried, never silently dropped.
- Cost tracking per site per month (AI + worker seconds) visible in admin.