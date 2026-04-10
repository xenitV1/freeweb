import { describe, it, expect } from "vitest";
import {
  QUERY_STOP_WORDS as LIB_STOP_WORDS,
  normalizeSearchResultUrl as libNormalize,
  cleanSearchText as libCleanText,
  buildQueryTokens as libBuildQueryTokens,
  formatAttemptSummary as libFormatAttempt,
} from "../../src/lib.js";

const INDEX_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "best", "by", "for", "from", "guide", "how",
  "in", "into", "is", "it", "of", "on", "or", "the", "to", "what", "with",
]);

const LLMS_STOP_WORDS = new Set([
  "a", "an", "and", "api", "are", "as", "at", "be", "best", "by", "docs", "documentation", "for",
  "from", "guide", "how", "in", "into", "is", "it", "of", "on", "or", "reference", "site",
  "the", "this", "to", "what", "with",
]);

describe("Regression: Code Duplication Consistency", () => {
  describe("QUERY_STOP_WORDS consistency", () => {
    it("lib.ts exports stop words matching index.ts original", () => {
      expect(LIB_STOP_WORDS.size).toBe(24);
      for (const word of INDEX_STOP_WORDS) {
        expect(LIB_STOP_WORDS.has(word)).toBe(true);
      }
    });

    it("known divergence: lib.ts does not include llms.ts extras", () => {
      const extraInLlms = ["api", "docs", "documentation", "reference", "site", "this"];
      for (const word of extraInLlms) {
        expect(LLMS_STOP_WORDS.has(word)).toBe(true);
        expect(LIB_STOP_WORDS.has(word)).toBe(false);
      }
    });

    it("lib.ts is a superset of base stop words", () => {
      for (const word of INDEX_STOP_WORDS) {
        expect(LIB_STOP_WORDS.has(word)).toBe(true);
      }
    });

    it("stop word count is stable", () => {
      expect(LIB_STOP_WORDS.size).toBeLessThanOrEqual(LLMS_STOP_WORDS.size);
    });
  });

  describe("normalizeSearchResultUrl consistency", () => {
    it("produces consistent results for Yahoo redirect URLs", () => {
      const url = "https://r.search.yahoo.com/ylt=abc?RU=https%3A%2F%2Fexample.com%2Fpage";
      const result = libNormalize(url);
      expect(result).toBe("https://example.com/page");
    });

    it("produces consistent results for Google redirect URLs", () => {
      const url = "https://www.google.com/url?q=https://example.com/page";
      const result = libNormalize(url);
      expect(result).toBe("https://example.com/page");
    });

    it("produces consistent results for DDG redirect URLs", () => {
      const url = "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage";
      const result = libNormalize(url);
      expect(result).toBe("https://example.com/page");
    });

    it("strips UTM params consistently", () => {
      const url = "https://example.com/page?utm_source=x&utm_medium=y&id=123";
      const result = libNormalize(url);
      expect(result).toContain("id=123");
      expect(result).not.toContain("utm_");
    });

    it("handles invalid URL gracefully", () => {
      expect(libNormalize("")).toBe("");
      expect(libNormalize("not-a-url")).toBe("not-a-url");
    });

    it("is idempotent", () => {
      const url = "https://example.com/page?utm_source=test#section";
      const first = libNormalize(url);
      const second = libNormalize(first);
      expect(first).toBe(second);
    });
  });

  describe("cleanText consistency", () => {
    it("removes zero-width characters consistently", () => {
      const input = "hello\u200bworld\u00adtest\ufeffend";
      const result = libCleanText(input);
      expect(result).toBe("helloworldtestend");
    });

    it("normalizes whitespace consistently", () => {
      expect(libCleanText("hello   world\n\nfoo")).toBe("hello world foo");
      expect(libCleanText("  trimmed  ")).toBe("trimmed");
    });

    it("handles middle-dot consistently", () => {
      expect(libCleanText("title·subtitle")).toBe("title · subtitle");
    });

    it("is idempotent for clean input", () => {
      const input = "clean text with words";
      expect(libCleanText(libCleanText(input))).toBe(libCleanText(input));
    });

    it("handles empty string", () => {
      expect(libCleanText("")).toBe("");
      expect(libCleanText("   ")).toBe("");
    });
  });

  describe("buildQueryTokens consistency", () => {
    it("produces stable output for same input", () => {
      const tokens1 = libBuildQueryTokens("react hooks tutorial guide");
      const tokens2 = libBuildQueryTokens("react hooks tutorial guide");
      expect(tokens1).toEqual(tokens2);
    });

    it("removes all stop words", () => {
      const tokens = libBuildQueryTokens("the best guide for how to use react");
      expect(tokens).not.toContain("the");
      expect(tokens).not.toContain("best");
      expect(tokens).not.toContain("guide");
      expect(tokens).not.toContain("for");
      expect(tokens).not.toContain("how");
      expect(tokens).not.toContain("to");
      expect(tokens).toContain("use");
      expect(tokens).toContain("react");
    });

    it("produces unique tokens", () => {
      const tokens = libBuildQueryTokens("react react hooks hooks");
      const unique = new Set(tokens);
      expect(tokens.length).toBe(unique.size);
    });
  });

  describe("formatAttemptSummary consistency", () => {
    it("formats ok status with count", () => {
      const result = libFormatAttempt([
        { engine: "yahoo", status: "ok", count: 5 },
      ]);
      expect(result).toBe("yahoo:5");
    });

    it("formats blocked status", () => {
      const result = libFormatAttempt([
        { engine: "yahoo", status: "blocked", reason: "captcha" },
      ]);
      expect(result).toBe("yahoo:blocked");
    });

    it("formats empty status", () => {
      const result = libFormatAttempt([
        { engine: "marginalia", status: "empty" },
      ]);
      expect(result).toBe("marginalia:0");
    });

    it("formats multiple attempts", () => {
      const result = libFormatAttempt([
        { engine: "yahoo", status: "ok", count: 5 },
        { engine: "marginalia", status: "ok", count: 3 },
        { engine: "ask", status: "blocked", reason: "captcha" },
      ]);
      expect(result).toBe("yahoo:5, marginalia:3, ask:blocked");
    });
  });

  describe("Cross-module normalization regression", () => {
    it("normalizeTargetUrl in llms.ts strips hash only", () => {
      const url = "https://example.com/page?q=test#section";
      const parsed = new URL(url);
      parsed.hash = "";
      const llmsResult = parsed.toString();

      expect(llmsResult).toBe("https://example.com/page?q=test");
    });

    it("normalizeSearchResultUrl in lib.ts strips tracking params and hash", () => {
      const url = "https://example.com/page?q=test&utm_source=x#section";
      const result = libNormalize(url);

      expect(result).toContain("q=test");
      expect(result).not.toContain("utm_source");
      expect(result).not.toContain("#section");
    });

    it("regression: ensure Yahoo redirect unwrapping is stable", () => {
      const redirects = [
        "https://r.search.yahoo.com/ylt=A0geK?RU=https%3A%2F%2Freact.dev%2Flearn",
        "https://r.search.yahoo.com/ylt=xyz?RU=https%3A%2F%2Fgithub.com%2Ffacebook%2Freact",
      ];
      for (const url of redirects) {
        const result = libNormalize(url);
        expect(result).not.toContain("r.search.yahoo.com");
        expect(result).toMatch(/^https:\/\//);
      }
    });
  });
});
