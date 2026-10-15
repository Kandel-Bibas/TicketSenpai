"""Explicitly reset TicketSenpai's local SQLite database, never the reference demo."""
from pathlib import Path
import socket
import sys
ROOT = Path(__file__).resolve().parent.parent
for port in (3000, 5001):
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(('127.0.0.1', port))
        except OSError:
            sys.exit('Stop the development servers before resetting data.')
path = ROOT / 'backend/instance/ticketsenpai.sqlite3'
for suffix in ('', '-wal', '-shm'):
    Path(str(path) + suffix).unlink(missing_ok=True)
sys.path.insert(0, str(ROOT / 'backend'))
from ticketsenpai.db import initialize
initialize(str(path))
print('Demo database reset and seeded.')
