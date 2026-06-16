import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchWithChain, fetchWithChainSoft } from "../../../src/fetcher/chain.js";
import type { Fetcher, FetcherResult, FetcherOptions } from "../../../src/fetcher/types.js";

function makeFetcher(name: string, priority: number, result: FetcherResult | null, canHandle = true): Fetcher {
  return {
    name,
    priority,
    canHandle: vi.fn().mockReturnValue(canHandle),
    fetch: vi.fn().mockResolvedValue(result),
  };
}

function makeResult(name: string): FetcherResult {
  return {
    url: "https://example.com",
    finalUrl: "https://example.com",
    title: `Result from ${name}`,
    content: "Test content that is long enough to pass the quality threshold used by the fetcher chain. ".repeat(15),
    isSpa: false,
    contentSource: "http-jsdom",
    fetcherName: name,
    ms: 100,
  };
}

describe("fetchWithChain", () => {
  it("tries fetchers in priority order", async () => {
    const fast = makeFetcher("fast", 10, makeResult("fast"));
    const slow = makeFetcher("slow", 50, makeResult("slow"));

    const result = await fetchWithChain("https://example.com", undefined, [slow, fast]);

    expect(result.fetcherName).toBe("fast");
    expect(fast.fetch).toHaveBeenCalled();
    expect(slow.fetch).not.toHaveBeenCalled();
  });

  it("falls through to next fetcher if first returns null", async () => {
    const fail = makeFetcher("fail", 10, null);
    const pass = makeFetcher("pass", 20, makeResult("pass"));

    const result = await fetchWithChain("https://example.com", undefined, [fail, pass]);

    expect(result.fetcherName).toBe("pass");
    expect(fail.fetch).toHaveBeenCalled();
    expect(pass.fetch).toHaveBeenCalled();
  });

  it("falls through if result has empty content", async () => {
    const empty: FetcherResult = { ...makeResult("empty"), content: "" };
    const good = makeFetcher("good", 20, makeResult("good"));
    const emptyFetcher = makeFetcher("empty", 10, empty);

    const result = await fetchWithChain("https://example.com", undefined, [emptyFetcher, good]);

    expect(result.fetcherName).toBe("good");
  });

  it("skips fetchers that cannot handle the URL", async () => {
    const cannotHandle = makeFetcher("nope", 10, makeResult("nope"), false);
    const canHandle = makeFetcher("yes", 20, makeResult("yes"));

    const result = await fetchWithChain("https://example.com", undefined, [cannotHandle, canHandle]);

    expect(result.fetcherName).toBe("yes");
    expect(cannotHandle.fetch).not.toHaveBeenCalled();
  });

  it("falls through to next fetcher when content is too short", async () => {
    const short: FetcherResult = { ...makeResult("short"), content: "tiny" };
    const shortFetcher = makeFetcher("short", 10, short);
    const good = makeFetcher("good", 50, makeResult("good"));

    const result = await fetchWithChain("https://example.com", undefined, [shortFetcher, good]);

    expect(result.fetcherName).toBe("good");
    expect(good.fetch).toHaveBeenCalled();
  });

  it("falls through when SPA result is below SPA threshold", async () => {
    const spaShort: FetcherResult = { ...makeResult("spaShort"), content: "x".repeat(1000), isSpa: true };
    const spaFetcher = makeFetcher("spaShort", 10, spaShort);
    const browser = makeFetcher("browser", 100, makeResult("browser"));

    const result = await fetchWithChain("https://example.com", undefined, [spaFetcher, browser]);

    expect(result.fetcherName).toBe("browser");
    expect(browser.fetch).toHaveBeenCalled();
  });

  it("keeps SPA result when long enough", async () => {
    const spaGood: FetcherResult = { ...makeResult("spaGood"), content: "x".repeat(4000), isSpa: true };
    const spaFetcher = makeFetcher("spaGood", 40, spaGood);
    const browser = makeFetcher("browser", 100, makeResult("browser"));

    const result = await fetchWithChain("https://example.com", undefined, [spaFetcher, browser]);

    expect(result.fetcherName).toBe("spaGood");
    expect(browser.fetch).not.toHaveBeenCalled();
  });

  it("returns best short result as fallback when no high-quality result exists", async () => {
    const medium: FetcherResult = { ...makeResult("medium"), content: "x".repeat(500), isSpa: true };
    const tiny: FetcherResult = { ...makeResult("tiny"), content: "x".repeat(50), isSpa: true };
    const mediumFetcher = makeFetcher("medium", 40, medium);
    const tinyFetcher = makeFetcher("tiny", 50, tiny);
    const lastFails = makeFetcher("last", 100, null);

    const result = await fetchWithChain("https://example.com", undefined, [mediumFetcher, tinyFetcher, lastFails]);

    expect(result.fetcherName).toBe("medium");
  });

  it("throws if all fetchers fail", async () => {
    const fail1 = makeFetcher("fail1", 10, null);
    const fail2 = makeFetcher("fail2", 20, null);

    await expect(fetchWithChain("https://example.com", undefined, [fail1, fail2]))
      .rejects.toThrow("All fetchers failed");
  });

  it("throws if all fetchers throw", async () => {
    const broken: Fetcher = {
      name: "broken",
      priority: 10,
      canHandle: () => true,
      fetch: vi.fn().mockRejectedValue(new Error("network error")),
    };

    await expect(fetchWithChain("https://example.com", undefined, [broken]))
      .rejects.toThrow("All fetchers failed");
  });

  it("passes options to fetchers", async () => {
    const fetcher = makeFetcher("test", 10, makeResult("test"));
    const opts: FetcherOptions = { query: "test query", maxContentLength: 5000 };

    await fetchWithChain("https://example.com", opts, [fetcher]);

    expect(fetcher.fetch).toHaveBeenCalledWith("https://example.com", opts);
  });
});

describe("fetchWithChainSoft", () => {
  it("returns null instead of throwing", async () => {
    const fail = makeFetcher("fail", 10, null);
    const result = await fetchWithChainSoft("https://example.com", undefined, [fail]);

    expect(result).toBeNull();
  });

  it("returns result when successful", async () => {
    const pass = makeFetcher("pass", 10, makeResult("pass"));
    const result = await fetchWithChainSoft("https://example.com", undefined, [pass]);

    expect(result?.fetcherName).toBe("pass");
  });
});
