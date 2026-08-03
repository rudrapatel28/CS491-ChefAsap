
from flask import Blueprint, request, jsonify
from database.db_helper import get_db_connection, get_cursor, handle_db_error
from functools import wraps
import jwt
import os
import stripe

from services.fraud_service import FraudDetectionEngine
import json
# Create the blueprint
stripe_payment_bp = Blueprint('stripe_payment', __name__)


fraud_engine = FraudDetectionEngine()

# Load environment variables from .env file
from dotenv import load_dotenv
load_dotenv()

# Stripe configuration
stripe.api_key = os.environ.get('STRIPE_SECRET_KEY', 'sk_test_YOUR_STRIPE_SECRET_KEY')
STRIPE_PUBLISHABLE_KEY = os.environ.get('STRIPE_PUBLISHABLE_KEY', 'pk_test_YOUR_STRIPE_PUBLISHABLE_KEY')

# JWT secret key - must match the one in auth_bp.py
SECRET_KEY = os.environ.get('JWT_SECRET_KEY', 'your-secret-key')

def token_required(f):
    """Decorator to require JWT token for protected routes"""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(" ")[1]
            except IndexError:
                return jsonify({'error': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'error': 'Token is missing'}), 401
        
        print(f">>> SECRET_KEY in use: '{SECRET_KEY[:10]}...'")
        print(f">>> Token received: '{token[:30]}...'")
        print(f">>> Token full: '{token}'")  


        try:
            data = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
            current_user_id = data['user_id']
            user_type = data.get('user_type')
        except jwt.ExpiredSignatureError:
            print(">>> EXPIRED TOKEN")
            return jsonify({'error': 'Token has expired'}), 401
        except jwt.InvalidTokenError as e:
            print(f">>> INVALID TOKEN ERROR: {e}")
            return jsonify({'error': 'Invalid token'}), 401
        
        return f(current_user_id, user_type, *args, **kwargs)
    
    return decorated

@stripe_payment_bp.route('/config', methods=['GET'])
def get_stripe_config():
    """Get Stripe publishable key for frontend"""
    return jsonify({
        'publishableKey': STRIPE_PUBLISHABLE_KEY
    }), 200

@stripe_payment_bp.route('/customer/<int:customer_id>/stripe-customer', methods=['POST'])
@token_required
def create_stripe_customer(current_user_id, user_type, customer_id):
    """Create a Stripe customer for the user"""
    print(f"=== Creating Stripe customer for customer_id: {customer_id} ===")
    
    if user_type != 'customer' or current_user_id != customer_id:
        return jsonify({'error': 'Unauthorized access'}), 403
    
    data = request.get_json()
    email = data.get('email')
    name = data.get('name')
    
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True, buffered=True)
        
        # Check if customer already has a Stripe customer ID
        cursor.execute('''
            SELECT stripe_customer_id FROM customers
            WHERE id = %s
        ''', (customer_id,))
        
        result = cursor.fetchone()
        
        if result and result.get('stripe_customer_id'):
            return jsonify({
                'success': True,
                'stripe_customer_id': result['stripe_customer_id'],
                'message': 'Stripe customer already exists'
            }), 200
        
        # Create Stripe customer
        stripe_customer = stripe.Customer.create(
            email=email,
            name=name,
            metadata={'customer_id': customer_id}
        )
        
        # Update database with Stripe customer ID
        cursor.execute('''
            UPDATE customers
            SET stripe_customer_id = %s
            WHERE id = %s
        ''', (stripe_customer.id, customer_id))
        
        conn.commit()
        
        return jsonify({
            'success': True,
            'stripe_customer_id': stripe_customer.id,
            'message': 'Stripe customer created successfully'
        }), 201
        
    except Exception as e:
        print(f"Stripe error: {str(e)}")
        return jsonify({'error': f'Stripe error: {str(e)}'}), 400
    
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

