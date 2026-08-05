"""
Transactional email sending via Resend.
"""

import os
import requests

RESEND_API_URL = 'https://api.resend.com/emails'

SUBJECTS = {
    'signup': 'Verify your ChefAsap account',
    'login_2fa': 'Your ChefAsap login code',
    'password_reset': 'Reset your ChefAsap password',
}


def send_email(to_email, subject, html):
    api_key = os.environ.get('RESEND_API_KEY')
    if not api_key:
        raise RuntimeError('RESEND_API_KEY is not set')

    from_address = os.environ.get('RESEND_FROM_EMAIL', 'onboarding@resend.dev')

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


def send_verification_email(to_email, code, purpose):
    subject = SUBJECTS.get(purpose, 'Your ChefAsap verification code')

    html = f'''
        <p>Your ChefAsap verification code is:</p>
        <h2 style="letter-spacing: 4px;">{code}</h2>
        <p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
    '''

    return send_email(to_email, subject, html)


def _format_date(value):
    return value.strftime('%B %d, %Y') if hasattr(value, 'strftime') else (value or '')


def _format_time(value):
    if hasattr(value, 'strftime'):
        return value.strftime('%I:%M %p').lstrip('0')
    return value or ''


def send_booking_confirmation_email(to_email, booking):
    """booking: dict with booking_date, booking_time, number_of_people, special_notes,
    total_cost/dynamic_price/base_price, chef_first_name, chef_last_name."""
    chef_name = f"{booking.get('chef_first_name') or ''} {booking.get('chef_last_name') or ''}".strip() or 'your chef'
    price = booking.get('total_cost') or booking.get('dynamic_price') or booking.get('base_price')

    html = f'''
        <p>Your booking with <strong>{chef_name}</strong> is confirmed!</p>
        <ul>
            <li>Date: {_format_date(booking.get('booking_date'))}</li>
            <li>Time: {_format_time(booking.get('booking_time'))}</li>
            <li>Party size: {booking.get('number_of_people')}</li>
            <li>Total paid: ${price}</li>
        </ul>
        {f"<p>Special notes: {booking['special_notes']}</p>" if booking.get('special_notes') else ''}
        <p>Thanks for booking with ChefAsap!</p>
    '''
    return send_email(to_email, 'Your ChefAsap booking is confirmed', html)


def send_completion_email(to_email, chef_name):
    chef_name = chef_name or 'Your chef'
    html = f'''
        <p><strong>{chef_name}</strong> has completed your order!</p>
        <p>We hope you enjoyed your meal. Don't forget to rate your chef in the app.</p>
    '''
    return send_email(to_email, f'{chef_name} has completed your order', html)


def send_rating_reminder_email(to_email, chef_name):
    chef_name = chef_name or 'your chef'
    html = f'''
        <p>How was your recent booking with <strong>{chef_name}</strong>?</p>
        <p>Take a moment to rate your chef in the ChefAsap app.</p>
    '''
    return send_email(to_email, f'Rate your experience with {chef_name}', html)
