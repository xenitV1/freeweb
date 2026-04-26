import type { Fetcher, FetcherResult, FetcherOptions, FetcherSource } from "./types.js";
import { DEFAULT_FETCHER_OPTIONS, truncateContent } from "./types.js";
import { LRUCache } from "../cache.js";

const cache = new LRUCache<FetcherResult>(100, 60 * 60 * 1000);

function buildArchiveUrl(url: string): string {
  return `https://web.archive.org/web/2024/${url}`;
}

function stripTags(html: string): string {
  return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripTags(match[1]).slice(0, 100) : "";
}

function extractContent(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return stripTags(html).slice(0, 5000);
  return stripTags(bodyMatch[1]).slice(0, 5000);
}

export const cacheFetcher: Fetcher = {
  name: "archive-cache",
  priority: 80,

  canHandle(_url: string): boolean {
    return true;
  },

  async fetch(url: string, opts?: FetcherOptions): Promise<FetcherResult | null> {
    const maxContentLength = opts?.maxContentLength ?? DEFAULT_FETCHER_OPTIONS.maxContentLength;
    const timeout = opts?.timeout ?? DEFAULT_FETCHER_OPTIONS.timeout;

    const cached = cache.get(url);
    if (cached) return cached;

    const start = Date.now();

    const archiveUrl = buildArchiveUrl(url);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      const res = await fetch(archiveUrl, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });
      clearTimeout(timer);

      if (!res.ok) return null;

      const html = await res.text();
      if (html.length < 200) return null;

      const title = extractTitle(html);
      const content = extractContent(html);
      if (content.length < 50) return null;

      const ms = Date.now() - start;
      const result: FetcherResult = {
        url,
        finalUrl: res.url || archiveUrl,
        title,
        content: truncateContent(content, maxContentLength),
        isSpa: false,
        contentSource: "archive-cache" as FetcherSource,
        fetcherName: "archive-cache",
        ms,
      };

      cache.set(url, result);
      return result;
    } catch {
      return null;
    }
  },
};
