import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { browserManager } from "./browser.js";
import { extractContent, extractLinks, parseSearchResults, extractDate, genContextId } from "./utils.js";
import { Logger, logSession } from "./logger.js";

const server = new McpServer({
  name: "freeweb",
  version: "1.0.0",
});

// ── GÜVENLİK UYARILARI ────────────────────────────────────────────
const SECURITY_WARNING = `
🔒 GÜVENLİK KURALLARI:
• Sadece HTTPS sitelerine gidilir
• Şüpheli/malicious siteler ziyaret edilmez
• Kullanıcı izni olmadan HİÇBİR dosya indirilmez
• Form doldurulmaz, giriş yapılmaz, ödeme yapılmaz
• Kişisel veriler toplanmaz/paylaşılmaz
`;

const BLOCKED_DOMAINS = [
  // Malware/phishing
  "malware", "phishing", "spam", "scam", "hack", "crack", "warez", "pirate",
  // Adult content
  "porn", "xxx", "adult", "sex",
  // Suspicious TLDs
  ".tk", ".ml", ".ga", ".cf", ".gq", ".xyz",
  // Known malicious patterns
  "bit.ly", "tinyurl", "shorturl", "ow.ly", // Shortened URLs can hide malicious destinations
];

const ALLOWED_DOWNLOAD_EXTENSIONS = [".pdf", ".json", ".txt", ".csv", ".xml", ".md", ".html"];

function isUrlSafe(url: string): { safe: boolean; reason?: string } {
  try {
    const parsed = new URL(url);

    // HTTPS kontrolü
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { safe: false, reason: `Güvenli olmayan protokol: ${parsed.protocol}` };
    }

    // Engellenen domain kontrolü
    const hostname = parsed.hostname.toLowerCase();
    for (const blocked of BLOCKED_DOMAINS) {
      if (hostname.includes(blocked)) {
        return { safe: false, reason: `Engellenen domain: ${blocked}` };
      }
    }

    // Şüpheli port
    if (parsed.port && !["80", "443", "8080", "3000", "5000"].includes(parsed.port)) {
      return { safe: false, reason: `Şüpheli port: ${parsed.port}` };
    }

    // IP adresi yerine domain kullanımı öner
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return { safe: false, reason: "IP adresi kullanımı güvenli değil, domain kullanın" };
    }

    return { safe: true };
  } catch {
    return { safe: false, reason: "Geçersiz URL formatı" };
  }
}

function checkDownloadRequest(url: string): { allowed: boolean; warning?: string } {
  const parsed = new URL(url);
  const pathname = parsed.pathname.toLowerCase();

  // İndirme olup olmadığını kontrol et
  const isDownload = pathname.includes("/download/") ||
                     pathname.includes("/releases/download/") ||
                     ALLOWED_DOWNLOAD_EXTENSIONS.some(ext => pathname.endsWith(ext));

  if (isDownload) {
    return {
      allowed: false,
      warning: `⚠️ DİKKAT: Bu URL bir dosya indirme bağlantısı görünüyor.\nURL: ${url}\n\nKullanıcı onayı olmadan dosya indirilemez. Devam etmek için kullanıcıdan açık izin alın.`,
    };
  }

  return { allowed: true };
}

// ── HELPER: SPA için içerik bekle ──────────────────────────────────
async function waitForContent(page: import("playwright").Page, selector: string, timeout = 10000): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout, state: "visible" });
    return true;
  } catch {
    return false;
  }
}

// ── HELPER: Tarihi kontrol et ──────────────────────────────────────
function checkDateFreshness(dateStr: string | undefined, maxAgeMonths = 24): { isFresh: boolean; ageMonths: number; warning: string } {
  if (!dateStr) return { isFresh: true, ageMonths: 0, warning: "" };

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return { isFresh: true, ageMonths: 0, warning: "" };

  const now = new Date();
  const ageMonths = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());

  if (ageMonths > maxAgeMonths) {
    return {
      isFresh: false,
      ageMonths,
      warning: `⚠️ ESKİ İÇERİK: Bu kaynak ${ageMonths} ay önce yayınlanmış (${date.toLocaleDateString("tr-TR")})`,
    };
  }

  return { isFresh: true, ageMonths, warning: "" };
}

