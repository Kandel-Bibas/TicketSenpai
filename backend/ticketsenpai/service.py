"""Purchase rules: atomic holds, expiry, limits, and idempotent checkout."""
import json
import sqlite3
import uuid
from collections.abc import Callable


class Problem(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def event_for(db: sqlite3.Connection, event_id: int):
    # FIXED V06: reject out-of-range ids before the database so oversized input cannot raise an unhandled error.
    if not 1 <= event_id <= 9_223_372_036_854_775_807:
        raise Problem('event_not_found', 'This event does not exist.', 404)
    event = db.execute('SELECT * FROM events WHERE id=? AND published=1', (event_id,)).fetchone()
    if event is None:
        raise Problem('event_not_found', 'This event does not exist.', 404)
    return dict(event)


def expire_holds(db: sqlite3.Connection, now: int):
    db.execute("UPDATE seats SET status='available',hold_id=NULL WHERE status='held' AND hold_id IN (SELECT id FROM holds WHERE status='active' AND expires_at<=?)", (now,))
    db.execute("UPDATE holds SET status='expired' WHERE status='active' AND expires_at<=?", (now,))


def replay(db: sqlite3.Connection, user_id: int, scope: str, key: str, payload: dict, action: Callable):
    if not isinstance(key, str) or not 8 <= len(key) <= 100:
        raise Problem('idempotency_key_required', 'Supply an Idempotency-Key of 8–100 characters.')
    fingerprint = json.dumps(payload, sort_keys=True, separators=(',', ':'))
    prior = db.execute('SELECT * FROM idempotency WHERE user_id=? AND scope=? AND key=?', (user_id, scope, key)).fetchone()
    if prior:
        if prior['fingerprint'] != fingerprint:
            raise Problem('idempotency_key_reused', 'This key was already used for a different request.', 409)
        return json.loads(prior['response'])
    result = action()
    db.execute('INSERT INTO idempotency VALUES(?,?,?,?,?)', (user_id, scope, key, fingerprint, json.dumps(result)))
    return result


def create_hold(db: sqlite3.Connection, user_id: int, event_id: int, seat_ids: list[str], now: int):
    event_for(db, event_id)
    expire_holds(db, now)
    if not 1 <= len(seat_ids) <= 6 or len(set(seat_ids)) != len(seat_ids):
        raise Problem('invalid_selection', 'Choose 1–6 distinct seats.', 422)
    owned = db.execute('SELECT count(*) FROM order_items i JOIN orders o ON i.order_id=o.id WHERE o.user_id=? AND o.event_id=?', (user_id, event_id)).fetchone()[0]
    held = db.execute("SELECT count(*) FROM seats s JOIN holds h ON s.hold_id=h.id WHERE h.user_id=? AND h.event_id=? AND h.status='active'", (user_id, event_id)).fetchone()[0]
    if owned + held + len(seat_ids) > 6:
        raise Problem('seat_limit_exceeded', 'You may hold or buy up to six seats per event.', 422)
    seats = []
    for seat_id in seat_ids:
        seat = db.execute('SELECT * FROM seats WHERE event_id=? AND id=?', (event_id, seat_id)).fetchone()
        if seat is None:
            raise Problem('unknown_seat', f'Seat {seat_id} does not exist.', 422)
        if seat['status'] != 'available':
            raise Problem('seat_taken', f'Seat {seat_id} is no longer available. Choose again.', 409)
        seats.append(dict(seat))
    hold_id = str(uuid.uuid4())
    db.execute('INSERT INTO holds(id,user_id,event_id,expires_at) VALUES(?,?,?,?)', (hold_id, user_id, event_id, now + 480))
    db.executemany("UPDATE seats SET status='held',hold_id=? WHERE event_id=? AND id=?", [(hold_id, event_id, s) for s in seat_ids])
    return {'id': hold_id, 'event_id': event_id, 'expires_at': now + 480, 'seat_ids': seat_ids, 'total_cents': sum(s['price_cents'] for s in seats)}


def release_hold(db: sqlite3.Connection, user_id: int, hold_id: str):
    hold = db.execute('SELECT * FROM holds WHERE id=? AND user_id=?', (hold_id, user_id)).fetchone()
    if hold is None:
        raise Problem('hold_not_found', 'This hold does not exist.', 404)
    if hold['status'] == 'active':
        db.execute("UPDATE seats SET status='available',hold_id=NULL WHERE hold_id=? AND status='held'", (hold_id,))
        db.execute("UPDATE holds SET status='released' WHERE id=?", (hold_id,))
    return {'ok': True}


def read_order(db: sqlite3.Connection, order_id: int):
    row = db.execute('SELECT o.*,e.name event_name,e.venue,e.starts_at,u.name buyer_name FROM orders o JOIN events e ON e.id=o.event_id JOIN users u ON u.id=o.user_id WHERE o.id=?', (order_id,)).fetchone()
    if row is None:
        raise Problem('order_not_found', 'This order does not exist.', 404)
    order = dict(row)
    order['tickets'] = [dict(r) for r in db.execute('SELECT seat_id,barcode FROM order_items WHERE order_id=? ORDER BY seat_id', (order_id,))]
    return order


def checkout(db: sqlite3.Connection, user_id: int, hold_id: str, payment: str, now: int):
    expire_holds(db, now)
    hold = db.execute('SELECT * FROM holds WHERE id=? AND user_id=?', (hold_id, user_id)).fetchone()
    if hold is None:
        raise Problem('hold_not_found', 'This hold does not exist.', 404)
    if hold['status'] != 'active':
        raise Problem('hold_expired', 'This hold is expired or already used. Choose seats again.', 409)
    event_for(db, hold['event_id'])
    seats = db.execute("SELECT * FROM seats WHERE hold_id=? AND status='held'", (hold_id,)).fetchall()
    if not seats:
        raise Problem('hold_expired', 'The seats are no longer held.', 409)
    status = 'declined' if payment == 'decline' else 'confirmed'
    order_id = db.execute('INSERT INTO orders(user_id,event_id,hold_id,status,total_cents,created_at) VALUES(?,?,?,?,?,?)', (user_id, hold['event_id'], hold_id, status, sum(s['price_cents'] for s in seats), now)).lastrowid
    if status == 'confirmed':
        db.executemany('INSERT INTO order_items VALUES(?,?,?,?)', [(order_id, hold['event_id'], s['id'], str(uuid.uuid4())) for s in seats])
        db.execute("UPDATE seats SET status='sold' WHERE hold_id=?", (hold_id,))
        db.execute("UPDATE holds SET status='converted' WHERE id=?", (hold_id,))
    return read_order(db, order_id)
