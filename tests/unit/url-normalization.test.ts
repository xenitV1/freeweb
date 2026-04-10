import { describe, it, expect } from "vitest";
import {
  normalizeSearchResultUrl,
  normalizeComparableUrl,
  isSameSiteUrl,
  deriveRouteTargetUrl,
  normalizeDomainFilter,
  domainMatches,
  isInternalSearchEngineUrl,
} from "../../src/lib.js";

describe("normalizeSearchResultUrl", () => {
  it("unwraps Yahoo redirect URLs with RU parameter in search", () => {
    const yahooRedirect = "https://r.search.yahoo.com/ylt=A0geK?RU=https%3A%2F%2Freact.dev%2Flearn";
    const result = normalizeSearchResultUrl(yahooRedirect);
    expect(result).toBe("https://react.dev/learn");
  });

  it("does not unwrap Yahoo redirect URLs without RU param (different format)", () => {
    const yahooRedirect = "https://r.search.yahoo.com/ylt=A0geK;_ylu=X3oDM/RU=https%3A%2F%2Freact.dev%2Flearn";
    const result = normalizeSearchResultUrl(yahooRedirect);
    expect(result).toBe(yahooRedirect);
  });

  it("unwraps Google redirect URLs", () => {
    const googleRedirect = "https://www.google.com/url?q=https://example.com/page";
    const result = normalizeSearchResultUrl(googleRedirect);
    expect(result).toBe("https://example.com/page");
  });

  it("unwraps DuckDuckGo redirect URLs", () => {
    const ddgRedirect = "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage";
    const result = normalizeSearchResultUrl(ddgRedirect);
    expect(result).toBe("https://example.com/page");
  });

  it("strips UTM parameters", () => {
    const url = "https://example.com/page?utm_source=twitter&utm_medium=social&utm_campaign=launch&ref=abc";
    const result = normalizeSearchResultUrl(url);
    expect(result).toBe("https://example.com/page");
  });

  it("strips Yahoo tracking params", () => {
    const url = "https://example.com/page?fr=yfp-t-702&fr2=piv-web";
    const result = normalizeSearchResultUrl(url);
    expect(result).toBe("https://example.com/page");
  });

  it("strips hash fragments", () => {
    const url = "https://example.com/page#section-1";
    const result = normalizeSearchResultUrl(url);
    expect(result).toBe("https://example.com/page");
  });

  it("preserves non-tracking query params", () => {
    const url = "https://example.com/search?q=react&page=2";
    const result = normalizeSearchResultUrl(url);
    expect(result).toContain("q=react");
    expect(result).toContain("page=2");
  });

  it("handles invalid URLs gracefully", () => {
    expect(normalizeSearchResultUrl("not-a-url")).toBe("not-a-url");
    expect(normalizeSearchResultUrl("")).toBe("");
  });
});

describe("normalizeComparableUrl", () => {
  it("strips hash fragments", () => {
    expect(normalizeComparableUrl("https://example.com/page#section"))
      .toBe("https://example.com/page");
  });

  it("preserves query parameters", () => {
    expect(normalizeComparableUrl("https://example.com/page?q=test"))
      .toBe("https://example.com/page?q=test");
  });
});

describe("isSameSiteUrl", () => {
  it("returns true for same domain", () => {
    expect(isSameSiteUrl("https://example.com/page1", "https://example.com/page2")).toBe(true);
  });

  it("returns true for www vs non-www", () => {
    expect(isSameSiteUrl("https://www.example.com/page1", "https://example.com/page2")).toBe(true);
    expect(isSameSiteUrl("https://example.com/page1", "https://www.example.com/page2")).toBe(true);
  });

  it("returns true for subdomain matches", () => {
    expect(isSameSiteUrl("https://docs.example.com/api", "https://example.com/overview")).toBe(true);
    expect(isSameSiteUrl("https://example.com/overview", "https://docs.example.com/api")).toBe(true);
  });

  it("returns false for different domains", () => {
    expect(isSameSiteUrl("https://example.com", "https://other.com")).toBe(false);
    expect(isSameSiteUrl("https://docs.example.com", "https://docs.other.com")).toBe(false);
  });

  it("returns false for invalid URLs", () => {
    expect(isSameSiteUrl("not-a-url", "https://example.com")).toBe(false);
    expect(isSameSiteUrl("https://example.com", "not-a-url")).toBe(false);
  });
});