// ── TOOL: web_search ──────────────────────────────────────────────
server.tool(
  "web_search",
  "Web'de arama yap. Sonuçlara tarih bilgisi eklenir.",
  {
    query: z.string().describe("Aranacak terim"),
    engine: z.enum(["duckduckgo", "google", "bing"]).optional().default("duckduckgo").describe("Arama motoru"),
    maxResults: z.number().min(1).max(20).optional().default(10).describe("Maksimum sonuç sayısı"),
    yearFilter: z.number().optional().describe("Sadece bu yıldan sonraki sonuçları getir"),
  },
  async ({ query, engine, maxResults, yearFilter }) => {
    const log = new Logger("web_search");
    log.info("Starting search", { query, engine, maxResults, yearFilter });

    let searchQuery = query;
    if (yearFilter) searchQuery = `${query} after:${yearFilter}-01-01`;

    const engines: Record<string, string> = {
      duckduckgo: `https://duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`,
      google: `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&num=${maxResults}&hl=en`,
      bing: `https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}&count=${maxResults}&setlang=en`,
    };

    const url = engines[engine];

    // Güvenlik kontrolü
    const safety = isUrlSafe(url);
    if (!safety.safe) {
      const result = { content: [{ type: "text" as const, text: `🔒 GÜVENLİK: ${safety.reason}\n\nBu arama engellendi.` }] };
      return result;
    }

    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500);

    const results = await parseSearchResults(page);
    log.logSearchResults(engine, query, results);

    if (results.length === 0) {
      const content = await extractContent(page);
      await browserManager.closeContext(ctxId);

      if (content.text.includes("robot") || content.text.includes("unusual traffic") || content.text.includes("persists")) {
        const result = {
          content: [{
            type: "text" as const,
            text: `⚠️ ${engine} bot koruması aktif.\n\nÖneriler:\n- github_search kullan\n- browse_page ile doğrudan site ziyaret et`,
          }],
        };
        log.finish(result);
        return result;
      }

      const result = { content: [{ type: "text" as const, text: `Sonuç bulunamadı.` }] };
      log.finish(result);
      return result;
    }

    await browserManager.closeContext(ctxId);

    // Sonuçları güvenlik kontrolünden geçir
    const safeResults = results.filter(r => isUrlSafe(r.url).safe);
    const formatted = safeResults
      .slice(0, maxResults)
      .map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`)
      .join("\n\n");

    const dateNotice = yearFilter ? `\n\n📅 Filtre: ${yearFilter} ve sonrası` : "";
    const result = { content: [{ type: "text" as const, text: formatted + dateNotice }] };
    log.finish(result);
    return result;
  }
);

// ── TOOL: github_search ───────────────────────────────────────────
server.tool(
  "github_search",
  "GitHub'da repo arar. Son güncelleme tarihi gösterilir.",
  {
    query: z.string().describe("Aranacak terim"),
    type: z.enum(["repos", "code", "issues"]).optional().default("repos").describe("Arama türü"),
    maxResults: z.number().min(1).max(10).optional().default(5).describe("Maksimum sonuç"),
    sortByUpdated: z.boolean().optional().default(true).describe("Son güncellemeye göre sırala"),
  },
  async ({ query, type, maxResults, sortByUpdated }) => {
    const log = new Logger("github_search");
    log.info("Starting GitHub search", { query, type, maxResults, sortByUpdated });

    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    const sortParam = sortByUpdated ? "&s=updated&o=desc" : "";
    const url = `https://github.com/search?q=${encodeURIComponent(query)}&type=${type === "repos" ? "repositories" : type}${sortParam}`;

    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(4000);

    const results = await page.evaluate(() => {
      const items: { title: string; url: string; snippet: string; updatedAt: string; stars: string; language: string }[] = [];

      document.querySelectorAll('[data-testid="results-list"] > div, .repo-list-item').forEach((item) => {
        const titleEl = item.querySelector("a");
        const descEl = item.querySelector("p");
        const dateEl = item.querySelector("relative-time, time, [datetime]");
        const starsEl = item.querySelector('[data-testid="stars-count"], .starring-container span');
        const langEl = item.querySelector('[data-testid="language"], [itemprop="programmingLanguage"]');

        if (titleEl) {
          items.push({
            title: titleEl.textContent?.trim() || "",
            url: `https://github.com${titleEl.getAttribute("href") || ""}`,
            snippet: descEl?.textContent?.trim() || "",
            updatedAt: dateEl?.getAttribute("datetime") || dateEl?.textContent?.trim() || "",
            stars: starsEl?.textContent?.trim() || "",
            language: langEl?.textContent?.trim() || "",
          });
        }
      });

      return items;
    });

    const uniqueResults = results.filter((r, i, arr) => arr.findIndex((x) => x.url === r.url) === i);
    await browserManager.closeContext(ctxId);

    if (uniqueResults.length === 0) {
      const result = { content: [{ type: "text" as const, text: `GitHub'da "${query}" için sonuç bulunamadı.` }] };
      log.finish(result);
      return result;
    }

    const formatted = uniqueResults
      .slice(0, maxResults)
      .map((r, i) => {
        let line = `[${i + 1}] ${r.title}`;
        if (r.language) line += ` (${r.language})`;
        if (r.stars) line += ` ⭐ ${r.stars}`;
        if (r.updatedAt) {
          const dateCheck = checkDateFreshness(r.updatedAt, 12);
          line += `\n    📅 ${new Date(r.updatedAt).toLocaleDateString("tr-TR")}${dateCheck.warning ? " " + dateCheck.warning : ""}`;
        }
        line += `\n    URL: ${r.url}`;
        if (r.snippet) line += `\n    ${r.snippet.slice(0, 100)}`;
        return line;
      })
      .join("\n\n");

    const result = { content: [{ type: "text" as const, text: formatted }] };
    log.finish(result);
    return result;
  }
);

