import { describe, expect, it } from "bun:test";
import { classifyWindow, parseFrameCosts, percentile } from "../src/metrics";

describe("performance metrics", () => {
  it("parses valid gfxinfo profile rows", () => {
    const raw = "Profile data in ms:\nDraw Prepare Process Execute\n1 2 3 4\n5 6 7 8\n\n";
    expect(parseFrameCosts(raw)).toEqual([10, 26]);
  });

  it("calculates upper percentiles from sorted copies", () => {
    expect(percentile([20, 10, 40, 30], 0.95)).toBe(40);
  });

  it("prioritizes frozen frames over jank rate", () => {
    expect(classifyWindow(2, 1)).toBe("critical");
    expect(classifyWindow(8, 0)).toBe("high");
    expect(classifyWindow(3, 0)).toBe("medium");
    expect(classifyWindow(1, 0)).toBe("normal");
  });
});
