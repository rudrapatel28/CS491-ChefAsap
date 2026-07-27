from __future__ import annotations

import importlib
from datetime import date, datetime, time
from decimal import Decimal
from unittest import TestCase
from unittest.mock import patch

from app import app


auth_mod = importlib.import_module('blueprints.auth_bp')
booking_mod = importlib.import_module('blueprints.booking_bp')
order_mod = importlib.import_module('blueprints.order_bp')


class FakeCursor:
    def __init__(self, handlers, dictionary=False):
        self.handlers = handlers
        self.dictionary = dictionary
        self.fetchone_result = None
        self.fetchall_result = []

    def execute(self, sql, params=None):
        for predicate, response in self.handlers:
            if predicate(sql, params):
                self.fetchone_result = response.get('fetchone')
                self.fetchall_result = response.get('fetchall', [])
                return
        raise AssertionError(f'No handler for SQL: {sql!r} params={params!r}')

    def fetchone(self):
        return self.fetchone_result

    def fetchall(self):
        return self.fetchall_result

    def close(self):
        pass


class FakeConn:
    def __init__(self, handlers):
        self.handlers = handlers
        self.commits = 0
        self.rollbacks = 0
        self.closed = 0

    def cursor(self, cursor_factory=None):
        return FakeCursor(self.handlers, dictionary=cursor_factory is not None)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closed += 1


def _auth_handlers():
    return [
        (lambda sql, params: 'SELECT * FROM guests WHERE email' in sql, {'fetchone': None}),
        (lambda sql, params: 'SELECT * FROM guests WHERE phone' in sql, {'fetchone': None}),
        (lambda sql, params: 'INSERT INTO guests' in sql, {'fetchone': {
            'id': 7,
            'guest_code': 'guest-code-7',
            'first_name': 'Guest',
            'last_name': 'One',
            'email': 'guest@example.com',
            'phone': '555-1000',
        }}),
    ]


def _booking_create_handlers():
    return [
        (lambda sql, params: 'SELECT id FROM guests WHERE id = %s' in sql, {'fetchone': {'id': 7}}),
        (lambda sql, params: 'INSERT INTO bookings' in sql, {'fetchone': (42,)}),
    ]


def _booking_dashboard_handlers():
    today = date.today()
    return [
        (lambda sql, params: 'b.booking_date < %s' in sql, {'fetchall': [{
            'booking_id': 1,
            'booking_date': date(2026, 6, 1),
            'booking_time': time(18, 30),
            'status': 'completed',
            'cuisine_type': 'Jamaican',
            'meal_type': 'dinner',
            'event_type': 'birthday',
            'number_of_people': 10,
            'total_cost': Decimal('220.50'),
            'chef_id': 9,
            'chef_first_name': 'Marcus',
            'chef_last_name': 'Green',
            'chef_photo': None,
            'guest_first_name': 'Guest',
            'guest_last_name': 'One',
            'created_at': datetime(2026, 6, 1, 10, 0, 0),
        }]}),
        (lambda sql, params: 'b.booking_date = %s' in sql, {'fetchall': [{
            'booking_id': 2,
            'booking_date': today,
            'booking_time': time(12, 0),
            'status': 'pending',
            'cuisine_type': 'Italian',
            'meal_type': 'lunch',
            'event_type': 'lunch',
            'number_of_people': 4,
            'total_cost': Decimal('80.00'),
            'chef_id': 10,
            'chef_first_name': 'Ava',
            'chef_last_name': 'Stone',
            'chef_photo': None,
            'guest_first_name': 'Guest',
            'guest_last_name': 'One',
            'created_at': datetime(2026, 7, 26, 9, 0, 0),
        }]}),
        (lambda sql, params: 'b.booking_date > %s' in sql, {'fetchall': [{
            'booking_id': 3,
            'booking_date': date(2026, 12, 25),
            'booking_time': time(19, 0),
            'status': 'confirmed',
            'cuisine_type': 'Mexican',
            'meal_type': 'dinner',
            'event_type': 'holiday',
            'number_of_people': 12,
            'total_cost': Decimal('300.00'),
            'chef_id': 11,
            'chef_first_name': 'Lena',
            'chef_last_name': 'Cruz',
            'chef_photo': None,
            'guest_first_name': 'Guest',
            'guest_last_name': 'One',
            'created_at': datetime(2026, 7, 26, 9, 0, 0),
        }]}),
    ]


