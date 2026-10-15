# Ticketing mock backend

In-memory mock of the purchase path described in `ticketing-platform-design.html` — queue,
admission, holds, orders, payment, and fulfilment. All state lives in process memory and is
lost on restart. Node >= 22, zero dependencies.

## Run

```
npm start
npm test
```

`npm start` listens on `http://127.0.0.1:4010` by default. `npm test` runs the Node test
runner (`node --test`) against a manual clock — see Layout below.

| Env var | Default | Meaning |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `4010` | Bind port |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` \| `silent` |
| `ADMISSION_TOKEN_SECRET` | ephemeral, generated per process | HMAC key for admission tokens; must be >= 32 chars if set |
| `ADMISSION_TOKEN_KID` | `mock-1` | Key id embedded in issued tokens |
| `TOKEN_TTL_SECONDS` | `900` (15 min) | Admission token lifetime |
| `TOKEN_RATE_LIMIT_PER_SECOND` | `10` | Per-token request budget enforced by the gateway |
| `SALE_STARTS_IN_SECONDS` | `0` | Delay before the demo event's `onSaleAt`; 0 means already on sale |
| `HOLD_TTL_SECONDS` | `480` (8 min) | Seat hold lifetime |
| `TARGET_ACTIVE_SHOPPERS` | `200` | Admission controller's target concurrency in the admitted zone |
| `MAX_RELEASE_RATE` | `50` | Cap on the computed admission rate (accounts/sec) |
| `PSP_MAX_TPS` | `300` | Payment worker's pacing cap |
| `RECONCILE_AFTER_SECONDS` | `5` | How long an order stays `payment_unknown` before the reconciler asks the PSP |

## Demo front end

```
npm start      # backend on :4010
npm run web    # in a second terminal: demo page on http://127.0.0.1:4011
```

`web/` is a dependency-free page (vanilla ES modules) that drives this backend from the
browser: the shopper journey from queue to tickets on a live seat map, the operator dashboard
with its controls (pause, release-rate override, payment provider outage), a crowd of bot
shoppers to create real contention, a set of deliberately bad requests against the gateway and
the idempotency layer, and a log of every call the page makes. It is served from its own port
and calls the API cross-origin; `web/serve.js` reads `WEB_HOST` (default `127.0.0.1`) and
`WEB_PORT` (default `4011`). A backend elsewhere: `http://127.0.0.1:4011/?api=http://host:port`.

To watch a queue form: set a release-rate override of 2 in the control room, send 150 bots
from the crowd panel, then join the queue yourself.

## Walkthrough

One purchase on the seeded demo event `evt_demo_stadium`, from the front of the queue to a
confirmed order. Replace placeholders (`<...>`) with values from the previous response.

```sh
# 1. Join the queue
curl -s -X POST http://127.0.0.1:4010/events/evt_demo_stadium/queue \
  -H 'X-Account-Id: acct_demo'
# 2. Poll until admitted (repeat until state is "admitted")
curl -s http://127.0.0.1:4010/events/evt_demo_stadium/queue/me \
  -H 'X-Account-Id: acct_demo'
# -> { "state": "admitted", "admissionToken": "<ADMISSION_TOKEN>", ... }
# 3. Check availability (admitted zone: needs the account + admission token)
curl -s http://127.0.0.1:4010/events/evt_demo_stadium/availability \
  -H 'X-Account-Id: acct_demo' \
  -H 'Authorization: Bearer <ADMISSION_TOKEN>'
# 4. Hold seats (Idempotency-Key required; best-available shown here)
curl -s -X POST http://127.0.0.1:4010/events/evt_demo_stadium/holds \
  -H 'X-Account-Id: acct_demo' \
  -H 'Authorization: Bearer <ADMISSION_TOKEN>' \
  -H 'Idempotency-Key: hold-key-001' \
  -H 'Content-Type: application/json' \
  -d '{"bestAvailable":{"section":"GA","quantity":2}}'
# -> { "holdId": "<HOLD_ID>", ... }
# 5. Place the order with a magic approved payment token
curl -s -X POST http://127.0.0.1:4010/events/evt_demo_stadium/orders \
  -H 'X-Account-Id: acct_demo' \
  -H 'Authorization: Bearer <ADMISSION_TOKEN>' \
  -H 'Idempotency-Key: order-key-001' \
  -H 'Content-Type: application/json' \
  -d '{"holdId":"<HOLD_ID>","paymentToken":"tok_visa"}'
# -> { "orderId": "<ORDER_ID>", "status": "payment_in_flight", ... }
# 6. Poll the order until it reaches "confirmed" (account auth is enough here)
curl -s http://127.0.0.1:4010/events/evt_demo_stadium/orders/<ORDER_ID> \
  -H 'X-Account-Id: acct_demo'
```

The order transitions on background loops (payments every 250 ms, fulfilment every 500 ms),
so `confirmed` may take a couple of poll attempts against a live server.

## Auth model

- `X-Account-Id` stands in for a verified IdP session; any value matching `[A-Za-z0-9_-]{1,64}`
  is accepted as-is.
