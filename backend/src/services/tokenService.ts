import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { JWTPayload, normalizePlan } from '@/types';
import { RefreshToken, IUser, IDevice } from '@/models';

const REFRESH_EXPIRES_DAYS = 7;

// ─── Access Token ─────────────────────────────────────────────────────────────

export const generateAccessToken = (
  fastify: FastifyInstance,
  user: IUser,
  device: IDevice
): string => {
  const payload: JWTPayload = {
    userId:   user._id.toString(),
    deviceId: device.deviceId,
    email:    user.email,
    plan:     normalizePlan(user.plan),
    // Unique token id so a specific access token can be revoked on logout /
    // device removal before its 15-min expiry (see blockToken/isTokenBlocked).
    jti:      crypto.randomBytes(16).toString('hex'),
  };
  return fastify.jwt.sign(payload, { expiresIn: process.env.JWT_EXPIRES_IN ?? '15m' });
};

// ─── Refresh Token ────────────────────────────────────────────────────────────

export const generateRefreshToken = async (
  userId: string,
  deviceId: string
): Promise<string> => {
  const rawToken = crypto.randomBytes(64).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_EXPIRES_DAYS);

  // Revoke any existing tokens for this device
  await RefreshToken.updateMany({ userId, deviceId }, { isRevoked: true });

  await RefreshToken.create({ userId, deviceId, tokenHash, expiresAt });

  return rawToken;
};

export const verifyRefreshToken = async (
  rawToken: string,
  deviceId: string
): Promise<{ userId: string } | null> => {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  // Atomically claim-and-revoke the token: only one caller can flip a live token
  // to revoked, so two concurrent refreshes with the same token can't both mint
  // a new pair (double-spend). A matched-and-updated result is a valid rotation.
  const claimed = await RefreshToken.findOneAndUpdate(
    { tokenHash, deviceId, isRevoked: false, expiresAt: { $gt: new Date() } },
    { $set: { isRevoked: true } },
    { new: false }
  );
  if (claimed) return { userId: claimed.userId.toString() };

  // No live token matched. Look it up regardless of state to tell apart the
  // cases: unknown token, plain expiry, or a genuine reuse of an already-rotated
  // token (the replay signal that warrants revoking the whole family).
  const record = await RefreshToken.findOne({ tokenHash, deviceId });
  if (!record) return null;

  if (record.isRevoked) {
    await RefreshToken.updateMany({ userId: record.userId, deviceId }, { isRevoked: true });
    console.warn(`[Auth] Refresh token reuse detected for user ${record.userId} / device ${deviceId} — family revoked.`);
  }
  // Plain expiry is not a replay signal — just reject it.
  return null;
};

export const revokeRefreshToken = async (rawToken: string): Promise<void> => {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await RefreshToken.updateMany({ tokenHash }, { isRevoked: true });
};

export const revokeAllUserTokens = async (userId: string): Promise<void> => {
  await RefreshToken.updateMany({ userId }, { isRevoked: true });
};
