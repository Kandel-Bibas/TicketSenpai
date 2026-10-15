# TicketSenpai team plan

Team name: **Team TicketSenpai**. All member names below are generic placeholders.
Assignments describe responsibility, not completed individual contributions.

| Member | Role | Responsibility | Review evidence |
| --- | --- | --- | --- |
| Team Member 1 | Lead Developer | Integrate Next.js and Flask; maintain setup and packaging | Clean extracted install, `make check`, source ZIP inspection |
| Team Member 2 | Database Designer | SQLite schema and seeds; hold/checkout transactions | Concurrency, expiry, persistence, and idempotency tests |
| Team Member 3 | Frontend Designer | Discovery, accounts, booking, reviews, tickets, admin UI | Desktop/mobile and keyboard walkthroughs; screenshots |
| Team Member 4 | Security Tester | Six PoCs, OWASP mapping, course-guide reconciliation | Cross-user XSS/IDOR proof, session review, vulnerability notes |

## Feature ownership

Accounts/profile: Members 1 and 3; events/search: Members 2 and 3;
seat holds/checkout: Members 1 and 2; reviews: Members 2 and 3;
My Tickets/admin: Members 1 and 3. Member 4 reviews security demonstrations
across all five feature groups.

## Vulnerability ownership

| ID | Intentional weakness | Primary owner | Location |
| --- | --- | --- | --- |
| V01 | SQL injection | Team Member 2 | `events()` in `backend/ticketsenpai/__init__.py` |
| V02 | Stored XSS | Team Member 3 | `review()` and `frontend/app/events/[id]/page.js` |
| V03 | IDOR | Team Member 1 | `order()` |
| V04 | Predictable session tokens | Team Member 1 | `login()` and `auth()` |
| V05 | Plaintext passwords | Team Member 2 | `register()`, `login()`, and `db.py` |
| V06 | Traceback disclosure | Team Member 1 | `unexpected()` |

Team Member 4 reproduces each proof using [the walkthrough](vulnerabilities.md).
⚠ SECURITY: authentication/session code needs a second teammate's review.
No claim of that human review is made by this package.

## Completion and remaining work

Implemented: five feature groups, six marked weaknesses, setup/dev commands,
automated checks, screenshots, five-page PDF, and source packaging.
Still pending: review the undownloaded Canvas guides, resolve any rubric differences,
and complete the second-person security review before peer testing.
