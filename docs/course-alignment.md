# Course-material alignment

Review date: October 15, 2026. This is an evidence checklist, not an assertion of
instructor approval or a grading score.

## Sources actually reviewed

- The October 13 capstone planning brief supplied for this project: required
  Next.js 14+, Flask 3.0+, SQLite; five feature groups; six weaknesses; source ZIP,
  README, and a 3–5-page PDF with screenshots and vulnerability demonstrations.
- `Capstone_Starter_Template.zip` and its extracted `capstone_starter_template`
  files in `Documents/CSC 414`: root README, backend scaffold, frontend manifest,
  and directory structure. The starter identifies itself as **CSC 489 - Web
  Application Security | Spring 2026**; the containing folder name is not used
  to infer the course or semester for this submission.
- TicketSenpai source, tests, README, and vulnerability walkthrough.

The user confirmed the **Canvas AI Prompt Library** and **Vulnerability
Implementation Guide** have not been downloaded. Neither was reviewed. The
starter also references a Canvas Quick Reference that was not supplied.

## Starter comparison

| Area | Starter | TicketSenpai | Assessment |
| --- | --- | --- | --- |
| Stack | Next.js 14.0.4, React 18, Flask, SQLite | Next.js 16.4, React 19.3, Flask 3.1.3, SQLite | Matches the planning brief's minimum stack |
| Structure | `frontend/app`, `backend/app.py` | `frontend/app`, `backend/run.py`, `backend/ticketsenpai` | Same frontend/backend split; backend organized as a package |
| Connectivity | Browser calls Flask on 5000 with CORS | Next.js `/api` proxy to Flask on 5001 | One browser origin for cookies; documented port difference |
| Prerequisites | Node 18+, Python 3.8+ | Node 22+, Python 3.10+, make | Higher prerequisites documented for current implementation |
| Accounts | Seeded admin; login stub | Three synthetic accounts, register/login/profile | Scaffold behavior replaced with implemented flows |
| Vulnerabilities | SQLi, XSS, CSRF, IDOR, etc. as examples | Six selected weaknesses; CSRF not included | Examples alone do not prove CSRF is required |

The app follows the starter's architecture; it was built before the starter was
located and is not represented as an unchanged copy of that scaffold.

## Evidence against the planning brief

| Requirement | Evidence | Status |
| --- | --- | --- |
| Required local stack | Manifests, SQLite schema, loopback dev supervisor | Implemented |
| Auth and profiles | `/register`, `/login`, `/profile`; lifecycle tests | Implemented |
| Browse/search | `/events`, `/events/[id]` | Implemented |
| State-changing purchase | Holds and checkout API; concurrency/replay tests | Implemented |
| User-generated content | Persisted event reviews | Implemented |
| Customer/admin dashboards | `/tickets`, `/tickets/[id]`, `/admin` | Implemented |
| Six intentional weaknesses | LAB V01–V06 and `docs/vulnerabilities.md` | Implemented and documented |
| SQLi/XSS/auth flaw | V01, V02, V03/V04 | Covered by selected demonstrations |
| Category breadth | A01, A02, A03, A05, A07 (OWASP 2021) | Five primary mappings; grading credit unverified |
| Generic team plan | `docs/team-plan.md` | Prepared |
| 3–5-page summary with screenshots | `PROJECT_SUMMARY.pdf` at ZIP root | Prepared |
| Source and README ZIP | `make package` | Prepared; generated DB/dependencies excluded |

## Remaining course-specific decisions

1. Read the actual Canvas guide to determine whether CSRF is mandatory, examples
   are prescribed, or different category mappings are expected.
2. Confirm local database access is acceptable evidence for V05. Do not describe
   it as an unauthenticated password endpoint.
3. Check any exact screenshot, AI-use disclosure, contribution, or submission
   naming requirements in Canvas. The generic team name is Team TicketSenpai.
4. Reproduce the PoCs with a second teammate before peer testing. The planning
   brief mentions later WSTG-based testing; this package does not claim a completed
   penetration-test assessment or checklist.

Correction to the planning brief: command injection is an A03 Injection issue,
not A05. It is not one of the six implemented weaknesses.