- Admitted-zone routes (`availability`, `holds`, `orders` create) also require
  `Authorization: Bearer <admission token>`, and the token must be bound to that exact account
  and event (`sub`/`evt` claims), or the gateway rejects it.
- Reading an order (`GET .../orders/:orderId`) needs only the account — a shopper must be able
  to poll after their 15-minute admission token has expired.
- ⚠ SECURITY: `src/token.js` and `src/http/gateway.js` are mock-grade and need a second review
  before anything reuses them.
- `/admin/*` is unauthenticated. The server binds to `127.0.0.1` by default: local use only,
  not for exposing on a network.

## Endpoints

| Method | Path | Auth | Success | Purpose |
|---|---|---|---|---|
| GET | `/healthz` | none | 200 | Liveness |
| GET | `/events` | none | 200 | List events (paginated) |
| GET | `/events/:eventId` | none | 200 | Event detail + sale state |
| GET | `/events/:eventId/seat-map` | none | 200 | Static seat geometry, cacheable |
| POST | `/events/:eventId/queue` | account | 201/200 | Join the waiting room (200 if already joined) |
| GET | `/events/:eventId/queue/me` | account | 200 | Poll queue position / admission state |
| GET | `/events/:eventId/availability` | token | 200 | Seat statuses from the availability view |
| POST | `/events/:eventId/holds` | token | 201 | Hold seats (`seatIds` or `bestAvailable`) |
| POST | `/events/:eventId/orders` | token | 202 | Place an order against a hold |
| GET | `/events/:eventId/orders/:orderId` | account | 200 | Poll order status |
| GET | `/admin/events/:eventId/dashboard` | none | 200 | Queue, admission, holds, inventory, pipeline, PSP, invariants |
| POST | `/admin/events/:eventId/pause` | none | 200 | Force release rate to 0 |
| POST | `/admin/events/:eventId/resume` | none | 200 | Clear the pause |
| PUT | `/admin/events/:eventId/release-rate` | none | 200 | Override the computed release rate |
| PUT | `/admin/psp` | none | 200 | Set payment provider mode (`up`/`down`) |

Error codes by area (HTTP status in parentheses):

- **Auth/gateway**: `unauthenticated` (401), `invalid_token` (401, missing, malformed or bad signature),
  `token_expired` (401), `token_event_mismatch` (403), `token_account_mismatch` (403), `rate_limited` (429)
- **Queue**: `not_in_queue` (404), `sold_out` (409, on join)
- **Holds**: `unknown_seat` (422), `not_enough_seats` (409, best-available), `seat_taken` (409, lost the race)
- **Orders**: `hold_not_found` (404), `hold_in_use` (409), `seat_limit_exceeded` (422), `hold_expired` (409), `order_not_found` (404)
- **Generic**: `invalid_request` (400), `invalid_json` (400), `idempotency_key_required` (400), `idempotency_key_reused` (422),
  `payload_too_large` (413), `not_found` (404), `method_not_allowed` (405), `event_not_found` (404), `internal_error` (500)

## Error envelope and idempotency

Every error response is `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`.
`code` is stable and machine-readable; `message` is not a contract.

`POST` routes that require an `Idempotency-Key` header (`holds`, `orders`) store the first
response — including 4xx responses — keyed by `(accountId, endpoint scope, key)`. A repeat
request with the same key and the same body replays the stored response unchanged and adds
`Idempotent-Replay: true`. The same key with a different request body gets
`422 idempotency_key_reused`. Keys are scoped per account and per endpoint, so the same key
string is independent across `holds` and `orders`, and across accounts.

## Simulating failures

Magic payment tokens recognised by the mock PSP (`src/psp.js`):

| Token | Outcome |
|---|---|
| `tok_decline` | Declined |
| `tok_timeout_charged` | Times out, but the card WAS authorised (`payment_unknown`) |
| `tok_timeout_uncharged` | Times out, nothing was authorised (`payment_unknown`) |
| any other `tok_*` (e.g. `tok_visa`) | Approved |

Fault injection and controls, all under `/admin`:

- `PUT /admin/psp {"mode":"down"}` — every PSP call fails fast. Consecutive failures trip the
  circuit breaker (opens after 5 failures, half-open after a 10 s cooldown), which drives the
  release rate to 0 and extends the expiry of live holds for the outage. `{"mode":"up"}` lets
  calls succeed again; the breaker recovers on the next successful probe once half-open.
- `POST /admin/events/:eventId/pause` / `resume` — kill switch, applied immediately; also
  extends live holds while paused so an operator-caused stall doesn't cost shoppers their seats.
- `PUT /admin/events/:eventId/release-rate {"ratePerSecond": <int>|null}` — overrides only the
  *computed* rate; the zero-gates (paused, sold out, invariant violation, breaker open, hold
  p99 too high, payment queue too old, no unheld seats) still force the rate to 0 regardless.
- `SALE_STARTS_IN_SECONDS=<n>` at startup delays `onSaleAt`, so the queue shows the `pre_sale`
  pool state and the random draw only fires once the clock reaches `onSaleAt`; FIFO after that.

