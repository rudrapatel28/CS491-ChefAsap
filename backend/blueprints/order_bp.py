from flask import Blueprint, request, jsonify
from datetime import datetime
from database.config import db_config
from database.db_helper import get_db_connection, get_cursor, handle_db_error

# Create the blueprint
order_bp = Blueprint('order', __name__)

@order_bp.route('/create', methods=['POST'])
def create_order():
    """Create a new order with menu items"""
    try:
        data = request.get_json()
        
        customer_id = data.get('customer_id')
        guest_id = data.get('guest_id')
        chef_id = data.get('chef_id')
        order_items = data.get('order_items', [])  # Array of {menu_item_id, quantity, unit_price, dish_name}
        delivery_address = data.get('delivery_address', '')
        special_instructions = data.get('special_instructions', '')
        delivery_datetime = data.get('delivery_datetime')  # ISO format datetime string
        
        # Validation
        if customer_id and guest_id:
            return jsonify({'error': 'Use either customer_id or guest_id, not both'}), 400

        if not (customer_id or guest_id) or not chef_id or not order_items:
            return jsonify({'error': 'Missing required fields'}), 400
        
        if not isinstance(order_items, list) or len(order_items) == 0:
            return jsonify({'error': 'Order must contain at least one item'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()

        if guest_id:
            cursor.execute('SELECT id FROM guests WHERE id = %s', (guest_id,))
            if not cursor.fetchone():
                cursor.close()
                conn.close()
                return jsonify({'error': 'Guest not found'}), 404
        
        # Calculate total amount and max prep time
        total_amount = 0
        max_prep_time = 0
        
        for item in order_items:
            if not all(key in item for key in ['menu_item_id', 'quantity', 'unit_price', 'dish_name']):
                return jsonify({'error': 'Invalid order item format'}), 400
            
            quantity = int(item['quantity'])
            unit_price = float(item['unit_price'])
            total_amount += quantity * unit_price
            
            # Get prep time from menu item
            cursor.execute('SELECT prep_time FROM chef_menu_items WHERE id = %s', (item['menu_item_id'],))
            result = cursor.fetchone()
            if result and result[0]:
                max_prep_time = max(max_prep_time, result[0])
        
        # Create order
        cursor.execute('''
            INSERT INTO orders (customer_id, guest_id, chef_id, total_amount, estimated_prep_time, 
                              delivery_address, special_instructions, delivery_datetime, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'pending')
            RETURNING id, order_date
        ''', (customer_id, guest_id, chef_id, total_amount, max_prep_time, delivery_address, special_instructions, delivery_datetime))
        
        order_result = cursor.fetchone()
        order_id = order_result[0]
        order_date = order_result[1]
        
        # Insert order items
        for item in order_items:
            quantity = int(item['quantity'])
            unit_price = float(item['unit_price'])
            subtotal = quantity * unit_price
            
            cursor.execute('''
                INSERT INTO order_items (order_id, menu_item_id, dish_name, quantity, 
                                       unit_price, subtotal, special_requests)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            ''', (order_id, item['menu_item_id'], item['dish_name'], quantity, 
                  unit_price, subtotal, item.get('special_requests', '')))
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'message': 'Order created successfully',
            'order_id': order_id,
            'order_date': order_date.isoformat(),
            'total_amount': float(total_amount),
            'estimated_prep_time': max_prep_time
        }), 201
        
    except Exception as e:
        print(f"Error creating order: {e}")
        return jsonify({'error': str(e)}), 500

