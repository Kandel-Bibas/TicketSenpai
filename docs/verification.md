# Submission verification

Verified October 15, 2026 on the current macOS host. This was a fresh temporary
checkout on the same computer, not a test on a second physical machine or Linux.

- `make check`: 65 reference Node tests and 20 Flask tests passed; Next.js production
  build succeeded.
- `make package`: ZIP CRCs and every archived file's bytes verified against source;
  SHA-256 companion generated.
- `python3 scripts/verify_submission.py`: extracted ZIP installed successfully,
  passed the full check, completed fresh/repeated setup and two dev start/stop
  cycles, rejected occupied ports, checked reset safeguards, and repackaged.
- PDF: five pages, three screenshots, all six vulnerability entries, generic
  team roles, and explicit disclosure of the unavailable Canvas guides. All five
  pages were rendered and visually inspected; the final purchase screenshot was
  re-rendered after replacement with a sharper capture.
- Temporary application servers stopped; nothing listened on ports 3000 or 5001
  after verification.

Browser execution of the harmless stored-XSS marker across two accounts was
verified during application implementation. The current packaging pass captured
the discovery, seat-map, and confirmed-ticket screenshots. Backend regression
tests rechecked all six vulnerable behaviors during the fresh-checkout run.

The Canvas Prompt Library and Vulnerability Implementation Guide remain
unreviewed because the user has not downloaded them. No independent teammate
security review or exact-rubric sign-off is claimed.