// ── TOOL: browse_page ─────────────────────────────────────────────
server.tool(
  "browse_page",
  "URL ziyaret et. Güvenlik ve tarih kontrolü yapılır.",
  {
    url: z.string().url().describe("Ziyaret edilecek URL"),
    waitFor: z.enum(["domcontentloaded", "load", "networkidle"]).optional().default("networkidle").describe("Bekleme stratejisi"),
    warnIfOlderThanMonths: z.number().optional().default(24).describe("Eski içerik uyarısı (ay)"),
  },
  async ({ url, waitFor, warnIfOlderThanMonths }) => {
    const log = new Logger("browse_page");
    log.info("Browsing page", { url, waitFor, warnIfOlderThanMonths });

    // Güvenlik kontrolü
    const safety = isUrlSafe(url);
    if (!safety.safe) {
      const result = {
        content: [{
          type: "text" as const,
          text: `🔒 GÜVENLİK UYARISI\n\n${safety.reason}\n\nBu URL güvenlik nedeniyle ziyaret edilemez.\n\n${SECURITY_WARNING}`,
        }],
      };
      log.finish(result);
      return result;
    }

    // İndirme kontrolü
    const download = checkDownloadRequest(url);
    if (!download.allowed) {
      const result = {
        content: [{
          type: "text" as const,
          text: download.warning || "",
        }],
      };
      log.finish(result);
      return result;
    }

    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    await page.goto(url, { waitUntil: waitFor, timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3)).catch(() => {});
    await page.waitForTimeout(500);

    const content = await extractContent(page);
    const pageDate = await extractDate(page);

    const finalUrl = page.url();
    await browserManager.closeContext(ctxId);

    let dateWarning = "";
    if (pageDate) {
      const dateCheck = checkDateFreshness(pageDate, warnIfOlderThanMonths);
      if (dateCheck.warning) dateWarning = `\n\n${dateCheck.warning}`;
    }

    const truncated = content.text.length > 15000 ? content.text.slice(0, 15000) + "\n\n[... kesildi]" : content.text;
    const dateInfo = pageDate ? `\n📅 Sayfa Tarihi: ${new Date(pageDate).toLocaleDateString("tr-TR")}` : "";

    const result = {
      content: [{
        type: "text" as const,
        text: `# ${content.title}\n\nURL: ${finalUrl}${dateInfo}${dateWarning}\n\n${truncated}`,
      }],
    };
    log.finish(result);
    return result;
  }
);

