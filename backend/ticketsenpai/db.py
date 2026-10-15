"""SQLite persistence, adapted from the mock's seat-per-row inventory."""
import sqlite3
from contextlib import contextmanager
from pathlib import Path


def connect(path: str) -> sqlite3.Connection:
    db = sqlite3.connect(path, timeout=10, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys = ON')
    return db


@contextmanager
def transaction(db: sqlite3.Connection):
    db.execute('BEGIN IMMEDIATE')
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise


def add_seats(db: sqlite3.Connection, event_id: int, base_price: int):
    # Geometry retained from src/seed.js: A=50, B=120, GA=100.
    rows = []
    for section, row_count, per_row, price in [('A', 5, 10, base_price + 9000), ('B', 10, 12, base_price)]:
        for row in range(1, row_count + 1):
            for number in range(1, per_row + 1):
                rows.append((f'{section}-{row}-{number}', event_id, section, row, number, price))
    rows.extend((f'GA-{n}', event_id, 'GA', None, None, base_price + 2500) for n in range(1, 101))
    db.executemany('INSERT INTO seats(id,event_id,section,row_number,seat_number,price_cents) VALUES(?,?,?,?,?,?)', rows)


def initialize(path: str):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = connect(path)
    try:
        db.execute('PRAGMA journal_mode = WAL')
        db.executescript(Path(__file__).with_name('schema.sql').read_text())
        with transaction(db):
            if db.execute('SELECT count(*) FROM users').fetchone()[0]:
                return
            # LAB V05: passwords deliberately stored in plaintext.
            db.executemany('INSERT INTO users(email,name,password,role) VALUES(?,?,?,?)', [
                ('alice@example.test', 'Alice', 'alice-demo', 'customer'),
                ('bob@example.test', 'Bob', 'bob-demo', 'customer'),
                ('admin@example.test', 'Senpai', 'admin-demo', 'admin'),
            ])
            events = [
                ('After Hours', 'The Midnight Assembly', 'Mock Arena · Chicago', '2027-03-20T20:00:00Z', 'Electronic', 'A late-night meeting of analog synths, deep bass, and a room full of people who know every word.', 9500, 1),
                ('Loud & Clear', 'Paper Satellites', 'Mock Arena · Chicago', '2027-04-09T19:00:00Z', 'Indie rock', 'Big guitars. Small moments. One unforgettable night with your next favorite band.', 6500, 1),
                ('Sunday Sessions', 'Yuki & The Blue Notes', 'Mock Arena · Chicago', '2027-05-16T18:00:00Z', 'Jazz', 'An intimate evening of new jazz, familiar melodies, and a little improvisation.', 4500, 1),
                ('Unannounced show', 'Secret Artist', 'Mock Arena · Chicago', '2027-06-01T20:00:00Z', 'Preview', 'Unpublished event used for the search-injection demonstration.', 5500, 0),
            ]
            for event in events:
                cursor = db.execute('INSERT INTO events(name,artist,venue,starts_at,genre,description,price_cents,published) VALUES(?,?,?,?,?,?,?,?)', event)
                add_seats(db, cursor.lastrowid, event[6])
            db.execute("INSERT INTO reviews(event_id,user_id,body,created_at) VALUES(1,2,'Been waiting all year for this lineup. See you on the floor!',1791849600)")
    finally:
        db.close()
