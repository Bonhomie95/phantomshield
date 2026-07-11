import { FastifyPluginAsync } from 'fastify';
import { OAuth2Client }       from 'google-auth-library';
import appleSignin            from 'apple-signin-auth';
import { z }                  from 'zod';
import { User, Device }       from '@/models';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
} from '@/services/tokenService';
import { authenticate }              from '@/middleware/auth';
import { JWTPayload, VerifiedOAuthIdentity, OAuthProvider, PLAN_LIMITS } from '@/types';

// ─── Google OAuth client ──────────────────────────────────────────────────────

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
);

// ─── Token verification helpers ───────────────────────────────────────────────

async function verifyGoogleToken(idToken: string): Promise<VerifiedOAuthIdentity> {
  // audience can be either web or mobile client ID
  const audience = [
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_IOS_CLIENT_ID!,
    process.env.GOOGLE_ANDROID_CLIENT_ID!,
  ].filter(Boolean);

  const ticket  = await googleClient.verifyIdToken({ idToken, audience });
  const payload = ticket.getPayload();
  if (!payload || !payload.email) throw new Error('Invalid Google token payload.');

  return {
    providerId: payload.sub,
    email:      payload.email,
    name:       payload.name,
    photo:      payload.picture,
  };
}

async function verifyAppleToken(idToken: string): Promise<VerifiedOAuthIdentity> {
  const payload = await appleSignin.verifyIdToken(idToken, {
    audience:          process.env.APPLE_BUNDLE_ID ?? 'dev.bonhomieinc.phantomshield',
    ignoreExpiration:  false,
  });

  return {
    providerId: payload.sub,
    email:      payload.email ?? '', // Apple may omit email after first sign-in
  };
}

// ─── Validation schemas ───────────────────────────────────────────────────────

const DeviceSchema = z.object({
  deviceId:    z.string().max(128),
  platform:    z.enum(['ios', 'android', 'web']),
  model:       z.string().optional(),
  osVersion:   z.string().optional(),
  appVersion:  z.string().optional(),
  pushToken:   z.string().optional(),
});

const OAuthSchema = z.object({
  provider:       z.enum(['google', 'apple']),
  idToken:        z.string().min(20),
  appleUserData:  z.object({
    email: z.string().email().optional(),
    name:  z.string().optional(),
  }).optional(),
  device: DeviceSchema,
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
  deviceId:     z.string().min(1),
});

// ─── Plugin ───────────────────────────────────────────────────────────────────

// Unauthenticated auth endpoints are keyed by IP under the global limiter;
// tighten them further so credential-stuffing / token-guessing is throttled
// well below the default API budget.
const AUTH_RATE_LIMIT = {
  max:        parseInt(process.env.AUTH_RATE_LIMIT_MAX ?? '10', 10),
  timeWindow: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW ?? '60000', 10),
};