// ── TOOL: smart_browse ────────────────────────────────────────────
server.tool(
  "smart_browse",
  "Akıllı sayfa ziyareti: Güvenlik, SPA tespiti, tarih kontrolü.",
  {
    url: z.string().url().describe("Ziyaret edilecek URL"),
    requireFreshContent: z.boolean().optional().default(true).describe("Güncel içerik zorunlu mu"),
    maxAgeMonths: z.number().optional().default(12).describe("Maksimum içerik yaşı (ay)"),
  },
  async ({ url, requireFreshContent, maxAgeMonths }) => {
    const log = new Logger("smart_browse");
    log.info("Smart browsing", { url, requireFreshContent, maxAgeMonths });

    // Güvenlik kontrolü
    const safety = isUrlSafe(url);
    if (!safety.safe) {
      const result = {
        content: [{
          type: "text" as const,
          text: `🔒 GÜVENLİK UYARISI\n\n${safety.reason}\n\n${SECURITY_WARNING}`,
        }],
      };
      log.finish(result);
      return result;
    }

    const download = checkDownloadRequest(url);
    if (!download.allowed) {
      const result = { content: [{ type: "text" as const, text: download.warning || "" }] };
      log.finish(result);
      return result;
    }

    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});

    const isSPA = await page.evaluate(() => {
      return window.location.hash.length > 0 || !!document.querySelector("[data-reactroot], [data-v-app], #__next, #app");
    });
    log.debug("SPA detection", { isSPA });

    if (isSPA) {
      await page.waitForTimeout(4000);
      await page.waitForSelector("main, article, .content, #content, [role='main']", { timeout: 10000 }).catch(() => {});
    } else {
      await page.waitForTimeout(2000);
    }

    const content = await extractContent(page);
    const pageDate = await extractDate(page);
    const links = await extractLinks(page);
    const dateCheck = checkDateFreshness(pageDate, maxAgeMonths);

    const finalUrl = page.url();
    await browserManager.closeContext(ctxId);

    let output = `# ${content.title}\n\nURL: ${finalUrl}`;
    if (isSPA) output += `\n(SPA)`;
    if (pageDate) output += `\n📅 ${new Date(pageDate).toLocaleDateString("tr-TR")}`;

    if (dateCheck.warning) {
      output += `\n\n${dateCheck.warning}`;
      if (requireFreshContent && !dateCheck.isFresh) {
        output += "\n\n⚠️ GÜNCEL İÇERİK GEREKLİ - Bu kaynak güncel değil!";
      }
    }

    output += `\n\n---\n\n${content.text.slice(0, 12000)}`;

    if (links.length > 0) {
      output += `\n\n---\n\n## Bağlantılar (${links.length})\n`;
      output += links.slice(0, 15).map((l) => `- [${l.text}](${l.href})`).join("\n");
    }

    const result = { content: [{ type: "text" as const, text: output }] };
    log.finish(result);
    return result;
  }
);

