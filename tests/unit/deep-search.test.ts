import { describe, it, expect, vi, afterEach } from "vitest";
import { deepSearch } from "../../src/deep-search.js";

function jsonResponse(body: unknown, contentType = "application/json") {
  return {
    ok: true,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? contentType : null) },
    json: async () => body,
  } as unknown as Response;
}

const GITHUB_BODY = {
  items: [
    {
      full_name: "tanstack/query",
      html_url: "https://github.com/tanstack/query",
      description: "Powerful asynchronous state management",
      stargazers_count: 42000,
      language: "TypeScript",
      pushed_at: "2026-06-01T00:00:00Z",
    },
  ],
};

const NPM_BODY = {
  objects: [
    {
      package: {
        name: "@tanstack/react-query",
        version: "5.0.0",
        description: "Hooks for fetching, caching",
        date: "2026-05-01T00:00:00.000Z",
        links: { npm: "https://www.npmjs.com/package/@tanstack/react-query" },
      },
    },
  ],
};

const MDN_BODY = {
  documents: [
    { title: "Fetch API", mdn_url: "/en-US/docs/Web/API/Fetch_API", summary: "The Fetch API..." },
  ],
};

function mockFetchRouter() {
  return vi.fn(async (url: string) => {
    if (url.includes("api.github.com")) return jsonResponse(GITHUB_BODY);
    if (url.includes("registry.npmjs.org")) return jsonResponse(NPM_BODY);
    if (url.includes("developer.mozilla.org")) return jsonResponse(MDN_BODY);
    return { ok: false, headers: { get: () => null }, json: async () => ({}) } as unknown as Response;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deepSearch", () => {
  it("parses structured results from all three sources", async () => {
    vi.stubGlobal("fetch", mockFetchRouter());
    const items = await deepSearch("react query", ["github", "npm", "mdn"], 5);

    expect(items).toHaveLength(3);

    const gh = items.find((i) => i.source === "github")!;
    expect(gh.title).toBe("tanstack/query");
    expect(gh.url).toBe("https://github.com/tanstack/query");
    expect(gh.date).toBe("2026-06-01T00:00:00Z");
    expect(gh.meta).toContain("⭐ 42000");
    expect(gh.meta).toContain("TypeScript");

    const npm = items.find((i) => i.source === "npm")!;
    expect(npm.title).toBe("@tanstack/react-query");
    expect(npm.url).toBe("https://www.npmjs.com/package/@tanstack/react-query");
    expect(npm.meta).toBe("v5.0.0");

    const mdn = items.find((i) => i.source === "mdn")!;
    expect(mdn.title).toBe("Fetch API");
    expect(mdn.url).toBe("https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API");
  });

  it("respects the selected source subset", async () => {
    vi.stubGlobal("fetch", mockFetchRouter());
    const items = await deepSearch("x", ["npm"], 5);
    expect(items.every((i) => i.source === "npm")).toBe(true);
  });

  it("returns empty and does not throw when a source returns a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, headers: { get: () => null }, json: async () => ({}) }) as unknown as Response),
    );
    const items = await deepSearch("x", ["github", "npm", "mdn"], 5);
    expect(items).toEqual([]);
  });

  it("survives malformed JSON payloads without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => {
          throw new Error("bad json");
        },
      }) as unknown as Response),
    );
    const items = await deepSearch("x", ["github", "npm", "mdn"], 5);
    expect(items).toEqual([]);
  });

  it("caps results per source", async () => {
    const many = { objects: Array.from({ length: 20 }, (_, i) => ({ package: { name: `p${i}`, version: "1.0.0" } })) };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(many)));
    const items = await deepSearch("x", ["npm"], 3);
    expect(items).toHaveLength(3);
  });
});
