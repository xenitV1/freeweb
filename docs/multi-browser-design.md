# Multi-Browser Rotation System — Design Document

## 1. Architecture Overview

The current `BrowserManager` (in `src/browser.ts`) uses only Chromium. This design extends it to support **three Playwright engines** — `chromium`, `firefox`, and `webkit` — with a weighted random rotation strategy and automatic fallback on bot-detection.

### Current State

```
BrowserManager
  ├── browser: Browser | null          (single chromium instance)
  ├── contexts: Map<string, BrowserContext>
  ├── launch()                         (chromium.launch)
  ├── createContext(id)                (chromium stealth context)
  ├── openPage(contextId, url?)        (new page with stealth init)
  ├── closeContext(id)
  └── close()
```

### Proposed State

```
BrowserManager
  ├── engines: Map<EngineType, EngineInstance>
  │     └── EngineInstance { browser, launchedAt, lastUsedAt, contexts }
  ├── selectEngine(exclude?)            (weighted random, skip failed)
  ├── launchEngine(type)                (lazy per-engine launch)
  ├── createContext(id, engine?)        (engine-aware stealth context)
  ├── openPage(contextId, url?)         (rotates engine, applies profile)
  ├── closeEngine(type)                 (idle timeout / manual)
  ├── closeIdleEngines()                (called periodically)
  ├── closeContext(id)                  (tracks lastUsedAt)
  └── close()                           (close all engines)
```

**Key change**: `engines` map holds one `EngineInstance` per engine type. Each instance tracks its own `Browser`, launch timestamp, last-used timestamp, and context map. The `selectEngine()` method returns an engine based on weight, excluding any engines passed in `exclude`.

---

## 2. Type Definitions

### EngineType

```typescript
type EngineType = "chromium" | "firefox" | "webkit";
```

### BrowserProfile

```typescript
interface BrowserProfile {
  engine: EngineType;
  userAgents: string[];
  extraHTTPHeaders: Record<string, string>;
  stealthInitScript: () => void;
  viewportWidths: number[];
  viewportHeights: number[];
  launchArgs: string[];
}
```

### EngineInstance

```typescript
interface EngineInstance {
  type: EngineType;
  browser: Browser | null;
  launchedAt: number | null;
  lastUsedAt: number | null;
  contexts: Map<string, BrowserContext>;
}
```

### EngineConfig

```typescript
interface EngineConfig {
  enabled: boolean;
  weight: number;
  idleTimeoutMs: number;
  profile: BrowserProfile;
}
```

### EngineWeights

```typescript
const ENGINE_WEIGHTS: Record<EngineType, number> = {
  chromium: 5,  // 50% — most compatible, best stealth
  firefox:  3,  // 30% — different fingerprint surface
  webkit:   2,  // 20% — Safari-like, good for Apple-targeting sites
};
```

---

## 3. Rotation Strategy

### Weighted Random Selection

```typescript
function selectEngine(exclude: EngineType[] = []): EngineType {
  const available = getEnabledEngines().filter(e => !exclude.includes(e));
  if (available.length === 0) throw new Error("All engines excluded or disabled");

  const totalWeight = available.reduce((sum, e) => sum + ENGINE_WEIGHTS[e], 0);
  let random = Math.random() * totalWeight;

  for (const engine of available) {
    random -= ENGINE_WEIGHTS[engine];
    if (random <= 0) return engine;
  }

  return available[available.length - 1];
}
```

This produces:
- **Chromium**: ~50% of selections (weight 5/10)
- **Firefox**: ~30% of selections (weight 3/10)
- **WebKit**: ~20% of selections (weight 2/10)

### Fallback Chain

When a page returns a 403, CAPTCHA, or bot-detection signal:

```
1. Try current engine → blocked?
2. Try next engine (exclude failed) → blocked?
3. Try final engine → blocked?
4. Return error with all attempts
```

The fallback is driven by passing previously-failed engines in the `exclude` array to `selectEngine()`.

---

## 4. Stealth Per Engine

### Chromium (current — no changes needed)

- **UA format**: `Mozilla/5.0 (...) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`
- **Headers**: Includes `Sec-Ch-Ua`, `Sec-Ch-Ua-Mobile`, `Sec-Ch-Ua-Platform`, all `Sec-Fetch-*`
- **Stealth scripts**:
  - Hide `navigator.webdriver`
  - Spoof `navigator.plugins` (Chrome PDF Plugin, Chrome PDF Viewer, Native Client)
  - Spoof `navigator.languages`
  - Spoof `navigator.platform` (`Win32`)
  - Spoof `navigator.hardwareConcurrency` (8)
  - Spoof `navigator.deviceMemory` (8)
  - Inject `window.chrome = { runtime: {} }`
  - Spoof `navigator.permissions.query`
  - Canvas fingerprint noise injection

