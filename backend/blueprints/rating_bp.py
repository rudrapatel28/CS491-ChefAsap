from flask import Blueprint, request, jsonify
from database.config import db_config
from database.db_helper import get_db_connection, get_cursor
import psycopg2

rating_bp = Blueprint('rating', __name__)

@rating_bp.route('/chef/<int:chef_id>', methods=['POST'])
def add_chef_rating(chef_id):
    """Add a rating/review for a chef"""
    data = request.get_json()
    customer_id = data.get('customer_id')
    booking_id = data.get('booking_id')
    rating = data.get('rating')
    review = data.get('review', '')

    if not all([customer_id, booking_id, rating]):
        return jsonify({'error': 'Missing required fields'}), 400

    # For now, round to nearest integer since DB only supports INTEGER
    rating = round(rating)

    if not (1 <= rating <= 5):
        return jsonify({'error': 'Rating must be between 1 and 5'}), 400

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute('''
            INSERT INTO chef_ratings (booking_id, chef_id, customer_id, rating, review_text)
            VALUES (%s, %s, %s, %s, %s)
        ''', (booking_id, chef_id, customer_id, rating, review))

        cursor.execute('''
            UPDATE bookings
            SET customer_review = TRUE
            WHERE id = %s;
        ''', (booking_id,))

        conn.commit()

        return jsonify({'message': 'Rating successfully posted'}), 201

    except psycopg2.errors.UniqueViolation:
        if conn:
            conn.rollback()
        return jsonify({'error': 'You have already rated this booking'}), 409
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
    
@rating_bp.route('/chef/<int:chef_id>', methods=['GET'])
def get_chef_ratings(chef_id):
    """Get all ratings and reviews for a chef"""
    try:
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True)

        # Get average rating and total count
        cursor.execute('''
            SELECT COUNT(*) as total_ratings, AVG(rating) as avg_rating 
            FROM chef_ratings
            WHERE chef_id = %s
        ''', (chef_id,))
        ratings_data = cursor.fetchone()

        # Get all reviews with customer names
        cursor.execute('''
            SELECT 
                r.id,
                r.customer_id, 
                r.rating, 
                r.review_text as comment, 
                r.created_at,
                c.first_name || ' ' || c.last_name as customer_name
            FROM chef_ratings r
            JOIN customers c ON r.customer_id = c.id
            WHERE r.chef_id = %s
            ORDER BY r.created_at DESC
        ''', (chef_id,))
        reviews = cursor.fetchall()

        # Format reviews
        formatted_reviews = []
        for review in reviews:
            formatted_review = dict(review)
            if formatted_review.get('created_at'):
                formatted_review['created_at'] = formatted_review['created_at'].isoformat()
            formatted_reviews.append(formatted_review)

        cursor.close()
        conn.close()

        avg_rating = float(ratings_data['avg_rating']) if ratings_data['avg_rating'] else 0.0

        return jsonify({
            'chef_id': chef_id,
            'avg_rating': round(avg_rating, 2),
            'total_reviews': ratings_data['total_ratings'],
            'reviews': formatted_reviews
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500
