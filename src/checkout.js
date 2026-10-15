import { createRateBudget } from './rateBudget.js';

const PAYMENTS_TOPIC = 'payments';
const PROVIDER_RETRY_DELAY_MS = 1000;

/**
 * Checkout — sole writer of payment intents, and the worker-role payment flow:
 * authorise → confirm seats → capture, with the provider's idempotency key = order id.
 * @param {{
 *   store: ReturnType<import('./store.js').createStore>,
 *   orders: ReturnType<import('./orders.js').createOrders>,
 *   psp: ReturnType<import('./psp.js').createMockPsp>,
 *   breaker: ReturnType<import('./breaker.js').createBreaker>,
 *   queue: ReturnType<import('./queue.js').createQueue>,
 *   metrics: ReturnType<import('./metrics.js').createMetrics>,
 *   clock: { now: () => number },
 *   logger: ReturnType<import('./log.js').createLogger>,
 *   pspMaxTps: number,
 *   reconcileAfterMs: number
 * }} deps
 */
export function createCheckout({ store, orders, psp, breaker, queue, metrics, clock, logger, pspMaxTps, reconcileAfterMs }) {
  const budget = createRateBudget(clock);

  function intentFor(orderId) {
    const intent = store.paymentIntents.get(orderId);
    if (!intent) throw new Error(`Order ${orderId} has no payment intent`);
    return intent;
  }

  // The card is authorised. Confirm the seats; capture only if we still own them.
  function settleAuthorized(order) {
    const intent = intentFor(order.orderId);
    if (orders.confirm(order.orderId) === 'hold_lost') {
      psp.void(order.orderId);
      intent.status = 'voided';
      orders.cancel(order.orderId, 'hold_lost');
      metrics.recordLostHoldVoid(order.eventId);
      logger.error('authorisation voided because the hold was lost', { orderId: order.orderId, eventId: order.eventId });
      return;
    }
    const captured = psp.capture(order.orderId);
    if (captured.kind !== 'captured') {
      throw new Error(`Capture for confirmed order ${order.orderId} returned "${captured.kind}"`);
    }
    intent.status = 'captured';
  }

  /** @returns {'ack' | 'retry'} */
  function handlePayment(message) {
    const order = orders.find(message.body.orderId);
    if (!order) throw new Error(`Payment message for unknown order ${message.body.orderId}`);
    // Redelivery of a message whose work already happened.
    if (order.status !== 'payment_in_flight') return 'ack';

    const intent = intentFor(order.orderId);
    const result = psp.authorize({
      idempotencyKey: order.orderId,
      amountCents: intent.amountCents,
      currency: intent.currency,
      paymentToken: intent.paymentToken,
    });

    switch (result.kind) {
      case 'unavailable':
        breaker.recordFailure();
        return 'retry';
      case 'timeout':
        breaker.recordFailure();
        intent.status = 'unknown';
        orders.markPaymentUnknown(order.orderId);
        return 'ack';
      case 'declined':
        breaker.recordSuccess();
        intent.status = 'declined';
        orders.markDeclined(order.orderId);
        return 'ack';
      case 'approved':
        breaker.recordSuccess();
        intent.status = 'authorized';
        settleAuthorized(order);
        return 'ack';
      default:
        throw new Error(`Unhandled authorise result "${result.kind}"`);
    }
  }

  return {
    // paymentToken is the provider's client-side card token; it is never logged or returned.
    // The order, its intent and the order.created outbox row are one transaction.
    placeOrder({ eventId, accountId, holdId, paymentToken }) {
      const order = orders.createOrder({ eventId, accountId, holdId });
      store.paymentIntents.set(order.orderId, {
        orderId: order.orderId,
        amountCents: order.totalCents,
        currency: order.currency,
        paymentToken,
        status: 'created',
      });
      return order;
    },

    // Worker tick. Paced at the provider's cap; an open breaker stops all calls,
    // a half-open one lets a single probe through.
    processPayments() {
      const state = breaker.state();
      const allowance = budget.take(pspMaxTps);
      if (state === 'open') return;
      const messages = queue.receive(PAYMENTS_TOPIC, state === 'half_open' ? 1 : allowance);
      if (state === 'half_open' && messages.length === 0) {
        if (psp.ping().kind === 'ok') breaker.recordSuccess();
        else breaker.recordFailure();
        return;
      }
      for (const message of messages) {
        let outcome;
        try {
          outcome = handlePayment(message);
        } catch (err) {
          logger.error('payment message failed', { messageId: message.id, error: err.message });
          queue.nack(PAYMENTS_TOPIC, message.id, err.message);
          continue;
        }
        if (outcome === 'ack') {
          queue.ack(PAYMENTS_TOPIC, message.id);
        } else {
          // A provider outage is not the message's fault, so it must not count towards dead-lettering.
          queue.defer(PAYMENTS_TOPIC, message.id, PROVIDER_RETRY_DELAY_MS);
          if (breaker.state() !== 'closed') return;
        }
      }
    },

    // Reconciler tick: asks the provider, by idempotency key, what really happened.
    reconcileUnknownPayments() {
      const cutoff = clock.now() - reconcileAfterMs;
      for (const order of orders.withStatus('payment_unknown')) {
        if (order.updatedAt > cutoff) continue;
        const found = psp.lookup(order.orderId);
        if (found.kind === 'unavailable') return;
        if (found.kind === 'found' && found.status !== 'voided') {
          intentFor(order.orderId).status = 'authorized';
          settleAuthorized(order);
        } else {
          psp.void(order.orderId);
          intentFor(order.orderId).status = 'voided';
          orders.cancel(order.orderId, 'payment_not_found');
        }
      }
    },
  };
}