### Firefox (new)

- **UA format**: `Mozilla/5.0 (...; rv:133.0) Gecko/20100101 Firefox/133.0`
- **Headers**: **NO** `Sec-Ch-Ua*` headers. Firefox doesn't send Client Hints.
  - `Accept-Language: en-US,en;q=0.5` (Firefox uses `0.5`, not `0.9`)
  - `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8`
  - `Upgrade-Insecure-Requests: 1`
  - `Sec-Fetch-Dest: document`, `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Site: none`, `Sec-Fetch-User: ?1`
- **Stealth scripts**:
  - Hide `navigator.webdriver`
  - Spoof `navigator.languages` (`["en-US", "en"]`)
  - **NO** `window.chrome` injection (Firefox doesn't have it)
  - **NO** `navigator.plugins` spoofing (Firefox has its own plugin architecture — `PluginArray` with `PDF Viewer`, `OpenH264 Video Codec`)
  - **NO** `navigator.deviceMemory` (not available in Firefox)
  - Spoof `navigator.platform` based on OS
  - Spoof `navigator.hardwareConcurrency`
  - Canvas fingerprint noise (same approach as Chromium)

### WebKit (new)

- **UA format**: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15`
- **Headers**: **NO** `Sec-Ch-Ua*` headers. Safari doesn't send Client Hints.
  - `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8`
  - `Accept-Language: en-US,en-us`
  - `Accept-Encoding: gzip, deflate, br`
  - `Sec-Fetch-Dest: document`, `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Site: none`
  - Note: Safari doesn't send `Sec-Fetch-User` on some versions
- **Stealth scripts**:
  - Hide `navigator.webdriver`
  - Spoof `navigator.plugins` (Safari style: empty or default macOS plugins)
  - **NO** `window.chrome` injection
  - **NO** `navigator.deviceMemory` (not available in Safari)
  - Spoof `navigator.platform` (`MacIntel` for macOS)
  - Spoof `navigator.hardwareConcurrency` (typical: 8 or 10)
  - Canvas fingerprint noise (same approach)

---

## 5. Memory Management

### Lazy Launch Per Engine

Each engine's `Browser` instance is launched lazily on first use:

```typescript
async launchEngine(type: EngineType): Promise<Browser> {
  const instance = this.engines.get(type)!;
  if (instance.browser) return instance.browser;

  const launcher = { chromium, firefox, webkit }[type];
  const config = this.getConfig(type);

  instance.browser = await launcher.launch({
    headless: true,
    args: config.profile.launchArgs,
  });
  instance.launchedAt = Date.now();
  instance.lastUsedAt = Date.now();
  return instance.browser;
}
```

### Idle Timeout

Engines unused for 5 minutes are automatically closed:

```typescript
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

closeIdleEngines(): void {
  const now = Date.now();
  for (const [type, instance] of this.engines) {
    if (instance.browser
      && instance.lastUsedAt
      && instance.contexts.size === 0
      && now - instance.lastUsedAt > IDLE_TIMEOUT_MS) {
      instance.browser.close().catch(() => {});
      instance.browser = null;
      instance.launchedAt = null;
      instance.lastUsedAt = null;
    }
  }
}
```

A periodic check (every 60s via `setInterval`) calls `closeIdleEngines()`.

### Context Tracking

Each context is now tagged with its engine type:

```typescript
async createContext(id: string, engine?: EngineType): Promise<BrowserContext> {
  const selectedEngine = engine || this.selectEngine();
  const instance = this.engines.get(selectedEngine)!;
  const browser = await this.launchEngine(selectedEngine);

  const profile = this.getConfig(selectedEngine).profile;
  const ctx = await browser.newContext({ ...buildContextOptions(profile) });

  await ctx.addInitScript(profile.stealthInitScript);

  instance.contexts.set(id, ctx);
  instance.lastUsedAt = Date.now();
  this.contextEngineMap.set(id, selectedEngine);

  return ctx;
}
```

---

## 6. Fallback Chain — Integration with Tool Handlers

### Bot-Detection Retry Loop

In `index.ts`, when a tool handler detects a bot block (CAPTCHA, 403, etc.), it retries with the next engine:

```typescript
async function browseWithFallback(url: string, maxAttempts = 3): Promise<Page> {
  const failed: EngineType[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const engine = browserManager.selectEngine(failed);
    const ctxId = genContextId();
    try {
      const page = await browserManager.openPage(ctxId, url, engine);
      const blocked = await detectBotBlock(page);
      if (!blocked) return { page, ctxId, engine };
      failed.push(engine);
      await browserManager.closeContext(ctxId);
    } catch {
      failed.push(engine);
      await browserManager.closeContext(ctxId).catch(() => {});
    }
  }

  throw new Error(`All engines blocked: ${failed.join(", ")}`);
}
```

### Detection Signals

Existing `detectSearchBlock()` plus additional checks:
- HTTP 403/429 status codes
- Cloudflare challenge page (`cf-browser-verification`)
- DataDome (`_datadome` cookie)
- PerimeterX (`_px3` cookie patterns)
- Akamai Bot Manager (`ak_bmsc` cookie)

---

## 7. Configuration — Environment Variables

```bash
# Enable/disable specific engines (default: all enabled)
FREEWEB_ENGINES=chromium,firefox,webkit

# Override default weights (comma-separated, same order as engines)
FREEWEB_ENGINE_WEIGHTS=5,3,2

# Idle timeout in minutes (default: 5)
FREEWEB_IDLE_TIMEOUT_MIN=5

# Disable the idle timeout cleanup
FREEWEB_DISABLE_IDLE_CLEANUP=false
```

### Parsing Logic

```typescript
function parseEngineConfig(): Map<EngineType, EngineConfig> {
  const enabledList = (process.env.FREEWEB_ENGINES || "chromium,firefox,webkit")
    .split(",")
    .map(s => s.trim() as EngineType);

  const weightList = (process.env.FREEWEB_ENGINE_WEIGHTS || "5,3,2")
    .split(",")
    .map(Number);

  const idleTimeout = (Number(process.env.FREEWEB_IDLE_TIMEOUT_MIN) || 5) * 60_000;

  const result = new Map<EngineType, EngineConfig>();
  const allEngines: EngineType[] = ["chromium", "firefox", "webkit"];

  allEngines.forEach((engine, i) => {
    result.set(engine, {
      enabled: enabledList.includes(engine),
      weight: weightList[i] || ENGINE_WEIGHTS[engine],
      idleTimeoutMs: idleTimeout,
      profile: PROFILES[engine],
    });
  });

  return result;
}
```

### Graceful Degradation

If an engine fails to launch (e.g., WebKit not installed on Linux):
1. Log a warning
2. Mark that engine as disabled
3. Continue with remaining engines
4. If no engines are available, fall back to Chromium-only with a logged error

---

## 8. Implementation Plan

### Phase 1: Extract profiles + rotation logic (no behavior change)
- Create `src/profiles.ts` with `BrowserProfile` configs
- Create `src/engine-rotation.ts` with `selectEngine()`, `selectEngineWeighted()`, `parseEngineConfig()`
- Add tests for rotation logic (this document's tests)

### Phase 2: Extend BrowserManager
- Add `engines` map, `contextEngineMap`
- Modify `launch()` → `launchEngine(type)`
- Modify `createContext()` to accept optional engine type
- Add `closeIdleEngines()`, periodic cleanup
- All existing call sites still work (default to chromium)

### Phase 3: Add fallback to tool handlers
- Add `browseWithFallback()` in `index.ts`
- Modify `openPage()` to accept engine parameter
- Integrate bot-detection retry loop into `browse_page`, `smart_browse`, `search_and_browse`

### Phase 4: Testing + verification
- Run existing integration tests (should still pass — chromium-only paths)
- Run new unit tests for rotation logic
- Manual testing against Cloudflare-protected sites

---

## 9. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Firefox/WebKit launch failures on CI | Lazy launch + graceful disable; CI stays Chromium-only |
| Memory usage with 3 browser processes | Idle timeout closes unused engines; only 1 active at a time typically |
| Stealth scripts differ per engine | Separate `BrowserProfile` per engine with engine-specific init scripts |
| Playwright WebKit not available on Linux | Graceful disable with warning log |
| UA strings become outdated | Centralized in `profiles.ts`, easy to update |
| Breaking existing behavior | Phase 2 maintains backward compatibility; `createContext(id)` defaults to chromium |
