import { WEB_SEARCH_ENGINES } from "./constants.js";
import type { WebSearchEngine, WebSearchMode } from "./types.js";

export function normalizeDomainFilter(domain?: string): string | undefined {
  if (!domain) return undefined;
  return domain
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase() || undefined;
}

export function domainMatches(host: string, domain?: string): boolean {
  if (!domain) return false;
  return host === domain || host.endsWith(`.${domain}`);
}

export function buildWebSearchUrl(query: string, engine: WebSearchEngine, domain?: string): string {
  const normalizedDomain = normalizeDomainFilter(domain);
  const effectiveQuery = normalizedDomain && !query.includes("site:") ? `site:${normalizedDomain} ${query}` : query;

  switch (engine) {
    case "yahoo": {
      const url = new URL("https://search.yahoo.com/search");
      url.searchParams.set("p", effectiveQuery);
      return url.toString();
    }
    case "ask": {
      const url = new URL("https://www.ask.com/web");
      url.searchParams.set("q", effectiveQuery);
      return url.toString();
    }
    case "marginalia": {
      const url = new URL("https://search.marginalia.nu/search");
      url.searchParams.set("query", effectiveQuery);
      return url.toString();
    }
    case "duckduckgo": {
      const url = new URL("https://html.duckduckgo.com/html/");
      url.searchParams.set("q", effectiveQuery);
      return url.toString();
    }
  }
}

export function getWebSearchOrder(engine: WebSearchMode): WebSearchEngine[] {
  if (engine === "auto") return [...WEB_SEARCH_ENGINES];
  return [engine, ...WEB_SEARCH_ENGINES.filter((candidate) => candidate !== engine)];
}

export function normalizeSearchResultUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();

    if (hostname.startsWith("r.search.yahoo.com")) {
      const target = parsed.searchParams.get("RU");
      if (target) return decodeURIComponent(target);
    }

    if (hostname.includes("google.") && parsed.pathname === "/url") {
      const target = parsed.searchParams.get("q");
      if (target) return target;
    }

    if (hostname.endsWith("duckduckgo.com") && parsed.pathname.startsWith("/l/")) {
      const target = parsed.searchParams.get("uddg");
      if (target) return decodeURIComponent(target);
    }

    const cleaned = new URL(parsed.toString());
    [
      "ad", "qo", "o", "origq", "ueid", "fr", "fr2", "guccounter", "guce_referrer", "guce_referrer_sig",
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "ref_src",
    ].forEach((key) => {
      cleaned.searchParams.delete(key);
    });
    cleaned.hash = "";

    return cleaned.toString();
  } catch {
    return rawUrl;
  }
}

export function normalizeComparableUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export function isSameSiteUrl(baseUrl: string, candidateUrl: string): boolean {
  try {
    const baseHost = new URL(baseUrl).hostname.toLowerCase().replace(/^www\./, "");
    const candidateHost = new URL(candidateUrl).hostname.toLowerCase().replace(/^www\./, "");
    return domainMatches(candidateHost, baseHost) || domainMatches(baseHost, candidateHost);
  } catch {
    return false;
  }
}

export function deriveRouteTargetUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.pathname.endsWith(".html.md")) {
      parsed.pathname = parsed.pathname.slice(0, -3);
      return parsed.toString();
    }
    if (parsed.pathname.endsWith(".md")) {
      parsed.pathname = parsed.pathname.slice(0, -3);
      return parsed.toString();
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export function isInternalSearchEngineUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    if (hostname === "search.yahoo.com" && pathname === "/search") return true;
    if ((hostname === "www.ask.com" || hostname === "ask.com") && pathname.startsWith("/web")) return true;
    if ((hostname === "search.marginalia.nu" || hostname === "marginalia-search.com") && pathname.startsWith("/search")) return true;
    return false;
  } catch {
    return true;
  }
}