@stripe_payment_bp.route('/payment-methods', methods=['GET'])
def get_payment_methods_no_auth():
    """Get all saved payment methods from Stripe (no auth for now)"""
    user_id = request.args.get('customer_id')  # This is actually user_id from frontend
    
    if not user_id:
        return jsonify({'error': 'User ID is required'}), 400
    
    print(f"=== Getting payment methods for user_id: {user_id} ===")
    
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True, buffered=True)
        
        # First, get customer_id from users table
        cursor.execute('''
            SELECT customer_id FROM users
            WHERE id = %s AND user_type = 'customer'
        ''', (user_id,))
        
        user_result = cursor.fetchone()
        
        if not user_result or not user_result['customer_id']:
            print(f"No customer found for user_id: {user_id}")
            return jsonify({
                'success': True,
                'payment_methods': [],
                'message': 'Customer not found'
            }), 200
        
        customer_id = user_result['customer_id']
        
        # Get Stripe customer ID
        cursor.execute('''
            SELECT stripe_customer_id FROM customers
            WHERE id = %s
        ''', (customer_id,))
        
        result = cursor.fetchone()
        
        if not result or not result.get('stripe_customer_id'):
            print(f"No stripe_customer_id found for customer_id: {customer_id}")
            return jsonify({
                'success': True,
                'payment_methods': [],
                'message': 'No Stripe customer found'
            }), 200
        
        stripe_customer_id = result['stripe_customer_id']
        print(f"Found stripe_customer_id: {stripe_customer_id}")
        
        # Get customer details to find default payment method
        print(f"Retrieving Stripe customer...")
        stripe_customer = stripe.Customer.retrieve(stripe_customer_id)
        default_payment_method = stripe_customer.invoice_settings.default_payment_method
        print(f"Default payment method: {default_payment_method}")
        
        # Get payment methods from Stripe
        print(f"Listing payment methods...")
        payment_methods = stripe.PaymentMethod.list(
            customer=stripe_customer_id,
            type='card'
        )
        print(f"Retrieved {len(payment_methods.data)} payment methods from Stripe")
        
        # Format payment methods for frontend
        formatted_methods = []
        for pm in payment_methods.data:
            formatted_methods.append({
                'id': pm.id,
                'brand': pm.card.brand,
                'last4': pm.card.last4,
                'exp_month': pm.card.exp_month,
                'exp_year': pm.card.exp_year,
                'is_default': pm.id == default_payment_method
            })
        
        print(f"Found {len(formatted_methods)} payment methods")
        print(f"Formatted methods: {formatted_methods}")
        
        return jsonify({
            'success': True,
            'payment_methods': formatted_methods
        }), 200
        
    except Exception as e:
        print(f"Error getting payment methods: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

@stripe_payment_bp.route('/customer/<int:customer_id>/payment-methods', methods=['GET'])
@token_required
def get_payment_methods(current_user_id, user_type, customer_id):
    """Get all saved payment methods from Stripe"""
    print(f"=== Getting payment methods for customer_id: {customer_id} ===")
    
    if user_type != 'customer' or current_user_id != customer_id:
        return jsonify({'error': 'Unauthorized access'}), 403
    
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True, buffered=True)
        
        # Get Stripe customer ID
        cursor.execute('''
            SELECT stripe_customer_id FROM customers
            WHERE id = %s
        ''', (customer_id,))
        
        result = cursor.fetchone()
        
        if not result or not result.get('stripe_customer_id'):
            return jsonify({
                'success': True,
                'payment_methods': [],
                'message': 'No Stripe customer found'
            }), 200
        
        stripe_customer_id = result['stripe_customer_id']
        
        # Get payment methods from Stripe
        payment_methods = stripe.PaymentMethod.list(
            customer=stripe_customer_id,
            type='card'
        )
        
        # Format payment methods for frontend
        formatted_methods = []
        for pm in payment_methods.data:
            formatted_methods.append({
                'id': pm.id,
                'brand': pm.card.brand,
                'last4': pm.card.last4,
                'exp_month': pm.card.exp_month,
                'exp_year': pm.card.exp_year,
                'funding': pm.card.funding,  # credit, debit, prepaid
                'created': pm.created
            })
        
        return jsonify({
            'success': True,
            'payment_methods': formatted_methods
        }), 200
        
    except Exception as e:
        print(f"Stripe error: {str(e)}")
        return jsonify({'error': f'Stripe error: {str(e)}'}), 400
    
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

