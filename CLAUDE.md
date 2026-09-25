# CLAUDE.md — Mendwell

Mendwell is an AI-native maintenance service for WordPress sites: scan → propose fix → (approve) → apply via connector plugin → **re-verify on the live site** → rollback if it fails → Friday report.

Before every task read the relevant sections of `PROJECT_SPEC.md` and `SECURITY.md`. If a request conflicts with them, stop and ask.

## Repo
```
apps/web              Next.js 15 (App Router) — UI + API
apps/worker           Trigger.dev v4 tasks
packages/core         types, policy, graduation, lifecycle, validators, comparators (pure, no I/O)
packages/scanner      crawler + checks + Lighthouse
packages/generators   AI prompt builders, model calls, output schemas
packages/db           Drizzle schema, migrations, repositories
packages/email        React Email templates
packages/ui-preset    Tailwind tokens
plugins/mendwell-connector   WordPress plugin (PHP) + PHPUnit via wp-env
fixtures/sites        static test sites with known issues
```

## Stack (don't swap without asking)
pnpm + Turborepo · TypeScript strict · Next.js 15 · Tailwind v4 + shadcn/ui · Neon + Drizzle · Better Auth · Trigger.dev v4 (+ Playwright build extension, **pinned version**) · Playwright + @axe-core/playwright + Lighthouse · Anthropic SDK · Resend + React Email · Stripe · Cloudflare R2 + Turnstile · Sentry · Vitest · PHP 7.4+/WordPress 6.2+.

## Hard rules
1. **Never mark a fix `verified` without re-fetching the live page and re-running the original check.** Failed verification → rollback → verify the rollback → escalate.
2. **Every write goes through the connector allowlist** and records a before-value. No other path writes to customer sites.
3. **Check `WRITES_ENABLED` (global) and `site.writes_paused` before every apply.** One write at a time per site.
4. **Protected pages (cart, checkout, my-account, login, customer-listed paths) are never auto-fixed.**
5. **AI generates text only.** Policy, bucket, validation and verification are deterministic code in `packages/core`. Model output must parse against a Zod schema and pass validators.
6. **All outbound HTTP to customer/public URLs uses the SSRF-safe fetcher** in `packages/scanner/net`.
7. **Every DB query is org-scoped.** Repositories require `orgId`. Add a cross-org access test for every new route.
8. **Never log secrets, page content, or personal data.** Log IDs and step names.
9. **No compliance claims in any UI copy, email or docs:** never "ADA compliant", "WCAG compliant", "guaranteed", "lawsuit-proof".
10. Idempotency: every task and webhook keyed so a retry never double-applies.
11. Connector: no third-party PHP deps, no file writes, no raw SQL outside `$wpdb->prepare`, escape all output.
12. Ask before adding a dependency; say why.

## Commands
```
pnpm install
pnpm dev                      # web :3000 + trigger dev
pnpm test                     # vitest (all packages)
pnpm test:e2e                 # playwright against fixtures/sites + web
pnpm typecheck && pnpm lint
pnpm db:generate · pnpm db:migrate · pnpm db:studio
pnpm fixtures:serve           # serve fixtures/sites on :4000
pnpm --filter mendwell-connector wp-env start && pnpm --filter mendwell-connector test
npx trigger.dev@latest dev
```

## Env (apps/web + apps/worker)
```
DATABASE_URL · BETTER_AUTH_SECRET · BETTER_AUTH_URL · GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET
ENCRYPTION_KEYS (json: {kid: base64key}) · ENCRYPTION_ACTIVE_KID
TRIGGER_SECRET_KEY · ANTHROPIC_API_KEY · AI_MODEL_VISION · AI_MODEL_TEXT
RESEND_API_KEY · EMAIL_FROM · STRIPE_SECRET_KEY · STRIPE_WEBHOOK_SECRET
R2_ACCOUNT_ID · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · R2_BUCKET
TURNSTILE_SECRET · NEXT_PUBLIC_TURNSTILE_SITE_KEY · SENTRY_DSN
WRITES_ENABLED=true · APP_URL
```

## Conventions
- Build order for any feature: core types/logic + tests → db → worker/API → UI.
- Route handler: parse (Zod) → authorize → service in `lib/` → typed JSON; errors `{error:{code,message}}`.
- Fix lifecycle transitions only through `packages/core/lifecycle.ts` (`transition(fix, event)`), which writes the audit log.
- UI: Server Components by default; loading/empty/error states on every async view; status always icon + text, never color alone; use the `frontend-design` skill.
- Tests next to code. Scanner and verifier tests run against `fixtures/sites`.

## Done means
`pnpm typecheck && pnpm lint && pnpm test` pass, new behavior has tests, you summarize what changed and exactly how I verify it by hand.