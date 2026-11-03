# Troubleshooting and FAQ

Find your symptom below. If nothing here helps, see [SUPPORT.md](../SUPPORT.md).

- [Setup](#setup)
- [Running](#running)
- [Signing in](#signing-in)
- [Seats and checkout](#seats-and-checkout)
- [Tests and builds](#tests-and-builds)
- [Frequently asked questions](#frequently-asked-questions)

## Setup

### `TicketSenpai needs Python 3.10 or newer.`

`make setup` used an older interpreter. Point it at a newer one:

```sh
make setup PYTHON=python3.12
```

### `node is missing` or `TicketSenpai needs Node.js 22 or newer.`

Install Node.js 22 or newer (it includes npm) and open a new terminal so `node`
is on your `PATH`. Check with `node --version`.

### `The virtual environment was not created successfully because ensurepip is not available`

On Debian and Ubuntu, Python's `venv` support is a separate package:

```sh
sudo apt install python3-venv   # or python3.12-venv to match your version
rm -rf backend/.venv
make setup
```

### `npm ci` fails

`npm ci` installs exactly what `frontend/package-lock.json` pins and needs
network access to the npm registry. Check your connection or proxy settings and
rerun `make setup`. Do not replace `npm ci` with `npm install`; that can change
the lockfile.

### Windows

Run everything inside WSL. The scripts use POSIX paths such as
`backend/.venv/bin/python` and process groups, which native Windows does not provide.

## Running

### `Dependencies are missing. Run make setup first.`

`make dev` could not find `backend/.venv/bin/python` or `frontend/node_modules/next`.
Run `make setup`.

### `Port 3000 is already in use` (or 5001)

Another process is using the port. TicketSenpai deliberately does not pick a
different port. Find and stop the other process:

```sh
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:5001 -sTCP:LISTEN
```

Often it is an earlier `make dev` that is still running in another terminal.

### `A server exited. Stopping the other server.`

One of the two servers crashed or failed to start, so the supervisor stopped
both. Scroll up for the first error from Flask or Next.js. Running the two
servers separately ([development guide](development.md#running-the-app)) makes
the logs easier to read.

### The page says `The server returned an unreadable response. Check that the backend is running.`

The frontend is up but Flask is not answering. Check that
<http://127.0.0.1:5001/api/health> returns `{"ok": true, ...}`. If you started
only the frontend, start the backend too, or use `make dev`.

### I opened `http://127.0.0.1:5001` and nothing works

Use <http://127.0.0.1:3000>. Port 5001 is the API only. The session cookie is
set on the frontend origin, so API calls must go through port 3000 too.

### `localhost:3000` behaves differently from `127.0.0.1:3000`

Browsers treat them as different sites, with separate cookies. Pick one,
preferably `http://127.0.0.1:3000`, and use it consistently.

## Signing in

### Demo logins fail with `Email or password is incorrect.`

Your database was most likely created by a Milestone 1 build, which stored
plaintext passwords. Stop the servers, then reset:

```sh
make reset CONFIRM=reset
```

The demo accounts are listed in the [README](../README.md#demo-accounts).

### I was signed out unexpectedly

Sessions last 24 hours. Signing in again also ends any previous session for the
same account, so signing in from a second browser or with `curl` signs out the first.

### `Administrator access is required.`

Only seeded administrators can manage events. Sign in as `admin@example.test`.
Registered accounts are always customers.

## Seats and checkout

### `Seat … is no longer available. Choose again.`

Someone else held or bought that seat first. Pick another. Nothing in your
selection was held; holds are all-or-nothing.

### `You may hold or buy up to six seats per event.`

The limit counts seats you already bought **and** seats in your active hold.
Release your current hold, or buy it, before selecting more.

### `This hold is expired or already used. Choose seats again.`

Holds last eight minutes. After that, the seats go back on sale and the hold
cannot be bought. Select seats again.

### My payment was declined, now what?

Declines are simulated. Your hold stays active until it expires, so choose
approve and try again.

### `This key was already used for a different request.`

An `Idempotency-Key` was reused with a different body. Generate a new key for
each new action. See [Idempotency](api.md#idempotency).

### `Prices cannot change after seats are held or sold.`

Admins can change an event's other details at any time, but its price is locked
once any seat is held or sold.

## Tests and builds

### Backend tests fail with `No module named 'ticketsenpai'` or `No module named 'flask'`

Run them from `backend/` with the virtual environment's Python:

```sh
cd backend
.venv/bin/python -m unittest discover -s tests -v
```

### `make smoke` or `verify_submission.py` fails immediately

Both start real servers and need ports 3000 and 5001 free. Stop `make dev` first.
`verify_submission.py` also needs `output/Sentinel_Milestone3.zip`, so run
`make package` first, and it needs internet access for a fresh install.

### `make package` says `Missing Defense_Report.pdf`

The PDF is committed to the repository. If you deleted it, restore it with
`git checkout -- Defense_Report.pdf`, or rebuild it with
`python3 scripts/build_defense_report.py` (requires Google Chrome).

## Frequently asked questions

### Is this safe to deploy?

No. TicketSenpai is a local coursework project. It binds to loopback only, has
no login throttling, and was not built or reviewed for production. See
[SECURITY.md](../SECURITY.md).

### Does it take real payments?

No. Checkout takes `approve` or `decline` and nothing else. No card data is ever
collected.

### Why SQLite?

It needs no server, and its single write lock makes seat races simple to get
right. See [design decisions](architecture.md#design-decisions).

### Where did the vulnerabilities go?

Milestone 1 intentionally shipped six weaknesses (V01–V06). All six were fixed in
Milestone 3. The [remediation record](vulnerabilities.md) explains each one and
how to confirm the fix.

### What are `src/`, `web/`, and `test/`?

An independent Node.js reference mock that TicketSenpai's design is based on. It
is not used by the app. See the [reference backend guide](reference-backend.md).

### How do I add an administrator?

There is no API or UI for it, by design. For local experiments, change a user's
`role` to `admin` directly in `backend/instance/ticketsenpai.sqlite3`.
