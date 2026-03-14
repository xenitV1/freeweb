import type { Page } from "playwright";

/** Sayfadaki ana metin içeriğini çıkar (nav, footer, script gibi gürültüyü temizle) */
export async function extractContent(page: Page): Promise<{ title: string; text: string; html: string }> {
  const result = await page.evaluate(() => {
    const title = document.title;

    // Gürültü elementlerini kaldır
    const removeSelectors = [
      "script", "style", "noscript", "svg", "canvas",
      "nav", "footer", "header",
      '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
      "iframe", "aside", ".sidebar", ".ad", ".advertisement",
      ".cookie-banner", "#cookie-banner", ".popup", "#popup",
    ];
    const clone = document.body.cloneNode(true) as HTMLElement;
    for (const sel of removeSelectors) {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    }

    // Metin çıkar
    const rawText = clone.innerText || clone.textContent || "";
    const cleanText = rawText.replace(/\n{3,}/g, "\n\n").trim();
    const html = clone.innerHTML.slice(0, 100_000); // 100KB üst limit

    return { title, text: cleanText, html };
  });

  return result;
}

/** Sayfadaki tüm linkleri çıkar */
export async function extractLinks(page: Page): Promise<{ text: string; href: string }[]> {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("a[href]"))
      .map((a) => ({
        text: (a.textContent || "").trim().slice(0, 100),
        href: (a as HTMLAnchorElement).href,
      }))
      .filter((l) => l.href.startsWith("http") && l.text.length > 0);
  });
}

/** Arama sonucu sayfasından sonuçları parse et (Google/Bing/DDG uyumlu) */
export async function parseSearchResults(page: Page): Promise<{ title: string; url: string; snippet: string }[]> {
  return page.evaluate(() => {
    // Google
    const googleResults = Array.from(document.querySelectorAll(".g")).map((g) => {
      const titleEl = g.querySelector("h3");
      const linkEl = g.querySelector("a[href]");
      const snippetEl = g.querySelector("[data-sncf], .VwiC3b, [style*='-webkit-line-clamp']");
      return {
        title: titleEl?.textContent?.trim() || "",
        url: linkEl ? (linkEl as HTMLAnchorElement).href : "",
        snippet: snippetEl?.textContent?.trim() || "",
      };
    });

    if (googleResults.some((r) => r.url)) return googleResults.filter((r) => r.url);

    // Bing
    const bingResults = Array.from(document.querySelectorAll(".b_algo")).map((b) => {
      const titleEl = b.querySelector("h2 a");
      const snippetEl = b.querySelector(".b_caption p");
      return {
        title: titleEl?.textContent?.trim() || "",
        url: titleEl ? (titleEl as HTMLAnchorElement).href : "",
        snippet: snippetEl?.textContent?.trim() || "",
      };
    });

    if (bingResults.some((r) => r.url)) return bingResults.filter((r) => r.url);

    // DuckDuckGo
    const ddgResults = Array.from(document.querySelectorAll(".result")).map((r) => {
      const titleEl = r.querySelector(".result__title a");
      const snippetEl = r.querySelector(".result__snippet");
      return {
        title: titleEl?.textContent?.trim() || "",
        url: titleEl ? (titleEl as HTMLAnchorElement).href : "",
        snippet: snippetEl?.textContent?.trim() || "",
      };
    });

    return ddgResults.filter((r) => r.url);
  });
}

/** Context ID üret */
let counter = 0;
export function genContextId(): string {
  return `ctx_${Date.now()}_${++counter}`;
}
