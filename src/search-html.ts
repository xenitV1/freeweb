export interface RawSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function parseYahooHtml(html: string): RawSearchResult[] {
  const results: RawSearchResult[] = [];

  const titleMatches = [...html.matchAll(/class="title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const snippetMatches = [...html.matchAll(/class="compText[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p|span)>/gi)];

  for (let i = 0; i < titleMatches.length; i++) {
    let href = titleMatches[i][1];
    if (href.includes("r.search.yahoo.com")) {
      const ru = href.match(/RU=([^&]+)/);
      if (ru) href = decodeURIComponent(ru[1]);
    }
    if (!href || href.startsWith("/") || href.includes("yahoo.com/search")) continue;

    const title = stripHtml(titleMatches[i][2]);
    if (!title) continue;

    const rawSnippet = snippetMatches[i]?.[1] || "";
    results.push({ title, url: href, snippet: stripHtml(rawSnippet) });
  }

  if (results.length === 0) {
    const broadLinks = [...html.matchAll(/<a[^>]*href="(https?:\/\/(?!search\.yahoo\.com)[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    const seen = new Set<string>();
    for (const m of broadLinks) {
      const url = m[1];
      const title = stripHtml(m[2]);
      if (!title || title.length < 5 || seen.has(url)) continue;
      seen.add(url);
      results.push({ title, url, snippet: "" });
      if (results.length >= 15) break;
    }
  }

  return results;
}

export function parseMarginaliaHtml(html: string): RawSearchResult[] {
  const results: RawSearchResult[] = [];
  const cardMatches = [...html.matchAll(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi)];

  for (const m of cardMatches) {
    const url = m[1];
    const title = stripHtml(m[2]);
    if (!title || !url) continue;

    const cardStart = m.index ?? 0;
    const afterCard = html.slice(cardStart, cardStart + 2000);
    const snippetMatch = afterCard.match(/<p[^>]*class="[^"]*mt-2[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
      || afterCard.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : "";

    results.push({ title, url, snippet });
  }

  return results;
}

export function parseAskHtml(html: string): RawSearchResult[] {
  const results: RawSearchResult[] = [];
  const resultMatches = [...html.matchAll(/class="[^"]*result[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*result|$)/gi)];

  for (const m of resultMatches) {
    const block = m[1];
    const linkMatch = block.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    const url = linkMatch[1];
    const title = stripHtml(linkMatch[2]);
    if (!title || !url || url.includes("ask.com")) continue;

    const snippetMatch = block.match(/class="[^"]*(?:abstract|description|snippet)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/i)
      || block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : "";

    results.push({ title, url, snippet });
  }

  return results;
}

export function parseDdgHtml(html: string): RawSearchResult[] {
  const decoded = html.replace(/&amp;/g, "&");
  const results: RawSearchResult[] = [];
  const linkMatches = [...decoded.matchAll(/class="result__a"[^>]*href="([^"]+)"/g)];
  const snippetMatches = [...decoded.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
  const titleMatches = [...decoded.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/g)];

  for (let i = 0; i < linkMatches.length; i++) {
    const href = linkMatches[i][1];
    const uddgMatch = href.match(/uddg=([^&]+)/);
    const cleanUrl = uddgMatch ? decodeURIComponent(uddgMatch[1]) : href;
    if (cleanUrl.includes("duckduckgo.com")) continue;

    const rawTitle = titleMatches[i]?.[1] || "";
    const rawSnippet = snippetMatches[i]?.[1] || "";

    results.push({
      title: stripHtml(rawTitle),
      url: cleanUrl,
      snippet: stripHtml(rawSnippet),
    });
  }

  return results;
}
