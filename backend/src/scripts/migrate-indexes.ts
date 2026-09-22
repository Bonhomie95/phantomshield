/**
 * Index migration — run this deliberately, not on boot.
 *
 *   npm run migrate:indexes
 *
 * Applies the index definitions declared on the mongoose schemas to the
 * database. This DROPS indexes the schemas no longer declare and BUILDS the
 * ones they do, so it is a real schema migration: run it as a deploy step,
 * once, against a database you have a fresh backup of.
 *
 * Exits non-zero on failure so a pipeline stops rather than shipping an app
 * whose queries have no supporting indexes.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, syncIndexes, disconnectDB } from '../config/db';

/**
 * Rewrite pre-rename plan values in place: guard → starter, elite → pro.
 *
 * Reads already normalise these on the fly (see `normalizePlan`), so this is
 * housekeeping rather than a correctness fix — but leaving two vocabularies in
 * the collection makes every future query and analytic ambiguous. Idempotent:
 * running it twice is a no-op.
 */
const migratePlanNames = async (): Promise<void> => {
  const { User } = await import('../models');

  // `guard`/`elite` are deliberately absent from PlanId now, so the typed query
  // helpers reject them. This is the one place that must still see the old
  // vocabulary, so the cast is intentional and scoped to the migration.
  const guard = await User.updateMany(
    { plan: 'guard' } as Record<string, unknown>,
    { $set: { plan: 'starter' } },
  );
  const elite = await User.updateMany(
    { plan: 'elite' } as Record<string, unknown>,
    { $set: { plan: 'pro' } },
  );

  const moved = (guard.modifiedCount ?? 0) + (elite.modifiedCount ?? 0);
  console.log(
    moved > 0
      ? `[migrate] Plan names updated: ${guard.modifiedCount ?? 0} guard→starter, ${elite.modifiedCount ?? 0} elite→pro.`
      : '[migrate] Plan names already current — nothing to do.',
  );
};

const main = async (): Promise<void> => {
  if (!process.env.MONGODB_URI) {
    console.error('[migrate] MONGODB_URI is not set.');
    process.exit(1);
  }

  // connectDB() itself won't auto-sync in production; we call syncIndexes
  // explicitly below so the intent is unambiguous.
  await connectDB();

  const db = mongoose.connection.db;
  console.log(`[migrate] Connected to "${db?.databaseName}". Applying index definitions…`);

  await syncIndexes();
  await migratePlanNames();

  console.log('[migrate] Migration complete.');
  await disconnectDB();
  process.exit(0);
};

main().catch((err) => {
  console.error('[migrate] FAILED:', err?.message ?? err);
  console.error(
    '[migrate] The database may be partially migrated. Inspect the collections’ indexes before retrying.',
  );
  process.exit(1);
});
