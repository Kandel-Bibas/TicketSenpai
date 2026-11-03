"""Prove clean setup, repeatable setup, dev startup, port checks, and shutdown."""
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
PORTS = (3000, 5001)


def available():
    for port in PORTS:
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind(('127.0.0.1', port))


def ready():
    for url in ('http://127.0.0.1:5001/api/health', 'http://127.0.0.1:3000/api/health'):
        with urllib.request.urlopen(url, timeout=2) as response:
            if response.status != 200:
                raise AssertionError(f'{url} returned {response.status}')


available()
with tempfile.TemporaryDirectory(prefix='ticketsenpai-workflow-') as directory:
    checkout = Path(directory)
    for name in ('backend', 'frontend', 'scripts'):
        shutil.copytree(ROOT / name, checkout / name, ignore=shutil.ignore_patterns('.venv', 'node_modules', '.next', 'instance', '__pycache__'))
    shutil.copy2(ROOT / 'Makefile', checkout / 'Makefile')
    for attempt in range(2):
        subprocess.run(['make', 'setup'], cwd=checkout, check=True)
    for attempt in range(2):
        with tempfile.TemporaryFile(mode='w+') as log:
            process = subprocess.Popen(['make', 'dev'], cwd=checkout, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                deadline = time.monotonic() + 45
                while True:
                    if process.poll() is not None:
                        log.seek(0)
                        raise AssertionError('make dev exited early:\n' + log.read())
                    try:
                        ready()
                        break
                    except (OSError, urllib.error.URLError):
                        if time.monotonic() > deadline:
                            log.seek(0)
                            raise AssertionError('Servers did not become ready:\n' + log.read())
                        time.sleep(.2)
                conflict = subprocess.run(['make', 'dev'], cwd=checkout, capture_output=True, text=True)
                if conflict.returncode == 0 or 'already in use' not in conflict.stderr:
                    raise AssertionError('Occupied ports were not rejected clearly.')
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGINT)
                process.wait(timeout=10)
            available()
            print(f'Dev cycle {attempt + 1}: both servers ready; occupied ports rejected; Ctrl+C released both ports.', flush=True)
    guarded = subprocess.run(['make', 'reset'], cwd=checkout, capture_output=True)
    if guarded.returncode == 0:
        raise AssertionError('Database reset must require CONFIRM=reset.')
    subprocess.run(['make', 'reset', 'CONFIRM=reset'], cwd=checkout, check=True)
print('Fresh setup, repeated setup, immediate restart, shutdown, and reset checks passed.')
