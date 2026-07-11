import { describe, it, expect, jest } from '@jest/globals';
import { requirePlan } from '@/middleware/auth';
import type { FastifyReply, FastifyRequest } from 'fastify';

function mockReply() {
  const code = jest.fn((_status: number) => reply);
  const send = jest.fn((_body: unknown) => reply);
  const reply = { code, send } as any;
  return { reply: reply as FastifyReply, code, send };
}

const reqWithPlan = (plan: string) =>
  ({ user: { plan } } as unknown as FastifyRequest);

describe('requirePlan middleware', () => {
  it('allows a user whose plan is in the allow-list', async () => {
    const { reply, code } = mockReply();
    await requirePlan('guard', 'elite')(reqWithPlan('guard'), reply);
    expect(code).not.toHaveBeenCalled();
  });

  it('allows the elite tier for a guard-or-elite gate', async () => {
    const { reply, code } = mockReply();
    await requirePlan('guard', 'elite')(reqWithPlan('elite'), reply);
    expect(code).not.toHaveBeenCalled();
  });

  it('rejects a free user with 403 and an upgrade hint', async () => {
    const { reply, code, send } = mockReply();
    await requirePlan('guard', 'elite')(reqWithPlan('free'), reply);
    expect(code).toHaveBeenCalledWith(403);
    const body = (send.mock.calls[0] as any[])[0];
    expect(body.currentPlan).toBe('free');
    expect(body.requiredPlans).toEqual(['guard', 'elite']);
    expect(body.upgradeUrl).toContain('upgrade');
  });
});
