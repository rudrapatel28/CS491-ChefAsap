from flask import Blueprint, request, jsonify
from flask_bcrypt import Bcrypt
import jwt
import re
import uuid
from datetime import datetime, timedelta, timezone
from database.config import db_config
from database.db_helper import get_db_connection, get_cursor, handle_db_error
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.geocoding_service import geocoding_service

def validate_email(email):
    email_regex = r'^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(email_regex, email))

def validate_password(password):
    """Validate password meets requirements"""
    if len(password) < 8:
        return False, "Password must be at least 8 characters"
    if not re.search(r'[A-Z]', password):
        return False, "Password must contain at least one uppercase letter"
    if not re.search(r'[0-9]', password):
        return False, "Password must contain at least one number"
    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        return False, "Password must contain at least one special character"
    return True, "Password is valid"

def serialize_guest(guest_row):
    return {
        'guest_id': guest_row['id'],
        'guest_code': guest_row['guest_code'],
        'first_name': guest_row.get('first_name'),
        'last_name': guest_row.get('last_name'),
        'email': guest_row.get('email'),
        'phone': guest_row.get('phone'),
        'created_at': guest_row.get('created_at'),
        'updated_at': guest_row.get('updated_at'),
    }

# Create the blueprint
auth_bp = Blueprint('auth', __name__)
bcrypt = Bcrypt()

JWT_SECRET = os.environ.get('JWT_SECRET_KEY', 'your-secret-key')

@auth_bp.route('/signup', methods=['POST'])
def signup():
    print('\n=== Signup Request Received ===\n')
    conn = None
    cursor = None
    try:
        data = request.get_json()
        first_name = data.get('firstName')
        last_name = data.get('lastName')
        email = data.get('email')
        password = data.get('password')
        user_type = data.get('user_type')  # 'chef' or 'customer'
        phone = data.get('phone')
        address = data.get('address')
        address2 = data.get('address2', '')  # Optional field
        city = data.get('city')
        state = data.get('state')
        zip_code = data.get('zip')

        # Validate input
        if not all([first_name, last_name, email, password, user_type, phone, address, city, state, zip_code]):
            return jsonify({'error': 'Missing required fields'}), 400
            
        if not validate_email(email):
            return jsonify({'error': 'Invalid email format'}), 400
        
        if user_type not in ['chef', 'customer']:
            return jsonify({'error': 'Invalid user type'}), 400

      
        is_valid, msg = validate_password(password)
        if not is_valid:
            return jsonify({'error': msg}), 400

        # Hash password
        hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')

       
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True)

        # Check if email already exists
        cursor.execute('SELECT id FROM users WHERE email = %s', (email,))
        if cursor.fetchone():
            return jsonify({'error': 'Email already registered'}), 409

        # PostgreSQL: INSERT with RETURNING
        cursor.execute('''
            INSERT INTO users (email, password, user_type)
            VALUES (%s, %s, %s) RETURNING id
        ''', (email, hashed_password, user_type))
        user_id = cursor.fetchone()['id']
        
        # Create chef or customer profile based on user type
        if user_type == 'chef':
            # Insert into chefs table with RETURNING
            cursor.execute('''
                INSERT INTO chefs (first_name, last_name, email, phone)
                VALUES (%s, %s, %s, %s) RETURNING id
            ''', (first_name, last_name, email, phone))
            chef_id = cursor.fetchone()['id']
            
            # Update user with chef_id
            cursor.execute('''
                UPDATE users SET chef_id = %s WHERE id = %s
            ''', (chef_id, user_id))
            
            # Get coordinates from address
            full_address = f"{address}, {city}, {state} {zip_code}"
            geocode_result = geocoding_service.geocode_address(full_address)
            # geocode_result returns (latitude, longitude) tuple or None
            if geocode_result:
                latitude, longitude = geocode_result
            else:
                latitude, longitude = None, None
            
            # Insert chef address with coordinates
            cursor.execute('''
                INSERT INTO chef_addresses (chef_id, address_line1, address_line2, city, state, zip_code, latitude, longitude, is_default)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ''', (chef_id, address, address2, city, state, zip_code, latitude, longitude, True))
            
        elif user_type == 'customer':
            # Insert into customers table with RETURNING
            cursor.execute('''
                INSERT INTO customers (first_name, last_name, email, phone)
                VALUES (%s, %s, %s, %s) RETURNING id
            ''', (first_name, last_name, email, phone))
            customer_id = cursor.fetchone()['id']
            
            # Update user with customer_id
            cursor.execute('''
                UPDATE users SET customer_id = %s WHERE id = %s
            ''', (customer_id, user_id))
            
            # Get coordinates from address
            full_address = f"{address}, {city}, {state} {zip_code}"
            geocode_result = geocoding_service.geocode_address(full_address)
            # geocode_result returns (latitude, longitude) tuple or None
            if geocode_result:
                latitude, longitude = geocode_result
            else:
                latitude, longitude = None, None
            
            # Insert customer address with coordinates
            cursor.execute('''
                INSERT INTO customer_addresses (customer_id, address_line1, address_line2, city, state, zip_code, latitude, longitude, is_default)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ''', (customer_id, address, address2, city, state, zip_code, latitude, longitude, True))
        
        conn.commit()
        
        print(f'\nNew user signed up - Email: {email}, Type: {user_type}, ID: {user_id}\n')

        print(f">>> Signing with JWT_SECRET: '{JWT_SECRET[:10]}...'")

        # Generate JWT token
        token = jwt.encode({
            'user_id': user_id,
            'email': email,
            'user_type': user_type,
            'exp': datetime.utcnow() + timedelta(days=1)
        }, JWT_SECRET, algorithm='HS256')

        print(f">>> Generated token: '{token[:30]}...'")
        return jsonify({
            'message': 'User registered successfully',
            'token': token,
            'user_type': user_type
        }), 201

    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

