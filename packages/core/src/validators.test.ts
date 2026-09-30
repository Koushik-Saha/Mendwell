import { describe, expect, it } from "vitest";
import { validateAltText, validateMetaDescription, validateMetaTitle } from "./validators";

const ctx = { contextText: "Emergency plumbing in Leeds. Our van is stocked for same-day repairs. Photo: Maria fixing a boiler.", fileName: "IMG_2041.jpg" };
const codes = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code);

describe("validateAltText", () => {
  it("accepts a plain description", () => {
    expect(validateAltText("A white plumbing van parked outside a terraced house", ctx)).toEqual({ ok: true, errors: [] });
    expect(validateAltText("Maria repairing a wall-mounted boiler", ctx).ok).toBe(true); // name is in the context
  });

  it.each([
    ["Van", "length"],
    ["x".repeat(126), "length"],
    ["Image of a white van", "image_of"],
    ["A photo of a white van", "image_of"],
    ["Simple graphic of a grey mug", "image_of"],
    ["IMG_2041.jpg showing a van", "file_name"],
    ["A <b>white</b> van", "html"],
    ["A white van &amp; driver", "html"],
    ["Visit plumber.com for a white van", "url"],
    ["A van, see https://evil.test", "url"],
    ["Plumber van plumber plumber boiler plumber", "stuffing"],
    ["A white van with a BRIGHT logo", "caps"],
    ["John Smith driving a white van", "name"],
    ["A white van parked near Buckingham Palace", "name"],
    ["An ADA compliant ramp", "claim"],
    ["A van\nwith a ladder", "control"],
  ])("rejects %j (%s)", (value, code) => {
    const result = validateAltText(value, ctx);
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain(code);
  });

  it("lets through acronyms the page uses", () => {
    expect(validateAltText("HVAC technician checking a unit", { contextText: "Our HVAC team" }).ok).toBe(true);
  });

  it("explains every problem in a message the model can act on", () => {
    const result = validateAltText("Image of John at IMG_2041.jpg", ctx);
    expect(result.errors.every((e) => e.message.length > 10)).toBe(true);
    expect(codes(result)).toEqual(expect.arrayContaining(["image_of", "file_name", "name"]));
  });
});

const page = "Hartley Plumbing has fixed boilers in Leeds since 1998. Same-day callouts, fixed prices from £65, and Gas Safe registered engineers. Free quotes for bathroom installs.";

describe("validateMetaTitle", () => {
  it("accepts a plain title and enforces 10–60 characters", () => {
    expect(validateMetaTitle("Boiler repair in Leeds | Hartley Plumbing", page).ok).toBe(true);
    expect(codes(validateMetaTitle("Boilers", page))).toContain("length");
    expect(codes(validateMetaTitle("Boiler repair, servicing and bathroom installs in Leeds by Hartley", page))).toContain("length");
  });

  it("rejects clickbait, caps and claims not on the page", () => {
    expect(codes(validateMetaTitle("Boiler repair in Leeds!", page))).toContain("clickbait");
    expect(codes(validateMetaTitle("BEST boiler repair in Leeds", page))).toEqual(expect.arrayContaining(["caps", "claim"]));
    expect(codes(validateMetaTitle("Leeds' #1 boiler repair team", page))).toContain("claim");
    expect(codes(validateMetaTitle("Boiler repair since 1985 in Leeds", page))).toContain("claim");
    expect(validateMetaTitle("Boiler repair in Leeds since 1998", page).ok).toBe(true);
    expect(validateMetaTitle("Free quotes for bathroom installs in Leeds", page).ok).toBe(true);
    expect(codes(validateMetaTitle("Guaranteed boiler repair in Leeds", page))).toContain("claim");
  });
});

describe("validateMetaDescription", () => {
  const good = "Hartley Plumbing repairs boilers across Leeds with same-day callouts, fixed prices from £65 and Gas Safe registered engineers since 1998.";

  it("accepts 120–155 plain characters", () => {
    expect(good.length).toBeGreaterThanOrEqual(120);
    expect(validateMetaDescription(good, page)).toEqual({ ok: true, errors: [] });
  });

  it("rejects too short, too long, URLs and invented numbers", () => {
    expect(codes(validateMetaDescription("Boiler repair in Leeds.", page))).toContain("length");
    expect(codes(validateMetaDescription(`${good} ${good}`, page))).toContain("length");
    expect(codes(validateMetaDescription(good.replace("£65", "£45"), page))).toContain("claim");
    expect(codes(validateMetaDescription(good.replace("Leeds", "hartley.co.uk"), page))).toContain("url");
  });
});
