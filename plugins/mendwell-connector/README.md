# mendwell-connector

The WordPress plugin that is the only way Mendwell changes a site (PROJECT_SPEC §8, SECURITY.md T2/T3). PHP 7.4+, WordPress 6.2+, no third-party PHP code at runtime.

## What it can do

| Route (`/wp-json/mendwell/v1/…`) | Does |
|---|---|
| `GET status` | Unsigned: plugin name + pairing challenge only. Signed: versions, SEO/cache plugins, WooCommerce page IDs, paused flag. |
| `GET media/{id}/usage` | Published posts showing an image. |
| `GET resolve-path?path=` | Old slug → Redirection plugin → one matching slug; otherwise candidates for a human. |
| `POST fix/alt` | Media alt text, plus `core/image` blocks and classic `<img>` in published posts. |
| `POST fix/meta` | Yoast, Rank Math or SEOPress fields; our own meta (printed in `<head>`) only when no SEO plugin is active. Refuses other SEO plugins. |
| `POST fix/link` | Replace an `href` in a post (`wp_update_post`, so a revision is kept). |
| `POST undo/{fixId}` | Restore before-values, only if every field still holds what we wrote; otherwise `409`, nothing touched. |
| `POST cache/purge` | Best effort: WP Rocket, W3TC, LiteSpeed, WP Super Cache, SiteGround, Breeze. Same-site URLs only. |
| `POST pause` / `resume` | Kill switch (also in Settings → Mendwell). |

Every write: refuses while paused (`423`), checks `expectedCurrent` (`409` on mismatch), logs before/after in `{prefix}mendwell_log`, sanitizes input to plain text. It never touches files, SQL, users, plugins, themes or settings.

## Security

- **Signing.** `hex(hmac_sha256(secret, METHOD \n PATH \n TIMESTAMP \n NONCE \n hex(sha256(body))))`. PATH is the REST route plus the sorted query string. ±300 s window; nonces cached 10 minutes (transients); `hash_equals`; HTTPS only (`MENDWELL_ALLOW_HTTP` for local development). A bad signature never consumes a nonce. `tests/vectors/signing.json` is shared with `packages/core`, so both sides sign identically.
- **Secret at rest.** libsodium secretbox, keyed from the WordPress salts; `wp_options`, autoload off. Changing the salts means pairing again.
- **Admin screen.** Nonce + `manage_options` on every action; every value escaped; only fixed notice messages.
- **Saving posts.** Mendwell's requests have no logged-in user, so kses is suspended for our own save only (restored afterwards). We only change one escaped attribute; the rest of the post stays exactly as the owner wrote it.

## Develop and test

Needs Docker (Colima works).

```
pnpm --filter mendwell-connector wp-env start      # WordPress 6.2 on PHP 7.4 (the minimum we support)
pnpm test:connector                                 # PHPUnit in the tests container
pnpm --filter mendwell-connector lint:php
APP_URL=https://app.example.com pnpm --filter mendwell-connector build   # dist/mendwell-connector-<version>.zip
```

The zip contains only the plugin (no tests, vendor or tooling). `APP_URL` is baked in; `MENDWELL_APP_URL` in `wp-config.php` overrides it.
