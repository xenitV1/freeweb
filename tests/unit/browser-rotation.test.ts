import { describe, it, expect } from "vitest";
import {
  type EngineType,
  type BrowserProfile,
  ENGINE_WEIGHTS,
  ALL_PROFILES,
  CHROMIUM_PROFILE,
  FIREFOX_PROFILE,
  WEBKIT_PROFILE,
  IDLE_TIMEOUT_MS,
} from "./fixtures/browser-profiles.js";

function selectEngine(
  weights: Record<EngineType, number>,
  enabled: EngineType[],
  exclude: EngineType[] = [],
  rng: () => number = Math.random,
): EngineType {
  const available = enabled.filter((e) => !exclude.includes(e));
  if (available.length === 0) {
    throw new Error("All engines excluded or disabled");
  }
  const totalWeight = available.reduce((sum, e) => sum + weights[e], 0);
  let random = rng() * totalWeight;
  for (const engine of available) {
    random -= weights[engine];
    if (random <= 0) return engine;
  }
  return available[available.length - 1];
}

interface EngineState {
  type: EngineType;
  launched: boolean;
  launchedAt: number | null;
  lastUsedAt: number | null;
  contextCount: number;
}

function shouldCloseIdle(state: EngineState, now: number, timeoutMs: number): boolean {
  if (!state.launched || !state.lastUsedAt) return false;
  if (state.contextCount > 0) return false;
  return now - state.lastUsedAt > timeoutMs;
}

function getFallbackChain(
  weights: Record<EngineType, number>,
  enabled: EngineType[],
  failed: EngineType[],
): EngineType[] {
  const order: EngineType[] = [];
  const remaining = [...enabled];
  let currentFailed = [...failed];

  while (remaining.some((e) => !currentFailed.includes(e))) {
    try {
      const next = selectEngine(weights, remaining, currentFailed, () => 0.5);
      order.push(next);
      currentFailed.push(next);
    } catch {
      break;
    }
  }
  return order;
}

function parseEngineConfig(envStr: string | undefined): EngineType[] {
  if (!envStr) return ["chromium", "firefox", "webkit"];
  return envStr
    .split(",")
    .map((s) => s.trim().toLowerCase() as EngineType)
    .filter((s): s is EngineType => ["chromium", "firefox", "webkit"].includes(s));
}

function parseEngineWeights(envStr: string | undefined, defaults: Record<EngineType, number>): Record<EngineType, number> {
  if (!envStr) return { ...defaults };
  const engines: EngineType[] = ["chromium", "firefox", "webkit"];
  const values = envStr.split(",").map((s) => Number(s.trim()));
  const result = { ...defaults };
  engines.forEach((engine, i) => {
    if (values[i] !== undefined && values[i] > 0) {
      result[engine] = values[i];
    }
  });
  return result;
}

describe("Engine Selection Weight Logic", () => {
  const enabled: EngineType[] = ["chromium", "firefox", "webkit"];

  it("always returns an enabled engine", () => {
    for (let i = 0; i < 100; i++) {
      const engine = selectEngine(ENGINE_WEIGHTS, enabled);
      expect(enabled).toContain(engine);
    }
  });

  it("distribution over 10000 iterations matches expected weights within tolerance", () => {
    const iterations = 10000;
    const counts: Record<EngineType, number> = { chromium: 0, firefox: 0, webkit: 0 };

    for (let i = 0; i < iterations; i++) {
      const engine = selectEngine(ENGINE_WEIGHTS, enabled);
      counts[engine]++;
    }

    const totalWeight = ENGINE_WEIGHTS.chromium + ENGINE_WEIGHTS.firefox + ENGINE_WEIGHTS.webkit;
    const expectedChromium = iterations * (ENGINE_WEIGHTS.chromium / totalWeight);
    const expectedFirefox = iterations * (ENGINE_WEIGHTS.firefox / totalWeight);
    const expectedWebkit = iterations * (ENGINE_WEIGHTS.webkit / totalWeight);

    const tolerance = 0.05;
    expect(counts.chromium / iterations).toBeCloseTo(expectedChromium / iterations, 1);
    expect(Math.abs(counts.chromium - expectedChromium) / iterations).toBeLessThan(tolerance);
    expect(Math.abs(counts.firefox - expectedFirefox) / iterations).toBeLessThan(tolerance);
    expect(Math.abs(counts.webkit - expectedWebkit) / iterations).toBeLessThan(tolerance);

    expect(counts.chromium).toBeGreaterThan(counts.firefox);
    expect(counts.firefox).toBeGreaterThan(counts.webkit);
  });

  it("returns the only enabled engine when one is available", () => {
    const result = selectEngine(ENGINE_WEIGHTS, ["firefox"]);
    expect(result).toBe("firefox");
  });

  it("respects custom weights", () => {
    const customWeights: Record<EngineType, number> = { chromium: 1, firefox: 1, webkit: 8 };
    const counts: Record<EngineType, number> = { chromium: 0, firefox: 0, webkit: 0 };
    const iterations = 5000;

    for (let i = 0; i < iterations; i++) {
      const engine = selectEngine(customWeights, enabled);
      counts[engine]++;
    }

    expect(counts.webkit).toBeGreaterThan(counts.chromium);
    expect(counts.webkit).toBeGreaterThan(counts.firefox);
  });

  it("throws when all engines are excluded", () => {
    expect(() => selectEngine(ENGINE_WEIGHTS, enabled, enabled)).toThrow(
      "All engines excluded or disabled",
    );
  });

  it("throws when no engines are enabled", () => {
    expect(() => selectEngine(ENGINE_WEIGHTS, [])).toThrow(
      "All engines excluded or disabled",
    );
  });
});