const authRoutes: FastifyPluginAsync = async (fastify) => {

  // ── POST /auth/oauth ────────────────────────────────────────────────────────
  // Single endpoint for both Google and Apple sign-in.
  // Accepts the ID token from the mobile client, verifies it server-side,
  // then creates or finds the user and returns our JWT pair.
  fastify.post('/oauth', { config: { rateLimit: AUTH_RATE_LIMIT } }, async (request, reply) => {
    const parsed = OAuthSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const { provider, idToken, appleUserData, device } = parsed.data;

    // 1. Verify token with the provider — reject anything we can't verify
    let identity: VerifiedOAuthIdentity;
    try {
      if (provider === 'google') {
        identity = await verifyGoogleToken(idToken);
      } else {
        identity = await verifyAppleToken(idToken);
        // Apple only sends email on the very first sign-in for a user
        if (!identity.email && appleUserData?.email) {
          identity.email = appleUserData.email;
        }
        if (!identity.name && appleUserData?.name) {
          identity.name = appleUserData.name;
        }
      }
    } catch (err: any) {
      request.log.warn({ provider, err: err.message }, 'OAuth token verification failed');
      return reply.code(401).send({ error: 'Token verification failed. Sign in again.' });
    }

    if (!identity.email) {
      return reply.code(422).send({ error: 'Unable to retrieve email from provider.' });
    }

    // 2. Find or create user
    const providerIdField = provider === 'google' ? 'googleId' : 'appleId';

    // First: look up by provider ID (most accurate — handles email changes)
    let user = await User.findOne({ [providerIdField]: identity.providerId });

    // Second: fall back to email — handles "same person, first time with this provider"
    if (!user) {
      user = await User.findOne({ email: identity.email });
    }

    const isNewUser = !user;

    if (!user) {
      user = await User.create({
        email:             identity.email,
        name:              identity.name,   // schema defaults to null when undefined
        photo:             identity.photo,
        provider,
        [providerIdField]: identity.providerId,
      });
    } else {
      // Backfill the provider ID if the user signed in before with email/different provider
      if (!user[providerIdField as keyof typeof user]) {
        (user as any)[providerIdField] = identity.providerId;
      }
      // Keep name/photo fresh from provider
      if (identity.name  && !user.name)  user.name  = identity.name;
      if (identity.photo && !user.photo) user.photo = identity.photo;
      user.lastLoginAt = new Date();
      await user.save();
    }

    if (!user.isActive) {
      return reply.code(403).send({ error: 'Account suspended.' });
    }

    // 3. Upsert device — scoped to the authenticated user.
    let dev = await Device.findOne({ deviceId: device.deviceId, userId: user._id });
    if (!dev) {
      // Enforce the plan's device cap before registering a brand-new device.
      // (This is the real entry point for device creation — the standalone
      // checkDeviceLimit guard never sees the OAuth flow.)
      const limit = PLAN_LIMITS[user.plan].devices;
      const activeCount = await Device.countDocuments({ userId: user._id, isActive: true });
      if (activeCount >= limit) {
        return reply.code(403).send({
          error: 'Device limit reached',
          message: `Your ${user.plan} plan allows ${limit} device(s). Remove one or upgrade to add this device.`,
        });
      }
      // A deviceId is unique per physical install. If it currently belongs to a
      // different account, the device changed hands — reassign it to the user
      // who just authenticated (they physically hold the device) instead of
      // letting a caller who merely knows the id touch another account's record.
      await Device.deleteOne({ deviceId: device.deviceId, userId: { $ne: user._id } });
      dev = await Device.create({ userId: user._id, ...device });
    } else {
      dev.lastSeenAt = new Date();
      if (device.pushToken) dev.pushToken = device.pushToken;
      await dev.save();
    }

    // 4. Issue tokens
    const accessToken  = generateAccessToken(fastify, user, dev);
    const refreshToken = await generateRefreshToken(user._id.toString(), device.deviceId);

    return reply.code(200).send({
      accessToken,
      refreshToken,
      isNewUser,   // mobile uses this to decide: setup-pins vs biometric-gate
      user: {
        id:        user._id,
        email:     user.email,
        name:      user.name,
        photo:     user.photo,
        plan:      user.plan,
        provider,
        createdAt: user.createdAt,
      },
    });
  });

  // ── POST /auth/refresh ─────────────────────────────────────────────────────
  fastify.post('/refresh', { config: { rateLimit: AUTH_RATE_LIMIT } }, async (request, reply) => {
    const parsed = RefreshSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed' });
    }
    const { refreshToken, deviceId } = parsed.data;

    const result = await verifyRefreshToken(refreshToken, deviceId);
    if (!result) {
      return reply.code(401).send({ error: 'Invalid or expired refresh token.' });
    }

    const user   = await User.findById(result.userId);
    const device = await Device.findOne({ deviceId, userId: result.userId });
    if (!user || !device) {
      return reply.code(401).send({ error: 'User or device not found.' });
    }

    await revokeRefreshToken(refreshToken);
    const newRefreshToken = await generateRefreshToken(user._id.toString(), deviceId);
    const newAccessToken  = generateAccessToken(fastify, user, device);

    return reply.code(200).send({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  });

  // ── POST /auth/logout ──────────────────────────────────────────────────────
  fastify.post('/logout', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const body = request.body as { refreshToken?: string; logoutAll?: boolean };

    if (body.logoutAll) {
      await revokeAllUserTokens(user.userId);
    } else if (body.refreshToken) {
      await revokeRefreshToken(body.refreshToken);
    }

    return reply.code(200).send({ message: 'Logged out.' });
  });
};

export default authRoutes;
