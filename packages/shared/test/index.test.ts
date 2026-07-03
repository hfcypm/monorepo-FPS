import { describe, expect, it } from "bun:test";
import { greet, add } from "../src/index";

describe("shared", () => {
  it("greet should return greeting", () => {
    expect(greet("World")).toBe("Hello, World!");
  });

  it("add should sum numbers", () => {
    expect(add(1, 2)).toBe(3);
  });
});
