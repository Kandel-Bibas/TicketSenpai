import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMock, EVENT } from './helpers.js';

test('happy path: hold, order, confirm, tickets, availability, dashboard, invariants', async () => {
  const mock = await startMock();
  try {
    const token = await mock.admit('buyer-1');

    const hold = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-1', token, key: 'hold-key-happy-1',
      body: { seatIds: ['A-1-1', 'A-1-2'] },
    });
    assert.equal(hold.status, 201);
    assert.deepEqual(hold.body.seatIds.sort(), ['A-1-1', 'A-1-2']);

    const order = await mock.call('POST', `/events/${EVENT}/orders`, {
      account: 'buyer-1', token, key: 'order-key-happy-1',
      body: { holdId: hold.body.holdId, paymentToken: 'tok_visa' },
    });
    assert.equal(order.status, 202);
    assert.equal(order.body.status, 'payment_in_flight');
    assert.equal(order.body.totalCents, 37000);
    const orderId = order.body.orderId;

    mock.elapse(1000);

    const after = await mock.call('GET', `/events/${EVENT}/orders/${orderId}`, { account: 'buyer-1' });
    assert.equal(after.status, 200);
    assert.equal(after.body.status, 'confirmed');
    assert.equal(after.body.tickets.length, 2);
    for (const ticket of after.body.tickets) {
      assert.ok(['A-1-1', 'A-1-2'].includes(ticket.seatId));
      assert.equal(typeof ticket.barcode, 'string');
      assert.ok(ticket.barcode.length > 0);
    }

    const availability = await mock.call('GET', `/events/${EVENT}/availability?section=A`, { account: 'buyer-1', token });
    assert.equal(availability.status, 200);
    const byId = new Map(availability.body.seats.map((s) => [s.seatId, s]));
    assert.equal(byId.get('A-1-1').status, 'sold');
    assert.equal(byId.get('A-1-2').status, 'sold');

    const dashboard = await mock.call('GET', `/admin/events/${EVENT}/dashboard`);
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.inventory.sold, 2);

    mock.elapse(5000);

    const dashboard2 = await mock.call('GET', `/admin/events/${EVENT}/dashboard`);
    assert.equal(dashboard2.status, 200);
    assert.notEqual(dashboard2.body.invariants.checkedAt, null);
    assert.equal(dashboard2.body.invariants.seatsInMultipleConfirmedOrders, 0);
    assert.equal(dashboard2.body.invariants.soldSeatsWithoutConfirmedOrder, 0);
    assert.equal(dashboard2.body.invariants.capturedPaymentsWithoutConfirmedOrder, 0);
  } finally {
    await mock.close();
  }
});

test('decline then retry on the same hold confirms', async () => {
  const mock = await startMock();
  try {
    const token = await mock.admit('buyer-2');

    const hold = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-2', token, key: 'hold-key-decline-1',
      body: { seatIds: ['A-2-1'] },
    });
    assert.equal(hold.status, 201);

    const declined = await mock.call('POST', `/events/${EVENT}/orders`, {
      account: 'buyer-2', token, key: 'order-key-decline-1',
      body: { holdId: hold.body.holdId, paymentToken: 'tok_decline' },
    });
    assert.equal(declined.status, 202);
    mock.elapse(1000);

    const declinedAfter = await mock.call('GET', `/events/${EVENT}/orders/${declined.body.orderId}`, { account: 'buyer-2' });
    assert.equal(declinedAfter.body.status, 'declined');
    assert.equal(declinedAfter.body.reason, 'card_declined');

    const retry = await mock.call('POST', `/events/${EVENT}/orders`, {
      account: 'buyer-2', token, key: 'order-key-decline-2',
      body: { holdId: hold.body.holdId, paymentToken: 'tok_visa' },
    });
    assert.equal(retry.status, 202);
    mock.elapse(1000);

    const retryAfter = await mock.call('GET', `/events/${EVENT}/orders/${retry.body.orderId}`, { account: 'buyer-2' });
    assert.equal(retryAfter.body.status, 'confirmed');
  } finally {
    await mock.close();
  }
});

