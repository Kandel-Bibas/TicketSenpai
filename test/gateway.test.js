import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMock, EVENT } from './helpers.js';

function flipChar(c) {
  return c === 'A' ? 'B' : 'A';
}

test('invalid tokens: missing, garbage, tampered signature, swapped payload all 401', async () => {
  const mock = await startMock();
  try {
    const tokenA = await mock.admit('gw-a');
    const tokenB = await mock.admit('gw-b');

    const noAuth = await mock.call('GET', `/events/${EVENT}/availability`, { account: 'gw-a' });
    assert.equal(noAuth.status, 401);
    assert.equal(noAuth.body.error.code, 'invalid_token');

    const garbage = await mock.call('GET', `/events/${EVENT}/availability`, { account: 'gw-a', token: 'this-is-not-a-jwt' });
    assert.equal(garbage.status, 401);
    assert.equal(garbage.body.error.code, 'invalid_token');

    const parts = tokenA.split('.');
    const sig = parts[3];
    const mutatedSig = flipChar(sig[0]) + sig.slice(1);
    const tampered = [parts[0], parts[1], parts[2], mutatedSig].join('.');
    const tamperedRes = await mock.call('GET', `/events/${EVENT}/availability`, { account: 'gw-a', token: tampered });
    assert.equal(tamperedRes.status, 401);
    assert.equal(tamperedRes.body.error.code, 'invalid_token');

    const partsB = tokenB.split('.');
    const swapped = [parts[0], parts[1], partsB[2], parts[3]].join('.');
    const swappedRes = await mock.call('GET', `/events/${EVENT}/availability`, { account: 'gw-a', token: swapped });
    assert.equal(swappedRes.status, 401);
    assert.equal(swappedRes.body.error.code, 'invalid_token');
  } finally {
    await mock.close();
  }
});

test('expired token is rejected with token_expired', async () => {
  const mock = await startMock();
  try {
    const token = await mock.admit('gw-expire');
    mock.advance(15 * 60 * 1000);

    const res = await mock.call('GET', `/events/${EVENT}/availability`, { account: 'gw-expire', token });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'token_expired');
  } finally {
    await mock.close();
  }
});

test('token used with a different account is rejected with token_account_mismatch', async () => {
  const mock = await startMock();
  try {
    const tokenA = await mock.admit('gw-mismatch-a');
    await mock.admit('gw-mismatch-b');

    const res = await mock.call('GET', `/events/${EVENT}/availability`, { account: 'gw-mismatch-b', token: tokenA });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'token_account_mismatch');
  } finally {
    await mock.close();
  }
});

test('token minted for another event is rejected with token_event_mismatch', async () => {
  const mock = await startMock();
  try {
    const { token } = mock.services.tokens.issue({ accountId: 'gw-other-event', eventId: 'evt_other' });

    const res = await mock.call('GET', `/events/${EVENT}/availability`, { account: 'gw-other-event', token });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'token_event_mismatch');
  } finally {
    await mock.close();
  }
});

test('missing X-Account-Id on an account route is unauthenticated', async () => {
  const mock = await startMock();
  try {
    const res = await mock.call('POST', `/events/${EVENT}/queue`, {});
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'unauthenticated');
  } finally {
    await mock.close();
  }
});

test('per-token rate limit: 10 requests succeed, the 11th is limited, refills after a second', async () => {
  const mock = await startMock();
  try {
    const token = await mock.admit('gw-rate');

    for (let i = 0; i < 10; i++) {
      const res = await mock.call('GET', `/events/${EVENT}/availability`, { account: 'gw-rate', token });
      assert.equal(res.status, 200, `request ${i + 1} should succeed`);
    }

    const limited = await mock.call('GET', `/events/${EVENT}/availability`, { account: 'gw-rate', token });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'rate_limited');
    assert.equal(limited.headers.get('retry-after'), '1');

    mock.advance(1000);

    const refilled = await mock.call('GET', `/events/${EVENT}/availability`, { account: 'gw-rate', token });
    assert.equal(refilled.status, 200);
  } finally {
    await mock.close();
  }
});
