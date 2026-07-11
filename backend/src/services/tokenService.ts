import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { JWTPayload, PlanId } from '@/types';
import { RefreshToken, IUser, IDevice } from '@/models';
import { blockToken, isTokenBlocked } from '@/config/redis';

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
    plan:     user.plan as PlanId,
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

  // Look the token up regardless of state so we can distinguish "unknown" from
  // "known but already rotated" — the latter is a reuse/replay signal.
  const record = await RefreshToken.findOne({ tokenHash, deviceId });
  if (!record) return null;

  if (record.isRevoked || record.expiresAt <= new Date()) {
    // A rotated refresh token was presented again. In normal rotation the old
    // token is never reused, so this means it was captured and replayed —
    // revoke every token for this user+device to force a fresh sign-in.
    await RefreshToken.updateMany(
      { userId: record.userId, deviceId },
      { isRevoked: true }
    );
    console.warn(`[Auth] Refresh token reuse detected for user ${record.userId} / device ${deviceId} — family revoked.`);
    return null;
  }

  return { userId: record.userId.toString() };
};

export const revokeRefreshToken = async (rawToken: string): Promise<void> => {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await RefreshToken.updateMany({ tokenHash }, { isRevoked: true });
};

export const revokeAllUserTokens = async (userId: string): Promise<void> => {
  await RefreshToken.updateMany({ userId }, { isRevoked: true });
};

// ─── JWT Payload Verification with Blocklist ──────────────────────────────────

export const verifyAndCheckToken = async (
  fastify: FastifyInstance,
  token: string
): Promise<JWTPayload | null> => {
  try {
    const decoded = fastify.jwt.verify<JWTPayload & { jti?: string }>(token);
    if (decoded.jti && await isTokenBlocked(decoded.jti)) return null;
    return decoded;
  } catch {
    return null;
  }
};