@stripe_payment_bp.route('/attach-payment-method', methods=['POST'])
def attach_payment_method_with_token():
    """Attach a payment method to customer using card token (no auth required for initial setup)"""
    print(f"=== Attaching payment method with token ===")
    
    data = request.get_json()
    user_id = data.get('customer_id')
    token_id = data.get('token_id')
    payment_method_id = data.get('payment_method_id')

    if not user_id or (not token_id and not payment_method_id):
        return jsonify({'error': 'User ID and payment method are required'}), 400
    
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True, buffered=True)
        
        # First, get customer_id from users table
        cursor.execute('''
            SELECT customer_id, user_type
            FROM users
            WHERE id = %s
        ''', (user_id,))
        
        user_result = cursor.fetchone()
        
        if not user_result:
            return jsonify({'error': 'User not found'}), 404
        
        if user_result['user_type'] != 'customer':
            return jsonify({'error': 'User is not a customer'}), 400
        
        customer_id = user_result['customer_id']
        
        if not customer_id:
            return jsonify({'error': 'Customer profile not found'}), 404
        
        # Get or create Stripe customer ID
        cursor.execute('''
            SELECT stripe_customer_id, email, first_name, last_name 
            FROM customers
            WHERE id = %s
        ''', (customer_id,))
        
        result = cursor.fetchone()
        
        if not result:
            return jsonify({'error': 'Customer not found'}), 404
        
        stripe_customer_id = result.get('stripe_customer_id')
        
        # Create Stripe customer if doesn't exist
        if not stripe_customer_id:
            customer_name = f"{result['first_name']} {result['last_name']}"
            stripe_customer = stripe.Customer.create(
                email=result['email'],
                name=customer_name,
                metadata={'customer_id': customer_id}
            )
            stripe_customer_id = stripe_customer.id
            
            # Update database with Stripe customer ID
            cursor.execute('''
                UPDATE customers
                SET stripe_customer_id = %s
                WHERE id = %s
            ''', (stripe_customer_id, customer_id))
            conn.commit()
            print(f"Created new Stripe customer: {stripe_customer_id}")

        # Use existing payment method or create from token
        if payment_method_id:
            payment_method = stripe.PaymentMethod.attach(
                payment_method_id,
                customer=stripe_customer_id
            )
        else:
            payment_method = stripe.PaymentMethod.create(
                type='card',
                card={'token': token_id}
            )
            stripe.PaymentMethod.attach(
                payment_method.id,
                customer=stripe_customer_id
            )
        
        # Check if this is the first payment method - if so, set as default
        customer_payment_methods = stripe.PaymentMethod.list(
            customer=stripe_customer_id,
            type='card'
        )
        
        if len(customer_payment_methods.data) == 1:
            stripe.Customer.modify(
                stripe_customer_id,
                invoice_settings={
                    'default_payment_method': payment_method.id
                }
            )
        
        return jsonify({
            'success': True,
            'payment_method': {
                'id': payment_method.id,
                'brand': payment_method.card.brand,
                'last4': payment_method.card.last4,
                'exp_month': payment_method.card.exp_month,
                'exp_year': payment_method.card.exp_year
            },
            'message': 'Card added successfully'
        }), 200
        
    except Exception as e:
        error_message = str(e)
        print(f"=" * 60)
        print(f"Error attaching payment method:")
        print(f"Error type: {type(e).__name__}")
        print(f"Error message: {error_message}")
        print(f"Customer ID: {customer_id}")
        print(f"Token ID: {token_id if 'token_id' in locals() else 'N/A'}")
        print(f"=" * 60)
        import traceback
        traceback.print_exc()
        return jsonify({'error': error_message}), 400
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

