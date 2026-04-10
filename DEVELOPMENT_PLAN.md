# FreeWeb MCP Server — Geliştirme Planı

> 5 prensip odaklı uzman ajan (Mimari, Güvenlik, Ürün, Kod Kalitesi, Performans) tarafından analiz edildi.
> Test altyapısı kuruldu: 189 test (183 unit + 6 GLM-5-Turbo entegrasyonu), hepsi geçiyor.
> Mevcut durum: Çalışan MVP, 1307 satırlık god-module, `src/lib.ts` ile test edilebilir pure functions çıkarıldı.

---

## Proje Vizyonu

**FreeWeb = API key gerektirmeyen, LLM'ler için sınırsız web erişimi.**

Her aşama bu vizyonu güçlendirmeli:
1. **Güvenilirlik** — Çökmeyen, sızıntı yapmayan bir MCP sunucusu
2. **Hız** — Saniyeler içinde anlamlı sonuç döndüren arama ve tarama
3. **Kalite** — LLM'nin gerçekten kullanabileceği yapılandırılmış içerik
4. **Genişletilebilirlik** — Yeni arama motoru, yeni araç eklemek dakikalar sürmeli

---

## Aşama 0: Acil Düzeltmeler (Kritik Altyapı)

> **Hedef:** Üretim kullanımını engelleyen 4 kritik sorunu çöz.
> **Süre:** 2-3 gün
> **Kabul Kriteri:** Sunucu 100+ ardışık istekte crash yapmaz, memory sızdırmaz.

### 0.1 Browser Crash Recovery
- **Sorun:** Browser crash sonrası `this.browser` null olmuyor, sunucu kalıcı olarak bozuluyor
- **Dosya:** `src/browser.ts:7-23`
- **Çözüm:** `browser.on("disconnected", ...)` ile `this.browser = null` + `contexts.clear()`
- **Çözüm:** `launch()` metoduna concurrent-launch koruması (Promise lock)

