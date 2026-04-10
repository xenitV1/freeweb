export interface LlmsLink {
  title: string;
  url: string;
  note?: string;
}

export interface LlmsSection {
  title: string;
  optional: boolean;
  notes: string[];
  links: LlmsLink[];
}

export interface LlmsDocument {
  sourceUrl: string;
  title: string;
  summary?: string;
  introNotes: string[];
  sections: LlmsSection[];
}

export interface LlmsRelevantLink extends LlmsLink {
  sectionTitle: string;
  optional: boolean;
  score: number;
}

import { LRUCache, InflightMap } from "./cache.js";

const MAX_LLMS_BYTES = 60_000;
const FETCH_TIMEOUT_MS = 3_500;
const llmsCache = new LRUCache<LlmsDocument>(500, 30 * 60 * 1000);
const llmsInflight = new InflightMap<LlmsDocument | null>();
const llmsTargetCache = new LRUCache<LlmsDocument>(500, 30 * 60 * 1000);
const QUERY_STOP_WORDS = new Set([
  "a", "an", "and", "api", "are", "as", "at", "be", "best", "by", "docs", "documentation", "for",
  "from", "guide", "how", "in", "into", "is", "it", "of", "on", "or", "reference", "site",
  "the", "this", "to", "what", "with",
]);

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function cleanText(text: string): string {
  return text
    .replace(/[\u00ad\u200b-\u200f\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripMarkdown(text: string): string {
  return cleanText(
    text
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
  );
}

function getHeadingText(line: string, level: number): string | undefined {
  const match = line.match(new RegExp(`^#{${level}}\\s+(.+)$`));
  return match ? stripMarkdown(match[1]) : undefined;
}

function normalizeUrlCandidate(raw: string): string {
  return raw.replace(/[),.;]+$/, "").trim();
}

export function resolveUrl(raw: string, sourceUrl: string): string | null {
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^#/.test(raw)) return null;
  if (!raw || !raw.trim()) return null;
  try {
    const base = new URL(sourceUrl);
    return new URL(raw, base.href).href;
  } catch {
    return null;
  }
}

function normalizeTargetUrl(targetUrl: string): string {
  const parsed = new URL(targetUrl);
  parsed.hash = "";
  return parsed.toString();
}

function buildQueryTokens(query: string): string[] {
  return Array.from(new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9.#+-]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length > 1 && !QUERY_STOP_WORDS.has(token))
  ));
}

function countTokenHits(text: string, tokens: string[]): number {
  const haystack = cleanText(text).toLowerCase();
  return tokens.reduce((count, token) => count + (haystack.includes(token) ? 1 : 0), 0);
}

function parseListLine(content: string, sourceUrl: string): { link?: LlmsLink; note?: string } {
  const cleaned = cleanText(content.replace(/^[-*+]\s+/, ""));
  if (!cleaned) return {};

  const markdownLink = cleaned.match(/^\[([^\]]+)\]\(([^)]+)\)(?::\s*(.+))?$/);
  if (markdownLink) {
    const rawUrl = normalizeUrlCandidate(markdownLink[2]);
    const resolved = resolveUrl(rawUrl, sourceUrl);
    if (resolved) {
      return {
        link: {
          title: stripMarkdown(markdownLink[1]),
          url: resolved,
          note: markdownLink[3] ? stripMarkdown(markdownLink[3]) : undefined,
        },
      };
    }
  }

  const urlMatch = cleaned.match(/https?:\/\/\S+/i);
  if (urlMatch) {
    const url = normalizeUrlCandidate(urlMatch[0]);
    const before = stripMarkdown(cleaned.slice(0, urlMatch.index ?? 0).replace(/[:\-–—]\s*$/, ""));
    const after = stripMarkdown(cleaned.slice((urlMatch.index ?? 0) + urlMatch[0].length).replace(/^\s*[:\-–—]\s*/, ""));
    return {
      link: {
        title: before || new URL(url).hostname.replace(/^www\./, ""),
        url,
        note: after || undefined,
      },
    };
  }

  const relativeMatch = cleaned.match(/^(.+?)(?::\s*(.+))?$/);
  if (relativeMatch) {
    const potentialPath = stripMarkdown(relativeMatch[1]);
    const note = relativeMatch[2] ? stripMarkdown(relativeMatch[2]) : undefined;
    if (/^\.?\/|^\.\.\/|^\/[^/]/.test(potentialPath)) {
      const resolved = resolveUrl(potentialPath, sourceUrl);
      if (resolved) {
        return {
          link: {
            title: potentialPath,
            url: resolved,
            note,
          },
        };
      }
    }
    if (note) {
      return { note };
    }
  }

  return { note: stripMarkdown(cleaned) };
}