@auth_bp.route('/signin', methods=['POST'])
def signin():
    conn = None
    cursor = None
    try:
        # Check if request has JSON data
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Email and password are required'}), 400
            
        email = data.get('email')
        password = data.get('password')

        # Validate input fields
        if not email or not password:
            return jsonify({'error': 'Email and password are required'}), 400
            
        # Clean and validate email
        email = email.strip().lower()
        if not email:
            return jsonify({'error': 'Email cannot be empty'}), 400
            
        if not validate_email(email):
            return jsonify({'error': 'Invalid email format'}), 400
            
        # Validate password
        if len(password.strip()) == 0:
            return jsonify({'error': 'Password cannot be empty'}), 400

        
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True)

        # Get user
        cursor.execute('SELECT * FROM users WHERE email = %s', (email,))
        user = cursor.fetchone()

        if not user or not bcrypt.check_password_hash(user['password'], password):
            return jsonify({'error': 'Invalid email or password'}), 401

        # Generate JWT token
        token = jwt.encode({
            'user_id': user['id'],
            'email': user['email'],
            'user_type': user['user_type'],
            'exp': datetime.utcnow() + timedelta(days=1)
        }, JWT_SECRET, algorithm='HS256')

        print(f'\nUser signed in - Email: {user["email"]}, Type: {user["user_type"]}, ID: {user["id"]}')
        print(f'Chef ID: {user["chef_id"]}, Customer ID: {user["customer_id"]}\n')
        
        profile_id = user['chef_id'] if user['user_type'] == 'chef' else user['customer_id']
        print(f'Returning profile_id: {profile_id}')
        
        response_data = {
            'message': 'Login successful',
            'token': token,
            'user_type': user['user_type'],
            'user_id': user['id'],
            'profile_id': profile_id,
        }
        print(f'Response data: {response_data}')
        
        return jsonify(response_data), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@auth_bp.route('/guest', methods=['POST'])
def create_or_lookup_guest():
    """Create or reuse a guest account using contact details."""
    conn = None
    cursor = None
    try:
        data = request.get_json() or {}
        first_name = (data.get('firstName') or data.get('first_name') or '').strip()
        last_name = (data.get('lastName') or data.get('last_name') or '').strip()
        email = (data.get('email') or '').strip().lower()
        phone = (data.get('phone') or '').strip()

        if not email and not phone:
            return jsonify({'error': 'Either email or phone is required for a guest account'}), 400

        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True)

        guest = None
        created = False
        if email:
            cursor.execute('SELECT * FROM guests WHERE email = %s ORDER BY id DESC LIMIT 1', (email,))
            guest = cursor.fetchone()
        if not guest and phone:
            cursor.execute('SELECT * FROM guests WHERE phone = %s ORDER BY id DESC LIMIT 1', (phone,))
            guest = cursor.fetchone()

        if guest:
            update_fields = []
            update_values = []
            if first_name and first_name != (guest.get('first_name') or ''):
                update_fields.append('first_name = %s')
                update_values.append(first_name)
            if last_name and last_name != (guest.get('last_name') or ''):
                update_fields.append('last_name = %s')
                update_values.append(last_name)
            if email and email != (guest.get('email') or ''):
                update_fields.append('email = %s')
                update_values.append(email)
            if phone and phone != (guest.get('phone') or ''):
                update_fields.append('phone = %s')
                update_values.append(phone)

            if update_fields:
                update_fields.append('updated_at = CURRENT_TIMESTAMP')
                update_values.append(guest['id'])
                cursor.execute(
                    f"UPDATE guests SET {', '.join(update_fields)} WHERE id = %s RETURNING *",
                    tuple(update_values)
                )
                guest = cursor.fetchone()
        else:
            guest_code = str(uuid.uuid4())
            cursor.execute('''
                INSERT INTO guests (guest_code, first_name, last_name, email, phone)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING *
            ''', (guest_code, first_name or None, last_name or None, email or None, phone or None))
            guest = cursor.fetchone()
            created = True

        conn.commit()

        token = jwt.encode({
            'guest_id': guest['id'],
            'guest_code': guest['guest_code'],
            'user_type': 'guest',
            'exp': datetime.now(timezone.utc) + timedelta(days=1)
        }, JWT_SECRET, algorithm='HS256')

        payload = serialize_guest(guest)
        payload.update({
            'message': 'Guest account ready',
            'token': token,
            'user_type': 'guest',
        })
        return jsonify(payload), 201 if created else 200

    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@auth_bp.route('/profile', methods=['GET'])
