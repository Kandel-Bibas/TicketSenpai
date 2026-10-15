# TicketSenpai vulnerability walkthrough

Six intentional weaknesses for the local coursework build. Test only the running
TicketSenpai instance at `http://127.0.0.1:3000`. `make test` checks the backend
behaviors against temporary databases; the XSS test below additionally verifies
browser execution. Vulnerable locations are marked `LAB V01` through `LAB V06`.

Use the OWASP Top 10 **2021** taxonomy required by the planning brief. Category
coverage is five primary mappings, not a guarantee of five rubric credits:
password storage overlaps authentication in OWASP, and course grading governs.

| ID | Weakness | Primary category | Code location |
| --- | --- | --- | --- |
| V01 | SQL injection | A03 Injection | `backend/ticketsenpai/__init__.py`, `events()` |
| V02 | Stored XSS | A03 Injection | `review()` and `frontend/app/events/[id]/page.js` |
| V03 | IDOR | A01 Broken Access Control | `order()` |
| V04 | Predictable sessions | A07 Identification and Authentication Failures | `login()` and `auth()` |
| V05 | Plaintext passwords | A02 Cryptographic Failures | `register()`, `login()`, and `db.py` seed |
| V06 | Traceback disclosure | A05 Security Misconfiguration | `unexpected()` |

## V01 SQL injection

Search ordinarily returns only published events. In `/events`, enter:

```text
') OR 1=1 -- 
```

The results include **Unannounced show**, whose `published` value is 0. Its normal
detail route still returns 404; the unauthorized disclosure occurs in search.
Alternatively, inspect the API response:

```sh
curl --get --data-urlencode "q=') OR 1=1 -- " http://127.0.0.1:3000/api/events
```

Cause: search text is interpolated into two LIKE expressions. Other database queries
use parameters. Fix: parameterize both LIKE values and retain the publication filter.
Evidence: baseline search returns three shows; the payload returns the draft too.

## V02 Stored XSS

1. Sign in as Alice and open `/events/1`.
2. Submit this review:

```html
<img src=x onerror="document.body.dataset.xss='verified'">
```

3. Sign out and sign in as Bob. Reload `/events/1`.
4. In browser developer tools, evaluate `document.body.dataset.xss`.

Expected result: `verified`. The value must appear after a full page reload under
Bob's session to distinguish stored execution from a prior DOM change. The broken
image request is an expected 404. This payload changes only an in-page marker.

Cause: HTML is stored unchanged and passed to `dangerouslySetInnerHTML`. Fix: render
reviews as React text, or sanitize through an explicitly approved HTML policy when
rich text is required. HttpOnly cookies do not prevent XSS from making authenticated
requests in the browser.

## V03 IDOR

1. Sign in as Alice, reserve a seat, and confirm a purchase.
2. Record the order number from `/tickets/<id>`.
3. Sign out and sign in as Bob. Bob's My Tickets list excludes Alice's order.
4. Visit the recorded `/tickets/<id>` directly.

Expected result: Bob sees Alice's name, purchased seat, and ticket identifier.
The backend requires a session but omits the ownership predicate on order detail.
Hold creation, release, and checkout still enforce ownership.
Fix: restrict the order query by both `id` and authenticated `user_id` and test that
Bob receives 404 for Alice's order.

## V04 Predictable session tokens

The session token is `session-<user id>`. A target must have an active session.
First create Bob's active session, then impersonate it without a login request from
the second client:

```sh
curl -s -X POST http://127.0.0.1:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"bob@example.test","password":"bob-demo"}'
curl -s http://127.0.0.1:3000/api/me -H 'Cookie: session=session-2'
```

Expected result: the second response identifies Bob. The seeded users have IDs
1 (Alice), 2 (Bob), and 3 (admin). Tokens expire in 24 hours and logout deletes the
session; the demonstration requires an active target. Login also lacks lockout.
Fix: generate cryptographically random session tokens, rotate them on login, retain
expiry/revocation, and apply suitable login throttling.

## V05 Plaintext password storage

From the project root after `make setup`:

```sh
backend/.venv/bin/python - <<'PY'
import sqlite3
from contextlib import closing
with closing(sqlite3.connect('backend/instance/ticketsenpai.sqlite3')) as db:
    for row in db.execute('SELECT email,password FROM users ORDER BY id'):
        print(row)
PY
```

Expected result: readable synthetic passwords, including `alice-demo`. This
standalone demonstration requires local database access; it does not claim an
unauthenticated password endpoint. SQL injection can compound database exposure.
Fix: use a salted, adaptive password hash and verify hashes on login; migrate or reset
existing passwords. Never use real credentials in this lab.

## V06 Traceback disclosure

```sh
curl --get --data-urlencode "q='broken" http://127.0.0.1:3000/api/events
```

Expected result: HTTP 500, `error.code` = `debug_error`, and `error.traceback`
containing Python frames, source paths, and `sqlite3.OperationalError`. A lone
apostrophe is not a reliable trigger for this particular SQLite expression.

Cause: the debug application returns `traceback.format_exc()` in its JSON error
handler. Flask's interactive debugger is disabled; executable-console access is not
part of this weakness. Fix: log exceptions server-side, return an opaque request ID,
and disable debug configuration outside local development.

## Verification and review

The automated suite verifies purchase persistence, active-hold restoration,
concurrent holds and checkout, all-or-nothing allocation, expiration, duplicate
requests, decline/retry, limits, input errors, account lifecycle, admin boundaries,
and all six backend vulnerability behaviors. Browser review additionally confirms
that stored HTML executes when a second user loads the event.

The six weaknesses are deliberately preserved. Unauthenticated administration,
client-supplied identity, inventory overselling, and payment-card collection are not
part of TicketSenpai's exercise. The original Node mock remains separate.

Review the authentication/session implementation with a second teammate. Compare
these demonstrations with the Canvas rubric before deciding whether the course
expects an additional CSRF exercise or different evidence for password storage.

## References

- [OWASP A01 Broken Access Control](https://top10.owasp.org/2021/A01_2021-Broken_Access_Control/)
- [OWASP A02 Cryptographic Failures](https://top10.owasp.org/2021/A02_2021-Cryptographic_Failures/)
- [OWASP A03 Injection](https://top10.owasp.org/2021/A03_2021-Injection/)
- [OWASP A05 Security Misconfiguration](https://top10.owasp.org/2021/A05_2021-Security_Misconfiguration/)
- [OWASP A07 Identification and Authentication Failures](https://top10.owasp.org/2021/A07_2021-Identification_and_Authentication_Failures/)