function pushUnique(target: string[], value: string): void {
  const cleaned = cleanText(value);
  if (!cleaned) return;
  if (!target.includes(cleaned)) target.push(cleaned);
}

function pushLink(target: LlmsLink[], link: LlmsLink): void {
  const title = cleanText(link.title);
  const url = normalizeUrlCandidate(link.url);
  const note = link.note ? cleanText(link.note) : undefined;
  if (!title || !url) return;
  if (target.some((item) => item.url === url)) return;
  target.push({ title, url, note });
}

export function buildLlmsCandidates(targetUrl: string): string[] {
  const parsed = new URL(targetUrl);
  const segments = parsed.pathname.split("/").filter(Boolean);
  const treatLastAsFile = segments.length > 0 && /\.[a-z0-9]{1,8}$/i.test(segments[segments.length - 1]);
  const pathSegments = treatLastAsFile ? segments.slice(0, -1) : segments;

  const candidates: string[] = [];
  for (let i = pathSegments.length; i >= 0; i -= 1) {
    const prefix = pathSegments.slice(0, i).join("/");
    const base = `${parsed.origin}/${prefix ? `${prefix}/` : ""}`;
    candidates.push(`${base}llms.txt`);
    candidates.push(`${base}llms-full.txt`);
  }

  return unique(candidates);
}

export function parseLlmsTxt(markdown: string, sourceUrl: string): LlmsDocument | null {
  const normalized = markdown.replace(/\r\n/g, "\n").slice(0, MAX_LLMS_BYTES);
  const lines = normalized.split("\n");

  let title = "";
  let summary: string | undefined;
  const introNotes: string[] = [];
  const sections: LlmsSection[] = [];

  let currentSection: LlmsSection | null = null;
  let paragraphBuffer: string[] = [];
  let currentSubheading: string | undefined;

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    const paragraph = stripMarkdown(paragraphBuffer.join(" "));
    paragraphBuffer = [];
    if (!paragraph) return;
    if (currentSection) pushUnique(currentSection.notes, currentSubheading ? `${currentSubheading}: ${paragraph}` : paragraph);
    else pushUnique(introNotes, paragraph);
    currentSubheading = undefined;
  };

  const finalizeSection = () => {
    flushParagraph();
    if (!currentSection) return;
    sections.push({
      title: currentSection.title,
      optional: currentSection.optional,
      notes: unique(currentSection.notes),
      links: currentSection.links,
    });
    currentSection = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const h1 = getHeadingText(trimmed, 1);
    if (h1) {
      if (!title) title = h1;
      flushParagraph();
      continue;
    }

    const h2 = getHeadingText(trimmed, 2);
    if (h2) {
      finalizeSection();
      currentSection = { title: h2, optional: h2.toLowerCase() === "optional", notes: [], links: [] };
      currentSubheading = undefined;
      continue;
    }

    const h3 = getHeadingText(trimmed, 3);
    if (h3) {
      flushParagraph();
      currentSubheading = h3;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteText = stripMarkdown(trimmed.replace(/^>\s?/, ""));
      if (!summary) summary = quoteText;
      else if (currentSection) pushUnique(currentSection.notes, quoteText);
      else pushUnique(introNotes, quoteText);
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      flushParagraph();
      const parsed = parseListLine(trimmed, sourceUrl);
      if (parsed.link) {
        if (!currentSection) currentSection = { title: "Links", optional: false, notes: [], links: [] };
        pushLink(currentSection.links, parsed.link);
      } else if (parsed.note) {
        if (currentSection) pushUnique(currentSection.notes, currentSubheading ? `${currentSubheading}: ${parsed.note}` : parsed.note);
        else pushUnique(introNotes, parsed.note);
      }
      continue;
    }

    paragraphBuffer.push(trimmed);
  }

  finalizeSection();

  if (!title) return null;

  return {
    sourceUrl,
    title,
    summary,
    introNotes: unique(introNotes),
    sections,
  };
}

