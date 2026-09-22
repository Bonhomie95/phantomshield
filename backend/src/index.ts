import 'dotenv/config';
import { createHash, randomUUID } from 'crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';

import { connectDB } from './config/db';
import { connectRedis, getRedis, isRedisReady, closeRedis } from './config/redis';
import { initMonitoring, captureError, flushMonitoring } from './config/monitoring';
import { startMaintenanceWorker } from './services/maintenance';
import type { AppError } from './types';

// Routes
import authRoutes    from './routes/auth';
import syncRoutes    from './routes/sync';
import deviceRoutes  from './routes/device';
import pushRoutes    from './routes/push';
import dashboardRoutes from './routes/dashboard';
import billingRoutes from './routes/billing';
import guardianRoutes from './routes/guardian';
import wsRoutes, { initWsFanout } from './services/wsService';

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
  // Redaction is not optional here: this service sees bearer tokens, refresh
  // tokens, device ids and PIN-adjacent payloads. Anything logged is retained
  // by whatever ships the logs, so strip credentials at the source.
  const redact = {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-device-id"]',
      'res.headers["set-cookie"]',
      'req.body.idToken',
      'req.body.refreshToken',
      'req.body.pushToken',
      'req.body.photoBase64',
    ],
    censor: '[redacted]',
  };

  const fastify = Fastify({
    logger: isDev
      ? { transport: { target: 'pino-pretty', options: { colorize: true } }, redact }
      : { redact },
    trustProxy: true,
    // 256KB for JSON. The intruder-photo upload route raises its own limit
    // (image/jpeg parser in routes/sync.ts). A 200-event batch fits in 256KB.
    bodyLimit: 256 * 1024,
    // Correlation id: honour an inbound X-Request-Id (set by a proxy/LB) so a
    // single request can be followed across tiers, otherwise mint one. Without
    // this a browser 500 could not be tied back to any backend log line.
    requestIdHeader: 'x-request-id',
    genReqId: (req) =>
      (req.headers['x-request-id'] as string) ?? `req_${randomUUID()}`,
  });

  // Clients send `Content-Type: application/json` on every call, including
  // body-less DELETEs. Fastify rejects an empty JSON body with a 400, which
  // silently broke "remove guardian", "turn off lost mode" and friends. Treat
  // empty as {} and otherwise keep Fastify's own (prototype-poisoning-safe) parser.
  const defaultJson = fastify.getDefaultJsonParser('error', 'error');
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (body === '' || body === undefined) return done(null, {});
    defaultJson(req, String(body), done);
  });

  // Echo the id back so clients (and users contacting support) can quote it.
  fastify.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
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
  const RATE_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW ?? '60000');
  await fastify.register(rateLimit, {
    global: true,
    max:        parseInt(process.env.RATE_LIMIT_MAX ?? '100'),
    timeWindow: RATE_WINDOW,
    // Counters are shared through Redis when it's configured, so the limit
    // holds across every API instance. Without Redis they're in-memory, which
    // is exact for a single instance (N instances would allow N×).
    redis: getRedis() ?? undefined,
    keyGenerator: (req) => {
      // The limiter runs before `authenticate`, so req.user isn't populated yet.
      // Derive a stable per-session key from the bearer token when present
      // (hashed so the raw token is never used as a key), else fall back to
      // the client IP. This gives real per-user limiting instead of per-IP.
      const auth = req.headers.authorization;
      if (auth?.startsWith('Bearer ')) {
        return 'tok:' + createHash('sha256').update(auth.slice(7)).digest('hex').slice(0, 32);
      }
      return req.ip;
    },
    errorResponseBuilder: () => ({
      error:   'Too Many Requests',
      message: 'Slow down — rate limit exceeded.',
      retryAfter: Math.ceil(RATE_WINDOW / 1000),
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

  // Note: no multipart plugin — intruder photos arrive as a raw image/jpeg
  // body on PUT /api/sync/intruder/:id/photo.

  // ── Routes ────────────────────────────────────────────────────────
  fastify.register(authRoutes,      { prefix: '/api/auth' });
  fastify.register(syncRoutes,      { prefix: '/api/sync' });
  fastify.register(deviceRoutes,    { prefix: '/api/devices' });
  fastify.register(pushRoutes,      { prefix: '/api/push' });
  fastify.register(dashboardRoutes, { prefix: '/api/dashboard' });
  fastify.register(billingRoutes,   { prefix: '/api' }); // /api/webhooks/revenuecat, /api/billing/plan
  fastify.register(guardianRoutes,  { prefix: '/api' }); // /api/guardians, /api/public/share/:token
  fastify.register(wsRoutes);       // handles /ws WebSocket endpoint

  // ── Liveness — is the process up ──────────────────────────────────
  fastify.get('/health', async () => ({
    status: 'ok',
    version: process.env.npm_package_version ?? '1.0.0',
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  }));

  // ── Readiness — can we actually serve traffic (MongoDB) ────────────
  fastify.get('/ready', async (_req, reply) => {
    const mongoose = await import('mongoose');
    const db = mongoose.default.connection.readyState === 1;
    // Redis is optional, but when it's configured the rate limiter and fan-out
    // depend on it — so it counts toward readiness.
    const redis = getRedis() ? isRedisReady() : null;
    const ready = db && redis !== false;
    return reply.code(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'not_ready',
      db: db ? 'up' : 'down',
      redis: redis === null ? 'not_configured' : redis ? 'up' : 'down',
    });
  });

  // ── 404 handler ───────────────────────────────────────────────────
  fastify.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: 'Not found' });
  });

  // ── Error handler ─────────────────────────────────────────────────
  fastify.setErrorHandler((err: AppError, req, reply) => {
    req.log.error({ err, reqId: req.id }, 'request failed');

    // Surface client (4xx) messages; never leak internal 5xx detail.
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: err.message });
    }

    // Only 5xx is a defect worth reporting — 4xx is the client's business.
    captureError(err, {
      reqId: req.id,
      method: req.method,
      route: req.routeOptions?.url ?? req.url,
      userId: (req.user as { userId?: string } | undefined)?.userId,
    });

    // Return the correlation id so a user can quote it and support can find
    // the exact log line and Sentry event.
    reply.code(err.statusCode ?? 500).send({
      error: 'Internal server error',
      requestId: req.id,
    });
  });

  return fastify;
};

