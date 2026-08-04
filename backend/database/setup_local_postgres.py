"""
Bootstrap a local PostgreSQL database for ChefAsap.

This script creates the local database if it does not already exist and then
runs the existing schema initializer against that local database.
"""

from __future__ import annotations

import os

import psycopg2
from psycopg2 import sql

from config import db_config
from setup_postgres import init_postgres_db


def _database_name() -> str:
    return db_config['database']


def _admin_connection_kwargs() -> dict:
    return {
        'host': db_config['host'],
        'port': db_config['port'],
        'user': db_config['user'],
        'password': db_config['password'],
        'database': 'postgres',
        'sslmode': db_config.get('sslmode', 'disable'),
    }


def ensure_local_database_exists() -> None:
    target_database = _database_name()
    admin_conn = None
    admin_cursor = None

    try:
        admin_conn = psycopg2.connect(**_admin_connection_kwargs())
        admin_conn.autocommit = True
        admin_cursor = admin_conn.cursor()

        admin_cursor.execute('SELECT 1 FROM pg_database WHERE datname = %s', (target_database,))
        exists = admin_cursor.fetchone() is not None

        if exists:
            print(f"Local database '{target_database}' already exists.")
            return

        admin_cursor.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(target_database)))
        print(f"Created local database '{target_database}'.")

    finally:
        if admin_cursor:
            admin_cursor.close()
        if admin_conn:
            admin_conn.close()


def main() -> None:
    if os.getenv('DB_MODE', 'local').strip().lower() != 'local':
        print('DB_MODE is not local. Set DB_MODE=local before running this script.')
        return

    ensure_local_database_exists()
    init_postgres_db()
    print('Local database schema is ready.')


if __name__ == '__main__':
    main()