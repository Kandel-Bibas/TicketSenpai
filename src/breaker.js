/**
 * Consecutive-failure circuit breaker for the payment provider.
 * closed → open after `failureThreshold` failures in a row; after `cooldownMs`
 * it goes half-open and lets a probe through; the probe's result closes or re-opens it.
 * @param {{ clock: { now: () => number }, failureThreshold: number, cooldownMs: number }} deps
 */
export function createBreaker({ clock, failureThreshold, cooldownMs }) {
  let consecutiveFailures = 0;
  let openedAt = null;

  function state() {
    if (openedAt === null) return 'closed';
    return clock.now() - openedAt >= cooldownMs ? 'half_open' : 'open';
  }

  return {
    state,
    recordSuccess() {
      consecutiveFailures = 0;
      openedAt = null;
    },
    recordFailure() {
      consecutiveFailures += 1;
      if (state() === 'half_open' || consecutiveFailures >= failureThreshold) openedAt = clock.now();
    },
  };
}