@order_bp.route('/customer/<int:customer_id>', methods=['GET'])
def get_customer_orders(customer_id):
    """Get all orders for a customer"""
    try:
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True)
        
        cursor.execute('''
            SELECT 
                o.id as order_id,
                o.order_date,
                o.delivery_datetime,               
                o.status,
                o.total_amount,
                o.estimated_prep_time,
                o.delivery_address,
                o.special_instructions,
                c.first_name as chef_first_name,
                c.last_name as chef_last_name,
                c.photo_url as chef_photo,
                COUNT(oi.id) as item_count
            FROM orders o
            JOIN chefs c ON o.chef_id = c.id
            LEFT JOIN order_items oi ON o.id = oi.order_id
            WHERE o.customer_id = %s
            GROUP BY o.id, o.order_date, o.delivery_datetime, o.status, o.total_amount, o.estimated_prep_time,
                     o.delivery_address, o.special_instructions,
                     c.first_name, c.last_name, c.photo_url
            ORDER BY o.order_date DESC
        ''', (customer_id,))
        
        orders = cursor.fetchall()
        
        # Format data
        formatted_orders = []
        for order in orders:
            formatted_order = dict(order)
            if formatted_order.get('order_date'):
                formatted_order['order_date'] = formatted_order['order_date'].isoformat()
            if formatted_order.get('total_amount'):
                formatted_order['total_amount'] = float(formatted_order['total_amount'])
            if formatted_order.get('delivery_datetime'):
                formatted_order['delivery_datetime'] = formatted_order['delivery_datetime'].isoformat()
            formatted_order['chef_name'] = f"{formatted_order['chef_first_name']} {formatted_order['chef_last_name']}"
            formatted_orders.append(formatted_order)
        
        cursor.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'orders': formatted_orders,
            'count': len(formatted_orders)
        }), 200
        
    except Exception as e:
        print(f"Error fetching customer orders: {e}")
        return jsonify({'error': str(e)}), 500

@order_bp.route('/guest/<int:guest_id>', methods=['GET'])
def get_guest_orders(guest_id):
    """Get all orders for a guest"""
    try:
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True)

        cursor.execute('''
            SELECT 
                o.id as order_id,
                o.order_date,
                o.delivery_datetime,
                o.status,
                o.total_amount,
                o.estimated_prep_time,
                o.delivery_address,
                o.special_instructions,
                c.first_name as chef_first_name,
                c.last_name as chef_last_name,
                c.photo_url as chef_photo,
                COUNT(oi.id) as item_count
            FROM orders o
            JOIN chefs c ON o.chef_id = c.id
            LEFT JOIN order_items oi ON o.id = oi.order_id
            WHERE o.guest_id = %s
            GROUP BY o.id, o.order_date, o.delivery_datetime, o.status, o.total_amount, o.estimated_prep_time,
                     o.delivery_address, o.special_instructions,
                     c.first_name, c.last_name, c.photo_url
            ORDER BY o.order_date DESC
        ''', (guest_id,))

        orders = cursor.fetchall()

        formatted_orders = []
        for order in orders:
            formatted_order = dict(order)
            if formatted_order.get('order_date'):
                formatted_order['order_date'] = formatted_order['order_date'].isoformat()
            if formatted_order.get('total_amount'):
                formatted_order['total_amount'] = float(formatted_order['total_amount'])
            if formatted_order.get('delivery_datetime'):
                formatted_order['delivery_datetime'] = formatted_order['delivery_datetime'].isoformat()
            formatted_order['chef_name'] = f"{formatted_order['chef_first_name']} {formatted_order['chef_last_name']}"
            formatted_orders.append(formatted_order)

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'orders': formatted_orders,
            'count': len(formatted_orders)
        }), 200

    except Exception as e:
        print(f"Error fetching guest orders: {e}")
        return jsonify({'error': str(e)}), 500

