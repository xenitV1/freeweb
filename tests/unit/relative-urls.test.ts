import { describe, it, expect } from "vitest";
import { resolveUrl, parseLlmsTxt, buildLlmsCandidates } from "../../src/llms.js";

describe("resolveUrl", () => {
  it("passes through absolute URLs unchanged", () => {
    expect(resolveUrl("https://example.com/page", "https://other.com/llms.txt")).toBe("https://example.com/page");
  });

  it("passes through absolute HTTP URLs unchanged", () => {
    expect(resolveUrl("http://example.com/page", "https://other.com/llms.txt")).toBe("http://example.com/page");
  });

  it("resolves /docs/api against source origin", () => {
    expect(resolveUrl("/docs/api", "https://example.com/llms.txt")).toBe("https://example.com/docs/api");
  });

  it("resolves ./guide.html against source path", () => {
    expect(resolveUrl("./guide.html", "https://example.com/docs/llms.txt")).toBe("https://example.com/docs/guide.html");
  });

  it("resolves ../other against source path", () => {
    expect(resolveUrl("../other", "https://example.com/docs/llms.txt")).toBe("https://example.com/other");
  });

  it("handles #fragment by returning null", () => {
    expect(resolveUrl("#section", "https://example.com/llms.txt")).toBeNull();
  });

  it("handles empty string by returning null", () => {
    expect(resolveUrl("", "https://example.com/llms.txt")).toBeNull();
  });

  it("handles whitespace-only string by returning null", () => {
    expect(resolveUrl("   ", "https://example.com/llms.txt")).toBeNull();
  });

  it("handles malformed relative URL gracefully", () => {
    const result = resolveUrl("::invalid", "https://example.com/llms.txt");
    expect(result === null || typeof result === "string").toBe(true);
  });

  it("resolves deeply nested relative paths", () => {
    expect(resolveUrl("../../api/v2", "https://example.com/docs/guides/llms.txt")).toBe("https://example.com/api/v2");
  });

  it("resolves absolute path ignoring source path", () => {
    expect(resolveUrl("/root", "https://example.com/deep/nested/llms.txt")).toBe("https://example.com/root");
  });

  it("resolves ./path with multiple segments", () => {
    expect(resolveUrl("./a/b/c", "https://example.com/docs/llms.txt")).toBe("https://example.com/docs/a/b/c");
  });

  it("handles case-insensitive protocol check", () => {
    expect(resolveUrl("HTTPS://example.com/page", "https://other.com/llms.txt")).toBe("HTTPS://example.com/page");
  });

  it("resolves relative URL from subdirectory source", () => {
    expect(resolveUrl("./page", "https://example.com/sub/llms.txt")).toBe("https://example.com/sub/page");
  });

  it("resolves /path when source has no trailing path segments", () => {
    expect(resolveUrl("/newpath", "https://example.com/llms.txt")).toBe("https://example.com/newpath");
  });
});

describe("parseLlmsTxt with relative URLs", () => {
  it("resolves markdown links with relative URLs", () => {
    const input = `# Site

## Docs

- [API Reference](/docs/api): The API docs
- [Guide](./guide.html): Getting started
- [Other](../other): Other docs
`;

    const doc = parseLlmsTxt(input, "https://example.com/path/llms.txt");
    expect(doc).not.toBeNull();

    const urls = doc!.sections[0].links.map((l) => l.url);
    expect(urls).toContain("https://example.com/docs/api");
    expect(urls).toContain("https://example.com/path/guide.html");
    expect(urls).toContain("https://example.com/other");
  });

  it("still handles absolute URLs correctly", () => {
    const input = `# Site

- [Abs](https://other.com/page): Absolute link
`;

    const doc = parseLlmsTxt(input, "https://example.com/llms.txt");
    expect(doc).not.toBeNull();
    expect(doc!.sections[0].links[0].url).toBe("https://other.com/page");
  });

  it("drops fragment-only URLs", () => {
    const input = `# Site

## Section

- [Fragment](#section): This is a fragment
`;

    const doc = parseLlmsTxt(input, "https://example.com/llms.txt");
    expect(doc).not.toBeNull();
    expect(doc!.sections[0].links).toHaveLength(0);
  });

  it("preserves link notes when resolving relative URLs", () => {
    const input = `# Site

- [API](/docs/api): Important docs
`;

    const doc = parseLlmsTxt(input, "https://example.com/llms.txt");
    const link = doc!.sections[0].links[0];
    expect(link.url).toBe("https://example.com/docs/api");
    expect(link.note).toBe("Important docs");
  });
});

describe("buildLlmsCandidates with llms-full.txt", () => {
  it("includes llms-full.txt alongside llms.txt", () => {
    const candidates = buildLlmsCandidates("https://example.com/docs/page");
    expect(candidates).toContain("https://example.com/docs/llms.txt");
    expect(candidates).toContain("https://example.com/docs/llms-full.txt");
    expect(candidates).toContain("https://example.com/llms.txt");
    expect(candidates).toContain("https://example.com/llms-full.txt");
  });

  it("deduplicates candidates", () => {
    const candidates = buildLlmsCandidates("https://example.com/");
    const uniqueCandidates = new Set(candidates);
    expect(candidates.length).toBe(uniqueCandidates.size);
  });
});
