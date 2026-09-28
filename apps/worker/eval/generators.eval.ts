import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { createAnthropicClient, generateAltText, generateMeta, type ModelClient, type Usage } from "@mendwell/generators";
import { createSafeFetch } from "@mendwell/scanner";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { loadImageForModel } from "../src/lib/image";
import { readPageContext } from "../src/lib/page-context";
import { altCases, images, metaCases, UNSAFE } from "./cases";

/** ANTHROPIC_API_KEY and model names from the environment, or apps/worker/.env, or apps/web/.env.local. */
function env(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  for (const file of ["../.env", "../../web/.env.local"]) {
    const path = fileURLToPath(new URL(file, import.meta.url));
    if (!existsSync(path)) continue;
    const line = readFileSync(path, "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
    const value = line?.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, "");
    if (value) return value;
  }
  return undefined;
}

const apiKey = env("ANTHROPIC_API_KEY");
const visionModel = env("AI_MODEL_VISION") ?? "claude-sonnet-5";
const textModel = env("AI_MODEL_TEXT") ?? "claude-sonnet-5";

/** Without a key the harness still runs end to end, with a placeholder model, so it can't rot. */
const placeholder: ModelClient = async (r) => {
  const required = (r.tool.inputSchema.required as string[] | undefined) ?? [];
  const meta = { title: "Placeholder title for eval", description: `Placeholder description ${"x".repeat(110)}` };
  return {
    toolInput: r.tool.name === "submit_meta" ? Object.fromEntries(required.map((k) => [k, meta[k as keyof typeof meta]])) : { decorative: false, alt: "Placeholder alt text" },
    inputTokens: 0,
    outputTokens: 0,
  };
};

it("generator eval", { timeout: 15 * 60_000 }, async () => {
  const client = apiKey ? createAnthropicClient({ apiKey }) : placeholder;
  const server = createServer((req, res) => {
    const path = req.url ?? "/";
    const img = images[path.replace(/^\/img\//, "")];
    if (img) return res.writeHead(200, { "content-type": "image/svg+xml" }).end(img);
    const alt = altCases.find((c) => path === `/alt/${c.id}/`);
    const meta = metaCases.find((c) => path === `/meta/${c.id}/`);
    const html = alt?.page ?? meta?.page;
    return html ? res.writeHead(200, { "content-type": "text/html" }).end(html) : res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const safeFetch = createSafeFetch({ userAgent: "MendwellBot/eval", testAllow: { addresses: ["127.0.0.1"], ports: [port] } });
  const browser = await chromium.launch();

  const rows: string[] = [];
  const usage: Usage[] = [];
  let passed = 0;
  let total = 0;
  const unsafe: string[] = [];

  try {
    for (const c of altCases) {
      total++;
      const url = `${base}/alt/${c.id}/`;
      const page = await readPageContext(browser, safeFetch, url, { selectors: [c.selector], linkTargets: [], userAgent: "MendwellBot/eval" });
      const image = page?.images[c.selector];
      const loaded = image?.src ? await loadImageForModel(safeFetch, browser, image.src) : null;
      if (!page || !image || !loaded) {
        rows.push(`| alt | ${c.id} | harness error | | |`);
        continue;
      }
      const result = await generateAltText(
        { image: loaded, pageTitle: page.title, heading: image.heading, caption: image.caption, surroundingText: image.surroundingText, fileName: image.fileName, link: image.link },
        { client, model: visionModel },
      );
      usage.push(...result.usage);
      const output = result.ok ? (result.value.decorative ? '(decorative: alt="")' : result.value.alt) : `REJECTED ${result.reason}: ${result.errors.map((e) => e.code).join(", ")}`;
      if (result.ok) passed++;
      if (result.ok && c.adversarial && UNSAFE.test(result.value.alt)) unsafe.push(`${c.id}: ${result.value.alt}`);
      const note = c.expect === "decorative" ? (result.ok && result.value.decorative ? "decorative ✓" : "expected decorative ✗") : c.adversarial ? "adversarial" : (c.expect ?? "");
      rows.push(`| alt | ${c.id} | ${output.replace(/\|/g, "\\|")} | ${result.attempts} | ${note} |`);
    }

    for (const c of metaCases) {
      total++;
      const url = `${base}/meta/${c.id}/`;
      const page = await readPageContext(browser, safeFetch, url, { selectors: [], linkTargets: [], userAgent: "MendwellBot/eval" });
      if (!page) {
        rows.push(`| meta | ${c.id} | harness error | | |`);
        continue;
      }
      const result = await generateMeta(
        { pageText: page.mainText, h1: page.h1, siteName: page.siteName, currentTitle: page.title, currentDescription: page.metaDescription, needs: c.needs },
        { client, model: textModel },
      );
      usage.push(...result.usage);
      const output = result.ok
        ? [result.value.title && `TITLE (${result.value.title.length}): ${result.value.title}`, result.value.description && `DESC (${result.value.description.length}): ${result.value.description}`].filter(Boolean).join("<br>")
        : `REJECTED ${result.reason}: ${result.errors.map((e) => e.code).join(", ")}`;
      if (result.ok) passed++;
      if (result.ok && c.adversarial && UNSAFE.test(`${result.value.title ?? ""} ${result.value.description ?? ""}`)) unsafe.push(`${c.id}: ${output}`);
      rows.push(`| meta | ${c.id} | ${output.replace(/\|/g, "\\|")} | ${result.attempts} | ${c.adversarial ? "adversarial" : ""} |`);
    }
  } finally {
    await browser.close();
    server.close();
  }

  const cost = usage.reduce((s, u) => s + u.costUsd, 0);
  process.stdout.write(
    [
      "",
      apiKey ? `Models: vision ${visionModel}, text ${textModel}` : "ANTHROPIC_API_KEY is not set: ran with a placeholder model to check the harness only.",
      "",
      "| kind | case | output | attempts | note |",
      "|---|---|---|---|---|",
      ...rows,
      "",
      `Validator pass rate: ${passed}/${total} (${Math.round((passed / total) * 100)}%). Model calls: ${usage.length}. Cost: $${cost.toFixed(4)}${apiKey ? "" : " (placeholder)"}.`,
      unsafe.length ? `UNSAFE OUTPUTS:\n${unsafe.join("\n")}` : "Adversarial cases: no injected content reached an accepted output.",
      "",
    ].join("\n") + "\n",
  );
  expect(unsafe).toEqual([]);
  expect(rows.filter((r) => r.includes("harness error"))).toEqual([]);
});
