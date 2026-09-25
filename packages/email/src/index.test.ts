import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("@mendwell/email", () => {
  it("is wired into the workspace", () => {
    expect(PACKAGE_NAME).toBe("@mendwell/email");
  });
});
