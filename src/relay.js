const BATCH = 500;

/**
 * Outbox relay: publishes committed changes, in order, to the availability
 * view and the durable queue. A row is removed only after it is published, so a
 * crash in between republishes it (at-least-once).
 * @param {{
 *   store: ReturnType<import('./store.js').createStore>,
 *   view: ReturnType<import('./availabilityView.js').createAvailabilityView>,
 *   queue: ReturnType<import('./queue.js').createQueue>
 * }} deps
 */
export function createRelay({ store, view, queue }) {
  return {
    publishOutbox() {
      for (const row of store.peekOutbox(BATCH)) {
        switch (row.type) {
          case 'seat.changed':
            view.apply(row.eventId, row.payload, row.createdAt);
            break;
          case 'order.created':
            queue.publish('payments', { orderId: row.payload.orderId });
            break;
          case 'order.confirmed':
            queue.publish('fulfilment', { orderId: row.payload.orderId });
            break;
          default:
            throw new Error(`Outbox row ${row.id} has unknown type "${row.type}"`);
        }
        store.removeOutboxHead(row.id);
      }
    },
  };
}
