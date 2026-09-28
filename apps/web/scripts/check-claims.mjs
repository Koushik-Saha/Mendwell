// Greps the built app (.next) for banned claims: every prerendered page, RSC payload and client
// chunk. Run after `next build`:  pnpm --filter @mendwell/web check:claims
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BANNED_CLAIMS } from "./banned-claims.mjs";

const roots = [".next/server/app", ".next/static/chunks"];
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(html|rsc|body|js|json)$/.test(name) ? [path] : [];
  });

let files = [];
for (const root of roots) {
  try {
    files = files.concat(walk(root));
  } catch {
    console.error(`${root} not found: run next build first`);
    process.exit(2);
  }
}
const hits = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const re of BANNED_CLAIMS) {
    const m = re.exec(text);
    if (m) hits.push(`${file}: "${text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).replace(/\s+/g, " ")}"`);
  }
}
if (hits.length) {
  console.error(`Banned claims found in the build (SECURITY.md §5):\n${hits.join("\n")}`);
  process.exit(1);
}
console.log(`No banned claims in ${files.length} built files.`);
