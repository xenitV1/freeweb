import { QUERY_STOP_WORDS } from "./constants.js";

export function cleanSearchText(text: string): string {
  return text
    .replace(/[\u00ad\u200b-\u200f\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*·\s*/g, " · ")
    .trim();
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cleanSearchSnippet(snippet: string, title: string): string {
  let cleaned = cleanSearchText(snippet)
    .replace(/^\d+\s+more\s*/i, "")
    .replace(/^\s*[-–—:]\s*/, "")
    .trim();

  if (title) {
    const titleRegex = new RegExp(`^${escapeRegExp(cleanSearchText(title))}\\s*[·:-]?\\s*`, "i");
    cleaned = cleaned.replace(titleRegex, "");
  }

  return cleaned;
}

export function buildQueryTokens(query: string): string[] {
  return Array.from(new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9.#+-]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length > 1 && !QUERY_STOP_WORDS.has(token))
  ));
}

export function countQueryHits(text: string, tokens: string[]): number {
  const haystack = text.toLowerCase();
  return tokens.reduce((count, token) => count + (haystack.includes(token) ? 1 : 0), 0);
}
