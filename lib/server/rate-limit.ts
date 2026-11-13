/**
 * Minimal fixed-window rate limiter kept in memory.
 * On Vercel each serverless instance has its own memory, so this is a best-effort abuse brake,
 * not a global quota. For a hard global limit, back it with a shared store (e.g. Upstash Redis).
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export const rateLimit = (key: string, limit: number, windowMs: number) => {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size > MAX_BUCKETS) {
      buckets.forEach((value, bucketKey) => {
        if (value.resetAt <= now) {
          buckets.delete(bucketKey);
        }
      });
    }
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return {
    ok: bucket.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  };
};

export const getClientIp = (request: Request) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  request.headers.get("x-real-ip")?.trim() ||
  "unknown";