describe("Fallback Chain Order", () => {
  const enabled: EngineType[] = ["chromium", "firefox", "webkit"];

  it("excludes a single failed engine", () => {
    const failed: EngineType[] = ["chromium"];
    const result = selectEngine(ENGINE_WEIGHTS, enabled, failed);
    expect(result).not.toBe("chromium");
    expect(["firefox", "webkit"]).toContain(result);
  });

  it("excludes two failed engines, returns the remaining one", () => {
    const failed: EngineType[] = ["chromium", "firefox"];
    const result = selectEngine(ENGINE_WEIGHTS, enabled, failed);
    expect(result).toBe("webkit");
  });

  it("produces a complete fallback chain across all engines", () => {
    const chain = getFallbackChain(ENGINE_WEIGHTS, enabled, []);
    expect(chain.length).toBe(3);
    expect(new Set(chain).size).toBe(3);
    expect(chain).toContain("chromium");
    expect(chain).toContain("firefox");
    expect(chain).toContain("webkit");
  });

  it("fallback chain respects disabled engines", () => {
    const partialEnabled: EngineType[] = ["chromium", "webkit"];
    const chain = getFallbackChain(ENGINE_WEIGHTS, partialEnabled, []);
    expect(chain.length).toBe(2);
    expect(chain).not.toContain("firefox");
  });

  it("fallback chain with pre-failed engine skips it", () => {
    const chain = getFallbackChain(ENGINE_WEIGHTS, enabled, ["chromium"]);
    expect(chain).not.toContain("chromium");
    expect(chain.length).toBe(2);
  });

  it("full fallback exhausts all engines", () => {
    const chain = getFallbackChain(ENGINE_WEIGHTS, enabled, []);
    expect(chain).toEqual(expect.arrayContaining(["chromium", "firefox", "webkit"]));
    expect(() => selectEngine(ENGINE_WEIGHTS, enabled, chain)).toThrow();
  });
});

