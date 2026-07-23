import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isUrlSafe } from "../security.js";

const MAX_REDIRECTS = 5;

const BLOCKED_DNS_REBIND_HOSTS = new Set([
  "localtest.me",
  "metadata.google.internal",
  "metadata",
  "metadata.azure.com",
]);

export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const parts = ip.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
      return true;
    }
    const [a, b] = parts;
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && (b === 0 || b === 2)) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && b >= 18 && b <= 19) return true;
    if (a >= 224) return true;
    return false;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
      return true;
    }
    if (lower.startsWith("ff")) return true;
    const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return isPrivateIp(mapped[1]);
    const mapped2 = lower.match(/^::ffff:0:0(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped2) return isPrivateIp(mapped2[1]);
    if (lower.startsWith("64:ff9b::")) {
      const tail = lower.slice("64:ff9b::".length);
      if (isIP(tail) === 4) return isPrivateIp(tail);
    }
    return false;
  }
  return true;
}

export async function isHostResolvingToPrivate(hostname: string): Promise<boolean> {
  const clean = hostname.replace(/^\[|\]$/g, "");
  if (isIP(clean) !== 0) return isPrivateIp(clean);
  if (BLOCKED_DNS_REBIND_HOSTS.has(clean.toLowerCase())) return true;
  if (clean.toLowerCase().endsWith(".nip.io") || clean.toLowerCase().endsWith(".sslip.io") || clean.toLowerCase().endsWith(".xip.io")) {
    return true;
  }
  try {
    const addrs = await lookup(clean, { all: true });
    if (addrs.length === 0) return true;
    return addrs.some((entry) => isPrivateIp(entry.address));
  } catch {
    return true;
  }
}

export async function validateFetchTarget(url: string): Promise<{ ok: boolean; reason?: string }> {
  const safety = isUrlSafe(url);
  if (!safety.safe) return { ok: false, reason: safety.reason };
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
  if (await isHostResolvingToPrivate(hostname)) {
    return { ok: false, reason: `${hostname} resolves to a private/loopback IP` };
  }
  return { ok: true };
}

export interface SafeFetchInit extends RequestInit {
  maxRedirects?: number;
}

export async function safeFetch(url: string, init: SafeFetchInit = {}): Promise<Response> {
  const maxRedirects = init.maxRedirects ?? MAX_REDIRECTS;
  let currentUrl = url;
  const { maxRedirects: _ignored, ...fetchInit } = init;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validation = await validateFetchTarget(currentUrl);
    if (!validation.ok) {
      throw new Error(`Blocked SSRF target ${currentUrl}: ${validation.reason}`);
    }

    const res = await fetch(currentUrl, { ...fetchInit, redirect: "manual" });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        return res;
      }
      continue;
    }

    return res;
  }

  throw new Error(`Too many redirects (>${maxRedirects}) starting from ${url}`);
}
