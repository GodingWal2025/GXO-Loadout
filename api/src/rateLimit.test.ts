import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, resetRateLimits } from './middleware/rateLimit';

describe('API Rate Limiting Middleware', () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it('allows requests within limit', () => {
    const res = checkRateLimit('device-1', { maxRequestsPerMinute: 5 });
    expect(res.allowed).toBe(true);
    expect(res.currentCount).toBe(1);
    expect(res.warning).toBeUndefined();
  });

  it('emits usage warning when approaching threshold', () => {
    const config = { maxRequestsPerMinute: 5, warnThresholdPercent: 80 }; // threshold = 4
    checkRateLimit('device-1', config); // 1
    checkRateLimit('device-1', config); // 2
    checkRateLimit('device-1', config); // 3
    const res = checkRateLimit('device-1', config); // 4 (80%)
    expect(res.allowed).toBe(true);
    expect(res.warning).toBeDefined();
    expect(res.warning).toContain('High usage alert');
  });

  it('blocks requests exceeding limit and provides Retry-After', () => {
    const config = { maxRequestsPerMinute: 2, windowMs: 10000 };
    checkRateLimit('device-blocked', config);
    checkRateLimit('device-blocked', config);
    const blocked = checkRateLimit('device-blocked', config);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.warning).toContain('Rate limit exceeded');
  });

  it('tracks different clients independently', () => {
    const config = { maxRequestsPerMinute: 1 };
    expect(checkRateLimit('client-a', config).allowed).toBe(true);
    expect(checkRateLimit('client-a', config).allowed).toBe(false);
    expect(checkRateLimit('client-b', config).allowed).toBe(true);
  });
});