test('payment unknown, charge found by reconciler, confirms', async () => {
  const mock = await startMock();
  try {
    const token = await mock.admit('buyer-3');

    const hold = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-3', token, key: 'hold-key-unknown-1',
      body: { seatIds: ['A-3-1'] },
    });
    assert.equal(hold.status, 201);

    const order = await mock.call('POST', `/events/${EVENT}/orders`, {
      account: 'buyer-3', token, key: 'order-key-unknown-1',
      body: { holdId: hold.body.holdId, paymentToken: 'tok_timeout_charged' },
    });
    assert.equal(order.status, 202);
    mock.elapse(1000);

    const midway = await mock.call('GET', `/events/${EVENT}/orders/${order.body.orderId}`, { account: 'buyer-3' });
    assert.equal(midway.body.status, 'payment_unknown');

    mock.elapse(6000);

    const settled = await mock.call('GET', `/events/${EVENT}/orders/${order.body.orderId}`, { account: 'buyer-3' });
    assert.equal(settled.body.status, 'confirmed');
  } finally {
    await mock.close();
  }
});

test('payment unknown, no charge found, cancels and frees the seat', async () => {
  const mock = await startMock();
  try {
    const token = await mock.admit('buyer-4');

    const hold = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-4', token, key: 'hold-key-uncharged-1',
      body: { seatIds: ['A-4-1'] },
    });
    assert.equal(hold.status, 201);

    const order = await mock.call('POST', `/events/${EVENT}/orders`, {
      account: 'buyer-4', token, key: 'order-key-uncharged-1',
      body: { holdId: hold.body.holdId, paymentToken: 'tok_timeout_uncharged' },
    });
    assert.equal(order.status, 202);
    mock.elapse(1000);

    const midway = await mock.call('GET', `/events/${EVENT}/orders/${order.body.orderId}`, { account: 'buyer-4' });
    assert.equal(midway.body.status, 'payment_unknown');

    mock.elapse(6000);

    const settled = await mock.call('GET', `/events/${EVENT}/orders/${order.body.orderId}`, { account: 'buyer-4' });
    assert.equal(settled.body.status, 'cancelled');
    assert.equal(settled.body.reason, 'payment_not_found');

    const otherToken = await mock.admit('buyer-4b');
    const retryHold = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-4b', token: otherToken, key: 'hold-key-uncharged-2',
      body: { seatIds: ['A-4-1'] },
    });
    assert.equal(retryHold.status, 201);
  } finally {
    await mock.close();
  }
});

test('seats stay held while payment is unknown, even past the hold TTL', async () => {
  const mock = await startMock({ env: { RECONCILE_AFTER_SECONDS: '3600' } });
  try {
    const token = await mock.admit('buyer-5');

    const hold = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-5', token, key: 'hold-key-pinned-1',
      body: { seatIds: ['A-5-1'] },
    });
    assert.equal(hold.status, 201);

    const order = await mock.call('POST', `/events/${EVENT}/orders`, {
      account: 'buyer-5', token, key: 'order-key-pinned-1',
      body: { holdId: hold.body.holdId, paymentToken: 'tok_timeout_charged' },
    });
    assert.equal(order.status, 202);
    mock.elapse(1000);

    const midway = await mock.call('GET', `/events/${EVENT}/orders/${order.body.orderId}`, { account: 'buyer-5' });
    assert.equal(midway.body.status, 'payment_unknown');

    mock.advance(9 * 60 * 1000);

    const otherToken = await mock.admit('buyer-5b');
    const contend = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-5b', token: otherToken, key: 'hold-key-pinned-contend-1',
      body: { seatIds: ['A-5-1'] },
    });
    assert.equal(contend.status, 409);
    assert.equal(contend.body.error.code, 'seat_taken');
  } finally {
    await mock.close();
  }
});

