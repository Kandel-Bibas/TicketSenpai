// ⚠ SECURITY — the API gateway's admission check. Verification is local: signature,
// expiry, event claim, and binding to the caller's session. No lookups.
import { ApiError } from '../errors.js';

/**
 * @param {{
 *   tokens: ReturnType<import('../token.js').createTokenService>,
 *   clock: { now: () => number },
 *   ratePerSecond: number
 * }} deps
 */
export function createGateway({ tokens, clock, ratePerSecond }) {
  // jti → token bucket
  const buckets = new Map();

  function consume(claims) {
    const now = clock.now();
    let bucket = buckets.get(claims.jti);
    if (!bucket) {
      bucket = { tokens: ratePerSecond, updatedAt: now, expiresAt: claims.exp };
      buckets.set(claims.jti, bucket);
    }
    bucket.tokens = Math.min(ratePerSecond, bucket.tokens + ((now - bucket.updatedAt) / 1000) * ratePerSecond);
    bucket.updatedAt = now;
    if (bucket.tokens < 1) {
      throw new ApiError(429, 'rate_limited', `Limit is ${ratePerSecond} requests per second per admission token`, { 'Retry-After': '1' });
    }
    bucket.tokens -= 1;
  }

  return {
    /**
     * @param {string | undefined} authorization  the Authorization header
     * @returns {import('../token.js').AdmissionClaims}
     */
    admit(authorization, { eventId, accountId }) {
      const match = /^Bearer (\S+)$/.exec(authorization ?? '');
      if (!match) throw new ApiError(401, 'invalid_token', 'Admission token is missing or invalid');
      const claims = tokens.verify(match[1]);
      if (claims.evt !== eventId) throw new ApiError(403, 'token_event_mismatch', 'Admission token was issued for a different event');
      if (claims.sub !== accountId) throw new ApiError(403, 'token_account_mismatch', 'Admission token was issued to a different account');
      consume(claims);
      return claims;
    },

    forgetExpiredTokens() {
      const now = clock.now();
      for (const [jti, bucket] of buckets) if (bucket.expiresAt <= now) buckets.delete(jti);
    },
  };
}
