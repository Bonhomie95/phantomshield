import { FastifyPluginAsync } from 'fastify';
import { OAuth2Client }       from 'google-auth-library';
import appleSignin            from 'apple-signin-auth';
import { z }                  from 'zod';
import { User, Device, RefreshToken } from '@/models';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
} from '@/services/tokenService';
import crypto                        from 'crypto';
import { authenticate }              from '@/middleware/auth';
import { blockToken, createWsTicket } from '@/config/kv';
import { APPLE_BUNDLE_ID, APPLE_SERVICES_ID, exchangeAppleCode } from '@/lib/apple';
import { JWTPayload, VerifiedOAuthIdentity, PLAN_LIMITS, normalizePlan, AppError } from '@/types';
import { effectivePlan } from '@/lib/plans';

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

  // An empty audience list rejects EVERY token with a confusing
  // "Wrong recipient" error — fail with the actual cause instead.
  if (audience.length === 0) {
    throw new Error(
      'No GOOGLE_CLIENT_ID / GOOGLE_IOS_CLIENT_ID / GOOGLE_ANDROID_CLIENT_ID configured on the server.',
    );
  }

  const ticket  = await googleClient.verifyIdToken({ idToken, audience });
  const payload = ticket.getPayload();
  if (!payload || !payload.email) throw new Error('Invalid Google token payload.');
  // Only a provider-verified email may be trusted for account lookup/linking.
  const emailVerified = payload.email_verified === true;
  if (!emailVerified) throw new Error('Google email is not verified.');

  return {
    providerId:    payload.sub,
    email:         payload.email,
    emailVerified,
    name:          payload.name,
    photo:         payload.picture,
  };
}

async function verifyAppleToken(idToken: string): Promise<VerifiedOAuthIdentity> {
  // The iOS app's tokens are issued to the bundle id; the web dashboard's to
  // the Services ID. Accept exactly those two audiences.
  const payload = await appleSignin.verifyIdToken(idToken, {
    audience:          [APPLE_BUNDLE_ID, APPLE_SERVICES_ID].filter(Boolean),
    ignoreExpiration:  false,
  });

  // Apple's `email_verified` arrives as a boolean or the string "true".
  const verified = payload.email_verified === true || payload.email_verified === 'true';

  return {
    providerId:    payload.sub,
    email:         payload.email || undefined, // Apple may omit email after first sign-in
    // Only the email inside the signed token is trusted; client-supplied
    // appleUserData.email is never used for lookup/linking (account takeover).
    emailVerified: !!payload.email && verified,
  };
}

// ─── Validation schemas ───────────────────────────────────────────────────────

const DeviceSchema = z.object({
  deviceId:    z.string().min(8).max(128),
  platform:    z.enum(['ios', 'android', 'web']),
  model:       z.string().max(64).optional(),
  osVersion:   z.string().max(32).optional(),
  appVersion:  z.string().max(32).optional(),
  pushToken:   z.string().max(256).optional(),
});

