#!/usr/bin/env node
// Builds the connector plugin zip into public/downloads/ so onboarding can offer it.
// Production builds bake APP_URL (https) into the plugin; development keeps the plugin default.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const plugin = resolve(import.meta.dirname, "../../../plugins/mendwell-connector");
const appUrl = process.env.APP_URL && /^https:\/\//.test(process.env.APP_URL) ? new URL(process.env.APP_URL).origin : undefined;
execFileSync(process.execPath, [join(plugin, "bin/build-zip.mjs")], { stdio: "inherit", env: { ...process.env, APP_URL: appUrl ?? "" } });
const zip = readdirSync(join(plugin, "dist")).find((f) => /^mendwell-connector-.+\.zip$/.test(f));
if (!zip) throw new Error("plugin zip was not built");
const out = resolve(import.meta.dirname, "../public/downloads");
mkdirSync(out, { recursive: true });
copyFileSync(join(plugin, "dist", zip), join(out, "mendwell-connector.zip"));
console.log(`public/downloads/mendwell-connector.zip (${zip})`);