// ── TOOL: deep_search ─────────────────────────────────────────────
server.tool(
  "deep_search",
  "Doğrudan kaynaklardan arama. Güvenli siteler kullanılır.",
  {
    query: z.string().describe("Aranacak terim"),
    sources: z.array(z.enum(["github", "npm", "stackoverflow", "mdn", "devdocs"])).optional().default(["github", "npm", "stackoverflow"]).describe("Kaynaklar"),
    maxAgeMonths: z.number().optional().default(12).describe("Maksimum içerik yaşı (ay)"),
  },
  async ({ query, sources, maxAgeMonths }) => {
    const log = new Logger("deep_search");
    log.info("Starting deep search", { query, sources, maxAgeMonths });

    const ctxId = genContextId();
    const results: { source: string; title: string; url: string; content: string; date?: string; isFresh: boolean }[] = [];

    const sourceUrls: Record<string, string[]> = {
      github: [`https://github.com/search?q=${encodeURIComponent(query)}&type=repositories&s=updated&o=desc`],
      npm: [`https://www.npmjs.com/search?q=${encodeURIComponent(query)}`],
      stackoverflow: [`https://stackoverflow.com/search?q=${encodeURIComponent(query)}`],
      mdn: [`https://developer.mozilla.org/en-US/search?q=${encodeURIComponent(query)}`],
      devdocs: [`https://devdocs.io/#q=${encodeURIComponent(query)}`],
    };

    for (const source of sources) {
      const urls = sourceUrls[source];
      if (!urls) continue;

      for (const url of urls) {
        const safety = isUrlSafe(url);
        if (!safety.safe) {
          log.warn("Skipping unsafe URL", { url, reason: safety.reason });
          continue;
        }

        const page = await browserManager.openPage(ctxId);
        await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(3000);

        const content = await extractContent(page);
        const pageDate = await extractDate(page);
        const dateCheck = checkDateFreshness(pageDate, maxAgeMonths);

        results.push({
          source,
          title: content.title || source,
          url,
          content: content.text.slice(0, 1500),
          date: pageDate,
          isFresh: dateCheck.isFresh,
        });

        await page.close();
      }
    }

    await browserManager.closeContext(ctxId);

    const freshResults = results.filter((r) => r.isFresh);
    const oldResults = results.filter((r) => !r.isFresh);
    const sortedResults = [...freshResults, ...oldResults];

    const formatted = sortedResults
      .map((r, i) => {
        let line = `[${i + 1}] **${r.title}** (${r.source})`;
        if (r.date) {
          line += ` - 📅 ${new Date(r.date).toLocaleDateString("tr-TR")}`;
          if (!r.isFresh) line += " ⚠️ ESKİ";
        }
        line += `\n    URL: ${r.url}\n    ${r.content.slice(0, 300)}...`;
        return line;
      })
      .join("\n\n");

    const freshnessSummary = `${freshResults.length}/${results.length} kaynak güncel`;
    const result = {
      content: [{
        type: "text" as const,
        text: `# Deep Search: "${query}"\n${freshnessSummary}\n\n${SECURITY_WARNING}\n\n${formatted}`,
      }],
    };
    log.finish(result);
    return result;
  }
);

// ── TOOL: github_repo_files ───────────────────────────────────────
server.tool(
  "github_repo_files",
  "GitHub repo dosyalarını listeler.",
  {
    owner: z.string().describe("Repo sahibi"),
    repo: z.string().describe("Repo adı"),
    path: z.string().optional().default("").describe("Klasör yolu"),
    branch: z.string().optional().default("main").describe("Branch adı"),
  },
  async ({ owner, repo, path, branch }) => {
    const log = new Logger("github_repo_files");
    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    const url = `https://github.com/${owner}/${repo}/tree/${branch}/${path}`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const files = await page.evaluate(() => {
      const items: { name: string; type: string; url: string }[] = [];

      document.querySelectorAll('[data-testid="directory-row"], .react-directory-row, .js-navigation-item').forEach((row) => {
        const nameEl = row.querySelector("a");
        const isDir = row.querySelector('.octicon-file-directory, [aria-label="Directory"], [data-testid="directory-icon"]');
        if (nameEl) {
          items.push({
            name: nameEl.textContent?.trim() || "",
            type: isDir ? "dir" : "file",
            url: `https://github.com${nameEl.getAttribute("href") || ""}`,
          });
        }
      });

      return items;
    });

    await browserManager.closeContext(ctxId);

    if (files.length === 0) {
      const result = { content: [{ type: "text" as const, text: `Dosya bulunamadı: ${url}` }] };
      log.finish(result);
      return result;
    }

    const dirs = files.filter((f) => f.type === "dir");
    const fileList = files.filter((f) => f.type === "file");

    let output = `# ${owner}/${repo}/${path || ""}\n\n`;
    if (dirs.length > 0) output += `📁 Klasörler:\n${dirs.map((d) => `  ${d.name}/`).join("\n")}\n\n`;
    if (fileList.length > 0) output += `📄 Dosyalar:\n${fileList.map((f) => `  ${f.name}`).join("\n")}`;

    const result = { content: [{ type: "text" as const, text: output }] };
    log.finish(result);
    return result;
  }
);

