import type { LlmsDocument } from "./llms.js";
import type { LlmsRouteDecision } from "./types.js";
import { findRelevantLlmsLinks } from "./llms.js";
import { normalizeComparableUrl, deriveRouteTargetUrl, isSameSiteUrl } from "./url.js";
import { isUrlSafe, checkDownloadRequest } from "./security.js";

export function resolveLlmsRoute(url: string, llms: LlmsDocument | null | undefined, query?: string, followLlmsLinks = true): LlmsRouteDecision {
  const requestUrl = normalizeComparableUrl(url);
  if (!followLlmsLinks || !llms || !query) {
    return { requestUrl, targetUrl: requestUrl, routed: false };
  }

  const relevantLinks = findRelevantLlmsLinks(llms, query, { maxLinks: 6, includeOptional: true })
    .map((link) => {
      const targetUrl = deriveRouteTargetUrl(link.url);
      let score = link.score;
      if (isSameSiteUrl(requestUrl, targetUrl)) score += 8;
      if (/\.(html|md)$/i.test(link.url)) score += 2;
      if (/\b(api|reference|docs|guide|tutorial|oauth|auth|get started|quickstart|example)\b/i.test(`${link.title} ${link.note || ""} ${link.sectionTitle}`)) score += 3;
      if (link.optional) score -= 2;
      return { ...link, targetUrl, score };
    })
    .filter((link) => isSameSiteUrl(requestUrl, link.targetUrl))
    .filter((link) => isUrlSafe(link.targetUrl).safe)
    .filter((link) => checkDownloadRequest(link.targetUrl).allowed)
    .sort((a, b) => b.score - a.score);

  const best = relevantLinks[0];
  if (!best) return { requestUrl, targetUrl: requestUrl, routed: false };
  // Require genuine query relevance: a link that only scored on structural
  // priors (non-optional base 6 + same-site 8 = 14) with zero query-token hits
  // must NOT auto-route, otherwise every llms.txt site silently redirects the
  // browse target on an unrelated query.
  if (best.queryHits === 0) return { requestUrl, targetUrl: requestUrl, routed: false };
  if (best.score < 10) return { requestUrl, targetUrl: requestUrl, routed: false };
  if (normalizeComparableUrl(best.targetUrl) === requestUrl) return { requestUrl, targetUrl: requestUrl, routed: false };

  const sectionLabel = best.optional ? `${best.sectionTitle} section` : best.sectionTitle;
  return {
    requestUrl,
    targetUrl: best.targetUrl,
    routed: true,
    reason: `${best.title} (${sectionLabel})`,
  };
}
