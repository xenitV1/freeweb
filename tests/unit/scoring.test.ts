import { describe, it, expect } from "vitest";
import {
  buildQueryTokens,
  countQueryHits,
  getDomainScore,
  scoreSearchResult,
  mergeSearchResults,
  cleanSearchText,
  cleanSearchSnippet,
  buildWebSearchUrl,
  getWebSearchOrder,
} from "../../src/lib.js";
import type { WebSearchEngine } from "../../src/lib.js";

describe("buildQueryTokens", () => {
  it("tokenizes simple queries", () => {
    const tokens = buildQueryTokens("react hooks tutorial");
    expect(tokens).toContain("react");
    expect(tokens).toContain("hooks");
    expect(tokens).toContain("tutorial");
  });

  it("removes stop words", () => {
    const tokens = buildQueryTokens("how to use the best guide for react");
    expect(tokens).not.toContain("how");
    expect(tokens).not.toContain("to");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("best");
    expect(tokens).not.toContain("guide");
    expect(tokens).not.toContain("for");
    expect(tokens).toContain("use");
    expect(tokens).toContain("react");
  });

  it("removes single-character tokens", () => {
    const tokens = buildQueryTokens("a b c react");
    expect(tokens).toContain("react");
    expect(tokens).not.toContain("a");
    expect(tokens).not.toContain("b");
    expect(tokens).not.toContain("c");
  });

  it("deduplicates tokens", () => {
    const tokens = buildQueryTokens("react react react");
    expect(tokens.filter((t) => t === "react")).toHaveLength(1);
  });

  it("preserves some special chars in tokens", () => {
    const tokens = buildQueryTokens("c# f#.net c++ type-check");
    expect(tokens).toContain("c#");
    expect(tokens).toContain("f#.net");
    expect(tokens).toContain("c++");
    expect(tokens).toContain("type-check");
  });

  it("BUG: f# and .net are not separate tokens when combined", () => {
    const tokens = buildQueryTokens("f#.net");
    expect(tokens).toContain("f#.net");
    expect(tokens).not.toContain("f#");
    expect(tokens).not.toContain(".net");
  });

  it("returns lowercase tokens", () => {
    const tokens = buildQueryTokens("React HOOKS TypeScript");
    for (const t of tokens) {
      expect(t).toBe(t.toLowerCase());
    }
  });

  it("returns empty for stop-words-only query", () => {
    const tokens = buildQueryTokens("a the how to in is it of on or");
    expect(tokens).toHaveLength(0);
  });
});

describe("countQueryHits", () => {
  it("counts substring matches", () => {
    expect(countQueryHits("react hooks guide", ["react", "hooks"])).toBe(2);
    expect(countQueryHits("react tutorial", ["react", "hooks"])).toBe(1);
  });

  it("is case insensitive", () => {
    expect(countQueryHits("REACT HOOKS", ["react", "hooks"])).toBe(2);
    expect(countQueryHits("React Hooks Guide", ["react", "hooks"])).toBe(2);
  });

  it("returns 0 for no matches", () => {
    expect(countQueryHits("completely unrelated text", ["react", "hooks"])).toBe(0);
  });

  it("returns 0 for empty tokens", () => {
    expect(countQueryHits("react hooks", [])).toBe(0);
  });
});

