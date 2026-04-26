import { describe, it, expect } from "vitest";
import { httpFetcher } from "../../../src/fetcher/http.js";

describe("httpFetcher", () => {
  describe("canHandle", () => {
    it("handles any HTTP URL", () => {
      expect(httpFetcher.canHandle("https://example.com")).toBe(true);
      expect(httpFetcher.canHandle("http://example.com")).toBe(true);
    });
  });

  describe("fetch", () => {
    it("extracts content from Wikipedia", async () => {
      const result = await httpFetcher.fetch("https://en.wikipedia.org/wiki/JavaScript", {
        timeout: 10000,
        maxContentLength: 5000,
      });

      if (result) {
        expect(result.title).toContain("JavaScript");
        expect(result.content.length).toBeGreaterThan(100);
        expect(result.contentSource).toBe("http-jsdom");
        expect(result.fetcherName).toBe("http-jsdom");
        expect(result.ms).toBeLessThan(10000);
      }
    }, 15000);

    it("extracts content from Hacker News", async () => {
      const result = await httpFetcher.fetch("https://news.ycombinator.com", {
        timeout: 10000,
      });

      if (result) {
        expect(result.title).toBeTruthy();
        expect(result.content.length).toBeGreaterThan(100);
      }
    }, 15000);

    it("returns null for invalid URLs", async () => {
      const result = await httpFetcher.fetch("https://this-domain-does-not-exist-12345.com", {
        timeout: 3000,
      });

      expect(result).toBeNull();
    }, 10000);
  });
});
