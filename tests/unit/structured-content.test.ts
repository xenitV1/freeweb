import { describe, it, expect } from "vitest";
import { extractStructuredContent, extractBySelector, SEARCH_ENGINES } from "../../src/utils.js";
import { JSDOM } from "jsdom";

function createPage(html: string) {
  const dom = new JSDOM(html, { url: "https://example.com/page", runScripts: "dangerously" });
  const window = dom.window;

  return {
    content: () => Promise.resolve(html),
    url: () => "https://example.com/page",
    evaluate: (fn: Function, ...args: any[]) => {
      const argStr = args.length > 0 ? `, ${JSON.stringify(args)}` : "";
      return Promise.resolve(window.eval(`(${fn.toString()})(${argStr.slice(2)})`));
    },
  } as any;
}

describe("extractStructuredContent", () => {
  it("extracts JSON-LD data", async () => {
    const html = `
      <html><head>
        <script type="application/ld+json">{"@type":"Article","name":"Test","datePublished":"2024-01-15"}</script>
      </head><body><p>content</p></body></html>
    `;
    const page = createPage(html);
    const result = await extractStructuredContent(page);

    expect(result.jsonLd).toHaveLength(1);
    expect(result.jsonLd[0]).toEqual({
      "@type": "Article",
      "name": "Test",
      "datePublished": "2024-01-15",
    });
  });

  it("extracts multiple JSON-LD blocks", async () => {
    const html = `
      <html><head>
        <script type="application/ld+json">{"@type":"Article","name":"First"}</script>
        <script type="application/ld+json">{"@type":"BreadcrumbList","name":"Second"}</script>
      </head><body></body></html>
    `;
    const page = createPage(html);
    const result = await extractStructuredContent(page);

    expect(result.jsonLd).toHaveLength(2);
  });

  it("handles malformed JSON-LD gracefully", async () => {
    const html = `
      <html><head>
        <script type="application/ld+json">{invalid json}</script>
        <script type="application/ld+json">{"@type":"Article"}</script>
      </head><body></body></html>
    `;
    const page = createPage(html);
    const result = await extractStructuredContent(page);

    expect(result.jsonLd.length).toBeGreaterThanOrEqual(1);
    expect(result.jsonLd.some((item) => item["@type"] === "Article")).toBe(true);
  });

  it("extracts tables with headers and rows", async () => {
    const html = `
      <html><body>
        <table>
          <thead><tr><th>Name</th><th>Age</th></tr></thead>
          <tbody>
            <tr><td>Alice</td><td>30</td></tr>
            <tr><td>Bob</td><td>25</td></tr>
          </tbody>
        </table>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractStructuredContent(page);

    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].headers).toEqual(["Name", "Age"]);
    expect(result.tables[0].rows).toEqual([
      ["Alice", "30"],
      ["Bob", "25"],
    ]);
  });

  it("extracts tables without headers", async () => {
    const html = `
      <html><body>
        <table>
          <tr><td>Alice</td><td>30</td></tr>
          <tr><td>Bob</td><td>25</td></tr>
        </table>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractStructuredContent(page);

    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].headers).toEqual([]);
    expect(result.tables[0].rows).toHaveLength(2);
  });

  it("skips empty tables", async () => {
    const html = `
      <html><body>
        <table><tbody></tbody></table>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractStructuredContent(page);

    expect(result.tables).toHaveLength(0);
  });

  it("extracts ordered lists", async () => {
    const html = `
      <html><body>
        <ol>
          <li>First item</li>
          <li>Second item</li>
          <li>Third item</li>
        </ol>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractStructuredContent(page);

    expect(result.lists).toHaveLength(1);
    expect(result.lists[0].ordered).toBe(true);
    expect(result.lists[0].items).toEqual(["First item", "Second item", "Third item"]);
  });

  it("extracts unordered lists", async () => {
    const html = `
      <html><body>
        <ul>
          <li>Apple</li>
          <li>Banana</li>
        </ul>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractStructuredContent(page);

    expect(result.lists).toHaveLength(1);
    expect(result.lists[0].ordered).toBe(false);
    expect(result.lists[0].items).toEqual(["Apple", "Banana"]);
  });

  it("only extracts direct children of list", async () => {
    const html = `
      <html><body>
        <ul>
          <li>Top level
            <ul><li>Nested</li></ul>
          </li>
          <li>Another top</li>
        </ul>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractStructuredContent(page);

    expect(result.lists.length).toBeGreaterThanOrEqual(1);
    const topList = result.lists.find((l) => l.items.length === 2);
    expect(topList).toBeDefined();
  });

  it("returns empty structures for page without structured content", async () => {
    const html = `<html><body><p>Just text</p></body></html>`;
    const page = createPage(html);
    const result = await extractStructuredContent(page);

    expect(result.jsonLd).toHaveLength(0);
    expect(result.tables).toHaveLength(0);
    expect(result.lists).toHaveLength(0);
  });

  it("extracts mixed content", async () => {
    const html = `
      <html><head>
        <script type="application/ld+json">{"@type":"HowTo","name":"Guide"}</script>
      </head><body>
        <h2>Steps</h2>
        <ol><li>Step 1</li><li>Step 2</li></ol>
        <table><tr><th>A</th></tr><tr><td>B</td></tr></table>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractStructuredContent(page);

    expect(result.jsonLd).toHaveLength(1);
    expect(result.tables).toHaveLength(1);
    expect(result.lists).toHaveLength(1);
  });
});

describe("extractBySelector", () => {
  it("extracts content matching a CSS selector", async () => {
    const html = `
      <html><body>
        <h2 class="title">Hello World</h2>
        <p>Some other text</p>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractBySelector(page, "h2.title");

    expect(result).toBe("Hello World");
  });

  it("extracts multiple elements and joins with double newline", async () => {
    const html = `
      <html><body>
        <p class="item">First</p>
        <p class="item">Second</p>
        <p class="item">Third</p>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractBySelector(page, "p.item");

    expect(result).toBe("First\n\nSecond\n\nThird");
  });

  it("returns empty string for no matches", async () => {
    const html = `<html><body><p>text</p></body></html>`;
    const page = createPage(html);
    const result = await extractBySelector(page, ".nonexistent");

    expect(result).toBe("");
  });

  it("extracts complex selectors", async () => {
    const html = `
      <html><body>
        <div data-testid="content"><p>Target content</p></div>
        <div><p>Other content</p></div>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractBySelector(page, '[data-testid="content"]');

    expect(result).toContain("Target content");
    expect(result).not.toContain("Other content");
  });

  it("trims whitespace from extracted content", async () => {
    const html = `
      <html><body>
        <span class="val">  spaces around  </span>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractBySelector(page, "span.val");

    expect(result).toBe("spaces around");
  });
});

describe("SEARCH_ENGINES", () => {
  it("has yahoo, marginalia, ask, and duckduckgo engines", () => {
    const names = SEARCH_ENGINES.map((e) => e.name);
    expect(names).toContain("yahoo");
    expect(names).toContain("marginalia");
    expect(names).toContain("ask");
    expect(names).toContain("duckduckgo");
  });

  it("yahoo has highest weight", () => {
    const yahoo = SEARCH_ENGINES.find((e) => e.name === "yahoo");
    expect(yahoo!.weight).toBe(28);
  });

  it("duckduckgo has weight 15", () => {
    const ddg = SEARCH_ENGINES.find((e) => e.name === "duckduckgo");
    expect(ddg!.weight).toBe(15);
  });

  it("buildUrl generates valid URLs for all engines", () => {
    for (const engine of SEARCH_ENGINES) {
      const url = engine.buildUrl("test query");
      expect(() => new URL(url)).not.toThrow();
      const parsed = new URL(url);
      const paramValue = parsed.searchParams.values().next().value;
      expect(paramValue).toContain("test");
    }
  });

  it("buildUrl applies site: prefix for domain filter", () => {
    for (const engine of SEARCH_ENGINES) {
      const url = engine.buildUrl("query", "example.com");
      const parsed = new URL(url);
      const paramValue = parsed.searchParams.values().next().value;
      expect(paramValue).toContain("site:example.com");
    }
  });

  it("does not double site: prefix", () => {
    for (const engine of SEARCH_ENGINES) {
      const url = engine.buildUrl("site:example.com query", "example.com");
      const parsed = new URL(url);
      const paramValue = parsed.searchParams.values().next().value;
      const siteCount = (paramValue.match(/site:/g) || []).length;
      expect(siteCount).toBe(1);
    }
  });

  it("all engines have positive waitForMs", () => {
    for (const engine of SEARCH_ENGINES) {
      expect(engine.waitForMs).toBeGreaterThan(0);
    }
  });
});