@stripe_payment_bp.route('/customer/<int:customer_id>/attach-payment-method', methods=['POST'])
@token_required
def attach_payment_method(current_user_id, user_type, customer_id):
    """Attach a payment method to customer"""
    print(f"=== Attaching payment method for customer_id: {customer_id} ===")
    
    if user_type != 'customer' or current_user_id != customer_id:
        return jsonify({'error': 'Unauthorized access'}), 403
    
    data = request.get_json()
    payment_method_id = data.get('payment_method_id')
    
    if not payment_method_id:
        return jsonify({'error': 'Payment method ID is required'}), 400
    
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True, buffered=True)
        
        # Get Stripe customer ID
        cursor.execute('''
            SELECT stripe_customer_id FROM customers
            WHERE id = %s
        ''', (customer_id,))
        
        result = cursor.fetchone()
        
        if not result or not result.get('stripe_customer_id'):
            return jsonify({'error': 'Stripe customer not found. Please create one first.'}), 404
        
        stripe_customer_id = result['stripe_customer_id']
        
        # Attach payment method to customer
        payment_method = stripe.PaymentMethod.attach(
            payment_method_id,
            customer=stripe_customer_id
        )
        
        # Set as default payment method if requested
        if data.get('set_as_default', False):
            stripe.Customer.modify(
                stripe_customer_id,
                invoice_settings={
                    'default_payment_method': payment_method_id
                }
            )
        
        return jsonify({
            'success': True,
            'payment_method': {
                'id': payment_method.id,
                'brand': payment_method.card.brand,
                'last4': payment_method.card.last4,
                'exp_month': payment_method.card.exp_month,
                'exp_year': payment_method.card.exp_year
            },
            'message': 'Payment method attached successfully'
        }), 200
        
    except Exception as e:
        print(f"Stripe error: {str(e)}")
        return jsonify({'error': f'Stripe error: {str(e)}'}), 400
    
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

@stripe_payment_bp.route('/payment-methods/<payment_method_id>', methods=['DELETE'])
def detach_payment_method_no_auth(payment_method_id):
    """Detach a payment method from customer (no auth for now)"""
    data = request.get_json()
    user_id = data.get('customer_id')  # This is actually user_id from frontend
    
    if not user_id:
        return jsonify({'error': 'User ID is required'}), 400
    
    print(f"=== Detaching payment method {payment_method_id} for user_id: {user_id} ===")
    
    try:
        # Detach payment method
        payment_method = stripe.PaymentMethod.detach(payment_method_id)
        
        return jsonify({
            'success': True,
            'message': 'Payment method removed successfully'
        }), 200
        
    except Exception as e:
        print(f"Stripe error: {str(e)}")
        return jsonify({'error': f'Stripe error: {str(e)}'}), 400
    

@stripe_payment_bp.route('/payment-methods/<payment_method_id>/set-default', methods=['POST'])
def set_default_payment_method_no_auth(payment_method_id):
    """Set a payment method as default (no auth for now)"""
    data = request.get_json()
    user_id = data.get('customer_id')  # This is actually user_id from frontend
    
    if not user_id:
        return jsonify({'error': 'User ID is required'}), 400
    
    print(f"=== Setting default payment method {payment_method_id} for user_id: {user_id} ===")
    
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True, buffered=True)
        
        # First, get customer_id from users table
        cursor.execute('''
            SELECT customer_id FROM users
            WHERE id = %s AND user_type = 'customer'
        ''', (user_id,))
        
        user_result = cursor.fetchone()
        
        if not user_result or not user_result['customer_id']:
            return jsonify({'error': 'Customer not found'}), 404
        
        customer_id = user_result['customer_id']
        
        # Get Stripe customer ID
        cursor.execute('''
            SELECT stripe_customer_id FROM customers
            WHERE id = %s
        ''', (customer_id,))
        
        result = cursor.fetchone()
        
        if not result or not result.get('stripe_customer_id'):
            return jsonify({'error': 'Stripe customer not found'}), 404
        
        stripe_customer_id = result['stripe_customer_id']
        
        # Update default payment method
        stripe.Customer.modify(
            stripe_customer_id,
            invoice_settings={
                'default_payment_method': payment_method_id
            }
        )
        
        return jsonify({
            'success': True,
            'message': 'Default payment method updated successfully'
        }), 200
        
    except Exception as e:
        print(f"Stripe error: {str(e)}")
        return jsonify({'error': f'Stripe error: {str(e)}'}), 400
    
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

