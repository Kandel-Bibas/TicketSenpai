# Glossary

Terms used across TicketSenpai's code and documentation, in alphabetical order.

### Active hold

A [hold](#hold) with status `active` whose `expires_at` has not passed. Only
active holds can be checked out.

### Admin / administrator

A user with `role = 'admin'`. Can create, edit, publish, and unpublish events.
Only seeded accounts are admins. See the [administrator guide](admin-guide.md).

### Barcode / ticket code

The random UUID stored in `order_items.barcode` for each sold seat, shown on
the ticket page. Unique across all tickets.

### `BEGIN IMMEDIATE`

The SQLite statement that starts every write transaction. It takes the
database write lock immediately, so concurrent writers wait their turn instead
of failing halfway.

### Checkout

Turning a hold into an order with a simulated payment (`POST /api/orders`).

### Converted

The status of a hold that was successfully bought.

### Declined order

An order created by a `decline` payment. It issues no tickets and leaves the
hold active.

### Draft

An unpublished event (`published = 0`). Visible only to admins.

### Error code

The stable, machine-readable `error.code` in an API error response, such as
`seat_taken`. Clients should rely on it rather than `error.message`. See the
[error table](api.md#error-codes).

### Event

A show that can be booked. Each event has its own 270 seats.

### Expire / lazy expiry

Releasing holds whose time ran out. TicketSenpai has no background job;
`expire_holds()` runs at the start of every inventory read or write instead.

### Fingerprint

A canonical JSON copy of a request body, stored with an
[idempotency key](#idempotency-key) to detect a key reused for a different request.

### GA (general admission)

The 100-spot standing section. GA spots are chosen by quantity, not by position.

### Hold

A temporary reservation of 1–6 seats for one user, lasting eight minutes.
Statuses: `active`, `released`, `expired`, `converted`.

### Idempotency key

A unique client-chosen string sent in the `Idempotency-Key` header. Repeating
a request with the same key returns the original result instead of doing the
work twice. See [Idempotency](api.md#idempotency).

### IDOR (insecure direct object reference)

Accessing someone else's data by changing an ID in a request. Fixed in
TicketSenpai as [V03](vulnerabilities.md#v03-idor).

### Milestone

A stage of the original capstone. Milestone 1 shipped six intentional
weaknesses; Milestone 2 was peer testing; Milestone 3 fixed them.

### Order

The record of a checkout attempt, either `confirmed` (with tickets) or `declined`.

### OWASP Top 10

A standard list of web-application security risk categories. TicketSenpai uses
the 2021 edition to classify V01–V06.

### Price lock

The rule that an event's price cannot change once any of its seats is held or
sold (`409 price_locked`).

### `Problem`

The Python exception in `service.py` used for expected errors. It carries an
error code, a message, and an HTTP status.

### Published

An event visible to customers (`published = 1`). Only published events can be
searched, viewed, held, or bought.

### Reference mock

The original zero-dependency Node.js simulation in `src/`, `web/`, and `test/`.
Separate from TicketSenpai. See the [reference backend guide](reference-backend.md).

### Released

The status of a hold the user gave up with **Choose different seats**
(`DELETE /api/holds/{id}`).

### Replay

Returning a stored response for a repeated idempotency key instead of
running the request again.

### Section

A part of the venue: `A` (premium, 50 seats), `B` (standard, 120 seats), or
`GA` (100 spots).

### Seat ID

A seat's identifier within an event: `A-<row>-<seat>`, `B-<row>-<seat>`, or
`GA-<n>`. The same ID exists in every event.

### Seat limit

At most six seats per user per event, counting both held and bought seats.

### Session

A signed-in state, represented by a random token in the `session` cookie and a
row in `sessions`. Lasts 24 hours.

### Standard price

The event's `price_cents`, charged for section B. Other sections add a fixed
amount to it.

### Synthetic data

Made-up data such as the demo accounts and fictional shows. TicketSenpai must
only ever hold synthetic data.

### V01–V06

The six intentional weaknesses from Milestone 1, all fixed. See the
[remediation record](vulnerabilities.md).

### WAL (write-ahead logging)

SQLite's journal mode used by TicketSenpai. Readers don't block the writer.
It creates `-wal` and `-shm` files next to the database.