describe("Profile Configuration", () => {
  function validateProfile(profile: BrowserProfile, engine: EngineType) {
    it(`${engine}: has correct engine type`, () => {
      expect(profile.engine).toBe(engine);
    });

    it(`${engine}: has at least 3 user agents`, () => {
      expect(profile.userAgents.length).toBeGreaterThanOrEqual(3);
    });

    it(`${engine}: all UAs are non-empty strings`, () => {
      for (const ua of profile.userAgents) {
        expect(ua.length).toBeGreaterThan(20);
        expect(ua).toMatch(/^Mozilla\/5\.0/);
      }
    });

    it(`${engine}: has extraHTTPHeaders`, () => {
      expect(Object.keys(profile.extraHTTPHeaders).length).toBeGreaterThan(0);
    });

    it(`${engine}: has a non-empty stealth init script`, () => {
      expect(profile.stealthInitScript.length).toBeGreaterThan(10);
    });

    it(`${engine}: has at least 3 viewport widths`, () => {
      expect(profile.viewportWidths.length).toBeGreaterThanOrEqual(3);
    });

    it(`${engine}: has at least 2 viewport heights`, () => {
      expect(profile.viewportHeights.length).toBeGreaterThanOrEqual(2);
    });

    it(`${engine}: launchArgs is an array`, () => {
      expect(Array.isArray(profile.launchArgs)).toBe(true);
    });
  }

  describe("Chromium profile", () => {
    validateProfile(CHROMIUM_PROFILE, "chromium");

    it("UA strings contain Chrome", () => {
      for (const ua of CHROMIUM_PROFILE.userAgents) {
        expect(ua).toContain("Chrome/");
      }
    });

    it("includes Sec-Ch-Ua headers", () => {
      expect(CHROMIUM_PROFILE.extraHTTPHeaders).toHaveProperty("Sec-Ch-Ua");
      expect(CHROMIUM_PROFILE.extraHTTPHeaders).toHaveProperty("Sec-Ch-Ua-Mobile");
      expect(CHROMIUM_PROFILE.extraHTTPHeaders).toHaveProperty("Sec-Ch-Ua-Platform");
    });

    it("includes Sec-Fetch-User header", () => {
      expect(CHROMIUM_PROFILE.extraHTTPHeaders).toHaveProperty("Sec-Fetch-User");
    });

    it("stealth script contains window.chrome injection", () => {
      expect(CHROMIUM_PROFILE.stealthInitScript).toContain("window.chrome");
    });

    it("stealth script contains plugins spoofing", () => {
      expect(CHROMIUM_PROFILE.stealthInitScript).toContain("'plugins'");
      expect(CHROMIUM_PROFILE.stealthInitScript).toContain("Chrome PDF Plugin");
    });

    it("stealth script contains navigator.deviceMemory", () => {
      expect(CHROMIUM_PROFILE.stealthInitScript).toContain("deviceMemory");
    });

    it("has chromium-specific launch args", () => {
      expect(CHROMIUM_PROFILE.launchArgs).toContain("--no-sandbox");
      expect(CHROMIUM_PROFILE.launchArgs).toContain("--disable-blink-features=AutomationControlled");
    });
  });

  describe("Firefox profile", () => {
    validateProfile(FIREFOX_PROFILE, "firefox");

    it("UA strings contain Firefox", () => {
      for (const ua of FIREFOX_PROFILE.userAgents) {
        expect(ua).toMatch(/Firefox\/\d+/);
      }
    });

    it("UA strings use Gecko format", () => {
      for (const ua of FIREFOX_PROFILE.userAgents) {
        expect(ua).toContain("Gecko/");
      }
    });

    it("does NOT include Sec-Ch-Ua headers", () => {
      const headers = FIREFOX_PROFILE.extraHTTPHeaders;
      expect(headers).not.toHaveProperty("Sec-Ch-Ua");
      expect(headers).not.toHaveProperty("Sec-Ch-Ua-Mobile");
      expect(headers).not.toHaveProperty("Sec-Ch-Ua-Platform");
    });

    it("does NOT include window.chrome in stealth script", () => {
      expect(FIREFOX_PROFILE.stealthInitScript).not.toContain("window.chrome");
    });

    it("does NOT spoof Chrome-style plugins", () => {
      expect(FIREFOX_PROFILE.stealthInitScript).not.toContain("Chrome PDF Plugin");
    });

    it("does NOT include deviceMemory", () => {
      expect(FIREFOX_PROFILE.stealthInitScript).not.toContain("deviceMemory");
    });

    it("uses en;q=0.5 Accept-Language (Firefox default)", () => {
      expect(FIREFOX_PROFILE.extraHTTPHeaders["Accept-Language"]).toContain("q=0.5");
    });

    it("includes Sec-Fetch headers", () => {
      expect(FIREFOX_PROFILE.extraHTTPHeaders).toHaveProperty("Sec-Fetch-Dest");
      expect(FIREFOX_PROFILE.extraHTTPHeaders).toHaveProperty("Sec-Fetch-Mode");
      expect(FIREFOX_PROFILE.extraHTTPHeaders).toHaveProperty("Sec-Fetch-Site");
    });
  });

  describe("WebKit profile", () => {
    validateProfile(WEBKIT_PROFILE, "webkit");

    it("UA strings contain Safari", () => {
      for (const ua of WEBKIT_PROFILE.userAgents) {
        expect(ua).toMatch(/Safari\/\d+/);
      }
    });

    it("UA strings do NOT contain Chrome", () => {
      for (const ua of WEBKIT_PROFILE.userAgents) {
        expect(ua).not.toContain("Chrome/");
      }
    });

    it("does NOT include Sec-Ch-Ua headers", () => {
      const headers = WEBKIT_PROFILE.extraHTTPHeaders;
      expect(headers).not.toHaveProperty("Sec-Ch-Ua");
      expect(headers).not.toHaveProperty("Sec-Ch-Ua-Mobile");
      expect(headers).not.toHaveProperty("Sec-Ch-Ua-Platform");
    });

    it("does NOT include window.chrome in stealth script", () => {
      expect(WEBKIT_PROFILE.stealthInitScript).not.toContain("window.chrome");
    });

    it("does NOT include deviceMemory", () => {
      expect(WEBKIT_PROFILE.stealthInitScript).not.toContain("deviceMemory");
    });

    it("does NOT include Sec-Fetch-User header (Safari omits it)", () => {
      expect(WEBKIT_PROFILE.extraHTTPHeaders).not.toHaveProperty("Sec-Fetch-User");
    });

    it("uses Safari-style Accept-Language", () => {
      expect(WEBKIT_PROFILE.extraHTTPHeaders["Accept-Language"]).toBe("en-US,en-us");
    });

    it("spoofs MacIntel platform in stealth script", () => {
      expect(WEBKIT_PROFILE.stealthInitScript).toContain("MacIntel");
    });
  });

  describe("ALL_PROFILES completeness", () => {
    it("contains all three engine types", () => {
      expect(Object.keys(ALL_PROFILES)).toEqual(
        expect.arrayContaining(["chromium", "firefox", "webkit"]),
      );
    });

    it("each profile references the correct engine", () => {
      for (const [engine, profile] of Object.entries(ALL_PROFILES)) {
        expect(profile.engine).toBe(engine);
      }
    });
  });
});

