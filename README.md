# TicketSenpai

A local concert-ticketing coursework app built with Next.js 16, Flask 3.1, and
SQLite. Repurposes the existing demo's seat map, timed holds, purchase rules,
and Ramp visual tokens. Includes six intentional vulnerabilities for peer testing.

## Quick start

Install **Node.js 22+ (with npm), Python 3.10+, and make** first. On Linux, Python's
`venv` support may be a separate OS package. Use macOS, Linux, or Windows via WSL.
Internet access is needed for dependency installation, not for the running app.

Clone the repository (requires Git), or download and extract its source ZIP:

```sh
git clone https://github.com/Kandel-Bibas/TicketSenpai.git
cd TicketSenpai
```

From the project directory:

```sh
make setup
make dev
```

Open **http://127.0.0.1:3000**. Ctrl+C stops both servers.

`make setup` installs pinned JavaScript dependencies from the lockfile, creates
`backend/.venv`, installs Flask, and initializes the database. It preserves existing
data when rerun. Stop the servers before running setup again.

The frontend proxies `/api/*` to Flask on `127.0.0.1:5001`; use the frontend URL
for the browser and API demonstrations so session cookies stay on one origin.
The dev script rejects occupied ports rather than silently selecting another port.
Both servers bind to loopback. Use synthetic data only: this is deliberately
vulnerable coursework, not a production deployment.

## Demo accounts

| Account | Email | Password |
| --- | --- | --- |
| Customer Alice | `alice@example.test` | `alice-demo` |
| Customer Bob | `bob@example.test` | `bob-demo` |
| Administrator | `admin@example.test` | `admin-demo` |

New users can register through `/register`. Only seeded administrators can manage
events. Every seeded show is fictional; payment is simulated and never uses a card.

## What works

- Browse/search shows; three published shows plus one draft for the SQLi exercise.
- Register, sign in/out, and edit a profile name.
- Select reserved seats or a general-admission quantity. Each event has 50 premium,
  120 standard, and 100 GA seats, preserving the original venue layout.
- Reserve up to six seats per person per event for eight minutes. Reloading the
  event page restores the logged-in user's active hold.
- Simulate approved or declined payment. A decline leaves the hold available for
  another attempt. Successful purchases issue local ticket identifiers.
- See purchases in My Tickets and individual order pages.
- Post event reviews. Administrators create/edit events and publish/unpublish them.
- Light/dark themes, keyboard seat navigation, and responsive layouts.

SQLite transactions serialize competing hold/checkout writes. Unique order-item
constraints prevent a seat from appearing in two confirmed orders. Successful hold
and checkout requests replay by `Idempotency-Key`; a reused key with a changed body
returns 409. A declined checkout also replays; retry payment with a new key.
Failures roll back and are not saved in the idempotency table. Repeated review or
admin-create submissions create separate records; edit operations overwrite values.

Expired holds release lazily on inventory reads or purchase operations. A hold
cannot be bought after expiry even if no browser has polled. Purchases and sessions
persist across restarts; sessions expire after 24 hours. Pricing is calculated on
the server and cannot change while seats for an event are held or sold. Unpublishing
an event prevents new checkout, including checkout of an existing hold.

## Commands

| Command | Result |
| --- | --- |
| `make setup` | Install dependencies and initialize data |
| `make dev` | Run Next.js and Flask together |
| `make test` | Run the reference Node suite and new Flask HTTP tests |
| `make build` | Build the Next.js frontend |
| `make check` | Run both test suites and the frontend build |
| `make package` | Create and verify `output/TicketSenpai_Milestone1.zip` from source and the prepared PDF |
| `make smoke` | Fresh install in a temporary directory, repeat setup, start/stop/restart both servers, and verify reset safeguards (ports 3000 and 5001 must be free) |
| `make reset CONFIRM=reset` | Delete and reseed only TicketSenpai's local database; servers must be stopped |

Use `make setup PYTHON=python3.12` if your preferred Python has another command name.
No linter is installed. The frontend uses JavaScript; the build is not a TypeScript
validation claim. Backend tests use Python's standard-library unittest runner:

```sh
cd backend
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m unittest discover -s tests -k concurrent -v
```

