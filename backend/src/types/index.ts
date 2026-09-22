import { FastifyRequest } from 'fastify';
import type { PlanId } from '@phantomshield/shared';

// Re-export the shared API contract so the rest of the backend can keep
// importing everything from '@/types'. The canonical definitions live in
// @phantomshield/shared and are shared with the mobile app and dashboard.
export * from '@phantomshield/shared';

// ─── Backend-only types ──────────────────────────────────────────────────────

export interface JWTPayload {
  userId:   string;
  deviceId: string;
  /** Absent for an Apple account without a shared email. */
  email?:   string;
  plan:     PlanId;
  /** Unique access-token id, used for revocation via the token blocklist. */
  jti?: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: JWTPayload;
}

/** Normalised identity after verifying a provider token (server-side only). */
export interface VerifiedOAuthIdentity {
  providerId:    string;   // provider's user sub/uid
  email?:        string;
  /** True only when the provider asserted the email is verified in the signed token. */
  emailVerified: boolean;
  name?:         string;
  photo?:        string;
}

/** Shape of the errors we inspect in catch blocks (Mongo driver, provider SDKs). */
export interface AppError {
  code?: number;
  message?: string;
  writeErrors?: unknown;
  result?: { nInserted?: number };
  insertedDocs?: unknown[];
  statusCode?: number;
}