@order_bp.route('/chef/<int:chef_id>', methods=['GET'])
def get_chef_orders(chef_id):
    """Get all orders for a chef"""
    try:
        status_filter = request.args.get('status')  # Optional filter by status
        
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True)
        
        query = '''
            SELECT 
                o.id as order_id,
                o.order_date,
                o.delivery_datetime,
                o.status,
                o.total_amount,
                o.estimated_prep_time,
                o.delivery_address,
                o.special_instructions,
                cu.first_name as customer_first_name,
                cu.last_name as customer_last_name,
                cu.phone as customer_phone,
                g.first_name as guest_first_name,
                g.last_name as guest_last_name,
                g.phone as guest_phone,
                COUNT(oi.id) as item_count
            FROM orders o
            LEFT JOIN customers cu ON o.customer_id = cu.id
            LEFT JOIN guests g ON o.guest_id = g.id
            LEFT JOIN order_items oi ON o.id = oi.order_id
            WHERE o.chef_id = %s
        '''
        
        params = [chef_id]
        
        if status_filter:
            query += ' AND o.status = %s'
            params.append(status_filter)
        
        query += '''
            GROUP BY o.id, o.order_date, o.delivery_datetime, o.status, o.total_amount, o.estimated_prep_time,
                     o.delivery_address, o.special_instructions,
                     cu.first_name, cu.last_name, cu.phone,
                     g.first_name, g.last_name, g.phone
            ORDER BY o.order_date DESC
        '''
        
        cursor.execute(query, params)
        orders = cursor.fetchall()
        
        # Format data
        formatted_orders = []
        for order in orders:
            formatted_order = dict(order)
            if formatted_order.get('order_date'):
                formatted_order['order_date'] = formatted_order['order_date'].isoformat()
            if formatted_order.get('delivery_datetime'):
                formatted_order['delivery_datetime'] = formatted_order['delivery_datetime'].isoformat()
            if formatted_order.get('total_amount'):
                formatted_order['total_amount'] = float(formatted_order['total_amount'])
            if formatted_order.get('customer_first_name'):
                formatted_order['customer_name'] = f"{formatted_order['customer_first_name']} {formatted_order['customer_last_name']}"
            else:
                formatted_order['customer_name'] = f"{formatted_order.get('guest_first_name') or ''} {formatted_order.get('guest_last_name') or ''}".strip() or 'Guest'
            formatted_orders.append(formatted_order)
        
        cursor.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'orders': formatted_orders,
            'count': len(formatted_orders)
        }), 200
        
    except Exception as e:
        print(f"Error fetching chef orders: {e}")
        return jsonify({'error': str(e)}), 500

@order_bp.route('/<int:order_id>', methods=['GET'])
def get_order_details(order_id):
    """Get detailed information about a specific order including all items"""
    try:
        conn = get_db_connection()
        cursor = get_cursor(conn, dictionary=True)
        
        # Get order info
        cursor.execute('''
            SELECT 
                o.*,
                c.first_name as chef_first_name,
                c.last_name as chef_last_name,
                c.phone as chef_phone,
                c.photo_url as chef_photo,
                cu.first_name as customer_first_name,
                cu.last_name as customer_last_name,
                cu.phone as customer_phone,
                g.first_name as guest_first_name,
                g.last_name as guest_last_name,
                g.phone as guest_phone
            FROM orders o
            JOIN chefs c ON o.chef_id = c.id
            LEFT JOIN customers cu ON o.customer_id = cu.id
            LEFT JOIN guests g ON o.guest_id = g.id
            WHERE o.id = %s
        ''', (order_id,))
        
        order = cursor.fetchone()
        
        if not order:
            return jsonify({'error': 'Order not found'}), 404
        
        # Get order items
        cursor.execute('''
            SELECT 
                oi.*,
                mi.photo_url,
                mi.description,
                mi.cuisine_type
            FROM order_items oi
            LEFT JOIN chef_menu_items mi ON oi.menu_item_id = mi.id
            WHERE oi.order_id = %s
        ''', (order_id,))
        
        items = cursor.fetchall()
        
        # Format order data
        formatted_order = dict(order)
        if formatted_order.get('order_date'):
            formatted_order['order_date'] = formatted_order['order_date'].isoformat()
        if formatted_order.get('created_at'):
            formatted_order['created_at'] = formatted_order['created_at'].isoformat()
        if formatted_order.get('updated_at'):
            formatted_order['updated_at'] = formatted_order['updated_at'].isoformat()
        if formatted_order.get('total_amount'):
            formatted_order['total_amount'] = float(formatted_order['total_amount'])
        
        formatted_order['chef_name'] = f"{formatted_order['chef_first_name']} {formatted_order['chef_last_name']}"
        formatted_order['customer_name'] = f"{formatted_order['customer_first_name']} {formatted_order['customer_last_name']}"
        
        # Format items
        formatted_items = []
        for item in items:
            formatted_item = dict(item)
            if formatted_item.get('unit_price'):
                formatted_item['unit_price'] = float(formatted_item['unit_price'])
            if formatted_item.get('subtotal'):
                formatted_item['subtotal'] = float(formatted_item['subtotal'])
            if formatted_item.get('created_at'):
                formatted_item['created_at'] = formatted_item['created_at'].isoformat()
            formatted_items.append(formatted_item)
        
        formatted_order['items'] = formatted_items
        formatted_order['item_count'] = len(formatted_items)
        
        cursor.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'order': formatted_order
        }), 200
        
    except Exception as e:
        print(f"Error fetching order details: {e}")
        return jsonify({'error': str(e)}), 500