describe("Lazy Launch Tracking", () => {
  function createEngineState(type: EngineType, overrides?: Partial<EngineState>): EngineState {
    return {
      type,
      launched: false,
      launchedAt: null,
      lastUsedAt: null,
      contextCount: 0,
      ...overrides,
    };
  }

  it("initial state is not launched", () => {
    const state = createEngineState("chromium");
    expect(state.launched).toBe(false);
    expect(state.launchedAt).toBeNull();
    expect(state.lastUsedAt).toBeNull();
  });

  it("after launch, state is marked as launched", () => {
    const now = Date.now();
    const state = createEngineState("chromium", {
      launched: true,
      launchedAt: now,
      lastUsedAt: now,
    });
    expect(state.launched).toBe(true);
    expect(state.launchedAt).toBe(now);
    expect(state.lastUsedAt).toBe(now);
  });

  it("launch timestamp is before current time", () => {
    const before = Date.now();
    const state = createEngineState("firefox", {
      launched: true,
      launchedAt: before,
      lastUsedAt: before,
    });
    const after = Date.now();
    expect(state.launchedAt!).toBeLessThanOrEqual(after);
    expect(state.launchedAt!).toBeGreaterThanOrEqual(before);
  });

  it("multiple engines can be tracked independently", () => {
    const states: EngineState[] = [
      createEngineState("chromium", { launched: true, launchedAt: 1000, lastUsedAt: 2000 }),
      createEngineState("firefox", { launched: false }),
      createEngineState("webkit", { launched: true, launchedAt: 1500, lastUsedAt: 3000 }),
    ];

    expect(states[0].launched).toBe(true);
    expect(states[1].launched).toBe(false);
    expect(states[2].launched).toBe(true);
  });

  it("context count tracks active contexts per engine", () => {
    const state = createEngineState("chromium", { launched: true, launchedAt: 1000, lastUsedAt: 1000 });
    expect(state.contextCount).toBe(0);

    const withContext = { ...state, contextCount: 3 };
    expect(withContext.contextCount).toBe(3);
  });
});