const OAuthSchema = z.object({
  provider:       z.enum(['google', 'apple']),
  idToken:        z.string().min(20),
  appleUserData:  z.object({
    email: z.string().email().max(254).optional(),
    name:  z.string().max(128).optional(),
  }).optional(),
  /** Apple only: one-time code, exchanged for a revocable refresh token. */
  authorizationCode: z.string().max(2048).optional(),
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

    const { provider, idToken, appleUserData, authorizationCode, device } = parsed.data;

    // 1. Verify token with the provider — reject anything we can't verify
    let identity: VerifiedOAuthIdentity;
    try {
      if (provider === 'google') {
        identity = await verifyGoogleToken(idToken);
      } else {
        identity = await verifyAppleToken(idToken);
        // Apple only sends email on the very first sign-in for a user. We accept
        // the client-supplied value ONLY to populate a brand-new account, and it
        // stays flagged unverified so it can never be used for email-based
        // linking into an existing account (that path would be takeover).
        if (!identity.email && appleUserData?.email) {
          identity.email = appleUserData.email;
          identity.emailVerified = false;
        }
        if (!identity.name && appleUserData?.name) {
          identity.name = appleUserData.name;
        }
      }
    } catch (caught) {
      const err = caught as AppError;
      request.log.warn({ provider, err: err.message }, 'OAuth token verification failed');
      return reply.code(401).send({ error: 'Token verification failed. Sign in again.' });
    }

    // Google always supplies a verified email. Apple does NOT re-send it after
    // the first authorisation — so someone who deleted their account and signs
    // up again arrives with none. The Apple `sub` is a stable identity on its
    // own, so that account is created without an email rather than refused.
    if (!identity.email && provider === 'google') {
      return reply.code(422).send({ error: 'Unable to retrieve email from provider.' });
    }

    // 2. Find or create user
    const providerIdField = provider === 'google' ? 'googleId' : 'appleId';

    // First: look up by provider ID (most accurate — handles email changes)
    let user = await User.findOne({ [providerIdField]: identity.providerId });

    // Second: fall back to email — handles "same person, first time with this
    // provider". Only ever link on a PROVIDER-VERIFIED email; a client-supplied
    // (unverified) email must never resolve to an existing account.
    if (!user && identity.emailVerified && identity.email) {
      user = await User.findOne({ email: identity.email });
    }

    const isNewUser = !user;

    if (!user) {
      // Concurrent first sign-ins can both miss the lookup above; the unique
      // email/providerId indexes then make one create throw E11000. Upsert
      // atomically and re-fetch so the loser rides the winner's document.
      try {
        user = await User.create({
          email:             identity.email,
          name:              identity.name,   // schema defaults to null when undefined
          photo:             identity.photo,
          provider,
          [providerIdField]: identity.providerId,
        });
      } catch (caught) {
        const err = caught as AppError;
        if (err?.code !== 11000) throw err;
        user =
          (await User.findOne({ [providerIdField]: identity.providerId })) ??
          (identity.emailVerified && identity.email ? await User.findOne({ email: identity.email }) : null);
        if (!user) throw err;
      }
    }
    if (!isNewUser && user) {
      // Backfill the provider ID if the user signed in before with email/different provider
      if (!user[providerIdField as keyof typeof user]) {
        user.set(providerIdField, identity.providerId);
      }
      // Keep name/photo/email fresh from provider
      if (identity.email && !user.email && identity.emailVerified) user.email = identity.email;
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
      // The plan's device cap counts PHONES. A browser session on the web
      // dashboard is not a protected device, and counting it would lock a free
      // user out of the one surface they need when their phone is gone.
      if (device.platform !== 'web') {
        const limit = PLAN_LIMITS[effectivePlan(normalizePlan(user.plan), user.planExpiresAt)].devices;
        const phones = await Device.find({ userId: user._id, platform: { $ne: 'web' } })
          .sort({ lastSeenAt: 1 })
          .select('deviceId')
          .lean();
        // At the cap, sign-in retires the least-recently-seen phone instead of
        // refusing. Otherwise a reinstall (which mints a new device id on
        // Android) or a new handset would permanently lock the owner out.
        const excess = phones.length - limit + 1;
        if (excess > 0) {
          const retired = phones.slice(0, excess).map((d) => d.deviceId);
          await Promise.all([
            Device.deleteMany({ userId: user._id, deviceId: { $in: retired } }),
            RefreshToken.updateMany({ userId: user._id, deviceId: { $in: retired } }, { isRevoked: true }),
          ]);
          request.log.info({ userId: user.id, retired }, 'Device cap reached — retired oldest device(s)');
        }
      }
      // deviceId is unique PER USER (compound index), so a fresh install for
      // this account simply creates its own record; we never touch another
      // account's device document just because it shares a client-generated id.
      dev = await Device.create({ userId: user._id, ...device });
    } else {
      dev.lastSeenAt = new Date();
      if (device.pushToken) dev.pushToken = device.pushToken;
      if (device.appVersion) dev.appVersion = device.appVersion;
      if (device.osVersion) dev.osVersion = device.osVersion;
      if (device.model) dev.set('model', device.model);
      await dev.save();
    }

    // Apple: keep a revocable refresh token so account deletion can revoke the
    // Sign in with Apple authorisation. Best-effort — never blocks sign-in.
    if (provider === 'apple' && authorizationCode) {
      const appleRefresh = await exchangeAppleCode(authorizationCode);
      if (appleRefresh) await User.updateOne({ _id: user._id }, { $set: { appleRefreshToken: appleRefresh } });
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
        email:     user.email ?? null,
        name:      user.name,
        photo:     user.photo,
        plan:      effectivePlan(normalizePlan(user.plan), user.planExpiresAt),
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
    if (!user || !device || !user.isActive) {
      return reply.code(401).send({ error: 'User or device not found.' });
    }

    const newRefreshToken = await generateRefreshToken(user._id.toString(), deviceId);
    const newAccessToken  = generateAccessToken(fastify, user, device);

    return reply.code(200).send({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  });

  // ── POST /auth/logout ──────────────────────────────────────────────────────
  fastify.post('/logout', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const body = (request.body ?? {}) as { refreshToken?: string; logoutAll?: boolean };

    if (body.logoutAll) {
      await revokeAllUserTokens(user.userId);
    } else if (body.refreshToken) {
      await revokeRefreshToken(body.refreshToken);
    }

    // Also block THIS access token so it can't be used for its remaining
    // lifetime (refresh-token revocation alone leaves the access token live).
    if (user.jti && user.exp) {
      await blockToken(user.jti, user.exp * 1000).catch(() => {});
    }

    return reply.code(200).send({ message: 'Logged out.' });
  });

  // ── POST /auth/ws-ticket ─────────────────────────────────────────────────────
  // Mint a single-use, 30-second ticket for the WebSocket handshake so the client
  // never has to put a real access token in the WS URL query string.
  fastify.post('/ws-ticket', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const ticket = crypto.randomBytes(32).toString('hex');
    await createWsTicket(ticket, { userId: user.userId, deviceId: user.deviceId });
    return reply.code(200).send({ ticket, expiresIn: 30 });
  });
};

export default authRoutes;
