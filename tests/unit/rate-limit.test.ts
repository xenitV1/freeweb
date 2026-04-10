import { describe, it, expect } from "vitest";
import { checkRateLimit } from "../../src/lib.js";
import type { RateLimitConfig, RequestContext } from "../../src/lib.js";

describe("checkRateLimit", () => {
  const defaultConfig: RateLimitConfig = {
    maxRequestsPerMinute: 10,
    cooldownMs: 0,
  };

  function makeCtx(): RequestContext {
    return { requestCount: 0, windowStart: 0 };
  }

  it("allows requests under the limit", () => {
    const ctx = makeCtx();
    const result = checkRateLimit(ctx, defaultConfig, 1000);
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBe(0);
  });

  it("allows requests up to the limit", () => {
    const ctx = makeCtx();
    for (let i = 0; i < 10; i++) {
      const result = checkRateLimit(ctx, defaultConfig, 1000 + i);
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks requests at the limit", () => {
    const ctx = makeCtx();
    const baseTime = 5000;
    for (let i = 0; i < 10; i++) {
      checkRateLimit(ctx, defaultConfig, baseTime);
    }
    const result = checkRateLimit(ctx, defaultConfig, baseTime);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("reports retryAfterMs correctly when blocked", () => {
    const ctx = makeCtx();
    const baseTime = 10000;
    for (let i = 0; i < 10; i++) {
      checkRateLimit(ctx, defaultConfig, baseTime);
    }
    const blockedAt = baseTime + 30000;
    const result = checkRateLimit(ctx, defaultConfig, blockedAt);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBe(20000);
  });

  it("allows requests again after window resets", () => {
    const ctx = makeCtx();
    const baseTime = 1000;
    for (let i = 0; i < 10; i++) {
      checkRateLimit(ctx, defaultConfig, baseTime);
    }
    expect(checkRateLimit(ctx, defaultConfig, baseTime).allowed).toBe(false);
    const afterReset = baseTime + 60_001;
    const result = checkRateLimit(ctx, defaultConfig, afterReset);
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBe(0);
  });

  it("resets request count after window expires", () => {
    const ctx = makeCtx();
    const baseTime = 2000;
    for (let i = 0; i < 10; i++) {
      checkRateLimit(ctx, defaultConfig, baseTime);
    }
    const afterReset = baseTime + 60_001;
    checkRateLimit(ctx, defaultConfig, afterReset);
    expect(ctx.requestCount).toBe(1);
    expect(ctx.windowStart).toBe(afterReset);
  });

  it("respects custom config with lower limit", () => {
    const ctx = makeCtx();
    const strictConfig: RateLimitConfig = { maxRequestsPerMinute: 2, cooldownMs: 0 };
    expect(checkRateLimit(ctx, strictConfig, 1000).allowed).toBe(true);
    expect(checkRateLimit(ctx, strictConfig, 1000).allowed).toBe(true);
    expect(checkRateLimit(ctx, strictConfig, 1000).allowed).toBe(false);
  });

  it("respects custom config with higher limit", () => {
    const ctx = makeCtx();
    const generousConfig: RateLimitConfig = { maxRequestsPerMinute: 100, cooldownMs: 0 };
    for (let i = 0; i < 100; i++) {
      expect(checkRateLimit(ctx, generousConfig, 1000).allowed).toBe(true);
    }
    expect(checkRateLimit(ctx, generousConfig, 1000).allowed).toBe(false);
  });

  it("uses Date.now() when now parameter is omitted", () => {
    const ctx = makeCtx();
    ctx.windowStart = Date.now() - 1000;
    ctx.requestCount = 0;
    const result = checkRateLimit(ctx, defaultConfig);
    expect(result.allowed).toBe(true);
  });

  it("increments request count on allowed request", () => {
    const ctx = makeCtx();
    checkRateLimit(ctx, defaultConfig, 1000);
    expect(ctx.requestCount).toBe(1);
    checkRateLimit(ctx, defaultConfig, 1000);
    expect(ctx.requestCount).toBe(2);
  });

  it("does not increment request count on blocked request", () => {
    const ctx = makeCtx();
    for (let i = 0; i < 10; i++) {
      checkRateLimit(ctx, defaultConfig, 1000);
    }
    expect(ctx.requestCount).toBe(10);
    checkRateLimit(ctx, defaultConfig, 1000);
    expect(ctx.requestCount).toBe(10);
  });
});