describe("Idle Timeout Logic", () => {
  const TIMEOUT = 5 * 60 * 1000;

  it("engine not launched is not closed", () => {
    const state: EngineState = {
      type: "chromium",
      launched: false,
      launchedAt: null,
      lastUsedAt: null,
      contextCount: 0,
    };
    expect(shouldCloseIdle(state, Date.now(), TIMEOUT)).toBe(false);
  });

  it("engine recently used is not closed", () => {
    const now = Date.now();
    const state: EngineState = {
      type: "chromium",
      launched: true,
      launchedAt: now - 60000,
      lastUsedAt: now - 30000,
      contextCount: 0,
    };
    expect(shouldCloseIdle(state, now, TIMEOUT)).toBe(false);
  });

  it("engine idle for more than timeout is closed", () => {
    const now = Date.now();
    const state: EngineState = {
      type: "chromium",
      launched: true,
      launchedAt: now - TIMEOUT - 60000,
      lastUsedAt: now - TIMEOUT - 1000,
      contextCount: 0,
    };
    expect(shouldCloseIdle(state, now, TIMEOUT)).toBe(true);
  });

  it("engine idle for exactly timeout is NOT closed (strictly greater required)", () => {
    const now = Date.now();
    const state: EngineState = {
      type: "chromium",
      launched: true,
      launchedAt: now - TIMEOUT - 1000,
      lastUsedAt: now - TIMEOUT,
      contextCount: 0,
    };
    expect(shouldCloseIdle(state, now, TIMEOUT)).toBe(false);
  });

  it("engine idle past timeout by 1ms is closed", () => {
    const now = Date.now();
    const state: EngineState = {
      type: "chromium",
      launched: true,
      launchedAt: now - TIMEOUT - 2000,
      lastUsedAt: now - TIMEOUT - 1,
      contextCount: 0,
    };
    expect(shouldCloseIdle(state, now, TIMEOUT)).toBe(true);
  });

  it("engine idle but with active contexts is NOT closed", () => {
    const now = Date.now();
    const state: EngineState = {
      type: "chromium",
      launched: true,
      launchedAt: now - TIMEOUT - 60000,
      lastUsedAt: now - TIMEOUT - 1000,
      contextCount: 2,
    };
    expect(shouldCloseIdle(state, now, TIMEOUT)).toBe(false);
  });

  it("engine with lastUsedAt just under timeout is NOT closed", () => {
    const now = Date.now();
    const state: EngineState = {
      type: "chromium",
      launched: true,
      launchedAt: now - TIMEOUT - 1000,
      lastUsedAt: now - TIMEOUT + 1000,
      contextCount: 0,
    };
    expect(shouldCloseIdle(state, now, TIMEOUT)).toBe(false);
  });

  it("engine with null lastUsedAt is not closed even if launched", () => {
    const now = Date.now();
    const state: EngineState = {
      type: "chromium",
      launched: true,
      launchedAt: now - TIMEOUT - 100000,
      lastUsedAt: null,
      contextCount: 0,
    };
    expect(shouldCloseIdle(state, now, TIMEOUT)).toBe(false);
  });

  it("respects custom timeout values", () => {
    const now = Date.now();
    const shortTimeout = 10000;
    const state: EngineState = {
      type: "firefox",
      launched: true,
      launchedAt: now - 20000,
      lastUsedAt: now - 15000,
      contextCount: 0,
    };
    expect(shouldCloseIdle(state, now, shortTimeout)).toBe(true);
    expect(shouldCloseIdle(state, now, TIMEOUT)).toBe(false);
  });

  it("IDLE_TIMEOUT_MS constant is 5 minutes", () => {
    expect(IDLE_TIMEOUT_MS).toBe(5 * 60 * 1000);
  });
});

describe("Environment Variable Configuration", () => {
  it("parses default engine list when env is undefined", () => {
    const engines = parseEngineConfig(undefined);
    expect(engines).toEqual(["chromium", "firefox", "webkit"]);
  });

  it("parses comma-separated engine list", () => {
    expect(parseEngineConfig("chromium,firefox")).toEqual(["chromium", "firefox"]);
    expect(parseEngineConfig("firefox,webkit")).toEqual(["firefox", "webkit"]);
    expect(parseEngineConfig("chromium")).toEqual(["chromium"]);
  });

  it("trims whitespace from engine names", () => {
    expect(parseEngineConfig(" chromium , firefox ")).toEqual(["chromium", "firefox"]);
  });

  it("ignores invalid engine names", () => {
    expect(parseEngineConfig("chromium,opera,firefox")).toEqual(["chromium", "firefox"]);
  });

  it("returns empty array for all-invalid input", () => {
    expect(parseEngineConfig("opera,edge")).toEqual([]);
  });

  it("parses default weights when env is undefined", () => {
    const weights = parseEngineWeights(undefined, ENGINE_WEIGHTS);
    expect(weights).toEqual(ENGINE_WEIGHTS);
  });

  it("parses custom weights from env string", () => {
    const weights = parseEngineWeights("10,1,1", ENGINE_WEIGHTS);
    expect(weights.chromium).toBe(10);
    expect(weights.firefox).toBe(1);
    expect(weights.webkit).toBe(1);
  });

  it("preserves defaults for missing weight values", () => {
    const weights = parseEngineWeights("8", ENGINE_WEIGHTS);
    expect(weights.chromium).toBe(8);
    expect(weights.firefox).toBe(3);
    expect(weights.webkit).toBe(2);
  });

  it("ignores zero or negative weights", () => {
    const weights = parseEngineWeights("0,-1,5", ENGINE_WEIGHTS);
    expect(weights.chromium).toBe(5);
    expect(weights.firefox).toBe(3);
    expect(weights.webkit).toBe(5);
  });
});
