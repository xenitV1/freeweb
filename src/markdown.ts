export interface MarkdownDocument {
  sourceUrl: string;
  title?: string;
  content: string;
}

import { LRUCache, InflightMap } from "./cache.js";

const FETCH_TIMEOUT_MS = 4_000;
const MIN_CONTENT_LENGTH = 120;
const markdownCache = new LRUCache<MarkdownDocument>(300, 20 * 60 * 1000);
const markdownInflight = new InflightMap<MarkdownDocument | null>();

function normalizeTargetUrl(targetUrl: string): string {
  const parsed = new URL(targetUrl);
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString();
}

function cleanText(text: string): string {
  return text
    .replace(/[\u00ad\u200b-\u200f\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildMarkdownCandidates(targetUrl: string): string[] {
  const parsed = new URL(normalizeTargetUrl(targetUrl));
  const origin = parsed.origin;
  const pathname = parsed.pathname;
  const candidates: string[] = [];

  if (pathname.endsWith("/")) {
    candidates.push(`${origin}${pathname}index.html.md`);
  } else if (/\.[a-z0-9]{1,8}$/i.test(pathname)) {
    candidates.push(`${origin}${pathname}.md`);
  } else {
    candidates.push(`${origin}${pathname}/index.html.md`);
    candidates.push(`${origin}${pathname}.md`);
  }

  return Array.from(new Set(candidates));
}

export function looksLikeMarkdown(text: string): boolean {
  const sample = text.slice(0, 400).toLowerCase();
  if (sample.includes("<!doctype html") || sample.includes("<html") || sample.includes("<body")) return false;
  return text.length >= MIN_CONTENT_LENGTH;
}

export function extractMarkdownTitle(text: string): string | undefined {
  const heading = text.match(/^#\s+(.+)$/m);
  if (heading) return cleanText(heading[1]);

  const titleLine = text.match(/^title:\s*(.+)$/im);
  if (titleLine) return cleanText(titleLine[1]);

  return undefined;
}

async function fetchMarkdownCandidate(candidateUrl: string): Promise<MarkdownDocument | null> {
  const cached = markdownCache.get(candidateUrl);
  if (cached) return cached;

  return markdownInflight.getOrSet(candidateUrl, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(candidateUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "Accept": "text/markdown, text/plain, text/*;q=0.9, */*;q=0.1",
          "User-Agent": "freeweb-mcp/1.0 (+https://github.com/xenitV1/freeweb)",
        },
      });
      if (!response.ok) return null;
      const text = await response.text();
      if (!looksLikeMarkdown(text)) return null;
      const result: MarkdownDocument = {
        sourceUrl: candidateUrl,
        title: extractMarkdownTitle(text),
        content: text.trim(),
      };
      markdownCache.set(candidateUrl, result);
      return result;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  });
}

export async function findMarkdownVersion(targetUrl: string): Promise<MarkdownDocument | null> {
  const cacheKey = normalizeTargetUrl(targetUrl);
  const cached = markdownCache.get(cacheKey);
  if (cached) return cached;

  const candidates = buildMarkdownCandidates(cacheKey);
  const results = await Promise.allSettled(
    candidates.map((url) => fetchMarkdownCandidate(url)),
  );

  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      markdownCache.set(cacheKey, r.value);
      return r.value;
    }
  }

  return null;
}
