"""TicketSenpai: deliberately vulnerable, localhost-only coursework application."""
import re
import secrets
import sqlite3
import time
import traceback
from datetime import datetime
from pathlib import Path
from functools import wraps
from flask import Flask, g, jsonify, request
from werkzeug.exceptions import HTTPException
from .db import connect, initialize, transaction, add_seats
from .service import Problem, event_for, expire_holds, replay, create_hold, release_hold, checkout, read_order


def create_app(database: str | None = None, clock=None):
    app = Flask(__name__)
    app.config.update(DEBUG=False, MAX_CONTENT_LENGTH=32_768)
    path = database or str(Path(__file__).parent.parent / 'instance' / 'ticketsenpai.sqlite3')
    initialize(path)
    now = clock or (lambda: int(time.time()))

    @app.before_request
    def open_database():
        g.db = connect(path)

    @app.teardown_request
    def close_database(error):
        db = g.pop('db', None)
        if db is not None:
            db.close()

    @app.errorhandler(Problem)
    def problem(error):
        return jsonify(error={'code': error.code, 'message': error.message}), error.status

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error={'code': error.name.lower().replace(' ', '_'), 'message': error.description}), error.code

    @app.errorhandler(Exception)
    def unexpected(error):
        app.logger.exception('Unhandled API error')
        # FIXED V06: log details server-side only; return an opaque error to the client.
        return jsonify(error={'code': 'internal_error', 'message': 'Something went wrong on our end.'}), 500

    def auth(admin=False):
        def decorate(fn):
            @wraps(fn)
            def wrapped(*args, **kwargs):
                row = g.db.execute('SELECT u.id,u.email,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?', (request.cookies.get('session'), now())).fetchone()
                if row is None:
                    raise Problem('unauthenticated', 'Please sign in to continue.', 401)
                g.user = dict(row)
                if admin and g.user['role'] != 'admin':
                    raise Problem('forbidden', 'Administrator access is required.', 403)
                return fn(*args, **kwargs)
            return wrapped
        return decorate

    def body():
        data = request.get_json()
        if not isinstance(data, dict):
            raise Problem('invalid_request', 'Send a JSON object.')
        return data

    def text(data, name, maximum=200):
        value = data.get(name)
        if not isinstance(value, str) or not value.strip() or len(value) > maximum:
            raise Problem('invalid_request', f'{name} must contain 1–{maximum} characters.', 422)
        return value.strip()

    def email(data):
        value = text(data, 'email').lower()
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
            raise Problem('invalid_email', 'Enter a valid email address.', 422)
        return value

    def page():
        try:
            value = int(request.args.get('page', '1'))
        except ValueError:
            raise Problem('invalid_page', 'Page must be a positive integer.')
        if not 1 <= value <= 10000:
            raise Problem('invalid_page', 'Page must be between 1 and 10000.')
        return (value - 1) * 20

    @app.get('/api/health')
    def health():
        return {'ok': True, 'name': 'TicketSenpai'}

    @app.post('/api/register')
    def register():
        data = body()
        address, name, password = email(data), text(data, 'name', 80), text(data, 'password', 100)
        if len(password) < 8:
            raise Problem('weak_password', 'Use at least eight characters.', 422)
        with transaction(g.db):
            if g.db.execute('SELECT id FROM users WHERE email=?', (address,)).fetchone():
                raise Problem('email_taken', 'This email already has an account.', 409)
            # LAB V05: plaintext storage intentionally replaces password hashing.
            g.db.execute('INSERT INTO users(email,name,password) VALUES(?,?,?)', (address, name, password))
        return {'ok': True}, 201

    @app.post('/api/login')
    def login():
        data = body()
        address, password = email(data), text(data, 'password', 100)
        with transaction(g.db):
            user = g.db.execute('SELECT id,email,name,role FROM users WHERE email=? AND password=?', (address, password)).fetchone()
            if user is None:
                raise Problem('invalid_credentials', 'Email or password is incorrect.', 401)
            # FIXED V04: issue a cryptographically random token and rotate it on every login.
            g.db.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))
            token = secrets.token_urlsafe(32)
            g.db.execute('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)', (token, user['id'], now() + 86400))
        response = jsonify(dict(user))
        response.set_cookie('session', token, httponly=True, samesite='Strict', max_age=86400)
        return response

    @app.post('/api/logout')
    def logout():
        g.db.execute('DELETE FROM sessions WHERE token=?', (request.cookies.get('session'),))
        response = jsonify(ok=True)
        response.delete_cookie('session')
        return response

    @app.get('/api/me')
    @auth()
    def me():
        return g.user

    @app.patch('/api/me')
    @auth()
    def profile():
        name = text(body(), 'name', 80)
        g.db.execute('UPDATE users SET name=? WHERE id=?', (name, g.user['id']))
        return {**g.user, 'name': name}

    @app.get('/api/events')
    def events():
        query = request.args.get('q', '')
        if len(query) > 300:
            raise Problem('invalid_search', 'Search must be 300 characters or fewer.')
        offset = page()
        # FIXED V01: parameterized query; user input is bound as data and can never alter the SQL.
        pattern = f'%{query}%'
        sql = "SELECT * FROM events WHERE published=1 AND (name LIKE ? OR artist LIKE ?) ORDER BY starts_at LIMIT 20 OFFSET ?"
        return {'items': [dict(row) for row in g.db.execute(sql, (pattern, pattern, offset))]}

    @app.get('/api/events/<int:event_id>')
    def event(event_id):
        with transaction(g.db):
            details = event_for(g.db, event_id)
            expire_holds(g.db, now())
            details['seats'] = [dict(row) for row in g.db.execute('SELECT id,section,row_number,seat_number,price_cents,status FROM seats WHERE event_id=? ORDER BY section,row_number,seat_number', (event_id,))]
        return details

    @app.get('/api/events/<int:event_id>/reviews')
    def reviews(event_id):
        event_for(g.db, event_id)
        return {'items': [dict(row) for row in g.db.execute('SELECT r.id,r.body,r.created_at,u.name FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.event_id=? ORDER BY r.id DESC LIMIT 20 OFFSET ?', (event_id, page()))]}

    @app.post('/api/events/<int:event_id>/reviews')
    @auth()
    def review(event_id):
        event_for(g.db, event_id)
        content = text(body(), 'body', 2000)
        # LAB V02: HTML is persisted unchanged and rendered as HTML by the frontend.
        row_id = g.db.execute('INSERT INTO reviews(event_id,user_id,body,created_at) VALUES(?,?,?,?)', (event_id, g.user['id'], content, now())).lastrowid
        return {'id': row_id}, 201

    @app.post('/api/events/<int:event_id>/holds')
    @auth()
    def hold(event_id):
        data = body()
        ids = data.get('seat_ids')
        if not isinstance(ids, list) or not all(isinstance(s, str) and 1 <= len(s) <= 30 for s in ids):
            raise Problem('invalid_selection', 'seat_ids must be a list of seat identifiers.', 422)
        with transaction(g.db):
            result = replay(g.db, g.user['id'], f'hold:{event_id}', request.headers.get('Idempotency-Key'), data, lambda: create_hold(g.db, g.user['id'], event_id, ids, now()))
        return result, 201

    @app.get('/api/events/<int:event_id>/hold')
    @auth()
    def active_hold(event_id):
        with transaction(g.db):
            event_for(g.db, event_id)
            expire_holds(g.db, now())
            row = g.db.execute("SELECT * FROM holds WHERE event_id=? AND user_id=? AND status='active' ORDER BY expires_at DESC LIMIT 1", (event_id, g.user['id'])).fetchone()
            if row is None:
                return {'hold': None}
            seats = g.db.execute('SELECT id,price_cents FROM seats WHERE hold_id=?', (row['id'],)).fetchall()
            return {'hold': {'id': row['id'], 'event_id': event_id, 'expires_at': row['expires_at'], 'seat_ids': [s['id'] for s in seats], 'total_cents': sum(s['price_cents'] for s in seats)}}

    @app.delete('/api/holds/<hold_id>')
    @auth()
    def release(hold_id):
        with transaction(g.db):
            return release_hold(g.db, g.user['id'], hold_id)

    @app.post('/api/orders')
    @auth()
    def purchase():
        data = body()
        hold_id = text(data, 'hold_id', 100)
        payment = text(data, 'payment', 20)
        if payment not in ('approve', 'decline'):
            raise Problem('invalid_payment', 'Choose approve or decline for the simulated payment.', 422)
        with transaction(g.db):
            result = replay(g.db, g.user['id'], 'checkout', request.headers.get('Idempotency-Key'), data, lambda: checkout(g.db, g.user['id'], hold_id, payment, now()))
        return result, 201

    @app.get('/api/orders')
    @auth()
    def orders():
        ids = g.db.execute('SELECT id FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 20 OFFSET ?', (g.user['id'], page())).fetchall()
        return {'items': [read_order(g.db, row['id'], g.user['id']) for row in ids]}

    @app.get('/api/orders/<int:order_id>')
    @auth()
    def order(order_id):
        # FIXED V03: scope the lookup to the signed-in user so one customer cannot read another's order.
        return read_order(g.db, order_id, g.user['id'])

    def event_data(data):
        fields = {k: text(data, k, 2000 if k == 'description' else 200) for k in ('name', 'artist', 'venue', 'starts_at', 'genre', 'description')}
        try:
            date = datetime.fromisoformat(fields['starts_at'].replace('Z', '+00:00'))
            if date.tzinfo is None:
                raise ValueError()
        except ValueError:
            raise Problem('invalid_date', 'starts_at must be an ISO date with a timezone.', 422)
        price = data.get('price_cents')
        if type(price) is not int or not 100 <= price <= 1000000:
            raise Problem('invalid_price', 'price_cents must be an integer from 100 to 1000000.', 422)
        published = data.get('published', True)
        if type(published) is not bool:
            raise Problem('invalid_published', 'published must be true or false.', 422)
        return {**fields, 'price_cents': price, 'published': int(published)}

    @app.get('/api/admin/events')
    @auth(admin=True)
    def admin_events():
        return {'items': [dict(r) for r in g.db.execute('SELECT * FROM events ORDER BY id DESC LIMIT 20 OFFSET ?', (page(),))]}

    @app.post('/api/admin/events')
    @auth(admin=True)
    def create_event():
        fields = event_data(body())
        with transaction(g.db):
            event_id = g.db.execute('INSERT INTO events(name,artist,venue,starts_at,genre,description,price_cents,published) VALUES(?,?,?,?,?,?,?,?)', tuple(fields.values())).lastrowid
            add_seats(g.db, event_id, fields['price_cents'])
        return {'id': event_id}, 201

    @app.put('/api/admin/events/<int:event_id>')
    @auth(admin=True)
    def edit_event(event_id):
        fields = event_data(body())
        with transaction(g.db):
            existing = g.db.execute('SELECT * FROM events WHERE id=?', (event_id,)).fetchone()
            if existing is None:
                raise Problem('event_not_found', 'This event does not exist.', 404)
            expire_holds(g.db, now())
            price_changed = existing['price_cents'] != fields['price_cents']
            if price_changed and g.db.execute("SELECT 1 FROM seats WHERE event_id=? AND status!='available'", (event_id,)).fetchone():
                raise Problem('price_locked', 'Prices cannot change after seats are held or sold.', 409)
            g.db.execute('UPDATE events SET name=?,artist=?,venue=?,starts_at=?,genre=?,description=?,price_cents=?,published=? WHERE id=?', (*fields.values(), event_id))
            if price_changed:
                g.db.execute("UPDATE seats SET price_cents=? + CASE section WHEN 'A' THEN 9000 WHEN 'GA' THEN 2500 ELSE 0 END WHERE event_id=?", (fields['price_cents'], event_id))
        return {'id': event_id}

    return app