// ─── Start ────────────────────────────────────────────────────────────────────

const start = async () => {
  try {
    assertEnv();
    // Initialise error tracking FIRST so failures during boot are reported too.
    initMonitoring();
    await connectDB();
    await connectRedis();
    await initWsFanout();

    const server = await buildServer();

    const maintenanceWorker = startMaintenanceWorker();

    await server.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`\n🛡  PhantomShield API running on port ${PORT}\n`);

    // Graceful shutdown — drain HTTP, stop the scheduler, then release the DB
    // so the process exits cleanly (SIGTERM from the platform).
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\n[Server] ${signal} received — shutting down gracefully...`);
      const timer = setTimeout(() => {
        console.error('[Server] Forced exit after 10s shutdown timeout.');
        process.exit(1);
      }, 10_000);
      try {
        await server.close();
        await maintenanceWorker.close();
        const { disconnectDB } = await import('./config/db');
        await disconnectDB();
        await closeRedis();
        await flushMonitoring();
      } catch (err) {
        console.error('[Server] Error during shutdown:', err);
      } finally {
        clearTimeout(timer);
        process.exit(0);
      }
    };

    // This service is full of deliberate fire-and-forget promises (alert
    // delivery, presence writes). Without these handlers an
    // unhandled rejection is invisible, and an uncaught exception leaves the
    // process in an undefined state still accepting traffic.
    process.on('unhandledRejection', (reason) => {
      console.error('[Server] Unhandled promise rejection:', reason);
      captureError(reason, { kind: 'unhandledRejection' });
    });

    process.on('uncaughtException', (err) => {
      console.error('[Server] Uncaught exception — shutting down:', err);
      captureError(err, { kind: 'uncaughtException' });
      // An uncaught exception means unknown state: flush, then let the platform
      // restart us rather than serving from a process we can't reason about.
      void flushMonitoring(2000).finally(() => shutdown('uncaughtException'));
    });

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

  } catch (err) {
    console.error('[Server] Fatal startup error:', err);
    process.exit(1);
  }
};

start();
