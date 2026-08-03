"""
Shared helpers for generating, storing, and checking email verification codes.
Used by signup verification and (later) login 2FA.
"""

import hashlib
import secrets
from datetime import datetime, timedelta

CODE_TTL_MINUTES = 10
MAX_ATTEMPTS = 5
RESEND_COOLDOWN_SECONDS = 60


def _generate_code():
    return f"{secrets.randbelow(1000000):06d}"


def _hash_code(code):
    return hashlib.sha256(code.encode('utf-8')).hexdigest()


def create_verification_code(cursor, user_id, purpose):
    """Invalidates any existing code for this user+purpose, stores a new hashed one,
    and returns the plaintext code to send by email."""
    cursor.execute(
        'DELETE FROM verification_codes WHERE user_id = %s AND purpose = %s',
        (user_id, purpose)
    )
    code = _generate_code()
    now = datetime.utcnow()
    expires_at = now + timedelta(minutes=CODE_TTL_MINUTES)
    cursor.execute('''
        INSERT INTO verification_codes (user_id, code_hash, purpose, expires_at, attempts, created_at)
        VALUES (%s, %s, %s, %s, 0, %s)
    ''', (user_id, _hash_code(code), purpose, expires_at, now))
    return code


def get_active_code_row(cursor, user_id, purpose):
    cursor.execute('''
        SELECT id, code_hash, expires_at, attempts, created_at
        FROM verification_codes
        WHERE user_id = %s AND purpose = %s
    ''', (user_id, purpose))
    return cursor.fetchone()


def seconds_until_resend_allowed(existing_code_row):
    if not existing_code_row:
        return 0
    elapsed = (datetime.utcnow() - existing_code_row['created_at']).total_seconds()
    return max(0, int(RESEND_COOLDOWN_SECONDS - elapsed))


def verify_code(cursor, user_id, purpose, submitted_code):
    """Checks a submitted code against the stored one.
    Returns (ok, error) where error is one of:
    'no_code', 'too_many_attempts', 'expired', 'invalid_code', or None on success.
    On success, the code row is consumed (deleted). On a wrong guess, attempts is incremented.
    Caller is responsible for committing."""
    row = get_active_code_row(cursor, user_id, purpose)
    if not row:
        return False, 'no_code'

    if row['attempts'] >= MAX_ATTEMPTS:
        return False, 'too_many_attempts'

    if datetime.utcnow() > row['expires_at']:
        return False, 'expired'

    if _hash_code(submitted_code) != row['code_hash']:
        cursor.execute(
            'UPDATE verification_codes SET attempts = attempts + 1 WHERE id = %s',
            (row['id'],)
        )
        return False, 'invalid_code'

    cursor.execute('DELETE FROM verification_codes WHERE id = %s', (row['id'],))
    return True, None
