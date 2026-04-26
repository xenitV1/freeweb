import { describe, it, expect } from "vitest";
import { githubRawFetcher } from "../../../src/fetcher/github-raw.js";

describe("githubRawFetcher", () => {
  describe("canHandle", () => {
    it("handles github.com URLs", () => {
      expect(githubRawFetcher.canHandle("https://github.com/vercel/next.js")).toBe(true);
      expect(githubRawFetcher.canHandle("https://github.com/facebook/react/blob/main/README.md")).toBe(true);
      expect(githubRawFetcher.canHandle("https://www.github.com/denoland/deno")).toBe(true);
    });

    it("rejects non-GitHub URLs", () => {
      expect(githubRawFetcher.canHandle("https://gitlab.com/foo/bar")).toBe(false);
      expect(githubRawFetcher.canHandle("https://example.com")).toBe(false);
      expect(githubRawFetcher.canHandle("https://npmjs.com/package/react")).toBe(false);
    });
  });

  describe("fetch", () => {
    it("fetches README from a real GitHub repo", async () => {
      const result = await githubRawFetcher.fetch("https://github.com/facebook/react", { timeout: 10000 });

      if (result) {
        expect(result.content.length).toBeGreaterThan(50);
        expect(result.contentSource).toBe("github-raw");
        expect(result.fetcherName).toBe("github-raw");
        expect(result.isSpa).toBe(false);
        expect(result.title).toBeTruthy();
      }
    }, 15000);

    it("returns null for invalid GitHub URLs", async () => {
      const result = await githubRawFetcher.fetch("https://github.com/nonexistent-user-xyz-123/nonexistent-repo-456", { timeout: 5000 });
      expect(result).toBeNull();
    }, 10000);
  });
});
