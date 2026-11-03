# Changelog

All notable changes to TicketSenpai are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The project tracks course milestones rather than numbered releases; each entry
is named after the milestone it shipped in.

## [Unreleased]

### Added

- Open-source documentation set: restructured README, [architecture guide](docs/architecture.md),
  [HTTP API reference](docs/api.md), [development guide](docs/development.md),
  [troubleshooting and FAQ](docs/troubleshooting.md), [documentation index](docs/README.md),
  [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md),
  [SECURITY.md](SECURITY.md), [SUPPORT.md](SUPPORT.md), and GitHub issue and
  pull request templates.

## [Milestone 3] - 2026-11-01

### Added

- Regression tests `test_v01_*` through `test_v06_*` proving each remediated
  weakness stays fixed.
- Defense report source (`docs/defense-report.html`), `Defense_Report.pdf`, and
  `scripts/build_defense_report.py`.

### Changed

- Upgraded the frontend to Next.js 16.4.3.
- The development server runs with Flask debug mode, the debugger, and the
  reloader off.
- `make package` now builds `output/Sentinel_Milestone3.zip` and includes
  `Defense_Report.pdf`. `PROJECT_SUMMARY.pdf` stays in the repository as the
  Milestone 1 record and is no longer packaged.
- Updated the stale V02 code comment: reviews are escaped by the frontend.

### Security

- **V01 SQL injection** (A03): event search uses a parameterized query. ([#1])
- **V02 Stored XSS** (A03): reviews render as escaped React text instead of
  `dangerouslySetInnerHTML`. ([#2])
- **V03 IDOR** (A01): order lookups are scoped to the signed-in user and return
  404 otherwise. ([#3])
- **V04 Predictable sessions** (A07): `secrets.token_urlsafe(32)` tokens,
  rotated on every login. ([#4])
- **V05 Plaintext passwords** (A02): salted scrypt hashes via werkzeug for
  registration, login, and seed data. ([#5])
- **V06 Traceback disclosure** (A05): `DEBUG=False`, a fixed 500 body, details
  logged server-side, and out-of-range IDs rejected with 404. ([#6])

### Upgrade notes

- Databases created by a Milestone 1 build contain plaintext passwords, so demo
  logins fail with "Email or password is incorrect." Stop the servers and run
  `make reset CONFIRM=reset`.

## [Milestone 1] - 2026-10-15

### Added

- TicketSenpai application: Next.js frontend, Flask API, and SQLite storage.
- Accounts: registration, sign-in and sign-out, profile name editing.
- Event browsing and search, with one unpublished draft event.
- Reserved-seat and general-admission selection on a 270-seat venue map with
  keyboard navigation.
- Eight-minute seat holds, a six-seat-per-event limit, and hold restoration on reload.
- Simulated approve/decline checkout with idempotent hold and checkout requests.
- My Tickets and order detail pages.
- Event reviews.
- Administrator event creation, editing, publishing, and a price lock once seats
  are held or sold.
- Light and dark themes and responsive layouts.
- `make setup`, `make dev`, `make test`, `make check`, `make smoke`,
  `make package`, and `make reset CONFIRM=reset`.
- Flask HTTP test suite covering concurrency, expiry, idempotency, and access rules.
- Team plan, course-alignment checklist, verification record, and `PROJECT_SUMMARY.pdf`.

### Security

- Six intentional weaknesses (V01–V06) shipped for Milestone 2 peer testing.
  **Do not use Milestone 1 builds.**

[Unreleased]: https://github.com/Kandel-Bibas/TicketSenpai/compare/60408ab...HEAD
[Milestone 3]: https://github.com/Kandel-Bibas/TicketSenpai/compare/e33d157...60408ab
[Milestone 1]: https://github.com/Kandel-Bibas/TicketSenpai/commit/e33d157
[#1]: https://github.com/Kandel-Bibas/TicketSenpai/pull/1
[#2]: https://github.com/Kandel-Bibas/TicketSenpai/pull/2
[#3]: https://github.com/Kandel-Bibas/TicketSenpai/pull/3
[#4]: https://github.com/Kandel-Bibas/TicketSenpai/pull/4
[#5]: https://github.com/Kandel-Bibas/TicketSenpai/pull/5
[#6]: https://github.com/Kandel-Bibas/TicketSenpai/pull/6
