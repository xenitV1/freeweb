import { describe, it, expect } from "vitest";
import { QUERY_STOP_WORDS as INDEX_STOP_WORDS, buildQueryTokens as indexBuildQueryTokens } from "../../src/lib.js";

const QUERY_STOP_WORDS_LLM = new Set([
  "a", "an", "and", "api", "are", "as", "at", "be", "best", "by", "docs", "documentation", "for",
  "from", "guide", "how", "in", "into", "is", "it", "of", "on", "or", "reference", "site",
  "the", "this", "to", "what", "with",
]);

function llmsBuildQueryTokens(query: string): string[] {
  return Array.from(new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9.#+-]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length > 1 && !QUERY_STOP_WORDS_LLM.has(token))
  ));
}

describe("Code Duplication Verification", () => {
  describe("BUG: QUERY_STOP_WORDS divergence between index.ts and llms.ts", () => {
    it("lib.ts (from index.ts) has 24 stop words", () => {
      expect(INDEX_STOP_WORDS.size).toBe(24);
    });

    it("llms.ts has 30 stop words", () => {
      expect(QUERY_STOP_WORDS_LLM.size).toBe(30);
    });

    it("llms.ts has extra stop words that index.ts lacks", () => {
      const indexSet = INDEX_STOP_WORDS;
      const llmsSet = QUERY_STOP_WORDS_LLM;

      const extraInLlms = new Set([...llmsSet].filter((w) => !indexSet.has(w)));
      expect([...extraInLlms].sort()).toEqual(["api", "docs", "documentation", "reference", "site", "this"].sort());
    });

    it("BUG: 'api' is stop word in llms.ts but not in index.ts/lib.ts", () => {
      expect(QUERY_STOP_WORDS_LLM.has("api")).toBe(true);
      expect(INDEX_STOP_WORDS.has("api")).toBe(false);
    });

    it("BUG: 'docs' is stop word in llms.ts but not in index.ts/lib.ts", () => {
      expect(QUERY_STOP_WORDS_LLM.has("docs")).toBe(true);
      expect(INDEX_STOP_WORDS.has("docs")).toBe(false);
    });

    it("BUG: 'reference' is stop word in llms.ts but not in index.ts/lib.ts", () => {
      expect(QUERY_STOP_WORDS_LLM.has("reference")).toBe(true);
      expect(INDEX_STOP_WORDS.has("reference")).toBe(false);
    });

    it("BUG: produces different tokens for same query", () => {
      const indexTokens = indexBuildQueryTokens("api reference docs documentation");
      const llmsTokens = llmsBuildQueryTokens("api reference docs documentation");

      expect(indexTokens.sort()).toEqual(["api", "docs", "documentation", "reference"].sort());
      expect(llmsTokens.sort()).toEqual([]);
    });

    it("BUG: scoring and llms routing use different tokenization", () => {
      const query = "rest api reference guide";
      const indexTokens = indexBuildQueryTokens(query);
      const llmsTokens = llmsBuildQueryTokens(query);

      expect(indexTokens).toContain("api");
      expect(indexTokens).toContain("reference");
      expect(llmsTokens).not.toContain("api");
      expect(llmsTokens).not.toContain("reference");
    });
  });

  describe("BUG: normalizeTargetUrl behavior differs between markdown.ts and llms.ts", () => {
    it("markdown.ts strips search params, llms.ts does not", () => {
      const testUrl = "https://example.com/page?q=test#section";

      const markdownResult = (() => {
        const parsed = new URL(testUrl);
        parsed.hash = "";
        parsed.search = "";
        return parsed.toString();
      })();

      const llmsResult = (() => {
        const parsed = new URL(testUrl);
        parsed.hash = "";
        return parsed.toString();
      })();

      expect(markdownResult).toBe("https://example.com/page");
      expect(llmsResult).toBe("https://example.com/page?q=test");
      expect(markdownResult).not.toBe(llmsResult);
    });

    it("BUG: same URL produces different cache keys in different modules", () => {
      const url = "https://example.com/docs?q=react#intro";

      const markdownCacheKey = (() => {
        const parsed = new URL(url);
        parsed.hash = "";
        parsed.search = "";
        return parsed.toString();
      })();

      const llmsCacheKey = (() => {
        const parsed = new URL(url);
        parsed.hash = "";
        return parsed.toString();
      })();

      expect(markdownCacheKey).not.toBe(llmsCacheKey);
    });
  });

  describe("cleanText implementations differ", () => {
    it("index.ts cleanSearchText replaces zero-width chars (no space added)", () => {
      const input = "hello\u200bworld";
      const indexResult = input
        .replace(/[\u00ad\u200b-\u200f\u2060\ufeff]/g, "")
        .replace(/\s+/g, " ")
        .replace(/\s*·\s*/g, " · ")
        .trim();
      expect(indexResult).toBe("helloworld");
    });

    it("llms.ts/markdown.ts cleanText also replaces zero-width chars (identical)", () => {
      const input = "hello\u200bworld";
      const llmsResult = input
        .replace(/[\u00ad\u200b-\u200f\u2060\ufeff]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      expect(llmsResult).toBe("helloworld");
    });

    it("index.ts adds middle-dot spacing that llms.ts does not", () => {
      const input = "title·subtitle";
      const indexResult = input.replace(/\s*·\s*/g, " · ").trim();
      const llmsResult = input.trim();
      expect(indexResult).toBe("title · subtitle");
      expect(llmsResult).toBe("title·subtitle");
    });
  });
});
