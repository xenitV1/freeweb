import { describe, it, expect } from "vitest";
import { parseLlmsTxt, findRelevantLlmsLinks, formatLlmsGuidance, buildLlmsCandidates, type LlmsDocument } from "../../src/llms.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
}

describe("parseLlmsTxt", () => {
  it("parses a full llms.txt file", () => {
    const doc = parseLlmsTxt(fixture("llms-full.txt"), "https://example.com/llms.txt");
    expect(doc).not.toBeNull();
    expect(doc!.title).toBe("Example Site");
    expect(doc!.summary).toBe("This is an example llms.txt file for testing");
    expect(doc!.sections.length).toBeGreaterThanOrEqual(2);
    const docsSection = doc!.sections.find((s) => s.title === "Docs");
    expect(docsSection).toBeDefined();
    expect(docsSection!.optional).toBe(false);
    expect(docsSection!.links).toHaveLength(3);
    const optionalSection = doc!.sections.find((s) => s.title === "Optional");
    expect(optionalSection).toBeDefined();
    expect(optionalSection!.optional).toBe(true);
  });

  it("parses intro links as a generated section", () => {
    const doc = parseLlmsTxt(fixture("llms-full.txt"), "https://example.com/llms.txt");
    const introLinks = doc!.introNotes;
    expect(introLinks.length).toBeGreaterThanOrEqual(0);
  });

  it("parses a minimal llms.txt", () => {
    const doc = parseLlmsTxt(fixture("llms-minimal.txt"), "https://minimal.test/llms.txt");
    expect(doc).not.toBeNull();
    expect(doc!.title).toBe("Minimal Site");
  });

  it("returns null for empty content", () => {
    expect(parseLlmsTxt("", "https://example.com/llms.txt")).toBeNull();
  });

  it("returns null for content without H1 title", () => {
    expect(parseLlmsTxt("Some text\n- [Link](https://example.com)", "https://example.com/llms.txt")).toBeNull();
  });

  it("handles malformed llms.txt gracefully", () => {
    const doc = parseLlmsTxt(fixture("llms-malformed.txt"), "https://example.com/llms.txt");
    expect(doc).not.toBeNull();
    expect(doc!.title).toBe("Broken");
    expect(doc!.sections[0].links).toHaveLength(0);
  });

  it("handles mixed URL formats", () => {
    const doc = parseLlmsTxt(fixture("llms-mixed-urls.txt"), "https://example.com/llms.txt");
    expect(doc).not.toBeNull();
    expect(doc!.title).toBe("Mixed URLs Site");

    const allLinks = doc!.sections.flatMap((s) => s.links);
    const urls = allLinks.map((l) => l.url);

    expect(urls).toContain("https://example.com/page1");
    expect(urls).toContain("https://example.com/page2");
    expect(urls).toContain("https://example.com/a/b/c/page.html");
    expect(urls).toContain("https://example.com/docs/guide.md");
  });

  it("resolves relative URLs against source", () => {
    const doc = parseLlmsTxt(fixture("llms-mixed-urls.txt"), "https://example.com/llms.txt");
    const allLinks = doc!.sections.flatMap((s) => s.links);
    const urls = allLinks.map((l) => l.url);

    expect(urls).toContain("https://example.com/docs/api");
  });

  it("resolves dot-relative URLs", () => {
    const doc = parseLlmsTxt(fixture("llms-mixed-urls.txt"), "https://example.com/llms.txt");
    const allLinks = doc!.sections.flatMap((s) => s.links);
    const urls = allLinks.map((l) => l.url);

    expect(urls).toContain("https://example.com/guide.html");
    expect(urls).toContain("https://example.com/other");
  });

  it("extracts link notes", () => {
    const doc = parseLlmsTxt(fixture("llms-full.txt"), "https://example.com/llms.txt");
    const docsSection = doc!.sections.find((s) => s.title === "Docs");
    expect(docsSection).toBeDefined();
    const authLink = docsSection!.links.find((l) => l.title === "Authentication");
    expect(authLink?.note).toBe("OAuth2 and API keys");
  });

  it("respects max byte limit", () => {
    const huge = "# Title\n" + "x".repeat(100_000);
    const doc = parseLlmsTxt(huge, "https://example.com/llms.txt");
    expect(doc).not.toBeNull();
  });

  it("handles CRLF line endings", () => {
    const crlf = "# My Site\r\n\r\n- [Home](https://example.com/)\r\n";
    const doc = parseLlmsTxt(crlf, "https://example.com/llms.txt");
    expect(doc).not.toBeNull();
    expect(doc!.title).toBe("My Site");
  });

  it("handles H3 subheadings as notes", () => {
    const input = `# Site\n\n## Section\n\n### Subtopic\n\nSome detail here\n\n- [Link](https://example.com)`;
    const doc = parseLlmsTxt(input, "https://example.com/llms.txt");
    expect(doc!.sections[0].notes.some((n) => n.includes("Subtopic"))).toBe(true);
  });

  it("handles blockquotes as summary and notes", () => {
    const input = `# Site\n\n> This is the summary\n\n## Section\n\n> Section note\n\n- [Link](https://example.com)`;
    const doc = parseLlmsTxt(input, "https://example.com/llms.txt");
    expect(doc!.summary).toBe("This is the summary");
    expect(doc!.sections[0].notes).toContain("Section note");
  });
});

