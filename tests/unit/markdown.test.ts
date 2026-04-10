import { describe, it, expect } from "vitest";
import { buildMarkdownCandidates, looksLikeMarkdown, extractMarkdownTitle } from "../../src/markdown.js";

describe("buildMarkdownCandidates", () => {
  it("generates .md variant for pages with extension", () => {
    const candidates = buildMarkdownCandidates("https://example.com/docs/api.html");
    expect(candidates).toContain("https://example.com/docs/api.html.md");
  });

  it("generates index.html.md for directory-like paths", () => {
    const candidates = buildMarkdownCandidates("https://example.com/docs/");
    expect(candidates).toContain("https://example.com/docs/index.html.md");
  });

  it("generates both .md and index.html.md for extensionless paths", () => {
    const candidates = buildMarkdownCandidates("https://example.com/docs/guide");
    expect(candidates).toContain("https://example.com/docs/guide/index.html.md");
    expect(candidates).toContain("https://example.com/docs/guide.md");
  });

  it("deduplicates candidates", () => {
    const candidates = buildMarkdownCandidates("https://example.com/");
    const unique = new Set(candidates);
    expect(candidates.length).toBe(unique.size);
  });

  it("strips hash and search params before building candidates", () => {
    const candidates = buildMarkdownCandidates("https://example.com/docs/?v=1#section");
    for (const c of candidates) {
      expect(c).not.toContain("#");
      expect(c).not.toContain("v=1");
    }
  });
});

describe("looksLikeMarkdown", () => {
  it("accepts valid markdown (above min length)", () => {
    const md = "# Title\n\n" + "Some content here with **bold** text. ".repeat(5);
    expect(looksLikeMarkdown(md)).toBe(true);
  });

  it("rejects valid markdown that is too short", () => {
    expect(looksLikeMarkdown("# Title\n\nSome content here with **bold** text.")).toBe(false);
  });

  it("rejects HTML content", () => {
    expect(looksLikeMarkdown("<!doctype html><html><body>Hello</body></html>")).toBe(false);
    expect(looksLikeMarkdown("<html><head></head><body>Content</body></html>")).toBe(false);
  });

  it("rejects content with <body>", () => {
    expect(looksLikeMarkdown("Some text\n<body>More text</body>")).toBe(false);
  });

  it("rejects content below minimum length", () => {
    expect(looksLikeMarkdown("Short")).toBe(false);
    expect(looksLikeMarkdown("x".repeat(119))).toBe(false);
  });

  it("accepts content at minimum length", () => {
    expect(looksLikeMarkdown("x".repeat(120))).toBe(true);
  });
});

describe("extractMarkdownTitle", () => {
  it("extracts H1 title", () => {
    expect(extractMarkdownTitle("# My Page Title\n\nContent")).toBe("My Page Title");
  });

  it("extracts YAML front matter title", () => {
    expect(extractMarkdownTitle("---\ntitle: YAML Title\n---\n\nContent")).toBe("YAML Title");
  });

  it("prefers H1 over YAML title", () => {
    const md = "# H1 Title\n\ntitle: YAML Title\n\nContent";
    expect(extractMarkdownTitle(md)).toBe("H1 Title");
  });

  it("returns undefined for no title", () => {
    expect(extractMarkdownTitle("Just some content without a title")).toBeUndefined();
  });

  it("extractMarkdownTitle does NOT strip bold or backticks from H1 content", () => {
    expect(extractMarkdownTitle("# **Bold Title**")).toBe("**Bold Title**");
    expect(extractMarkdownTitle("# `Code Title`")).toBe("`Code Title`");
    expect(extractMarkdownTitle("# [Link Title](https://example.com)")).toBe("[Link Title](https://example.com)");
  });
});