describe("deriveRouteTargetUrl", () => {
  it("strips .md extension", () => {
    expect(deriveRouteTargetUrl("https://example.com/docs/guide.md"))
      .toBe("https://example.com/docs/guide");
  });

  it("strips .html.md extension to .html", () => {
    expect(deriveRouteTargetUrl("https://example.com/docs/guide.html.md"))
      .toBe("https://example.com/docs/guide.html");
  });

  it("preserves non-md URLs", () => {
    expect(deriveRouteTargetUrl("https://example.com/docs/guide.html"))
      .toBe("https://example.com/docs/guide.html");
    expect(deriveRouteTargetUrl("https://example.com/docs/guide"))
      .toBe("https://example.com/docs/guide");
  });
});

describe("normalizeDomainFilter", () => {
  it("strips protocol and www", () => {
    expect(normalizeDomainFilter("https://www.example.com")).toBe("example.com");
    expect(normalizeDomainFilter("http://example.com")).toBe("example.com");
    expect(normalizeDomainFilter("www.example.com")).toBe("example.com");
  });

  it("strips paths", () => {
    expect(normalizeDomainFilter("example.com/path/to/page")).toBe("example.com");
  });

  it("returns undefined for empty/invalid input", () => {
    expect(normalizeDomainFilter(undefined)).toBe(undefined);
    expect(normalizeDomainFilter("")).toBe(undefined);
    expect(normalizeDomainFilter("   ")).toBe(undefined);
    expect(normalizeDomainFilter("www.")).toBe(undefined);
  });
});

describe("domainMatches", () => {
  it("matches exact domain", () => {
    expect(domainMatches("example.com", "example.com")).toBe(true);
  });

  it("matches subdomain", () => {
    expect(domainMatches("docs.example.com", "example.com")).toBe(true);
    expect(domainMatches("deep.sub.example.com", "example.com")).toBe(true);
  });

  it("returns false for different domains", () => {
    expect(domainMatches("example.com", "other.com")).toBe(false);
    expect(domainMatches("notexample.com", "example.com")).toBe(false);
  });

  it("BUG: partial string match allows notexample.com to match example.com", () => {
    expect(domainMatches("notexample.com", "example.com")).toBe(false);
    expect(domainMatches("myexample.com", "example.com")).toBe(false);
  });

  it("returns false for undefined domain", () => {
    expect(domainMatches("example.com", undefined)).toBe(false);
  });
});

describe("isInternalSearchEngineUrl", () => {
  it("detects Yahoo search URLs", () => {
    expect(isInternalSearchEngineUrl("https://search.yahoo.com/search?p=test")).toBe(true);
  });

  it("detects Ask.com search URLs", () => {
    expect(isInternalSearchEngineUrl("https://www.ask.com/web?q=test")).toBe(true);
    expect(isInternalSearchEngineUrl("https://ask.com/web?q=test")).toBe(true);
  });

  it("detects Marginalia search URLs", () => {
    expect(isInternalSearchEngineUrl("https://search.marginalia.nu/search?query=test")).toBe(true);
  });

  it("does not flag non-search URLs", () => {
    expect(isInternalSearchEngineUrl("https://example.com/page")).toBe(false);
    expect(isInternalSearchEngineUrl("https://search.yahoo.com/something")).toBe(false);
  });

  it("returns true for invalid URLs (safe default)", () => {
    expect(isInternalSearchEngineUrl("not-a-url")).toBe(true);
  });
});
