/**
 * Stand-in for the Redis availability view: derived, allowed to be stale,
 * rebuildable. It is never consulted when deciding who gets a seat.
 * @param {{ clock: { now: () => number } }} deps
 */
export function createAvailabilityView({ clock }) {
  /** @type {Map<string, Map<string, { section: string, status: string, version: number }>>} */
  const byEvent = new Map();
  let lastLagMs = 0;

  function viewOf(eventId) {
    const view = byEvent.get(eventId);
    if (!view) throw new Error(`Availability view for ${eventId} was never built`);
    return view;
  }

  return {
    rebuild(eventId, seats) {
      byEvent.set(eventId, new Map(seats.map((s) => [s.seatId, { section: s.section, status: s.status, version: s.version }])));
    },

    // Per-seat versions make replays and out-of-order deliveries harmless.
    apply(eventId, { seatId, status, version }, changedAt) {
      const current = viewOf(eventId).get(seatId);
      if (!current) throw new Error(`Seat ${seatId} is not in the availability view for ${eventId}`);
      if (current.version >= version) return;
      current.status = status;
      current.version = version;
      lastLagMs = clock.now() - changedAt;
    },

    /** @param {string | null} section */
    list(eventId, section) {
      const seats = [];
      for (const [seatId, entry] of viewOf(eventId)) {
        if (section === null || entry.section === section) seats.push({ seatId, status: entry.status, version: entry.version });
      }
      return seats;
    },

    lastLagMs: () => lastLagMs,
  };
}
