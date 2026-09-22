/**
 * Optional Redis. Set REDIS_URL to turn it on; leave it unset and every caller
 * falls back to MongoDB, so a single-instance deployment needs nothing extra.
 *
 * With Redis on, it carries the fast, disposable state: expiring keys (token
 * blocklist, WebSocket tickets, throttles, caches), device presence, the rate
 * limiter's counters, and WebSocket fan-out between API instances. Anything
 * that must survive a restart (the remote-command queue, evidence) stays in
 * MongoDB either way.
 */
import Redis from 'ioredis';

let client: Redis | null = null;
let subscriber: Redis | null = null;

// Every key is namespaced, so one Redis can safely be shared with other apps
// (pub/sub channels aren't prefixed by ioredis; see FANOUT_CHANNEL).
export const KEY_PREFIX = process.env.REDIS_PREFIX ?? 'phantomshield:';

const make = (url: string) =>
  new Redis(url, {
    keyPrefix: KEY_PREFIX,
    lazyConnect: true,
    // Fail a command fast rather than queueing forever while Redis is away.
    maxRetriesPerRequest: 2,
    retryStrategy: (times) => Math.min(times * 200, 3000),
  });

/** The shared client, or null when REDIS_URL isn't set. */
export const getRedis = (): Redis | null => {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!client) {
    client = make(url);
    client.on('error', (err) => console.error('[Redis] Error:', err.message));
  }
  return client;
};

/** A second connection for SUBSCRIBE (a subscribed connection can't run commands). */
export const getRedisSubscriber = (): Redis | null => {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!subscriber) {
    subscriber = make(url);
    subscriber.on('error', (err) => console.error('[Redis] Subscriber error:', err.message));
  }
  return subscriber;
};

export const connectRedis = async (): Promise<void> => {
  const r = getRedis();
  if (!r) return;
  await r.connect();
  console.log('[Redis] Connected');
};

export const isRedisReady = (): boolean => client?.status === 'ready';

export const closeRedis = async (): Promise<void> => {
  await Promise.all([client?.quit().catch(() => {}), subscriber?.quit().catch(() => {})]);
  client = null;
  subscriber = null;
};