@stripe_payment_bp.route('/customer/<int:customer_id>/detach-payment-method/<payment_method_id>', methods=['DELETE'])
@token_required
def detach_payment_method(current_user_id, user_type, customer_id, payment_method_id):
    """Detach a payment method from customer"""
    print(f"=== Detaching payment method {payment_method_id} for customer_id: {customer_id} ===")
    
    if user_type != 'customer' or current_user_id != customer_id:
        return jsonify({'error': 'Unauthorized access'}), 403
    
    try:
        # Detach payment method
        payment_method = stripe.PaymentMethod.detach(payment_method_id)
        
        return jsonify({
            'success': True,
            'message': 'Payment method removed successfully'
        }), 200
        
    except Exception as e:
        print(f"Stripe error: {str(e)}")
        return jsonify({'error': f'Stripe error: {str(e)}'}), 400
    except Exception as e:
        print(f"Error detaching payment method: {str(e)}")
        return jsonify({'error': str(e)}), 500


# TEMPORARY: No authentication version (deprecated, kept for reference)
# This endpoint is no longer active - /create-payment-intent now uses authentication
@stripe_payment_bp.route('/create-payment-intent-no-auth', methods=['POST'])
def create_payment_intent_no_auth():
    """Create a payment intent for a booking/order (no auth for testing)
    
    DEPRECATED: This endpoint is kept for reference only.
    All requests should use /create-payment-intent which requires authentication.
    """
    return jsonify({'error': 'This endpoint is deprecated. Use /create-payment-intent instead.'}), 410

@stripe_payment_bp.route('/webhook', methods=['POST'])
def stripe_webhook():
    """Handle Stripe webhooks"""
    payload = request.data
    sig_header = request.headers.get('Stripe-Signature')
    webhook_secret = os.environ.get('STRIPE_WEBHOOK_SECRET')
    
    if not webhook_secret:
        print("Warning: STRIPE_WEBHOOK_SECRET not set")
        return jsonify({'error': 'Webhook secret not configured'}), 500
    
    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, webhook_secret
        )
    except ValueError as e:
        print(f"Invalid payload: {e}")
        return jsonify({'error': 'Invalid payload'}), 400
    except stripe.error.SignatureVerificationError as e:
        print(f"Invalid signature: {e}")
        return jsonify({'error': 'Invalid signature'}), 400
    
    # Handle different event types
    if event['type'] == 'payment_intent.succeeded':
        payment_intent = event['data']['object']
        print(f"PaymentIntent {payment_intent['id']} succeeded")
        # Update your database - mark order/booking as paid
        
    elif event['type'] == 'payment_intent.payment_failed':
        payment_intent = event['data']['object']
        print(f"PaymentIntent {payment_intent['id']} failed")
        # Update your database - mark payment as failed
        
    elif event['type'] == 'customer.created':
        customer = event['data']['object']
        print(f"Customer {customer['id']} created")
        
    elif event['type'] == 'payment_method.attached':
        payment_method = event['data']['object']
        print(f"PaymentMethod {payment_method['id']} attached")
    
    return jsonify({'success': True}), 200

