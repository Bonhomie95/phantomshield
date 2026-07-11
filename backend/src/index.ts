import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';

import { connectDB } from './config/db';
import { connectRedis, getRedis } from './config/redis';
import { startPushWorker } from './services/pushService';

// Routes
import authRoutes    from './routes/auth';
import syncRoutes    from './routes/sync';
import deviceRoutes  from './routes/device';
import pushRoutes    from './routes/push';
import dashboardRoutes from './routes/dashboard';
import billingRoutes from './routes/billing';
import referralRoutes from './routes/referral';
import wsRoutes      from './services/wsService';

const PORT = parseInt(process.env.PORT ?? '3002', 10);
const isDev = process.env.NODE_ENV !== 'production';

// ─── Fail fast on missing critical config ────────────────────────────────────
// Booting with an undefined JWT secret or DB URI produces opaque downstream
// failures (every token verify throws, every query hangs). Surface it at start.

const assertEnv = () => {
  const required = ['JWT_SECRET', 'MONGODB_URI'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`[Server] Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
  if ((process.env.JWT_SECRET ?? '').length < 32) {
    console.error('[Server] JWT_SECRET must be at least 32 characters.');
    process.exit(1);
  }
};

// ─── Build Server ──────────────────────────────────────────────────────────────

const buildServer = async () => {
  const fastify = Fastify({
    logger: isDev
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : true,
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024, // 5MB (for encrypted photo payloads)
  });

  // ── Security Headers ─────────────────────────────────────────────
  await fastify.register(helmet, {
    contentSecurityPolicy: false, // Managed at CDN/proxy level
  });

  // ── CORS ─────────────────────────────────────────────────────────
  await fastify.register(cors, {
    origin: isDev
      ? true
      : [
          process.env.FRONTEND_URL ?? 'https://phantomshield.app',
          process.env.DASHBOARD_URL ?? 'https://app.phantomshield.app',
        ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'],
    credentials: true,
  });

  // ── Rate Limiting ─────────────────────────────────────────────────
  await fastify.register(rateLimit, {
    global: true,
    max:        parseInt(process.env.RATE_LIMIT_MAX ?? '100'),
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW ?? '60000'),
    redis:      getRedis(),
    keyGenerator: (req) => {
      const jwt = (req.user as any)?.userId;
      return jwt ?? req.ip;
    },
    errorResponseBuilder: () => ({
      error:   'Too Many Requests',
      message: 'Slow down — rate limit exceeded.',
      retryAfter: 60,
    }),
  });

  // ── JWT ───────────────────────────────────────────────────────────
  await fastify.register(jwt, {
    secret: process.env.JWT_SECRET!,
    sign:   { algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] },
  });

  // ── WebSocket ─────────────────────────────────────────────────────
  await fastify.register(websocket, {
    options: { maxPayload: 1048576 }, // 1MB
  });

  // ── Multipart (file uploads) ──────────────────────────────────────
  await fastify.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });

  // ── Routes ────────────────────────────────────────────────────────
  fastify.register(authRoutes,      { prefix: '/api/auth' });
  fastify.register(syncRoutes,      { prefix: '/api/sync' });
  fastify.register(deviceRoutes,    { prefix: '/api/devices' });
  fastify.register(pushRoutes,      { prefix: '/api/push' });
  fastify.register(dashboardRoutes, { prefix: '/api/dashboard' });
  fastify.register(billingRoutes,   { prefix: '/api' }); // /api/webhooks/revenuecat, /api/billing/plan
  fastify.register(referralRoutes,  { prefix: '/api' }); // /api/referrals/me, /api/referrals/redeem
  fastify.register(wsRoutes);       // handles /ws WebSocket endpoint

  // ── Health check ──────────────────────────────────────────────────
  fastify.get('/health', async () => ({
    status: 'ok',
    version: process.env.npm_package_version ?? '1.0.0',
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  }));

  // ── 404 handler ───────────────────────────────────────────────────
  fastify.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: 'Not found', path: req.url });
  });

  // ── Error handler ─────────────────────────────────────────────────
  fastify.setErrorHandler((err: any, req, reply) => {
    fastify.log.error(err);
    // Surface client (4xx) messages; never leak internal 5xx detail.
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: err.message });
    }
    reply.code(err.statusCode ?? 500).send({ error: 'Internal server error' });
  });

  return fastify;
};

// ─── Start ────────────────────────────────────────────────────────────────────

const start = async () => {
  try {
    assertEnv();
    await connectDB();
    await connectRedis();

    const server = await buildServer();

    // Start BullMQ push worker
    startPushWorker();

    await server.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`\n🛡  PhantomShield API running on port ${PORT}\n`);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n[Server] ${signal} received — shutting down gracefully...`);
      await server.close();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

  } catch (err) {
    console.error('[Server] Fatal startup error:', err);
    process.exit(1);
  }
};

start();