async function fetchLlmsCandidate(candidateUrl: string): Promise<LlmsDocument | null> {
  const cached = llmsCache.get(candidateUrl);
  if (cached) return cached;

  return llmsInflight.getOrSet(candidateUrl, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(candidateUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "Accept": "text/markdown, text/plain, text/*;q=0.9, */*;q=0.1",
          "User-Agent": "freeweb-mcp/1.0 (+https://github.com/xenitV1/freeweb)",
        },
      });
      if (!response.ok) return null;
      const text = await response.text();
      const result = parseLlmsTxt(text, candidateUrl);
      if (result) llmsCache.set(candidateUrl, result);
      return result;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  });
}

async function fetchLlmsFull(candidateBaseUrl: string, existingDoc: LlmsDocument): Promise<LlmsDocument | null> {
  try {
    const fullUrl = candidateBaseUrl.replace(/llms\.txt$/i, "llms-full.txt");
    if (fullUrl === candidateBaseUrl) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(fullUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "Accept": "text/markdown, text/plain, text/*;q=0.9, */*;q=0.1",
          "User-Agent": "freeweb-mcp/1.0 (+https://github.com/xenitV1/freeweb)",
        },
      });
      if (!response.ok) return null;
      const text = await response.text();
      if (!text || text.length <= existingDoc.sourceUrl.length * 2) return null;
      const fullDoc = parseLlmsTxt(text, fullUrl);
      if (fullDoc) llmsCache.set(fullUrl, fullDoc);
      return fullDoc;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

function shouldTryLlmsFull(doc: LlmsDocument, markdown?: string): boolean {
  if (markdown !== undefined && markdown.length < 200) return true;
  const allText = [doc.summary || "", ...doc.introNotes, ...doc.sections.flatMap((s) => s.notes)].join(" ");
  if (allText.length < 200) return true;
  if (/llms-full\.txt/i.test(allText)) return true;
  return false;
}

