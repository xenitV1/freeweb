import type { WebSearchResult, SearchCollection, SearchAttempt, WebSearchMode } from "./types.js";
import { buildWebSearchUrl, getWebSearchOrder, normalizeDomainFilter } from "./url.js";
import { normalizeEngineResults, mergeSearchResults, formatAttemptSummary } from "./scoring.js";
import { formatDateForDisplay } from "./dates.js";
import { detectSearchBlock } from "./browse.js";
import { findLlmsTxt } from "./llms.js";
import { browserManager } from "./browser.js";
import { parseSearchResults, genContextId } from "./utils.js";
import { parseYahooHtml, parseMarginaliaHtml, parseAskHtml, parseDdgHtml } from "./search-html.js";
import type { RawSearchResult } from "./search-html.js";

const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function httpFetch(url: string, timeoutMs = 8000): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": CHROME_UA },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchYahooHtmlResults(query: string): Promise<RawSearchResult[]> {
  const searchUrl = `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`;
  const html = await httpFetch(searchUrl);
  if (!html) return [];
  return parseYahooHtml(html);
}

async function fetchMarginaliaHtmlResults(query: string): Promise<RawSearchResult[]> {
  const searchUrl = `https://search.marginalia.nu/search?query=${encodeURIComponent(query)}`;
  const html = await httpFetch(searchUrl, 10000);
  if (!html) return [];
  return parseMarginaliaHtml(html);
}

async function fetchAskHtmlResults(query: string): Promise<RawSearchResult[]> {
  const searchUrl = `https://www.ask.com/web?q=${encodeURIComponent(query)}`;
  const html = await httpFetch(searchUrl);
  if (!html) return [];
  return parseAskHtml(html);
}

async function fetchDdgHtmlResults(query: string): Promise<RawSearchResult[]> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await httpFetch(searchUrl);
  if (!html) return [];
  return parseDdgHtml(html);
}

type HtmlFetchFn = (query: string) => Promise<RawSearchResult[]>;

const HTML_FETCHERS: Record<string, HtmlFetchFn> = {
  yahoo: fetchYahooHtmlResults,
  marginalia: fetchMarginaliaHtmlResults,
  ask: fetchAskHtmlResults,
  duckduckgo: fetchDdgHtmlResults,
};

function buildEffectiveQuery(query: string, domain?: string): string {
  const normalizedDomain = normalizeDomainFilter(domain);
  return normalizedDomain && !query.includes("site:") ? `site:${normalizedDomain} ${query}` : query;
}

function mergeAndRank(
  merged: Map<string, WebSearchResult>,
  normalized: WebSearchResult[],
): WebSearchResult[] {
  for (const result of normalized) {
    merged.set(result.url, mergeSearchResults(merged.get(result.url), result));
  }
  return [...merged.values()].sort((a, b) => b.score - a.score);
}

async function tryEngineWithBrowser(
  ctxId: string,
  query: string,
  currentEngine: string,
  domain: string | undefined,
  maxAgeMonths: number,
): Promise<{ rawResults: { title: string; url: string; snippet: string }[]; blocked?: string }> {
  try {
    const page = await browserManager.openPage(ctxId);
    const searchUrl = buildWebSearchUrl(query, currentEngine as "yahoo" | "marginalia" | "ask" | "duckduckgo", domain);

    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 7000 }).catch(() => {});
    await page.waitForTimeout(currentEngine === "marginalia" ? 3000 : 2000);

    const blockedReason = await detectSearchBlock(page);
    if (blockedReason) {
      await page.close().catch(() => {});
      return { rawResults: [], blocked: blockedReason };
    }

    const rawResults = await parseSearchResults(page);
    await page.close().catch(() => {});
    return { rawResults };
  } catch {
    return { rawResults: [], blocked: "Browser unavailable" };
  }
}

