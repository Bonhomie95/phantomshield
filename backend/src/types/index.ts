import { FastifyRequest } from 'fastify';
import type { PlanId, SyncBatch } from '@phantomshield/shared';

// Re-export the shared API contract so the rest of the backend can keep
// importing everything from '@/types'. The canonical definitions live in
// @phantomshield/shared and are shared with the mobile app and dashboard.
export * from '@phantomshield/shared';

// ─── Backend-only types ──────────────────────────────────────────────────────

export interface JWTPayload {
  userId:   string;
  deviceId: string;
  email:    string;
  plan:     PlanId;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: JWTPayload;
}

/** Normalised identity after verifying a provider token (server-side only). */
export interface VerifiedOAuthIdentity {
  providerId: string;   // provider's user sub/uid
  email:      string;
  name?:      string;
  photo?:     string;
}

/** @deprecated Kept for existing imports — use `SyncBatch` from the shared contract. */
export type SyncBatchPayload = SyncBatch;
