import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMock, EVENT } from './helpers.js';

// Holds one seat then places an order on it, returning the orderId. Shared by
// the outage scenarios below, which all need several accounts each buying a seat.
async function holdAndOrder(mock, eventId, account, token, seatId) {
  const hold = await mock.call('POST', `/events/${eventId}/holds`, {
    account, token, key: `k-hold-${account}-${seatId}`, body: { seatIds: [seatId] },
  });
  if (hold.status !== 201) throw new Error(`hold failed for ${account}: ${hold.status} ${JSON.stringify(hold.body)}`);
  const order = await mock.call('POST', `/events/${eventId}/orders`, {
    account, token, key: `k-order-${account}-${seatId}`,
    body: { holdId: hold.body.holdId, paymentToken: 'tok_visa' },
  });
  if (order.status !== 202) throw new Error(`order failed for ${account}: ${order.status} ${JSON.stringify(order.body)}`);
  return order.body.orderId;
}

test('breaker opens and the valve closes', async () => {
  const mock = await startMock();
  try {
    const accounts = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const tokens = {};
    for (const a of accounts) tokens[a] = await mock.admit(a);

    await mock.call('PUT', '/admin/psp', { body: { mode: 'down' } });

    const orders = [];
    for (let i = 0; i < accounts.length; i++) {
      orders.push(await holdAndOrder(mock, EVENT, accounts[i], tokens[accounts[i]], `GA-${i + 1}`));
    }

    mock.elapse(3000);

    const dash = await mock.call('GET', `/admin/events/${EVENT}/dashboard`);
    assert.equal(dash.body.psp.breaker, 'open');
    assert.equal(dash.body.admission.decision.reason, 'psp_breaker_open');
    assert.equal(dash.body.admission.decision.ratePerSecond, 0);

    for (let i = 0; i < orders.length; i++) {
      const status = await mock.call('GET', `/events/${EVENT}/orders/${orders[i]}`, { account: accounts[i] });
      assert.equal(status.body.status, 'payment_in_flight');
    }

    const late = await mock.call('POST', `/events/${EVENT}/queue`, { account: 'latecomer' });
    assert.equal(late.status, 201);
    mock.elapse(2000);
    const lateStatus = await mock.call('GET', `/events/${EVENT}/queue/me`, { account: 'latecomer' });
    assert.notEqual(lateStatus.body.state, 'admitted');
  } finally {
    await mock.close();
  }
});

test('recovery with no operator action beyond restoring the PSP', async () => {
  const mock = await startMock();
  try {
    const accounts = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const tokens = {};
    for (const a of accounts) tokens[a] = await mock.admit(a);

    await mock.call('PUT', '/admin/psp', { body: { mode: 'down' } });

    const orders = [];
    for (let i = 0; i < accounts.length; i++) {
      orders.push(await holdAndOrder(mock, EVENT, accounts[i], tokens[accounts[i]], `GA-${i + 1}`));
    }

    mock.elapse(3000);
    let dash = await mock.call('GET', `/admin/events/${EVENT}/dashboard`);
    assert.equal(dash.body.psp.breaker, 'open');

    await mock.call('PUT', '/admin/psp', { body: { mode: 'up' } });
    mock.elapse(90000); // cooldown (10s) + retry backoff; 90s is generous headroom

    dash = await mock.call('GET', `/admin/events/${EVENT}/dashboard`);
    assert.equal(dash.body.psp.breaker, 'closed');
    assert.equal(dash.body.admission.decision.reason, 'computed');
    assert.equal(dash.body.pipeline.deadLetters, 0);
    assert.equal(dash.body.invariants.seatsInMultipleConfirmedOrders, 0);
    assert.equal(dash.body.invariants.soldSeatsWithoutConfirmedOrder, 0);
    assert.equal(dash.body.invariants.capturedPaymentsWithoutConfirmedOrder, 0);

    for (let i = 0; i < orders.length; i++) {
      const status = await mock.call('GET', `/events/${EVENT}/orders/${orders[i]}`, { account: accounts[i] });
      assert.equal(status.body.status, 'confirmed');
    }
  } finally {
    await mock.close();
  }
});