## How it maps to the design

| Design component | File(s) in `src/` | What is simulated |
|---|---|---|
| Waiting room + queue state | `waitingRoom.js` | Join, random draw at T0, FIFO after, rate-gated admission, poll-after hints |
| Admission controller | `admissionController.js` | 2 s tick computing release rate from active shoppers, breaker, invariants, hold/payment latency, unheld-seat count |
| API gateway | `http/gateway.js` | Admission-token verification, event/account binding, per-token rate limiting |
| Inventory & holds | `inventory.js`, `store.js` | Conditional UPDATE (`store.holdSeats`) as the seat arbiter; lazy hold expiry |
| Orders | `orders.js` | Order lifecycle, per-account seat limit, hold pinning during payment |
| Checkout / worker | `checkout.js` | Authorise → confirm seats → capture; payment pacing; reconciliation of `payment_unknown` |
| Postgres (per-event shard) | `store.js` | Seats, holds, orders, outbox as in-memory tables; table ownership documented at the top of the file |
| Outbox relay | `relay.js` | At-least-once, in-order publish of outbox rows to the availability view and queue |
| Durable queue + DLQ | `queue.js` | At-least-once delivery, backoff on nack, dead-letter after 8 failed attempts; a provider outage defers a message without counting an attempt |
| Availability view (Redis) | `availabilityView.js` | Derived, staleness-bounded, per-seat versioned, rebuildable |
| Payment provider | `psp.js` | Magic-token outcomes, idempotent authorize/capture/void, breaker-friendly `down` mode |
| Fulfilment | `fulfilment.js` | Ticket issuance off the critical path; delivery is a log line |
| Invariant checker | `invariants.js` | Oversold/double-sold/unconfirmed-capture counts every 5 s; any nonzero forces the release rate to 0 |
| Observability | `http/routes.js` (`/admin/events/:eventId/dashboard`) | Aggregated queue, admission, holds, inventory, pipeline, PSP and invariant state |

## Not mocked

- CDN, WAF, and bot defence in front of the demand zone
- Real IdP login — `X-Account-Id` is trusted as-is, with no session verification
- PSP webhooks — the reconciler only polls the provider by idempotency key, on a timer
- View-rebuild / "best-available-only" degraded mode for the availability view
- Queue-state outage and its fail-closed path
- Postgres failover (primary + sync replica)
- Multi-event sharding
- Signed rotating barcodes — `fulfilment.js` issues random strings instead
- Email / wallet delivery — logged, not sent
- Persistence — all state is in memory and lost on restart

## Layout

```
src/
  main.js                 process entry point: HTTP server + interval timers for background loops
  app.js                  composition root; wires every module and defines the loop table
  config.js               env var loading and validation
  log.js                  JSON-lines logger
  catalog.js              events and seat maps
  seed.js                 seeds the demo event evt_demo_stadium
  waitingRoom.js          queue join/poll/admit
  token.js                admission token signing/verification (mock-grade, ⚠ SECURITY)
  inventory.js            holds and seat state transitions
  orders.js               order lifecycle and per-account seat limit
  checkout.js             payment worker: authorize/capture/reconcile
  psp.js                  mock payment provider
  breaker.js              circuit breaker for the PSP
  admissionController.js  release-rate decision loop
  availabilityView.js     derived seat-status view
  relay.js                outbox → view + queue publisher
  queue.js                durable-queue stand-in with DLQ
  fulfilment.js           ticket issuance
  invariants.js           correctness checker
  metrics.js              in-memory counters/latencies feeding the controller and dashboard
  rateBudget.js           fractional per-second rate accumulator
  store.js                in-memory table store (Postgres stand-in)
  errors.js               ApiError and the error envelope shape
  http/
    routes.js             route table: path, auth level, handler
    validate.js            request/body/query parsing and validation
    server.js              HTTP dispatch, CORS, request id, error-to-response mapping
    gateway.js             admission-token check + per-token rate limit (⚠ SECURITY)
    idempotency.js         Idempotency-Key replay/conflict logic
web/
  serve.js                static file server for the demo page (its own port; never serves outside web/)
  index.html, styles.css  page shell and design tokens (light and dark through light-dark())
  js/api.js               fetch client: headers, error envelope → ApiError, Idempotent-Replay; DOM-free
  js/shopper.js           shopper journey state machine and its views
  js/seatMap.js           venue rendering, seat selection, keyboard navigation
  js/operator.js          dashboard polling and operator controls
  js/crowd.js             bot shoppers (DOM-free; exercised by test/web-crowd.test.js)
  js/crowdPanel.js        crowd controls and counters
  js/probes.js            deliberately bad requests against the gateway and idempotency layer
  js/requestLog.js        log of the page's own API calls
  js/main.js, js/dom.js   bootstrap and DOM helpers
test/
  helpers.js               boots the app on an ephemeral port with a manual clock; elapse(ms) advances time and
                            runs each background loop as main.js would — tests never depend on real timers
```
