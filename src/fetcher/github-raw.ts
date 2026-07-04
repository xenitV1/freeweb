import type { Fetcher, FetcherResult, FetcherOptions, FetcherSource } from "./types.js";
import { DEFAULT_FETCHER_OPTIONS, truncateContent } from "./types.js";
import { LRUCache, InflightMap } from "../cache.js";

const RAW_BASE = "https://raw.githubusercontent.com";
const cache = new LRUCache<FetcherResult>(200, 30 * 60 * 1000);
const inflight = new InflightMap<FetcherResult | null>();

function isGitHubUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "github.com" || host === "www.github.com";
  } catch {
    return false;
  }
}

function toRawUrl(githubUrl: string, branch = "main"): string[] {
  try {
    const parsed = new URL(githubUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return [];

    const owner = parts[0];
    const repo = parts[1];

    if (parts.length === 2) {
      // Bare repo root: the default branch is unknown, so try both common
      // defaults (main for newer repos, master for older ones).
      const branches = branch === "main" ? ["main", "master"] : [branch, "main", "master"];
      const uniqueBranches = branches.filter((b, i, arr) => arr.indexOf(b) === i);
      return uniqueBranches.flatMap((b) => [
        `${RAW_BASE}/${owner}/${repo}/${b}/README.md`,
        `${RAW_BASE}/${owner}/${repo}/${b}/readme.md`,
        `${RAW_BASE}/${owner}/${repo}/${b}/Readme.md`,
      ]);
    }

    if (parts[2] === "blob" && parts.length >= 5) {
      const br = parts[3];
      const filePath = parts.slice(4).join("/");
      return [`${RAW_BASE}/${owner}/${repo}/${br}/${filePath}`];
    }

    if (parts[2] === "tree" && parts.length >= 5) {
      const br = parts[3];
      const filePath = parts.slice(4).join("/");
      return [
        `${RAW_BASE}/${owner}/${repo}/${br}/${filePath}/README.md`,
        `${RAW_BASE}/${owner}/${repo}/${br}/${filePath}/readme.md`,
      ];
    }

    return [];
  } catch {
    return [];
  }
}

function stripMarkdown(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/gim, "")
    .replace(/<details>[\s\S]*?<\/details>/gi, "")
    .replace(/<(details|summary|br|hr)\s*\/?>/gi, "")
    .replace(/<img\s+[^>]*alt="([^"]*)"[^>]*\/?>/gi, "$1")
    .replace(/<img\s+[^>]*\/?>/gi, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractTitle(text: string): string {
  const heading = text.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();
  const titleLine = text.match(/^title:\s*(.+)$/im);
  if (titleLine) return titleLine[1].trim();
  return "";
}

export const githubRawFetcher: Fetcher = {
  name: "github-raw",
  priority: 10,

  canHandle(url: string): boolean {
    return isGitHubUrl(url);
  },

  async fetch(url: string, opts?: FetcherOptions): Promise<FetcherResult | null> {
    const maxContentLength = opts?.maxContentLength ?? DEFAULT_FETCHER_OPTIONS.maxContentLength;
    const timeout = opts?.timeout ?? DEFAULT_FETCHER_OPTIONS.timeout;

    const rawUrls = toRawUrl(url);
    if (rawUrls.length === 0) return null;

    const cacheKey = rawUrls[0];
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    return inflight.getOrSet(cacheKey, async () => {
      const start = Date.now();

      for (const rawUrl of rawUrls) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), timeout);
          const res = await fetch(rawUrl, {
            signal: ctrl.signal,
            headers: { "User-Agent": "freeweb-mcp/2.0" },
          });
          clearTimeout(timer);

          if (!res.ok) continue;

          const contentType = res.headers.get("content-type") || "";
          const text = await res.text();
          if (text.length < 20) continue;

          const ms = Date.now() - start;
          const title = extractTitle(text) || new URL(url).pathname.split("/").filter(Boolean).slice(0, 2).join("/");
          const isMarkdown = rawUrl.endsWith(".md") || contentType.includes("text/plain");
          const content = isMarkdown ? stripMarkdown(text) : text;

          const result: FetcherResult = {
            url,
            finalUrl: rawUrl,
            title,
            content: truncateContent(content, maxContentLength),
            isSpa: false,
            contentSource: "github-raw" as FetcherSource,
            fetcherName: "github-raw",
            ms,
          };

          cache.set(cacheKey, result);
          return result;
        } catch {
          continue;
        }
      }

      return null;
    });
  },
};
