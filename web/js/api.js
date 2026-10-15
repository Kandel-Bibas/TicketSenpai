// HTTP client for the mock backend. No DOM access, so it also runs under Node (the crowd test uses it).

/** A non-2xx response carrying the backend's error envelope. */
export class ApiError extends Error {
  /** @param {{ status: number, code: string, message: string, requestId: string | null, retryAfterSeconds: number | null }} details */
  constructor({ status, code, message, requestId, retryAfterSeconds }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The request never produced an HTTP response (backend down, wrong URL, blocked). */
export class NetworkError extends Error {
  constructor(baseUrl, cause) {
    super(`No response from ${baseUrl}`, { cause });
    this.name = 'NetworkError';
  }
}

export const newIdempotencyKey = (prefix) => `${prefix}-${crypto.randomUUID()}`;

/**
 * @typedef {{ accountId: string, token?: string | null }} Session
 * @typedef {{ method: string, path: string, status: number | null, code: string | null, replayed: boolean, durationMs: number, quiet: boolean }} RequestRecord
 */

/**
 * @param {{ baseUrl: string, onRequest?: (record: RequestRecord) => void }} options
 *   `onRequest` sees every call, including failures; `quiet` marks background polling.
 */
export function createApi({ baseUrl, onRequest = () => {} }) {
  /**
   * @param {string} method
   * @param {string} path
   * @param {{ session?: Session, key?: string, body?: unknown, quiet?: boolean }} [options]
   * @returns {Promise<{ status: number, body: any, replayed: boolean }>}
   */
  async function request(method, path, { session, key, body, quiet = false } = {}) {
    const headers = {};
    if (session) headers['X-Account-Id'] = session.accountId;
    if (session?.token) headers.Authorization = `Bearer ${session.token}`;
    if (key) headers['Idempotency-Key'] = key;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const startedAt = performance.now();
    const record = (status, code, replayed) =>
      onRequest({ method, path, status, code, replayed, durationMs: Math.round(performance.now() - startedAt), quiet });

    let res;
    let text;
    try {
      res = await fetch(baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      text = await res.text();
    } catch (err) {
      record(null, 'network_error', false);
      throw new NetworkError(baseUrl, err);
    }

    const replayed = res.headers.get('Idempotent-Replay') === 'true';
    let parsed = null;
    if (text !== '') {
      try {
        parsed = JSON.parse(text);
      } catch {
        record(res.status, 'not_json', replayed);
        throw new Error(`${method} ${path} answered ${res.status} with a body that is not JSON — is ${baseUrl} the ticketing backend?`);
      }
    }

    if (!res.ok) {
      const envelope = parsed?.error;
      if (typeof envelope?.code !== 'string') {
        record(res.status, 'no_error_envelope', replayed);
        throw new Error(`${method} ${path} answered ${res.status} without the error envelope — is ${baseUrl} the ticketing backend?`);
      }
      record(res.status, envelope.code, replayed);
      const retryAfter = res.headers.get('Retry-After');
      throw new ApiError({
        status: res.status,
        code: envelope.code,
        message: envelope.message,
        requestId: envelope.requestId ?? null,
        retryAfterSeconds: retryAfter === null ? null : Number(retryAfter),
      });
    }

    record(res.status, null, replayed);
    return { status: res.status, body: parsed, replayed };
  }

  const event = (eventId) => `/events/${encodeURIComponent(eventId)}`;
  const admin = (eventId) => `/admin/events/${encodeURIComponent(eventId)}`;
  const bodyOf = (response) => response.then((r) => r.body);

  return {
    baseUrl,
    request,

    listEvents: () => bodyOf(request('GET', '/events')),
    getSeatMap: (eventId) => bodyOf(request('GET', `${event(eventId)}/seat-map`)),

    joinQueue: (eventId, session) => bodyOf(request('POST', `${event(eventId)}/queue`, { session })),
    queueStatus: (eventId, session, { quiet = false } = {}) => bodyOf(request('GET', `${event(eventId)}/queue/me`, { session, quiet })),

    availability: (eventId, session, { quiet = false } = {}) => bodyOf(request('GET', `${event(eventId)}/availability`, { session, quiet })),
    /** @param {{ seatIds: string[] } | { bestAvailable: { section: string, quantity: number } }} selection */
    createHold: (eventId, session, key, selection) => request('POST', `${event(eventId)}/holds`, { session, key, body: selection }),
    placeOrder: (eventId, session, key, { holdId, paymentToken }) =>
      request('POST', `${event(eventId)}/orders`, { session, key, body: { holdId, paymentToken } }),
    getOrder: (eventId, session, orderId, { quiet = false } = {}) =>
      bodyOf(request('GET', `${event(eventId)}/orders/${encodeURIComponent(orderId)}`, { session: { accountId: session.accountId }, quiet })),

    dashboard: (eventId) => bodyOf(request('GET', `${admin(eventId)}/dashboard`, { quiet: true })),
    pause: (eventId) => bodyOf(request('POST', `${admin(eventId)}/pause`)),
    resume: (eventId) => bodyOf(request('POST', `${admin(eventId)}/resume`)),
    /** @param {number | null} ratePerSecond null clears the override */
    setReleaseRate: (eventId, ratePerSecond) => bodyOf(request('PUT', `${admin(eventId)}/release-rate`, { body: { ratePerSecond } })),
    /** @param {'up' | 'down'} mode */
    setPspMode: (mode) => bodyOf(request('PUT', '/admin/psp', { body: { mode } })),
  };
}
