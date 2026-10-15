import { randomUUID } from 'node:crypto';
import { ApiError } from './errors.js';

/**
 * @typedef {'payment_in_flight' | 'payment_unknown' | 'confirmed' | 'declined' | 'cancelled'} OrderStatus
 * @typedef {{
 *   orderId: string, eventId: string, accountId: string, holdId: string, seatIds: string[],
 *   totalCents: number, currency: string, status: OrderStatus,
 *   reason: 'card_declined' | 'hold_lost' | 'payment_not_found' | null,
 *   tickets: { seatId: string, barcode: string }[],
 *   createdAt: number, updatedAt: number
 * }} Order
 */

// Seats in these orders count against the per-account limit.
const COMMITTED = new Set(['payment_in_flight', 'payment_unknown', 'confirmed']);

/**
 * Orders — sole writer of orders and order items, and the home of the per-account seat limit.
 * @param {{
 *   store: ReturnType<import('./store.js').createStore>,
 *   catalog: ReturnType<import('./catalog.js').createCatalog>,
 *   inventory: ReturnType<import('./inventory.js').createInventory>,
 *   clock: { now: () => number },
 *   logger: ReturnType<import('./log.js').createLogger>
 * }} deps
 */
export function createOrders({ store, catalog, inventory, clock, logger }) {
  function mustFind(orderId) {
    const order = store.orders.get(orderId);
    if (!order) throw new Error(`Order ${orderId} does not exist`);
    return order;
  }

  function transition(order, status, reason = null) {
    logger.info('order status changed', { orderId: order.orderId, eventId: order.eventId, from: order.status, to: status, reason });
    order.status = status;
    order.reason = reason;
    order.updatedAt = clock.now();
  }

  function committedSeatCount(eventId, accountId) {
    let count = 0;
    for (const order of store.orders.values()) {
      if (order.eventId === eventId && order.accountId === accountId && COMMITTED.has(order.status)) {
        count += order.seatIds.length;
      }
    }
    return count;
  }

  return {
    /** @returns {Order} */
    createOrder({ eventId, accountId, holdId }) {
      const event = catalog.getEvent(eventId);
      const hold = inventory.findHold(holdId);
      if (!hold || hold.eventId !== eventId || hold.accountId !== accountId) {
        throw new ApiError(404, 'hold_not_found', `No hold with id ${holdId}`);
      }
      if (hold.pinnedByOrderId !== null) {
        throw new ApiError(409, 'hold_in_use', 'This hold already has an order being paid for or completed');
      }
      if (committedSeatCount(eventId, accountId) + hold.seatIds.length > event.seatLimitPerAccount) {
        throw new ApiError(422, 'seat_limit_exceeded', `An account may buy at most ${event.seatLimitPerAccount} seats for this event`);
      }

      const orderId = `ord_${randomUUID()}`;
      if (inventory.pinHold(holdId, orderId) !== hold.seatIds.length) {
        throw new ApiError(409, 'hold_expired', 'The hold expired before the order was placed');
      }

      const seats = inventory.seats(eventId).filter((seat) => hold.seatIds.includes(seat.seatId));
      const now = clock.now();
      /** @type {Order} */
      const order = {
        orderId, eventId, accountId, holdId,
        seatIds: [...hold.seatIds],
        totalCents: seats.reduce((sum, seat) => sum + event.priceTiers[seat.priceTier], 0),
        currency: event.currency,
        status: 'payment_in_flight',
        reason: null,
        tickets: [],
        createdAt: now,
        updatedAt: now,
      };
      store.orders.set(orderId, order);
      store.appendOutbox(eventId, 'order.created', { orderId });
      logger.info('order created', { orderId, eventId, seats: order.seatIds.length });
      return order;
    },

    /** @returns {Order} */
    getOrderFor({ eventId, accountId, orderId }) {
      const order = store.orders.get(orderId);
      if (!order || order.eventId !== eventId || order.accountId !== accountId) {
        throw new ApiError(404, 'order_not_found', `No order with id ${orderId}`);
      }
      return order;
    },

    /** @returns {Order | undefined} */
    find: (orderId) => store.orders.get(orderId),

    /**
     * One transaction: seats → sold WHERE hold_id matches, order → confirmed.
     * @returns {'confirmed' | 'hold_lost'}
     */
    confirm(orderId) {
      const order = mustFind(orderId);
      if (inventory.sellHeldSeats(order.holdId, orderId) !== order.seatIds.length) return 'hold_lost';
      transition(order, 'confirmed');
      store.appendOutbox(order.eventId, 'order.confirmed', { orderId });
      return 'confirmed';
    },

    // Back to "held": the shopper may retry with a new order on the same hold.
    markDeclined(orderId) {
      const order = mustFind(orderId);
      inventory.unpinHold(order.holdId);
      transition(order, 'declined', 'card_declined');
    },

    // Seats stay pinned: we do not know whether the card was charged.
    markPaymentUnknown(orderId) {
      transition(mustFind(orderId), 'payment_unknown');
    },

    /** @param {'hold_lost' | 'payment_not_found'} reason */
    cancel(orderId, reason) {
      const order = mustFind(orderId);
      inventory.releaseHold(order.holdId);
      transition(order, 'cancelled', reason);
    },

    attachTickets(orderId, tickets) {
      const order = mustFind(orderId);
      order.tickets = tickets;
      order.updatedAt = clock.now();
    },

    withStatus: (status) => [...store.orders.values()].filter((order) => order.status === status),
    all: () => [...store.orders.values()],

    // Age of the oldest order still waiting on the payment pipeline (outbox → queue → worker).
    oldestInFlightAgeMs(eventId) {
      let oldest = null;
      for (const order of store.orders.values()) {
        if (order.eventId === eventId && order.status === 'payment_in_flight' && (oldest === null || order.createdAt < oldest)) {
          oldest = order.createdAt;
        }
      }
      return oldest === null ? 0 : clock.now() - oldest;
    },

    hasConfirmedSince(eventId, accountId, since) {
      for (const order of store.orders.values()) {
        if (order.eventId === eventId && order.accountId === accountId && order.status === 'confirmed' && order.updatedAt >= since) {
          return true;
        }
      }
      return false;
    },
  };
}
