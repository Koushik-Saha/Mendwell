import { describe, expect, it } from "vitest";
import { greet } from "./hello-world";

describe("greet", () => {
  it("greets the world by default", () => {
    expect(greet({})).toBe("Hello, world!");
    expect(greet({ name: "  " })).toBe("Hello, world!");
  });

  it("greets by name", () => {
    expect(greet({ name: "Mendwell" })).toBe("Hello, Mendwell!");
  });
});