## Code and API

- `frontend/app/`: pages and styles; `frontend/components/`: shared UI and seat map.
- `backend/ticketsenpai/__init__.py`: HTTP validation, session handling, API routes.
- `backend/ticketsenpai/service.py`: hold, expiry, ownership, and checkout rules.
- `backend/ticketsenpai/db.py` and `schema.sql`: SQLite connection, seed, and schema.
- `backend/instance/ticketsenpai.sqlite3`: generated, ignored local database.
- `scripts/`: rerunnable setup, development-process supervisor, and reset commands.
- [Vulnerability walkthrough](docs/vulnerabilities.md): locations, demonstrations,
  expected evidence, and fixes for all six intentional weaknesses.

API responses are JSON. Expected errors use `{ "error": { "code", "message" } }`.
Unexpected exceptions intentionally also return `error.traceback`. List endpoints
use `?page=1` and a page size of 20 (the intentionally injectable search can bypass
its SQL limit). Hold and checkout writes require an `Idempotency-Key` header.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Readiness |
| POST | `/api/register`, `/api/login`, `/api/logout` | Account/session lifecycle |
| GET, PATCH | `/api/me` | Read/update profile |
| GET | `/api/events?q=...`, `/api/events/<id>` | Search or event plus seat map |
| GET, POST | `/api/events/<id>/reviews` | Read/write reviews |
| POST | `/api/events/<id>/holds` | Reserve `seat_ids` |
| GET | `/api/events/<id>/hold` | Restore own active hold |
| DELETE | `/api/holds/<id>` | Release own hold |
| GET, POST | `/api/orders` | Own order list or checkout using `hold_id` and `payment` |
| GET | `/api/orders/<id>` | Order details (intentional IDOR) |
| GET, POST | `/api/admin/events` | List all events or create one |
| PUT | `/api/admin/events/<id>` | Edit event |

## Submission package

The prepared five-page summary is [PROJECT_SUMMARY.pdf](PROJECT_SUMMARY.pdf).
Regeneration writes `output/pdf/PROJECT_SUMMARY.pdf`; the packager uses that version
when present, otherwise the included root PDF. The submission ZIP includes the PDF
at the root of its project folder.
Run `make package` to rebuild `output/TicketSenpai_Milestone1.zip`; the packager
checks archived bytes and CRCs and writes a companion SHA-256 file. It excludes
installed dependencies, build output, local databases, and session data.
With ports 3000 and 5001 free, `python3 scripts/verify_submission.py` extracts the
ZIP into a temporary directory and runs setup, both suites/build, startup/shutdown
smoke checks, and repackaging. This requires internet access for the fresh install.

The ZIP includes this README, application and reference source, tests, screenshots,
the PDF, a [generic team plan](docs/team-plan.md), and a
[course-material alignment checklist](docs/course-alignment.md).
Team assignments use **Team Member 1–4** and do not claim individual contributions.

To regenerate the PDF, run `python3 scripts/build_summary.py` in a Python environment
with ReportLab available. This optional documentation tool is not needed for
`make setup`, `make dev`, or packaging the included PDF. Screenshots live in
`docs/screenshots/`; recapture them after meaningful interface changes.

## Existing mock and remaining coursework

The original `src/`, `web/`, and `test/` remain runnable with `npm start`,
`npm run web`, and `npm test`. They are a separate Node/in-memory application;
TicketSenpai does not call them. Its ported behavior is covered by new Flask tests.
See [the original backend guide](docs/reference-backend.md) and
[ticketing-platform-design.html](ticketing-platform-design.html).

The waiting-room controller, crowd simulation, PSP outage recovery, and background
payment pipeline are deferred from this capstone scope. The course starter was
reviewed on October 15, 2026 and matches the application's overall stack and layout;
port, proxy, package structure, and version differences are documented in the
alignment checklist. The user has not downloaded the Canvas AI Prompt Library or
Vulnerability Implementation Guide. Exact rubric alignment, CSRF expectations,
and acceptable evidence for plaintext password storage remain pending their review.

⚠ SECURITY: Have another teammate review the intentional authentication/session
weaknesses and the proof of each vulnerability before peer testing.
