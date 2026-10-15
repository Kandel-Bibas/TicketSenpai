import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMock, EVENT } from './helpers.js';

// Creates a small extra event directly through the services, per the task's
// allowed use of mock.services: catalog.addEvent + view.rebuild.
function addTinyEvent(mock, eventId, seatIds) {
  const now = mock.clock.now();
  mock.services.catalog.addEvent(
    {
      eventId,
      name: 'Tiny Test Event',
      venue: 'Test Venue',
      startsAt: now + 90 * 24 * 60 * 60 * 1000,
      onSaleAt: now,
      seatLimitPerAccount: 6,
      currency: 'USD',
      priceTiers: { floor: 1000 },
      sections: [{ section: 'GA', priceTier: 'floor', generalAdmission: true }],
    },
    seatIds.map((seatId) => ({ seatId, section: 'GA', row: null, number: null, priceTier: 'floor' })),
  );
  mock.services.view.rebuild(eventId, mock.services.inventory.seats(eventId));
}

test('healthy: decision is computed at min(target - active, max)', async () => {
  const mock = await startMock();
  try {
    mock.runLoop('admissionController');
    const dash = await mock.call('GET', `/admin/events/${EVENT}/dashboard`);
    assert.equal(dash.body.admission.decision.reason, 'computed');
    assert.equal(dash.body.admission.decision.ratePerSecond, 50);
  } finally {
    await mock.close();
  }
});

test('kill switch: pause stops admission immediately, resume restarts it', async () => {
  const mock = await startMock();
  try {
    const joined = await mock.call('POST', `/events/${EVENT}/queue`, { account: 'a' });
    assert.equal(joined.status, 201);

    const pause = await mock.call('POST', `/admin/events/${EVENT}/pause`);
    assert.equal(pause.body.reason, 'paused');
    assert.equal(pause.body.ratePerSecond, 0);

    const event = await mock.call('GET', `/events/${EVENT}`);
    assert.equal(event.body.saleState, 'paused');

    const statusRightAfterPause = await mock.call('GET', `/events/${EVENT}/queue/me`, { account: 'a' });
    assert.equal(statusRightAfterPause.body.state, 'paused');

    mock.elapse(10000);
    const statusAfter10s = await mock.call('GET', `/events/${EVENT}/queue/me`, { account: 'a' });
    assert.equal(statusAfter10s.body.state, 'paused');
    assert.equal(statusAfter10s.body.admissionToken, undefined);

    const resume = await mock.call('POST', `/admin/events/${EVENT}/resume`);
    assert.notEqual(resume.body.reason, 'paused');

    mock.elapse(3000);
    const statusAfterResume = await mock.call('GET', `/events/${EVENT}/queue/me`, { account: 'a' });
    assert.equal(statusAfterResume.body.state, 'admitted');
  } finally {
    await mock.close();
  }
});

test('holds are auto-extended while paused', async () => {
  const mock = await startMock();
  try {
    const token1 = await mock.admit('acct1');
    const hold = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'acct1', token: token1, key: 'k-hold-1', body: { seatIds: ['GA-10'] },
    });
    assert.equal(hold.status, 201);

    const pause = await mock.call('POST', `/admin/events/${EVENT}/pause`);
    assert.equal(pause.body.reason, 'paused');

    // Without the auto-extension, an 8-minute hold would lapse well before 10 minutes.
    mock.elapse(10 * 60 * 1000);

    const resume = await mock.call('POST', `/admin/events/${EVENT}/resume`);
    assert.notEqual(resume.body.reason, 'paused');

    const token2 = await mock.admit('acct2');
    const hold2 = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'acct2', token: token2, key: 'k-hold-2', body: { seatIds: ['GA-10'] },
    });
    assert.equal(hold2.status, 409);
    assert.equal(hold2.body.error.code, 'seat_taken');
  } finally {
    await mock.close();
  }
});

test('manual override sets and clears the rate; invalid values are rejected', async () => {
  const mock = await startMock();
  try {
    const withOverride = await mock.call('PUT', `/admin/events/${EVENT}/release-rate`, { body: { ratePerSecond: 3 } });
    assert.equal(withOverride.body.reason, 'override');
    assert.equal(withOverride.body.ratePerSecond, 3);

    const cleared = await mock.call('PUT', `/admin/events/${EVENT}/release-rate`, { body: { ratePerSecond: null } });
    assert.equal(cleared.body.reason, 'computed');
    assert.equal(cleared.body.ratePerSecond, 50);

    for (const bad of [-1, 1.5, 'x']) {
      const res = await mock.call('PUT', `/admin/events/${EVENT}/release-rate`, { body: { ratePerSecond: bad } });
      assert.equal(res.status, 400, `ratePerSecond=${JSON.stringify(bad)} should be rejected`);
      assert.equal(res.body.error.code, 'invalid_request');
    }
  } finally {
    await mock.close();
  }
});

test('override does not beat a zero-gate: paused still forces rate to 0', async () => {
  const mock = await startMock();
  try {
    const withOverride = await mock.call('PUT', `/admin/events/${EVENT}/release-rate`, { body: { ratePerSecond: 3 } });
    assert.equal(withOverride.body.ratePerSecond, 3);

    const paused = await mock.call('POST', `/admin/events/${EVENT}/pause`);
    assert.equal(paused.body.reason, 'paused');
    assert.equal(paused.body.ratePerSecond, 0);
  } finally {
    await mock.close();
  }
});

