import type { RateLimitConfig, RequestContext } from "./types.js";

export function checkRateLimit(ctx: RequestContext, config: RateLimitConfig, now?: number): { allowed: boolean; retryAfterMs: number } {
  const currentTime = now ?? Date.now();
  const windowMs = 60_000;

  if (currentTime - ctx.windowStart > windowMs) {
    ctx.windowStart = currentTime;
    ctx.requestCount = 0;
  }

  if (ctx.requestCount >= config.maxRequestsPerMinute) {
    const retryAfterMs = windowMs - (currentTime - ctx.windowStart);
    return { allowed: false, retryAfterMs };
  }

  ctx.requestCount++;
  return { allowed: true, retryAfterMs: 0 };
}
