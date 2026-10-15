import { randomUUID } from 'node:crypto';
import { ApiError } from './errors.js';

/**
 * Inventory & holds — the one contended resource. Sole writer of seats and holds.
 * @param {{
 *   store: ReturnType<import('./store.js').createStore>,
 *   clock: { now: () => number },
 *   holdTtlMs: number
 * }} deps
 */
export function createInventory({ store, clock, holdTtlMs }) {
  return {
    /**
     * @param {{ eventId: string, accountId: string, selection:
     *   { kind: 'seats', seatIds: string[] } | { kind: 'best_available', section: string, quantity: number } }} request
     * @returns {import('./store.js').Hold}
     */
    createHold({ eventId, accountId, selection }) {
      let seatIds;
      if (selection.kind === 'seats') {
        seatIds = selection.seatIds;
        const unknown = seatIds.find((seatId) => !store.getSeat(eventId, seatId));
        if (unknown) throw new ApiError(422, 'unknown_seat', `Seat ${unknown} does not exist for this event`);
      } else {
        seatIds = store.pickAvailable(eventId, selection.section, selection.quantity);
        if (seatIds.length < selection.quantity) {
          throw new ApiError(409, 'not_enough_seats', `Section ${selection.section} has fewer than ${selection.quantity} seats available`);
        }
      }

      const holdId = `hold_${randomUUID()}`;
      const now = clock.now();
      const expiresAt = now + holdTtlMs;
      if (store.holdSeats(eventId, seatIds, holdId, expiresAt) !== seatIds.length) {
        throw new ApiError(409, 'seat_taken', 'At least one requested seat is no longer available');
      }
      const hold = { holdId, eventId, accountId, seatIds, createdAt: now, expiresAt, pinnedByOrderId: null };
      store.holds.set(holdId, hold);
      return hold;
    },

    /** @returns {import('./store.js').Hold | undefined} */
    findHold: (holdId) => store.holds.get(holdId),

    pinHold: (holdId, orderId) => store.pinHold(holdId, orderId),
    unpinHold: (holdId) => store.unpinHold(holdId),
    sellHeldSeats: (holdId, orderId) => store.sellHeldSeats(holdId, orderId),
    releaseHold: (holdId) => store.releaseHeldSeats(holdId),
    extendLiveHolds: (eventId, extraMs) => store.extendLiveHolds(eventId, extraMs),
    sweepExpiredHolds: () => store.sweepExpiredHolds(),

    counts: (eventId) => store.countSeats(eventId),
    seats: (eventId) => store.listSeats(eventId),
  };
}
