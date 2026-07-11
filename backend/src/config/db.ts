import mongoose from 'mongoose';

let isConnected = false;

export const connectDB = async (): Promise<void> => {
  if (isConnected) return;

  const uri = process.env.MONGODB_URI!;
  if (!uri) throw new Error('MONGODB_URI is not defined');

  try {
    await mongoose.connect(uri, {
      maxPoolSize: 10,        // Handle concurrent connections
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4,              // Use IPv4, skip trying IPv6
    });

    isConnected = true;
    console.log('[DB] MongoDB connected');

    // Create indexes on startup
    await createIndexes();
  } catch (err) {
    console.error('[DB] Connection failed:', err);
    process.exit(1);
  }

  mongoose.connection.on('error', err => {
    console.error('[DB] Error:', err);
    isConnected = false;
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[DB] Disconnected — reconnecting...');
    isConnected = false;
    setTimeout(() => connectDB(), 5000);
  });
};

const createIndexes = async () => {
  // Indexes are declared on each schema via schema.index(). syncIndexes()
  // builds any that are missing (and drops ones no longer declared), which is
  // what we actually want at startup — the previous createIndex({}) was a no-op.
  const { User, Device, ActivityEvent, IntruderEvent, RefreshToken } = await import('../models');
  await Promise.all([
    User.syncIndexes(),
    Device.syncIndexes(),
    ActivityEvent.syncIndexes(),
    IntruderEvent.syncIndexes(),
    RefreshToken.syncIndexes(),
  ]).catch(err => console.warn('[DB] Index sync warning:', err?.message ?? err));
};

export const disconnectDB = async (): Promise<void> => {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
};
