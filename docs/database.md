# Database reference

Column-by-column reference for TicketSenpai's SQLite database. For how the
tables are used together, see [Data model](architecture.md#data-model) in the
architecture guide.

| | |
| --- | --- |
| File | `backend/instance/ticketsenpai.sqlite3` (git-ignored) |
| Schema source | [`backend/ticketsenpai/schema.sql`](../backend/ticketsenpai/schema.sql) |
| Journal mode | WAL (adds `-wal` and `-shm` files next to the database) |
| Foreign keys | Enforced on every connection |
| Busy timeout | 10 seconds |
| Write transactions | `BEGIN IMMEDIATE` |
| Time values | Unix seconds (`INTEGER`), except `events.starts_at` (ISO 8601 text) |
| Money values | Integer cents |

- [Tables](#tables)
- [Indexes](#indexes)
- [Seed data](#seed-data)
- [Schema changes](#schema-changes)
- [Inspecting the database](#inspecting-the-database)

## Tables

### `users`

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | INTEGER | primary key | |
| `email` | TEXT | not null, **unique** | Stored lowercased |
| `name` | TEXT | not null | Display name, up to 80 characters |
| `password` | TEXT | not null | werkzeug hash, starts with `scrypt:`. Never plaintext. |
| `role` | TEXT | not null, `customer` or `admin`, default `customer` | |

### `sessions`

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `token` | TEXT | primary key | `secrets.token_urlsafe(32)`, 43 characters |
| `user_id` | INTEGER | not null, → `users.id` | At most one row per user; login deletes the old one |
| `expires_at` | INTEGER | not null | Login time + 86400 |

Expired rows are ignored, not deleted. Logout and the next login remove them.

### `events`

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | INTEGER | primary key | |
| `name`, `artist`, `venue`, `genre` | TEXT | not null | |
| `starts_at` | TEXT | not null | ISO 8601 with time zone, e.g. `2027-03-20T20:00:00Z` |
| `description` | TEXT | not null | |
| `price_cents` | INTEGER | not null, > 0 | Standard (section B) price |
| `published` | INTEGER | not null, `0` or `1`, default `1` | |

### `seats`

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | TEXT | not null | `A-<row>-<seat>`, `B-<row>-<seat>`, or `GA-<n>` |
| `event_id` | INTEGER | not null, → `events.id` | |
| `section` | TEXT | not null | `A`, `B`, or `GA` |
| `row_number`, `seat_number` | INTEGER | nullable | `NULL` for GA |
| `price_cents` | INTEGER | not null, > 0 | Copied from the event's price at creation or repricing |
| `status` | TEXT | not null, `available` / `held` / `sold`, default `available` | |
| `hold_id` | TEXT | → `holds.id`, nullable | Set while held; kept after sale |

Primary key: `(event_id, id)`. Seat IDs repeat across events.

### `holds`

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | TEXT | primary key | UUID4 |
| `user_id` | INTEGER | not null, → `users.id` | |
| `event_id` | INTEGER | not null, → `events.id` | |
| `expires_at` | INTEGER | not null | Creation time + 480 |
| `status` | TEXT | not null, `active` / `released` / `expired` / `converted`, default `active` | |

### `orders`

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | INTEGER | primary key | The order number shown to users |
| `user_id` | INTEGER | not null, → `users.id` | |
| `event_id` | INTEGER | not null, → `events.id` | |
| `hold_id` | TEXT | not null, → `holds.id` | A hold can have several declined orders and at most one confirmed one |
| `status` | TEXT | not null, `confirmed` or `declined` | |
| `total_cents` | INTEGER | not null | Sum of held seat prices at checkout |
| `created_at` | INTEGER | not null | |

### `order_items`

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `order_id` | INTEGER | not null, → `orders.id` | |
| `event_id` | INTEGER | not null | |
| `seat_id` | TEXT | not null | |
| `barcode` | TEXT | not null, **unique** | UUID4 ticket code |

Primary key: `(event_id, seat_id)`, so a seat can be sold **at most once**.
Foreign key: `(event_id, seat_id)` → `seats(event_id, id)`. Only confirmed orders
have items.

### `reviews`

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | INTEGER | primary key | |
| `event_id` | INTEGER | not null, → `events.id` | |
| `user_id` | INTEGER | not null, → `users.id` | |
| `body` | TEXT | not null | Stored verbatim; escaped when rendered |
| `created_at` | INTEGER | not null | |

### `idempotency`

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `user_id` | INTEGER | not null, → `users.id` | |
| `scope` | TEXT | not null | `hold:<event_id>` or `checkout` |
| `key` | TEXT | not null | Client's `Idempotency-Key` |
| `fingerprint` | TEXT | not null | Canonical JSON of the request body |
| `response` | TEXT | not null | JSON of the stored response |

Primary key: `(user_id, scope, key)`. Rows are kept forever.

## Indexes

| Index | Columns | Used by |
| --- | --- | --- |
| `holds_owner` | `holds(user_id, event_id, status)` | Active-hold lookup and the six-seat limit |
| `orders_owner` | `orders(user_id, event_id)` | The six-seat limit and order lists |
| `reviews_event` | `reviews(event_id, id)` | Paged review lists |

## Seed data

Created by `initialize()` in [`db.py`](../backend/ticketsenpai/db.py) only when
`users` is empty:

| Table | Rows |
| --- | --- |
| `users` | Alice and Bob (customers), Senpai (admin). See [demo accounts](../README.md#demo-accounts). |
| `events` | After Hours ($95), Loud & Clear ($65), Sunday Sessions ($45), and the unpublished Unannounced show ($55) |
| `seats` | 270 per event, 1,080 total |
| `reviews` | One review by Bob on After Hours |

## Schema changes

There is no migration tool. `schema.sql` runs on every startup with
`CREATE TABLE IF NOT EXISTS`, which creates missing tables but never alters
existing ones. After a schema change:

1. Stop the servers.
2. Run `make reset CONFIRM=reset`.
3. Say in your pull request that a reset is required, and add an upgrade note
   to the [changelog](../CHANGELOG.md).

## Inspecting the database

Python's built-in `sqlite3` module is enough; no extra tools are needed.

```sh
backend/.venv/bin/python - <<'PY'
import sqlite3
from contextlib import closing
with closing(sqlite3.connect('backend/instance/ticketsenpai.sqlite3')) as db:
    query = """
        SELECT section, status, count(*) FROM seats
        WHERE event_id = 1 GROUP BY section, status
    """
    for row in db.execute(query):
        print(row)
PY
```

Useful queries:

```sql
-- Active holds and when they expire
SELECT id, user_id, event_id, datetime(expires_at, 'unixepoch') FROM holds WHERE status = 'active';

-- Confirmed sales per event
SELECT event_id, count(*) FROM order_items GROUP BY event_id;

-- Confirm no password is stored in plaintext
SELECT email, substr(password, 1, 7) FROM users;
```

Prefer reading over writing. If you edit rows by hand, stop the servers first,
and reset if things get inconsistent.
