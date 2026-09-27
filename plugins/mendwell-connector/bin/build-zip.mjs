#!/usr/bin/env node
// Builds dist/mendwell-connector-<version>.zip containing only what ships: no tests, no dev tooling.
//   APP_URL=https://app.example.com pnpm --filter mendwell-connector build
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { zipFolder } from "./zip.mjs";

const root = resolve(import.meta.dirname, "..");
const main = readFileSync(join(root, "mendwell-connector.php"), "utf8");
const version = /^\s*\*\s*Version:\s*(\S+)/m.exec(main)?.[1];
const constant = /define\( 'MENDWELL_CONNECTOR_VERSION', '([^']+)' \)/.exec(main)?.[1];
const stable = /^Stable tag:\s*(\S+)/m.exec(readFileSync(join(root, "readme.txt"), "utf8"))?.[1];
if (!version || version !== constant || version !== stable) {
  console.error(`Version mismatch: header ${version}, constant ${constant}, readme stable tag ${stable}`);
  process.exit(1);
}

const appUrl = process.env.APP_URL || undefined;
if (appUrl && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(appUrl)) {
  console.error("APP_URL must be an https origin like https://app.example.com (no path)");
  process.exit(1);
}

const SHIP = ["mendwell-connector.php", "uninstall.php", "readme.txt", "includes"];
const stage = mkdtempSync(join(tmpdir(), "mendwell-zip-"));
const pluginDir = join(stage, "mendwell-connector");
mkdirSync(pluginDir);
for (const entry of SHIP) cpSync(join(root, entry), join(pluginDir, entry), { recursive: true });

if (appUrl) {
  const file = join(pluginDir, "mendwell-connector.php");
  const source = readFileSync(file, "utf8");
  const replaced = source.replace(/'http:\/\/localhost:3000'(\s*\);\s*\/\/ @mendwell-build:app-url)/, `'${appUrl}'$1`);
  if (replaced === source) throw new Error("app URL marker not found");
  writeFileSync(file, replaced);
} else {
  console.warn("APP_URL not set: the zip will pair with http://localhost:3000 (development only).");
}

const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });
const zip = join(dist, `mendwell-connector-${version}.zip`);
if (existsSync(zip)) rmSync(zip);
zipFolder(pluginDir, zip);
rmSync(stage, { recursive: true, force: true });
console.log(`Built ${zip}`);