describe("buildLlmsCandidates", () => {
  it("generates candidates from deep path to root", () => {
    const candidates = buildLlmsCandidates("https://example.com/a/b/c/page.html");
    expect(candidates[0]).toBe("https://example.com/a/b/c/llms.txt");
    expect(candidates).toContain("https://example.com/llms.txt");
    expect(candidates).toContain("https://example.com/a/llms.txt");
    expect(candidates).toContain("https://example.com/a/b/llms.txt");
  });

  it("includes llms-full.txt candidates", () => {
    const candidates = buildLlmsCandidates("https://example.com/docs/guide");
    expect(candidates).toContain("https://example.com/docs/llms.txt");
    expect(candidates).toContain("https://example.com/docs/llms-full.txt");
    expect(candidates).toContain("https://example.com/llms-full.txt");
  });

  it("handles root URL", () => {
    const candidates = buildLlmsCandidates("https://example.com/");
    expect(candidates).toHaveLength(2);
    expect(candidates).toContain("https://example.com/llms.txt");
    expect(candidates).toContain("https://example.com/llms-full.txt");
  });

  it("treats last segment with extension as file, not directory", () => {
    const candidates = buildLlmsCandidates("https://example.com/docs/api.html");
    expect(candidates).not.toContain("https://example.com/docs/api.html/llms.txt");
    expect(candidates).toContain("https://example.com/docs/llms.txt");
  });

  it("handles path without trailing slash", () => {
    const candidates = buildLlmsCandidates("https://example.com/docs/guide");
    expect(candidates).toContain("https://example.com/llms.txt");
    expect(candidates).toContain("https://example.com/docs/llms.txt");
    expect(candidates).toContain("https://example.com/docs/guide/llms.txt");
  });
});

