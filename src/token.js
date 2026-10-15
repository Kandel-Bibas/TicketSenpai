// ⚠ SECURITY — admission token signing and verification. A forged token skips
// the queue. Mock-grade implementation; needs a second review before reuse.
//
// Wire format: v1.<kid>.<base64url(JSON claims)>.<base64url(HMAC-SHA256)>
// The signature covers "v1.<kid>.<claims>", so version and kid cannot be swapped.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.js';

const VERSION = 'v1';

/**
 * @typedef {{ sub: string, evt: string, iat: number, exp: number, jti: string }} AdmissionClaims
 *   sub = account id, evt = event id, iat/exp = epoch milliseconds
 */

/**
 * @param {{ keys: Record<string, string>, activeKid: string, ttlMs: number, clock: { now: () => number } }} deps
 */
export function createTokenService({ keys, activeKid, ttlMs, clock }) {
  if (!keys[activeKid]) throw new Error(`No signing key for active kid "${activeKid}"`);

  const sign = (kid, signingInput) => createHmac('sha256', keys[kid]).update(signingInput).digest();

  const invalid = () => new ApiError(401, 'invalid_token', 'Admission token is missing or invalid');

  return {
    /** @returns {{ token: string, expiresAt: number }} */
    issue({ accountId, eventId }) {
      const now = clock.now();
      /** @type {AdmissionClaims} */
      const claims = { sub: accountId, evt: eventId, iat: now, exp: now + ttlMs, jti: randomUUID() };
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const signingInput = `${VERSION}.${activeKid}.${payload}`;
      return { token: `${signingInput}.${sign(activeKid, signingInput).toString('base64url')}`, expiresAt: claims.exp };
    },

    /**
     * @param {string} token
     * @returns {AdmissionClaims}
     */
    verify(token) {
      const parts = token.split('.');
      if (parts.length !== 4) throw invalid();
      const [version, kid, payload, signature] = parts;
      if (version !== VERSION || !Object.hasOwn(keys, kid)) throw invalid();

      const expected = sign(kid, `${version}.${kid}.${payload}`);
      const given = Buffer.from(signature, 'base64url');
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw invalid();

      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (clock.now() >= claims.exp) {
        throw new ApiError(401, 'token_expired', 'Admission token has expired; rejoin the queue');
      }
      return claims;
    },
  };
}
