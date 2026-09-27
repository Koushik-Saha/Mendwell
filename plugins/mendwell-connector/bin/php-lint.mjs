#!/usr/bin/env node
// php -l every shipped PHP file (host PHP). The PHP 7.4 compatibility check runs in wp-env.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const files = ["mendwell-connector.php", "uninstall.php", ...readdirSync(join(root, "includes")).map((f) => join("includes", f)), ...readdirSync(join(root, "tests")).filter((f) => f.endsWith(".php")).map((f) => join("tests", f))];
for (const file of files) execFileSync("php", ["-l", join(root, file)], { stdio: "pipe" });
console.log(`php -l OK (${files.length} files)`);