test('per-account seat limit blocks orders over the limit and holds over 6 seats', async () => {
  const mock = await startMock();
  try {
    const token = await mock.admit('buyer-6');

    const hold1 = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-6', token, key: 'hold-key-limit-1',
      body: { seatIds: ['GA-1', 'GA-2', 'GA-3', 'GA-4'] },
    });
    assert.equal(hold1.status, 201);

    const order1 = await mock.call('POST', `/events/${EVENT}/orders`, {
      account: 'buyer-6', token, key: 'order-key-limit-1',
      body: { holdId: hold1.body.holdId, paymentToken: 'tok_visa' },
    });
    assert.equal(order1.status, 202);
    mock.elapse(1000);
    const confirmed1 = await mock.call('GET', `/events/${EVENT}/orders/${order1.body.orderId}`, { account: 'buyer-6' });
    assert.equal(confirmed1.body.status, 'confirmed');

    const hold2 = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-6', token, key: 'hold-key-limit-2',
      body: { seatIds: ['GA-5', 'GA-6', 'GA-7'] },
    });
    assert.equal(hold2.status, 201);

    const order2 = await mock.call('POST', `/events/${EVENT}/orders`, {
      account: 'buyer-6', token, key: 'order-key-limit-2',
      body: { holdId: hold2.body.holdId, paymentToken: 'tok_visa' },
    });
    assert.equal(order2.status, 422);
    assert.equal(order2.body.error.code, 'seat_limit_exceeded');

    const tooMany = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-6', token, key: 'hold-key-limit-3',
      body: { seatIds: ['GA-8', 'GA-9', 'GA-10', 'GA-11', 'GA-12', 'GA-13', 'GA-14'] },
    });
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.body.error.code, 'invalid_request');
  } finally {
    await mock.close();
  }
});

test('order access control: not_found, hold_not_found, hold_in_use, hold_expired', async () => {
  const mock = await startMock();
  try {
    const tokenA = await mock.admit('buyer-7a');
    const tokenB = await mock.admit('buyer-7b');
    const tokenC = await mock.admit('buyer-7c');

    const holdA = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-7a', token: tokenA, key: 'hold-key-access-1',
      body: { seatIds: ['GA-20'] },
    });
    assert.equal(holdA.status, 201);

    const otherOrders = await mock.call('POST', `/events/${EVENT}/orders`, {
      account: 'buyer-7b', token: tokenB, key: 'order-key-access-other',
      body: { holdId: holdA.body.holdId, paymentToken: 'tok_visa' },
    });
    assert.equal(otherOrders.status, 404);
    assert.equal(otherOrders.body.error.code, 'hold_not_found');

    const firstOrder = await mock.call('POST', `/events/${EVENT}/orders`, {
      account: 'buyer-7a', token: tokenA, key: 'order-key-access-1',
      body: { holdId: holdA.body.holdId, paymentToken: 'tok_visa' },
    });
    assert.equal(firstOrder.status, 202);

    const secondOrderSameHold = await mock.call('POST', `/events/${EVENT}/orders`, {
      account: 'buyer-7a', token: tokenA, key: 'order-key-access-2',
      body: { holdId: holdA.body.holdId, paymentToken: 'tok_visa' },
    });
    assert.equal(secondOrderSameHold.status, 409);
    assert.equal(secondOrderSameHold.body.error.code, 'hold_in_use');

    const foreignGet = await mock.call('GET', `/events/${EVENT}/orders/${firstOrder.body.orderId}`, { account: 'buyer-7c' });
    assert.equal(foreignGet.status, 404);
    assert.equal(foreignGet.body.error.code, 'order_not_found');

    const holdB = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-7a', token: tokenA, key: 'hold-key-access-2',
      body: { seatIds: ['GA-21'] },
    });
    assert.equal(holdB.status, 201);

    mock.advance(9 * 60 * 1000);

    const expiredOrder = await mock.call('POST', `/events/${EVENT}/orders`, {
      account: 'buyer-7a', token: tokenA, key: 'order-key-access-3',
      body: { holdId: holdB.body.holdId, paymentToken: 'tok_visa' },
    });
    assert.equal(expiredOrder.status, 409);
    assert.equal(expiredOrder.body.error.code, 'hold_expired');
    void tokenC;
  } finally {
    await mock.close();
  }
});

test('order status is readable by account after the admission token expired', async () => {
  const mock = await startMock();
  try {
    const token = await mock.admit('buyer-8');

    const hold = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-8', token, key: 'hold-key-late-1',
      body: { seatIds: ['GA-30'] },
    });
    assert.equal(hold.status, 201);

    const order = await mock.call('POST', `/events/${EVENT}/orders`, {
      account: 'buyer-8', token, key: 'order-key-late-1',
      body: { holdId: hold.body.holdId, paymentToken: 'tok_visa' },
    });
    assert.equal(order.status, 202);

    mock.advance(16 * 60 * 1000);

    const late = await mock.call('GET', `/events/${EVENT}/orders/${order.body.orderId}`, { account: 'buyer-8' });
    assert.equal(late.status, 200);
    assert.equal(late.body.orderId, order.body.orderId);
  } finally {
    await mock.close();
  }
});
