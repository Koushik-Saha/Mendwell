import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// Read DATABASE_URL from packages/db/.env, falling back to the web app's .env.local.
for (const file of [".env", "../../apps/web/.env.local"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

// Neon: prefer the direct (unpooled) URL for migrations if you have one.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