export async function collectWebSearchResults(
  query: string,
  engine: WebSearchMode,
  domain?: string,
  maxResults = 5,
  maxAgeMonths = 18,
): Promise<SearchCollection> {
  const attempts: SearchAttempt[] = [];
  const merged = new Map<string, WebSearchResult>();
  const effectiveQuery = buildEffectiveQuery(query, domain);

  let playwrightNeeded = false;

  for (const currentEngine of getWebSearchOrder(engine)) {
    const htmlFetcher = HTML_FETCHERS[currentEngine];
    let rawResults: { title: string; url: string; snippet: string }[] = [];

    if (htmlFetcher) {
      rawResults = await htmlFetcher(effectiveQuery);
    }

    if (rawResults.length === 0) {
      playwrightNeeded = true;
      break;
    }

    const normalized = normalizeEngineResults(query, rawResults, currentEngine as "yahoo" | "marginalia" | "ask" | "duckduckgo", domain, maxAgeMonths);
    if (normalized.length === 0) {
      attempts.push({ engine: currentEngine as "yahoo" | "marginalia" | "ask" | "duckduckgo", status: "empty" });
      continue;
    }

    attempts.push({ engine: currentEngine as "yahoo" | "marginalia" | "ask" | "duckduckgo", status: "ok", count: normalized.length });
    const ranked = mergeAndRank(merged, normalized);
    if (engine !== "auto") return { results: ranked, attempts };
    if (ranked.length >= maxResults) return { results: ranked, attempts };
  }

  if (!playwrightNeeded) {
    return { results: [...merged.values()].sort((a, b) => b.score - a.score), attempts };
  }

  const ctxId = genContextId();
  try {
    const ranked = [...merged.values()].sort((a, b) => b.score - a.score);
    if (ranked.length >= maxResults) return { results: ranked, attempts };

    for (const currentEngine of getWebSearchOrder(engine)) {
      const alreadyOk = attempts.find((a) => a.engine === currentEngine && a.status === "ok");
      if (alreadyOk) continue;

      const { rawResults, blocked } = await tryEngineWithBrowser(
        ctxId, query, currentEngine, domain, maxAgeMonths,
      );

      if (blocked) {
        attempts.push({ engine: currentEngine as "yahoo" | "marginalia" | "ask" | "duckduckgo", status: "blocked", reason: blocked });
        continue;
      }

      const normalized = normalizeEngineResults(query, rawResults, currentEngine as "yahoo" | "marginalia" | "ask" | "duckduckgo", domain, maxAgeMonths);
      if (normalized.length === 0) {
        attempts.push({ engine: currentEngine as "yahoo" | "marginalia" | "ask" | "duckduckgo", status: "empty" });
        continue;
      }

      attempts.push({ engine: currentEngine as "yahoo" | "marginalia" | "ask" | "duckduckgo", status: "ok", count: normalized.length });
      const updated = mergeAndRank(merged, normalized);

      if (engine !== "auto") return { results: updated, attempts };
      if (currentEngine === "yahoo" && updated.length >= maxResults + 2) break;
      if (updated.length >= maxResults) break;
    }

    return { results: [...merged.values()].sort((a, b) => b.score - a.score), attempts };
  } finally {
    await browserManager.closeContext(ctxId);
  }
}

export function formatWebSearchResults(query: string, results: WebSearchResult[], attempts: SearchAttempt[], maxResults: number, domain?: string): string {
  const limited = results.slice(0, maxResults);
  const formatted = limited.map((result, index) => {
    let line = `[${index + 1}] ${result.title}`;
    line += `\n    URL: ${result.url}`;
    line += `\n    Source: ${result.engine}${result.llms ? " 🤖 LLMS.txt" : ""}`;
    if (result.publishedDate) {
      line += `\n    📅 ${formatDateForDisplay(result.publishedDate)}`;
      if (result.freshnessWarning) line += ` ${result.freshnessWarning}`;
    }
    if (result.snippet) line += `\n    ${result.snippet.slice(0, 260)}`;
    return line;
  }).join("\n\n");

  let header = `# Web Search: "${query}"`;
  if (domain) header += `\nDomain: ${normalizeDomainFilter(domain)}`;
  header += `\nResults: ${limited.length} of ${results.length}`;
  if (attempts.length > 0) header += `\nEngines: ${formatAttemptSummary(attempts)}`;

  return `${header}\n\n${formatted}`;
}

export async function enrichResultsWithLlms(results: WebSearchResult[], probeCount: number): Promise<WebSearchResult[]> {
  const probeTargets = results.slice(0, Math.max(0, probeCount));
  if (probeTargets.length === 0) return results;

  const docs = await Promise.all(probeTargets.map(async (result) => ({
    url: result.url,
    doc: await findLlmsTxt(result.url),
  })));
  const docMap = new Map(docs.map((item) => [item.url, item.doc]));

  return results
    .map((result) => {
      const llms = docMap.get(result.url);
      if (!llms) return result;
      return {
        ...result,
        llms,
        score: result.score + 6,
      } satisfies WebSearchResult;
    })
    .sort((a, b) => b.score - a.score);
}
