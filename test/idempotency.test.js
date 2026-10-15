import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMock, EVENT } from './helpers.js';

test('hold replay: same key and body return the identical stored response, counted once', async () => {
  const mock = await startMock();
  try {
    const token = await mock.admit('buyer-1');
    const body = { seatIds: ['A-1-1'] };

    const first = await mock.call('POST', `/events/${EVENT}/holds`, { account: 'buyer-1', token, key: 'idem-hold-1', body });
    assert.equal(first.status, 201);
    assert.equal(first.headers.get('idempotent-replay'), null);

    const second = await mock.call('POST', `/events/${EVENT}/holds`, { account: 'buyer-1', token, key: 'idem-hold-1', body });
    assert.equal(second.status, 201);
    assert.equal(second.headers.get('idempotent-replay'), 'true');
    assert.deepEqual(second.body, first.body);
    assert.equal(second.body.holdId, first.body.holdId);

    const dashboard = await mock.call('GET', `/admin/events/${EVENT}/dashboard`);
    assert.equal(dashboard.body.holds.holdAttempts, 1);
  } finally {
    await mock.close();
  }
});

test('same key with a different body is rejected as reused', async () => {
  const mock = await startMock();
  try {
    const token = await mock.admit('buyer-2');

    const first = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-2', token, key: 'idem-hold-2', body: { seatIds: ['A-1-2'] },
    });
    assert.equal(first.status, 201);

    const second = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-2', token, key: 'idem-hold-2', body: { seatIds: ['A-1-3'] },
    });
    assert.equal(second.status, 422);
    assert.equal(second.body.error.code, 'idempotency_key_reused');
  } finally {
    await mock.close();
  }
});

test('missing or too-short idempotency key is rejected', async () => {
  const mock = await startMock();
  try {
    const token = await mock.admit('buyer-3');

    const missingHold = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-3', token, body: { seatIds: ['A-1-4'] },
    });
    assert.equal(missingHold.status, 400);
    assert.equal(missingHold.body.error.code, 'idempotency_key_required');

    const missingOrder = await mock.call('POST', `/events/${EVENT}/orders`, {
      account: 'buyer-3', token, body: { holdId: 'hold_nonexistent', paymentToken: 'tok_visa' },
    });
    assert.equal(missingOrder.status, 400);
    assert.equal(missingOrder.body.error.code, 'idempotency_key_required');

    const tooShort = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-3', token, key: 'short', body: { seatIds: ['A-1-4'] },
    });
    assert.equal(tooShort.status, 400);
    assert.equal(tooShort.body.error.code, 'invalid_request');
  } finally {
    await mock.close();
  }
});

test('order replay: same key returns the stored response even after the order settles', async () => {
  const mock = await startMock();
  try {
    const token = await mock.admit('buyer-4');

    const hold = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-4', token, key: 'idem-order-hold-1', body: { seatIds: ['A-1-5'] },
    });
    assert.equal(hold.status, 201);

    const orderBody = { holdId: hold.body.holdId, paymentToken: 'tok_visa' };
    const first = await mock.call('POST', `/events/${EVENT}/orders`, {
      account: 'buyer-4', token, key: 'idem-order-1', body: orderBody,
    });
    assert.equal(first.status, 202);
    assert.equal(first.body.status, 'payment_in_flight');

    const secondReplay = await mock.call('POST', `/events/${EVENT}/orders`, {
      account: 'buyer-4', token, key: 'idem-order-1', body: orderBody,
    });
    assert.equal(secondReplay.status, 202);
    assert.equal(secondReplay.headers.get('idempotent-replay'), 'true');
    assert.deepEqual(secondReplay.body, first.body);
    assert.equal(secondReplay.body.orderId, first.body.orderId);

    mock.elapse(1000);

    const live = await mock.call('GET', `/events/${EVENT}/orders/${first.body.orderId}`, { account: 'buyer-4' });
    assert.equal(live.status, 200);
    assert.equal(live.body.status, 'confirmed');

    const thirdReplay = await mock.call('POST', `/events/${EVENT}/orders`, {
      account: 'buyer-4', token, key: 'idem-order-1', body: orderBody,
    });
    assert.equal(thirdReplay.status, 202);
    assert.equal(thirdReplay.headers.get('idempotent-replay'), 'true');
    assert.equal(thirdReplay.body.status, 'payment_in_flight');
    assert.deepEqual(thirdReplay.body, first.body);
  } finally {
    await mock.close();
  }
});

test('a 409 seat_taken response replays for the same key even after the seat frees up', async () => {
  const mock = await startMock();
  try {
    const token1 = await mock.admit('buyer-5a');
    const token2 = await mock.admit('buyer-5b');

    const hold1 = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-5a', token: token1, key: 'idem-taken-hold-1', body: { seatIds: ['B-3-1'] },
    });
    assert.equal(hold1.status, 201);

    const taken = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-5b', token: token2, key: 'idem-taken-key', body: { seatIds: ['B-3-1'] },
    });
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error.code, 'seat_taken');

    mock.advance(8 * 60 * 1000 + 1000);

    const replay = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-5b', token: token2, key: 'idem-taken-key', body: { seatIds: ['B-3-1'] },
    });
    assert.equal(replay.status, 409);
    assert.equal(replay.body.error.code, 'seat_taken');
    assert.equal(replay.headers.get('idempotent-replay'), 'true');

    const succeeds = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-5b', token: token2, key: 'idem-taken-key-new', body: { seatIds: ['B-3-1'] },
    });
    assert.equal(succeeds.status, 201);
  } finally {
    await mock.close();
  }
});

test('idempotency keys are scoped per account', async () => {
  const mock = await startMock();
  try {
    const token1 = await mock.admit('buyer-6a');
    const token2 = await mock.admit('buyer-6b');

    const hold1 = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-6a', token: token1, key: 'shared-key', body: { seatIds: ['B-4-1'] },
    });
    assert.equal(hold1.status, 201);

    const hold2 = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'buyer-6b', token: token2, key: 'shared-key', body: { seatIds: ['B-4-2'] },
    });
    assert.equal(hold2.status, 201);
    assert.notEqual(hold2.body.holdId, hold1.body.holdId);
  } finally {
    await mock.close();
  }
});
