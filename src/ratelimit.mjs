// Rate limiting for the API and MCP endpoints: a token bucket per client address.
// Each client may send `perMinute` requests in a burst; the bucket then refills at
// perMinute / 60 requests per second. The client is the TCP peer address. Behind a
// reverse proxy every request comes from the proxy, so the limit is shared by all users.
// That is on purpose: X-Forwarded-For can be forged unless the proxy is trusted.

const MAX_CLIENTS = 10_000;

export function createRateLimiter({ perMinute, now = () => Date.now() }) {
  if (!perMinute || perMinute <= 0) {
    return { enabled: false, take: () => ({ allowed: true, retryAfter: 0 }) };
  }
  const capacity = perMinute;
  const perMs = perMinute / 60_000;
  const buckets = new Map();

  const prune = time => {
    // A bucket that has refilled completely holds no state worth keeping.
    for (const [key, bucket] of buckets) {
      if (bucket.tokens + (time - bucket.updated) * perMs >= capacity) buckets.delete(key);
    }
  };

  return {
    enabled: true,
    take(client) {
      const time = now();
      let bucket = buckets.get(client);
      if (!bucket) {
        if (buckets.size >= MAX_CLIENTS) prune(time);
        bucket = { tokens: capacity, updated: time };
        buckets.set(client, bucket);
      }
      bucket.tokens = Math.min(capacity, bucket.tokens + (time - bucket.updated) * perMs);
      bucket.updated = time;
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { allowed: true, retryAfter: 0 };
      }
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((1 - bucket.tokens) / perMs / 1000)) };
    }
  };
}

// Icon images the web GUI shows: one request per image, and a library or web icon set can hold
// hundreds. They are small reads, of the library or of an icon set that is already configured
// (never a free URL), so they are not counted.
const IMAGE_PATHS = [/^\/api\/icons\/[^/]+\.webp$/, /^\/api\/icons\/[^/]+\/original$/, /^\/api\/icon$/];

// Only the endpoints that do work count. The web GUI's static files, its icon images and the
// health check do not.
export function isRateLimited(pathname, method = 'GET') {
  if (method === 'GET' && IMAGE_PATHS.some(pattern => pattern.test(pathname))) return false;
  return pathname === '/mcp' || pathname.startsWith('/api/');
}