export async function findLlmsTxt(targetUrl: string): Promise<LlmsDocument | null> {
  try {
    const cacheKey = normalizeTargetUrl(targetUrl);
    const cached = llmsTargetCache.get(cacheKey);
    if (cached) return cached;

    const candidates = buildLlmsCandidates(cacheKey);
    const llmsOnlyCandidates = candidates.filter((c) => c.endsWith("llms.txt") && !c.endsWith("llms-full.txt"));

    for (const candidate of llmsOnlyCandidates) {
      const result = await fetchLlmsCandidate(candidate);
      if (result) {
        if (shouldTryLlmsFull(result)) {
          const fullDoc = await fetchLlmsFull(candidate, result);
          if (fullDoc) {
            llmsTargetCache.set(cacheKey, fullDoc);
            return fullDoc;
          }
        }
        llmsTargetCache.set(cacheKey, result);
        return result;
      }
    }

    for (const candidate of candidates.filter((c) => c.endsWith("llms-full.txt"))) {
      const result = await fetchLlmsCandidate(candidate);
      if (result) {
        llmsTargetCache.set(cacheKey, result);
        return result;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function findRelevantLlmsLinks(
  doc: LlmsDocument,
  query: string,
  options: { maxLinks?: number; includeOptional?: boolean } = {},
): LlmsRelevantLink[] {
  const maxLinks = options.maxLinks ?? 4;
  const includeOptional = options.includeOptional ?? true;
  const tokens = buildQueryTokens(query);
  if (tokens.length === 0) return [];

  const scored = doc.sections.flatMap((section) => section.links.map((link) => {
    const titleHits = countTokenHits(link.title, tokens);
    const noteHits = countTokenHits(link.note || "", tokens);
    const sectionHits = countTokenHits(section.title, tokens);
    const urlHits = countTokenHits(link.url, tokens);

    let score = section.optional ? 1 : 6;
    score += titleHits * 7;
    score += noteHits * 3;
    score += sectionHits * 3;
    score += urlHits * 2;
    if (/\b(api|reference|docs|guide|tutorial|oauth|auth|installation|getting started)\b/i.test(`${link.title} ${link.note || ""} ${section.title}`)) score += 2;

    return {
      ...link,
      sectionTitle: section.title,
      optional: section.optional,
      score,
    } satisfies LlmsRelevantLink;
  }))
    .filter((link) => link.score > 1)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.optional !== b.optional) return a.optional ? 1 : -1;
      return a.title.localeCompare(b.title);
    });

  const considered = includeOptional ? scored : scored.filter((link) => !link.optional);

  return unique(considered.map((link) => link.url))
    .map((url) => considered.find((link) => link.url === url)!)
    .slice(0, maxLinks);
}

export function formatLlmsGuidance(
  doc: LlmsDocument,
  options: {
    headingLevel?: 2 | 3 | 4;
    maxSections?: number;
    maxNotesPerSection?: number;
    maxLinksPerSection?: number;
    query?: string;
    maxRelevantLinks?: number;
  } = {},
): string {
  const headingLevel = options.headingLevel ?? 2;
  const maxSections = options.maxSections ?? 3;
  const maxNotesPerSection = options.maxNotesPerSection ?? 3;
  const maxLinksPerSection = options.maxLinksPerSection ?? 3;
  const maxRelevantLinks = options.maxRelevantLinks ?? 3;
  const headingPrefix = "#".repeat(headingLevel);

  const lines: string[] = [`${headingPrefix} LLMS.txt Guidance`, `Source: ${doc.sourceUrl}`, `Site: ${doc.title}`];
  if (doc.summary) lines.push(`Summary: ${doc.summary}`);

  const introNotes = doc.introNotes.slice(0, 4);
  if (introNotes.length > 0) {
    lines.push("Notes:");
    for (const note of introNotes) lines.push(`- ${note}`);
  }

  const primarySections = doc.sections.filter((section) => !section.optional).slice(0, maxSections);
  for (const section of primarySections) {
    lines.push(`${headingPrefix}# ${section.title}`);

    for (const note of section.notes.slice(0, maxNotesPerSection)) {
      lines.push(`- ${note}`);
    }

    for (const link of section.links.slice(0, maxLinksPerSection)) {
      lines.push(`- [${link.title}](${link.url})${link.note ? `: ${link.note}` : ""}`);
    }
  }

  if (options.query) {
    const relevantLinks = findRelevantLlmsLinks(doc, options.query, { maxLinks: maxRelevantLinks, includeOptional: true });
    if (relevantLinks.length > 0) {
      lines.push(`${headingPrefix}# Relevant for query`);
      lines.push(`Query: ${options.query}`);
      for (const link of relevantLinks) {
        const optionalLabel = link.optional ? " [Optional]" : "";
        lines.push(`- [${link.title}](${link.url}) — ${link.sectionTitle}${optionalLabel}${link.note ? `: ${link.note}` : ""}`);
      }
    }
  }

  const optionalSections = doc.sections.filter((section) => section.optional).map((section) => section.title);
  if (optionalSections.length > 0) {
    lines.push(`Optional sections available: ${optionalSections.join(", ")}`);
  }

  return lines.join("\n");
}

export function formatLlmsInspection(
  targetUrl: string,
  doc: LlmsDocument,
  options: { query?: string; maxSections?: number; maxNotesPerSection?: number; maxLinksPerSection?: number } = {},
): string {
  const maxSections = options.maxSections ?? 12;
  const maxNotesPerSection = options.maxNotesPerSection ?? 5;
  const maxLinksPerSection = options.maxLinksPerSection ?? 8;

  const lines: string[] = [
    `# LLMS.txt Inspection`,
    `Target: ${targetUrl}`,
    `Found: ${doc.sourceUrl}`,
    `Site: ${doc.title}`,
  ];

  if (doc.summary) lines.push(`Summary: ${doc.summary}`);
  if (doc.introNotes.length > 0) {
    lines.push("", "## Intro Notes");
    for (const note of doc.introNotes.slice(0, 8)) lines.push(`- ${note}`);
  }

  const sections = doc.sections.slice(0, maxSections);
  lines.push("", `## Sections (${doc.sections.length})`);
  for (const section of sections) {
    lines.push(`### ${section.title}${section.optional ? " [Optional]" : ""}`);
    for (const note of section.notes.slice(0, maxNotesPerSection)) {
      lines.push(`- ${note}`);
    }
    for (const link of section.links.slice(0, maxLinksPerSection)) {
      lines.push(`- [${link.title}](${link.url})${link.note ? `: ${link.note}` : ""}`);
    }
  }

  if (options.query) {
    const relevant = findRelevantLlmsLinks(doc, options.query, { maxLinks: 6, includeOptional: true });
    if (relevant.length > 0) {
      lines.push("", `## Relevant Links for Query`, `Query: ${options.query}`);
      for (const link of relevant) {
        lines.push(`- [${link.title}](${link.url}) — ${link.sectionTitle}${link.optional ? " [Optional]" : ""}${link.note ? `: ${link.note}` : ""}`);
      }
    }
  }

  return lines.join("\n");
}
