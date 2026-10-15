import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMock, EVENT } from './helpers.js';

test('contention: 8 accounts race for one seat, exactly one wins', async () => {
  const mock = await startMock();
  try {
    const accounts = [];
    for (let i = 0; i < 8; i++) {
      const account = `racer-${i}`;
      const token = await mock.admit(account);
      accounts.push({ account, token });
    }

    const results = await Promise.all(
      accounts.map(({ account, token }, i) => mock.call('POST', `/events/${EVENT}/holds`, {
        account, token, key: `contend-key-${i}`,
        body: { seatIds: ['GA-50'] },
      })),
    );

    const succeeded = results.filter((r) => r.status === 201);
    const taken = results.filter((r) => r.status === 409 && r.body.error.code === 'seat_taken');
    assert.equal(succeeded.length, 1);
    assert.equal(taken.length, 7);
  } finally {
    await mock.close();
  }
});

test('all-or-nothing: a partially overlapping hold writes nothing', async () => {
  const mock = await startMock();
  try {
    const token1 = await mock.admit('holder-1');
    const token2 = await mock.admit('holder-2');

    const hold1 = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'holder-1', token: token1, key: 'hold-key-aon-1',
      body: { seatIds: ['A-1-1'] },
    });
    assert.equal(hold1.status, 201);

    const overlap = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'holder-2', token: token2, key: 'hold-key-aon-2',
      body: { seatIds: ['A-1-1', 'A-1-2'] },
    });
    assert.equal(overlap.status, 409);
    assert.equal(overlap.body.error.code, 'seat_taken');

    const partial = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'holder-2', token: token2, key: 'hold-key-aon-3',
      body: { seatIds: ['A-1-2'] },
    });
    assert.equal(partial.status, 201);
  } finally {
    await mock.close();
  }
});

test('lazy expiry: an unswept lapsed hold is holdable again', async () => {
  const mock = await startMock();
  try {
    const token1 = await mock.admit('holder-3');
    const token2 = await mock.admit('holder-4');

    const hold1 = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'holder-3', token: token1, key: 'hold-key-lazy-1',
      body: { seatIds: ['A-2-1'] },
    });
    assert.equal(hold1.status, 201);

    mock.advance(8 * 60 * 1000 + 1000);

    const hold2 = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'holder-4', token: token2, key: 'hold-key-lazy-2',
      body: { seatIds: ['A-2-1'] },
    });
    assert.equal(hold2.status, 201);
  } finally {
    await mock.close();
  }
});

test('sweeper refreshes the availability view after a hold lapses', async () => {
  const mock = await startMock();
  try {
    const token = await mock.admit('holder-5');

    const hold = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'holder-5', token, key: 'hold-key-sweep-1',
      body: { seatIds: ['B-1-1'] },
    });
    assert.equal(hold.status, 201);

    // Let the relay loop propagate the seat.changed row into the view before reading it.
    mock.elapse(200);

    const before = await mock.call('GET', `/events/${EVENT}/availability?section=B`, { account: 'holder-5', token });
    const beforeSeat = before.body.seats.find((s) => s.seatId === 'B-1-1');
    assert.equal(beforeSeat.status, 'held');

    mock.advance(8 * 60 * 1000 + 1000);

    const stillStale = await mock.call('GET', `/events/${EVENT}/availability?section=B`, { account: 'holder-5', token });
    const staleSeat = stillStale.body.seats.find((s) => s.seatId === 'B-1-1');
    assert.equal(staleSeat.status, 'held');

    mock.elapse(2000);

    const fresh = await mock.call('GET', `/events/${EVENT}/availability?section=B`, { account: 'holder-5', token });
    const freshSeat = fresh.body.seats.find((s) => s.seatId === 'B-1-1');
    assert.equal(freshSeat.status, 'available');
  } finally {
    await mock.close();
  }
});

