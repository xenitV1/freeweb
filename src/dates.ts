import { cleanSearchText } from "./text.js";

export function checkDateFreshness(dateStr: string | undefined, maxAgeMonths = 24): { isFresh: boolean; warning: string } {
  if (!dateStr) return { isFresh: true, warning: "" };
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return { isFresh: true, warning: "" };
  const now = new Date();
  const ageMonths = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
  if (ageMonths > maxAgeMonths) {
    return { isFresh: false, warning: `⚠️ OLD: ${ageMonths} months ago (${date.toLocaleDateString("en-US")})` };
  }
  return { isFresh: true, warning: "" };
}

export function extractDateHint(text: string): string | undefined {
  const cleaned = cleanSearchText(text);
  if (!cleaned) return undefined;

  const absolutePatterns = [
    /(\d{4}-\d{2}-\d{2})/,
    /(\d{1,2}\/\d{1,2}\/\d{4})/,
    /((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})/i,
  ];

  for (const pattern of absolutePatterns) {
    const match = cleaned.match(pattern);
    if (match) return match[1];
  }

  const relativeMatch = cleaned.match(/(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/i);
  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();
    const date = new Date();

    if (unit.startsWith("minute")) date.setMinutes(date.getMinutes() - amount);
    else if (unit.startsWith("hour")) date.setHours(date.getHours() - amount);
    else if (unit.startsWith("day")) date.setDate(date.getDate() - amount);
    else if (unit.startsWith("week")) date.setDate(date.getDate() - (amount * 7));
    else if (unit.startsWith("month")) date.setMonth(date.getMonth() - amount);
    else if (unit.startsWith("year")) date.setFullYear(date.getFullYear() - amount);

    return date.toISOString();
  }

  if (/\byesterday\b/i.test(cleaned)) {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return date.toISOString();
  }

  return undefined;
}

export function formatDateForDisplay(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-US");
}
