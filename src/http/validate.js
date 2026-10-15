// Boundary parsing: raw JSON / query strings in, typed request objects out.
import { ApiError } from '../errors.js';
import { PSP_MODES } from '../psp.js';

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{8,128}$/;

const invalid = (message) => new ApiError(400, 'invalid_request', message);

function requireObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw invalid('Request body must be a JSON object');
  return body;
}

export function parseAccountId(headerValue) {
  if (typeof headerValue !== 'string' || !ID.test(headerValue)) {
    throw new ApiError(401, 'unauthenticated', 'X-Account-Id header is required (stand-in for a verified IdP session)');
  }
  return headerValue;
}

export function parseIdempotencyKey(headerValue) {
  if (headerValue === undefined) throw new ApiError(400, 'idempotency_key_required', 'Idempotency-Key header is required on this endpoint');
  if (typeof headerValue !== 'string' || !IDEMPOTENCY_KEY.test(headerValue)) {
    throw invalid('Idempotency-Key must be 8–128 printable ASCII characters');
  }
  return headerValue;
}

/**
 * @param {unknown} body
 * @param {import('../catalog.js').Event} event
 * @returns {{ kind: 'seats', seatIds: string[] } | { kind: 'best_available', section: string, quantity: number }}
 */
export function parseHoldRequest(body, event) {
  const { seatIds, bestAvailable } = requireObject(body);
  if ((seatIds === undefined) === (bestAvailable === undefined)) {
    throw invalid('Provide exactly one of "seatIds" or "bestAvailable"');
  }
  const limit = event.seatLimitPerAccount;

  if (seatIds !== undefined) {
    if (!Array.isArray(seatIds) || seatIds.length === 0 || seatIds.length > limit) {
      throw invalid(`"seatIds" must be an array of 1 to ${limit} seat ids`);
    }
    if (!seatIds.every((id) => typeof id === 'string' && ID.test(id))) throw invalid('"seatIds" contains a malformed seat id');
    if (new Set(seatIds).size !== seatIds.length) throw invalid('"seatIds" contains duplicates');
    return { kind: 'seats', seatIds };
  }

  const { section, quantity } = requireObject(bestAvailable);
  if (!event.sections.some((s) => s.section === section)) throw invalid('"bestAvailable.section" is not a section of this event');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > limit) {
    throw invalid(`"bestAvailable.quantity" must be an integer from 1 to ${limit}`);
  }
  return { kind: 'best_available', section, quantity };
}

/** @returns {{ holdId: string, paymentToken: string }} */
export function parseOrderRequest(body) {
  const { holdId, paymentToken } = requireObject(body);
  if (typeof holdId !== 'string' || !ID.test(holdId)) throw invalid('"holdId" is required');
  if (typeof paymentToken !== 'string' || !/^tok_[A-Za-z0-9_]{1,60}$/.test(paymentToken)) {
    throw invalid('"paymentToken" must be a provider card token of the form tok_…');
  }
  return { holdId, paymentToken };
}

/** @returns {{ limit: number, cursor: string | null }} */
export function parsePagination(query) {
  const rawLimit = query.get('limit');
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw invalid('"limit" must be an integer from 1 to 50');
  const cursor = query.get('cursor');
  if (cursor !== null && !ID.test(cursor)) throw invalid('"cursor" is malformed');
  return { limit, cursor };
}

/** @returns {string | null} */
export function parseSectionFilter(query, event) {
  const section = query.get('section');
  if (section !== null && !event.sections.some((s) => s.section === section)) throw invalid('"section" is not a section of this event');
  return section;
}

/** @returns {number | null} */
export function parseRateOverride(body) {
  const { ratePerSecond } = requireObject(body);
  if (ratePerSecond === null) return null;
  if (!Number.isInteger(ratePerSecond) || ratePerSecond < 0 || ratePerSecond > 10_000) {
    throw invalid('"ratePerSecond" must be null or an integer from 0 to 10000');
  }
  return ratePerSecond;
}

/** @returns {'up' | 'down'} */
export function parsePspMode(body) {
  const { mode } = requireObject(body);
  if (!PSP_MODES.includes(mode)) throw invalid(`"mode" must be one of: ${PSP_MODES.join(', ')}`);
  return mode;
}
