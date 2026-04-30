import { describe, it, expect } from "vitest";
import {
  parseYahooHtml,
  parseMarginaliaHtml,
  parseAskHtml,
  parseDdgHtml,
  stripHtml,
} from "../../src/search-html.js";

describe("stripHtml", () => {
  it("removes HTML tags", () => {
    expect(stripHtml("<b>Hello</b> <i>World</i>")).toBe("Hello World");
  });

  it("collapses whitespace", () => {
    expect(stripHtml("  hello   \n  world  ")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(stripHtml("")).toBe("");
  });

  it("handles text without tags", () => {
    expect(stripHtml("plain text")).toBe("plain text");
  });
});

describe("parseYahooHtml", () => {
  it("extracts results from Yahoo search HTML", () => {
    const html = `
      <div class="compTitle options-toggle">
        <h3 class="title"><a href="https://react.dev/learn">React – A JavaScript library</a></h3>
      </div>
      <div class="compText">React lets you build user interfaces out of individual pieces called components.</div>
      <div class="compTitle options-toggle">
        <h3 class="title"><a href="https://vuejs.org/">Vue.js Framework</a></h3>
      </div>
      <div class="compText">The progressive JavaScript framework for building modern web UI.</div>
    `;
    const results = parseYahooHtml(html);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].title).toContain("React");
    expect(results[0].url).toBe("https://react.dev/learn");
  });

  it("unwraps Yahoo redirect URLs", () => {
    const html = `
      <div class="compTitle options-toggle">
        <h3 class="title"><a href="https://r.search.yahoo.com/ylt=foo?RU=https%3A%2F%2Freact.dev%2Flearn">React Learn</a></h3>
      </div>
      <div class="compText">React documentation</div>
    `;
    const results = parseYahooHtml(html);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].url).toBe("https://react.dev/learn");
  });

  it("filters out Yahoo internal URLs", () => {
    const html = `
      <div class="compTitle">
        <h3 class="title"><a href="https://search.yahoo.com/search?foo">Internal</a></h3>
      </div>
      <div class="compText">Internal link</div>
    `;
    const results = parseYahooHtml(html);
    expect(results).toHaveLength(0);
  });

  it("falls back to broad link extraction", () => {
    const html = `
      <a href="https://react.dev/learn">React Documentation Site</a>
      <a href="https://vuejs.org/guide">Vue.js Guide Introduction</a>
      <a href="https://search.yahoo.com/blah">Should be filtered</a>
    `;
    const results = parseYahooHtml(html);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((r) => !r.url.includes("yahoo.com"))).toBe(true);
  });

  it("returns empty for non-Yahoo HTML", () => {
    expect(parseYahooHtml("")).toHaveLength(0);
    expect(parseYahooHtml("<html><body>nothing</body></html>")).toHaveLength(0);
  });
});

describe("parseMarginaliaHtml", () => {
  it("extracts results from Marginalia search HTML", () => {
    const html = `
      <div class="flex flex-col grow">
        <h2 class="text-lg font-semibold"><a href="https://react.dev/learn">React Documentation</a></h2>
        <p class="mt-2 text-sm text-gray-600">React is a JavaScript library for building user interfaces</p>
      </div>
      <div class="flex flex-col grow">
        <h2 class="text-lg font-semibold"><a href="https://vuejs.org/guide">Vue.js Guide</a></h2>
        <p class="mt-2 text-sm text-gray-600">Vue is a progressive framework</p>
      </div>
    `;
    const results = parseMarginaliaHtml(html);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("React Documentation");
    expect(results[0].url).toBe("https://react.dev/learn");
    expect(results[0].snippet).toContain("JavaScript library");
  });

  it("extracts snippets from generic <p> tags", () => {
    const html = `
      <div>
        <h2><a href="https://example.com">Example Page</a></h2>
        <p>This is the description of the page content.</p>
      </div>
    `;
    const results = parseMarginaliaHtml(html);
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toContain("description");
  });

  it("returns empty for non-Marginalia HTML", () => {
    expect(parseMarginaliaHtml("")).toHaveLength(0);
    expect(parseMarginaliaHtml("<html><body>nothing</body></html>")).toHaveLength(0);
  });
});

describe("parseAskHtml", () => {
  it("extracts results from Ask.com search HTML", () => {
    const html = `
      <div class="PartialSearchResults-result" data-testid="result">
        <a class="result-title-link" href="https://react.dev/learn">React Hooks Guide</a>
        <p class="result-abstract">React lets you build user interfaces with hooks</p>
      </div>
      <div class="PartialSearchResults-result" data-testid="result">
        <a class="result-title-link" href="https://vuejs.org/guide">Vue.js Documentation</a>
        <p class="result-abstract">Vue is a progressive framework</p>
      </div>
    `;
    const results = parseAskHtml(html);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].title).toContain("React Hooks");
    expect(results[0].url).toBe("https://react.dev/learn");
  });

  it("filters out ask.com internal URLs", () => {
    const html = `
      <div class="result">
        <a href="https://www.ask.com/something">Ask Internal</a>
        <p>Description</p>
      </div>
    `;
    const results = parseAskHtml(html);
    expect(results).toHaveLength(0);
  });

  it("returns empty for non-Ask HTML", () => {
    expect(parseAskHtml("")).toHaveLength(0);
    expect(parseAskHtml("<html><body>nothing</body></html>")).toHaveLength(0);
  });
});

describe("parseDdgHtml", () => {
  it("extracts results from DuckDuckGo HTML", () => {
    const html = `
      <div class="result">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Freact.dev%2Flearn&amp;rut=abc">React Documentation</a>
        <a class="result__snippet">React is a JavaScript library for building user interfaces</a>
      </div>
      <div class="result">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fvuejs.org%2Fguide&amp;rut=def">Vue.js Guide</a>
        <a class="result__snippet">The progressive JavaScript framework</a>
      </div>
    `;
    const results = parseDdgHtml(html);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("React Documentation");
    expect(results[0].url).toBe("https://react.dev/learn");
    expect(results[0].snippet).toContain("JavaScript library");
  });

  it("filters out duckduckgo.com URLs", () => {
    const html = `
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fduckduckgo.com%2Fabout">DDG About</a>
        <a class="result__snippet">About DuckDuckGo</a>
      </div>
    `;
    const results = parseDdgHtml(html);
    expect(results).toHaveLength(0);
  });

  it("handles &amp; encoded HTML", () => {
    const html = `
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fsearch%3Fq%3Dtest%26page%3D1">Example</a>
      <a class="result__snippet">Test result</a>
    `;
    const results = parseDdgHtml(html);
    expect(results).toHaveLength(1);
    expect(results[0].url).toContain("example.com");
  });

  it("returns empty for non-DDG HTML", () => {
    expect(parseDdgHtml("")).toHaveLength(0);
    expect(parseDdgHtml("<html><body>nothing</body></html>")).toHaveLength(0);
  });
});
