import type { AppError } from '@/types';
import mongoose from 'mongoose';

let isConnected = false;
let listenersBound = false;

// Bind connection listeners exactly once at module load — not inside connectDB,
// which was re-invoked on every 'disconnected' event and stacked a new pair of
// listeners each time (leak), eventually tripping MaxListenersExceeded. The
// mongoose driver auto-reconnects on its own, so no manual reconnect loop.
function bindConnectionListeners(): void {
  if (listenersBound) return;
  listenersBound = true;
  mongoose.connection.on('error', (err) => {
    console.error('[DB] Error:', err.message ?? err);
  });
  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    console.warn('[DB] Disconnected — driver will attempt to reconnect.');
  });
  mongoose.connection.on('connected', () => {
    isConnected = true;
  });
}

export const connectDB = async (): Promise<void> => {
  if (isConnected) return;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not defined');

  bindConnectionListeners();

  try {
    await mongoose.connect(uri, {
      // /dashboard/overview alone fires 8 operations through Promise.all, so a
      // 10-connection pool let two concurrent cache misses starve every other
      // route on the instance — including /ready, which would then 503 and pull
      // a healthy instance out of rotation.
      maxPoolSize: Number(process.env.MONGO_MAX_POOL ?? '50'),
      minPoolSize: Number(process.env.MONGO_MIN_POOL ?? '5'),
      // zlib ships with Node. 'zstd' needs the optional @mongodb-js/zstd native
      // module; without it every command fails once the server agrees to zstd.
      compressors: ['zlib'],
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4,              // Use IPv4, skip trying IPv6
    });

    isConnected = true;
    console.log('[DB] MongoDB connected');

    // Index management is a MIGRATION, not a boot step — see syncIndexes().
    await syncIndexesIfEnabled();
  } catch (err) {
    // Only fatal at initial boot; the driver handles later transient drops.
    console.error('[DB] Connection failed:', err);
    process.exit(1);
  }
};

/**
 * Apply index definitions to the database.
 *
 * `syncIndexes()` is a DESTRUCTIVE, schema-changing operation: it drops every
 * index on the collection that the schema no longer declares, then builds the
 * missing ones. Running it automatically on boot is unsafe in production for
 * three reasons:
 *
 *   1. Every replica races to mutate the same indexes on every deploy.
 *   2. Building a UNIQUE index over existing data FAILS if the data contains
 *      duplicates — and the failure previously landed in a `.catch()` that only
 *      logged a warning, so the process would happily serve traffic with the
 *      old indexes silently dropped and the new ones absent.
 *   3. Index builds on a large collection are expensive and must be scheduled,
 *      not triggered by a routine restart.
 *
 * So: automatic in development (convenient, and the data is disposable), opt-in
 * everywhere else via `npm run migrate:indexes` (or AUTO_SYNC_INDEXES=true).
 */
export const syncIndexes = async (): Promise<void> => {
  const models = await import('../models');
  // Every model in the module — a hand-maintained list silently missed new ones.
  for (const [name, model] of Object.entries(models)) {
    const m = model as { syncIndexes?: () => Promise<unknown> };
    if (typeof m?.syncIndexes !== 'function') continue;
    // Sequential, and failures are surfaced — a half-applied index migration
    // must be loud, not a warning buried in startup logs.
    await m.syncIndexes();
    console.log(`[DB] Indexes synced: ${name}`);
  }
};

const syncIndexesIfEnabled = async (): Promise<void> => {
  const auto =
    process.env.AUTO_SYNC_INDEXES === 'true' ||
    (process.env.NODE_ENV !== 'production' && process.env.AUTO_SYNC_INDEXES !== 'false');

  if (!auto) {
    console.log(
      '[DB] Skipping automatic index sync (production). Run `npm run migrate:indexes` when index definitions change.',
    );
    return;
  }

  try {
    await syncIndexes();
  } catch (caught) {
    const err = caught as AppError;
    console.error('[DB] Index sync FAILED:', err?.message ?? err);
    throw err;
  }
};

export const disconnectDB = async (): Promise<void> => {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
};
