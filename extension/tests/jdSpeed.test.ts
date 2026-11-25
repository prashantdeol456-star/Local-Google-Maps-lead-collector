import { describe, expect, it } from "vitest";
import { between, clampSpeed, JD_PACES, paceOf } from "../src/utils/jdSpeed";

describe("Justdial speed slider", () => {
  it("keeps the value between 1 (slow) and 5 (fast), default Slow", () => {
    expect(clampSpeed(0)).toBe(1);
    expect(clampSpeed(9)).toBe(5);
    expect(clampSpeed("3")).toBe(3);
    expect(clampSpeed(undefined)).toBe(2);
    expect(paceOf(undefined).label).toBe("Slow");
  });

  it("gets calmer at every step towards Slow", () => {
    for (let s = 1; s < 5; s++) {
      const slower = JD_PACES[s as 1 | 2 | 3 | 4];
      const faster = JD_PACES[(s + 1) as 2 | 3 | 4 | 5];
      expect(slower.stepPause[0]).toBeGreaterThan(faster.stepPause[0]);
      expect(slower.afterLoad[0]).toBeGreaterThan(faster.afterLoad[0]);
      expect(slower.profileDelay).toBeGreaterThan(faster.profileDelay);
      expect(slower.step).toBeLessThan(faster.step);
    }
    const t = between([1000, 2000]);
    expect(t).toBeGreaterThanOrEqual(1000);
    expect(t).toBeLessThanOrEqual(2000);
  });
});