@stripe_payment_bp.route('/customer/<int:customer_id>/set-default-payment-method', methods=['PUT'])
@token_required
def set_default_payment_method(current_user_id, user_type, customer_id):
    """Set a payment method as default"""
    print(f"=== Setting default payment method for customer_id: {customer_id} ===")
    
    if user_type != 'customer' or current_user_id != customer_id:
        return jsonify({'error': 'Unauthorized access'}), 403
    
    data = request.get_json()
    payment_method_id = data.get('payment_method_id')
    
    if not payment_method_id:
        return jsonify({'error': 'Payment method ID is required'}), 400
    
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True, buffered=True)
        
        # Get Stripe customer ID
        cursor.execute('''
            SELECT stripe_customer_id FROM customers
            WHERE id = %s
        ''', (customer_id,))
        
        result = cursor.fetchone()
        
        if not result or not result.get('stripe_customer_id'):
            return jsonify({'error': 'Stripe customer not found'}), 404
        
        stripe_customer_id = result['stripe_customer_id']
        
        # Set as default payment method
        stripe.Customer.modify(
            stripe_customer_id,
            invoice_settings={
                'default_payment_method': payment_method_id
            }
        )
        
        return jsonify({
            'success': True,
            'message': 'Default payment method updated successfully'
        }), 200
        
    except Exception as e:
        print(f"Stripe error: {str(e)}")
        return jsonify({'error': f'Stripe error: {str(e)}'}), 400
    except Exception as e:
        print(f"Error setting default payment method: {str(e)}")
        return handle_db_error(e)
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@stripe_payment_bp.route('/test-payment', methods=['POST'])
def test_payment():
    """Test a payment with saved card"""
    data = request.get_json()
    user_id = data.get('customer_id')  # This is actually user_id from frontend
    amount = data.get('amount', 100)  # Default $1.00
    payment_method_id = data.get('payment_method_id')  # Optional - use default if not provided
    
    if not user_id:
        return jsonify({'error': 'User ID is required'}), 400
    
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True, buffered=True)
        
        # First, get customer_id from users table
        cursor.execute('''
            SELECT customer_id FROM users
            WHERE id = %s AND user_type = 'customer'
        ''', (user_id,))
        
        user_result = cursor.fetchone()
        
        if not user_result or not user_result['customer_id']:
            return jsonify({'error': 'Customer not found'}), 404
        
        customer_id = user_result['customer_id']
        
        # Get Stripe customer ID
        cursor.execute('''
            SELECT stripe_customer_id FROM customers
            WHERE id = %s
        ''', (customer_id,))
        
        result = cursor.fetchone()
        
        if not result or not result.get('stripe_customer_id'):
            return jsonify({'error': 'Stripe customer not found'}), 404
        
        stripe_customer_id = result['stripe_customer_id']
        
        # Create payment intent
        payment_intent_params = {
            'amount': amount,
            'currency': 'usd',
            'customer': stripe_customer_id,
            'description': 'Test payment for ChefAsap',
            'metadata': {
                'customer_id': customer_id,
                'test': 'true'
            }
        }
        
        # Use specific payment method if provided, otherwise use default
        if payment_method_id:
            payment_intent_params['payment_method'] = payment_method_id
            payment_intent_params['confirm'] = True
            payment_intent_params['off_session'] = True
        
        payment_intent = stripe.PaymentIntent.create(**payment_intent_params)
        
        return jsonify({
            'success': True,
            'payment_intent_id': payment_intent.id,
            'status': payment_intent.status,
            'amount': payment_intent.amount,
            'currency': payment_intent.currency,
            'message': f'Test payment of ${amount/100:.2f} processed successfully!'
        }), 200
        
    except Exception as e:
        print(f"Test payment error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

@stripe_payment_bp.route('/create-payment-intent', methods=['POST'])
@token_required
def create_payment_intent(current_user_id, user_type):
    print(f"=== Creating payment intent for user_id: {current_user_id} ===")
    
    if user_type != 'customer':
        return jsonify({'error': 'Only customers can create payment intents'}), 403
    
    data = request.get_json()
    print(f"DEBUG INCOMING PAYLOAD: {data}") 
    
    booking_id = data.get('booking_id')
    currency = data.get('currency', 'usd')
    frontend_user_id = data.get('customer_id') 
    payment_method_id = data.get('payment_method_id')
    event_zip = data.get('event_zip')
    
    if not all([booking_id, frontend_user_id, payment_method_id, event_zip]):
        print(f"❌ REJECTED 400 (Missing Data): booking={booking_id}, customer={frontend_user_id}, payment={payment_method_id}, zip={event_zip}")
        return jsonify({'error': 'Booking ID, Customer ID, Payment method ID, and Event Zip are required'}), 400
    
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True, buffered=True)

        # 1. TRANSLATE USER ID TO REAL CUSTOMER ID
        cursor.execute('SELECT customer_id FROM users WHERE id = %s', (frontend_user_id,))
        user_row = cursor.fetchone()
        
        if not user_row or not user_row.get('customer_id'):
            print(f"❌ REJECTED 404: User ID {frontend_user_id} has no linked customer profile.")
            return jsonify({'error': 'Could not link User ID to Customer ID'}), 404
            
        real_customer_id = user_row['customer_id']
        print(f"✅ Translated User ID {frontend_user_id} -> Customer ID {real_customer_id}")
        
        # 2. FETCH SECURE PRICE FROM DATABASE
        cursor.execute('SELECT base_price, dynamic_price FROM bookings WHERE id = %s', (booking_id,))
        booking = cursor.fetchone()
        if not booking:
            print(f"❌ REJECTED 404: Booking {booking_id} not found in database.")
            return jsonify({'error': 'Booking not found'}), 404
            
        final_price = booking.get('dynamic_price') or booking.get('base_price')
        if not final_price:
            print(f"❌ REJECTED 400 (Pricing Error): final_price is zero or missing. DB data = {booking}")
            return jsonify({'error': 'Pricing not set for this booking'}), 400

        amount_cents = int(float(final_price) * 100)
        print(f"✅ Price calculated: {amount_cents} cents")

        # --- FRAUD DETECTION ---
        risk_assessment = fraud_engine.evaluate_transaction_risk(
            customer_id=real_customer_id, 
            amount_cents=amount_cents,
            event_zip=event_zip 
        )
        
        cursor.execute('''
            UPDATE bookings 
            SET fraud_score = %s, fraud_flags = %s, is_flagged_fraud = %s
            WHERE id = %s
        ''', (risk_assessment['fraud_score'], json.dumps(risk_assessment['flags']), risk_assessment['is_flagged'], booking_id))
        conn.commit()

        if risk_assessment['is_flagged']:
            print(f"❌ REJECTED 403: Fraud flagged.")
            return jsonify({'error': 'Flagged transaction'}), 403
        
        # 3. Get Stripe customer ID using the REAL customer id
        cursor.execute('SELECT stripe_customer_id FROM customers WHERE id = %s', (real_customer_id,))
        result = cursor.fetchone()
        stripe_customer_id = result.get('stripe_customer_id') if result else None
        
        if not stripe_customer_id:
            print(f"❌ REJECTED 400 (Missing Stripe Profile): No Stripe ID found for real_customer_id {real_customer_id}")
            return jsonify({'error': 'Stripe customer not found'}), 400
        
        print(f"✅ Found Stripe Customer ID: {stripe_customer_id}")

        # 4. Create payment intent
        is_surge = booking.get('dynamic_price') and booking.get('dynamic_price') > booking.get('base_price')
        description = f"ChefAsap Booking {booking_id} (High Demand)" if is_surge else f"ChefAsap Booking {booking_id}"
        
        intent_params = {
            'amount': amount_cents,
            'currency': currency,
            'description': description,
            'customer': stripe_customer_id,
            'payment_method': payment_method_id,
            'confirm': True,
            'automatic_payment_methods': {'enabled': True, 'allow_redirects': 'never'},
            'metadata': {'booking_id': booking_id}
        }
        
        payment_intent = stripe.PaymentIntent.create(**intent_params)
        print(f"✅ Success! Payment Intent created: {payment_intent.id}")
        
        return jsonify({
            'success': True,
            'client_secret': payment_intent.client_secret,
            'payment_intent_id': payment_intent.id,
            'status': payment_intent.status
        }), 200
        
    except Exception as e:
        print(f"❌ FATAL ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()