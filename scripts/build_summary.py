"""Regenerate the five-page submission PDF using ReportLab (documentation only)."""
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'output/pdf/PROJECT_SUMMARY.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
styles = {
    'title': ParagraphStyle('title', fontName='Helvetica', fontSize=29, leading=34, spaceAfter=14),
    'heading': ParagraphStyle('heading', fontName='Helvetica', fontSize=16, leading=21, spaceBefore=15, spaceAfter=8),
    'body': ParagraphStyle('body', fontName='Helvetica', fontSize=10, leading=14, spaceAfter=9),
    'small': ParagraphStyle('small', fontName='Helvetica', fontSize=8.5, leading=12, textColor=colors.HexColor('#555555'), spaceAfter=9),
    'code': ParagraphStyle('code', fontName='Courier', fontSize=8.5, leading=12, backColor=colors.HexColor('#f2f2ef'), borderPadding=8, spaceBefore=7, spaceAfter=15),
}
story = []

def p(text, style='body'):
    story.append(Paragraph(text, styles[style]))

def code(text):
    p(escape(text).replace('\n', '<br/>'), 'code')

def screenshot(name, width, caption):
    im = Image(str(ROOT / 'docs/screenshots' / name))
    im.drawHeight *= width / im.drawWidth
    im.drawWidth = width
    story.extend([im, Spacer(1, 7)])
    p(caption, 'small')

def page(title):
    if story:
        story.append(PageBreak())
    p(title, 'title')

def footer(canvas, doc):
    canvas.setStrokeColor(colors.HexColor('#d5d5d0'))
    canvas.line(44, 42, 568, 42)
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(colors.HexColor('#666666'))
    canvas.drawString(44, 28, 'TicketSenpai | Milestone 1 | Team TicketSenpai | October 15, 2026')
    canvas.drawRightString(568, 28, str(doc.page))

page('TicketSenpai')
p('A concert-ticketing application for a local web-security capstone', 'heading')
p('Milestone 1 packages a working ticket-purchase flow with six intentional security weaknesses for controlled peer testing. All events, customer accounts, payments, and tickets are synthetic. The application reuses the existing ticketing concept and visual language in the required full-stack architecture.')
screenshot('events.png', 490, 'Figure 1. Event discovery at /events, captured from the running application.')
p('Architecture and scope', 'heading')
p('Browser / Next.js 16 + React 19 on port 3000 → same-origin /api proxy → Flask 3.1 on port 5001 → SQLite. Both development servers bind to 127.0.0.1. The original Node mock remains a separate reference; it is not the capstone API.')
p('Five feature groups: accounts and profiles; event discovery and search; seat holds and simulated checkout; persisted event reviews; customer tickets and administrator event management. Three published fictional shows and one draft are seeded automatically.')
p('State model: events own seats; users create holds, orders, reviews, and sessions. SQLite transactions and unique order-item constraints preserve inventory integrity while explicitly marked LAB V01-V06 paths remain vulnerable.', 'small')

page('The customer journey')
screenshot('seat-map.png', 490, 'Figure 2. Reserved-seat selection and general admission at /events/1 (scrolled view).')
p('Each show contains 50 premium, 120 standard, and 100 general-admission places. A customer may hold or buy up to six seats per show. Holds last eight minutes and restore after a reload. Approved checkout produces tickets; declined payment leaves the hold available for another attempt.')
screenshot('ticket.png', 490, 'Figure 3. A confirmed synthetic purchase in /tickets/1. Screenshots show demonstration data; the ZIP seeds a fresh database.')
p('Registration, login/logout, and profile editing are available. Reviews persist on event pages. The administrator can create, edit, publish, or hide shows. The interface supports light/dark themes, responsive layouts, and keyboard seat navigation.', 'small')

page('Vulnerability demonstrations')
p('V01 / SQL injection / A03 Injection', 'heading')
p('Location: backend/ticketsenpai/__init__.py, events(). Search interpolates user input into SQL LIKE expressions. In /events, search for the payload below; the unpublished Unannounced show appears alongside the three public shows. Its normal detail route still returns 404.')
code("') OR 1=1 -- ")
p('Impact: unauthorized event disclosure through query manipulation. Remediation: bind both LIKE parameters and preserve the publication predicate.')
p('V02 / Stored XSS / A03 Injection', 'heading')
p('Location: review() and frontend/app/events/[id]/page.js. HTML is stored unchanged and rendered with dangerouslySetInnerHTML. Sign in as Alice, post this review, then sign in as Bob and fully reload /events/1:')
code('<img src=x onerror="document.body.dataset.xss=\'verified\'">')
p('Evidence: evaluating document.body.dataset.xss returns verified under Bob\'s session. This harmless marker demonstrates persistent script execution. Impact: attacker-controlled JavaScript runs in another user\'s application context. Remediation: render plain text or apply an explicit HTML sanitization policy.')
p('V03 / IDOR / A01 Broken Access Control', 'heading')
p('Location: order() at GET /api/orders/&lt;id&gt;. As Alice, reserve and buy a seat. Record the resulting order ID. Sign in as Bob: My Tickets omits Alice\'s purchase, but visiting /tickets/&lt;Alice order ID&gt; reveals its customer name, seat, and ticket identifier.')
code('GET /api/orders/<Alice order ID>\nCookie: session=session-2')
p('Impact: cross-account order disclosure. An active Bob session and an existing Alice order are prerequisites. Remediation: query by both order ID and authenticated user ID and return 404 when ownership differs.')
p('Taxonomy: OWASP Top 10 (2021). SQL injection and XSS both map to A03; six weaknesses provide five primary categories. Full repeatable walkthroughs and source links are in docs/vulnerabilities.md.', 'small')

