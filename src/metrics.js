const LATENCY_WINDOW = 500;

// Per-event counters behind the on-sale dashboard and the admission controller.
export function createMetrics() {
  const byEvent = new Map();

  function forEvent(eventId) {
    let m = byEvent.get(eventId);
    if (!m) {
      m = { holdAttempts: 0, holdsSucceeded: 0, seatTaken: 0, holdLatenciesMs: [], tokensIssued: 0, lostHoldVoids: 0 };
      byEvent.set(eventId, m);
    }
    return m;
  }

  return {
    /** @param {'ok' | 'seat_taken' | 'other'} outcome */
    recordHold(eventId, latencyMs, outcome) {
      const m = forEvent(eventId);
      m.holdAttempts += 1;
      if (outcome === 'ok') m.holdsSucceeded += 1;
      if (outcome === 'seat_taken') m.seatTaken += 1;
      m.holdLatenciesMs.push(latencyMs);
      if (m.holdLatenciesMs.length > LATENCY_WINDOW) m.holdLatenciesMs.shift();
    },
    recordTokenIssued: (eventId) => { forEvent(eventId).tokensIssued += 1; },
    recordLostHoldVoid: (eventId) => { forEvent(eventId).lostHoldVoids += 1; },

    holdP99Ms(eventId) {
      const sorted = [...forEvent(eventId).holdLatenciesMs].sort((a, b) => a - b);
      if (sorted.length === 0) return 0;
      return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1)];
    },

    snapshot(eventId) {
      const { holdLatenciesMs, ...counters } = forEvent(eventId);
      return { ...counters, holdP99Ms: this.holdP99Ms(eventId) };
    },
  };
}
