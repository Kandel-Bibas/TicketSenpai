"""Run both local servers; stop both on Ctrl+C or if either server exits."""
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent.parent
python = ROOT / 'backend/.venv/bin/python'
if not python.exists() or not (ROOT / 'frontend/node_modules/next').exists():
    sys.exit('Dependencies are missing. Run make setup first.')
for port in (3000, 5001):
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(('127.0.0.1', port))
        except OSError:
            sys.exit(f'Port {port} is already in use. Stop that process before running make dev.')
processes = []
exit_code = 0

def stop(signum, frame):
    raise KeyboardInterrupt

signal.signal(signal.SIGTERM, stop)
try:
    processes.append(subprocess.Popen([str(python), 'run.py'], cwd=ROOT / 'backend', start_new_session=True))
    processes.append(subprocess.Popen(['npm', 'run', 'dev'], cwd=ROOT / 'frontend', start_new_session=True))
    print('\nTicketSenpai → http://127.0.0.1:3000\nPress Ctrl+C to stop both servers.\n', flush=True)
    while all(process.poll() is None for process in processes):
        time.sleep(.25)
    exit_code = next((p.returncode for p in processes if p.returncode is not None), 1) or 1
    print('A server exited. Stopping the other server.', file=sys.stderr)
except KeyboardInterrupt:
    pass
finally:
    for process in processes:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    for process in processes:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
sys.exit(exit_code)
