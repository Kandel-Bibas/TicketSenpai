# TicketSenpai remediation record

Milestone 1 shipped six intentional weaknesses for peer testing. Milestone 2 testers
reported five of them (all except V05); all six are fixed in Milestone 3. This record lists each weakness, the
fix, and a command that confirms the original exploit is now blocked. Run the commands
only against the local instance at `http://127.0.0.1:3000`. The fixed code is marked
`FIXED V01` through `FIXED V06`.

`backend/tests/test_app.py` contains `test_v01_*` through `test_v06_*`. They are
regression tests that assert each exploit is blocked; `make test` runs them against
temporary databases.

The categories use the OWASP Top 10 **2021** taxonomy. Password storage overlaps
authentication in OWASP, so the five categories below are primary mappings.

| ID | Weakness | Primary category | Code location | Status |
| --- | --- | --- | --- | --- |
| V01 | SQL injection | A03 Injection | `backend/ticketsenpai/__init__.py`, `events()` | Fixed |
| V02 | Stored XSS | A03 Injection | `review()` and `frontend/app/events/[id]/page.js` | Fixed |
| V03 | IDOR | A01 Broken Access Control | `order()` and `service.py`, `read_order()` | Fixed |
| V04 | Predictable sessions | A07 Identification and Authentication Failures | `login()` and `auth()` | Fixed |
| V05 | Plaintext passwords | A02 Cryptographic Failures | `register()`, `login()`, and `db.py` seed | Fixed |
| V06 | Traceback disclosure | A05 Security Misconfiguration | `unexpected()`, `event_for()`, `read_order()` | Fixed |

## Upgrading from a Milestone 1 database

A database created by the Milestone 1 build still holds plaintext passwords (V05).
Demo logins then fail with "Email or password is incorrect." Stop both servers and run
`make reset CONFIRM=reset` to delete and reseed the local database. Fresh installs
are unaffected.

## V01 SQL injection

**Weakness.** Search text was interpolated into two LIKE expressions, so a crafted
query could change the SQL. The payload `') OR 1=1 -- ` returned the unpublished
**Unannounced show**, and a UNION payload could read other tables.

**Fix.** Both LIKE values and the offset are bound parameters. The publication filter
is unchanged.

```diff
-sql = f"SELECT * FROM events WHERE published=1 AND (name LIKE '%{query}%' OR artist LIKE '%{query}%') ORDER BY starts_at LIMIT 20 OFFSET {offset}"
-return {'items': [dict(row) for row in g.db.execute(sql)]}
+pattern = f'%{query}%'
+sql = "SELECT * FROM events WHERE published=1 AND (name LIKE ? OR artist LIKE ?) ORDER BY starts_at LIMIT 20 OFFSET ?"
+return {'items': [dict(row) for row in g.db.execute(sql, (pattern, pattern, offset))]}
```

**Verify it is blocked.** In `/events`, or through the API:

```sh
curl --get --data-urlencode "q=') OR 1=1 -- " http://127.0.0.1:3000/api/events
curl --get --data-urlencode "q=') UNION SELECT id, email, password, role, '2027-01-01T00:00:00Z', 'HACKED', name, 9900, 1 FROM users --" http://127.0.0.1:3000/api/events
```

Expected: both return `{"items": []}`. The payload is treated as a literal search
string that matches no event, and the draft event does not appear.

## V02 Stored XSS

**Weakness.** Review bodies were stored unchanged and rendered with
`dangerouslySetInnerHTML`, so HTML such as `<img src=x onerror=...>` executed in every
visitor's browser.

**Fix.** The event page renders the body as a React text node, which escapes HTML. The
backend still stores the body verbatim because it is data; escaping happens on output.

```diff
-<div dangerouslySetInnerHTML={{ __html: item.body }} />
+<div className="review-body">{item.body}</div>
```

**Verify it is blocked.**

1. Sign in as Alice and open `/events/1`.
2. Submit this review:

```html
<img src=x onerror="document.body.dataset.xss='verified'">
```

3. Sign out and sign in as Bob. Reload `/events/1`.
4. In browser developer tools, evaluate `document.body.dataset.xss`.

Expected: the review appears as literal text, no broken-image request is made, and
`document.body.dataset.xss` is `undefined`.

## V03 IDOR

**Weakness.** `GET /api/orders/<id>` required a session but did not check ownership, so
Bob could read Alice's order (name, seats, ticket identifiers) by id.

**Fix.** `read_order()` takes the requesting user's id and filters on it. A missing or
foreign order returns the same 404.

```diff
-def read_order(db, order_id):
-    row = db.execute('SELECT ... WHERE o.id=?', (order_id,)).fetchone()
+def read_order(db, order_id, user_id):
+    row = db.execute('SELECT ... WHERE o.id=? AND o.user_id=?', (order_id, user_id)).fetchone()
```

The route now calls `read_order(g.db, order_id, g.user['id'])`.

**Verify it is blocked.**

