# Security policy

TicketSenpai started as a web-application security capstone. Milestone 1
deliberately shipped six vulnerabilities for peer testing, and Milestone 3 fixed
all of them. We take reports about the current code seriously.

## Intended use

TicketSenpai is a **local learning project, not production software.**

- Both servers bind to `127.0.0.1` only.
- Use synthetic data only. Never enter real personal information or passwords
  you use elsewhere.
- Payments are simulated. No card data is collected, transmitted, or stored.

Deploying TicketSenpai to a network or the internet is unsupported.

## Supported versions

Only the latest commit on `main` receives security fixes.

| Version | Supported |
| --- | --- |
| `main` (Milestone 3 and later) | ✅ |
| Milestone 1 builds (intentionally vulnerable) | ❌ |

## Reporting a vulnerability

**Please do not open a public issue, discussion, or pull request for a
security problem.**

Report it privately through GitHub:

1. Go to the repository's [**Security** tab](https://github.com/Kandel-Bibas/TicketSenpai/security).
2. Click **Report a vulnerability** to open a private advisory.

If private reporting is not available, contact the maintainers privately through
the [repository owner's GitHub profile](https://github.com/Kandel-Bibas) and
ask for a private channel. Do not include details in the first message.

Please include:

- The affected file, route, or page, and the commit you tested.
- Steps to reproduce against a fresh local install (`make reset CONFIRM=reset`).
- The impact you were able to demonstrate.
- Any suggested fix.

### What to expect

| Step | We aim for |
| --- | --- |
| Acknowledgement of your report | Within 3 business days |
| Initial assessment | Within 7 days |
| Fix or mitigation plan for confirmed issues | Within 30 days |

This is a small volunteer-run project, so these are goals rather than guarantees. We will keep you updated, credit you in the fix (unless you prefer not to be
named), and coordinate disclosure with you.

### Rules of engagement

- Test only against **your own local instance**. Never test a copy that someone
  else runs.
- Use only the synthetic demo accounts or accounts you create.
- Do not run denial-of-service, load, or automated scanning tests against
  anything you do not own.

## Remediated vulnerabilities

These were intentional in Milestone 1 and are fixed. Each has a regression test
(`test_v01_*` to `test_v06_*` in `backend/tests/test_app.py`). Details and
verification steps are in the [remediation record](docs/vulnerabilities.md).

| ID | Weakness | OWASP Top 10 (2021) | Fix |
| --- | --- | --- | --- |
| V01 | SQL injection in event search | A03 Injection | Parameterized query |
| V02 | Stored XSS in reviews | A03 Injection | Reviews rendered as escaped React text |
| V03 | IDOR on order details | A01 Broken Access Control | Order lookups scoped to the signed-in user |
| V04 | Predictable session tokens | A07 Identification and Authentication Failures | `secrets.token_urlsafe(32)`, rotated on login |
| V05 | Plaintext password storage | A02 Cryptographic Failures | Salted scrypt hashes via werkzeug |
| V06 | Traceback disclosure | A05 Security Misconfiguration | Debug off, generic 500 body, server-side logging |

## Security model

| Area | Current behavior |
| --- | --- |
| Passwords | werkzeug `generate_password_hash` (scrypt, per-password salt) |
| Sessions | 32-byte random token in an `HttpOnly`, `SameSite=Strict` cookie; rotated on login; 24-hour expiry enforced server-side |
| Authorization | Every order and hold lookup is scoped by user; admin routes require the `admin` role |
| SQL | Bound parameters throughout |
| Output | User content rendered as text by React |
| Errors | Stable error codes; unexpected errors return a fixed message and are logged server-side |
| Input | JSON-only bodies capped at 32 KiB; length and type checks on every field |
| Network | Loopback binding; single origin through the Next.js proxy, no CORS |

## Known limitations

These are known and accepted for a local project. Reports about them are still
welcome if you find a way they lead to something worse.

- **No login throttling or lockout.** Repeated password guesses are not rate
  limited.
- **No password reset or email verification.**
- **No CSRF tokens.** Protection relies on `SameSite=Strict` cookies and
  JSON-only request bodies.
- **No security headers** such as Content-Security-Policy are configured.
- **Development servers only.** Both processes are development servers and are
  not hardened.
- **The reference mock** in `src/` is separate and mock-grade. Its `/admin/*`
  routes are unauthenticated, and `src/token.js` and `src/http/gateway.js` need
  review before reuse. See [reference-backend.md](docs/reference-backend.md#auth-model).

A second review of the authentication and session code is recommended before
any use beyond local coursework.
