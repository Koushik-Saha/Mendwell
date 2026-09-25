import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("@mendwell/generators", () => {
  it("is wired into the workspace", () => {
    expect(PACKAGE_NAME).toBe("@mendwell/generators");
  });
});
