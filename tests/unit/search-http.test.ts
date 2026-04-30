import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { collectWebSearchResults, formatWebSearchResults, enrichResultsWithLlms } from "../../src/search.js";

vi.mock("../../src/browser.js", () => ({
  browserManager: {
    openPage: vi.fn().mockRejectedValue(new Error("Playwright not available in test")),
    closeContext: vi.fn().mockResolvedValue(undefined),
    createContext: vi.fn().mockRejectedValue(new Error("Playwright not available in test")),
  },
}));

const MOCK_YAHOO_HTML = `
<div class="compTitle options-toggle">
  <h3 class="title"><a href="https://react.dev/learn">React – A JavaScript Library</a></h3>
</div>
<div class="compText">React lets you build user interfaces out of individual pieces</div>
<div class="compTitle options-toggle">
  <h3 class="title"><a href="https://react.dev/reference">React API Reference</a></h3>
</div>
<div class="compText">The React reference documentation</div>
<div class="compTitle options-toggle">
  <h3 class="title"><a href="https://react.dev/tutorial">React Tutorial</a></h3>
</div>
<div class="compText">Learn React step by step</div>
<div class="compTitle options-toggle">
  <h3 class="title"><a href="https://react.dev/blog">React Blog</a></h3>
</div>
<div class="compText">Official React blog</div>
<div class="compTitle options-toggle">
  <h3 class="title"><a href="https://react.dev/community">React Community</a></h3>
</div>
<div class="compText">Join the React community</div>
`;

const MOCK_DDG_HTML = `
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Freact.dev%2Flearn">React Learn</a>
<a class="result__snippet">React documentation for learning</a>
`;

describe("collectWebSearchResults — HTTP-first flow", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(responses: Record<string, { ok: boolean; text: () => Promise<string> }>) {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      for (const [pattern, response] of Object.entries(responses)) {
        if (urlStr.includes(pattern)) return response as Response;
      }
      return { ok: false, text: async () => "" } as unknown as Response;
    }) as typeof fetch;
  }

  it("uses HTTP fetch for Yahoo without launching browser", async () => {
    mockFetch({
      "search.yahoo.com": {
        ok: true,
        text: async () => MOCK_YAHOO_HTML,
      },
    });

    const { results, attempts } = await collectWebSearchResults("react", "yahoo");

    expect(attempts.length).toBeGreaterThanOrEqual(1);
    expect(attempts[0].engine).toBe("yahoo");
    expect(attempts[0].status).toBe("ok");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].title).toContain("React");
  });

  it("uses HTTP fetch for all engines in auto mode and returns early with enough results", async () => {
    mockFetch({
      "search.yahoo.com": {
        ok: true,
        text: async () => MOCK_YAHOO_HTML,
      },
    });

    const { results, attempts } = await collectWebSearchResults("react", "auto");

    expect(attempts.some((a) => a.engine === "yahoo" && a.status === "ok")).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("marks engine as empty/blocked when HTTP fetch returns empty HTML and browser unavailable", async () => {
    mockFetch({
      "search.yahoo.com": { ok: true, text: async () => "<html><body>nothing</body></html>" },
      "search.marginalia.nu": { ok: true, text: async () => "<html><body>nothing</body></html>" },
      "html.duckduckgo.com": { ok: true, text: async () => "<html><body>nothing</body></html>" },
      "www.ask.com": { ok: true, text: async () => "<html><body>nothing</body></html>" },
    });

    const { attempts } = await collectWebSearchResults("react", "yahoo");

    expect(attempts.some((a) => a.status === "empty" || a.status === "blocked")).toBe(true);
  });

  it("uses DDG HTML fetch via HTTP", async () => {
    mockFetch({
      "html.duckduckgo.com": {
        ok: true,
        text: async () => MOCK_DDG_HTML,
      },
    });

    const { results, attempts } = await collectWebSearchResults("react", "duckduckgo");

    expect(attempts[0].engine).toBe("duckduckgo");
    expect(attempts[0].status).toBe("ok");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].url).toContain("react.dev");
  });

  it("stops early when enough results found via HTTP", async () => {
    const yahooResults = Array.from({ length: 10 }, (_, i) => `
      <div class="compTitle options-toggle">
        <h3 class="title"><a href="https://example${i}.com/result${i}">Result ${i}</a></h3>
      </div>
      <div class="compText">Snippet for result ${i}</div>
    `).join("\n");

    mockFetch({
      "search.yahoo.com": {
        ok: true,
        text: async () => yahooResults,
      },
    });

    const { results, attempts } = await collectWebSearchResults("test", "auto", undefined, 5);

    expect(results.length).toBeLessThanOrEqual(10);
    expect(attempts.some((a) => a.engine === "yahoo")).toBe(true);
  });

  it("applies domain filter in HTTP queries", async () => {
    const capturedUrls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      capturedUrls.push(urlStr);
      return { ok: true, text: async () => MOCK_YAHOO_HTML } as unknown as Response;
    }) as typeof fetch;

    await collectWebSearchResults("hooks", "yahoo", "react.dev");

    expect(capturedUrls.length).toBeGreaterThanOrEqual(1);
    expect(capturedUrls[0]).toContain("site%3Areact.dev");
  });

  it("returns empty results when all HTTP fetches fail", async () => {
    mockFetch({
      "search.yahoo.com": { ok: false, text: async () => "" },
    });

    const { results, attempts } = await collectWebSearchResults("obscure-query-xyz-12345", "yahoo");

    expect(results.length).toBe(0);
    expect(attempts.length).toBeGreaterThanOrEqual(1);
  });
});

describe("formatWebSearchResults", () => {
  it("formats results with engine info", () => {
    const results = [
      {
        title: "React",
        url: "https://react.dev",
        snippet: "A JavaScript library",
        engine: "yahoo" as const,
        host: "react.dev",
        score: 50,
      },
    ];
    const formatted = formatWebSearchResults("react", results, [{ engine: "yahoo", status: "ok", count: 1 }], 5);
    expect(formatted).toContain("# Web Search: \"react\"");
    expect(formatted).toContain("React");
    expect(formatted).toContain("https://react.dev");
    expect(formatted).toContain("yahoo:1");
  });

  it("includes domain filter in header", () => {
    const formatted = formatWebSearchResults("test", [], [], 5, "react.dev");
    expect(formatted).toContain("Domain: react.dev");
  });

  it("shows date and freshness warning", () => {
    const results = [
      {
        title: "Old Article",
        url: "https://example.com",
        snippet: "An old article",
        engine: "yahoo" as const,
        host: "example.com",
        score: 30,
        publishedDate: "2020-01-01",
        freshnessWarning: "⚠️ OLD: 76 months ago",
      },
    ];
    const formatted = formatWebSearchResults("test", results, [], 5);
    expect(formatted).toContain("OLD");
  });
});

describe("enrichResultsWithLlms", () => {
  it("returns original results when no llms found", async () => {
    const results = [
      {
        title: "Test",
        url: "https://example.com",
        snippet: "test snippet",
        engine: "yahoo" as const,
        host: "example.com",
        score: 50,
      },
    ];
    const enriched = await enrichResultsWithLlms(results, 1);
    expect(enriched).toHaveLength(1);
    expect(enriched[0].llms).toBeUndefined();
  });
});