1. Sign in as Alice, reserve a seat, and confirm a purchase.
2. Record the order number from `/tickets/<id>`.
3. Sign out and sign in as Bob.
4. Visit the recorded `/tickets/<id>`, or request `/api/orders/<id>` with Bob's session.

Expected: Bob receives 404 with `error.code` = `order_not_found`. Alice requesting the
same order receives 200.

## V04 Predictable session tokens

**Weakness.** The session token was `session-<user id>`, so anyone could impersonate a
user with an active session by setting that cookie.

**Fix.** Login issues `secrets.token_urlsafe(32)` and deletes the user's previous
sessions, so each login rotates the token. Tokens still expire after 24 hours and logout
deletes the session.

```diff
-token = f'session-{user["id"]}'
-g.db.execute('INSERT OR REPLACE INTO sessions VALUES(?,?,?)', (token, user['id'], now() + 86400))
+g.db.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))
+token = secrets.token_urlsafe(32)
+g.db.execute('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)', (token, user['id'], now() + 86400))
```

**Verify it is blocked.** Create Bob's active session, then try the old predictable
token from a second client:

```sh
curl -s -X POST http://127.0.0.1:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"bob@example.test","password":"bob-demo"}'
curl -s -i http://127.0.0.1:3000/api/me -H 'Cookie: session=session-2'
```

Expected: the second response is HTTP 401. `session-3` (admin) and other
`session-<id>` guesses also return 401. The real cookie set by the login response is a
43-character random string.

**Known limitation.** Login throttling and lockout are not implemented, so repeated
password guesses are not rate limited. This was not among the reported findings.

## V05 Plaintext password storage

**Weakness.** Passwords were stored and compared as plaintext, so any read access to the
database exposed every credential.

**Fix.** Registration and the seed data store `generate_password_hash(password)`
(werkzeug, scrypt with a per-password salt). Login loads the row by email and verifies
with `check_password_hash`.

```diff
-g.db.execute('INSERT INTO users(email,name,password) VALUES(?,?,?)', (address, name, password))
+g.db.execute('INSERT INTO users(email,name,password) VALUES(?,?,?)', (address, name, generate_password_hash(password)))
```

```diff
-user = g.db.execute('SELECT id,email,name,role FROM users WHERE email=? AND password=?', (address, password)).fetchone()
+row = g.db.execute('SELECT id,email,name,role,password FROM users WHERE email=?', (address,)).fetchone()
+if row is None or not check_password_hash(row['password'], password):
```

**Verify it is blocked.** On a fresh or reset database, from the project root after
`make setup`:

```sh
backend/.venv/bin/python - <<'PY'
import sqlite3
from contextlib import closing
with closing(sqlite3.connect('backend/instance/ticketsenpai.sqlite3')) as db:
    for row in db.execute('SELECT email,password FROM users ORDER BY id'):
        print(row)
PY
```

Expected: every password value starts with `scrypt:` and none equals `alice-demo`,
`bob-demo`, or `admin-demo`. The demo logins still succeed. A database created by the
Milestone 1 build must be reset first; see the upgrade note above.

## V06 Traceback disclosure

**Weakness.** `DEBUG=True` and the JSON error handler returned `traceback.format_exc()`,
exposing Python frames, source paths, and exception types. The testers triggered it with
an oversized event id that SQLite could not bind.

**Fix.** `DEBUG=False` in the app config and in `backend/run.py`, which `make dev`
starts. The handler logs the exception server-side and returns a fixed
body. `event_for()` and `read_order()` also reject ids outside 1..2^63-1 with 404 before
the query runs.

```diff
-return jsonify(error={'code': 'debug_error', 'message': str(error), 'traceback': traceback.format_exc()}), 500
+return jsonify(error={'code': 'internal_error', 'message': 'Something went wrong on our end.'}), 500
```

**Verify it is blocked.**

```sh
curl -s -i http://127.0.0.1:3000/api/events/99999999999999999999999999999
```

Expected: HTTP 404 with `event_not_found`, and no traceback. Any other unexpected
error returns HTTP 500 with only
`{"error": {"code": "internal_error", "message": "Something went wrong on our end."}}`;
the detail appears in the Flask server log, not the response.

## Scope

Unauthenticated administration, client-supplied identity, inventory overselling, and
payment-card collection were never part of the exercise. The original Node mock remains
separate.

## References

- [OWASP A01 Broken Access Control](https://top10.owasp.org/2021/A01_2021-Broken_Access_Control/)
- [OWASP A02 Cryptographic Failures](https://top10.owasp.org/2021/A02_2021-Cryptographic_Failures/)
- [OWASP A03 Injection](https://top10.owasp.org/2021/A03_2021-Injection/)
- [OWASP A05 Security Misconfiguration](https://top10.owasp.org/2021/A05_2021-Security_Misconfiguration/)
- [OWASP A07 Identification and Authentication Failures](https://top10.owasp.org/2021/A07_2021-Identification_and_Authentication_Failures/)