describe("getDomainScore", () => {
  it("gives high score to trusted domains", () => {
    const score = getDomainScore("developer.mozilla.org");
    expect(score).toBeGreaterThanOrEqual(12);
  });

  it("gives bonus for .gov and .edu", () => {
    const govScore = getDomainScore("data.gov");
    const eduScore = getDomainScore("mit.edu");
    expect(govScore).toBeGreaterThanOrEqual(6);
    expect(eduScore).toBeGreaterThanOrEqual(6);
  });

  it("gives bonus for .org", () => {
    const score = getDomainScore("example.org");
    expect(score).toBeGreaterThanOrEqual(3);
  });

  it("gives bonus for docs subdomain", () => {
    const score = getDomainScore("docs.example.com");
    expect(score).toBeGreaterThanOrEqual(5);
  });

  it("gives bonus for developer subdomain", () => {
    const score = getDomainScore("developer.example.com");
    expect(score).toBeGreaterThanOrEqual(5);
  });

  it("penalizes low-quality domains", () => {
    const score = getDomainScore("consumersearch.com");
    expect(score).toBe(-14);
  });

  it("gives small score for neutral domains with 'blog' keyword", () => {
    const score = getDomainScore("random-blog.com");
    expect(score).toBe(1);
  });

  it("gives small bonus for blog in domain", () => {
    const score = getDomainScore("blog.example.com");
    expect(score).toBeGreaterThanOrEqual(1);
  });
});

describe("scoreSearchResult", () => {
  const baseResult = {
    title: "React Hooks Guide",
    url: "https://react.dev/learn/hooks",
    snippet: "A comprehensive guide to React hooks including useState and useEffect",
    host: "react.dev",
    engine: "yahoo" as WebSearchEngine,
  };

  it("gives higher score to Yahoo results (engine weight)", () => {
    const yahooScore = scoreSearchResult("react hooks", { ...baseResult, engine: "yahoo" });
    const marginaliaScore = scoreSearchResult("react hooks", { ...baseResult, engine: "marginalia" });
    const askScore = scoreSearchResult("react hooks", { ...baseResult, engine: "ask" });
    expect(yahooScore.score).toBeGreaterThan(marginaliaScore.score);
    expect(marginaliaScore.score).toBeGreaterThan(askScore.score);
  });

  it("rewards title matches heavily", () => {
    const goodTitle = scoreSearchResult("react hooks", { ...baseResult, title: "React Hooks Complete Guide" });
    const badTitle = scoreSearchResult("react hooks", { ...baseResult, title: "Cooking Recipes Blog" });
    expect(goodTitle.score).toBeGreaterThan(badTitle.score);
  });

  it("rewards snippet matches", () => {
    const goodSnippet = scoreSearchResult("react hooks", { ...baseResult, snippet: "react hooks tutorial guide" });
    const badSnippet = scoreSearchResult("react hooks", { ...baseResult, snippet: "cooking recipes for dinner" });
    expect(goodSnippet.score).toBeGreaterThan(badSnippet.score);
  });

  it("rewards trusted domains", () => {
    const trusted = scoreSearchResult("react", { ...baseResult, host: "react.dev" });
    const untrusted = scoreSearchResult("react", { ...baseResult, host: "random-site.xyz" });
    expect(trusted.score).toBeGreaterThan(untrusted.score);
  });

  it("penalizes low-quality domains", () => {
    const low = scoreSearchResult("best product", { ...baseResult, host: "consumersearch.com", snippet: "best product review" });
    const neutral = scoreSearchResult("best product", { ...baseResult, host: "example.com", snippet: "best product review" });
    expect(low.score).toBeLessThan(neutral.score);
  });

  it("rewards domain filter matches", () => {
    const withFilter = scoreSearchResult("react hooks", baseResult, "react.dev");
    const withoutFilter = scoreSearchResult("react hooks", baseResult);
    expect(withFilter.score).toBeGreaterThan(withoutFilter.score);
    expect(withFilter.score - withoutFilter.score).toBe(25);
  });

  it("rewards doc-related keywords", () => {
    const docResult = scoreSearchResult("react", {
      ...baseResult,
      title: "React Official Documentation",
      snippet: "The official reference guide for React",
    });
    const nonDocResult = scoreSearchResult("react", {
      ...baseResult,
      title: "React Memes",
      snippet: "Funny memes about React framework",
    });
    expect(docResult.score).toBeGreaterThan(nonDocResult.score);
  });
});