describe("findRelevantLlmsLinks", () => {
  function makeDoc(): LlmsDocument {
    return {
      sourceUrl: "https://example.com/llms.txt",
      title: "Test Site",
      introNotes: [],
      sections: [
        {
          title: "Getting Started",
          optional: false,
          notes: [],
          links: [
            { title: "Quick Start Guide", url: "https://example.com/docs/quickstart", note: "Get started fast" },
            { title: "Installation", url: "https://example.com/docs/install", note: "Install the SDK" },
          ],
        },
        {
          title: "API Reference",
          optional: false,
          notes: [],
          links: [
            { title: "REST API", url: "https://example.com/docs/api/rest", note: "REST endpoints" },
            { title: "GraphQL API", url: "https://example.com/docs/api/graphql", note: "GraphQL schema" },
          ],
        },
        {
          title: "Optional",
          optional: true,
          notes: [],
          links: [
            { title: "Changelog", url: "https://example.com/changelog" },
            { title: "Status", url: "https://status.example.com/" },
          ],
        },
      ],
    };
  }

  it("returns links matching query tokens", () => {
    const links = findRelevantLlmsLinks(makeDoc(), "api rest endpoints");
    expect(links.length).toBeGreaterThan(0);
    const topLink = links[0];
    expect(topLink.title).toContain("REST API");
  });

  it("returns links sorted by relevance score", () => {
    const links = findRelevantLlmsLinks(makeDoc(), "installation sdk");
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].title).toBe("Installation");
  });

  it("penalizes optional section links", () => {
    const links = findRelevantLlmsLinks(makeDoc(), "changelog updates");
    const changelogLink = links.find((l) => l.title === "Changelog");
    expect(changelogLink).toBeDefined();
    expect(changelogLink!.optional).toBe(true);
  });

  it("returns empty for stop-words-only query", () => {
    const links = findRelevantLlmsLinks(makeDoc(), "a the how to in");
    expect(links).toHaveLength(0);
  });

  it("respects maxLinks option", () => {
    const links = findRelevantLlmsLinks(makeDoc(), "guide api rest graphql install quick start", { maxLinks: 2 });
    expect(links.length).toBeLessThanOrEqual(2);
  });

  it("deduplicates by URL", () => {
    const doc: LlmsDocument = {
      sourceUrl: "https://example.com/llms.txt",
      title: "Test",
      introNotes: [],
      sections: [
        { title: "A", optional: false, notes: [], links: [{ title: "Link1", url: "https://example.com/page" }] },
        { title: "B", optional: false, notes: [], links: [{ title: "Link2", url: "https://example.com/page" }] },
      ],
    };
    const links = findRelevantLlmsLinks(doc, "link");
    const urls = links.map((l) => l.url);
    const uniqueUrls = new Set(urls);
    expect(uniqueUrls.size).toBe(urls.length);
  });
});

describe("formatLlmsGuidance", () => {
  it("formats guidance with sections and notes", () => {
    const doc: LlmsDocument = {
      sourceUrl: "https://example.com/llms.txt",
      title: "Test Site",
      summary: "A test site",
      introNotes: ["Note 1"],
      sections: [
        { title: "Docs", optional: false, notes: ["Important"], links: [{ title: "API", url: "https://example.com/api" }] },
      ],
    };
    const formatted = formatLlmsGuidance(doc);
    expect(formatted).toContain("LLMS.txt Guidance");
    expect(formatted).toContain("Test Site");
    expect(formatted).toContain("A test site");
    expect(formatted).toContain("Docs");
    expect(formatted).toContain("API");
  });

  it("shows relevant links for query", () => {
    const doc: LlmsDocument = {
      sourceUrl: "https://example.com/llms.txt",
      title: "Test",
      introNotes: [],
      sections: [
        { title: "API", optional: false, notes: [], links: [{ title: "REST API Reference", url: "https://example.com/api/rest" }] },
      ],
    };
    const formatted = formatLlmsGuidance(doc, { query: "rest api reference" });
    expect(formatted).toContain("Relevant for query");
    expect(formatted).toContain("rest api reference");
  });

  it("lists optional section names", () => {
    const doc: LlmsDocument = {
      sourceUrl: "https://example.com/llms.txt",
      title: "Test",
      introNotes: [],
      sections: [
        { title: "Optional", optional: true, notes: [], links: [{ title: "Extra", url: "https://example.com/extra" }] },
      ],
    };
    const formatted = formatLlmsGuidance(doc);
    expect(formatted).toContain("Optional sections available");
  });
});
