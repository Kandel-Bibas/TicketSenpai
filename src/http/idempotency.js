import { ApiError } from '../errors.js';

/**
 * Replays the stored response for a repeated (account, endpoint, key). Client
 * errors are stored too: a retry of a request that got 409 gets the same 409,
 * and a new attempt needs a new key.
 * @param {Map<string, { fingerprint: string, status: number, body: object }>} table
 */
export function createIdempotency(table) {
  return {
    /**
     * @param {{ scope: string, accountId: string, key: string, request: unknown }} id
     * @param {() => { status: number, body: object }} perform
     */
    run({ scope, accountId, key, request }, perform) {
      const recordKey = `${accountId}:${scope}:${key}`;
      const fingerprint = JSON.stringify(request);
      const stored = table.get(recordKey);
      if (stored) {
        if (stored.fingerprint !== fingerprint) {
          throw new ApiError(422, 'idempotency_key_reused', 'This Idempotency-Key was already used with a different request body');
        }
        return { status: stored.status, body: stored.body, headers: { 'Idempotent-Replay': 'true' } };
      }

      let response;
      try {
        response = perform();
      } catch (err) {
        if (!(err instanceof ApiError) || err.status >= 500) throw err;
        response = { status: err.status, body: { error: { code: err.code, message: err.message } } };
      }
      table.set(recordKey, { fingerprint, ...response });
      return response;
    },
  };
}