def _order_create_handlers():
    return [
        (lambda sql, params: 'SELECT id FROM guests WHERE id = %s' in sql, {'fetchone': {'id': 7}}),
        (lambda sql, params: 'SELECT prep_time FROM chef_menu_items WHERE id = %s' in sql and params == (501,), {'fetchone': (15,)}),
        (lambda sql, params: 'SELECT prep_time FROM chef_menu_items WHERE id = %s' in sql and params == (502,), {'fetchone': (30,)}),
        (lambda sql, params: 'INSERT INTO orders' in sql, {'fetchone': (88, datetime(2026, 7, 26, 15, 45, 0))}),
        (lambda sql, params: 'INSERT INTO order_items' in sql, {'fetchone': None}),
    ]


def _order_guest_handlers():
    return [
        (lambda sql, params: 'FROM orders o' in sql and 'WHERE o.guest_id = %s' in sql, {'fetchall': [{
            'order_id': 88,
            'order_date': datetime(2026, 7, 26, 15, 45, 0),
            'delivery_datetime': datetime(2026, 7, 27, 18, 0, 0),
            'status': 'pending',
            'total_amount': Decimal('95.00'),
            'estimated_prep_time': 30,
            'delivery_address': '123 Test St',
            'special_instructions': 'Ring bell',
            'chef_first_name': 'Marcus',
            'chef_last_name': 'Green',
            'chef_photo': None,
            'item_count': 2,
        }]}),
    ]


class GuestRouteTests(TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_guest_signup_returns_guest_identity(self):
        with patch.object(auth_mod, 'get_db_connection', side_effect=lambda: FakeConn(_auth_handlers())), \
             patch.object(auth_mod, 'get_cursor', side_effect=lambda conn, dictionary=True: conn.cursor()):
            response = self.client.post(
                '/auth/guest',
                json={
                    'firstName': 'Guest',
                    'lastName': 'One',
                    'email': 'guest@example.com',
                    'phone': '555-1000',
                },
            )

        self.assertEqual(response.status_code, 201)
        payload = response.get_json()
        self.assertEqual(payload['guest_id'], 7)
        self.assertEqual(payload['user_type'], 'guest')
        self.assertTrue(payload['token'])

    def test_guest_booking_and_dashboard(self):
        with patch.object(booking_mod, 'get_db_connection', side_effect=lambda: FakeConn(_booking_create_handlers())), \
             patch.object(booking_mod, 'get_cursor', side_effect=lambda conn, dictionary=True: conn.cursor()):
            response = self.client.post(
                '/booking/create',
                json={
                    'guest_id': 7,
                    'cuisine_type': 'Jamaican',
                    'meal_type': 'dinner',
                    'booking_date': '2026-12-25',
                    'booking_time': '18:30',
                    'number_of_people': 10,
                    'special_notes': 'All good',
                },
            )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json()['booking_id'], 42)

        with patch.object(booking_mod, 'get_db_connection', side_effect=lambda: FakeConn(_booking_dashboard_handlers())), \
             patch.object(booking_mod, 'get_cursor', side_effect=lambda conn, dictionary=True: conn.cursor()):
            response = self.client.get('/booking/guest/7/dashboard')

        self.assertEqual(response.status_code, 200)
        dashboard = response.get_json()['data']
        self.assertEqual(len(dashboard['previous_bookings']), 1)
        self.assertEqual(len(dashboard['todays_bookings']), 1)
        self.assertEqual(len(dashboard['upcoming_bookings']), 1)
        self.assertEqual(dashboard['previous_bookings'][0]['total_cost'], 220.5)

    def test_guest_order_creation_and_history(self):
        with patch.object(order_mod, 'get_db_connection', side_effect=lambda: FakeConn(_order_create_handlers())), \
             patch.object(order_mod, 'get_cursor', side_effect=lambda conn, dictionary=True: conn.cursor()):
            response = self.client.post(
                '/api/orders/create',
                json={
                    'guest_id': 7,
                    'chef_id': 3,
                    'order_items': [
                        {'menu_item_id': 501, 'quantity': 2, 'unit_price': 15, 'dish_name': 'Rice Bowl'},
                        {'menu_item_id': 502, 'quantity': 1, 'unit_price': 20, 'dish_name': 'Soup'},
                    ],
                    'delivery_address': '123 Test St',
                    'special_instructions': 'Ring bell',
                    'delivery_datetime': '2026-07-27T18:00:00',
                },
            )

        self.assertEqual(response.status_code, 201)
        payload = response.get_json()
        self.assertEqual(payload['order_id'], 88)
        self.assertEqual(payload['estimated_prep_time'], 30)

        with patch.object(order_mod, 'get_db_connection', side_effect=lambda: FakeConn(_order_guest_handlers())), \
             patch.object(order_mod, 'get_cursor', side_effect=lambda conn, dictionary=True: conn.cursor()):
            response = self.client.get('/api/orders/guest/7')

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload['count'], 1)
        self.assertEqual(payload['orders'][0]['chef_name'], 'Marcus Green')
        self.assertEqual(payload['orders'][0]['total_amount'], 95.0)