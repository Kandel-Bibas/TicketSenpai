# Configuration reference

TicketSenpai has **no configuration file and reads no environment variables at
runtime**. Its settings are constants in the source, chosen for a local,
single-machine setup. This page lists every one of them and where it lives, so
you can find them when you need to change one.

> [!NOTE]
> Changing a constant changes behavior. Update the tests and docs that mention
> it in the same pull request.

- [Build and tooling variables](#build-and-tooling-variables)
- [Network](#network)
- [Storage](#storage)
- [Sessions and authentication](#sessions-and-authentication)
- [Inventory and purchase rules](#inventory-and-purchase-rules)
- [Pricing](#pricing)
- [Input limits](#input-limits)
- [Frontend](#frontend)
- [Reference mock](#reference-mock)

## Build and tooling variables

These are read by `make` and the helper scripts, not by the running app.

| Variable | Used by | Default | Purpose |
| --- | --- | --- | --- |
| `PYTHON` | `Makefile` (`setup`, `dev`, `smoke`, `package`) | `python3` | Python 3.10+ interpreter used to run the scripts and create the venv |
| `CONFIRM` | `make reset` | unset | Must be `reset`, or the reset refuses to run |
| `CHROME` | `scripts/build_defense_report.py` | auto-detected | Path to Chrome or Chromium for printing the PDF |

```sh
make setup PYTHON=python3.12
make reset CONFIRM=reset
CHROME=/usr/bin/chromium python3 scripts/build_defense_report.py
```

## Network

| Setting | Value | Defined in |
| --- | --- | --- |
| Frontend address | `127.0.0.1:3000` | `frontend/package.json` (`dev`, `start` scripts) |
| API address | `127.0.0.1:5001` | `backend/run.py` |
| Proxy target | `http://127.0.0.1:5001/api/:path*` | `frontend/next.config.mjs` |
| Ports checked before start or reset | 3000, 5001 | `scripts/dev.py`, `scripts/reset.py`, `scripts/verify_workflow.py` |
| Flask debug, debugger, reloader | Off | `backend/run.py`, `create_app()` |

To use different ports, change **all** of the files above together. Both servers
bind to loopback on purpose; see [SECURITY.md](../SECURITY.md#intended-use).

## Storage

| Setting | Value | Defined in |
| --- | --- | --- |
| Database file | `backend/instance/ticketsenpai.sqlite3` | `create_app()` default; `scripts/reset.py` |
| Journal mode | WAL | `db.initialize()` |
| Busy timeout | 10 seconds | `db.connect()` |
| Foreign keys | On | `db.connect()`, `schema.sql` |

`create_app(database=...)` accepts another path. The tests use this to give
every test its own temporary database.

## Sessions and authentication

| Setting | Value | Defined in |
| --- | --- | --- |
| Session cookie name | `session` | `login()`, `auth()` |
| Session lifetime | 86400 s (24 h), cookie and server | `login()` |
| Cookie flags | `HttpOnly`, `SameSite=Strict` | `login()` |
| Token | `secrets.token_urlsafe(32)` | `login()` |
| Sessions per user | 1 (login deletes the others) | `login()` |
| Password hashing | werkzeug default (scrypt, salted) | `register()`, `db.initialize()` |
| Login throttling | None | — |

## Inventory and purchase rules

| Setting | Value | Defined in |
| --- | --- | --- |
| Hold lifetime | 480 s (8 min) | `service.create_hold()` |
| Seats per user per event | 6 (held + bought) | `service.create_hold()`; also `seat-map.js` |
| Seats per event | 270: A 5×10, B 10×12, GA 100 | `db.add_seats()` |
| Idempotency key length | 8–100 characters | `service.replay()` |
| Payment options | `approve`, `decline` | `purchase()` |

## Pricing

| Section | Price | Defined in |
| --- | --- | --- |
| B (standard) | Event `price_cents` | `db.add_seats()`, `edit_event()` |
| GA | `price_cents` + 2500 | `db.add_seats()`, `edit_event()` |
| A (premium) | `price_cents` + 9000 | `db.add_seats()`, `edit_event()` |

The offsets appear in both `add_seats()` and the repricing query in
`edit_event()`. Change them together, along with the hint text on the admin page.

## Input limits

| Input | Limit | Error |
| --- | --- | --- |
| Request body | 32 KiB (`MAX_CONTENT_LENGTH`) | `request_entity_too_large` |
| Text fields (default) | 1–200 characters | `invalid_request` |
| Display name | 1–80 characters | `invalid_request` |
| Password | 8–100 characters | `weak_password` / `invalid_request` |
| Review body, event description | 1–2000 characters | `invalid_request` |
| Search query | 0–300 characters | `invalid_search` |
| Seat ID | 1–30 characters | `invalid_selection` |
| `hold_id` | 1–100 characters | `invalid_request` |
| `page` | 1–10000 | `invalid_page` |
| Page size | 20 (fixed) | — |
| Event `price_cents` | 100–1000000 | `invalid_price` |
| Event and order IDs | 1 to 2⁶³−1 | `event_not_found` / `order_not_found` |

All server-side limits are in `backend/ticketsenpai/__init__.py` and
`service.py`. The frontend repeats some of them as `maxLength` and `min`/`max`
attributes for a better experience; the server is the authority.

## Frontend

| Setting | Value | Defined in |
| --- | --- | --- |
| Event page refresh | Every 5 s | `app/events/[id]/page.js` |
| Display time zone | `America/Chicago` | `lib/api.js` (`date()`) |
| Currency | USD | `lib/api.js` (`money()`) |
| Theme storage key | `ticketsenpai-theme` (`localStorage`) | `components/shell.js` |
| Admin date input | Interpreted as UTC | `app/admin/page.js` |
| Default venue for new events | *Mock Arena · Chicago* | `app/admin/page.js` |

## Reference mock

The independent Node mock in `src/` **does** read environment variables (`HOST`,
`PORT`, `HOLD_TTL_SECONDS`, and more). They have no effect on TicketSenpai. See
the [reference backend guide](reference-backend.md#run).
