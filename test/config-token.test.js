import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createTokenService } from '../src/token.js';

function makeClock(start = 0) {
  let now = start;
  return { now: () => now, set: (t) => { now = t; } };
}

test('loadConfig: defaults and validation', () => {
  const config = loadConfig({});
  assert.equal(config.port, 4010);
  assert.equal(config.holdTtlMs, 480000);
  assert.equal(config.tokenTtlMs, 900000);
  assert.ok(Object.isFrozen(config));

  assert.throws(() => loadConfig({ PORT: 'abc' }), /PORT/);
  assert.throws(() => loadConfig({ PORT: '70000' }), /PORT/);
  assert.throws(() => loadConfig({ HOLD_TTL_SECONDS: '0' }), /HOLD_TTL_SECONDS/);
  assert.throws(() => loadConfig({ ADMISSION_TOKEN_SECRET: 'short' }), /ADMISSION_TOKEN_SECRET/);
});

test('createTokenService: issue/verify round-trip and every rejection path', () => {
  const clock = makeClock(0);
  const svc = createTokenService({ keys: { k1: 'a'.repeat(32) }, activeKid: 'k1', ttlMs: 900000, clock });

  const issued1 = svc.issue({ accountId: 'acct1', eventId: 'evt1' });
  const claims1 = svc.verify(issued1.token);
  assert.equal(claims1.sub, 'acct1');
  assert.equal(claims1.evt, 'evt1');
  assert.equal(claims1.iat, 0);
  assert.equal(claims1.exp, claims1.iat + 900000);
  assert.equal(issued1.expiresAt, claims1.exp);
  assert.equal(typeof claims1.jti, 'string');

  const issued2 = svc.issue({ accountId: 'acct1', eventId: 'evt1' });
  const claims2 = svc.verify(issued2.token);
  assert.notEqual(claims1.jti, claims2.jti);

  // Signed under a different secret.
  const otherSvc = createTokenService({ keys: { k1: 'b'.repeat(32) }, activeKid: 'k1', ttlMs: 900000, clock });
  assert.throws(() => otherSvc.verify(issued1.token), (err) => err.code === 'invalid_token' && err.status === 401);

  // Unknown kid.
  const parts = issued1.token.split('.');
  const unknownKid = [parts[0], 'k2', parts[2], parts[3]].join('.');
  assert.throws(() => svc.verify(unknownKid), (err) => err.code === 'invalid_token');

  // Wrong part count.
  assert.throws(() => svc.verify('v1.k1.onlythreeparts'), (err) => err.code === 'invalid_token');

  // Changed version prefix.
  const wrongVersion = ['v2', parts[1], parts[2], parts[3]].join('.');
  assert.throws(() => svc.verify(wrongVersion), (err) => err.code === 'invalid_token');

  // Expired.
  const expiryClock = makeClock(0);
  const shortSvc = createTokenService({ keys: { k1: 'c'.repeat(32) }, activeKid: 'k1', ttlMs: 1000, clock: expiryClock });
  const shortLived = shortSvc.issue({ accountId: 'a', eventId: 'e' });
  expiryClock.set(1000);
  assert.throws(() => shortSvc.verify(shortLived.token), (err) => err.code === 'token_expired' && err.status === 401);

  // Constructing with an activeKid that has no key throws.
  assert.throws(() => createTokenService({ keys: {}, activeKid: 'missing', ttlMs: 1000, clock }), /No signing key/);
});
