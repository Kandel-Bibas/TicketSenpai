import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMock, EVENT } from './helpers.js';

// Runs the same Fisher-Yates shuffle waitingRoom.js uses for the T0 draw, so
// the expected permutation is computed the same way the code under test computes it.
function fisherYatesOrder(items, randomInt) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function countAdmitted(mock, eventId, accounts) {
  let n = 0;
  for (const account of accounts) {
    const res = await mock.call('GET', `/events/${eventId}/queue/me`, { account });
    if (res.body.state === 'admitted') n++;
  }
  return n;
}

test('pre-sale: joining before T0 reports pre_sale and admits nobody', async () => {
  const mock = await startMock({ env: { SALE_STARTS_IN_SECONDS: '60' } });
  try {
    const joined = await mock.call('POST', `/events/${EVENT}/queue`, { account: 'a' });
    assert.equal(joined.status, 201);
    assert.equal(joined.body.state, 'pre_sale');
    assert.equal(joined.body.position, null);

    const event = await mock.call('GET', `/events/${EVENT}`);
    assert.equal(event.body.saleState, 'scheduled');

    mock.elapse(30000);

    const status = await mock.call('GET', `/events/${EVENT}/queue/me`, { account: 'a' });
    assert.equal(status.body.state, 'pre_sale');
    assert.equal(status.body.position, null);
  } finally {
    await mock.close();
  }
});

test('random draw at T0 matches Fisher-Yates with the injected randomInt', async () => {
  const drawRandomInt = () => 0;
  const mock = await startMock({ randomInt: drawRandomInt });
  try {
    // Freeze admission first so positions can still be read as 'waiting' after the
    // draw (pausing would report state 'paused' instead; see describe() in waitingRoom.js).
    await mock.call('PUT', `/admin/events/${EVENT}/release-rate`, { body: { ratePerSecond: 0 } });

    const joinOrder = ['a', 'b', 'c', 'd', 'e'];
    for (const account of joinOrder) {
      const res = await mock.call('POST', `/events/${EVENT}/queue`, { account });
      assert.equal(res.status, 201);
      assert.equal(res.body.position, null);
    }

    mock.elapse(1000); // T0: waitingRoom's first tick draws the pool

    const expectedOrder = fisherYatesOrder(joinOrder, drawRandomInt);
    const positions = {};
    for (const account of joinOrder) {
      const res = await mock.call('GET', `/events/${EVENT}/queue/me`, { account });
      assert.equal(res.body.state, 'waiting');
      positions[account] = res.body.position;
    }

    const seen = new Set(Object.values(positions));
    assert.equal(seen.size, 5);
    for (const p of Object.values(positions)) assert.ok(p >= 1 && p <= 5);

    for (let i = 0; i < expectedOrder.length; i++) {
      assert.equal(positions[expectedOrder[i]], i + 1, `expected ${expectedOrder[i]} at position ${i + 1}`);
    }
    assert.notDeepEqual(expectedOrder, joinOrder); // the draw actually reordered them
  } finally {
    await mock.close();
  }
});

test('FIFO after the draw: a late joiner gets the next position', async () => {
  const mock = await startMock();
  try {
    await mock.call('PUT', `/admin/events/${EVENT}/release-rate`, { body: { ratePerSecond: 0 } });
    for (const account of ['a', 'b', 'c']) {
      await mock.call('POST', `/events/${EVENT}/queue`, { account });
    }
    mock.elapse(1000); // T0 draw

    const late = await mock.call('POST', `/events/${EVENT}/queue`, { account: 'late' });
    assert.equal(late.status, 201);
    assert.equal(late.body.position, 4);
    assert.equal(late.body.state, 'waiting');
  } finally {
    await mock.close();
  }
});

test('one position per account: rejoining returns the same position', async () => {
  const mock = await startMock();
  try {
    await mock.call('PUT', `/admin/events/${EVENT}/release-rate`, { body: { ratePerSecond: 0 } });
    const first = await mock.call('POST', `/events/${EVENT}/queue`, { account: 'a' });
    assert.equal(first.status, 201);
    assert.equal(first.body.position, null); // pre-draw

    mock.elapse(1000); // T0 draw; rate 0 keeps 'a' waiting instead of admitted

    const second = await mock.call('POST', `/events/${EVENT}/queue`, { account: 'a' });
    assert.equal(second.status, 200);
    assert.equal(second.body.position, 1);
    assert.equal(second.body.state, 'waiting');
  } finally {
    await mock.close();
  }
});

test('queue/me requires membership and authentication', async () => {
  const mock = await startMock();
  try {
    const noAccount = await mock.call('GET', `/events/${EVENT}/queue/me`);
    assert.equal(noAccount.status, 401);
    assert.equal(noAccount.body.error.code, 'unauthenticated');

    const notInQueue = await mock.call('GET', `/events/${EVENT}/queue/me`, { account: 'never-joined' });
    assert.equal(notInQueue.status, 404);
    assert.equal(notInQueue.body.error.code, 'not_in_queue');
  } finally {
    await mock.close();
  }
});

