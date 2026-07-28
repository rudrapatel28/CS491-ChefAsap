from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
import os

basedir = os.path.abspath(os.path.dirname(__file__))
load_dotenv(os.path.join(basedir, '.env.local'))
load_dotenv(os.path.join(basedir, '.env'))

from flask_bcrypt import Bcrypt
from database.config import db_config

from database.db_helper import get_db_connection, get_cursor
from blueprints.auth_bp import auth_bp


from blueprints.booking_bp import booking_bp
from blueprints.profile_bp import profile_bp
from blueprints.chat_bp import chat_bp
from blueprints.search_bp import search_bp
from blueprints.geocoding_bp import geocoding_bp
from blueprints.search_location_bp import search_location_bp
from blueprints.menu_bp import menu_bp
from blueprints.calendar_bp import calendar_bp
from blueprints.order_bp import order_bp
from blueprints.rating_bp import rating_bp
# from blueprints.payment_bp import payment_bp  # 已弃用 - 使用 Stripe 代替
from blueprints.stripe_payment_bp import stripe_payment_bp
from blueprints.account_deletion_bp import account_deletion_bp

from blueprints.analytics_bp import analytics_bp
from blueprints.dashboard_bp import dashboard_bp
from blueprints.pricing_bp import pricing_bp
from blueprints.menu_event_planner_bp import menu_event_planner_bp
from blueprints.recommendation_bp import recommendation_bp
from blueprints.chef_productivity_bp import chef_productivity_bp
import socket

app = Flask(__name__)


def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    return response

app.after_request(add_cors_headers)


bcrypt = Bcrypt(app)


app.register_blueprint(auth_bp, url_prefix='/auth')


app.register_blueprint(booking_bp, url_prefix='/booking')


app.register_blueprint(profile_bp, url_prefix='/profile')

app.register_blueprint(chat_bp)

app.register_blueprint(search_bp, url_prefix='/search')

app.register_blueprint(geocoding_bp, url_prefix='/geocoding')

app.register_blueprint(search_location_bp, url_prefix='/api')

app.register_blueprint(menu_bp)

app.register_blueprint(calendar_bp, url_prefix='/calendar')

app.register_blueprint(order_bp, url_prefix='/api/orders')

app.register_blueprint(rating_bp, url_prefix='/rating')

# app.register_blueprint(payment_bp, url_prefix='/payment')  # 已弃用 - 使用 Stripe 代替

app.register_blueprint(stripe_payment_bp, url_prefix='/stripe-payment')

app.register_blueprint(account_deletion_bp)

app.register_blueprint(analytics_bp, url_prefix='/api/v1/analytics')
app.register_blueprint(dashboard_bp)
app.register_blueprint(pricing_bp, url_prefix='/api/v1/pricing')
app.register_blueprint(menu_event_planner_bp, url_prefix='/api/v1/menu-planner')
app.register_blueprint(recommendation_bp, url_prefix='/api/v1/recommendations')
app.register_blueprint(chef_productivity_bp, url_prefix='/api/v1/chef-productivity')

@app.route('/')
def index():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.close()
        conn.close()
        return 'Flask and PostgreSQL connection successful!'
    except Exception as e:
        return f'Error: {str(e)}'

@app.route('/static/<path:filename>')
def serve_static(filename):
    """Serve static files"""
    return send_from_directory('static', filename)

@app.route('/__routes__')
def __routes__():
    return "<pre>" + "\n".join(sorted(f"{','.join(sorted(r.methods))} {r.rule}" for r in app.url_map.iter_rules())) + "</pre>"

""" ---- Debug route to check JWT secret key loading - This is just for testing purposes and should be removed or protected in production! 
@app.route('/debug/jwt-check')
def jwt_check():
    secret = os.environ.get('JWT_SECRET_KEY', 'NOT SET')
    return jsonify({
        'first_10': secret[:10],
        'length': len(secret)
    })
"""
if __name__ == '__main__':
    hostname = socket.gethostname()
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        local_ip = s.getsockname()[0]
    except Exception:
        local_ip = '127.0.0.1'
    finally:
        s.close()

    print(f'Server starting on {local_ip}:3000')
    app.run(debug=True, host='0.0.0.0', port=3000, threaded=True)
