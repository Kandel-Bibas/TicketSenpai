/**
 * Continuous invariant checker. Any count above zero pages and closes the valve.
 * @param {{
 *   catalog: ReturnType<import('./catalog.js').createCatalog>,
 *   inventory: ReturnType<import('./inventory.js').createInventory>,
 *   orders: ReturnType<import('./orders.js').createOrders>,
 *   psp: ReturnType<import('./psp.js').createMockPsp>,
 *   clock: { now: () => number },
 *   logger: ReturnType<import('./log.js').createLogger>
 * }} deps
 */
export function createInvariantChecker({ catalog, inventory, orders, psp, clock, logger }) {
  let latest = { checkedAt: null, seatsInMultipleConfirmedOrders: 0, soldSeatsWithoutConfirmedOrder: 0, capturedPaymentsWithoutConfirmedOrder: 0 };

  return {
    check() {
      const confirmed = orders.all().filter((order) => order.status === 'confirmed');
      const confirmedIds = new Set(confirmed.map((order) => order.orderId));

      const timesSold = new Map();
      for (const order of confirmed) {
        for (const seatId of order.seatIds) {
          const key = `${order.eventId}:${seatId}`;
          timesSold.set(key, (timesSold.get(key) ?? 0) + 1);
        }
      }

      let soldSeatsWithoutConfirmedOrder = 0;
      for (const event of catalog.allEvents()) {
        for (const seat of inventory.seats(event.eventId)) {
          if (seat.status === 'sold' && !timesSold.has(`${event.eventId}:${seat.seatId}`)) soldSeatsWithoutConfirmedOrder += 1;
        }
      }

      latest = {
        checkedAt: clock.now(),
        seatsInMultipleConfirmedOrders: [...timesSold.values()].filter((n) => n > 1).length,
        soldSeatsWithoutConfirmedOrder,
        capturedPaymentsWithoutConfirmedOrder: psp.capturedKeys().filter((orderId) => !confirmedIds.has(orderId)).length,
      };
      if (this.violated()) logger.error('INVARIANT VIOLATED — release rate forced to zero', latest);
      return latest;
    },

    latest: () => latest,
    violated: () =>
      latest.seatsInMultipleConfirmedOrders > 0 ||
      latest.soldSeatsWithoutConfirmedOrder > 0 ||
      latest.capturedPaymentsWithoutConfirmedOrder > 0,
  };
}
