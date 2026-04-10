const BLOCKED_DOMAINS = [
  "malware", "phishing", "spam", "scam", "hack", "crack", "warez", "pirate",
  "porn", "xxx", "adult", "sex",
];

const BLOCKED_DOWNLOAD_EXTENSIONS = [
  ".zip", ".exe", ".dmg", ".pkg", ".msi", ".apk", ".ipa",
  ".tar", ".gz", ".tgz", ".rar", ".7z", ".bin", ".iso",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt",
];

export { BLOCKED_DOMAINS, BLOCKED_DOWNLOAD_EXTENSIONS };

export function isUrlSafe(url: string): { safe: boolean; reason?: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { safe: false, reason: `Unsafe protocol: ${parsed.protocol}` };
    }
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "[::1]" || hostname === "::1") {
      return { safe: false, reason: "IPv6 loopback not allowed" };
    }
    const privateHosts = ["localhost", "localhost.localdomain"];
    if (privateHosts.includes(hostname)) {
      return { safe: false, reason: "Private hostname not allowed" };
    }
    const hostSegments = new Set(hostname.split("."));
    for (const blocked of BLOCKED_DOMAINS) {
      if (hostSegments.has(blocked)) {
        return { safe: false, reason: `Blocked domain` };
      }
    }
    if (parsed.port && !["80", "443", "8080", "3000", "5000"].includes(parsed.port)) {
      return { safe: false, reason: `Suspicious port` };
    }
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return { safe: false, reason: "IP address not allowed" };
    }
    return { safe: true };
  } catch {
    return { safe: false, reason: "Invalid URL" };
  }
}

export function checkDownloadRequest(url: string): { allowed: boolean; warning?: string } {
  const parsed = new URL(url);
  const pathname = parsed.pathname.toLowerCase();
  const isDownload = pathname.includes("/download/") ||
                     pathname.includes("/releases/download/") ||
                     BLOCKED_DOWNLOAD_EXTENSIONS.some(ext => pathname.endsWith(ext));
  if (isDownload) {
    return { allowed: false, warning: `⚠️ Download link - user permission required` };
  }
  return { allowed: true };
}
