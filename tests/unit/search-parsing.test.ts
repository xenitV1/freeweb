import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { parseSearchResults } from "../../src/utils.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

function createPage(html: string) {
  const dom = new JSDOM(html, { url: "https://search.yahoo.com/search?p=test", runScripts: "dangerously" });
  const window = dom.window;
  return {
    content: () => Promise.resolve(html),
    url: () => "https://search.yahoo.com/search?p=test",
    evaluate: (fn: Function) => {
      return Promise.resolve(window.eval(`(${fn.toString()})()`));
    },
  } as any;
}

function loadFixture(name: string): string {
  return readFileSync(join(__dirname, "fixtures", name), "utf-8");
}

describe("parseSearchResults", () => {
  describe("Yahoo search results", () => {
    it("parses Yahoo results from realistic HTML", async () => {
      const html = loadFixture("search-yahoo.html");
      const page = createPage(html);
      const results = await parseSearchResults(page);

      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0].title).toBeTruthy();
      expect(results[0].url).toBeTruthy();
    });

    it("extracts title from Yahoo results", async () => {
      const html = loadFixture("search-yahoo.html");
      const page = createPage(html);
      const results = await parseSearchResults(page);

      const titles = results.map((r) => r.title);
      expect(titles.some((t) => t.toLowerCase().includes("react"))).toBe(true);
    });

    it("extracts URLs from Yahoo results", async () => {
      const html = loadFixture("search-yahoo.html");
      const page = createPage(html);
      const results = await parseSearchResults(page);

      for (const r of results) {
        expect(r.url).toMatch(/^https?:\/\//);
      }
    });

    it("extracts snippets from Yahoo results", async () => {
      const html = loadFixture("search-yahoo.html");
      const page = createPage(html);
      const results = await parseSearchResults(page);

      expect(results.some((r) => r.snippet.length > 0)).toBe(true);
    });

    it("cleans whitespace from title and snippet", async () => {
      const html = `
        <html><body>
          <div class="compTitle options-toggle">
            <h3><a href="https://example.com">  Whitespace   Title  </a></h3>
          </div>
          <div class="compText"><p>  Extra   spaces   in  snippet  </p></div>
        </body></html>
      `;
      const page = createPage(html);
      const results = await parseSearchResults(page);

      expect(results.length).toBeGreaterThanOrEqual(1);
      for (const r of results) {
        expect(r.title).not.toMatch(/^\s/);
        expect(r.title).not.toMatch(/\s$/);
      }
    });
  });

  describe("Marginalia search results", () => {
    it("parses Marginalia results from realistic HTML", async () => {
      const html = `
        <html><body>
          <div class="flex flex-col grow">
            <h2><a href="https://react.dev/learn/hooks">React Hooks Guide</a></h2>
            <p class="mt-2">A comprehensive guide to React hooks</p>
          </div>
          <div class="flex flex-col grow">
            <h2><a href="https://example.com/hooks">Another Result</a></h2>
            <p class="mt-2">Another snippet about hooks</p>
          </div>
        </body></html>
      `;
      const page = createPage(html);
      const results = await parseSearchResults(page);

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].title).toBeTruthy();
      expect(results[0].url).toContain("react.dev");
    });

    it("extracts title, URL, and snippet from Marginalia", async () => {
      const html = `
        <html><body>
          <div class="flex flex-col grow">
            <h2><a href="https://example.com/page">Example Title</a></h2>
            <p class="mt-2">Example snippet text here</p>
          </div>
        </body></html>
      `;
      const page = createPage(html);
      const results = await parseSearchResults(page);

      expect(results.length).toBe(1);
      expect(results[0].title).toContain("Example Title");
      expect(results[0].url).toBe("https://example.com/page");
    });
  });

  describe("Ask.com search results", () => {
    it("parses Ask.com results from realistic HTML", async () => {
      const html = loadFixture("search-ask.html");
      const page = createPage(html);
      const results = await parseSearchResults(page);

      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("extracts title from Ask results using link text", async () => {
      const html = `
        <html><body>
          <div class="result" data-testid="result">
            <a class="result-title-link" href="https://example.com/test" title="Test Title">Test Title</a>
            <div class="result-abstract"><p>Test snippet</p></div>
          </div>
        </body></html>
      `;
      const page = createPage(html);
      const results = await parseSearchResults(page);

      expect(results.length).toBe(1);
      expect(results[0].title).toBe("Test Title");
      expect(results[0].url).toBe("https://example.com/test");
      expect(results[0].snippet).toContain("Test snippet");
    });
  });

  describe("DuckDuckGo search results", () => {
    it("parses DuckDuckGo results from realistic HTML", async () => {
      const html = loadFixture("search-duckduckgo.html");
      const page = createPage(html);
      const results = await parseSearchResults(page);

      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("extracts title and URL from DDG results", async () => {
      const html = `
        <html><body>
          <div class="result">
            <div class="result__title">
              <a href="https://example.com/ddg">DDG Test Result</a>
            </div>
            <div class="result__snippet">DDG test snippet text</div>
          </div>
        </body></html>
      `;
      const page = createPage(html);
      const results = await parseSearchResults(page);

      expect(results.length).toBe(1);
      expect(results[0].title).toContain("DDG Test Result");
      expect(results[0].url).toBe("https://example.com/ddg");
      expect(results[0].snippet).toContain("DDG test snippet");
    });
  });

  describe("Google search results", () => {
    it("parses Google results from realistic HTML", async () => {
      const html = loadFixture("search-google.html");
      const page = createPage(html);
      const results = await parseSearchResults(page);

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].title).toBeTruthy();
    });
  });

  describe("Bing search results", () => {
    it("parses Bing results from realistic HTML", async () => {
      const html = loadFixture("search-bing.html");
      const page = createPage(html);
      const results = await parseSearchResults(page);

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].url).toContain("react.dev");
    });
  });

  describe("Edge cases", () => {
    it("returns empty array for empty results page", async () => {
      const html = loadFixture("search-empty.html");
      const page = createPage(html);
      const results = await parseSearchResults(page);

      expect(results).toEqual([]);
    });

    it("handles malformed HTML gracefully", async () => {
      const html = loadFixture("search-malformed.html");
      const page = createPage(html);
      const results = await parseSearchResults(page);

      expect(Array.isArray(results)).toBe(true);
    });

    it("returns results in order of engine priority (Yahoo first)", async () => {
      const html = `
        <html><body>
          <div class="compTitle options-toggle">
            <h3><a href="https://yahoo-result.com">Yahoo Result</a></h3>
          </div>
          <div class="compText"><p>Yahoo snippet</p></div>
        </body></html>
      `;
      const page = createPage(html);
      const results = await parseSearchResults(page);

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].url).toContain("yahoo-result.com");
    });

    it("filters out results without title", async () => {
      const html = `
        <html><body>
          <div class="compTitle options-toggle">
            <h3><a href="https://example.com"></a></h3>
          </div>
        </body></html>
      `;
      const page = createPage(html);
      const results = await parseSearchResults(page);

      expect(results.every((r) => r.title.length > 0)).toBe(true);
    });

    it("filters out results without URL", async () => {
      const html = `
        <html><body>
          <div class="compTitle options-toggle">
            <h3>No Link Title</h3>
          </div>
        </body></html>
      `;
      const page = createPage(html);
      const results = await parseSearchResults(page);

      expect(results.every((r) => r.url.length > 0)).toBe(true);
    });
  });

  describe("Engine fallback priority", () => {
    it("Yahoo takes priority over other engines", async () => {
      const html = `
        <html><body>
          <div class="compTitle options-toggle">
            <h3><a href="https://yahoo.com/result">Yahoo Result</a></h3>
          </div>
          <div class="compText"><p>From Yahoo</p></div>
          <div class="result" data-testid="result">
            <a class="result-title-link" href="https://ask.com/result">Ask Result</a>
          </div>
        </body></html>
      `;
      const page = createPage(html);
      const results = await parseSearchResults(page);

      expect(results.some((r) => r.url.includes("yahoo.com"))).toBe(true);
      expect(results.every((r) => !r.url.includes("ask.com"))).toBe(true);
    });

    it("falls back to Ask when no Yahoo results", async () => {
      const html = `
        <html><body>
          <div class="result" data-testid="result">
            <a class="result-title-link" href="https://ask.com/result">Ask Result</a>
            <div class="result-abstract"><p>From Ask</p></div>
          </div>
        </body></html>
      `;
      const page = createPage(html);
      const results = await parseSearchResults(page);

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].url).toContain("ask.com");
    });

    it("falls back to Marginalia when no Yahoo/Ask results", async () => {
      const html = `
        <html><body>
          <h2><a href="https://marginalia.com/result">Marginalia Result</a></h2>
          <p class="mt-2">From Marginalia</p>
        </body></html>
      `;
      const page = createPage(html);
      const results = await parseSearchResults(page);

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].url).toContain("marginalia.com");
    });
  });
});
