# Development guide

Everything you need to work on TicketSenpai day to day: setting up, running,
testing, and finding your way around the code. For a first run, the
[Quick start](../README.md#quick-start) in the README is shorter.

- [Prerequisites](#prerequisites)
- [Setting up](#setting-up)
- [Running the app](#running-the-app)
- [Make targets](#make-targets)
- [Testing](#testing)
- [Working on the backend](#working-on-the-backend)
- [Working on the frontend](#working-on-the-frontend)
- [Database tasks](#database-tasks)
- [Packaging and verification](#packaging-and-verification)
- [Code style](#code-style)
- [The reference mock](#the-reference-mock)

## Prerequisites

| Tool | Version | Check |
| --- | --- | --- |
| Node.js (with npm) | 22 or newer | `node --version` |
| Python | 3.10 or newer, with `venv` | `python3 --version` |
| make | any | `make --version` |
| Git | any (optional if you use the source ZIP) | `git --version` |

Supported platforms are macOS, Linux, and Windows through WSL. On Debian and
Ubuntu, `venv` is a separate package (for example `sudo apt install python3-venv`).
Internet access is needed to install dependencies, not to run the app.

If your Python 3.10+ interpreter has a different name, pass it to make:

```sh
make setup PYTHON=python3.12
```

## Setting up

```sh
git clone https://github.com/Kandel-Bibas/TicketSenpai.git
cd TicketSenpai
make setup
```

[`scripts/setup.py`](../scripts/setup.py) does the following, in order:

1. Checks the Python and Node.js versions.
2. Creates the virtual environment `backend/.venv`.
3. Installs `backend/requirements.txt` into it.
4. Runs `npm ci --prefix frontend`, which installs exactly what
   `frontend/package-lock.json` pins.
5. Creates and seeds `backend/instance/ticketsenpai.sqlite3` if it has no users yet.

Setup is safe to rerun and keeps existing data. Stop the dev servers first.

## Running the app

```sh
make dev
```

Open <http://127.0.0.1:3000>. Press Ctrl+C to stop both servers.

[`scripts/dev.py`](../scripts/dev.py) refuses to start if port 3000 or 5001 is
already taken, rather than silently picking another port. If either server exits,
the supervisor stops the other one and exits with a non-zero status.

To run the servers separately, for example to see their logs in different
terminals:

```sh
# Terminal 1: Flask API on 127.0.0.1:5001
cd backend && .venv/bin/python run.py

# Terminal 2: Next.js on 127.0.0.1:3000
npm --prefix frontend run dev
```

Flask runs with debug mode, the debugger, and the reloader all **off**. Restart
the backend after changing Python code. Next.js hot-reloads frontend changes.

## Make targets

| Command | What it does |
| --- | --- |
| `make help` | Print the common targets |
| `make setup` | Install dependencies and initialize data |
| `make dev` | Run Next.js and Flask together |
| `make test` | Run the reference Node suite and the Flask HTTP tests |
| `make build` | Production build of the Next.js frontend |
| `make check` | `make test` followed by `make build`. Run this before opening a pull request. |
| `make smoke` | Fresh install in a temporary directory, repeated setup, start/stop/restart of both servers, and reset safeguards. Ports 3000 and 5001 must be free. |
| `make package` | Build and verify `output/Sentinel_Milestone3.zip` |
| `make reset CONFIRM=reset` | Delete and reseed the local database. Servers must be stopped. |

## Testing

```sh
make test     # both suites
make check    # both suites + frontend production build
```

### Backend tests

[`backend/tests/test_app.py`](../backend/tests/test_app.py) uses Python's built-in
`unittest`. Each test gets its own temporary SQLite database and a controllable
clock, so tests never touch your local data and never sleep.

```sh
cd backend
.venv/bin/python -m unittest discover -s tests -v                # everything
.venv/bin/python -m unittest discover -s tests -k concurrent -v  # by name pattern
.venv/bin/python -m unittest discover -s tests -k test_v0 -v     # security regressions only
```

The suite covers:

- Purchases persisting and issuing tickets.
- Concurrent holds and checkouts with exactly one winner.
- Rollback of partially overlapping holds.
- Hold expiry, release, ownership, and the six-seat limit.
- Idempotent replay and key reuse.
- Declined payment followed by a retry.
- Input validation, registration, profile, logout, session expiry, and admin boundaries.
- Admin create, edit, and the price lock.
- `test_v01_*` through `test_v06_*`: regression tests proving each fixed
  vulnerability stays fixed. See [vulnerabilities.md](vulnerabilities.md).

**Writing a test.** Use the helpers on `TicketSenpaiTest`:

```python
def test_example(self):
    hold = self.hold(['B-1-1']).get_json()          # Alice holds a seat
    order = self.buy(hold).get_json()                # and buys it
    self.assertEqual(order['status'], 'confirmed')

    self.time += 481                                 # move the fake clock forward
    bob = self.login('bob')                          # a second, independent client
    self.assertEqual(self.hold(['B-1-1'], client=bob).status_code, 409)
```

Every behavior change needs a test. Every bug fix needs a test that fails
without the fix.

### Reference mock tests

`npm test` runs `node --test` over [`test/`](../test). These tests cover the
independent Node reference mock, not TicketSenpai. They use a manual clock from
`test/helpers.js` and never depend on real timers.

## Working on the backend

| File | Change it when you are… |
| --- | --- |
| [`ticketsenpai/__init__.py`](../backend/ticketsenpai/__init__.py) | Adding or changing a route, input validation, auth, or error handling |
| [`ticketsenpai/service.py`](../backend/ticketsenpai/service.py) | Changing hold, expiry, checkout, order, or idempotency rules |
| [`ticketsenpai/db.py`](../backend/ticketsenpai/db.py) | Changing connection settings, transactions, seat layout, or seed data |
| [`ticketsenpai/schema.sql`](../backend/ticketsenpai/schema.sql) | Changing tables or indexes |

Conventions:

- **Always use bound parameters** (`?`) in SQL. Never build SQL with f-strings or
  string concatenation from request data.
- Raise `Problem(code, message, status)` for expected errors. Pick a stable
  snake_case `code` and add it to the [API error table](api.md#error-codes).
- Wrap multi-statement writes in `with transaction(g.db):`.
- Call `expire_holds(db, now())` before reading or changing inventory.
- Use the injected `now()` clock, never `time.time()` directly, so tests can
  control time.
- Scope every user-owned lookup by `user_id`.
- Validate before you touch the database, and keep error responses generic.

**Schema changes.** The schema uses `CREATE TABLE IF NOT EXISTS` and there is no
migration tool. A changed table definition is not applied to an existing
database. After changing `schema.sql`, run `make reset CONFIRM=reset`, and call
out the reset in your pull request.

## Working on the frontend

| Path | Contents |
| --- | --- |
| `frontend/app/events/` | Event search and the event page with seat map, hold, checkout, and reviews |
| `frontend/app/tickets/` | My Tickets list and order detail |
| `frontend/app/login/`, `register/`, `profile/` | Account pages |
| `frontend/app/admin/` | Event management for administrators |
| `frontend/components/shell.js` | Layout, navigation, session context (`useSession()`), theme toggle |
| `frontend/components/seat-map.js` | Seat grid with keyboard navigation and GA quantity |
| `frontend/components/auth-form.js` | Shared login and registration form |
| `frontend/lib/api.js` | `api()` fetch wrapper, `money()`, `date()` |
| `frontend/app/globals.css` | Design tokens, light and dark themes, layout |

Conventions:

- Call the backend only through `api()` from `lib/api.js`. It adds the `/api`
  prefix, JSON headers, and `Idempotency-Key` (pass `key`).
- Generate a new idempotency key per user action and reuse it only for retries
  of that same action.
- Render user content as text (`{value}`). Do not use `dangerouslySetInnerHTML`.
- Keep pages keyboard-accessible and usable at narrow widths, in both themes.

The frontend is JavaScript. `make build` checks that Next.js can build it; it
does not type-check.

## Database tasks

The database is `backend/instance/ticketsenpai.sqlite3` (git-ignored).

```sh
# Inspect it with the venv's Python (no sqlite3 CLI needed)
backend/.venv/bin/python - <<'PY'
import sqlite3
from contextlib import closing
with closing(sqlite3.connect('backend/instance/ticketsenpai.sqlite3')) as db:
    for row in db.execute('SELECT id, name, published FROM events'):
        print(row)
PY

# Start over with fresh seed data (stop make dev first)
make reset CONFIRM=reset
```

`make reset` only deletes TicketSenpai's own database files (`.sqlite3`, `-wal`,
`-shm`). It never touches the reference mock, which keeps no files.

## Packaging and verification

These are used to produce the course submission and are not needed for normal
development.

| Command | Purpose |
| --- | --- |
| `make package` | Builds `output/Sentinel_Milestone3.zip` and a `.sha256` file. Verifies every archived file byte for byte. Excludes dependencies, build output, databases, and `.env` files. |
| `python3 scripts/verify_submission.py` | Extracts the ZIP into a temporary directory and runs `setup`, `check`, `smoke`, and `package` there. Needs internet access and free ports 3000 and 5001. |
| `python3 scripts/build_defense_report.py` | Prints `docs/defense-report.html` to `Defense_Report.pdf` with headless Chrome. Set `CHROME` if Chrome is not found. |

## Code style

There is no linter or formatter configured. Match the surrounding code:

- **Python**: standard library first, short functions, single quotes, type hints
  on public helpers.
- **JavaScript**: ES modules, double quotes, two-space indentation, functional
  React components.
- Keep comments for the *why*. Security fixes are marked `FIXED Vxx`; keep those
  markers when editing nearby code.

## The reference mock

`src/`, `web/`, and `test/` are the original zero-dependency Node.js mock of a
large-scale ticketing design. TicketSenpai does not import or call it.

```sh
npm start      # mock API on http://127.0.0.1:4010
npm run web    # demo page on http://127.0.0.1:4011 (second terminal)
npm test       # mock test suite
```

See the [reference backend guide](reference-backend.md) for its configuration,
endpoints, and design mapping.
