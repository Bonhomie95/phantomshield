import { FastifyPluginAsync } from 'fastify';
import { customAlphabet } from 'nanoid';
import { z } from 'zod';
import { User } from '@/models';
import { authenticate } from '@/middleware/auth';
import { JWTPayload } from '@/types';
import { applyGuardBonus } from '@/lib/plans';

const genCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

// A successful referral grants both people 30 days of Guard — but only if they
// aren't already on a paid plan (never downgrade a real subscriber).
const REWARD_DAYS = 30;

function grantGuardBonus(user: any) {
  const next = applyGuardBonus({ plan: user.plan, planExpiresAt: user.planExpiresAt }, REWARD_DAYS);
  user.plan = next.plan;
  user.planExpiresAt = next.planExpiresAt;
}

async function ensureReferralCode(user: any): Promise<string> {
  if (user.referralCode) return user.referralCode;
  // Retry a few times in the unlikely event of a collision.
  for (let i = 0; i < 5; i++) {
    const code = genCode();
    if (!(await User.exists({ referralCode: code }))) {
      user.referralCode = code;
      await user.save();
      return code;
    }
  }
  throw new Error('Could not allocate referral code');
}

const referralRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /referrals/me — my code + stats ───────────────────────────
  fastify.get('/referrals/me', { preHandler: [authenticate] }, async (request, reply) => {
    const jwt = request.user as JWTPayload;
    const user = await User.findById(jwt.userId);
    if (!user) return reply.code(404).send({ error: 'User not found.' });

    const code = await ensureReferralCode(user);
    return reply.code(200).send({
      code,
      referralCount: user.referralCount ?? 0,
      shareUrl: `https://phantomshield.app/i/${code}`,
      alreadyReferred: !!user.referredBy,
    });
  });

  // ── POST /referrals/redeem — redeem someone's code ────────────────
  fastify.post('/referrals/redeem', { preHandler: [authenticate] }, async (request, reply) => {
    const jwt = request.user as JWTPayload;
    const parsed = z.object({ code: z.string().min(4).max(12) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid code.' });

    const me = await User.findById(jwt.userId);
    if (!me) return reply.code(404).send({ error: 'User not found.' });
    if (me.referredBy) return reply.code(409).send({ error: 'You have already redeemed a referral.' });

    const code = parsed.data.code.toUpperCase();
    if (code === me.referralCode) return reply.code(400).send({ error: 'You can’t redeem your own code.' });

    const referrer = await User.findOne({ referralCode: code });
    if (!referrer) return reply.code(404).send({ error: 'That code doesn’t exist.' });

    // Reward both sides and record the link.
    me.referredBy = referrer._id;
    grantGuardBonus(me);
    grantGuardBonus(referrer);
    referrer.referralCount = (referrer.referralCount ?? 0) + 1;
    await Promise.all([me.save(), referrer.save()]);

    return reply.code(200).send({
      message: `You both earned ${REWARD_DAYS} days of Phantom Guard!`,
      plan: me.plan,
      planExpiresAt: me.planExpiresAt,
    });
  });
};

export default referralRoutes;
