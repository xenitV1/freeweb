import type { Fetcher, FetcherResult, FetcherOptions, FetcherSource } from "./types.js";
import { DEFAULT_FETCHER_OPTIONS, truncateContent } from "./types.js";
import { LRUCache, InflightMap } from "../cache.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const cache = new LRUCache<FetcherResult>(300, 20 * 60 * 1000);
const inflight = new InflightMap<FetcherResult | null>();

function extractMainContent(html: string): { title: string; text: string; selector: string } | null {
  try {
    const jsdom = require("jsdom");
    const { JSDOM } = jsdom;
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const title = doc.title || "";

    const selectors = [
      "article", "main", '[role="main"]', "#mw-content-text",
      ".content", ".post-content", ".article-content",
      "#content", ".markdown-body", ".readme",
    ];

    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el && el.textContent.trim().length > 100) {
        return { title, text: el.textContent.trim(), selector: sel };
      }
    }

    const bodyText = doc.body?.textContent?.trim();
    if (bodyText && bodyText.length > 100) {
      return { title, text: bodyText, selector: "body" };
    }
  } catch {}
  return null;
}

function detectSpa(html: string): boolean {
  return /__next|data-reactroot|data-v-app|ng-version|<div id="app"/.test(html);
}

function extractLinksFromHtml(html: string): { text: string; href: string }[] {
  try {
    const jsdom = require("jsdom") as { JSDOM: typeof import("jsdom").JSDOM };
    const { JSDOM } = jsdom;
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    return Array.from(doc.querySelectorAll("a[href]"))
      .map((el: Element) => ({
        text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 100),
        href: (el as HTMLAnchorElement).href,
      }))
      .filter((l) => l.href.startsWith("http") && l.text.length > 2);
  } catch {
    return [];
  }
}

export const httpFetcher: Fetcher = {
  name: "http-jsdom",
  priority: 40,

  canHandle(_url: string): boolean {
    return true;
  },

  async fetch(url: string, opts?: FetcherOptions): Promise<FetcherResult | null> {
    const maxContentLength = opts?.maxContentLength ?? DEFAULT_FETCHER_OPTIONS.maxContentLength;
    const timeout = opts?.timeout ?? DEFAULT_FETCHER_OPTIONS.timeout;
    const shouldExtractLinks = opts?.extractLinks ?? DEFAULT_FETCHER_OPTIONS.extractLinks;

    const cached = cache.get(url);
    if (cached) return cached;

    return inflight.getOrSet(url, async () => {
      const start = Date.now();

      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout);
        const res = await fetch(url, {
          signal: ctrl.signal,
          redirect: "follow",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain,*/*;q=0.1",
            "Accept-Language": "en-US,en;q=0.9",
          },
        });
        clearTimeout(timer);

        if (!res.ok) return null;

        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/xhtml")) {
          return null;
        }

        const html = await res.text();
        if (html.length < 200) return null;

        const content = extractMainContent(html);
        if (!content) return null;

        const isSpa = detectSpa(html);
        const links = shouldExtractLinks ? extractLinksFromHtml(html) : undefined;
        const ms = Date.now() - start;

        const result: FetcherResult = {
          url,
          finalUrl: res.url || url,
          title: content.title,
          content: truncateContent(content.text, maxContentLength),
          isSpa,
          contentSource: "http-jsdom" as FetcherSource,
          links,
          fetcherName: "http-jsdom",
          ms,
        };

        cache.set(url, result);
        return result;
      } catch {
        return null;
      }
    });
  },
};
