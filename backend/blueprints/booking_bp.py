import json

from flask import Blueprint, request, jsonify
from datetime import datetime, timedelta
from database.config import db_config
from database.db_helper import get_db_connection, get_cursor, handle_db_error
import math
from services.geocoding_service import geocoding_service, get_coordinates_for_zip
from datetime import date as _date

# Create the blueprint
booking_bp = Blueprint('booking', __name__)

def calculate_distance(lat1, lon1, lat2, lon2):
    """Calculate distance between two points using Haversine formula"""
    R = 3959  
    
    lat1_rad = math.radians(lat1)
    lon1_rad = math.radians(lon1)
    lat2_rad = math.radians(lat2)
    lon2_rad = math.radians(lon2)
    
    dlat = lat2_rad - lat1_rad
    dlon = lon2_rad - lon1_rad
    
    a = math.sin(dlat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    
    return R * c

def get_zip_coordinates(zip_code):
    """Get coordinates for a zip code using improved geocoding service"""
    return get_coordinates_for_zip(zip_code)

@booking_bp.route('/create', methods=['POST'])
def create_booking():
    """Create a new booking request with pricing data"""
    try:
        data = request.get_json()
        
        customer_id = data.get('customer_id')
        cuisine_type = data.get('cuisine_type')
        meal_type = (data.get('meal_type') or '').strip().lower()
        event_type = data.get('event_type', 'dinner')
        booking_date = data.get('booking_date')
        booking_time = data.get('booking_time')
        produce_supply = data.get('produce_supply', 'customer')
        number_of_people = data.get('number_of_people')
        special_notes = data.get('special_notes', '')
        
        # FIX: Capture pricing fields from the frontend payload
        base_price = data.get('base_price')
        dynamic_price = data.get('dynamic_price')
        total_cost = data.get('total_cost')
        pricing_multiplier = data.get('pricing_multiplier')
        pricing_features = data.get('pricing_features')
        
        if not all([customer_id, cuisine_type, meal_type, 
                   booking_date, booking_time, number_of_people]):
            return jsonify({'error': 'Missing required fields'}), 400
        
        booking_datetime = datetime.strptime(f"{booking_date} {booking_time}", "%Y-%m-%d %H:%M")
        if booking_datetime <= datetime.now():
            return jsonify({'error': 'Booking date must be in the future'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # FIX: Update the SQL query to include the pricing columns
        cursor.execute('''
            INSERT INTO bookings (
                customer_id, cuisine_type, meal_type, event_type, 
                booking_date, booking_time, produce_supply, 
                number_of_people, special_notes, 
                base_price, dynamic_price, total_cost, pricing_multiplier, pricing_features
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) 
            RETURNING id
        ''', (
            customer_id, cuisine_type, meal_type, event_type, 
            booking_date, booking_time, produce_supply, 
            number_of_people, special_notes,
            base_price, dynamic_price, total_cost, pricing_multiplier, json.dumps(pricing_features) if pricing_features else None # Convert pricing_features to JSON string if it's a dict or list
        ))
        
        booking_id = cursor.fetchone()[0]
        conn.commit()
        
        cursor.close()
        conn.close()
        
        return jsonify({
            'message': 'Booking created successfully',
            'booking_id': booking_id
        }), 201
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@booking_bp.route('/search-chefs', methods=['POST'])
def search_chefs():
    """Search for available chefs based on booking criteria"""
    try:
        data = request.get_json()
        
        cuisine_type = data.get('cuisine_type')
        booking_date = data.get('booking_date')
        booking_time = data.get('booking_time')
        customer_zip = data.get('customer_zip')
        number_of_people = data.get('number_of_people')
        
        if not all([cuisine_type, booking_date, booking_time, customer_zip]):
            return jsonify({'error': 'Missing required search criteria'}), 400
        
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True)
        
        # Use improved geocoding service
        customer_lat, customer_lon = get_zip_coordinates(customer_zip)
        
  
        cursor.execute('''
            SELECT DISTINCT 
                c.id as chef_id,
                c.first_name,
                c.last_name,
                c.email,
                c.phone,
                c.photo_url,
                csa.city,
                csa.state,
                csa.zip_code,
                csa.service_radius_miles,
                cp.base_rate_per_person,
                cp.produce_supply_extra_cost,
                cp.minimum_people,
                cp.maximum_people,
                STRING_AGG(ct.name, ', ') as cuisines
            FROM chefs c
            JOIN chef_cuisines cc ON c.id = cc.chef_id
            JOIN cuisine_types ct ON cc.cuisine_id = ct.id
            JOIN chef_service_areas csa ON c.id = csa.chef_id
            LEFT JOIN chef_pricing cp ON c.id = cp.chef_id
            WHERE ct.name = %s
            AND (cp.minimum_people IS NULL OR cp.minimum_people <= %s)
            AND (cp.maximum_people IS NULL OR cp.maximum_people >= %s)
            GROUP BY c.id, c.first_name, c.last_name, c.email, c.phone, c.photo_url,
                     csa.city, csa.state, csa.zip_code, csa.service_radius_miles,
                     cp.base_rate_per_person, cp.produce_supply_extra_cost,
                     cp.minimum_people, cp.maximum_people
        ''', (cuisine_type, number_of_people, number_of_people))
        
        chefs = cursor.fetchall()
        
      
        available_chefs = []
        for chef in chefs:
      
            chef_lat, chef_lon = get_zip_coordinates(chef['zip_code'])
            distance = calculate_distance(customer_lat, customer_lon, chef_lat, chef_lon)
            
          
            service_radius = chef['service_radius_miles'] or 10
            if distance <= service_radius:

                cursor.execute('''
                    SELECT COUNT(*) as conflict_count
                    FROM bookings
                    WHERE chef_id = %s 
                    AND booking_date = %s 
                    AND booking_time = %s
                    AND status NOT IN ('declined', 'cancelled')
                ''', (chef['chef_id'], booking_date, booking_time))
                
                conflict = cursor.fetchone()
                if conflict['conflict_count'] == 0:

                    base_cost = (chef['base_rate_per_person'] or 50) * number_of_people
                    produce_cost = chef['produce_supply_extra_cost'] or 0
                    
                    chef_info = {
                        'chef_id': chef['chef_id'],
                        'name': f"{chef['first_name']} {chef['last_name']}",
                        'email': chef['email'],
                        'phone': chef['phone'],
                        'photo_url': chef['photo_url'],
                        'location': f"{chef['city']}, {chef['state']} {chef['zip_code']}",
                        'distance_miles': round(distance, 1),
                        'cuisines': chef['cuisines'].split(',') if chef['cuisines'] else [],
                        'base_rate_per_person': float(chef['base_rate_per_person'] or 50),
                        'produce_supply_extra_cost': float(produce_cost),
                        'estimated_total_cost': float(base_cost),
                        'min_people': chef['minimum_people'] or 1,
                        'max_people': chef['maximum_people'] or 50
                    }
                    available_chefs.append(chef_info)
        
       
        available_chefs.sort(key=lambda x: x['distance_miles'])
        
        cursor.close()
        conn.close()
        
        return jsonify({
            'available_chefs': available_chefs,
            'total_found': len(available_chefs)
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@booking_bp.route('/book-chef', methods=['POST'])
def book_chef():
    """Book a specific chef for a booking request"""
    try:
        data = request.get_json()
        
        booking_id = data.get('booking_id')
        chef_id = data.get('chef_id')
        
        if not all([booking_id, chef_id]):
            return jsonify({'error': 'Missing booking_id or chef_id'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
      
        cursor.execute('''
            UPDATE bookings 
            SET chef_id = %s, status = 'pending'
            WHERE id = %s
        ''', (chef_id, booking_id))
        
        if cursor.rowcount == 0:
            return jsonify({'error': 'Booking not found'}), 404
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({'message': 'Chef booked successfully'}), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@booking_bp.route('/customer/<int:customer_id>/dashboard', methods=['GET'])
def get_customer_dashboard(customer_id):
    """Get categorized bookings for customer dashboard: previous, today's, and upcoming"""
    try:
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True)
        
        # Get today's date
        from datetime import date
        today = date.today()
        
        # Base query for booking details
        base_query = '''
            SELECT 
                b.id as booking_id,
                b.chef_id,
                b.booking_date,
                b.booking_time,
                b.cuisine_type,
                b.meal_type,
                b.event_type,
                b.number_of_people,
                b.special_notes,
                b.status,
                b.total_cost,
                b.created_at,
                c.first_name || ' ' || c.last_name as chef_name,
                c.email as chef_email,
                c.phone as chef_phone,
                c.photo_url as chef_photo,
                ca.address_line1 as chef_address_line1,
                ca.address_line2 as chef_address_line2,
                ca.city as chef_city,
                ca.state as chef_state,
                ca.zip_code as chef_zip_code,
                CASE WHEN cr.id IS NOT NULL THEN TRUE ELSE FALSE END as has_reviewed
            FROM bookings b
            LEFT JOIN chefs c ON b.chef_id = c.id
            LEFT JOIN chef_addresses ca ON c.id = ca.chef_id AND ca.is_default = TRUE
            LEFT JOIN chef_ratings cr ON b.id = cr.booking_id AND cr.customer_id = b.customer_id
            WHERE b.customer_id = %s
        '''
        
        # Get previous bookings (before today)
        cursor.execute(base_query + ' AND b.booking_date < %s ORDER BY b.booking_date DESC, b.booking_time DESC', 
                      (customer_id, today))
        previous_bookings = cursor.fetchall()
        
        # Get today's bookings
        cursor.execute(base_query + ' AND b.booking_date = %s ORDER BY b.booking_time ASC', 
                      (customer_id, today))
        todays_bookings = cursor.fetchall()
        
        # Get upcoming bookings (after today)
        cursor.execute(base_query + ' AND b.booking_date > %s ORDER BY b.booking_date ASC, b.booking_time ASC', 
                      (customer_id, today))
        upcoming_bookings = cursor.fetchall()
        
        # Convert datetime/date objects to strings for JSON serialization
        def format_booking_data(bookings):
            formatted = []
            for booking in bookings:
                formatted_booking = dict(booking)
                # Convert date to string
                if formatted_booking.get('booking_date'):
                    formatted_booking['booking_date'] = str(formatted_booking['booking_date'])
                # Convert time to string
                if formatted_booking.get('booking_time'):
                    formatted_booking['booking_time'] = str(formatted_booking['booking_time'])
                # Convert datetime to string
                if formatted_booking.get('created_at'):
                    formatted_booking['created_at'] = formatted_booking['created_at'].isoformat()
                # Convert decimal to float
                if formatted_booking.get('total_cost'):
                    formatted_booking['total_cost'] = float(formatted_booking['total_cost'])
                formatted.append(formatted_booking)
            return formatted
        
        cursor.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'data': {
                'previous_bookings': format_booking_data(previous_bookings),
                'todays_bookings': format_booking_data(todays_bookings),
                'upcoming_bookings': format_booking_data(upcoming_bookings)
            },
            'counts': {
                'previous_count': len(previous_bookings),
                'todays_count': len(todays_bookings),
                'upcoming_count': len(upcoming_bookings),
                'total_count': len(previous_bookings) + len(todays_bookings) + len(upcoming_bookings)
            }
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
@booking_bp.route('/customer/<int:customer_id>/bookings/finished', methods=['GET'])
def get_finished_customer_bookings(customer_id):
    """Get customer bookings that need reviewing"""
    try:
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True)
        
        # Base query for booking details
        base_query = '''
            SELECT 
                b.id as booking_id,
                b.chef_id,
                b.booking_date,
                b.booking_time,
                --b.cuisine_type,
                --b.meal_type,
                --b.event_type,
                --b.number_of_people,
                b.special_notes,
                --b.status,
                b.total_cost,
                --b.created_at,
                c.first_name || ' ' || c.last_name as chef_name,
                --c.email as chef_email,
                --c.phone as chef_phone,
                c.photo_url as chef_photo--,
                --ca.address_line1 as chef_address_line1,
                --ca.address_line2 as chef_address_line2,
                --ca.city as chef_city,
                --ca.state as chef_state,
                --ca.zip_code as chef_zip_code,
                --CASE WHEN cr.id IS NOT NULL THEN TRUE ELSE FALSE END as has_reviewed
            FROM bookings b
            LEFT JOIN chefs c ON b.chef_id = c.id
            LEFT JOIN chef_addresses ca ON c.id = ca.chef_id AND ca.is_default = TRUE
            LEFT JOIN chef_ratings cr ON b.id = cr.booking_id AND cr.customer_id = b.customer_id
            WHERE b.status = 'completed' AND b.customer_id = %s AND b.customer_review = FALSE 
            ORDER BY b.booking_date ASC 
        '''

        cursor.execute(base_query, (customer_id,))
        finished_bookings = cursor.fetchall()
        
        # Convert datetime/date objects to strings for JSON serialization
        def format_booking_data(bookings):
            formatted = []
            for booking in bookings:
                formatted_booking = dict(booking)
                # Convert date to string
                if formatted_booking.get('booking_date'):
                    formatted_booking['booking_date'] = str(formatted_booking['booking_date'])
                # Convert time to string
                if formatted_booking.get('booking_time'):
                    formatted_booking['booking_time'] = str(formatted_booking['booking_time'])
                # Convert datetime to string
                if formatted_booking.get('created_at'):
                    formatted_booking['created_at'] = formatted_booking['created_at'].isoformat()
                # Convert decimal to float
                if formatted_booking.get('total_cost'):
                    formatted_booking['total_cost'] = float(formatted_booking['total_cost'])
                formatted.append(formatted_booking)
            return formatted
        
        cursor.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'bookings': format_booking_data(finished_bookings),
            'count': len(finished_bookings),
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@booking_bp.route('/customer/<int:customer_id>', methods=['GET'])
def get_customer_bookings(customer_id):
    """Get all bookings for a customer (legacy endpoint - use dashboard for categorized data)"""
    try:
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True)
        
        cursor.execute('''
            SELECT 
                b.id as booking_id,
                b.booking_date,
                b.booking_time,
                b.cuisine_type,
                b.meal_type,
                b.event_type,
                b.number_of_people,
                b.special_notes,
                b.status,
                b.total_cost,
                b.created_at,
                b.customer_review,
                c.first_name || ' ' || c.last_name as chef_name,
                c.email as chef_email,
                c.phone as chef_phone
            FROM bookings b
            LEFT JOIN chefs c ON b.chef_id = c.id
            WHERE b.customer_id = %s
            ORDER BY b.booking_date DESC, b.booking_time DESC
        ''', (customer_id,))
        
        bookings = cursor.fetchall()
        
        # Format data for JSON serialization
        formatted_bookings = []
        for booking in bookings:
            formatted_booking = dict(booking)
            if formatted_booking.get('booking_date'):
                formatted_booking['booking_date'] = str(formatted_booking['booking_date'])
            if formatted_booking.get('booking_time'):
                formatted_booking['booking_time'] = str(formatted_booking['booking_time'])
            if formatted_booking.get('created_at'):
                formatted_booking['created_at'] = formatted_booking['created_at'].isoformat()
            if formatted_booking.get('total_cost'):
                formatted_booking['total_cost'] = float(formatted_booking['total_cost'])
            formatted_bookings.append(formatted_booking)
        
        cursor.close()
        conn.close()
        
        return jsonify({'bookings': formatted_bookings}), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@booking_bp.route('/customer/<int:customer_id>/favorite-chefs', methods=['GET'])
def get_favorite_chefs(customer_id):
    """Get customer's favorite chefs"""
    try:
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True)
        
        cursor.execute('''
            SELECT 
                c.id as chef_id,
                c.first_name,
                c.last_name,
                c.first_name || ' ' || c.last_name as full_name,
                c.email,
                c.phone,
                c.photo_url,
                STRING_AGG(ct.name, ', ' ORDER BY ct.name) as cuisines,
                crs.average_rating,
                crs.total_reviews,
                --csa.city,
                --csa.state,
                --cp.base_rate_per_person,
                fcf.created_at as favorited_at
            FROM customer_favorite_chefs fcf
            JOIN chefs c ON fcf.chef_id = c.id
            LEFT JOIN chef_cuisines cc ON c.id = cc.chef_id
            LEFT JOIN cuisine_types ct ON cc.cuisine_id = ct.id
            LEFT JOIN chef_rating_summary crs ON c.id = crs.chef_id
            --LEFT JOIN chef_service_areas csa ON c.id = csa.chef_id
            --LEFT JOIN chef_pricing cp ON c.id = cp.chef_id
            WHERE fcf.customer_id = %s
            GROUP BY c.id, c.first_name, c.last_name, c.email, c.phone, c.photo_url,
                    --csa.city, csa.state, cp.base_rate_per_person,
                    fcf.created_at, crs.average_rating, crs.total_reviews
            ORDER BY fcf.created_at DESC
        ''', (customer_id,))
        
        favorite_chefs = cursor.fetchall()
        
        # Format data
        formatted_chefs = []
        for chef in favorite_chefs:
            chef_data = dict(chef)
            if chef_data.get('favorited_at'):
                chef_data['favorited_at'] = chef_data['favorited_at'].isoformat()
            if chef_data.get('cuisines'):
                chef_data['cuisines'] = chef_data['cuisines'].split(',')
            if chef_data.get('base_rate_per_person'):
                chef_data['base_rate_per_person'] = float(chef_data['base_rate_per_person'])
            chef_data['rating'] = {
                    'average_rating': round(float(chef['average_rating']), 2) if chef['average_rating'] else None,
                    'total_reviews': chef['total_reviews'] or 0
                }
            formatted_chefs.append(chef_data)
        
        cursor.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'favorite_chefs': formatted_chefs,
            'count': len(formatted_chefs)
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@booking_bp.route('/customer/<int:customer_id>/favorite-chefs/<int:chef_id>', methods=['GET'])
def get_is_favorite_chef(customer_id, chef_id):
    """See if a chef is in a customer's favorites"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT * FROM customer_favorite_chefs 
            WHERE customer_id = %s AND chef_id = %s
        ''', (customer_id, chef_id))
        
        favorited_chef = cursor.fetchall()
        cursor.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'is_favorited': True if favorited_chef else False
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@booking_bp.route('/customer/<int:customer_id>/favorite-chefs/<int:chef_id>', methods=['POST'])
def add_favorite_chef(customer_id, chef_id):
    """Add a chef to customer's favorites"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO customer_favorite_chefs (customer_id, chef_id) VALUES (%s, %s) ON CONFLICT DO NOTHING
        ''', (customer_id, chef_id))
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({'message': 'Chef added to favorites successfully'}), 201
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@booking_bp.route('/customer/<int:customer_id>/favorite-chefs/<int:chef_id>', methods=['DELETE'])
def remove_favorite_chef(customer_id, chef_id):
    """Remove a chef from customer's favorites"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            DELETE FROM customer_favorite_chefs 
            WHERE customer_id = %s AND chef_id = %s
        ''', (customer_id, chef_id))
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({'message': 'Chef removed from favorites successfully'}), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@booking_bp.route('/customer/<int:customer_id>/recent-chefs', methods=['GET'])
def get_recent_chefs(customer_id):
    """Get chefs the customer has recently completed appointments with"""
    try:
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True)
        
        limit = request.args.get('limit', 10, type=int)
        
        cursor.execute('''
            SELECT DISTINCT
                c.id as chef_id,
                c.first_name,
                c.last_name,
                c.first_name || ' ' || c.last_name as chef_name,
                c.email,
                c.phone,
                c.photo_url,
                STRING_AGG(ct.name, ', ' ORDER BY ct.name) as cuisines,
                AVG(cr.rating) as average_rating,
                COUNT(cr.rating) as total_reviews,
                csa.city,
                csa.state,
                cp.base_rate_per_person,
                MAX(b.booking_date) as last_completed_date,
                COUNT(DISTINCT b.id) as completed_bookings
            FROM bookings b
            JOIN chefs c ON b.chef_id = c.id
            LEFT JOIN chef_cuisines cc ON c.id = cc.chef_id
            LEFT JOIN cuisine_types ct ON cc.cuisine_id = ct.id
            LEFT JOIN chef_ratings cr ON c.id = cr.chef_id
            LEFT JOIN chef_service_areas csa ON c.id = csa.chef_id
            LEFT JOIN chef_pricing cp ON c.id = cp.chef_id
            WHERE b.customer_id = %s AND b.chef_id IS NOT NULL AND b.status = 'completed'
            GROUP BY c.id, c.first_name, c.last_name, c.email, c.phone, c.photo_url,
                     csa.city, csa.state, cp.base_rate_per_person
            ORDER BY MAX(b.booking_date) DESC, MAX(b.booking_time) DESC
            LIMIT %s
        ''', (customer_id, limit))
        
        recent_chefs = cursor.fetchall()
        
        # Format data
        formatted_chefs = []
        for chef in recent_chefs:
            chef_data = dict(chef)
            if chef_data.get('last_completed_date'):
                chef_data['last_completed_date'] = str(chef_data['last_completed_date'])
            if chef_data.get('cuisines'):
                chef_data['cuisines'] = chef_data['cuisines'].split(',')
            if chef_data.get('average_rating'):
                chef_data['average_rating'] = round(float(chef_data['average_rating']), 2)
            if chef_data.get('base_rate_per_person'):
                chef_data['base_rate_per_person'] = float(chef_data['base_rate_per_person'])
            formatted_chefs.append(chef_data)
        
        cursor.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'recent_chefs': formatted_chefs,
            'count': len(formatted_chefs)
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@booking_bp.route('/customer/<int:customer_id>/nearby-chefs', methods=['GET'])
def get_nearby_chefs(customer_id):
    """Get chefs near the customer's location"""
    try:
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True)
        
        limit = request.args.get('limit', 20, type=int)
        max_distance = request.args.get('max_distance', 25, type=int)  # miles
        
        # Get customer's default address
        cursor.execute('''
            SELECT zip_code, city, state
            FROM customer_addresses 
            WHERE customer_id = %s AND is_default = TRUE
            LIMIT 1
        ''', (customer_id,))
        
        customer_address = cursor.fetchone()
        if not customer_address:
            return jsonify({'error': 'Customer address not found'}), 404
        
        customer_lat, customer_lon = get_zip_coordinates(customer_address['zip_code'])
        
        cursor.execute('''
            SELECT 
                c.id as chef_id,
                c.first_name,
                c.last_name,
                c.first_name || ' ' || c.last_name as chef_name,
                c.email,
                c.phone,
                c.photo_url,
                STRING_AGG(ct.name, ', ' ORDER BY ct.name) as cuisines,
                AVG(cr.rating) as average_rating,
                COUNT(cr.rating) as total_reviews,
                csa.city,
                csa.state,
                csa.zip_code,
                csa.service_radius_miles,
                cp.base_rate_per_person
            FROM chefs c
            LEFT JOIN chef_cuisines cc ON c.id = cc.chef_id
            LEFT JOIN cuisine_types ct ON cc.cuisine_id = ct.id
            LEFT JOIN chef_ratings cr ON c.id = cr.chef_id
            JOIN chef_service_areas csa ON c.id = csa.chef_id
            LEFT JOIN chef_pricing cp ON c.id = cp.chef_id
            GROUP BY c.id, c.first_name, c.last_name, c.email, c.phone, c.photo_url,
                     csa.city, csa.state, csa.zip_code, csa.service_radius_miles, cp.base_rate_per_person
        ''')
        
        all_chefs = cursor.fetchall()
        
        # Calculate distances and filter
        nearby_chefs = []
        for chef in all_chefs:
            chef_lat, chef_lon = get_zip_coordinates(chef['zip_code'])
            distance = calculate_distance(customer_lat, customer_lon, chef_lat, chef_lon)
            
            # Check if customer is within chef's service radius and within max_distance
            service_radius = chef['service_radius_miles'] or 10
            if distance <= min(service_radius, max_distance):
                chef_data = dict(chef)
                chef_data['distance_miles'] = round(distance, 1)
                if chef_data.get('cuisines'):
                    chef_data['cuisines'] = chef_data['cuisines'].split(',')
                if chef_data.get('average_rating'):
                    chef_data['average_rating'] = round(float(chef_data['average_rating']), 2)
                if chef_data.get('base_rate_per_person'):
                    chef_data['base_rate_per_person'] = float(chef_data['base_rate_per_person'])
                nearby_chefs.append(chef_data)
        
        # Sort by distance
        nearby_chefs.sort(key=lambda x: x['distance_miles'])
        nearby_chefs = nearby_chefs[:limit]
        
        cursor.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'nearby_chefs': nearby_chefs,
            'count': len(nearby_chefs),
            'customer_location': {
                'city': customer_address['city'],
                'state': customer_address['state'],
                'zip_code': customer_address['zip_code']
            },
            'max_distance_miles': max_distance
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@booking_bp.route('/chef/<int:chef_id>/bookings', methods=['GET'])
def get_finished_chef_bookings(chef_id):
    """Get chef bookings that need confirmation"""
    try:
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True)
        
        # Base query
        query = '''
            SELECT 
                b.id as booking_id,
                b.booking_date,
                b.booking_time,
                b.cuisine_type,
                b.meal_type,
                b.event_type,
                b.number_of_people,
                b.special_notes,
                b.status,
                b.total_cost,
                b.produce_supply,
                b.created_at,
                b.updated_at,
                b.chef_review,
                c.first_name || ' ' || c.last_name as customer_name,
                c.email as customer_email,
                c.phone as customer_phone,
                ca.address_line1 as chef_address_line1,
                ca.address_line2 as chef_address_line2,
                ca.city as chef_city,
                ca.state as chef_state,
                ca.zip_code as chef_zip_code
            FROM bookings b
            JOIN customers c ON b.customer_id = c.id
            JOIN chefs ch ON b.chef_id = ch.id
            LEFT JOIN chef_addresses ca ON ch.id = ca.chef_id AND ca.is_default = TRUE
            WHERE b.chef_id = %s and b.chef_review = FALSE
        '''
        
        params = [chef_id]
        
        query += ' ORDER BY b.booking_date DESC, b.booking_time DESC'
        
        cursor.execute(query, tuple(params))
        bookings = cursor.fetchall()
        
        # Format the results
        formatted_bookings = []
        for booking in bookings:
            formatted_booking = dict(booking)
            # Format date and time
            if formatted_booking.get('booking_date'):
                formatted_booking['booking_date'] = formatted_booking['booking_date'].strftime('%Y-%m-%d')
            if formatted_booking.get('booking_time'):
                formatted_booking['booking_time'] = str(formatted_booking['booking_time'])
            if formatted_booking.get('total_cost'):
                formatted_booking['total_cost'] = float(formatted_booking['total_cost'])
            formatted_bookings.append(formatted_booking)
        
        cursor.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'bookings': formatted_bookings,
            'count': len(formatted_bookings)
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
@booking_bp.route('/chef/<int:chef_id>/bookings/finished', methods=['GET'])
def get_chef_bookings(chef_id):
    """Get all bookings for a specific chef"""
    try:        
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True)
        
        # Base query
        query = '''
            SELECT 
                b.id as booking_id,
                b.booking_date,
                b.booking_time,
                --b.cuisine_type,
                --b.meal_type,
                --b.event_type,
                --b.number_of_people,
                b.special_notes,
                --b.status,
                b.total_cost,
                --b.produce_supply,
                --b.created_at,
                --b.updated_at,
                c.first_name || ' ' || c.last_name as customer_name,
                c.photo_url as customer_photo--,
                --c.email as customer_email,
                --c.phone as customer_phone,
                --ca.address_line1 as chef_address_line1,
                --ca.address_line2 as chef_address_line2,
                --ca.city as chef_city,
                --ca.state as chef_state,
                --ca.zip_code as chef_zip_code
            FROM bookings b
            JOIN customers c ON b.customer_id = c.id
            JOIN chefs ch ON b.chef_id = ch.id
            LEFT JOIN chef_addresses ca ON ch.id = ca.chef_id AND ca.is_default = TRUE
            WHERE b.status = 'completed' AND b.chef_id = %s AND b.chef_review = FALSE 
            ORDER BY b.booking_date ASC 
        '''
        
        cursor.execute(query, (chef_id,))
        finished_bookings = cursor.fetchall()
        
        # Convert datetime/date objects to strings for JSON serialization
        def format_booking_data(bookings):
            formatted = []
            for booking in bookings:
                formatted_booking = dict(booking)
                # Convert date to string
                if formatted_booking.get('booking_date'):
                    formatted_booking['booking_date'] = str(formatted_booking['booking_date'])
                # Convert time to string
                if formatted_booking.get('booking_time'):
                    formatted_booking['booking_time'] = str(formatted_booking['booking_time'])
                # Convert datetime to string
                if formatted_booking.get('created_at'):
                    formatted_booking['created_at'] = formatted_booking['created_at'].isoformat()
                # Convert decimal to float
                if formatted_booking.get('total_cost'):
                    formatted_booking['total_cost'] = float(formatted_booking['total_cost'])
                formatted.append(formatted_booking)
            return formatted
        
        cursor.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'bookings': format_booking_data(finished_bookings),
            'count': len(finished_bookings),
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@booking_bp.route('/booking/<int:booking_id>/status', methods=['PUT'])
def update_booking_status(booking_id):
    """Update booking status (for chef to accept/decline bookings)"""
    try:
        data = request.get_json()
        new_status = data.get('status')
        
        if not new_status:
            return jsonify({'error': 'Status is required'}), 400
        
        # Validate status
        valid_statuses = ['pending', 'accepted', 'declined', 'completed', 'cancelled']
        if new_status not in valid_statuses:
            return jsonify({'error': f'Invalid status. Must be one of: {", ".join(valid_statuses)}'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            UPDATE bookings 
            SET status = %s, updated_at = CURRENT_TIMESTAMP
            WHERE id = %s
        ''', (new_status, booking_id))
        
        if cursor.rowcount == 0:
            return jsonify({'error': 'Booking not found'}), 404
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'message': f'Booking status updated to {new_status}'
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Calendar endpoints: bookings with derived duration_minutes (MAX prep_time per chef+cuisine)
@booking_bp.route('/customer/<int:customer_id>/calendar', methods=['GET'])
def calendar_for_customer(customer_id: int):
    """
    Return customer's bookings within a date range, including duration_minutes
    derived from chef_menu_items.prep_time (max per cuisine/chef). Fallback 60.
    Query params: start=YYYY-MM-DD, end=YYYY-MM-DD (inclusive).
    """
    start = request.args.get("start")
    end = request.args.get("end")
    try:
        start_d = _date.fromisoformat(start) if start else None
        end_d = _date.fromisoformat(end) if end else None
        if not start_d or not end_d:
            return jsonify({"success": False, "error": "start and end (YYYY-MM-DD) are required"}), 400
    except Exception:
        return jsonify({"success": False, "error": "Invalid date format"}), 400

    conn = get_db_connection()
    cur = get_cursor(conn, dictionary=True)
    try:
        cur.execute(
            """
            SELECT
              b.id AS booking_id,
              b.customer_id,
              b.chef_id,
              b.booking_date,
              b.booking_time,
              b.status,
              b.special_notes,
              b.cuisine_type,
              b.meal_type,
              COALESCE(MAX(cmi.prep_time), 60) AS duration_minutes
            FROM bookings b
            LEFT JOIN chef_menu_items cmi
              ON cmi.chef_id = b.chef_id
             AND (b.cuisine_type IS NULL OR cmi.cuisine_type = b.cuisine_type)
            WHERE b.customer_id = %s
              AND b.booking_date BETWEEN %s AND %s
            GROUP BY
              b.id, b.customer_id, b.chef_id, b.booking_date, b.booking_time, b.status,
              b.special_notes, b.cuisine_type, b.meal_type
            ORDER BY b.booking_date, b.booking_time
            """,
            (customer_id, start_d, end_d),
        )
        rows = cur.fetchall()

        data = []
        for r in rows:
            bd = r.get("booking_date")
            bt_raw = r.get("booking_time")
            booking_date = str(bd) if bd is not None else None
            booking_time = (
                bt_raw.strftime("%H:%M")
                if hasattr(bt_raw, "strftime")
                else (str(bt_raw)[:5] if bt_raw else None)
            )
            data.append({
                "booking_id": r.get("booking_id"),
                "customer_id": r.get("customer_id"),
                "chef_id": r.get("chef_id"),
                "booking_date": booking_date,
                "booking_time": booking_time,
                "status": r.get("status") or "pending",
                "special_notes": r.get("special_notes") or "",
                "cuisine_type": r.get("cuisine_type"),
                "meal_type": r.get("meal_type"),
                "duration_minutes": int(r.get("duration_minutes") or 60),
            })

        return jsonify({"success": True, "data": data})
    except Exception as e:
        return handle_db_error(e)
    finally:
        try:
            cur.close()
        finally:
            conn.close()


@booking_bp.route('/chef/<int:chef_id>/calendar', methods=['GET'])
def calendar_for_chef(chef_id: int):
    """
    Return chef's bookings within a date range, including duration_minutes
    derived from chef_menu_items.prep_time (max per cuisine/chef). Fallback 60.
    Query params: start=YYYY-MM-DD, end=YYYY-MM-DD (inclusive).
    """
    start = request.args.get("start")
    end = request.args.get("end")
    try:
        start_d = _date.fromisoformat(start) if start else None
        end_d = _date.fromisoformat(end) if end else None
        if not start_d or not end_d:
            return jsonify({"success": False, "error": "start and end (YYYY-MM-DD) are required"}), 400
    except Exception:
        return jsonify({"success": False, "error": "Invalid date format"}), 400

    conn = get_db_connection()
    cur = get_cursor(conn, dictionary=True)
    try:
        cur.execute(
            """
            SELECT
              b.id AS booking_id,
              b.customer_id,
              b.chef_id,
              b.booking_date,
              b.booking_time,
              b.status,
              b.special_notes,
              b.cuisine_type,
              b.meal_type,
              COALESCE(MAX(cmi.prep_time), 60) AS duration_minutes
            FROM bookings b
            LEFT JOIN chef_menu_items cmi
              ON cmi.chef_id = b.chef_id
             AND (b.cuisine_type IS NULL OR cmi.cuisine_type = b.cuisine_type)
            WHERE b.chef_id = %s
              AND b.booking_date BETWEEN %s AND %s
            GROUP BY
              b.id, b.customer_id, b.chef_id, b.booking_date, b.booking_time, b.status,
              b.special_notes, b.cuisine_type, b.meal_type
            ORDER BY b.booking_date, b.booking_time
            """,
            (chef_id, start_d, end_d),
        )
        rows = cur.fetchall()

        data = []
        for r in rows:
            bd = r.get("booking_date")
            bt_raw = r.get("booking_time")
            booking_date = str(bd) if bd is not None else None
            booking_time = (
                bt_raw.strftime("%H:%M")
                if hasattr(bt_raw, "strftime")
                else (str(bt_raw)[:5] if bt_raw else None)
            )
            data.append({
                "booking_id": r.get("booking_id"),
                "customer_id": r.get("customer_id"),
                "chef_id": r.get("chef_id"),
                "booking_date": booking_date,
                "booking_time": booking_time,
                "status": r.get("status") or "pending",
                "special_notes": r.get("special_notes") or "",
                "cuisine_type": r.get("cuisine_type"),
                "meal_type": r.get("meal_type"),
                "duration_minutes": int(r.get("duration_minutes") or 60),
            })

        return jsonify({"success": True, "data": data})
    except Exception as e:
        return handle_db_error(e)
    finally:
        try:
            cur.close()
        finally:
            conn.close()

@booking_bp.route('/complete/<int:booking_id>', methods=['POST'])
def confirm_booking_completion(booking_id):
    """Confirm a booking as completed"""

    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute('''
            UPDATE bookings
            SET chef_review = TRUE
            WHERE id = %s;
        ''', (booking_id,))

        conn.commit()

        cursor.close()
        conn.close()
        
        return jsonify({'message': 'Rating successfully posted'}), 201
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

#cancel booking logic
@booking_bp.route('/cancel/<int:booking_id>', methods=['POST'])
def cancel_booking(booking_id):
    """Cancel a booking"""
    try:
        data = request.get_json()
        payment_method_id = data.get('payment_method_id')
        
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True)

        cursor.execute('''
            SELECT b.booking_date, b.booking_time, b.total_cost, b.status, c.stripe_customer_id
            FROM bookings b
            JOIN customers c ON b.customer_id = c.id
            WHERE b.id = %s
        ''', (booking_id,))

        booking = cursor.fetchone()
        if not booking:
            return jsonify({'error': 'Booking not found'}), 404

        if booking['status'] in ('cancelled', 'completed'):
            return jsonify({'error': 'Booking cannot be cancelled'}), 400

        booking_datetime = datetime.combine(booking['booking_date'], booking['booking_time'])
        hours_until = (booking_datetime - datetime.now()).total_seconds() / 3600
        cancelation_fee = None

        if hours_until < 24 and booking['total_cost'] and booking['stripe_customer_id'] and payment_method_id:
            import stripe as stripe_lib
            stripe_lib.api_key = __import__('os').environ.get('STRIPE_SECRET_KEY')
            # hardcoded 50% fee for cancellations within 24 hours 
            fee_cents = int(float(booking['total_cost']) * 0.50 * 100) 
            stripe_lib.PaymentIntent.create(
                amount=fee_cents,
                currency='usd',
                customer=booking['stripe_customer_id'],
                payment_method=payment_method_id,
                confirm=True,
                automatic_payment_methods={'enabled': True, 'allow_redirects': 'never'},
                description=f'Cancellation fee for booking {booking_id}',
            )
            cancelation_fee = fee_cents / 100.0

        cursor.execute('''
            UPDATE bookings SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
            WHERE id = %s
        ''', (booking_id,))
        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'message': 'Booking cancelled successfully',
            'cancelation_fee': cancelation_fee,
            'within_24_hours': hours_until < 24
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500

# --- Booking deletion logic: permanently deletes cancelled, declined, or past pending bookings ---
@booking_bp.route('/delete/<int:booking_id>', methods=['DELETE'])
def delete_booking(booking_id):
    try:
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True)

        cursor.execute('SELECT status, booking_date FROM bookings WHERE id = %s', (booking_id,))
        booking = cursor.fetchone()

        if not booking:
            return jsonify({'error': 'Booking not found'}), 404

        status = booking['status']
        booking_date = booking['booking_date']
        today = datetime.now().date()

        is_past_pending = status == 'pending' and booking_date < today
        is_deletable = status in ('cancelled', 'declined') or is_past_pending

        if not is_deletable:
            return jsonify({'error': 'Booking cannot be deleted'}), 400

        cursor.execute('DELETE FROM bookings WHERE id = %s', (booking_id,))
        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({'success': True, 'message': 'Booking deleted successfully'}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500
# --- End booking deletion logic ---