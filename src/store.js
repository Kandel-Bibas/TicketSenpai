// In-memory stand-in for the per-event Postgres shard. Node runs each function
// to completion, so every function here behaves like one serialised transaction.
//
// Table ownership (only the owner writes):
//   Catalog   → events
//   Inventory → seats, holds
//   Orders    → orders, orderItems
//   Checkout  → paymentIntents
// The outbox is appended by the seat/order writes themselves, which is the
// "same transaction" guarantee the relay depends on.

/**
 * @typedef {'available' | 'held' | 'sold'} SeatStatus
 * @typedef {{
 *   eventId: string, seatId: string, section: string, row: string | null, number: number | null,
 *   priceTier: string, status: SeatStatus, holdId: string | null,
 *   holdExpiresAt: number | null, version: number
 * }} Seat  holdExpiresAt === null on a held seat means the hold is pinned by an order.
 * @typedef {{
 *   holdId: string, eventId: string, accountId: string, seatIds: string[],
 *   createdAt: number, expiresAt: number, pinnedByOrderId: string | null
 * }} Hold
 */

export class UniqueViolation extends Error {}

/** @param {{ clock: { now: () => number } }} deps */
export function createStore({ clock }) {
  const events = new Map();
  /** @type {Map<string, Map<string, Seat>>} */
  const seats = new Map();
  /** @type {Map<string, Hold>} */
  const holds = new Map();
  const orders = new Map();
  const orderItems = new Map();
  const paymentIntents = new Map();
  const idempotency = new Map();

  const outbox = [];
  let outboxSeq = 0;

  function appendOutbox(eventId, type, payload) {
    outbox.push({ id: ++outboxSeq, eventId, type, payload, createdAt: clock.now() });
  }

  function seatChanged(seat) {
    seat.version += 1;
    appendOutbox(seat.eventId, 'seat.changed', { seatId: seat.seatId, status: seat.status, version: seat.version });
  }

  // The hold predicate. Expiry is lazy: an expired hold is simply holdable again.
  //   status = 'available' OR (status = 'held' AND hold_expires_at < now())
  const isHoldable = (seat, now) =>
    seat.status === 'available' ||
    (seat.status === 'held' && seat.holdExpiresAt !== null && seat.holdExpiresAt < now);

  const seatsOf = (eventId) => seats.get(eventId) ?? new Map();

  function seatsHeldBy(hold) {
    const rows = [];
    for (const seatId of hold.seatIds) {
      const seat = seatsOf(hold.eventId).get(seatId);
      if (seat && seat.holdId === hold.holdId && seat.status === 'held') rows.push(seat);
    }
    return rows;
  }

  return {
    events,
    holds,
    orders,
    paymentIntents,
    idempotency,

    insertSeats(eventId, rows) {
      const table = new Map();
      for (const row of rows) {
        table.set(row.seatId, { ...row, eventId, status: 'available', holdId: null, holdExpiresAt: null, version: 1 });
      }
      seats.set(eventId, table);
    },

    getSeat: (eventId, seatId) => seatsOf(eventId).get(seatId),
    listSeats: (eventId) => [...seatsOf(eventId).values()],

    /**
     * UPDATE seats SET status='held', hold_id=$1, hold_expires_at=$4
     *  WHERE event_id=$2 AND seat_id = ANY($3) AND <isHoldable>
     * A short row count rolls back: nothing is written and 0 is returned.
     * @returns {number} rows updated
     */
    holdSeats(eventId, seatIds, holdId, expiresAt) {
      const now = clock.now();
      const matched = [];
      for (const seatId of seatIds) {
        const seat = seatsOf(eventId).get(seatId);
        if (seat && isHoldable(seat, now)) matched.push(seat);
      }
      if (matched.length !== seatIds.length) return 0;
      for (const seat of matched) {
        seat.status = 'held';
        seat.holdId = holdId;
        seat.holdExpiresAt = expiresAt;
        seatChanged(seat);
      }
      return matched.length;
    },

    // Stand-in for SELECT ... FOR UPDATE SKIP LOCKED LIMIT $n.
    pickAvailable(eventId, section, quantity) {
      const now = clock.now();
      const picked = [];
      for (const seat of seatsOf(eventId).values()) {
        if (seat.section === section && isHoldable(seat, now)) picked.push(seat.seatId);
        if (picked.length === quantity) break;
      }
      return picked;
    },

    // Pins a live hold so it cannot expire while a payment is in flight.
    // Returns 0 without writing when any seat of the hold has expired or moved on.
    pinHold(holdId, orderId) {
      const hold = holds.get(holdId);
      const now = clock.now();
      const live = seatsHeldBy(hold).filter((seat) => seat.holdExpiresAt !== null && seat.holdExpiresAt >= now);
      if (live.length !== hold.seatIds.length) return 0;
      for (const seat of live) seat.holdExpiresAt = null;
      hold.pinnedByOrderId = orderId;
      return live.length;
    },

    unpinHold(holdId) {
      const hold = holds.get(holdId);
      for (const seat of seatsHeldBy(hold)) seat.holdExpiresAt = hold.expiresAt;
      hold.pinnedByOrderId = null;
    },

    /**
     * The seat half of the confirm transaction:
     *   UPDATE seats SET status='sold' WHERE hold_id=$1 AND status='held';
     *   INSERT INTO order_items (event_id, seat_id, order_id) ...;
     * Short row count → the hold was lost; nothing is written. UNIQUE (event_id, seat_id)
     * on order_items is the backstop behind the hold predicate, checked before any write.
     * @returns {number} rows updated
     */
    sellHeldSeats(holdId, orderId) {
      const hold = holds.get(holdId);
      const rows = seatsHeldBy(hold);
      if (rows.length !== hold.seatIds.length) return 0;
      for (const seat of rows) {
        if (orderItems.has(`${seat.eventId}:${seat.seatId}`)) {
          throw new UniqueViolation(`order_items: seat ${seat.seatId} of ${seat.eventId} is already in an order`);
        }
      }
      for (const seat of rows) {
        seat.status = 'sold';
        seat.holdExpiresAt = null;
        seatChanged(seat);
        orderItems.set(`${seat.eventId}:${seat.seatId}`, orderId);
      }
      return rows.length;
    },

    releaseHeldSeats(holdId) {
      const hold = holds.get(holdId);
      for (const seat of seatsHeldBy(hold)) {
        seat.status = 'available';
        seat.holdId = null;
        seat.holdExpiresAt = null;
        seatChanged(seat);
      }
      hold.pinnedByOrderId = null;
    },

    // Correctness never depends on this; it only makes expired holds visible
    // as "available" to the availability view.
    sweepExpiredHolds() {
      const now = clock.now();
      let released = 0;
      for (const table of seats.values()) {
        for (const seat of table.values()) {
          if (seat.status === 'held' && seat.holdExpiresAt !== null && seat.holdExpiresAt < now) {
            seat.status = 'available';
            seat.holdId = null;
            seat.holdExpiresAt = null;
            seatChanged(seat);
            released += 1;
          }
        }
      }
      return released;
    },

    // Pushes out the expiry of every hold that is still live, pinned or not.
    extendLiveHolds(eventId, extraMs) {
      const now = clock.now();
      for (const hold of holds.values()) {
        if (hold.eventId !== eventId) continue;
        const rows = seatsHeldBy(hold);
        if (rows.length === 0) continue;
        if (hold.pinnedByOrderId !== null) {
          hold.expiresAt += extraMs;
        } else if (hold.expiresAt >= now) {
          hold.expiresAt += extraMs;
          for (const seat of rows) seat.holdExpiresAt = hold.expiresAt;
        }
      }
    },

    countSeats(eventId) {
      const now = clock.now();
      const counts = { total: 0, available: 0, held: 0, sold: 0 };
      for (const seat of seatsOf(eventId).values()) {
        counts.total += 1;
        if (seat.status === 'sold') counts.sold += 1;
        else if (isHoldable(seat, now)) counts.available += 1;
        else counts.held += 1;
      }
      return counts;
    },

    appendOutbox,
    peekOutbox: (limit) => outbox.slice(0, limit),
    // Rows are published strictly in order, so publishing always removes the head.
    removeOutboxHead(id) {
      if (outbox[0]?.id !== id) throw new Error(`Outbox row ${id} is not the head; rows must be published in order`);
      outbox.shift();
    },
    oldestOutboxAgeMs: () => (outbox.length === 0 ? 0 : clock.now() - outbox[0].createdAt),
  };
}
