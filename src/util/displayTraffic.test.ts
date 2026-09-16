import { describe, expect, test } from "bun:test";
import {
  calculateDisplayedTraffic,
  DISPLAY_TRAFFIC_FLOOR_GB,
  formatDisplayedTrafficGB,
} from "./displayTraffic";

const PLANS: Array<[purchased: number, limit: number]> = [
  [10, 8],
  [20, 17],
  [30, 27],
  [50, 47],
  [100, 95],
];

describe("calculateDisplayedTraffic", () => {
  test("floor constant is 5 GB", () => {
    expect(DISPLAY_TRAFFIC_FLOOR_GB).toBe(5);
  });

  for (const [purchased, limit] of PLANS) {
    test(`${purchased} -> ${limit}: initial state shows purchased amount`, () => {
      expect(calculateDisplayedTraffic(purchased, limit, limit)).toBeCloseTo(
        purchased,
        9,
      );
    });

    test(`${purchased} -> ${limit}: 75% remaining stays smooth`, () => {
      const remaining = limit * 0.75;
      const displayed = calculateDisplayedTraffic(purchased, limit, remaining);
      expect(displayed).toBeGreaterThan(remaining);
      expect(displayed).toBeLessThanOrEqual(purchased);
    });

    test(`${purchased} -> ${limit}: 50% remaining keeps decreasing`, () => {
      const r75 = limit * 0.75;
      const r50 = limit * 0.5;
      const d75 = calculateDisplayedTraffic(purchased, limit, r75);
      const d50 = calculateDisplayedTraffic(purchased, limit, r50);
      expect(d50).toBeGreaterThanOrEqual(r50);
      expect(d50).toBeLessThanOrEqual(purchased);
      expect(d50).toBeLessThan(d75);
    });

    test(`${purchased} -> ${limit}: exactly 5 GB passes through`, () => {
      expect(calculateDisplayedTraffic(purchased, limit, 5)).toBe(5);
    });

    test(`${purchased} -> ${limit}: below 5 GB passes through`, () => {
      for (const r of [4.999, 2.5, 0.5]) {
        expect(calculateDisplayedTraffic(purchased, limit, r)).toBe(r);
      }
    });

    test(`${purchased} -> ${limit}: 0 GB shows 0`, () => {
      expect(calculateDisplayedTraffic(purchased, limit, 0)).toBe(0);
    });

    test(`${purchased} -> ${limit}: decimals stay bounded`, () => {
      const remaining = limit - 0.123;
      const displayed = calculateDisplayedTraffic(
        purchased,
        limit,
        remaining,
      );
      expect(displayed).toBeGreaterThan(remaining);
      expect(displayed).toBeLessThanOrEqual(purchased);
    });

    test(`${purchased} -> ${limit}: 0.25 GB sweep is monotonic with no jumps`, () => {
      let prev = Infinity;
      let maxStep = 0;
      for (
        let r = limit;
        r >= 0;
        r = Math.round((r - 0.25) * 1e9) / 1e9
      ) {
        const d = calculateDisplayedTraffic(purchased, limit, r);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(purchased);
        expect(d).toBeLessThanOrEqual(prev + 1e-9);
        if (prev !== Infinity) maxStep = Math.max(maxStep, prev - d);
        prev = d;
      }
      expect(maxStep).toBeLessThan(1);
    });
  }

  test("10 -> 8 walk-through converges smoothly toward 5", () => {
    const d7 = calculateDisplayedTraffic(10, 8, 7);
    const d6 = calculateDisplayedTraffic(10, 8, 6);
    expect(d7).toBeGreaterThan(7);
    expect(d7).toBeLessThanOrEqual(10);
    expect(d6).toBeGreaterThan(6);
    expect(d6).toBeLessThan(d7);
    expect(calculateDisplayedTraffic(10, 8, 5)).toBe(5);
  });

  test("invalid / edge-case inputs never return NaN or out-of-range values", () => {
    expect(calculateDisplayedTraffic(10, 8, -3)).toBe(0);
    expect(calculateDisplayedTraffic(10, 8, 10)).toBe(10);
    expect(calculateDisplayedTraffic(10, 8, NaN)).toBe(0);
    expect(calculateDisplayedTraffic(10, 8, Infinity)).toBe(0);
    expect(calculateDisplayedTraffic(0, 0, 0)).toBe(0);
    expect(calculateDisplayedTraffic(-5, 8, 4)).toBe(0);
    expect(calculateDisplayedTraffic(6, 4, 3)).toBe(3);
    expect(calculateDisplayedTraffic(8, 10, 7)).toBe(7);
  });
});

describe("formatDisplayedTrafficGB", () => {
  test("rounds to 2 decimals for display only", () => {
    expect(formatDisplayedTrafficGB(7.846)).toBe("7.85");
    expect(formatDisplayedTrafficGB(5.034)).toBe("5.03");
    expect(formatDisplayedTrafficGB(10)).toBe("10");
  });
});
