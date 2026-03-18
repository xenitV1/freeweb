interface LlmsLink {
  title: string;
  url: string;
  note?: string;
}

interface LlmsSection {
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

const MAX_LLMS_BYTES = 60_000;
const FETCH_TIMEOUT_MS = 3_500;
const llmsCache = new Map<string, LlmsDocument | null>();
const llmsInflight = new Map<string, Promise<LlmsDocument | null>>();

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

function parseListLine(content: string): { link?: LlmsLink; note?: string } {
  const cleaned = cleanText(content.replace(/^[-*+]\s+/, ""));
  if (!cleaned) return {};

  const markdownLink = cleaned.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)(?::\s*(.+))?$/i);
  if (markdownLink) {
    return {
      link: {
        title: stripMarkdown(markdownLink[1]),
        url: normalizeUrlCandidate(markdownLink[2]),
        note: markdownLink[3] ? stripMarkdown(markdownLink[3]) : undefined,
      },
    };
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

function buildLlmsCandidates(targetUrl: string): string[] {
  const parsed = new URL(targetUrl);
  const segments = parsed.pathname.split("/").filter(Boolean);
  const treatLastAsFile = segments.length > 0 && /\.[a-z0-9]{1,8}$/i.test(segments[segments.length - 1]);
  const pathSegments = treatLastAsFile ? segments.slice(0, -1) : segments;

  const candidates: string[] = [];
  for (let i = pathSegments.length; i >= 0; i -= 1) {
    const prefix = pathSegments.slice(0, i).join("/");
    candidates.push(`${parsed.origin}/${prefix ? `${prefix}/` : ""}llms.txt`);
  }

  return unique(candidates);
}

function parseLlmsTxt(markdown: string, sourceUrl: string): LlmsDocument | null {
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
      const parsed = parseListLine(trimmed);
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
  if (llmsCache.has(candidateUrl)) return llmsCache.get(candidateUrl) ?? null;
  if (llmsInflight.has(candidateUrl)) return llmsInflight.get(candidateUrl)!;

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
      return parseLlmsTxt(text, candidateUrl);
    })
    .catch(() => null)
    .finally(() => {
      clearTimeout(timeout);
      llmsInflight.delete(candidateUrl);
    });

  llmsInflight.set(candidateUrl, promise);
  const result = await promise;
  llmsCache.set(candidateUrl, result);
  return result;
}

export async function findLlmsTxt(targetUrl: string): Promise<LlmsDocument | null> {
  try {
    const candidates = buildLlmsCandidates(targetUrl);
    for (const candidate of candidates) {
      const result = await fetchLlmsCandidate(candidate);
      if (result) return result;
    }
    return null;
  } catch {
    return null;
  }
}

export function formatLlmsGuidance(
  doc: LlmsDocument,
  options: { headingLevel?: 2 | 3 | 4; maxSections?: number; maxNotesPerSection?: number; maxLinksPerSection?: number } = {},
): string {
  const headingLevel = options.headingLevel ?? 2;
  const maxSections = options.maxSections ?? 3;
  const maxNotesPerSection = options.maxNotesPerSection ?? 3;
  const maxLinksPerSection = options.maxLinksPerSection ?? 3;
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

  const optionalSections = doc.sections.filter((section) => section.optional).map((section) => section.title);
  if (optionalSections.length > 0) {
    lines.push(`Optional sections available: ${optionalSections.join(", ")}`);
  }

  return lines.join("\n");
}
