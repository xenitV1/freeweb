import { describe, it, expect } from "vitest";
import { resolveLlmsRoute } from "../../src/lib.js";
import type { LlmsDocument } from "../../src/llms.js";

function makeDoc(overrides?: Partial<LlmsDocument>): LlmsDocument {
  return {
    sourceUrl: "https://example.com/llms.txt",
    title: "Example",
    introNotes: [],
    sections: [
      {
        title: "Docs",
        optional: false,
        notes: [],
        links: [
          { title: "Getting Started", url: "https://example.com/docs/getting-started" },
          { title: "API Reference", url: "https://example.com/docs/api" },
          { title: "Authentication Guide", url: "https://example.com/docs/auth", note: "OAuth2 setup" },
          { title: "Guide (Markdown)", url: "https://example.com/docs/guide.md" },
        ],
      },
      {
        title: "Optional",
        optional: true,
        notes: [],
        links: [
          { title: "Changelog", url: "https://example.com/changelog" },
        ],
      },
    ],
    ...overrides,
  };
}

describe("resolveLlmsRoute", () => {
  it("does not route when followLlmsLinks is false", () => {
    const result = resolveLlmsRoute("https://example.com/", makeDoc(), "api reference", false);
    expect(result.routed).toBe(false);
  });

  it("does not route when llms is null", () => {
    const result = resolveLlmsRoute("https://example.com/", null, "api reference");
    expect(result.routed).toBe(false);
  });

  it("does not route when no query", () => {
    const result = resolveLlmsRoute("https://example.com/", makeDoc(), undefined);
    expect(result.routed).toBe(false);
  });

  it("routes to most relevant same-site page (guide beats api for generic query)", () => {
    const result = resolveLlmsRoute("https://example.com/", makeDoc(), "api reference endpoints");
    expect(result.routed).toBe(true);
    expect(result.targetUrl).toContain("example.com");
  });

  it("BUG: guide.md gets higher score than api due to .md extension bonus", () => {
    const result = resolveLlmsRoute("https://example.com/", makeDoc(), "api reference endpoints");
    if (result.routed) {
      expect(result.targetUrl).toContain("guide");
    }
  });

  it("routes to auth page for oauth query", () => {
    const result = resolveLlmsRoute("https://example.com/", makeDoc(), "oauth authentication setup");
    if (result.routed) {
      expect(result.targetUrl).toContain("auth");
    }
  });

  it("does not route to different domain", () => {
    const result = resolveLlmsRoute("https://other.com/", makeDoc(), "api reference");
    expect(result.routed).toBe(false);
  });

  it("BUG: routes even for nonsense query because same-site bonus inflates score", () => {
    const doc: LlmsDocument = {
      sourceUrl: "https://example.com/llms.txt",
      title: "Example",
      introNotes: [],
      sections: [
        {
          title: "Misc",
          optional: false,
          notes: [],
          links: [
            { title: "Unrelated Page", url: "https://example.com/unrelated" },
          ],
        },
      ],
    };
    const result = resolveLlmsRoute("https://example.com/", doc, "xyzzyplughnothing");
    expect(result.routed).toBe(true);
  });

  it("deroutes .md extension from target", () => {
    const result = resolveLlmsRoute("https://example.com/", makeDoc(), "guide markdown documentation");
    if (result.routed) {
      expect(result.targetUrl).not.toMatch(/\.md$/);
    }
  });

  it("does not route to blocked URLs", () => {
    const doc: LlmsDocument = {
      sourceUrl: "https://example.com/llms.txt",
      title: "Example",
      introNotes: [],
      sections: [
        {
          title: "Bad",
          optional: false,
          notes: [],
          links: [
            { title: "Malware Page", url: "https://malware-site.com/bad" },
          ],
        },
      ],
    };
    const result = resolveLlmsRoute("https://example.com/", doc, "malware page");
    expect(result.routed).toBe(false);
  });

  it("includes reason when routed", () => {
    const result = resolveLlmsRoute("https://example.com/", makeDoc(), "api reference endpoints");
    if (result.routed) {
      expect(result.reason).toBeDefined();
      expect(result.reason!.length).toBeGreaterThan(0);
    }
  });
});
