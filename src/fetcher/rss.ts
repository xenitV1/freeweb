import type { Fetcher, FetcherResult, FetcherOptions, FetcherSource } from "./types.js";
import { DEFAULT_FETCHER_OPTIONS, truncateContent } from "./types.js";
import { LRUCache, InflightMap } from "../cache.js";

const cache = new LRUCache<FetcherResult>(200, 30 * 60 * 1000);
const inflight = new InflightMap<FetcherResult | null>();

const FEED_PATHS = ["/feed.xml", "/rss.xml", "/atom.xml", "/feed/", "/rss/", "/index.xml"];

function stripTags(xml: string): string {
  return xml.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}

function extractFeedTitle(xml: string): string {
  const match = xml.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)
    || xml.match(/<title[^>]*>([\s\S]*?)<\/title>/);
  return match ? stripTags(match[1]).slice(0, 100) : "";
}

function extractFeedItems(xml: string): { title: string; url: string; snippet: string }[] {
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/g)
    || xml.match(/<entry[\s\S]*?<\/entry>/g)
    || [];

  return itemBlocks.slice(0, 25).map((block) => {
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    const linkMatch = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/)
      || block.match(/<link>([^<]+)<\/link>/);
    const descMatch = block.match(/<description[^>]*>([\s\S]*?)<\/description>/)
      || block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)
      || block.match(/<content[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/content>/);

    return {
      title: titleMatch ? stripTags(titleMatch[1]).slice(0, 120) : "",
      url: linkMatch ? linkMatch[1] : "",
      snippet: descMatch ? stripTags(descMatch[1]).slice(0, 300) : "",
    };
  }).filter((item) => item.title || item.url);
}

function looksLikeFeed(text: string): boolean {
  return text.includes("<rss") || text.includes("<feed") || text.includes("<channel");
}

export const rssFetcher: Fetcher = {
  name: "rss",
  priority: 30,

  canHandle(url: string): boolean {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      return /\/(blog|feed|rss|news|articles?|posts?)\/?$/.test(pathname)
        || pathname.includes("/feed")
        || pathname.includes("/rss")
        || pathname.endsWith(".xml");
    } catch {
      return false;
    }
  },

  async fetch(url: string, opts?: FetcherOptions): Promise<FetcherResult | null> {
    const maxContentLength = opts?.maxContentLength ?? DEFAULT_FETCHER_OPTIONS.maxContentLength;
    const timeout = opts?.timeout ?? DEFAULT_FETCHER_OPTIONS.timeout;

    const cached = cache.get(url);
    if (cached) return cached;

    const candidates = FEED_PATHS.map((p) => {
      try {
        const base = new URL(url);
        base.pathname = p;
        return base.toString();
      } catch {
        return "";
      }
    }).filter(Boolean);

    return inflight.getOrSet(url, async () => {
      const start = Date.now();

      for (const feedUrl of candidates) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), timeout);
          const res = await fetch(feedUrl, {
            signal: ctrl.signal,
            headers: { Accept: "application/rss+xml, application/atom+xml, text/xml, */*" },
          });
          clearTimeout(timer);

          if (!res.ok) continue;

          const xml = await res.text();
          if (!looksLikeFeed(xml)) continue;

          const title = extractFeedTitle(xml);
          const items = extractFeedItems(xml);
          if (items.length === 0) continue;

          const content = items.map((item, i) => {
            let line = `[${i + 1}] ${item.title}`;
            if (item.url) line += `\n    ${item.url}`;
            if (item.snippet) line += `\n    ${item.snippet.slice(0, 150)}`;
            return line;
          }).join("\n\n");

          const ms = Date.now() - start;
          const result: FetcherResult = {
            url,
            finalUrl: feedUrl,
            title: title || `Feed (${items.length} items)`,
            content: truncateContent(content, maxContentLength),
            isSpa: false,
            contentSource: "rss" as FetcherSource,
            fetcherName: "rss",
            ms,
          };

          cache.set(url, result);
          return result;
        } catch {
          continue;
        }
      }

      return null;
    });
  },
};
