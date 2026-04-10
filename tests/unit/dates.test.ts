import { describe, it, expect } from "vitest";
import {
  checkDateFreshness,
  extractDateHint,
  formatDateForDisplay,
} from "../../src/lib.js";

describe("checkDateFreshness", () => {
  it("returns fresh for recent dates", () => {
    const result = checkDateFreshness("2025-06-15");
    expect(result.isFresh).toBe(true);
    expect(result.warning).toBe("");
  });

  it("returns fresh for undefined date", () => {
    const result = checkDateFreshness(undefined);
    expect(result.isFresh).toBe(true);
  });

  it("returns fresh for invalid date string", () => {
    const result = checkDateFreshness("not-a-date");
    expect(result.isFresh).toBe(true);
  });

  it("returns stale for old dates", () => {
    const result = checkDateFreshness("2020-01-01", 24);
    expect(result.isFresh).toBe(false);
    expect(result.warning).toContain("OLD");
  });

  it("respects custom maxAgeMonths", () => {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    expect(checkDateFreshness(oneYearAgo.toISOString(), 6).isFresh).toBe(false);
    expect(checkDateFreshness(oneYearAgo.toISOString(), 24).isFresh).toBe(true);
  });

  it("includes age in months in warning", () => {
    const result = checkDateFreshness("2020-01-01", 12);
    if (!result.isFresh) {
      expect(result.warning).toMatch(/\d+ months ago/);
    }
  });

  it("handles edge case: exactly at boundary", () => {
    const exactlyMax = new Date();
    exactlyMax.setMonth(exactlyMax.getMonth() - 24);
    const result = checkDateFreshness(exactlyMax.toISOString(), 24);
    expect(result.isFresh).toBe(true);
  });

  it("handles ISO date strings", () => {
    expect(checkDateFreshness("2026-01-25T10:30:00.000Z", 12).isFresh).toBe(true);
    expect(checkDateFreshness("2019-06-15T00:00:00Z", 12).isFresh).toBe(false);
  });
});

describe("extractDateHint", () => {
  it("extracts ISO date (YYYY-MM-DD)", () => {
    expect(extractDateHint("Published on 2024-06-15 by author")).toBe("2024-06-15");
  });

  it("extracts US date (MM/DD/YYYY)", () => {
    expect(extractDateHint("Updated 06/15/2024")).toBe("06/15/2024");
  });

  it("extracts month name date", () => {
    expect(extractDateHint("Published January 15, 2024")).toBe("January 15, 2024");
    expect(extractDateHint("Published Jun 5, 2024")).toBe("Jun 5, 2024");
  });

  it("extracts relative dates as ISO string", () => {
    const result = extractDateHint("5 days ago");
    expect(result).toBeDefined();
    const date = new Date(result!);
    expect(date.getTime()).not.toBeNaN();
  });

  it("extracts 'yesterday'", () => {
    const result = extractDateHint("Updated yesterday");
    expect(result).toBeDefined();
    const date = new Date(result!);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(date.toDateString()).toBe(yesterday.toDateString());
  });

  it("handles 'N hours ago'", () => {
    const result = extractDateHint("3 hours ago");
    expect(result).toBeDefined();
  });

  it("handles 'N weeks ago'", () => {
    const result = extractDateHint("2 weeks ago");
    expect(result).toBeDefined();
  });

  it("handles 'N months ago'", () => {
    const result = extractDateHint("6 months ago");
    expect(result).toBeDefined();
  });

  it("handles 'N years ago'", () => {
    const result = extractDateHint("2 years ago");
    expect(result).toBeDefined();
  });

  it("returns undefined for text without dates", () => {
    expect(extractDateHint("This is just some random text")).toBeUndefined();
    expect(extractDateHint("")).toBeUndefined();
  });

  it("handles zero-width characters in text", () => {
    expect(extractDateHint("Published\u200b2024-06-15")).toBe("2024-06-15");
  });
});

describe("formatDateForDisplay", () => {
  it("formats ISO date to locale string", () => {
    const result = formatDateForDisplay("2024-06-15");
    expect(result).toMatch(/2024/);
    expect(result).toMatch(/6/);
  });

  it("returns original string for invalid dates", () => {
    expect(formatDateForDisplay("not-a-date")).toBe("not-a-date");
  });

  it("handles ISO datetime strings", () => {
    const result = formatDateForDisplay("2024-06-15T10:30:00.000Z");
    expect(result).toMatch(/2024/);
  });
});
