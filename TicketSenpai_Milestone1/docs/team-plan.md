# TicketSenpai team plan

Team name: **Team TicketSenpai**. Members: Bibas Kandel (Lead Developer),
Bipul Adhikari, Om Nepal, Sushant Aryal, and Suwan Aryal. Specific sub-roles
(database, frontend, and security testing) were shared across the team rather
than assigned to one person.

| Member | Role |
| --- | --- |
| Bibas Kandel | Lead Developer |
| Bipul Adhikari | Team member |
| Om Nepal | Team member |
| Sushant Aryal | Team member |
| Suwan Aryal | Team member |

## Feature ownership

The five feature groups (accounts/profile, events/search, seat holds/checkout,
reviews, and My Tickets/admin) were built collaboratively. Bibas Kandel
coordinated integration and packaging across all of them, and the team reviewed
the security demonstrations together.

## Vulnerability ownership

| ID | Intentional weakness | Location |
| --- | --- | --- |
| V01 | SQL injection | `events()` in `backend/ticketsenpai/__init__.py` |
| V02 | Stored XSS | `review()` and `frontend/app/events/[id]/page.js` |
| V03 | IDOR | `order()` |
| V04 | Predictable session tokens | `login()` and `auth()` |
| V05 | Plaintext passwords | `register()`, `login()`, and `db.py` |
| V06 | Traceback disclosure | `unexpected()` |

The team reproduces each proof using [the walkthrough](vulnerabilities.md).
⚠ SECURITY: authentication/session code needs a second teammate's review.
No claim of that human review is made by this package.

## Completion and remaining work

Implemented: five feature groups, six marked weaknesses, setup/dev commands,
automated checks, screenshots, five-page PDF, and source packaging.
Still pending: review the undownloaded Canvas guides, resolve any rubric differences,
and complete the second-person security review before peer testing.