test('holds are extended during the outage', async () => {
  const mock = await startMock();
  try {
    const orderAccounts = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const orderTokens = {};
    for (const a of orderAccounts) orderTokens[a] = await mock.admit(a);

    const watcherToken = await mock.admit('watcher');
    const conflictToken = await mock.admit('conflict');

    // The hold we test extension on, created just before the outage begins.
    const watched = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'watcher', token: watcherToken, key: 'k-hold-watched', body: { seatIds: ['GA-50'] },
    });
    assert.equal(watched.status, 201);

    await mock.call('PUT', '/admin/psp', { body: { mode: 'down' } });

    // Keeps the breaker from ever closing again during this test: the PSP stays
    // down and there is always at least one order in flight.
    for (let i = 0; i < orderAccounts.length; i++) {
      await holdAndOrder(mock, EVENT, orderAccounts[i], orderTokens[orderAccounts[i]], `GA-${i + 1}`);
    }

    mock.elapse(10 * 60 * 1000);

    const dash = await mock.call('GET', `/admin/events/${EVENT}/dashboard`);
    assert.notEqual(dash.body.psp.breaker, 'closed');

    const conflict = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'conflict', token: conflictToken, key: 'k-hold-conflict', body: { seatIds: ['GA-50'] },
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, 'seat_taken');
  } finally {
    await mock.close();
  }
});

// Payment age gate: reachable only by keeping an order unprocessed past the
// limit while the breaker stays closed. Driven with advance() (no loops) so
// the payments worker never touches the order, then a single controller tick.
test('payment age gate fires when an order sits unprocessed past the limit', async () => {
  const mock = await startMock();
  try {
    const token = await mock.admit('acct1');
    const hold = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'acct1', token, key: 'k-hold-1', body: { seatIds: ['GA-1'] },
    });
    assert.equal(hold.status, 201);
    const order = await mock.call('POST', `/events/${EVENT}/orders`, {
      account: 'acct1', token, key: 'k-order-1',
      body: { holdId: hold.body.holdId, paymentToken: 'tok_visa' },
    });
    assert.equal(order.status, 202);

    mock.advance(31000); // no loops run: the payments worker never picks this order up
    mock.runLoop('admissionController');

    const dash = await mock.call('GET', `/admin/events/${EVENT}/dashboard`);
    assert.equal(dash.body.admission.decision.reason, 'payment_age');
    assert.equal(dash.body.admission.decision.ratePerSecond, 0);
  } finally {
    await mock.close();
  }
});

test('a long outage never dead-letters a healthy order', async () => {
  const mock = await startMock();
  try {
    const accounts = ['l1', 'l2', 'l3', 'l4', 'l5'];
    const tokens = {};
    for (const a of accounts) tokens[a] = await mock.admit(a);
    await mock.call('PUT', '/admin/psp', { body: { mode: 'down' } });
    const orders = [];
    for (let i = 0; i < accounts.length; i++) {
      orders.push(await holdAndOrder(mock, EVENT, accounts[i], tokens[accounts[i]], `GA-${i + 1}`));
    }

    mock.elapse(10 * 60 * 1000);
    await mock.call('PUT', '/admin/psp', { body: { mode: 'up' } });
    mock.elapse(30 * 1000);

    const dash = await mock.call('GET', `/admin/events/${EVENT}/dashboard`);
    assert.equal(dash.body.pipeline.deadLetters, 0);
    assert.equal(dash.body.psp.breaker, 'closed');
    for (let i = 0; i < accounts.length; i++) {
      const status = await mock.call('GET', `/events/${EVENT}/orders/${orders[i]}`, { account: accounts[i] });
      assert.equal(status.body.status, 'confirmed');
    }
  } finally {
    await mock.close();
  }
});

test('a breaker opened by timeouts closes again even when no payment is waiting', async () => {
  const mock = await startMock({ env: { RECONCILE_AFTER_SECONDS: '3600' } });
  try {
    for (let i = 1; i <= 5; i++) {
      const account = `t${i}`;
      const token = await mock.admit(account);
      const hold = await mock.call('POST', `/events/${EVENT}/holds`, {
        account, token, key: `k-hold-${account}`, body: { seatIds: [`GA-${i}`] },
      });
      await mock.call('POST', `/events/${EVENT}/orders`, {
        account, token, key: `k-order-${account}`,
        body: { holdId: hold.body.holdId, paymentToken: 'tok_timeout_uncharged' },
      });
    }
    mock.elapse(1000);
    let dash = await mock.call('GET', `/admin/events/${EVENT}/dashboard`);
    assert.equal(dash.body.psp.breaker, 'open');
    assert.equal(dash.body.pipeline.paymentsQueued, 0);

    mock.elapse(15 * 1000);
    dash = await mock.call('GET', `/admin/events/${EVENT}/dashboard`);
    assert.equal(dash.body.psp.breaker, 'closed');
    assert.equal(dash.body.admission.decision.reason, 'computed');
  } finally {
    await mock.close();
  }
});
