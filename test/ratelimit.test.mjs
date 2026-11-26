import { describe, expect, it } from 'vitest';
import { createRateLimiter, isRateLimited } from '../src/ratelimit.mjs';

describe('rate limiter', () => {
  it('allows a burst, refuses the next request and refills over time', () => {
    let time = 0;
    const limiter = createRateLimiter({ perMinute: 3, now: () => time });
    expect([1, 2, 3].map(() => limiter.take('a').allowed)).toEqual([true, true, true]);
    const refused = limiter.take('a');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfter).toBe(20);
    expect(limiter.take('b').allowed).toBe(true);
    time += 20_000;
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false);
  });

  it('is off at 0', () => {
    const limiter = createRateLimiter({ perMinute: 0 });
    expect(limiter.enabled).toBe(false);
    expect(Array.from({ length: 1000 }, () => limiter.take('a').allowed).every(Boolean)).toBe(true);
  });

  it('counts only the API and MCP endpoints', () => {
    expect(isRateLimited('/mcp')).toBe(true);
    expect(isRateLimited('/api/options')).toBe(true);
    expect(isRateLimited('/')).toBe(false);
    expect(isRateLimited('/app.js')).toBe(false);
    expect(isRateLimited('/health/live')).toBe(false);
    expect(isRateLimited('/api/icons/abc.webp')).toBe(false);
    expect(isRateLimited('/api/icons/abc/original')).toBe(false);
    expect(isRateLimited('/api/icon')).toBe(false);
    expect(isRateLimited('/api/icons/abc.webp', 'DELETE')).toBe(true);
    expect(isRateLimited('/api/icons')).toBe(true);
  });
});
