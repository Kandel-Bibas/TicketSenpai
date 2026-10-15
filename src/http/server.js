import { randomUUID } from 'node:crypto';
import { ApiError } from '../errors.js';
import { parseAccountId } from './validate.js';

// Wide open on purpose: this is a local mock that a browser front end on another port must reach.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, X-Account-Id, X-Request-Id',
  'Access-Control-Expose-Headers': 'Idempotent-Replay, Retry-After, X-Request-Id',
};

const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

function compile(route) {
  const names = [];
  const pattern = route.path.replace(/:([A-Za-z]+)/g, (_, name) => {
    names.push(name);
    return '([^/]+)';
  });
  return { ...route, regex: new RegExp(`^${pattern}$`), names };
}

async function readJsonBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new ApiError(413, 'payload_too_large', `Request body exceeds ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body is not valid JSON');
  }
}

/**
 * @param {{
 *   routes: ReturnType<import('./routes.js').createRoutes>,
 *   gateway: ReturnType<import('./gateway.js').createGateway>,
 *   logger: ReturnType<import('../log.js').createLogger>,
 *   maxBodyBytes: number
 * }} deps
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createRequestHandler({ routes, gateway, logger, maxBodyBytes }) {
  const compiled = routes.map(compile);

  function resolve(method, pathname) {
    const allowed = [];
    for (const route of compiled) {
      const match = route.regex.exec(pathname);
      if (!match) continue;
      if (route.method !== method) {
        allowed.push(route.method);
        continue;
      }
      const params = {};
      try {
        route.names.forEach((name, i) => { params[name] = decodeURIComponent(match[i + 1]); });
      } catch {
        throw new ApiError(400, 'invalid_request', 'Path contains a malformed escape sequence');
      }
      return { route, params };
    }
    if (allowed.length > 0) {
      throw new ApiError(405, 'method_not_allowed', `${method} is not supported on this path`, { Allow: allowed.join(', ') });
    }
    throw new ApiError(404, 'not_found', 'No such endpoint');
  }

  async function dispatch(req, url) {
    const { route, params } = resolve(req.method, url.pathname);
    // Authentication before the body is read: rejection is the cheapest path.
    const accountId = route.auth === 'none' ? null : parseAccountId(req.headers['x-account-id']);
    if (route.auth === 'token') gateway.admit(req.headers.authorization, { eventId: params.eventId, accountId });
    const body = req.method === 'POST' || req.method === 'PUT' ? await readJsonBody(req, maxBodyBytes) : undefined;
    return { accountId, response: route.handle({ params, query: url.searchParams, headers: req.headers, body, accountId }) };
  }

  return async function handle(req, res) {
    const startedAt = performance.now();
    const given = req.headers['x-request-id'];
    const requestId = typeof given === 'string' && REQUEST_ID.test(given) ? given : randomUUID();
    const url = new URL(req.url, 'http://mock.invalid');

    let accountId = null;
    let response;
    if (req.method === 'OPTIONS') {
      response = { status: 204, body: null };
    } else {
      try {
        ({ accountId, response } = await dispatch(req, url));
      } catch (err) {
        if (err instanceof ApiError) {
          response = { status: err.status, body: { error: { code: err.code, message: err.message } }, headers: err.headers };
        } else {
          logger.error('unhandled error', { requestId, error: err.message, stack: err.stack });
          response = { status: 500, body: { error: { code: 'internal_error', message: 'Unexpected server error' } } };
        }
      }
    }

    const body = response.body?.error ? { error: { ...response.body.error, requestId } } : response.body;
    res.writeHead(response.status, {
      ...CORS_HEADERS,
      ...response.headers,
      'X-Request-Id': requestId,
      ...(body === null ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
    });
    res.end(body === null ? undefined : JSON.stringify(body));

    logger.info('request', {
      requestId, method: req.method, path: url.pathname, status: response.status,
      durationMs: Math.round(performance.now() - startedAt), accountId,
    });
  };
}
