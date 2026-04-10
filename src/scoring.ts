import type { WebSearchEngine, WebSearchResult, SearchAttempt } from "./types.js";
import { buildQueryTokens, countQueryHits, cleanSearchText, cleanSearchSnippet } from "./text.js";
import { normalizeSearchResultUrl, normalizeDomainFilter, domainMatches, isInternalSearchEngineUrl } from "./url.js";
import { isUrlSafe } from "./security.js";
import { extractDateHint, checkDateFreshness } from "./dates.js";
import { TRUSTED_DOMAINS, LOW_QUALITY_DOMAINS } from "./constants.js";

export function getDomainScore(host: string): number {
  if (LOW_QUALITY_DOMAINS.some((domain) => domainMatches(host, domain))) return -14;

  let score = 0;
  if (TRUSTED_DOMAINS.some((domain) => domainMatches(host, domain))) score += 12;
  if (host.endsWith(".gov") || host.endsWith(".edu")) score += 6;
  if (host.endsWith(".org")) score += 3;
  if (host.includes("docs") || host.startsWith("developer.")) score += 5;
  if (host.includes("blog")) score += 1;
  return score;
}

export function scoreSearchResult(query: string, result: { title: string; url: string; snippet: string; host: string; engine: WebSearchEngine }, domain?: string, maxAgeMonths = 18): { score: number; publishedDate?: string; freshnessWarning?: string } {
  const tokens = buildQueryTokens(query);
  const titleHits = countQueryHits(result.title, tokens);
  const snippetHits = countQueryHits(result.snippet, tokens);
  const urlHits = countQueryHits(result.url, tokens);

  let score = result.engine === "yahoo" ? 28 : result.engine === "marginalia" ? 20 : result.engine === "duckduckgo" ? 15 : 8;
  score += titleHits * 8;
  score += snippetHits * 3;
  score += urlHits * 2;
  score += getDomainScore(result.host);

  if (domainMatches(result.host, normalizeDomainFilter(domain))) score += 25;
  if (result.snippet.length >= 140) score += 3;
  else if (result.snippet.length >= 60) score += 1;

  if (/\b(docs?|documentation|guide|tutorial|reference|official)\b/i.test(`${result.title} ${result.snippet}`)) score += 3;

  const publishedDate = extractDateHint(result.snippet);
  let freshnessWarning: string | undefined;
  if (publishedDate) {
    const freshness = checkDateFreshness(publishedDate, maxAgeMonths);
    if (freshness.isFresh) score += 5;
    else {
      score -= 6;
      freshnessWarning = freshness.warning;
    }
  }

  return { score, publishedDate, freshnessWarning };
}

export function mergeSearchResults(existing: WebSearchResult | undefined, incoming: WebSearchResult): WebSearchResult {
  if (!existing) return incoming;
  const winner = existing.score >= incoming.score ? existing : incoming;
  const loser = winner === existing ? incoming : existing;

  return {
    ...winner,
    snippet: winner.snippet || loser.snippet,
    publishedDate: winner.publishedDate || loser.publishedDate,
    freshnessWarning: winner.freshnessWarning || loser.freshnessWarning,
  };
}

export function normalizeEngineResults(query: string, rawResults: { title: string; url: string; snippet: string }[], engine: WebSearchEngine, domain?: string, maxAgeMonths = 18): WebSearchResult[] {
  const normalizedDomain = normalizeDomainFilter(domain);
  const seen = new Set<string>();

  return rawResults
    .map((result) => {
      const title = cleanSearchText(result.title);
      const url = normalizeSearchResultUrl(result.url);
      const snippet = cleanSearchSnippet(result.snippet, title);
      const host = (() => {
        try {
          return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
        } catch {
          return "";
        }
      })();

      const scoring = scoreSearchResult(query, { title, url, snippet, host, engine }, normalizedDomain, maxAgeMonths);
      return {
        title,
        url,
        snippet,
        host,
        engine,
        score: scoring.score,
        publishedDate: scoring.publishedDate,
        freshnessWarning: scoring.freshnessWarning,
      } satisfies WebSearchResult;
    })
    .filter((result) => result.title.length > 2 && result.url && result.host)
    .filter((result) => !isInternalSearchEngineUrl(result.url))
    .filter((result) => isUrlSafe(result.url).safe)
    .filter((result) => {
      if (seen.has(result.url)) return false;
      seen.add(result.url);
      return true;
    })
    .sort((a, b) => b.score - a.score);
}

export function formatAttemptSummary(attempts: SearchAttempt[]): string {
  return attempts.map((attempt) => {
    if (attempt.status === "ok") return `${attempt.engine}:${attempt.count}`;
    if (attempt.status === "blocked") return `${attempt.engine}:blocked`;
    return `${attempt.engine}:0`;
  }).join(", ");
}