@order_bp.route('/<int:order_id>/status', methods=['PUT'])
def update_order_status(order_id):
    """Update order status (for chef to confirm/update orders)"""
    try:
        data = request.get_json()
        new_status = data.get('status')
        
        valid_statuses = ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled']
        if new_status not in valid_statuses:
            return jsonify({'error': f'Invalid status. Must be one of: {", ".join(valid_statuses)}'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            UPDATE orders 
            SET status = %s, updated_at = CURRENT_TIMESTAMP
            WHERE id = %s
            RETURNING id, status
        ''', (new_status, order_id))
        
        result = cursor.fetchone()
        
        if not result:
            return jsonify({'error': 'Order not found'}), 404
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'message': f'Order status updated to {new_status}',
            'order_id': result[0],
            'status': result[1]
        }), 200
        
    except Exception as e:
        print(f"Error updating order status: {e}")
        return jsonify({'error': str(e)}), 500

@order_bp.route('/<int:order_id>', methods=['DELETE'])
def cancel_order(order_id):
    """Cancel an order (soft delete by setting status to cancelled)"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            UPDATE orders 
            SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
            WHERE id = %s AND status = 'pending'
            RETURNING id
        ''', (order_id,))
        
        result = cursor.fetchone()
        
        if not result:
            return jsonify({'error': 'Order not found or cannot be cancelled'}), 404
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'message': 'Order cancelled successfully'
        }), 200
        
    except Exception as e:
        print(f"Error cancelling order: {e}")
        return jsonify({'error': str(e)}), 500


@order_bp.route('/chef/<int:chef_id>/availability', methods=['GET'])
def get_chef_availability(chef_id):
    """Get chef's available time slots"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get chef's available days and time ranges
        cursor.execute('''
            SELECT day_of_week, start_time, end_time
            FROM chef_availability_days
            WHERE chef_id = %s
            ORDER BY 
                CASE day_of_week
                    WHEN 'monday' THEN 1
                    WHEN 'tuesday' THEN 2
                    WHEN 'wednesday' THEN 3
                    WHEN 'thursday' THEN 4
                    WHEN 'friday' THEN 5
                    WHEN 'saturday' THEN 6
                    WHEN 'sunday' THEN 7
                END
        ''', (chef_id,))
        
        availability_days = cursor.fetchall()
        
        # Get chef's meal availability
        cursor.execute('''
            SELECT meal_type, is_available
            FROM chef_meal_availability
            WHERE chef_id = %s
        ''', (chef_id,))
        
        meal_availability = cursor.fetchall()
        
        cursor.close()
        conn.close()
        
        # Format the response
        available_days = {}
        for day, start_time, end_time in availability_days:
            available_days[day] = {
                'start_time': str(start_time),
                'end_time': str(end_time)
            }
        
        available_meals = {}
        for meal_type, is_available in meal_availability:
            available_meals[meal_type] = is_available
        
        return jsonify({
            'success': True,
            'chef_id': chef_id,
            'available_days': available_days,
            'available_meals': available_meals
        }), 200
        
    except Exception as e:
        print(f"Error getting chef availability: {e}")
        return jsonify({'error': str(e)}), 500
