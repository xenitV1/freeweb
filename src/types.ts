import type { LlmsDocument } from "./llms.js";
import { WEB_SEARCH_ENGINES } from "./constants.js";

export type WebSearchEngine = typeof WEB_SEARCH_ENGINES[number];
export type WebSearchMode = "auto" | WebSearchEngine;
export type SearchAttemptStatus = "ok" | "blocked" | "empty";

export interface SearchAttempt {
  engine: WebSearchEngine;
  status: SearchAttemptStatus;
  reason?: string;
  count?: number;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  engine: WebSearchEngine;
  host: string;
  score: number;
  publishedDate?: string;
  freshnessWarning?: string;
  llms?: LlmsDocument | null;
}

export interface SearchCollection {
  results: WebSearchResult[];
  attempts: SearchAttempt[];
}

export interface BrowsedSearchResult extends WebSearchResult {
  finalUrl: string;
  pageTitle: string;
  excerpt: string;
  pageDate?: string;
  browseError?: string;
  llms?: LlmsDocument | null;
  markdownUrl?: string;
  contentSource?: "html" | "markdown" | "github-raw" | "http-jsdom" | "rss" | "archive-cache" | "playwright";
  fetcherUsed?: string;
  fetcherMs?: number;
  routedByLlms?: boolean;
  routedFromUrl?: string;
  routedReason?: string;
}

export interface LlmsRouteDecision {
  requestUrl: string;
  targetUrl: string;
  routed: boolean;
  reason?: string;
}

export interface RateLimitConfig {
  maxRequestsPerMinute: number;
  cooldownMs: number;
}

export interface RequestContext {
  requestCount: number;
  windowStart: number;
}
