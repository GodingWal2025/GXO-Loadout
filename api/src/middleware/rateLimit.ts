// Rate limiting middleware for paid & resource-intensive endpoints

export interface RateLimitConfig {
  maxRequestsPerMinute: number;
  windowMs: number;
  warnThresholdPercent: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  currentCount: number;
  limit: number;
  warning?: string;
}

interface ClientBucket {
  timestamps: number[];
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequestsPerMinute: 20, // max 20 requests per minute per client
  windowMs: 60 * 1000,
  warnThresholdPercent: 80, // warn at 80% usage (16+ reqs/min)
};

const buckets = new Map<string, ClientBucket>();

// Periodic bucket cleanup to prevent memory bloat
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupBuckets(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  const cutoff = now - windowMs;
  for (const [key, bucket] of buckets.entries()) {
    bucket.timestamps = bucket.timestamps.filter((ts) => ts > cutoff);
    if (bucket.timestamps.length === 0) {
      buckets.delete(key);
    }
  }
}

export function checkRateLimit(
  clientId: string,
  config: Partial<RateLimitConfig> = {}
): RateLimitResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  cleanupBuckets(cfg.windowMs);

  const now = Date.now();
  const cutoff = now - cfg.windowMs;

  let bucket = buckets.get(clientId);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(clientId, bucket);
  }

  // Filter timestamps within the current sliding window
  bucket.timestamps = bucket.timestamps.filter((ts) => ts > cutoff);

  if (bucket.timestamps.length >= cfg.maxRequestsPerMinute) {
    const oldest = bucket.timestamps[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + cfg.windowMs - now) / 1000));
    return {
      allowed: false,
      retryAfterSeconds,
      currentCount: bucket.timestamps.length,
      limit: cfg.maxRequestsPerMinute,
      warning: `Rate limit exceeded for client ${clientId} (${bucket.timestamps.length}/${cfg.maxRequestsPerMinute})`,
    };
  }

  bucket.timestamps.push(now);
  const currentCount = bucket.timestamps.length;

  let warning: string | undefined;
  const threshold = Math.ceil((cfg.maxRequestsPerMinute * cfg.warnThresholdPercent) / 100);
  if (currentCount >= threshold) {
    warning = `High usage alert: client ${clientId} reached ${currentCount}/${cfg.maxRequestsPerMinute} requests in current window`;
  }

  return {
    allowed: true,
    currentCount,
    limit: cfg.maxRequestsPerMinute,
    warning,
  };
}

export function resetRateLimits(): void {
  buckets.clear();
}
