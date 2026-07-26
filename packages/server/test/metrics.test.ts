import { describe, expect, it } from "bun:test";
import { classifyWindow, parseConnectedDevices, parseFrameCosts, parseThirdPartyPackages, percentile } from "../src/metrics";

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

  it("keeps only authorized ADB devices and formats models", () => {
    const output = "List of devices attached\nemulator-5554 device product:sdk model:Pixel_8 device:emu\n192.168.1.9:5555 offline\n";
    expect(parseConnectedDevices(output)).toEqual([{ id: "emulator-5554", model: "Pixel 8" }]);
  });

  it("parses and sorts third-party package names", () => {
    expect(parseThirdPartyPackages("package:com.zeta.app\npackage:com.alpha.app\ninvalid package\n")).toEqual([
      "com.alpha.app",
      "com.zeta.app",
    ]);
  });
});