### 0.2 Context Leak Düzeltmesi — 8 Tool Handler
- **Sorun:** 8 tool handler'da try/finally yok. Hata durumunda BrowserContext sızıyor (10-30MB/leak)
- **Etkilenen tool'lar:** `browse_page`, `smart_browse`, `github_search`, `github_repo_files`, `get_page_links`, `screenshot`, `deep_search`, `parallel_browse`
- **Dosyalar:** `src/index.ts` (satır 709-1294 arası tüm handler'lar)
- **Çözüm:** Her handler'ı try/finally ile sar

### 0.3 Unbounded Cache → LRU + TTL
- **Sorun:** 5 adet `Map<string, T>` sınırsız büyüyor, hiç temizlenmiyor
- **Dosyalar:** `src/llms.ts:30-32`, `src/markdown.ts:9`
- **Çözüm:** `max: 500` giriş, `ttl: 30 dk` ile LRU cache uygula
- **Çözüm:** `null` (olmayan llms.txt) sonuçlarını cache'leme — transient hataları kalıcı olarak saklama

### 0.4 Silent Goto Error Swallowing
- **Sorun:** `.catch(() => {})` ile `page.goto` hataları yutuluyor, boş sayfa üzerinde çalışılıyor
- **Dosyalar:** `src/index.ts` (10+ yer), `src/browser.ts:149`
- **Çözüm:** `goto` sonucunu kontrol et, başarısızlık durumunda anlamlı hata mesajı döndür

---

## Aşama 1: Mimari Refaktoring (Temiz Kod)

> **Hedef:** 1307 satırlık god-module'u yönetilebilir modüllere böl.
> **Süre:** 4-5 gün
> **Kabul Kriteri:** Her dosya tek bir sorumluluk taşır, yeni tool eklemek 50 satır sürer.

### 1.1 Modül Çıkarma Planı

```
src/
├── index.ts          ← Sadece server setup + tool kayıtları (~300 satır)
├── security.ts       ← isUrlSafe, checkDownloadRequest, blocked lists
├── url.ts            ← normalizeSearchResultUrl, normalizeTargetUrl, isSameSiteUrl
├── scoring.ts        ← buildQueryTokens, scoreSearchResult, getDomainScore, tüm ağırlıklar
├── search.ts         ← collectWebSearchResults, browseSearchResults, engine registry
├── browse.ts         ← browseUrl() pipeline (security → llms → route → extract → format)
├── dates.ts          ← checkDateFreshness, extractDateHint, formatDateForDisplay
├── text.ts           ← cleanText, QUERY_STOP_WORDS (tekil kaynak)
├── browser.ts        ← BrowserManager (değişmez)
├── utils.ts          ← extractContent, extractDate, extractLinks, parseSearchResults
├── markdown.ts       ← MarkdownDocument, CachedFetcher
├── llms.ts           ← LlmsDocument, parseLlmsTxt, findLlmsTxt, routing
└── constants.ts      ← Tüm magic number'lar (timeout'lar, limitler, ağırlıklar)
```

### 1.2 `browseUrl()` Pipeline Extraction

`browse_page`, `smart_browse`, `browseSearchResults`'ta tekrar eden 13 adımlık pipeline:

```
1. isUrlSafe() → 2. checkDownloadRequest() → 3. findLlmsTxt() → 4. resolveLlmsRoute()
→ 5. findMarkdownVersion() → 6. openPage() → 7. goto() → 8. [SPA detect]
→ 9. extractContent() → 10. extractDate() → 11. prefer markdown → 12. format → 13. closeContext
```

**Çözüm:** Tek bir `browseUrl(ctxId, url, options)` fonksiyonu ile her tool sadece output formatını özelleştirsin.

### 1.3 Kod Tekrarinin Giderilmesi

| Tekrar | Yerler | Çözüm |
|--------|--------|-------|
| `cleanText()` | utils.ts, markdown.ts, llms.ts, index.ts (4 farklı versiyon) | `src/text.ts`'e taşı |
| `QUERY_STOP_WORDS` | index.ts:148, llms.ts:33 (farklı içerikler!) | Tekil kaynak → `src/text.ts` |
| `buildQueryTokens()` | index.ts:344, llms.ts:75 (aynı) | Tekil kaynak → `src/text.ts` |
| `normalizeTargetUrl()` | markdown.ts:12, llms.ts:69 (**farklı davranış — BUG**) | Tek kaynak, karar ver: search parametreleri silinecek mi? |
| Cache + inflight pattern | markdown.ts:60-96, llms.ts:255-286 | Generic `CachedFetcher<T>` sınıfı |
| `withContext()` boilerplate | Her tool handler | `withContext(async (page) => { ... })` HOF |

### 1.4 Magic Number'ların İsimlendirilmesi

`src/constants.ts` dosyasına tüm magic number'lar:

```typescript
export const TIMEOUTS = {
  NAVIGATION: 60_000,
  SEARCH_ENGINE_WAIT: 3_500,
  MARGINALIA_WAIT: 5_000,
  SPA_WAIT: 4_000,
  SPA_SELECTOR: 10_000,
  LLMS_FETCH: 3_500,
  MARKDOWN_FETCH: 4_000,
} as const;

export const CONTENT_LIMITS = {
  BROWSE_PAGE: 15_000,
  SMART_BROWSE: 12_000,
  HTML_EXTRACTION: 100_000,
  README_HTML: 50_000,
  LLMS_MAX_BYTES: 60_000,
} as const;

export const SCORING = {
  ENGINE_YAHOO: 28,
  ENGINE_MARGINALIA: 20,
  ENGINE_ASK: 8,
  TITLE_HIT: 8,
  SNIPPET_HIT: 3,
  URL_HIT: 2,
  TRUSTED_DOMAIN: 12,
  GOV_EDU: 6,
  ORG: 3,
  LOW_QUALITY_PENALTY: -14,
  DOMAIN_MATCH: 25,
  FRESH_BONUS: 5,
  STALE_PENALTY: -6,
  LLMS_DISCOVERY: 6,
  ROUTE_THRESHOLD: 10,
} as const;
```

---

## Aşama 2: Performans Optimizasyonu & Çoklu Tarayıcı

> **Hedef:** Her operasyonda 2-5 saniyelik sabit bekleme süresini ortadan kaldır, bot detection'ı atlatmak için çoklu tarayıcı motoru ekle.
> **Süre:** 5-6 gün
> **Kabul Kriteri:** Ortalama arama süresi < 5sn (şu an ~12-15sn), sayfa tarama < 3sn, Chromium blok yiyen siteler Firefox/WebKit ile açılabilsin.

### 2.1 waitForTimeout → Akıllı Bekleme

**12 yerde** sabit `page.waitForTimeout(N)` kullanılıyor. Bunları koşul tabanlı bekleme ile değiştir:

```typescript
// YANLIŞ: Sabit 3 saniye bekle
await page.waitForTimeout(3000);

// DOĞRU: İçerik hazır olana kadar bekle, max 5 saniye
await Promise.race([
  page.waitForSelector("main, article, .content, [role='main']", { timeout: 5000 }),
  page.waitForLoadState("networkidle", { timeout: 5000 }),
]).catch(() => {});
```

### 2.2 Paralel Arama Motoru Denemesi

**Şu an:** Yahoo (5sn) → Marginalia (8sn) → Ask (5sn) = 18sn worst case
**Hedef:** 3 motor paralel, en hızlı sonuçlar kazanır

```typescript
const results = await Promise.allSettled(
  engines.map(eng => tryEngine(eng, query, domain))
);
```

### 2.3 Paralel llms.txt Aday Sorgulama

**Şu an:** Root'tan path'e kadar sıralı sorgulama (4 segment = 14sn worst case)
**Hedef:** Tüm adayları paralel sorgula

### 2.4 Dead Code Temizliği

- `extractContent`'ın `html` field'ı hiç kullanılmıyor → kaldır veya opsiyonel yap
- `browserManager.openPage(url?)` parametresi hiçbir çağrıcı tarafından kullanılmıyor → kaldır
- Kullanılmayan export'lar: `LlmsSection`, `LlmsRelevantLink`, `MarkdownDocument`

### 2.5 Firefox + WebKit Çoklu Tarayıcı Desteği

**Sorun:** Sadece Chromium kullanılıyor. Cloudflare, Datadome, PerimeterX gibi bot koruma sistemleri Chromium'u daha agresif filtreliyor — Firefox ve WebKit ile erişilebilen siteler çok daha fazla.

**Mevcut:** `src/browser.ts` — `chromium.launch()` tek motor, tek fingerprint.

**Hedef mimari:**

```typescript
import { chromium, firefox, webkit } from "playwright";

type BrowserType = "chromium" | "firefox" | "webkit";

interface BrowserProfile {
  type: BrowserType;
  weight: number;           // rastgele seçim ağırlığı
  userAgents: string[];
  headers: Record<string, string>;
  stealthScripts: () => void;
}

const BROWSER_PROFILES: BrowserProfile[] = [
  { type: "chromium", weight: 5, ... },
  { type: "firefox",  weight: 3, ... },
  { type: "webkit",   weight: 2, ... },
];
```

**Uygulanacak adımlar:**

1. **`BrowserManager` çoklu motor desteği**
   - `launch()` → her motor için ayrı browser instance
   - `createContext(id, preferredType?)` → motor seçimi parametrik
   - Motorlar lazy launch (ilk kullanımda başlat)

2. **Motor rotasyon stratejisi**
   - Varsayılan: rastgele seçim (weight-based)
   - Fallback: Chromium blok yiyorsa → Firefox dene → WebKit dene
   - Configurable: sadece belirli motorları kullanma seçeneği

3. **Firefox-specific stealth**
   - Firefox UA string'leri (Windows, macOS, Linux)
   - `navigator.webdriver` gizleme (Firefox'ta farklı yöntem)
   - Plugin spoofing (Firefox'ta farklı — eklenti mimarisi farklı)
   - `Sec-Ch-Ua` header'ları Firefox'ta yok → kaldır
   - Canvas fingerprint noise (aynı mantık, farklı davranış)

4. **WebKit-specific stealth**
   - Safari UA string'leri (macOS, iOS)
   - `navigator.plugins` Safari'de farklı
   - `window.chrome` yok → ekleme
   - Safari-specific header'lar (`Accept` farklı)

5. **Fallback zinciri**
   ```
   browseUrl() → chromium ile dene
                → 403/block tespit → firefox ile tekrar dene
                                   → hâlâ blok → webkit ile tekrar dene
                                   → hâlâ blok → hata döndür
   ```

6. **Anti-bot detection testleri**
   ```
   tests/integration/browser-rotation.test.ts
   - Chromium ile açılan sayfa sayısı
   - Firefox ile açılan sayfa sayısı
   - Cloudflare korumalı site testi (ör: known CF site)
   - Motor rotasyonu fallback testi
   ```

**Performans etkisi:**
- 3 browser instance = ~3x memory (her biri ~50-100MB)
- Lazy launch ile sadece kullanılan motor bellekte
- Fallback senaryosu: +3-5sn (sadece blok yiyince)
- Paralel kullanımda: tüm motorlar aynı anda aktif olabilir

**Riskler:**
- Playwright Firefox/WebKit desteği Windows'da sınırlı — CI/CD'de Docker gerekli
- Firefox headless mode bazı sitelerde farklı render ediyor
- WebKit (Safari) en az uyumlu motor — bazı modern JS feature'lar eksik

---

## Aşama 3: Test Altyapısı ✅ TAMAMLANDI

> **Durum:** Test framework kuruldu, 189 test yazıldı, hepsi geçiyor.
> **Gerçekleşen:** ~2 gün

### 3.1 Test Framework — Kuruldu

- `vitest` v4.1.4 aktif
- `npm run test` komutu eklendi
- `vitest.config.ts` yapılandırıldı (globals, timeout, env)

### 3.2 Mevcut Test Coverage

**Unit Tests — 183 test (8 dosya):**

| Dosya | Test Sayısı | Kapsam |
|-------|-------------|--------|
| `security.test.ts` | 19 | URL güvenlik, blocked domains, download kontrolü, bug doğrulama |
| `url-normalization.test.ts` | 32 | Redirect unwrap, UTM strip, dedup, same-site, deriveRoute |
| `scoring.test.ts` | 45 | buildQueryTokens, scoreSearchResult, getDomainScore, merge, cleanSearchText |
| `llms-parser.test.ts` | 26 | parseLlmsTxt, buildLlmsCandidates, findRelevantLlmsLinks, formatLlmsGuidance |
| `routing.test.ts` | 11 | resolveLlmsRoute, score threshold, same-site, blocked URL filtreleme |
| `dates.test.ts` | 22 | checkDateFreshness, extractDateHint (ISO, relative, yesterday), formatDateForDisplay |
| `code-duplication.test.ts` | 13 | QUERY_STOP_WORDS farkı, normalizeTargetUrl farkı, cleanText farkı |
| `markdown.test.ts` | 16 | buildMarkdownCandidates, looksLikeMarkdown, extractMarkdownTitle |

**Integration Tests — 6 test:**

| Dosya | Test Sayısı | Kapsam |
|-------|-------------|--------|
| `browser-lifecycle.test.ts` | 6 | Context create/close, crash recovery, context leak demo |
| `glm5-turbo.test.ts` | 6 | GLM-5-Turbo API: connectivity, FreeWeb data analizi, tool selection, Türkçe |

### 3.3 Testle Doğrulanan Bug'lar

| Bug | Test | Kanıt |
|-----|------|-------|
| `QUERY_STOP_WORDS` tutarsızlığı | `code-duplication.test.ts` | index.ts: 24 kelime, llms.ts: 30 kelime — `api`, `docs`, `reference` stop word olarak farklı |
| `normalizeTargetUrl` tutarsızlığı | `code-duplication.test.ts` | markdown.ts search params siler, llms.ts silmez — aynı URL farklı cache key |
| Blocked domain false positive | `security.test.ts` | `hackney.gov.uk`, `adultlearning.edu` yanlış bloklanıyor (substring match) |
| `.pdf` indirme engellenmiyor | `security.test.ts` | PDF'ler güvenlik kontrolünden geçiyor |
| Routing score inflation | `routing.test.ts` | Same-site bonus nedeniyle alakasız sorgular bile route ediliyor |
| `buildQueryTokens` | `scoring.test.ts` | `f#.net` tek token olarak kalıyor, `f#` bulunamıyor |
| Browser context leak | `browser-lifecycle.test.ts` | page.evaluate hatası sonrası context kapatılmıyor |

### 3.4 Test Altyapısı Dosyaları

```
tests/
├── unit/
│   ├── fixtures/
│   │   ├── llms-full.txt
│   │   ├── llms-minimal.txt
│   │   ├── llms-malformed.txt
│   │   └── llms-mixed-urls.txt
│   ├── security.test.ts
│   ├── url-normalization.test.ts
│   ├── scoring.test.ts
│   ├── llms-parser.test.ts
│   ├── routing.test.ts
│   ├── dates.test.ts
│   ├── code-duplication.test.ts
│   └── markdown.test.ts
├── integration/
│   ├── browser-lifecycle.test.ts
│   └── glm5-turbo.test.ts
vitest.config.ts
tsconfig.test.json (test dosyaları için ayrı config)
src/lib.ts (index.ts'teki pure fonksiyonların export edilebilir kopyası)
```

### 3.5 Eksik Testler (İleride Eklenecek)

- **Integration:** Yahoo/Marginalia arama (gerçek Playwright gerekli)
- **Integration:** llms.txt site'ı ile tarama (gerçek network gerekli)
- **Unit:** `extractContent` (DOM mock gerekli — jsdom veya Playwright page mock)
- **Unit:** `parseSearchResults` (Playwright page mock gerekli)

---

## Aşama 4: MCP Protocol Tamamlama

> **Hedef:** MCP spec'inin kritik yeteneklerini uygula.
> **Süre:** 3-4 gün
> **Kabul Kriteri:** Claude Desktop ve diğer MCP client'larda sorunsuz çalışır.

### 4.1 Tool Annotations

```typescript
server.tool("web_search", "...", schema, handler, {
  readOnlyHint: true,      // Tüm tool'lar read-only
  openWorldHint: true,     // Internet'e erişim var
});
```

### 4.2 Cancellation Support

Tool handler'lara `extra` parametresini geçir, `extra.signal` ile iptal desteği:

```typescript
async ({ query }, extra) => {
  // Uzun operasyonlarda signal kontrolü
  if (extra.signal.aborted) return;
  // ...
}
```

### 4.3 Progress Notifications

30-60 saniye süren `search_and_browse` için:

```typescript
extra.sendProgress?.({ progress: 30, total: 100, message: "Searching Yahoo..." });
// ...
extra.sendProgress?.({ progress: 80, total: 100, message: "Browsing results..." });
```

### 4.4 DuckDuckGo Engine Aktifleştirme

**`parseSearchResults`'ta DuckDuckGo parser zaten var** (`utils.ts:307-317`) ama engine olarak kayıtlı değil.
- `WEB_SEARCH_ENGINES` array'ine `duckduckgo` ekle
- `buildWebSearchUrl`'a DuckDuckGo URL builder ekle
- `html/?q=` endpoint'ini kullan

---

## Aşama 5: Arama Kalitesi & İçerik Geliştirme

> **Hedef:** LLM'lerin aldığı sonuç kalitesini artır.
> **Süre:** 5-7 gün
> **Kabul Kriteri:** Arama sonuçlarında daha az garbage, daha yapılandırılmış çıktı.

### 5.1 Yapılandırılmış Veri Çıkarma

```typescript
// Yeni: JSON-LD, tablolar, listeleri JSON olarak çıkarma
interface StructuredContent {
  jsonLd: Record<string, unknown>[];
  tables: { headers: string[]; rows: string[][] }[];
  lists: { ordered: boolean; items: string[] }[];
}
```

### 5.2 CSS Selector ile Hedeflenen Çıkarma

`browse_page` aracına `cssSelector` parametresi ekle:

```typescript
cssSelector: z.string().optional().describe("Extract only this CSS selector's content")
```

### 5.3 llms.txt Spec Tamamlama

- **Relative URL desteği** — Şu an sadece `https?://` URL'leri kabul ediyor, spec'e göre relative URL'ler desteklenmeli
- **`llms-full.txt` desteği** — Extended version
- **Non-UTF-8 encoding** — `response.text()` encoding detection

### 5.4 smart_browse + browse_page Birleştirme

İki tool LLM'yi confusion'a sokuyor. Seçenekler:
- **A:** `browse_page`'e `smartMode` parametresi ekle, `smart_browse`'u kaldır
- **B:** Açık deskriptor'larla ne zaman hangisi kullanılacağını belirt

---

## Aşama 6: Güvenlik & Sağlamlık

> **Hedef:** Üretim kullanımına uygun güvenlik katmanı.
> **Süre:** 3-4 gün

### 6.1 URL Validation Sıkılaştırma

- IDN homograph attack kontrolü
- URL encoding bypass kontrolü
- llms.txt fetch'inden kaynaklanan SSRF riski — private IP range kontrolü

### 6.2 Rate Limiting

LLM agent'ları 100+ istek atabilir → IP ban riski:
- Per-session request counter
- Configurable cooldown (default: 30 req/dk)

### 6.3 Anti-Bot UA Güncelleme

Chrome 131/130 UA string'leri eskiyor:
- UA string'lerini configüre edilebilir yap
- Veya latest Chrome version'ı dinamik olarak belirle

### 6.4 robots.txt Compliance (Opsiyonel)

Şu an `robots.txt` kontrol edilmiyor. Üretim kullanımı için:
- `User-agent: *` kurallarını kontrol et
- Configurable (varsayılan: uygula, override edilebilir)

---

## Aşama 7: Geliştirici Deneyimi

> **Hedef:** Katkıda bulunmayı kolaylaştır.
> **Süre:** 2-3 gün

### 7.1 Engine Registry Pattern

Yeni arama motoru eklemek için:

```typescript
interface SearchEngine {
  name: string;
  weight: number;
  buildUrl(query: string, domain?: string): string;
  parseResults(page: Page): Promise<RawResult[]>;
  waitForReady(page: Page): Promise<void>;
}

const ENGINE_REGISTRY: SearchEngine[] = [
  yahooEngine,
  marginaliaEngine,
  duckduckgoEngine,
];
```

### 7.2 Linting & Formatting

```bash
npm install -D eslint @typescript-eslint/eslint-plugin prettier
```

### 7.3 Type Export'ları

Internal type'ları export et (test edilebilirlik için):
- `WebSearchResult`, `BrowsedSearchResult`, `LlmsRouteDecision`
- `SearchAttempt`, `SearchCollection`

### 7.4 CONTRIBUTING.md

- Nasıl tool eklenir
- Nasıl engine eklenir
- Test yazma rehberi
- PR checklist

---

## Öncelik Matrisi

```
            Yüksek Etki
                │
    Aşama 0     │     Aşama 4
    Acil Düz.   │     MCP Protocol
                │
Düşük ←────────┼────────→ Yüksek   (Çaba)
    Çaba        │        Çaba
                │
    Aşama 7     │     Aşama 5
    DevEx       │     Arama Kalitesi
                │
            Düşük Etki
```

## Zaman Çizelgesi

| Aşama | Süre | Bağımlılık | Durum |
|-------|------|------------|-------|
| **Aşama 0** — Acil Düzeltmeler | 2-3 gün | Yok | 🔲 Başlanmadı |
| **Aşama 1** — Mimari Refaktoring | 4-5 gün | Aşama 0 | 🔲 Başlanmadı |
| **Aşama 2** — Performans & Çoklu Tarayıcı | 5-6 gün | Aşama 1 | 🔲 Başlanmadı |
| **Aşama 3** — Test Altyapısı | ~2 gün | Aşama 1 (paralel) | ✅ Tamamlandı (189 test) |
| **Aşama 4** — MCP Protocol | 3-4 gün | Aşama 0 | 🔲 Başlanmadı |
| **Aşama 5** — Arama Kalitesi | 5-7 gün | Aşama 1 + 2 | 🔲 Başlanmadı |
| **Aşama 6** — Güvenlik | 3-4 gün | Aşama 1 | 🔲 Başlanmadı |
| **Aşama 7** — DevEx | 2-3 gün | Aşama 1 + 3 | 🔲 Başlanmadı |
| **Toplam** | **~23-31 gün** | | |

## Metrikler

| Metrik | Şu An | Hedef (Aşama 3 sonrası) | Hedef (Aşama 7 sonrası) |
|--------|-------|--------------------------|--------------------------|
| Test sayısı | **189** ✅ | 50+ → aşıldı | 200+ |
| index.ts satır | 1307 | ~300 | ~300 |
| Ortalama arama süresi | ~12-15sn | ~5-7sn | ~3-5sn |
| Memory leak | Evet (8 tool) | Hayır | Hayır |
| Browser crash sonrası | Kalıcı bozulma | Auto-recovery | Auto-recovery |
| Cache boyutu | Sınırsız | max 500, TTL 30dk | max 500, TTL 30dk |
| Arama motoru sayısı | 3 | 4 (+DuckDuckGo) | 5 (+Brave) |
| MCP tool annotation | Yok | readOnly + openWorld | Tamamı |
| Cancellation | Yok | Signal desteği | Signal desteği |
| GLM-5-Turbo entegrasyon testi | **6 test geçiyor** ✅ | - | - |
