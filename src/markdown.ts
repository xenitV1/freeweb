export interface MarkdownDocument {
  sourceUrl: string;
  title?: string;
  content: string;
}

const FETCH_TIMEOUT_MS = 4_000;
const MIN_CONTENT_LENGTH = 120;
const markdownCache = new Map<string, MarkdownDocument | null>();
const markdownInflight = new Map<string, Promise<MarkdownDocument | null>>();

function normalizeTargetUrl(targetUrl: string): string {
  const parsed = new URL(targetUrl);
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString();
}

function cleanText(text: string): string {
  return text
    .replace(/[\u00ad\u200b-\u200f\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildMarkdownCandidates(targetUrl: string): string[] {
  const parsed = new URL(normalizeTargetUrl(targetUrl));
  const origin = parsed.origin;
  const pathname = parsed.pathname;
  const candidates: string[] = [];

  if (pathname.endsWith("/")) {
    candidates.push(`${origin}${pathname}index.html.md`);
  } else if (/\.[a-z0-9]{1,8}$/i.test(pathname)) {
    candidates.push(`${origin}${pathname}.md`);
  } else {
    candidates.push(`${origin}${pathname}/index.html.md`);
    candidates.push(`${origin}${pathname}.md`);
  }

  return Array.from(new Set(candidates));
}

function looksLikeMarkdown(text: string): boolean {
  const sample = text.slice(0, 400).toLowerCase();
  if (sample.includes("<!doctype html") || sample.includes("<html") || sample.includes("<body")) return false;
  return text.length >= MIN_CONTENT_LENGTH;
}

function extractMarkdownTitle(text: string): string | undefined {
  const heading = text.match(/^#\s+(.+)$/m);
  if (heading) return cleanText(heading[1]);

  const titleLine = text.match(/^title:\s*(.+)$/im);
  if (titleLine) return cleanText(titleLine[1]);

  return undefined;
}

async function fetchMarkdownCandidate(candidateUrl: string): Promise<MarkdownDocument | null> {
  if (markdownCache.has(candidateUrl)) return markdownCache.get(candidateUrl) ?? null;
  if (markdownInflight.has(candidateUrl)) return markdownInflight.get(candidateUrl)!;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const promise = fetch(candidateUrl, {
    method: "GET",
    redirect: "follow",
    signal: controller.signal,
    headers: {
      "Accept": "text/markdown, text/plain, text/*;q=0.9, */*;q=0.1",
      "User-Agent": "freeweb-mcp/1.0 (+https://github.com/xenitV1/freeweb)",
    },
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const text = await response.text();
      if (!looksLikeMarkdown(text)) return null;
      return {
        sourceUrl: candidateUrl,
        title: extractMarkdownTitle(text),
        content: text.trim(),
      } satisfies MarkdownDocument;
    })
    .catch(() => null)
    .finally(() => {
      clearTimeout(timeout);
      markdownInflight.delete(candidateUrl);
    });

  markdownInflight.set(candidateUrl, promise);
  const result = await promise;
  markdownCache.set(candidateUrl, result);
  return result;
}

export async function findMarkdownVersion(targetUrl: string): Promise<MarkdownDocument | null> {
  const cacheKey = normalizeTargetUrl(targetUrl);
  if (markdownCache.has(cacheKey)) return markdownCache.get(cacheKey) ?? null;

  for (const candidate of buildMarkdownCandidates(cacheKey)) {
    const result = await fetchMarkdownCandidate(candidate);
    if (result) {
      markdownCache.set(cacheKey, result);
      return result;
    }
  }

  markdownCache.set(cacheKey, null);
  return null;
}
