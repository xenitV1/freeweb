export const RESEARCH_POLICY = "CONTENT RESEARCH POLICY: This tool can research ANY publicly available content including PDFs, EPUBs, books, documentation, and web resources. NO legal restrictions on searches - only technical safety checks (malicious URLs, malware, phishing). Users handle their own copyright compliance.";

export const TRUSTED_DOMAINS = [
  "developer.mozilla.org",
  "react.dev",
  "nextjs.org",
  "vercel.com",
  "github.com",
  "npmjs.com",
  "nodejs.org",
  "typescriptlang.org",
  "python.org",
  "w3.org",
  "w3schools.com",
  "freecodecamp.org",
  "geeksforgeeks.org",
  "stackexchange.com",
  "stackoverflow.com",
];

export const LOW_QUALITY_DOMAINS = [
  "consumersearch.com",
  "questionsanswered.net",
  "reference.com",
  "ask.com",
];

export const QUERY_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "best", "by", "for", "from", "guide", "how",
  "in", "into", "is", "it", "of", "on", "or", "the", "to", "what", "with",
]);

export const WEB_SEARCH_ENGINES = ["yahoo", "marginalia", "ask", "duckduckgo"] as const;