def get_user_profile():
    """Get user profile information including chef or customer details"""
    conn = None
    cursor = None
    try:
        # Get user_id from query parameter
        user_id = request.args.get('user_id')
        if not user_id:
            return jsonify({'error': 'user_id is required'}), 400

        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True)

        # Get user information with linked profile
        cursor.execute('''
            SELECT u.id as user_id, u.email, u.user_type, u.chef_id, u.customer_id,
                   u.created_at as user_created_at
            FROM users u
            WHERE u.id = %s
        ''', (user_id,))
        
        user = cursor.fetchone()
        if not user:
            return jsonify({'error': 'User not found'}), 404

        profile_data = {
            'user_id': user['user_id'],
            'email': user['email'],
            'user_type': user['user_type'],
            'created_at': user['user_created_at']
        }

        # Get detailed profile based on user type
        if user['user_type'] == 'chef' and user['chef_id']:
            # Get chef profile with additional details
            cursor.execute('''
                SELECT c.id as chef_id, c.first_name, c.last_name, c.phone, c.photo_url,
                       c.created_at, c.updated_at
                FROM chefs c
                WHERE c.id = %s
            ''', (user['chef_id'],))
            
            chef_profile = cursor.fetchone()
            if chef_profile:
                profile_data.update({
                    'profile_id': chef_profile['chef_id'],
                    'first_name': chef_profile['first_name'],
                    'last_name': chef_profile['last_name'],
                    'phone': chef_profile['phone'],
                    'photo_url': chef_profile['photo_url'],
                    'profile_created_at': chef_profile['created_at'],
                    'profile_updated_at': chef_profile['updated_at']
                })

                # Get chef cuisines
                cursor.execute('''
                    SELECT ct.name
                    FROM chef_cuisines cc
                    JOIN cuisine_types ct ON cc.cuisine_id = ct.id
                    WHERE cc.chef_id = %s
                ''', (user['chef_id'],))
                cuisines = [row['name'] for row in cursor.fetchall()]
                profile_data['cuisines'] = cuisines

                # Get chef service areas
                cursor.execute('''
                    SELECT city, state, zip_code, service_radius_miles
                    FROM chef_service_areas
                    WHERE chef_id = %s
                ''', (user['chef_id'],))
                service_areas = cursor.fetchall()
                profile_data['service_areas'] = service_areas

                # Get chef pricing
                cursor.execute('''
                    SELECT base_rate_per_person, produce_supply_extra_cost, 
                           minimum_people, maximum_people
                    FROM chef_pricing
                    WHERE chef_id = %s
                ''', (user['chef_id'],))
                pricing = cursor.fetchone()
                if pricing:
                    profile_data['pricing'] = pricing

        elif user['user_type'] == 'customer' and user['customer_id']:
            # Get customer profile
            cursor.execute('''
                SELECT c.id as customer_id, c.first_name, c.last_name, c.phone, 
                       c.photo_url, c.allergy_notes, c.created_at, c.updated_at
                FROM customers c
                WHERE c.id = %s
            ''', (user['customer_id'],))
            
            customer_profile = cursor.fetchone()
            if customer_profile:
                profile_data.update({
                    'profile_id': customer_profile['customer_id'],
                    'first_name': customer_profile['first_name'],
                    'last_name': customer_profile['last_name'],
                    'phone': customer_profile['phone'],
                    'photo_url': customer_profile['photo_url'],
                    'allergy_notes': customer_profile['allergy_notes'],
                    'profile_created_at': customer_profile['created_at'],
                    'profile_updated_at': customer_profile['updated_at']
                })

                # Get customer addresses
                cursor.execute('''
                    SELECT id, address_line1, address_line2, city, state, zip_code, is_default
                    FROM customer_addresses
                    WHERE customer_id = %s
                ''', (user['customer_id'],))
                addresses = cursor.fetchall()
                profile_data['addresses'] = addresses

        return jsonify(profile_data), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()