page('Authentication and disclosure')
p('V04 / Predictable sessions / A07', 'heading')
p('Location: login() and auth(). Login uses the deterministic token session-&lt;user ID&gt;, and there is no login lockout. First log in as Bob (bob@example.test / bob-demo); then use another client without logging in:')
code("curl -s http://127.0.0.1:3000/api/me \\\n  -H 'Cookie: session=session-2'")
p('Evidence: the response identifies Bob. The target session must be active; sessions expire after 24 hours and logout revokes them. Impact: impersonation by token prediction. Remediation: generate random session tokens, rotate on login, retain expiry/revocation, and throttle login attempts.')
p('V05 / Plaintext passwords / A02', 'heading')
p('Location: register(), login(), and backend/ticketsenpai/db.py. After make setup, inspect the local backend/instance/ticketsenpai.sqlite3 database:')
code('SELECT email, password FROM users ORDER BY id;')
p('Evidence: alice@example.test has readable password alice-demo; the other demo passwords are also readable. This standalone demonstration requires local database access, not an unauthenticated password endpoint. Impact: database disclosure reveals reusable credentials. Remediation: salted adaptive password hashing with migration or password resets.')
p('V06 / Traceback disclosure / A05', 'heading')
p('Location: unexpected(). Malformed search syntax produces a JSON traceback:')
code('curl --get --data-urlencode "q=\'broken" \\\n  http://127.0.0.1:3000/api/events')
p('Evidence: HTTP 500 with error.code = debug_error and error.traceback containing source paths and sqlite3.OperationalError. A lone apostrophe is not a reliable trigger. Impact: internal implementation details are exposed. Remediation: log exceptions server-side and return only an opaque error reference. The interactive Flask debugger is disabled.')
p('Security review: these weaknesses are deliberate. A second teammate should review authentication/session behavior and reproduce each proof before peer testing. Do not substitute real credentials or payment data.', 'small')

page('Delivery and team plan')
p('Run and verify', 'heading')
p('Prerequisites: Node.js 22+ with npm, Python 3.10+ with venv, and make. Supported workflow: macOS, Linux, or Windows via WSL. Dependency installation needs internet access; the running application does not.')
code('make setup\nmake dev\n# Open http://127.0.0.1:3000; Ctrl+C stops both servers.\nmake check\nmake smoke   # stop servers first; uses a temporary copy')
p('Demo logins: alice@example.test / alice-demo; bob@example.test / bob-demo; admin@example.test / admin-demo. Only the seeded administrator can manage events. make reset CONFIRM=reset reseeds local data after servers stop.', 'small')
p('Verification and development notes', 'heading')
p('On October 15, 2026, make check passed 65 reference Node tests, 20 Flask tests, and the Next.js production build. Flask coverage includes concurrency, expiry, idempotency, persistence, ownership boundaries, checkout failures, and the six vulnerable backend behaviors. Browser review separately verified stored XSS execution across users. Screenshots were captured from the running app.')
p('The existing Node domain behavior was ported into Flask and SQLite. Waiting-room control, crowd simulation, PSP outage recovery, and background payments remain outside this capstone. No real payment gateway is used. The source ZIP omits local databases, installed dependencies, build output, and active session data.')
p('Generic role assignments', 'heading')
p('Team Member 1 - Lead Developer: integration, setup workflow, and release checks.<br/>Team Member 2 - Database Designer: schema, seed data, holds, and persistence.<br/>Team Member 3 - Frontend Designer: pages, seat map, responsive and keyboard UX.<br/>Team Member 4 - Security Tester: PoCs, evidence, taxonomy, and peer-test handoff.')
p('These are placeholder role assignments, not a claim of completed individual contributions.', 'small')
p('Course-material alignment and remaining review', 'heading')
p('Reviewed the supplied Capstone Starter Template: Next.js + Flask + SQLite and separate frontend/backend directories align. TicketSenpai uses a package-based Flask API, port 5001, and a same-origin proxy instead of the starter\'s port 5000/CORS setup. The starter lists CSRF among examples; it does not establish a mandatory seventh weakness.')
p('The Canvas AI Prompt Library and Vulnerability Implementation Guide have not been downloaded and were not reviewed. Exact grading alignment, CSRF expectations, and acceptable password-storage evidence remain unverified. See docs/course-alignment.md for the evidence checklist. This package is ready for that final course-specific review.', 'small')

SimpleDocTemplate(str(OUT), pagesize=(612, 792), rightMargin=44, leftMargin=44,
                  topMargin=43, bottomMargin=53, title='TicketSenpai - Milestone 1',
                  author='Team TicketSenpai').build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
