# HTTP API reference

The TicketSenpai API is a JSON API served by Flask on `127.0.0.1:5001` and proxied
by Next.js at `http://127.0.0.1:3000/api`. **Always call it through port 3000** so
the session cookie stays on the same origin as the UI.

- [Conventions](#conventions)
- [Health](#health)
- [Accounts and sessions](#accounts-and-sessions)
- [Events and reviews](#events-and-reviews)
- [Holds](#holds)
- [Orders](#orders)
- [Administration](#administration)
- [Error codes](#error-codes)
- [End-to-end example](#end-to-end-example)

## Conventions

| Topic | Rule |
| --- | --- |
| Base URL | `http://127.0.0.1:3000/api` |
| Format | Request and response bodies are JSON. Send `Content-Type: application/json` with every body. |
| Body size | At most 32 KiB (`413 request_entity_too_large` otherwise) |
| Authentication | `session` cookie set by `POST /api/login`. `HttpOnly`, `SameSite=Strict`, valid for 24 hours. |
| Pagination | List endpoints accept `?page=N` (1–10000, default 1) and return up to 20 items as `{ "items": [...] }` |
| Money | Integer cents (`price_cents`, `total_cents`) |
| Timestamps | `starts_at` is an ISO 8601 string with a time zone. `expires_at` and `created_at` are Unix seconds. |
| Text fields | Leading and trailing whitespace is trimmed. Emails are lowercased. |
| Idempotency | `POST .../holds` and `POST /orders` require an `Idempotency-Key` header of 8–100 characters. See [Idempotency](#idempotency). |
| Errors | `{ "error": { "code": "...", "message": "..." } }`. Match on `code`; `message` is for humans and may change. |

**Auth** column legend used below: **none** = public, **user** = any signed-in
user, **admin** = signed-in user with the `admin` role.

### Idempotency

Hold and checkout requests change inventory, so they must be safe to retry.

- Use a new random key (for example a UUID) for each logical action.
- Retrying with the **same key and same body** returns the original response
  without doing the work again.
- Reusing a key with a **different body** returns `409 idempotency_key_reused`.
- Keys are scoped per user and per action (holds per event, checkout), so the
  same string can be used independently by different users or actions.
- Only successful responses are stored. A request that fails (for example
  `409 seat_taken`) leaves the key unused.
- A **declined** payment is a successful response and will replay. Retry payment
  with a new key.

## Health

### `GET /api/health`

Auth: none. Returns `200` when the API is up.

```json
{ "ok": true, "name": "TicketSenpai" }
```

## Accounts and sessions

### `POST /api/register`

Auth: none. Creates a customer account. Does **not** sign the user in.

| Field | Type | Rules |
| --- | --- | --- |
| `email` | string | Valid address, 1–200 characters, unique (case-insensitive) |
| `name` | string | 1–80 characters |
| `password` | string | 8–100 characters |

`201 Created`

```json
{ "ok": true }
```

Errors: `invalid_request`, `invalid_email`, `weak_password`, `email_taken`.

### `POST /api/login`

Auth: none. Verifies credentials, ends any previous sessions for the user, and
sets a new `session` cookie.

```json
{ "email": "alice@example.test", "password": "alice-demo" }
```

`200 OK`

```json
{ "id": 1, "email": "alice@example.test", "name": "Alice", "role": "customer" }
```

Errors: `invalid_request`, `invalid_email`, `invalid_credentials` (401). The same
error is returned for an unknown email and a wrong password.

### `POST /api/logout`

Auth: none (a missing or invalid cookie is not an error). Deletes the current
session and clears the cookie. Returns `{ "ok": true }`.

### `GET /api/me`

Auth: user. Returns the signed-in user.

```json
{ "id": 1, "email": "alice@example.test", "name": "Alice", "role": "customer" }
```

### `PATCH /api/me`

Auth: user. Updates the display name.

```json
{ "name": "Alice Example" }
```

Returns the updated user. Errors: `invalid_request`.

## Events and reviews

### Event object

```json
{
  "id": 1,
  "name": "After Hours",
  "artist": "The Midnight Assembly",
  "venue": "Mock Arena · Chicago",
  "starts_at": "2027-03-20T20:00:00Z",
  "genre": "Electronic",
  "description": "A late-night meeting of analog synths…",
  "price_cents": 9500,
  "published": 1
}
```

### `GET /api/events`

Auth: none. Searches **published** events by name or artist (case-insensitive
substring), ordered by start time.

| Query | Rules |
| --- | --- |
| `q` | Optional, up to 300 characters. Treated as literal text: SQL wildcards `%` and `_` match only themselves. |
| `page` | Optional, 1–10000 |

Returns `{ "items": [Event, ...] }`. Errors: `invalid_search`, `invalid_page`.

```sh
curl -s 'http://127.0.0.1:3000/api/events?q=jazz'
```

The search text is bound as a parameter, and `%`, `_`, and the escape
character `!` are escaped before matching. Searching for `%` or `_` therefore
returns only events whose name or artist actually contains that character, not
every event.

### `GET /api/events/{id}`

Auth: none. Returns a published event plus its full seat map. Expired holds are
released before the seats are read, so statuses are current.

```json
{
  "id": 1,
  "name": "After Hours",
  "…": "other event fields",
  "seats": [
    { "id": "A-1-1", "section": "A", "row_number": 1, "seat_number": 1, "price_cents": 18500, "status": "available" },
    { "id": "GA-1",  "section": "GA", "row_number": null, "seat_number": null, "price_cents": 12000, "status": "held" }
  ]
}
```

Seat `status` is `available`, `held`, or `sold`. Errors: `event_not_found` (also
returned for unpublished events).

### `GET /api/events/{id}/reviews`

Auth: none. Newest first, 20 per page.

```json
{ "items": [ { "id": 1, "body": "Been waiting all year…", "created_at": 1791849600, "name": "Bob" } ] }
```

Errors: `event_not_found`, `invalid_page`.

### `POST /api/events/{id}/reviews`

Auth: user.

```json
{ "body": "Great show!" }
```

`body` is 1–2000 characters and is stored exactly as sent. Clients must render
it as text, never as HTML. Returns `201` with `{ "id": 2 }`. Errors:
`event_not_found`, `invalid_request`.

## Holds

A hold reserves seats for the signed-in user for **8 minutes**. See
[Seat inventory and holds](architecture.md#seat-inventory-and-holds) for the rules.

### Hold object

```json
{
  "id": "6f1c1f0e-8a4b-4f0a-9f43-3b8f8f3d2a11",
  "event_id": 1,
  "expires_at": 1800000480,
  "seat_ids": ["A-1-1", "A-1-2"],
  "total_cents": 37000
}
```

### `POST /api/events/{id}/holds`

Auth: user. Requires `Idempotency-Key`.

```json
{ "seat_ids": ["A-1-1", "A-1-2"] }
```

| Rule | Error |
| --- | --- |
| `seat_ids` is a list of strings, each 1–30 characters | `invalid_selection` (422) |
| 1–6 distinct seats | `invalid_selection` (422) |
| Bought + held + requested ≤ 6 for this event | `seat_limit_exceeded` (422) |
| Every seat exists | `unknown_seat` (422) |
| Every seat is `available` | `seat_taken` (409) |

All-or-nothing: if any seat fails, no seat is held. Returns `201` with a
[hold object](#hold-object).

```sh
curl -s -b cookies.txt -X POST http://127.0.0.1:3000/api/events/1/holds \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"seat_ids":["A-1-1","A-1-2"]}'
```

### `GET /api/events/{id}/hold`

Auth: user. Returns the caller's most recent active hold for the event, so a
page reload can restore it.

```json
{ "hold": { "id": "…", "event_id": 1, "expires_at": 1800000480, "seat_ids": ["A-1-1"], "total_cents": 18500 } }
```

`{ "hold": null }` when there is none. Errors: `event_not_found`.

### `DELETE /api/holds/{id}`

Auth: user. Releases the caller's hold and returns its seats to inventory.
Releasing a hold that is already released, expired, or converted is a no-op.
Returns `{ "ok": true }`. Errors: `hold_not_found` (also for another user's hold).

## Orders

### Order object

```json
{
  "id": 1,
  "user_id": 1,
  "event_id": 1,
  "hold_id": "6f1c1f0e-…",
  "status": "confirmed",
  "total_cents": 37000,
  "created_at": 1800000060,
  "event_name": "After Hours",
  "venue": "Mock Arena · Chicago",
  "starts_at": "2027-03-20T20:00:00Z",
  "buyer_name": "Alice",
  "tickets": [
    { "seat_id": "A-1-1", "barcode": "0b6d…" },
    { "seat_id": "A-1-2", "barcode": "9e2a…" }
  ]
}
```

`status` is `confirmed` or `declined`. Declined orders have no tickets.

### `POST /api/orders`

Auth: user. Requires `Idempotency-Key`. Checks out a hold with a simulated payment.

```json
{ "hold_id": "6f1c1f0e-…", "payment": "approve" }
```

| Field | Rules |
| --- | --- |
| `hold_id` | 1–100 characters; must be the caller's hold |
| `payment` | `approve` or `decline` |

- `approve` creates a `confirmed` order, issues one ticket per seat, and marks
  the seats sold.
- `decline` creates a `declined` order and **keeps the hold active** so the
  shopper can try again before it expires.

Returns `201` with an [order object](#order-object). Errors: `invalid_request`,
`invalid_payment`, `hold_not_found`, `hold_expired`, `event_not_found` (event was
unpublished), `idempotency_key_required`, `idempotency_key_reused`.

### `GET /api/orders`

Auth: user. The caller's orders, newest first. Returns `{ "items": [Order, ...] }`.

### `GET /api/orders/{id}`

Auth: user. One of the caller's orders. Another user's order returns the same
`404 order_not_found` as a missing one.

## Administration

All routes in this section require an administrator. Customers get
`403 forbidden`.

### `GET /api/admin/events`

Lists **all** events, including unpublished drafts, newest first. Returns
`{ "items": [Event, ...] }`.

### `POST /api/admin/events`

Creates an event and its 270 seats.

| Field | Type | Rules |
| --- | --- | --- |
| `name`, `artist`, `venue`, `genre` | string | 1–200 characters |
| `starts_at` | string | ISO 8601 date-time **with** a time zone, e.g. `2027-07-01T20:00:00Z` |
| `description` | string | 1–2000 characters |
| `price_cents` | integer | 100–1000000 (base price; see [pricing](architecture.md#seat-geometry-and-pricing)) |
| `published` | boolean | Optional, defaults to `true` |

Returns `201` with `{ "id": 5 }`. Errors: `invalid_request`, `invalid_date`,
`invalid_price`, `invalid_published`.

### `PUT /api/admin/events/{id}`

Replaces every field of an event. The body has the same shape as create. Because
`published` defaults to `true`, send it explicitly to keep a draft unpublished.

If `price_cents` changes, every seat is repriced. A price change is refused with
`409 price_locked` once any seat for the event is held or sold. Returns
`{ "id": 5 }`. Errors: as for create, plus `event_not_found`, `price_locked`.

## Error codes

| Code | Status | Meaning |
| --- | --- | --- |
| `invalid_request` | 400 / 422 | Body is not a JSON object (400) or a text field is missing, empty, or too long (422) |
| `invalid_email` | 422 | Email address is malformed |
| `weak_password` | 422 | Password is shorter than eight characters |
| `email_taken` | 409 | An account already uses this email |
| `invalid_credentials` | 401 | Email or password is incorrect |
| `unauthenticated` | 401 | No valid, unexpired session |
| `forbidden` | 403 | Administrator access required |
| `invalid_page` | 400 | `page` is not an integer from 1 to 10000 |
| `invalid_search` | 400 | `q` is longer than 300 characters |
| `event_not_found` | 404 | Event does not exist or is unpublished |
| `invalid_selection` | 422 | `seat_ids` malformed, empty, duplicated, or more than six |
| `seat_limit_exceeded` | 422 | Would exceed six seats per user per event |
| `unknown_seat` | 422 | A seat ID does not exist for this event |
| `seat_taken` | 409 | A seat is already held or sold |
| `hold_not_found` | 404 | Hold does not exist or belongs to another user |
| `hold_expired` | 409 | Hold expired, was released, or was already used |
| `invalid_payment` | 422 | `payment` is not `approve` or `decline` |
| `order_not_found` | 404 | Order does not exist or belongs to another user |
| `idempotency_key_required` | 400 | Missing `Idempotency-Key`, or not 8–100 characters |
| `idempotency_key_reused` | 409 | Key already used with a different body |
| `invalid_date` | 422 | `starts_at` is not ISO 8601 with a time zone |
| `invalid_price` | 422 | `price_cents` is not an integer from 100 to 1000000 |
| `invalid_published` | 422 | `published` is not a boolean |
| `price_locked` | 409 | Price cannot change after seats are held or sold |
| `bad_request` | 400 | Body is not valid JSON |
| `unsupported_media_type` | 415 | Body sent without `Content-Type: application/json` |
| `not_found` | 404 | No such route (including non-numeric event or order IDs) |
| `method_not_allowed` | 405 | Route exists but not for this HTTP method |
| `request_entity_too_large` | 413 | Body exceeds 32 KiB |
| `internal_error` | 500 | Unexpected server error. Details are logged server-side only. |

## End-to-end example

A complete purchase with `curl`, using a cookie jar. Requires `make dev` to be running.

```sh
API=http://127.0.0.1:3000/api

# 1. Sign in (stores the session cookie in cookies.txt)
curl -s -c cookies.txt -X POST "$API/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.test","password":"alice-demo"}'

# 2. Browse events
curl -s "$API/events"

# 3. Hold two premium seats for event 1
curl -s -b cookies.txt -X POST "$API/events/1/holds" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"seat_ids":["A-1-1","A-1-2"]}'
# -> { "id": "<HOLD_ID>", ... }

# 4. Pay with the simulated approval
curl -s -b cookies.txt -X POST "$API/orders" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"hold_id":"<HOLD_ID>","payment":"approve"}'
# -> { "id": <ORDER_ID>, "status": "confirmed", "tickets": [...] }

# 5. List your orders
curl -s -b cookies.txt "$API/orders"
```

Purchases change the local database. Run `make reset CONFIRM=reset` (with the
servers stopped) to return to the seeded state.
