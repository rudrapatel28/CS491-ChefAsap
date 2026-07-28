"""
Seed a small, deterministic local dataset for guest-flow testing.

Creates one chef account, one customer account, and a couple of menu items so
the temporary guest harness can be used immediately after local bootstrap.
"""

from __future__ import annotations

import os

import psycopg2
from flask_bcrypt import Bcrypt

from config import db_config


bcrypt = Bcrypt()

DEFAULT_PASSWORD = 'QWEasd123!'


def _connect():
    return psycopg2.connect(**db_config)


def _upsert_user(cursor, email: str, password: str, user_type: str):
    hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
    cursor.execute(
        '''
        INSERT INTO users (email, password, user_type)
        VALUES (%s, %s, %s)
        ON CONFLICT (email) DO UPDATE
        SET password = EXCLUDED.password,
            user_type = EXCLUDED.user_type,
            updated_at = CURRENT_TIMESTAMP
        RETURNING id
        ''',
        (email, hashed_password, user_type),
    )
    return cursor.fetchone()[0]


def _upsert_chef(cursor):
    cursor.execute(
        '''
        INSERT INTO chefs (first_name, last_name, email, phone, description)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (email) DO UPDATE
        SET first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            phone = EXCLUDED.phone,
            description = EXCLUDED.description,
            updated_at = CURRENT_TIMESTAMP
        RETURNING id
        ''',
        (
            'Marcus',
            'Green',
            'chef1@gmail.com',
            '555-1000',
            'Local test chef for guest-flow validation.',
        ),
    )
    return cursor.fetchone()[0]


def _upsert_customer(cursor):
    cursor.execute(
        '''
        INSERT INTO customers (first_name, last_name, email, phone)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (email) DO UPDATE
        SET first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            phone = EXCLUDED.phone,
            updated_at = CURRENT_TIMESTAMP
        RETURNING id
        ''',
        ('Guest', 'Tester', 'customer1@gmail.com', '555-2000'),
    )
    return cursor.fetchone()[0]


def _ensure_cuisine(cursor, name: str):
    cursor.execute(
        '''
        INSERT INTO cuisine_types (name)
        VALUES (%s)
        ON CONFLICT (name) DO NOTHING
        ''',
        (name,),
    )


def _get_cuisine_id(cursor, name: str) -> int:
    cursor.execute('SELECT id FROM cuisine_types WHERE name = %s', (name,))
    return cursor.fetchone()[0]


def _insert_or_update_menu_item(cursor, chef_id: int, dish_name: str, description: str, cuisine_type: str, price: float, prep_time: int, display_order: int):
    cursor.execute(
        '''
        INSERT INTO chef_menu_items (
            chef_id, dish_name, description, cuisine_type, price, prep_time, display_order
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (chef_id, dish_name) DO UPDATE
        SET description = EXCLUDED.description,
            cuisine_type = EXCLUDED.cuisine_type,
            price = EXCLUDED.price,
            prep_time = EXCLUDED.prep_time,
            display_order = EXCLUDED.display_order,
            updated_at = CURRENT_TIMESTAMP
        RETURNING id
        ''',
        (chef_id, dish_name, description, cuisine_type, price, prep_time, display_order),
    )
    return cursor.fetchone()[0]


def seed_local_data() -> None:
    if os.getenv('DB_MODE', 'local').strip().lower() != 'local':
        print('DB_MODE is not local. Set DB_MODE=local before seeding local data.')
        return

    conn = None
    cursor = None

    try:
        conn = _connect()
        cursor = conn.cursor()

        _ensure_cuisine(cursor, 'Jamaican')
        _ensure_cuisine(cursor, 'Caribbean')

        chef_user_id = _upsert_user(cursor, 'chef1@gmail.com', DEFAULT_PASSWORD, 'chef')
        customer_user_id = _upsert_user(cursor, 'customer1@gmail.com', DEFAULT_PASSWORD, 'customer')

        chef_id = _upsert_chef(cursor)
        customer_id = _upsert_customer(cursor)

        cursor.execute('UPDATE users SET chef_id = %s WHERE id = %s', (chef_id, chef_user_id))
        cursor.execute('UPDATE users SET customer_id = %s WHERE id = %s', (customer_id, customer_user_id))

        jamaican_id = _get_cuisine_id(cursor, 'Jamaican')
        cursor.execute(
            '''
            INSERT INTO chef_cuisines (chef_id, cuisine_id)
            VALUES (%s, %s)
            ON CONFLICT (chef_id, cuisine_id) DO NOTHING
            ''',
            (chef_id, jamaican_id),
        )

        cursor.execute('DELETE FROM chef_service_areas WHERE chef_id = %s', (chef_id,))
        cursor.execute(
            '''
            INSERT INTO chef_service_areas (chef_id, city, state, zip_code, service_radius_miles)
            VALUES (%s, %s, %s, %s, %s)
            ''',
            (chef_id, 'Newark', 'NJ', '07102', 10),
        )

        cursor.execute('DELETE FROM chef_pricing WHERE chef_id = %s', (chef_id,))
        cursor.execute(
            '''
            INSERT INTO chef_pricing (chef_id, base_rate_per_person, produce_supply_extra_cost, minimum_people, maximum_people)
            VALUES (%s, %s, %s, %s, %s)
            ''',
            (chef_id, 35.00, 5.00, 1, 50),
        )

        item_one_id = _insert_or_update_menu_item(
            cursor,
            chef_id,
            'Jerk Chicken Bowl',
            'Spicy jerk chicken served with rice and peas.',
            'Jamaican',
            18.00,
            25,
            1,
        )
        item_two_id = _insert_or_update_menu_item(
            cursor,
            chef_id,
            'Rice and Peas',
            'Classic Jamaican side dish with coconut rice.',
            'Jamaican',
            8.00,
            15,
            2,
        )

        conn.commit()
        print('Seeded local test data successfully.')
        print(f'  Chef user id: {chef_user_id}, chef profile id: {chef_id}')
        print(f'  Customer user id: {customer_user_id}, customer profile id: {customer_id}')
        print(f'  Menu item ids: {item_one_id}, {item_two_id}')

    except Exception as exc:
        if conn:
            conn.rollback()
        raise RuntimeError(f'Failed to seed local data: {exc}') from exc
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


if __name__ == '__main__':
    seed_local_data()