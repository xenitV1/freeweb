import { describe, it, expect } from "vitest";
import { buildWebSearchUrl, normalizeDomainFilter, WEB_SEARCH_ENGINES } from "../../src/lib.js";

describe("buildWebSearchUrl", () => {
  describe("Yahoo URLs", () => {
    it("builds Yahoo URL with query only", () => {
      const url = buildWebSearchUrl("react hooks", "yahoo");
      expect(url).toBe("https://search.yahoo.com/search?p=react+hooks");
    });

    it("builds Yahoo URL with domain filter (site:)", () => {
      const url = buildWebSearchUrl("hooks", "yahoo", "react.dev");
      expect(url).toContain("search.yahoo.com/search");
      const parsed = new URL(url);
      expect(parsed.searchParams.get("p")).toContain("site:react.dev");
      expect(parsed.searchParams.get("p")).toContain("hooks");
    });

    it("does not double site: prefix when query already has site:", () => {
      const url = buildWebSearchUrl("site:react.dev hooks", "yahoo", "react.dev");
      const parsed = new URL(url);
      const query = parsed.searchParams.get("p")!;
      expect(query.match(/site:/g)?.length).toBe(1);
    });

    it("encodes special characters in query", () => {
      const url = buildWebSearchUrl("what is react?", "yahoo");
      const parsed = new URL(url);
      expect(parsed.searchParams.get("p")).toBeTruthy();
    });
  });

  describe("Marginalia URLs", () => {
    it("builds Marginalia URL with query", () => {
      const url = buildWebSearchUrl("react hooks", "marginalia");
      expect(url).toBe("https://search.marginalia.nu/search?query=react+hooks");
    });

    it("builds Marginalia URL with domain filter", () => {
      const url = buildWebSearchUrl("hooks", "marginalia", "react.dev");
      const parsed = new URL(url);
      const query = parsed.searchParams.get("query")!;
      expect(query).toContain("site:react.dev");
      expect(query).toContain("hooks");
    });
  });

  describe("Ask.com URLs", () => {
    it("builds Ask URL with query", () => {
      const url = buildWebSearchUrl("react hooks", "ask");
      expect(url).toContain("www.ask.com/web");
      const parsed = new URL(url);
      expect(parsed.searchParams.get("q")).toBe("react hooks");
    });

    it("builds Ask URL with domain filter", () => {
      const url = buildWebSearchUrl("hooks", "ask", "react.dev");
      const parsed = new URL(url);
      const q = parsed.searchParams.get("q")!;
      expect(q).toContain("site:react.dev");
    });
  });

  describe("URL encoding for special characters", () => {
    it("encodes Turkish characters", () => {
      const url = buildWebSearchUrl("Türkçe arama sonuçları", "yahoo");
      const parsed = new URL(url);
      expect(parsed.searchParams.get("p")).toBeTruthy();
      expect(decodeURIComponent(parsed.searchParams.get("p")!)).toBe("Türkçe arama sonuçları");
    });

    it("encodes Chinese characters", () => {
      const url = buildWebSearchUrl("React 教程", "yahoo");
      const parsed = new URL(url);
      expect(parsed.searchParams.get("p")).toBeTruthy();
    });

    it("encodes special URL characters", () => {
      const url = buildWebSearchUrl("c++ & react >= 18", "yahoo");
      const parsed = new URL(url);
      expect(parsed.searchParams.get("p")).toBeTruthy();
    });

    it("encodes ampersand in query", () => {
      const url = buildWebSearchUrl("react & vue", "yahoo");
      const parsed = new URL(url);
      expect(parsed.searchParams.get("p")).toBe("react & vue");
    });

    it("encodes hash in query", () => {
      const url = buildWebSearchUrl("c# programming", "yahoo");
      const parsed = new URL(url);
      expect(parsed.searchParams.get("p")).toBe("c# programming");
    });
  });

  describe("Double site: prefix prevention", () => {
    it("does not prepend site: when query already contains it", () => {
      const url = buildWebSearchUrl("site:github.com react", "yahoo", "github.com");
      const parsed = new URL(url);
      const p = parsed.searchParams.get("p")!;
      expect(p.match(/site:/g)?.length).toBe(1);
    });

    it("prepends site: when query does not contain it", () => {
      const url = buildWebSearchUrl("react", "yahoo", "github.com");
      const parsed = new URL(url);
      const p = parsed.searchParams.get("p")!;
      expect(p.startsWith("site:github.com")).toBe(true);
    });

    it("handles domain filter without double prefix across all engines", () => {
      for (const engine of WEB_SEARCH_ENGINES) {
        const url = buildWebSearchUrl("site:react.dev hooks", engine, "react.dev");
        const parsed = new URL(url);
        const paramName = engine === "yahoo" ? "p" : engine === "ask" ? "q" : "query";
        const query = parsed.searchParams.get(paramName)!;
        expect(query.match(/site:/g)?.length).toBe(1);
      }
    });
  });

  describe("Domain filter normalization", () => {
    it("strips https:// from domain", () => {
      const url = buildWebSearchUrl("test", "yahoo", "https://example.com");
      const parsed = new URL(url);
      expect(parsed.searchParams.get("p")).toContain("site:example.com");
    });

    it("strips www. from domain", () => {
      const url = buildWebSearchUrl("test", "yahoo", "www.example.com");
      const parsed = new URL(url);
      expect(parsed.searchParams.get("p")).toContain("site:example.com");
    });

    it("strips path from domain", () => {
      const url = buildWebSearchUrl("test", "yahoo", "example.com/some/path");
      const parsed = new URL(url);
      expect(parsed.searchParams.get("p")).toContain("site:example.com");
      expect(parsed.searchParams.get("p")).not.toContain("/some/path");
    });

    it("lowercases domain", () => {
      const url = buildWebSearchUrl("test", "yahoo", "EXAMPLE.COM");
      const parsed = new URL(url);
      expect(parsed.searchParams.get("p")).toContain("site:example.com");
    });
  });
});
