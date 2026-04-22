import { ConversationLifecycleStatus } from '@prisma/client';
import {
  assertLifecycleTransition,
  canTransitionLifecycle,
} from './lifecycle-transitions';

describe('lifecycle-transitions', () => {
  it('permits the canonical flow NEW → AGENT_ANALYZING', () => {
    expect(
      canTransitionLifecycle(
        ConversationLifecycleStatus.NEW,
        ConversationLifecycleStatus.AGENT_ANALYZING,
      ),
    ).toBe(true);
  });

  it('permits self-transition as a no-op', () => {
    expect(
      canTransitionLifecycle(
        ConversationLifecycleStatus.PAYMENT_CONFIRMED,
        ConversationLifecycleStatus.PAYMENT_CONFIRMED,
      ),
    ).toBe(true);
  });

  it('rejects an illegal jump PAYMENT_CONFIRMED → NEW', () => {
    expect(
      canTransitionLifecycle(
        ConversationLifecycleStatus.PAYMENT_CONFIRMED,
        ConversationLifecycleStatus.NEW,
      ),
    ).toBe(false);
    expect(() =>
      assertLifecycleTransition(
        ConversationLifecycleStatus.PAYMENT_CONFIRMED,
        ConversationLifecycleStatus.NEW,
      ),
    ).toThrow();
  });

  it('rejects an illegal jump APPOINTMENT_PENDING → PAYMENT_CONFIRMED', () => {
    expect(
      canTransitionLifecycle(
        ConversationLifecycleStatus.APPOINTMENT_PENDING,
        ConversationLifecycleStatus.PAYMENT_CONFIRMED,
      ),
    ).toBe(false);
  });

  it('allows NEEDS_ATTENTION → anywhere non-terminal', () => {
    expect(
      canTransitionLifecycle(
        ConversationLifecycleStatus.NEEDS_ATTENTION,
        ConversationLifecycleStatus.AGENT_ANALYZING,
      ),
    ).toBe(true);
    expect(
      canTransitionLifecycle(
        ConversationLifecycleStatus.NEEDS_ATTENTION,
        ConversationLifecycleStatus.CLOSED_BY_CLIENT,
      ),
    ).toBe(true);
  });

  it('allows reopening from AUTO_CLOSED_INACTIVE via NEW', () => {
    expect(
      canTransitionLifecycle(
        ConversationLifecycleStatus.AUTO_CLOSED_INACTIVE,
        ConversationLifecycleStatus.NEW,
      ),
    ).toBe(true);
  });
});