test('hold latency gate: p99 above the limit forces rate to 0', async () => {
  const mock = await startMock();
  try {
    for (let i = 0; i < 100; i++) mock.services.metrics.recordHold(EVENT, 400, 'ok');
    mock.elapse(2000);

    const dash = await mock.call('GET', `/admin/events/${EVENT}/dashboard`);
    assert.equal(dash.body.admission.decision.reason, 'hold_latency');
    assert.equal(dash.body.admission.decision.ratePerSecond, 0);
  } finally {
    await mock.close();
  }
});

test('sold out: the valve closes and late waiters see sold_out', async () => {
  const mock = await startMock();
  try {
    const eventId = 'evt_tiny_soldout';
    addTinyEvent(mock, eventId, ['T-1', 'T-2']);

    const token1 = await mock.admit('acct1', eventId);
    const token2 = await mock.admit('acct2', eventId);

    // Freeze admission for a third account before it joins, so it stays waiting
    // rather than getting admitted ahead of the sell-out.
    await mock.call('PUT', `/admin/events/${eventId}/release-rate`, { body: { ratePerSecond: 0 } });
    const joined3 = await mock.call('POST', `/events/${eventId}/queue`, { account: 'acct3' });
    assert.equal(joined3.status, 201);
    assert.equal(joined3.body.state, 'waiting');

    const hold = await mock.call('POST', `/events/${eventId}/holds`, {
      account: 'acct1', token: token1, key: 'k-hold-1', body: { seatIds: ['T-1', 'T-2'] },
    });
    assert.equal(hold.status, 201);
    const order = await mock.call('POST', `/events/${eventId}/orders`, {
      account: 'acct1', token: token1, key: 'k-order-1',
      body: { holdId: hold.body.holdId, paymentToken: 'tok_visa' },
    });
    assert.equal(order.status, 202);

    mock.elapse(3000); // relay -> payments -> settle
    const orderStatus = await mock.call('GET', `/events/${eventId}/orders/${order.body.orderId}`, { account: 'acct1' });
    assert.equal(orderStatus.body.status, 'confirmed');

    const me2 = await mock.call('GET', `/events/${eventId}/queue/me`, { account: 'acct2' });
    assert.equal(me2.body.state, 'admitted'); // account 2 was already admitted before sell-out

    mock.runLoop('admissionController');

    const me3 = await mock.call('GET', `/events/${eventId}/queue/me`, { account: 'acct3' });
    assert.equal(me3.body.state, 'sold_out');

    const joined4 = await mock.call('POST', `/events/${eventId}/queue`, { account: 'acct4' });
    assert.equal(joined4.status, 409);
    assert.equal(joined4.body.error.code, 'sold_out');

    const eventBody = await mock.call('GET', `/events/${eventId}`);
    assert.equal(eventBody.body.saleState, 'sold_out');

    const dash = await mock.call('GET', `/admin/events/${eventId}/dashboard`);
    assert.equal(dash.body.admission.decision.reason, 'sold_out');
  } finally {
    await mock.close();
  }
});

test('no unheld seats: both seats held (not sold) forces rate to 0', async () => {
  const mock = await startMock();
  try {
    const eventId = 'evt_tiny_held';
    addTinyEvent(mock, eventId, ['H-1', 'H-2']);

    const token1 = await mock.admit('acct1', eventId);
    const hold = await mock.call('POST', `/events/${eventId}/holds`, {
      account: 'acct1', token: token1, key: 'k-hold-1', body: { seatIds: ['H-1', 'H-2'] },
    });
    assert.equal(hold.status, 201);

    mock.runLoop('admissionController');
    const dash = await mock.call('GET', `/admin/events/${eventId}/dashboard`);
    assert.equal(dash.body.admission.decision.reason, 'no_unheld_seats');
    assert.equal(dash.body.admission.decision.ratePerSecond, 0);

    const eventBody = await mock.call('GET', `/events/${eventId}`);
    assert.equal(eventBody.body.saleState, 'on_sale');
  } finally {
    await mock.close();
  }
});

test('active shoppers: a confirmed purchase drops out of activeShoppers', async () => {
  const mock = await startMock();
  try {
    const token = await mock.admit('shopper1');
    mock.runLoop('admissionController');
    let dash = await mock.call('GET', `/admin/events/${EVENT}/dashboard`);
    assert.equal(dash.body.admission.decision.activeShoppers, 1);

    const hold = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'shopper1', token, key: 'k-hold-1', body: { seatIds: ['GA-1'] },
    });
    assert.equal(hold.status, 201);
    const order = await mock.call('POST', `/events/${EVENT}/orders`, {
      account: 'shopper1', token, key: 'k-order-1',
      body: { holdId: hold.body.holdId, paymentToken: 'tok_visa' },
    });
    assert.equal(order.status, 202);

    mock.elapse(3000);
    const orderStatus = await mock.call('GET', `/events/${EVENT}/orders/${order.body.orderId}`, { account: 'shopper1' });
    assert.equal(orderStatus.body.status, 'confirmed');

    mock.runLoop('admissionController');
    dash = await mock.call('GET', `/admin/events/${EVENT}/dashboard`);
    assert.equal(dash.body.admission.decision.activeShoppers, 0);
  } finally {
    await mock.close();
  }
});
