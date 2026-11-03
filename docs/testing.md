# Testing guide

What is tested, how the tests work, and how to add new ones. For the commands
alone, see [Testing](development.md#testing) in the development guide.

- [Test suites at a glance](#test-suites-at-a-glance)
- [How the backend tests work](#how-the-backend-tests-work)
- [Backend test catalog](#backend-test-catalog)
- [Reference mock tests](#reference-mock-tests)
- [Workflow and packaging checks](#workflow-and-packaging-checks)
- [Manual checks](#manual-checks)
- [Writing good tests](#writing-good-tests)

## Test suites at a glance

| Suite | Location | Runner | Command | Covers |
| --- | --- | --- | --- | --- |
| Backend HTTP tests | `backend/tests/test_app.py` | `unittest` | `make test` | The TicketSenpai API |
| Reference mock tests | `test/*.test.js` | `node --test` | `npm test` (part of `make test`) | The separate Node mock in `src/` and `web/` |
| Frontend build | `frontend/` | `next build` | `make build` | That every page compiles |
| Workflow smoke test | `scripts/verify_workflow.py` | Python | `make smoke` | Fresh setup, rerun setup, start/stop, port checks, reset safeguards |
| Submission check | `scripts/verify_submission.py` | Python | `python3 scripts/verify_submission.py` | The packaged ZIP installs and passes everything |

`make check` runs the first three. Run it before every pull request.

## How the backend tests work

Every test in `TicketSenpaiTest`:

- Gets a **fresh temporary database**, seeded like a real install, and deleted
  afterwards. Your local `backend/instance` database is never touched.
- Uses a **fake clock**: `self.time` starts at `1800000000` and is passed to
  `create_app(path, clock=...)`. Tests move time forward with `self.time += 480`
  instead of sleeping.
- Talks to the app over HTTP with Flask's test client, so routing, validation,
  cookies, and error handlers are all exercised.
- Starts signed in as Alice (`self.client`).

| Helper | What it does |
| --- | --- |
| `self.login(name)` | Returns a new client signed in as `alice`, `bob`, or `admin` |
| `self.token(client=None)` | Returns that client's session cookie value |
| `self.hold(seats=None, client=None, key=None, event=1)` | `POST /api/events/{event}/holds`, default seat `A-1-1`, random key unless given |
| `self.buy(hold, client=None, payment='approve', key=None)` | `POST /api/orders` for a hold, random key unless given |

**Simulating a restart:** create a second app on the same file,
`create_app(self.path, clock=lambda: self.time)`, and copy the cookie across with
`set_cookie('session', self.token())`.

**Testing concurrency:** run requests from two clients through a
`concurrent.futures.ThreadPoolExecutor(2)`. SQLite's `BEGIN IMMEDIATE`
serializes them, and the test asserts exactly one winner.

## Backend test catalog

### Purchase correctness

| Test | Proves |
| --- | --- |
| `test_purchase_persists_and_issues_ticket` | Checkout issues a ticket at the right price, and the order and sold seat survive a restart |
| `test_concurrent_hold_has_exactly_one_winner` | Two users racing for one seat: one `201`, one `409` |
| `test_overlapping_hold_rolls_back_every_seat` | A hold that fails on one seat holds none of them |
| `test_expired_hold_cannot_buy_and_seat_is_reusable` | After 480 s the hold can't be bought and the seat is free again |
| `test_concurrent_checkout_replays_one_order` | Two simultaneous checkouts with the same key create one order |
| `test_idempotency_replay_and_mismatch` | Same key and body replays; same key and new body is `409`; no key is `400` |
| `test_decline_then_retry` | A decline keeps the hold, replays by key, then an approval succeeds once |
| `test_hold_ownership_stays_enforced` | Another user can't buy or release your hold; releasing twice is safe |
| `test_active_hold_restores_after_restart_and_is_owner_filtered` | Active-hold lookup survives restart, is per-user, and respects expiry |
| `test_limits_include_active_holds_and_purchases` | The six-seat limit counts held and bought seats |

### Validation, accounts, and admin

| Test | Proves |
| --- | --- |
| `test_invalid_inputs_have_specific_errors` | Bad seat lists are `422`; bad bodies, pages, and JSON are `400`; unknown events and routes are `404` |
| `test_registration_profile_and_logout` | Registration, duplicate email `409`, `role` can't be self-assigned, profile edit, logout |
| `test_session_expiry_and_admin_boundary` | Customers get `403` on admin routes; sessions expire after 24 hours |
| `test_admin_create_edit_and_price_lock` | Create makes 270 seats; repricing works until a hold exists, then `409`; unpublishing blocks viewing and checkout |
| `test_search_wildcards_are_literal` | `%`, `_`, and `!` in search match literally |

### Security regressions

Each proves one [remediated vulnerability](vulnerabilities.md) stays fixed.

| Test | Weakness |
| --- | --- |
| `test_v01_search_injection_is_treated_as_text` | V01 SQL injection |
| `test_v02_review_html_is_returned_as_data` | V02 Stored XSS (the API returns HTML as data; the frontend escapes it) |
| `test_v03_order_detail_is_owner_scoped` | V03 IDOR |
| `test_v04_session_tokens_are_random_and_rotate` | V04 Predictable sessions |
| `test_v05_passwords_are_stored_hashed` | V05 Plaintext passwords |
| `test_v06_errors_do_not_disclose_internals` | V06 Traceback disclosure |

Run just these with:

```sh
cd backend && .venv/bin/python -m unittest discover -s tests -k test_v0 -v
```

## Reference mock tests

`npm test` runs `node --test` over [`test/`](../test). These cover the separate
Node mock, not TicketSenpai.

| File | Area |
| --- | --- |
| `admission-controller.test.js` | Release-rate decisions and zero-gates |
| `config-token.test.js` | Configuration loading and admission tokens |
| `gateway.test.js` | Token checks and per-token rate limiting |
| `holds.test.js` | Seat holds and expiry |
| `http-contract.test.js` | HTTP routes, status codes, error envelope |
| `idempotency.test.js` | `Idempotency-Key` replay and conflicts |
| `psp-outage.test.js` | Payment provider outage and circuit breaker |
| `purchase.test.js` | The end-to-end purchase pipeline |
| `waiting-room.test.js` | Queue join, draw, and admission |
| `web-crowd.test.js` | The demo page's bot crowd |

`test/helpers.js` boots the mock on an ephemeral port with a manual clock;
`elapse(ms)` advances time and runs the background loops.

## Workflow and packaging checks

These start real servers, so ports 3000 and 5001 must be free.

- **`make smoke`** copies `backend/`, `frontend/`, `scripts/`, and the `Makefile`
  to a temporary directory and runs setup twice. It then starts `make dev` twice,
  each time waiting for both health checks, confirming a second `make dev` is
  rejected with *already in use*, and checking that Ctrl+C frees both ports.
  Finally, it confirms `make reset` refuses to run without `CONFIRM=reset` and
  succeeds with it.
- **`python3 scripts/verify_submission.py`** checks the ZIP for unsafe or
  generated files, extracts it, and runs `make setup`, `check`, `smoke`, and
  `package` inside it. Run `make package` first. Needs internet access.

## Manual checks

Some behavior is only visible in a browser. Before merging UI changes:

- [ ] Hold, decline, approve, and view tickets for a show as Alice.
- [ ] With Alice and Bob in two different browsers, the seat Alice holds shows as
      taken for Bob within five seconds.
- [ ] The hold countdown reaches zero and the page asks you to choose again.
- [ ] A review containing `<b>hi</b>` is shown as literal text.
- [ ] Keyboard only: tab into the seat map, move with the arrow keys, and select.
- [ ] Light and dark themes, and a narrow (phone-width) window.
- [ ] As admin, create an event, unpublish it, and confirm it disappears from Explore.

## Writing good tests

- **Test through HTTP.** Call endpoints, not internal functions, so the test
  matches what clients see.
- **Assert the error `code`**, not only the status, when a specific failure matters.
- **Never sleep.** Move `self.time` instead.
- **One behavior per test**, named `test_<behavior>`.
- **Bug fixes need a test that fails without the fix.**
- **Security fixes** get a `test_vNN_*` style regression test, and an entry in
  [vulnerabilities.md](vulnerabilities.md).
