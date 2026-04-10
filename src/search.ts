import type { WebSearchResult, SearchCollection, SearchAttempt, WebSearchMode } from "./types.js";
import { buildWebSearchUrl, getWebSearchOrder, normalizeDomainFilter } from "./url.js";
import { normalizeEngineResults, mergeSearchResults, formatAttemptSummary } from "./scoring.js";
import { formatDateForDisplay } from "./dates.js";
import { detectSearchBlock } from "./browse.js";
import { findLlmsTxt } from "./llms.js";
import { browserManager } from "./browser.js";
import { parseSearchResults, genContextId } from "./utils.js";

export async function collectWebSearchResults(
  query: string,
  engine: WebSearchMode,
  domain?: string,
  maxResults = 5,
  maxAgeMonths = 18,
): Promise<SearchCollection> {
  const ctxId = genContextId();
  const attempts: SearchAttempt[] = [];
  const merged = new Map<string, WebSearchResult>();

  try {
    for (const currentEngine of getWebSearchOrder(engine)) {
      const page = await browserManager.openPage(ctxId);
      const searchUrl = buildWebSearchUrl(query, currentEngine, domain);

      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(currentEngine === "marginalia" ? 5000 : 3500);

      const blockedReason = await detectSearchBlock(page);
      if (blockedReason) {
        attempts.push({ engine: currentEngine, status: "blocked", reason: blockedReason });
        await page.close().catch(() => {});
        continue;
      }

      const rawResults = await parseSearchResults(page);
      await page.close().catch(() => {});

      const normalized = normalizeEngineResults(query, rawResults, currentEngine, domain, maxAgeMonths);
      if (normalized.length === 0) {
        attempts.push({ engine: currentEngine, status: "empty" });
        continue;
      }

      attempts.push({ engine: currentEngine, status: "ok", count: normalized.length });
      for (const result of normalized) {
        merged.set(result.url, mergeSearchResults(merged.get(result.url), result));
      }

      const ranked = [...merged.values()].sort((a, b) => b.score - a.score);
      if (engine !== "auto") {
        return { results: ranked, attempts };
      }

      if (currentEngine === "yahoo" && ranked.length >= maxResults + 2) break;
      if (currentEngine === "marginalia" && ranked.length >= maxResults) break;
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
