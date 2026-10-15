/**
 * Turns a per-second rate into whole units per call, carrying the fraction.
 * Unused budget is capped at one second's worth so an idle period cannot
 * turn into a burst.
 * @param {{ now: () => number }} clock
 */
export function createRateBudget(clock) {
  let last = clock.now();
  let carry = 0;
  return {
    /** @param {number} ratePerSecond */
    take(ratePerSecond) {
      const now = clock.now();
      const elapsedSeconds = (now - last) / 1000;
      last = now;
      carry = Math.min(carry + ratePerSecond * elapsedSeconds, Math.max(ratePerSecond, 1));
      const whole = Math.floor(carry);
      carry -= whole;
      return whole;
    },
  };
}
