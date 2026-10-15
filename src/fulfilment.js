import { randomBytes } from 'node:crypto';

const FULFILMENT_TOPIC = 'fulfilment';

/**
 * Ticket issuing, off the critical path. Email / wallet delivery is a log line here.
 * Barcodes are random strings, not the signed rotating barcodes of the real system.
 * @param {{
 *   orders: ReturnType<import('./orders.js').createOrders>,
 *   queue: ReturnType<import('./queue.js').createQueue>,
 *   logger: ReturnType<import('./log.js').createLogger>
 * }} deps
 */
export function createFulfilment({ orders, queue, logger }) {
  return {
    processFulfilment() {
      for (const message of queue.receive(FULFILMENT_TOPIC, 100)) {
        const order = orders.find(message.body.orderId);
        if (!order || order.status !== 'confirmed') {
          queue.nack(FULFILMENT_TOPIC, message.id, `order ${message.body.orderId} is not confirmed`);
          continue;
        }
        // Redelivery: tickets were already issued.
        if (order.tickets.length === 0) {
          orders.attachTickets(order.orderId, order.seatIds.map((seatId) => ({ seatId, barcode: randomBytes(12).toString('base64url') })));
          logger.info('tickets issued and delivery requested', { orderId: order.orderId, tickets: order.seatIds.length });
        }
        queue.ack(FULFILMENT_TOPIC, message.id);
      }
    },
  };
}
