"""Public HTTP tests for purchase correctness and the six intentional weaknesses."""
import concurrent.futures
import sqlite3
import tempfile
import unittest
import uuid
from contextlib import closing
from pathlib import Path
from ticketsenpai import create_app


class TicketSenpaiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / 'test.sqlite3')
        self.time = 1800000000
        self.app = create_app(self.path, clock=lambda: self.time)
        self.app.logger.disabled = True
        self.client = self.login('alice')

    def tearDown(self):
        self.temp.cleanup()

    def login(self, name):
        client = self.app.test_client()
        result = client.post('/api/login', json={'email': f'{name}@example.test', 'password': f'{name}-demo'})
        self.assertEqual(result.status_code, 200)
        return client

    def hold(self, seats=None, client=None, key=None, event=1):
        return (client or self.client).post(f'/api/events/{event}/holds', json={'seat_ids': seats or ['A-1-1']}, headers={'Idempotency-Key': key or str(uuid.uuid4())})

    def buy(self, hold, client=None, payment='approve', key=None):
        return (client or self.client).post('/api/orders', json={'hold_id': hold['id'], 'payment': payment}, headers={'Idempotency-Key': key or str(uuid.uuid4())})

    def test_purchase_persists_and_issues_ticket(self):
        hold = self.hold().get_json()
        order = self.buy(hold).get_json()
        self.assertEqual(order['status'], 'confirmed')
        self.assertEqual(order['total_cents'], 18500)
        self.assertEqual(order['tickets'][0]['seat_id'], 'A-1-1')
        restarted = create_app(self.path, clock=lambda: self.time).test_client()
        restarted.set_cookie('session', 'session-1')
        self.assertEqual(restarted.get('/api/orders').get_json()['items'][0]['id'], order['id'])
        seats = restarted.get('/api/events/1').get_json()['seats']
        self.assertEqual(next(s for s in seats if s['id'] == 'A-1-1')['status'], 'sold')

    def test_concurrent_hold_has_exactly_one_winner(self):
        bob = self.login('bob')
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda client: self.hold(client=client).status_code, [self.client, bob]))
        self.assertEqual(sorted(results), [201, 409])

    def test_overlapping_hold_rolls_back_every_seat(self):
        self.hold(['A-1-1'])
        bob = self.login('bob')
        self.assertEqual(self.hold(['A-1-2', 'A-1-1'], client=bob).status_code, 409)
        self.assertEqual(self.hold(['A-1-2'], client=bob).status_code, 201)

    def test_expired_hold_cannot_buy_and_seat_is_reusable(self):
        old = self.hold().get_json()
        self.time += 480
        self.assertEqual(self.buy(old).status_code, 409)
        self.assertEqual(self.hold(client=self.login('bob')).status_code, 201)

    def test_concurrent_checkout_replays_one_order(self):
        hold = self.hold().get_json()
        other = self.app.test_client()
        other.set_cookie('session', 'session-1')
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda c: self.buy(hold, client=c, key='same-order-key').get_json(), [self.client, other]))
        self.assertEqual(results[0]['id'], results[1]['id'])
        self.assertEqual(len(self.client.get('/api/orders').get_json()['items']), 1)

    def test_idempotency_replay_and_mismatch(self):
        one = self.hold(key='same-hold-key').get_json()
        two = self.hold(key='same-hold-key').get_json()
        self.assertEqual(one, two)
        self.assertEqual(self.hold(['A-1-2'], key='same-hold-key').status_code, 409)
        self.assertEqual(self.client.post('/api/events/1/holds', json={'seat_ids': ['B-1-1']}).status_code, 400)

    def test_decline_then_retry(self):
        hold = self.hold().get_json()
        declined = self.buy(hold, payment='decline', key='declined-key').get_json()
        self.assertEqual(declined['status'], 'declined')
        self.assertEqual(declined['tickets'], [])
        self.assertEqual(self.buy(hold, payment='decline', key='declined-key').get_json()['id'], declined['id'])
        self.assertEqual(self.buy(hold).get_json()['status'], 'confirmed')
        self.assertEqual(self.buy(hold).status_code, 409)

    def test_hold_ownership_stays_enforced(self):
        hold = self.hold().get_json()
        bob = self.login('bob')
        self.assertEqual(self.buy(hold, client=bob).status_code, 404)
        self.assertEqual(bob.delete(f'/api/holds/{hold["id"]}').status_code, 404)
        self.assertEqual(self.client.delete(f'/api/holds/{hold["id"]}').status_code, 200)
        self.assertEqual(self.client.delete(f'/api/holds/{hold["id"]}').status_code, 200)
        self.assertEqual(self.hold(client=bob).status_code, 201)

    def test_active_hold_restores_after_restart_and_is_owner_filtered(self):
        hold = self.hold().get_json()
        restarted = create_app(self.path, clock=lambda: self.time).test_client()
        restarted.set_cookie('session', 'session-1')
        self.assertEqual(restarted.get('/api/events/1/hold').get_json()['hold'], hold)
        self.assertIsNone(self.login('bob').get('/api/events/1/hold').get_json()['hold'])
        self.time += 480
        self.assertIsNone(restarted.get('/api/events/1/hold').get_json()['hold'])

    def test_limits_include_active_holds_and_purchases(self):
        hold = self.hold([f'A-1-{n}' for n in range(1, 7)]).get_json()
        self.assertEqual(self.hold(['A-1-7']).status_code, 422)
        self.buy(hold)
        self.assertEqual(self.hold(['A-1-7']).status_code, 422)

    def test_invalid_inputs_have_specific_errors(self):
        for seats in [[], ['A-1-1', 'A-1-1'], ['missing'], [1], [f'A-1-{n}' for n in range(1, 8)]]:
            response = self.client.post('/api/events/1/holds', json={'seat_ids': seats}, headers={'Idempotency-Key': str(uuid.uuid4())})
            self.assertEqual(response.status_code, 422, response.get_json())
        self.assertEqual(self.client.post('/api/orders', json=[]).status_code, 400)
        self.assertEqual(self.client.get('/api/events?page=no').status_code, 400)
        self.assertEqual(self.client.post('/api/login', data='{', content_type='application/json').status_code, 400)
        self.assertEqual(self.client.get('/api/events/999').status_code, 404)
        self.assertEqual(self.client.get('/api/missing').status_code, 404)

    def test_registration_profile_and_logout(self):
        client = self.app.test_client()
        fields = {'email': 'new@example.test', 'password': 'password-demo', 'name': 'New User', 'role': 'admin'}
        self.assertEqual(client.post('/api/register', json=fields).status_code, 201)
        self.assertEqual(client.post('/api/register', json=fields).status_code, 409)
        client.post('/api/login', json=fields)
        self.assertEqual(client.get('/api/me').get_json()['role'], 'customer')
        self.assertEqual(client.patch('/api/me', json={'name': 'Changed', 'role': 'admin'}).get_json()['name'], 'Changed')
        client.post('/api/logout')
        self.assertEqual(client.get('/api/me').status_code, 401)

    def test_session_expiry_and_admin_boundary(self):
        self.assertEqual(self.client.get('/api/admin/events').status_code, 403)
        self.time += 86400
        self.assertEqual(self.client.get('/api/me').status_code, 401)
        self.assertEqual(self.app.test_client().get('/api/orders/1').status_code, 401)

    def test_admin_create_edit_and_price_lock(self):
        admin = self.login('admin')
        fields = {'name': 'New show', 'artist': 'A band', 'venue': 'A venue', 'starts_at': '2027-07-01T20:00:00Z', 'genre': 'Rock', 'description': 'A show.', 'price_cents': 6000, 'published': True}
        result = admin.post('/api/admin/events', json=fields)
        self.assertEqual(result.status_code, 201)
        event_id = result.get_json()['id']
        self.assertEqual(len(self.client.get(f'/api/events/{event_id}').get_json()['seats']), 270)
        fields['price_cents'] = 7000
        self.assertEqual(admin.put(f'/api/admin/events/{event_id}', json=fields).status_code, 200)
        hold = self.hold(event=event_id).get_json()
        self.assertEqual(hold['total_cents'], 16000)
        fields['price_cents'] = 8000
        self.assertEqual(admin.put(f'/api/admin/events/{event_id}', json=fields).status_code, 409)
        fields['price_cents'] = 7000
        fields['published'] = False
        self.assertEqual(admin.put(f'/api/admin/events/{event_id}', json=fields).status_code, 200)
        self.assertEqual(self.client.get(f'/api/events/{event_id}').status_code, 404)
        self.assertEqual(self.buy(hold).status_code, 404)

    def test_v01_sqli_exposes_unpublished_event(self):
        baseline = self.client.get('/api/events').get_json()['items']
        self.assertEqual(len(baseline), 3)
        result = self.client.get('/api/events', query_string={'q': "') OR 1=1 -- "})
        self.assertEqual(result.status_code, 200)
        self.assertTrue(any(event['published'] == 0 for event in result.get_json()['items']))

    def test_v02_stored_html_reaches_other_user(self):
        payload = '<img src=x onerror="document.body.dataset.xss=\'verified\'">'
        self.assertEqual(self.client.post('/api/events/1/reviews', json={'body': payload}).status_code, 201)
        bob = self.login('bob')
        self.assertEqual(bob.get('/api/events/1/reviews').get_json()['items'][0]['body'], payload)

    def test_v03_idor_while_list_is_owner_filtered(self):
        order = self.buy(self.hold().get_json()).get_json()
        bob = self.login('bob')
        self.assertEqual(bob.get('/api/orders').get_json()['items'], [])
        stolen = bob.get(f'/api/orders/{order["id"]}')
        self.assertEqual(stolen.status_code, 200)
        self.assertEqual(stolen.get_json()['buyer_name'], 'Alice')

    def test_v04_predictable_session_impersonates_active_user(self):
        self.login('bob')
        attacker = self.app.test_client()
        attacker.set_cookie('session', 'session-2')
        self.assertEqual(attacker.get('/api/me').get_json()['email'], 'bob@example.test')

    def test_v05_plaintext_password_storage(self):
        with closing(sqlite3.connect(self.path)) as db:
            password = db.execute("SELECT password FROM users WHERE email='alice@example.test'").fetchone()[0]
        self.assertEqual(password, 'alice-demo')

    def test_v06_traceback_disclosure(self):
        result = self.client.get('/api/events', query_string={'q': "'broken"})
        self.assertEqual(result.status_code, 500)
        error = result.get_json()['error']
        self.assertEqual(error['code'], 'debug_error')
        self.assertIn('Traceback', error['traceback'])
        self.assertIn('sqlite3.OperationalError', error['traceback'])


if __name__ == '__main__':
    unittest.main()
