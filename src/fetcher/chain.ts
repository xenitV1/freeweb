import type { Fetcher, FetcherResult, FetcherOptions } from "./types.js";
import { markdownFetcher } from "./markdown.js";
import { githubRawFetcher } from "./github-raw.js";
import { rssFetcher } from "./rss.js";
import { httpFetcher } from "./http.js";
import { cacheFetcher } from "./cache.js";
import { playwrightFetcher } from "./playwright.js";

const DEFAULT_CHAIN: Fetcher[] = [
  markdownFetcher,
  githubRawFetcher,
  rssFetcher,
  httpFetcher,
  cacheFetcher,
  playwrightFetcher,
];

const MIN_QUALITY_LENGTH = 800;

function isLowQuality(result: FetcherResult, isLast: boolean): boolean {
  if (isLast) return false;
  if (result.content.length < MIN_QUALITY_LENGTH) return true;
  if (result.isSpa && result.content.length < MIN_QUALITY_LENGTH * 4) return true;
  return false;
}

export async function fetchWithChain(
  url: string,
  opts?: FetcherOptions,
  chain: Fetcher[] = DEFAULT_CHAIN,
): Promise<FetcherResult> {
  const sorted = [...chain].sort((a, b) => a.priority - b.priority);

  let lastError: string | undefined;
  let bestSoFar: FetcherResult | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const fetcher = sorted[i];
    const isLast = i === sorted.length - 1;
    try {
      if (!fetcher.canHandle(url, opts)) continue;
      const result = await fetcher.fetch(url, opts);
      if (!result || result.content.length === 0) continue;

      if (isLowQuality(result, isLast)) {
        if (!bestSoFar || result.content.length > bestSoFar.content.length) {
          bestSoFar = result;
        }
        continue;
      }

      return result;
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Unknown error";
    }
  }

  if (bestSoFar) return bestSoFar;

  throw new Error(
    `All fetchers failed for ${url}${lastError ? `. Last error: ${lastError}` : ""}`,
  );
}

export async function fetchWithChainSoft(
  url: string,
  opts?: FetcherOptions,
  chain: Fetcher[] = DEFAULT_CHAIN,
): Promise<FetcherResult | null> {
  try {
    return await fetchWithChain(url, opts, chain);
  } catch {
    return null;
  }
}

export { DEFAULT_CHAIN };

export {
  markdownFetcher,
  githubRawFetcher,
  rssFetcher,
  httpFetcher,
  cacheFetcher,
  playwrightFetcher,
};

export type { Fetcher, FetcherResult, FetcherOptions, FetcherSource } from "./types.js";