// ── TOOL: parallel_browse ─────────────────────────────────────────
server.tool(
  "parallel_browse",
  "Birden çok URL'yi paralel ziyaret eder. Güvenlik kontrolü yapılır.",
  {
    urls: z.array(z.string().url()).min(1).max(5).describe("URL'ler (max 5)"),
  },
  async ({ urls }) => {
    const log = new Logger("parallel_browse");

    // Tüm URL'leri güvenlik kontrolünden geçir
    const safeUrls: string[] = [];
    const blockedUrls: string[] = [];

    for (const url of urls) {
      const safety = isUrlSafe(url);
      const download = checkDownloadRequest(url);

      if (!safety.safe) {
        blockedUrls.push(`${url} - ${safety.reason}`);
      } else if (!download.allowed) {
        blockedUrls.push(`${url} - İndirme linki`);
      } else {
        safeUrls.push(url);
      }
    }

    if (safeUrls.length === 0) {
      const result = {
        content: [{
          type: "text" as const,
          text: `🔒 GÜVENLİK: Tüm URL'ler engellendi.\n\n${blockedUrls.join("\n")}\n\n${SECURITY_WARNING}`,
        }],
      };
      log.finish(result);
      return result;
    }

    const ctxId = genContextId();

    const tasks = safeUrls.map(async (url) => {
      const page = await browserManager.openPage(ctxId);
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(2500);

      const content = await extractContent(page);
      const pageDate = await extractDate(page);
      const dateCheck = checkDateFreshness(pageDate, 12);

      await page.close();

      let output = `## ${content.title}\nKaynak: ${url}`;
      if (pageDate) {
        output += `\n📅 ${new Date(pageDate).toLocaleDateString("tr-TR")}`;
        if (!dateCheck.isFresh) output += " ⚠️ ESKİ";
      }
      output += `\n\n${content.text.slice(0, 4000)}`;
      return output;
    });

    const allResults = await Promise.all(tasks);
    await browserManager.closeContext(ctxId);

    let output = allResults.join("\n\n---\n\n");
    if (blockedUrls.length > 0) {
      output += `\n\n---\n\n🔒 Engellenen URL'ler:\n${blockedUrls.join("\n")}`;
    }

    const result = { content: [{ type: "text" as const, text: output }] };
    log.finish(result);
    return result;
  }
);

// ── TOOL: get_page_links ──────────────────────────────────────────
server.tool(
  "get_page_links",
  "Sayfadaki linkleri çıkarır.",
  {
    url: z.string().url().describe("URL"),
  },
  async ({ url }) => {
    const log = new Logger("get_page_links");

    const safety = isUrlSafe(url);
    if (!safety.safe) {
      const result = { content: [{ type: "text" as const, text: `🔒 GÜVENLİK: ${safety.reason}` }] };
      log.finish(result);
      return result;
    }

    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const links = await extractLinks(page);
    await browserManager.closeContext(ctxId);

    // Linkleri güvenlik kontrolünden geçir
    const safeLinks = links.filter(l => isUrlSafe(l.href).safe);

    const formatted = safeLinks
      .slice(0, 100)
      .map((l, i) => `[${i + 1}] ${l.text}\n    ${l.href}`)
      .join("\n");

    const result = { content: [{ type: "text" as const, text: formatted || "Link bulunamadı." }] };
    log.finish(result);
    return result;
  }
);

// ── TOOL: screenshot ──────────────────────────────────────────────
server.tool(
  "screenshot",
  "Ekran görüntüsü alır.",
  {
    url: z.string().url().describe("URL"),
    fullPage: z.boolean().optional().default(false).describe("Tam sayfa"),
  },
  async ({ url, fullPage }) => {
    const log = new Logger("screenshot");

    const safety = isUrlSafe(url);
    if (!safety.safe) {
      const result = { content: [{ type: "text" as const, text: `🔒 GÜVENLİK: ${safety.reason}` }] };
      log.finish(result);
      return result;
    }

    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);

    const buffer = await page.screenshot({ fullPage, type: "png" });
    await browserManager.closeContext(ctxId);

    const result = { content: [{ type: "image" as const, data: buffer.toString("base64"), mimeType: "image/png" }] };
    log.finish(result);
    return result;
  }
);

// ── SERVER START ──────────────────────────────────────────────────
logSession("Server starting");

const transport = new StdioServerTransport();
await server.connect(transport);

logSession("Server connected to transport");

process.on("SIGINT", async () => {
  logSession("SIGINT received");
  await browserManager.close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  logSession("SIGTERM received");
  await browserManager.close();
  process.exit(0);
});