test('admission follows the commanded rate', async () => {
  const mock = await startMock();
  try {
    const accounts = Array.from({ length: 10 }, (_, i) => `acct${i}`);
    for (const account of accounts) {
      const res = await mock.call('POST', `/events/${EVENT}/queue`, { account });
      assert.equal(res.status, 201);
    }
    await mock.call('PUT', `/admin/events/${EVENT}/release-rate`, { body: { ratePerSecond: 2 } });

    mock.elapse(1000);
    const at1s = await countAdmitted(mock, EVENT, accounts);
    mock.elapse(1000);
    const at2s = await countAdmitted(mock, EVENT, accounts);
    mock.elapse(1000);
    const at3s = await countAdmitted(mock, EVENT, accounts);

    // The override is issued before any clock movement, so the rate budget (whose
    // clock starts at the first join, also before any movement) lands the first
    // waiting-room tick exactly on a 1-second boundary; growth is exactly 2/s.
    assert.equal(at1s, 2);
    assert.equal(at2s, 4);
    assert.equal(at3s, 6);
  } finally {
    await mock.close();
  }
});

test('ahead and pollAfterSeconds reflect queue position and rate', async () => {
  const mock = await startMock();
  try {
    await mock.call('PUT', `/admin/events/${EVENT}/release-rate`, { body: { ratePerSecond: 0 } });
    const accounts = ['a', 'b', 'c'];
    for (const account of accounts) {
      const res = await mock.call('POST', `/events/${EVENT}/queue`, { account });
      assert.equal(res.status, 201);
    }
    mock.elapse(1000); // T0 draw; rate is 0 so nobody is admitted

    const statuses = {};
    for (const account of accounts) {
      const res = await mock.call('GET', `/events/${EVENT}/queue/me`, { account });
      statuses[account] = res.body;
      assert.equal(res.body.ahead, res.body.position - 1);
      assert.equal(res.body.pollAfterSeconds, 60);
    }

    // Pick whichever account ended up furthest back to see a non-trivial "ahead".
    const back = accounts.reduce((max, a) => (statuses[a].position > statuses[max].position ? a : max));
    await mock.call('PUT', `/admin/events/${EVENT}/release-rate`, { body: { ratePerSecond: 3 } });
    const res = await mock.call('GET', `/events/${EVENT}/queue/me`, { account: back });
    const ahead = statuses[back].ahead;
    const expected = Math.min(60, Math.max(5, Math.round(ahead / 3 / 2)));
    assert.equal(res.body.pollAfterSeconds, expected);
    assert.ok(res.body.pollAfterSeconds >= 5 && res.body.pollAfterSeconds <= 60);
  } finally {
    await mock.close();
  }
});

test('rate command TTL fail-safe: admissions stop after 30s without a fresh command', async () => {
  const mock = await startMock();
  try {
    const accounts = Array.from({ length: 40 }, (_, i) => `acct${i}`);
    for (const account of accounts) {
      const res = await mock.call('POST', `/events/${EVENT}/queue`, { account });
      assert.equal(res.status, 201);
    }
    const override = await mock.call('PUT', `/admin/events/${EVENT}/release-rate`, { body: { ratePerSecond: 1 } });
    assert.equal(override.body.ratePerSecond, 1);

    // Drive time using ONLY the waiting-room loop; the controller never runs, so
    // its command is never refreshed and must be treated as expired after 30s.
    for (let i = 0; i < 15; i++) { mock.advance(1000); mock.runLoop('waitingRoom'); }
    const at15s = await countAdmitted(mock, EVENT, accounts);

    for (let i = 0; i < 20; i++) { mock.advance(1000); mock.runLoop('waitingRoom'); } // now at 35s
    const at35s = await countAdmitted(mock, EVENT, accounts);

    for (let i = 0; i < 10; i++) { mock.advance(1000); mock.runLoop('waitingRoom'); } // now at 45s
    const at45s = await countAdmitted(mock, EVENT, accounts);

    assert.equal(at15s, 15);
    assert.equal(at35s, 30);
    assert.equal(at45s, 30); // plateaued: the 30s-old command now counts as rate zero

    const dash = await mock.call('GET', `/admin/events/${EVENT}/dashboard`);
    assert.equal(dash.body.admission.effectiveRatePerSecond, 0);
  } finally {
    await mock.close();
  }
});

test('token expiry and rejoin: an expired admission puts the account at the back', async () => {
  const mock = await startMock();
  try {
    const token = await mock.admit('a');
    await mock.call('POST', `/events/${EVENT}/queue`, { account: 'b' }); // joins after the draw, at position 2

    const before = await mock.call('GET', `/events/${EVENT}/queue/me`, { account: 'a' });
    assert.equal(before.body.admissionToken, token);

    mock.advance(15 * 60 * 1000); // no loops: expiry is computed on read, not by a sweep

    const expired = await mock.call('GET', `/events/${EVENT}/queue/me`, { account: 'a' });
    assert.equal(expired.body.state, 'expired');

    const rejoin = await mock.call('POST', `/events/${EVENT}/queue`, { account: 'a' });
    assert.equal(rejoin.status, 201);
    assert.equal(rejoin.body.state, 'waiting');
    assert.equal(rejoin.body.position, 3); // behind b, at the very back
  } finally {
    await mock.close();
  }
});

test('admitted status includes admissionToken and a 15-minute ISO tokenExpiresAt', async () => {
  const mock = await startMock();
  try {
    const token = await mock.admit('a');
    const admittedAt = mock.clock.now();

    const status = await mock.call('GET', `/events/${EVENT}/queue/me`, { account: 'a' });
    assert.equal(status.body.state, 'admitted');
    assert.equal(status.body.admissionToken, token);
    const expiresAtMs = Date.parse(status.body.tokenExpiresAt);
    assert.equal(expiresAtMs, admittedAt + 15 * 60 * 1000);
  } finally {
    await mock.close();
  }
});
