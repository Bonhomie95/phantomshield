import { FastifyRequest, FastifyReply } from 'fastify';
import { JWTPayload, PlanId, PlanLimits, PLAN_LIMITS, normalizePlan } from '@/types';
import { User, Device } from '@/models';
import { isTokenBlocked, kvSetNX } from '@/config/kv';

// ─── Core Auth Guard ──────────────────────────────────────────────────────────

export const authenticate = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> => {
  try {
    await request.jwtVerify();

    const payload = request.user as JWTPayload;

    // Revocation check: a token explicitly blocked on logout / device removal
    // must stop working immediately, not linger until its 15-min expiry.
    //
    // This check DEGRADES OPEN on a lookup failure, deliberately. The blocklist
    // is a defence-in-depth layer that shortens an already-short (15 min) token
    // lifetime; letting a transient DB error propagate out of this try/catch would
    // 401 every request from every user — a total outage — to close a bounded
    // window. Availability wins here, but loudly: the failure is logged so it
    // can be alerted on rather than passing silently.
    if (payload.jti) {
      try {
        if (await isTokenBlocked(payload.jti)) {
          return reply.code(401).send({ error: 'Unauthorized', message: 'Session ended.' });
        }
      } catch (err) {
        request.log.error(
          { err, jti: payload.jti },
          'Token blocklist unavailable — allowing request (revocation temporarily unenforced)',
        );
      }
    }

    // Device binding: token must be used from the device it was issued to. The
    // header is compared only when supplied — the token's own `deviceId` claim
    // is the authoritative binding for every device-scoped query regardless.
    const deviceId = request.headers['x-device-id'] as string;
    if (deviceId && deviceId !== payload.deviceId) {
      return reply.code(401).send({
        error: 'Device mismatch',
        message: 'This token was issued to a different device.',
      });
    }

    // Check user is still active
    const user = await User.findById(payload.userId).select('isActive plan planExpiresAt').lean();
    if (!user || !user.isActive) {
      return reply.code(401).send({ error: 'Account suspended' });
    }

    // Sync the effective plan onto the request from the DB (the JWT claim goes
    // stale for up to 15 min after an upgrade, cancellation, or expiry).
    // normalizePlan() maps legacy 'guard'/'elite' rows (and anything unknown)
    // onto the current free/starter/pro identifiers, so a subscription bought
    // before the rename keeps exactly the access it paid for.
    const expired = !!user.planExpiresAt && new Date(user.planExpiresAt) < new Date();
    (request.user as JWTPayload).plan = expired ? 'free' : normalizePlan(user.plan);

    // Throttle the lastSeen write to at most once/60s per device so we don't do
    // a DB write on every authenticated request under load.
    void touchDeviceLastSeen(payload.deviceId, payload.userId);
  } catch (err) {
    return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired token.' });
  }
};

/** Update Device.lastSeenAt at most once per minute per device. */
async function touchDeviceLastSeen(deviceId: string, userId: string): Promise<void> {
  try {
    const fresh = await kvSetNX(`seen:${userId}:${deviceId}`, 1, 60);
    if (!fresh) return; // written within the last 60s — skip
    await Device.updateOne({ deviceId, userId }, { $set: { lastSeenAt: new Date() } });
  } catch {
    /* best-effort — never block a request on presence bookkeeping */
  }
}

// ─── Plan Guard ───────────────────────────────────────────────────────────────

export const requirePlan = (...allowedPlans: PlanId[]) =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user as JWTPayload;
    if (!allowedPlans.includes(user.plan)) {
      return reply.code(403).send({
        error: 'Plan required',
        message: `This feature requires: ${allowedPlans.join(' or ')} plan.`,
        requiredPlans: allowedPlans,
        currentPlan: user.plan,
        upgradeUrl: 'https://phantomshield.app/upgrade',
      });
    }
  };

/**
 * Gate on a CAPABILITY rather than a hard-coded list of plan names.
 *
 * Preferred over `requirePlan` for anything user-facing: the tier names have
 * already changed once (guard/elite → starter/pro), and a capability flag in
 * PLAN_LIMITS is the single source of truth that survives the next rename.
 */
export const requireCapability = (
  capability: keyof PlanLimits,
  label: string,
) =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user as JWTPayload;
    const limits = PLAN_LIMITS[user.plan];
    if (!limits?.[capability]) {
      return reply.code(403).send({
        error: 'Upgrade required',
        message: `${label} requires a paid plan.`,
        capability,
        currentPlan: user.plan,
        upgradeUrl: 'https://phantomshield.app/upgrade',
      });
    }
  };
