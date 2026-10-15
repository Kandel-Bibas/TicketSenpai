import {
  parseHoldRequest, parseIdempotencyKey, parseOrderRequest, parsePagination,
  parsePspMode, parseRateOverride, parseSectionFilter,
} from './validate.js';

const iso = (ms) => new Date(ms).toISOString();

/**
 * Route table. `auth` is enforced by the server before the handler runs:
 *   'none'    — edge-served or operator endpoint
 *   'account' — X-Account-Id (IdP session stand-in)
 *   'token'   — account + admission token bound to that account and event
 * Handlers translate transport only; the rules live in the services.
 */
export function createRoutes(s) {
  const presentEvent = (event) => ({
    eventId: event.eventId,
    name: event.name,
    venue: event.venue,
    startsAt: iso(event.startsAt),
    onSaleAt: iso(event.onSaleAt),
    saleState: s.controller.saleState(event.eventId),
    seatLimitPerAccount: event.seatLimitPerAccount,
    currency: event.currency,
    priceTiers: Object.entries(event.priceTiers).map(([tier, priceCents]) => ({ tier, priceCents })),
  });

  const presentDecision = (decision) => (decision === null ? null : { ...decision, decidedAt: iso(decision.decidedAt) });

  const presentHold =(hold) => ({ holdId: hold.holdId, eventId: hold.eventId, seatIds: hold.seatIds, expiresAt: iso(hold.expiresAt) });

  const presentOrder = (order) => ({
    orderId: order.orderId,
    eventId: order.eventId,
    status: order.status,
    reason: order.reason,
    seatIds: order.seatIds,
    totalCents: order.totalCents,
    currency: order.currency,
    tickets: order.tickets,
    createdAt: iso(order.createdAt),
    updatedAt: iso(order.updatedAt),
  });

  return [
    { method: 'GET', path: '/healthz', auth: 'none', handle: () => ({ status: 200, body: { status: 'ok' } }) },

    // ── demand zone: edge-served, no origin state beyond the catalog ──
    {
      method: 'GET', path: '/events', auth: 'none',
      handle({ query }) {
        const page = s.catalog.listEvents(parsePagination(query));
        return { status: 200, body: { items: page.items.map(presentEvent), nextCursor: page.nextCursor } };
      },
    },
    {
      method: 'GET', path: '/events/:eventId', auth: 'none',
      handle: ({ params }) => ({ status: 200, body: presentEvent(s.catalog.getEvent(params.eventId)) }),
    },
    {
      method: 'GET', path: '/events/:eventId/seat-map', auth: 'none',
      handle: ({ params }) => ({
        status: 200,
        body: s.catalog.seatMap(params.eventId),
        headers: { 'Cache-Control': 'public, max-age=86400, immutable' },
      }),
    },
    {
      method: 'POST', path: '/events/:eventId/queue', auth: 'account',
      handle({ params, accountId }) {
        const { created, status } = s.waitingRoom.join(params.eventId, accountId);
        return { status: created ? 201 : 200, body: status };
      },
    },
    {
      method: 'GET', path: '/events/:eventId/queue/me', auth: 'account',
      handle: ({ params, accountId }) => ({ status: 200, body: s.waitingRoom.status(params.eventId, accountId) }),
    },

    // ── admitted zone: admission token required ──
    {
      method: 'GET', path: '/events/:eventId/availability', auth: 'token',
      handle({ params, query }) {
        const event = s.catalog.getEvent(params.eventId);
        const seats = s.view.list(params.eventId, parseSectionFilter(query, event));
        return { status: 200, body: { eventId: params.eventId, maxStalenessSeconds: 2, seats } };
      },
    },
    {
      method: 'POST', path: '/events/:eventId/holds', auth: 'token',
      handle({ params, accountId, headers, body }) {
        const key = parseIdempotencyKey(headers['idempotency-key']);
        const event = s.catalog.getEvent(params.eventId);
        const selection = parseHoldRequest(body, event);
        return s.idempotency.run({ scope: `holds:${params.eventId}`, accountId, key, request: selection }, () => {
          const startedAt = performance.now();
          let outcome = 'other';
          try {
            const hold = s.inventory.createHold({ eventId: params.eventId, accountId, selection });
            outcome = 'ok';
            return { status: 201, body: presentHold(hold) };
          } catch (err) {
            if (err.code === 'seat_taken') outcome = 'seat_taken';
            throw err;
          } finally {
            s.metrics.recordHold(params.eventId, performance.now() - startedAt, outcome);
          }
        });
      },
    },
    {
      method: 'POST', path: '/events/:eventId/orders', auth: 'token',
      handle({ params, accountId, headers, body }) {
        const key = parseIdempotencyKey(headers['idempotency-key']);
        const request = parseOrderRequest(body);
        return s.idempotency.run({ scope: `orders:${params.eventId}`, accountId, key, request }, () => ({
          status: 202,
          body: presentOrder(s.checkout.placeOrder({ eventId: params.eventId, accountId, ...request })),
        }));
      },
    },
    // Account-only: a shopper must be able to poll an order after their 15-minute admission token expires.
    {
      method: 'GET', path: '/events/:eventId/orders/:orderId', auth: 'account',
      handle: ({ params, accountId }) => ({
        status: 200,
        body: presentOrder(s.orders.getOrderFor({ eventId: params.eventId, accountId, orderId: params.orderId })),
      }),
    },

    // ── operator and fault-injection endpoints (unauthenticated: local mock only) ──
    {
      method: 'GET', path: '/admin/events/:eventId/dashboard', auth: 'none',
      handle({ params }) {
        const eventId = s.catalog.getEvent(params.eventId).eventId;
        const control = s.controller.status(eventId);
        const invariants = s.invariants.latest();
        return {
          status: 200,
          body: {
            eventId,
            saleState: s.controller.saleState(eventId),
            queue: { depth: s.waitingRoom.depth(eventId), admittedWithLiveToken: s.waitingRoom.admitted(eventId).length },
            admission: {
              paused: control.paused,
              overrideRate: control.overrideRate,
              decision: presentDecision(control.decision),
              effectiveRatePerSecond: s.waitingRoom.effectiveRate(eventId),
            },
            holds: s.metrics.snapshot(eventId),
            inventory: s.inventory.counts(eventId),
            pipeline: {
              oldestOutboxAgeMs: s.store.oldestOutboxAgeMs(),
              viewLagMs: s.view.lastLagMs(),
              oldestInFlightPaymentAgeMs: s.orders.oldestInFlightAgeMs(eventId),
              paymentsQueued: s.queue.depth('payments'),
              deadLetters: s.queue.deadLetterCount(),
            },
            psp: { mode: s.psp.mode(), breaker: s.breaker.state() },
            invariants: { ...invariants, checkedAt: invariants.checkedAt === null ? null : iso(invariants.checkedAt) },
          },
        };
      },
    },
    {
      method: 'POST', path: '/admin/events/:eventId/pause', auth: 'none',
      handle: ({ params }) => ({ status: 200, body: presentDecision(s.controller.pause(params.eventId)) }),
    },
    {
      method: 'POST', path: '/admin/events/:eventId/resume', auth: 'none',
      handle: ({ params }) => ({ status: 200, body: presentDecision(s.controller.resume(params.eventId)) }),
    },
    {
      method: 'PUT', path: '/admin/events/:eventId/release-rate', auth: 'none',
      handle: ({ params, body }) => ({ status: 200, body: presentDecision(s.controller.setOverride(params.eventId, parseRateOverride(body))) }),
    },
    {
      method: 'PUT', path: '/admin/psp', auth: 'none',
      handle({ body }) {
        s.psp.setMode(parsePspMode(body));
        return { status: 200, body: { mode: s.psp.mode() } };
      },
    },
  ];
}
