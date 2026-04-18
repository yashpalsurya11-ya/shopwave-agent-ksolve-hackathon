import { Redis } from '@upstash/redis';

let redisClient = null;

// Initialize Upstash Redis only if credentials are provided
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  try {
    redisClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    console.log('[Redis] Upstash Redis instance initialized.');
  } catch (err) {
    console.error('[Redis] Failed to initialize Upstash Redis:', err.message);
  }
} else {
  console.warn('[Redis] Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN. Caching will be bypassed.');
}

/**
 * Get item from Upstash Redis Cache
 * @param {string} key 
 */
export async function getCache(key) {
  if (!redisClient) return null;
  try {
    return await redisClient.get(key);
  } catch (err) {
    console.error(`[Redis Error] Failed to get cache for key "${key}":`, err.message);
    return null;
  }
}

/**
 * Set item in Upstash Redis Cache
 * @param {string} key 
 * @param {any} value 
 * @param {number} ttlSeconds Default to 24 hours (86400s)
 */
export async function setCache(key, value, ttlSeconds = 86400) {
  if (!redisClient) return false;
  try {
    // Upstash expects the ex option for expiry in seconds
    await redisClient.set(key, value, { ex: ttlSeconds });
    return true;
  } catch (err) {
    console.error(`[Redis Error] Failed to set cache for key "${key}":`, err.message);
    return false;
  }
}