describe("mergeSearchResults", () => {
  it("returns incoming when no existing", () => {
    const incoming = { title: "Test", url: "https://a.com", snippet: "s", engine: "yahoo" as WebSearchEngine, host: "a.com", score: 50 };
    expect(mergeSearchResults(undefined, incoming)).toBe(incoming);
  });

  it("keeps higher score winner", () => {
    const existing = { title: "A", url: "https://a.com", snippet: "s1", engine: "yahoo" as WebSearchEngine, host: "a.com", score: 100 };
    const incoming = { title: "B", url: "https://a.com", snippet: "s2", engine: "marginalia" as WebSearchEngine, host: "a.com", score: 50 };
    const merged = mergeSearchResults(existing, incoming);
    expect(merged.title).toBe("A");
    expect(merged.score).toBe(100);
  });

  it("fills missing snippet from loser", () => {
    const existing = { title: "A", url: "https://a.com", snippet: "", engine: "yahoo" as WebSearchEngine, host: "a.com", score: 100 };
    const incoming = { title: "B", url: "https://a.com", snippet: "useful snippet", engine: "marginalia" as WebSearchEngine, host: "a.com", score: 50 };
    const merged = mergeSearchResults(existing, incoming);
    expect(merged.snippet).toBe("useful snippet");
  });
});

describe("cleanSearchText", () => {
  it("removes zero-width characters (replaces with nothing, not space)", () => {
    expect(cleanSearchText("hello\u200bworld")).toBe("helloworld");
    expect(cleanSearchText("test\u00ading")).toBe("testing");
    expect(cleanSearchText("foo\ufeffbar")).toBe("foobar");
  });

  it("normalizes whitespace", () => {
    expect(cleanSearchText("hello   world\n\nfoo")).toBe("hello world foo");
  });

  it("preserves middle dots with spaces", () => {
    expect(cleanSearchText("title·subtitle")).toBe("title · subtitle");
  });

  it("trims whitespace", () => {
    expect(cleanSearchText("  hello  ")).toBe("hello");
  });
});

describe("cleanSearchSnippet", () => {
  it("removes leading title from snippet", () => {
    expect(cleanSearchSnippet("React Hooks Guide - A comprehensive tutorial", "React Hooks Guide"))
      .toBe("A comprehensive tutorial");
  });

  it("removes 'N more' prefix", () => {
    expect(cleanSearchSnippet("5 more results about react", "React"))
      .toBe("results about react");
  });

  it("handles empty snippet", () => {
    expect(cleanSearchSnippet("", "Title")).toBe("");
  });
});

describe("buildWebSearchUrl", () => {
  it("builds Yahoo search URL", () => {
    const url = buildWebSearchUrl("react hooks", "yahoo");
    expect(url).toContain("search.yahoo.com/search");
    expect(url).toContain("p=react+hooks");
  });

  it("builds Marginalia search URL", () => {
    const url = buildWebSearchUrl("react hooks", "marginalia");
    expect(url).toContain("search.marginalia.nu/search");
    expect(url).toContain("query=react+hooks");
  });

  it("builds Ask search URL", () => {
    const url = buildWebSearchUrl("react hooks", "ask");
    expect(url).toContain("ask.com/web");
    expect(url).toContain("q=react+hooks");
  });

  it("prepends site: filter when domain specified", () => {
    const url = buildWebSearchUrl("hooks", "yahoo", "react.dev");
    expect(url).toContain("site%3Areact.dev+hooks");
  });

  it("does not double site: prefix", () => {
    const url = buildWebSearchUrl("site:react.dev hooks", "yahoo", "react.dev");
    expect(url).not.toContain("site%3Areact.dev+site");
  });
});

describe("getWebSearchOrder", () => {
  it("returns all engines in auto mode", () => {
    const order = getWebSearchOrder("auto");
    expect(order).toEqual(["yahoo", "marginalia", "ask"]);
  });

  it("puts specified engine first in specific mode", () => {
    const order = getWebSearchOrder("marginalia");
    expect(order[0]).toBe("marginalia");
    expect(order).toHaveLength(3);
  });
});
