"""
Transactional email sending via Resend.
"""

import os
import requests

RESEND_API_URL = 'https://api.resend.com/emails'

SUBJECTS = {
    'signup': 'Verify your ChefAsap account',
    'login_2fa': 'Your ChefAsap login code',
}


def send_verification_email(to_email, code, purpose):
    api_key = os.environ.get('RESEND_API_KEY')
    if not api_key:
        raise RuntimeError('RESEND_API_KEY is not set')

    from_address = os.environ.get('RESEND_FROM_EMAIL', 'onboarding@resend.dev')
    subject = SUBJECTS.get(purpose, 'Your ChefAsap verification code')

    html = f'''
        <p>Your ChefAsap verification code is:</p>
        <h2 style="letter-spacing: 4px;">{code}</h2>
        <p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
    '''

    response = requests.post(
        RESEND_API_URL,
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
        },
        json={
            'from': from_address,
            'to': to_email,
            'subject': subject,
            'html': html,
        },
        timeout=10,
    )
    response.raise_for_status()
    return response.json()