test('best available: allocates seats, rejects unknown section, 409 when not enough remain', async () => {
  const mock = await startMock();
  try {
    const checkToken = await mock.admit('ba-check');
    const unknownSection = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'ba-check', token: checkToken, key: 'hold-key-ba-unknown-section',
      body: { bestAvailable: { section: 'ZZ', quantity: 1 } },
    });
    assert.equal(unknownSection.status, 400);
    assert.equal(unknownSection.body.error.code, 'invalid_request');

    const first = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'ba-check', token: checkToken, key: 'hold-key-ba-first',
      body: { bestAvailable: { section: 'GA', quantity: 3 } },
    });
    assert.equal(first.status, 201);
    assert.equal(first.body.seatIds.length, 3);
    for (const seatId of first.body.seatIds) assert.match(seatId, /^GA-\d+$/);

    // Exhaust the remaining 97 GA seats with 16 more accounts holding 6 each (96 seats),
    // leaving exactly 1 seat, then a 17th account asks for 6 and gets 409.
    for (let i = 0; i < 16; i++) {
      const account = `ba-exhaust-${i}`;
      const token = await mock.admit(account);
      const hold = await mock.call('POST', `/events/${EVENT}/holds`, {
        account, token, key: `hold-key-ba-exhaust-${i}`,
        body: { bestAvailable: { section: 'GA', quantity: 6 } },
      });
      assert.equal(hold.status, 201);
      assert.equal(hold.body.seatIds.length, 6);
    }

    const lastToken = await mock.admit('ba-last');
    const notEnough = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'ba-last', token: lastToken, key: 'hold-key-ba-last',
      body: { bestAvailable: { section: 'GA', quantity: 6 } },
    });
    assert.equal(notEnough.status, 409);
    assert.equal(notEnough.body.error.code, 'not_enough_seats');
  } finally {
    await mock.close();
  }
});

test('validation: exactly one of seatIds/bestAvailable, no duplicates, known seats', async () => {
  const mock = await startMock();
  try {
    const token = await mock.admit('validator-1');

    const both = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'validator-1', token, key: 'hold-key-val-both',
      body: { seatIds: ['A-3-1'], bestAvailable: { section: 'GA', quantity: 1 } },
    });
    assert.equal(both.status, 400);
    assert.equal(both.body.error.code, 'invalid_request');

    const neither = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'validator-1', token, key: 'hold-key-val-neither',
      body: {},
    });
    assert.equal(neither.status, 400);
    assert.equal(neither.body.error.code, 'invalid_request');

    const duplicates = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'validator-1', token, key: 'hold-key-val-dup',
      body: { seatIds: ['A-3-1', 'A-3-1'] },
    });
    assert.equal(duplicates.status, 400);
    assert.equal(duplicates.body.error.code, 'invalid_request');

    const unknownSeat = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'validator-1', token, key: 'hold-key-val-unknown',
      body: { seatIds: ['Z-99-99'] },
    });
    assert.equal(unknownSeat.status, 422);
    assert.equal(unknownSeat.body.error.code, 'unknown_seat');
  } finally {
    await mock.close();
  }
});

test('availability filtered by section returns exactly the section, rejects unknown section', async () => {
  const mock = await startMock();
  try {
    const token = await mock.admit('reader-1');

    const sectionA = await mock.call('GET', `/events/${EVENT}/availability?section=A`, { account: 'reader-1', token });
    assert.equal(sectionA.status, 200);
    assert.equal(sectionA.body.seats.length, 50);
    for (const seat of sectionA.body.seats) {
      assert.equal(typeof seat.seatId, 'string');
      assert.equal(typeof seat.status, 'string');
      assert.equal(typeof seat.version, 'number');
    }

    const unknown = await mock.call('GET', `/events/${EVENT}/availability?section=ZZ`, { account: 'reader-1', token });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error.code, 'invalid_request');
  } finally {
    await mock.close();
  }
});
