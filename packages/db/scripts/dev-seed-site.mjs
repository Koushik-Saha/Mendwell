#!/usr/bin/env node
// DEVELOPMENT ONLY. Adds an ownership-verified site to your workspace so you can try scans
// before connector pairing (the real ownership check, SECURITY.md T5) exists.
//
//   pnpm --filter @mendwell/db seed:site --email you@example.com --url https://your-site.example [--name "My site"] [--timezone Europe/London]
//
// Uses DATABASE_URL from packages/db/.env or apps/web/.env.local. Refuses NODE_ENV=production.
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { Pool } from "@neondatabase/serverless";

for (const file of [".env", "../../apps/web/.env.local"]) if (existsSync(file)) process.loadEnvFile(file);

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run: this script is for development only.");
  process.exit(1);
}

const { values } = parseArgs({
  options: { email: { type: "string" }, url: { type: "string" }, name: { type: "string" }, timezone: { type: "string", default: "UTC" } },
});
if (!values.email || !values.url) {
  console.error("Usage: pnpm --filter @mendwell/db seed:site --email <your sign-in email> --url https://site.example [--name ...] [--timezone ...]");
  process.exit(1);
}

let url;
try {
  url = new URL(values.url);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
} catch {
  console.error("--url must be an http(s) URL");
  process.exit(1);
}
try {
  new Intl.DateTimeFormat("en-US", { timeZone: values.timezone });
} catch {
  console.error("--timezone must be an IANA zone like Europe/London");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const { rows: orgs } = await pool.query(
    `select m.org_id from memberships m join users u on u.id = m.user_id
      where lower(u.email) = lower($1) and m.role in ('owner', 'admin') order by m.created_at limit 1`,
    [values.email],
  );
  if (!orgs[0]) {
    console.error("No workspace found where that email is an owner or admin. Sign in and create one first.");
    process.exit(1);
  }
  const { rows } = await pool.query(
    `insert into sites (org_id, url, name, timezone, ownership_verified_at)
       values ($1, $2, $3, $4, now())
     on conflict (org_id, url) do update set ownership_verified_at = now(), status = 'active', timezone = excluded.timezone
     returning id`,
    [orgs[0].org_id, url.toString(), values.name ?? url.hostname, values.timezone],
  );
  console.log(`Site ready (verified for development): ${url.toString()}`);
  console.log(`Open: ${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/sites/${rows[0].id}`);
} finally {
  await pool.end();
}
