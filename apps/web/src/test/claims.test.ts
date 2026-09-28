import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BANNED_CLAIMS } from "../../scripts/banned-claims.mjs";

/**
 * Hard rule 9 / SECURITY.md §5: no compliance claims anywhere a customer can read them.
 * This checks the source of every page, component, email template and piece of report copy.
 * `pnpm --filter @mendwell/web check:claims` checks the built pages too.
 */
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const DIRS = ["apps/web/src", "packages/email/src", "packages/core/src"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(tsx?|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("no compliance claims in customer-facing copy", () => {
  it.each(DIRS)("%s", (dir) => {
    const hits = files(join(ROOT, dir)).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return BANNED_CLAIMS.filter((re) => re.test(text)).map((re) => `${file.replace(ROOT, "")}: ${re.source}`);
    });
    expect(hits).toEqual([]);
  });

  it("the required disclaimer itself passes", () => {
    const disclaimer = "Mendwell fixes common issues and verifies each fix. It does not certify ADA/WCAG compliance.";
    expect(BANNED_CLAIMS.filter((re) => re.test(disclaimer))).toEqual([]);
  });
});
