import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { axeImageAlt } from "./axe";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(() => browser?.close());

describe("axeImageAlt", () => {
  it("checks only the given elements, counting passes and violations", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html lang="en"><body>
      <img class="wp-image-1" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="A van">
      <img class="wp-image-1" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="A van">
      <img class="wp-image-2" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
      <img class="other" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
    </body></html>`);
    expect(await axeImageAlt(page, [".wp-image-1"])).toEqual({ violations: 0, checked: 2 });
    expect(await axeImageAlt(page, [".wp-image-1", ".wp-image-2"])).toEqual({ violations: 1, checked: 3 });
    expect(await axeImageAlt(page, [".missing"])).toEqual({ violations: 0, checked: 0 });
    await context.close();
  });
});
