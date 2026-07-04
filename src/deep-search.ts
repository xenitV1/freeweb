// Deep search over curated developer sources via their free JSON APIs.
// No browser, no API keys — each source has a public JSON endpoint that
// returns structured, parseable results (unlike scraping SPA search pages,
// which yields filter-sidebar noise for GitHub and nothing for MDN).

export type DeepSearchSource = "github" | "npm" | "mdn";

export interface DeepSearchItem {
  source: DeepSearchSource;
  title: string;
  url: string;
  content: string;
  date?: string;
  meta?: string;
}

const USER_AGENT =
  "Mozilla/5.0 (compatible; freeweb-mcp/3; +https://github.com/xenitV1/freeweb)";

async function fetchJson(
  url: string,
  timeout = 8000,
  extraHeaders: Record<string, string> = {},
): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        ...extraHeaders,
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("json")) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function searchGithub(query: string, limit: number): Promise<DeepSearchItem[]> {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(
    query,
  )}&sort=updated&order=desc&per_page=${limit}`;
  const data = await fetchJson(url, 8000, { Accept: "application/vnd.github+json" });
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.slice(0, limit).map((o: any): DeepSearchItem => {
    const parts: string[] = [];
    if (typeof o.stargazers_count === "number") parts.push(`⭐ ${o.stargazers_count}`);
    if (o.language) parts.push(String(o.language));
    return {
      source: "github",
      title: o.full_name || o.name || "",
      url: o.html_url || "",
      content: o.description || "",
      date: o.pushed_at || o.updated_at || undefined,
      meta: parts.join(" · ") || undefined,
    };
  }).filter((r: DeepSearchItem) => r.title && r.url);
}

async function searchNpm(query: string, limit: number): Promise<DeepSearchItem[]> {
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(
    query,
  )}&size=${limit}`;
  const data = await fetchJson(url);
  const objects = Array.isArray(data?.objects) ? data.objects : [];
  return objects.slice(0, limit).map((entry: any): DeepSearchItem => {
    const p = entry.package || {};
    return {
      source: "npm",
      title: p.name || "",
      url: p.links?.npm || (p.name ? `https://www.npmjs.com/package/${p.name}` : ""),
      content: p.description || "",
      date: p.date || undefined,
      meta: p.version ? `v${p.version}` : undefined,
    };
  }).filter((r: DeepSearchItem) => r.title && r.url);
}

async function searchMdn(query: string, limit: number): Promise<DeepSearchItem[]> {
  const url = `https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(
    query,
  )}&locale=en-US`;
  const data = await fetchJson(url);
  const docs = Array.isArray(data?.documents) ? data.documents : [];
  return docs.slice(0, limit).map((o: any): DeepSearchItem => ({
    source: "mdn",
    title: o.title || "",
    url: o.mdn_url ? `https://developer.mozilla.org${o.mdn_url}` : "",
    content: o.summary || "",
    date: undefined,
    meta: undefined,
  })).filter((r: DeepSearchItem) => r.title && r.url);
}

const SOURCE_FETCHERS: Record<
  DeepSearchSource,
  (query: string, limit: number) => Promise<DeepSearchItem[]>
> = {
  github: searchGithub,
  npm: searchNpm,
  mdn: searchMdn,
};

export async function deepSearch(
  query: string,
  sources: DeepSearchSource[],
  perSource = 5,
): Promise<DeepSearchItem[]> {
  const batches = await Promise.all(
    sources.map((s) => SOURCE_FETCHERS[s]?.(query, perSource) ?? Promise.resolve([])),
  );
  return batches.flat();
}
