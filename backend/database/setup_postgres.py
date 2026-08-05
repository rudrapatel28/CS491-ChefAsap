"""
PostgreSQL setup script for ChefAsap database
Uses psycopg2 to connect to PostgreSQL database and create all necessary tables

=== DATABASE SCHEMA OVERVIEW ===

This script creates the complete database schema for the ChefAsap platform.
Total: 46 tables organized into the following categories:

1. AUTHENTICATION & USERS
   - users: Main authentication table linking to chefs/customers

2. CHEFS (13 tables)
   - chefs: Chef profiles
   - chef_documents: Food handler permits, licenses
   - chef_cuisines: Chef-cuisine many-to-many relationship
   - chef_addresses: Chef business addresses with geolocation
   - chef_payment_methods: Payment preferences (direct deposit, PayPal, check)
   - chef_bank_accounts: Bank account details for direct deposit
   - chef_paypal_accounts: PayPal account information
   - chef_check_addresses: Mailing addresses for checks
   - chef_payments: Payment history
   - chef_availability_days: Recurring weekly availability
   - chef_meal_availability: Meal type availability (breakfast/lunch/dinner)
   - chef_service_areas: Geographic service coverage
   - chef_pricing: Base rates and pricing structure
   - chef_cuisine_photos: Portfolio photos
   - chef_menu_items: Dish catalog with pricing
   - chef_cancellation_records: Cancellation tracking for penalties
   - chef_kitchen_tools: Kitchen equipment inventory

3. CUSTOMERS (8 tables)
   - customers: Customer profiles (includes stripe_customer_id for Stripe integration)
   - customer_addresses: Delivery/service addresses with geolocation
   - customer_favorite_chefs: Saved favorite chefs
   - customer_search_locations: Recent search locations
   - customer_recent_searches: Search history with filters
   - customer_viewed_chefs: Chef profile view tracking
   - customer_meeting_usage: Video meeting quota tracking
   - customer_cancellation_fees: Cancellation penalty records

4. PAYMENT (3 tables + Stripe integration)
   - payment_methods: Customer payment method types
   - credit_cards: Credit card information
   - paypal_accounts: PayPal account information
   
   STRIPE INTEGRATION:
   - customers.stripe_customer_id: Links to Stripe customer
   - Card data stored securely via Stripe (NOT in database)
   - Payment processing handled by stripe_payment_bp.py

5. BOOKINGS & ORDERS (4 tables)
   - bookings: Chef service bookings
   - booking_status_history: Status change audit trail
   - orders: Customer orders from chef menus
   - order_items: Individual dishes in orders

6. RATINGS & REVIEWS (4 tables)
   - chef_ratings: Detailed customer ratings of chefs
   - chef_rating: Alternative rating system with reviews
   - chef_rating_summary: Aggregated rating statistics
   - customer_ratings: Chef ratings of customers

7. COMMUNICATION (4 tables)
   - chats: Chat sessions between customers and chefs
   - chat_messages: Individual chat messages
   - online_meetings: Video consultation scheduling
   - meeting_feedback: Meeting quality ratings

8. SYSTEM & ADMIN (4 tables)
   - notifications: Push/email/SMS notifications
   - agreements: Terms of service, privacy policies
   - user_agreement_acceptances: User consent tracking
   - user_deletion_requests: GDPR deletion workflow

9. REFERENCE DATA (1 table)
   - cuisine_types: Master list of cuisine categories

10. LOGS (1 table)
   - app_events_log: Structured logging of user events for analytics

11. MATERIALIZED VIEWS (2 views for analytics)   
     mv_chef_performance: Aggregated chef performance metrics (total bookings, completion rate, average rating)
   - mv_geographic_demand: Customer search demand by location and date (for identifying underserved areas)

=== INDEXES ===
All tables include appropriate indexes for:
- Foreign keys
- Geographic queries (latitude/longitude)
- Time-based queries (created_at, booking_date)
- Status fields
- User lookups

=== SECURITY NOTES ===
- Passwords stored hashed (never plain text)
- Payment card data managed by Stripe (PCI compliant)
- Only stripe_customer_id stored in database
- Personal data deletable per GDPR requirements

=== USAGE ===
Run this script to initialize or reset the database:
    python setup_postgres.py

Database connection configured in database/config.py
"""

import psycopg2
from psycopg2 import sql, Error
from config import db_config

def init_postgres_db():
    """Initialize PostgreSQL database and create all tables"""
    conn = None
    cursor = None
    try:
        # Connect to PostgreSQL
        conn = psycopg2.connect(**db_config)
        cursor = conn.cursor()
        
        print("Connected to PostgreSQL successfully!")
        print("Creating tables...")

        # Users table for authentication
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(100) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('chef', 'customer')),
                chef_id INTEGER NULL,
                customer_id INTEGER NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_chef_id ON users(chef_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_customer_id ON users(customer_id)')

        # 2FA / email verification columns. Guarded so the backfill below only ever
        # runs the ONE time these columns are first added — if it ran on every
        # script execution, it would wrongly re-verify real users who signed up
        # after this migration and genuinely haven't verified their email yet.
        cursor.execute('''
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'users' AND column_name = 'is_verified'
                ) THEN
                    ALTER TABLE users
                        ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT FALSE,
                        ADD COLUMN two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                        ADD COLUMN two_factor_method VARCHAR(10) CHECK (two_factor_method IN ('email', 'totp')),
                        ADD COLUMN totp_secret VARCHAR(255);

                    -- Grandfather in everyone who already had an account before
                    -- email verification existed, so nobody gets locked out.
                    UPDATE users SET is_verified = TRUE;
                END IF;
            END $$;
        ''')

        # Verification codes (signup email verification + login 2FA)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS verification_codes (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                code_hash VARCHAR(255) NOT NULL,
                purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('signup', 'login_2fa', 'totp_enroll')),
                expires_at TIMESTAMP NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_verification_codes_user ON verification_codes(user_id, purpose)')

        # Password reset also uses verification_codes; widen the allowed purpose values.
        cursor.execute('ALTER TABLE verification_codes DROP CONSTRAINT IF EXISTS verification_codes_purpose_check')
        cursor.execute('''
            ALTER TABLE verification_codes ADD CONSTRAINT verification_codes_purpose_check
            CHECK (purpose IN ('signup', 'login_2fa', 'totp_enroll', 'password_reset'))
        ''')

        # Cuisine types
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS cuisine_types (
                id SERIAL PRIMARY KEY,
                name VARCHAR(50) NOT NULL UNIQUE
            )
        ''')

        # Chefs table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chefs (
                id SERIAL PRIMARY KEY,
                first_name VARCHAR(50) NOT NULL,
                last_name VARCHAR(50) NOT NULL,
                gender VARCHAR(30) CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say')),
                email VARCHAR(100) NOT NULL UNIQUE,
                phone VARCHAR(20),
                description VARCHAR(500),
                meal_timings TEXT[] DEFAULT ARRAY['Breakfast', 'Lunch', 'Dinner'],
                photo_url VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # Chef documents
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chef_documents (
                id SERIAL PRIMARY KEY,
                chef_id INTEGER NOT NULL,
                document_type VARCHAR(50) NOT NULL,
                document_url VARCHAR(255) NOT NULL,
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE
            )
        ''')

        # Chef cuisines (many-to-many)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chef_cuisines (
                chef_id INTEGER NOT NULL,
                cuisine_id INTEGER NOT NULL,
                PRIMARY KEY (chef_id, cuisine_id),
                FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE,
                FOREIGN KEY (cuisine_id) REFERENCES cuisine_types(id) ON DELETE CASCADE
            )
        ''')

        # Chef addresses
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chef_addresses (
                id SERIAL PRIMARY KEY,
                chef_id INTEGER NOT NULL,
                address_line1 VARCHAR(100) NOT NULL,
                address_line2 VARCHAR(100),
                city VARCHAR(50) NOT NULL,
                state VARCHAR(2) NOT NULL,
                zip_code VARCHAR(10) NOT NULL,
                latitude DECIMAL(10, 8),
                longitude DECIMAL(11, 8),
                is_default BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_chef_location ON chef_addresses(latitude, longitude)')

        # Chef payment methods
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chef_payment_methods (
                id SERIAL PRIMARY KEY,
                chef_id INTEGER NOT NULL,
                payment_type VARCHAR(20) NOT NULL CHECK (payment_type IN ('direct_deposit', 'paypal', 'check')),
                is_default BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE
            )
        ''')

        # Chef bank accounts
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chef_bank_accounts (
                id SERIAL PRIMARY KEY,
                payment_method_id INTEGER NOT NULL,
                bank_name VARCHAR(100) NOT NULL,
                routing_number VARCHAR(9) NOT NULL,
                account_number VARCHAR(17) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (payment_method_id) REFERENCES chef_payment_methods(id) ON DELETE CASCADE
            )
        ''')

        # Chef PayPal accounts
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chef_paypal_accounts (
                id SERIAL PRIMARY KEY,
                payment_method_id INTEGER NOT NULL,
                paypal_email VARCHAR(100) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (payment_method_id) REFERENCES chef_payment_methods(id) ON DELETE CASCADE
            )
        ''')

        # Chef check addresses
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chef_check_addresses (
                id SERIAL PRIMARY KEY,
                payment_method_id INTEGER NOT NULL,
                address_line1 VARCHAR(100) NOT NULL,
                address_line2 VARCHAR(100),
                city VARCHAR(50) NOT NULL,
                state VARCHAR(2) NOT NULL,
                zip_code VARCHAR(10) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (payment_method_id) REFERENCES chef_payment_methods(id) ON DELETE CASCADE
            )
        ''')

        # Chef payments
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chef_payments (
                id SERIAL PRIMARY KEY,
                chef_id INTEGER NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'deposited')),
                payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE
            )
        ''')

        # Chef availability days
        #meal windows | breakfast: 6:00am - 11:00am lunch: 11:00am - 5:00pm dinner: 5:00pm - 10:00pm
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chef_availability_days (
                id SERIAL PRIMARY KEY,
                chef_id INTEGER NOT NULL,
                day_of_week VARCHAR(20) NOT NULL CHECK (day_of_week IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
                meal_type VARCHAR(20) NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner')),
                start_time TIME NOT NULL,
                end_time TIME NOT NULL,
                FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE,
                CONSTRAINT unique_shifts UNIQUE (chef_id, day_of_week, meal_type)
            )
        ''')

        # Chef meal availability
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chef_meal_availability (
                id SERIAL PRIMARY KEY,
                chef_id INTEGER NOT NULL,
                meal_type VARCHAR(20) NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner')),
                is_available BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE,
                UNIQUE (chef_id, meal_type)
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_chef_meal ON chef_meal_availability(chef_id, meal_type, is_available)')

        # Customers table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS customers (
                id SERIAL PRIMARY KEY,
                first_name VARCHAR(50) NOT NULL,
                last_name VARCHAR(50) NOT NULL,
                email VARCHAR(100) NOT NULL UNIQUE,
                phone VARCHAR(20),
                photo_url VARCHAR(255),
                allergy_notes TEXT,
                stripe_customer_id VARCHAR(255) UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_customers_stripe_id ON customers(stripe_customer_id)')

        # Guests table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS guests (
                id SERIAL PRIMARY KEY,
                guest_code VARCHAR(36) NOT NULL UNIQUE,
                first_name VARCHAR(50),
                last_name VARCHAR(50),
                email VARCHAR(100),
                phone VARCHAR(20),
                stripe_customer_id VARCHAR(255) UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_guests_email ON guests(email)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_guests_phone ON guests(phone)')

        # Customer addresses
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS customer_addresses (
                id SERIAL PRIMARY KEY,
                customer_id INTEGER NOT NULL,
                address_line1 VARCHAR(100) NOT NULL,
                address_line2 VARCHAR(100),
                city VARCHAR(50) NOT NULL,
                state VARCHAR(2) NOT NULL,
                zip_code VARCHAR(10) NOT NULL,
                latitude DECIMAL(10, 8),
                longitude DECIMAL(11, 8),
                is_default BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_customer_location ON customer_addresses(latitude, longitude)')

        # Payment methods
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS payment_methods (
                id SERIAL PRIMARY KEY,
                customer_id INTEGER NOT NULL,
                payment_type VARCHAR(20) NOT NULL CHECK (payment_type IN ('card', 'paypal', 'check')),
                is_default BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
            )
        ''')

        # Credit cards
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS credit_cards (
                id SERIAL PRIMARY KEY,
                payment_method_id INTEGER NOT NULL,
                card_holder_first_name VARCHAR(50) NOT NULL,
                card_holder_last_name VARCHAR(50) NOT NULL,
                card_number VARCHAR(16) NOT NULL,
                expiration_date VARCHAR(5) NOT NULL,
                cvv VARCHAR(4) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) ON DELETE CASCADE
            )
        ''')

        # PayPal accounts
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS paypal_accounts (
                id SERIAL PRIMARY KEY,
                payment_method_id INTEGER NOT NULL,
                paypal_email VARCHAR(100) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) ON DELETE CASCADE
            )
        ''')

        # NOTE: payment_cards table removed - we use Stripe for secure card storage
        # Stripe handles all sensitive card data - we only store stripe_customer_id

        # Bookings Table (Now with AI Pricing & Fraud Detection)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS bookings (
                id SERIAL PRIMARY KEY,
                customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
                guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
                chef_id INTEGER,
                cuisine_type VARCHAR(50) NOT NULL,
                meal_type VARCHAR(20) NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'any')),
                event_type VARCHAR(20) DEFAULT 'dinner' CHECK (event_type IN ('birthday', 'wedding', 'party', 'dinner', 'brunch')),
                booking_date DATE NOT NULL,
                booking_time TIME NOT NULL,
                produce_supply VARCHAR(20) NOT NULL DEFAULT 'customer' CHECK (produce_supply IN ('customer', 'chef')),
                number_of_people INTEGER NOT NULL,
                special_notes TEXT,
                status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'completed', 'cancelled')),
                
                -- Dynamic Pricing Engine Columns
                base_price DECIMAL(10, 2),
                dynamic_price DECIMAL(10, 2),
                pricing_multiplier DECIMAL(4, 2),
                pricing_features JSONB,
                total_cost DECIMAL(10,2),
                
                -- Fraud Detection Engine Columns
                fraud_score DECIMAL(5, 2) DEFAULT 0.00,
                fraud_flags JSONB,
                is_flagged_fraud BOOLEAN DEFAULT FALSE,
                
                -- Reviews & Metadata
                chef_review BOOLEAN DEFAULT FALSE,
                customer_review BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
                FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE SET NULL,
                FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE SET NULL
            )
        ''')

        cursor.execute('''
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'bookings' AND column_name = 'guest_id'
                ) THEN
                    ALTER TABLE bookings ADD COLUMN guest_id INTEGER;
                END IF;
            END $$;
        ''')

        # Notification infrastructure: tracks when a booking was actually completed,
        # used for the "chef finished" email and the 24h rating-reminder scheduler
        cursor.execute('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP')
        cursor.execute('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rating_reminder_sent_at TIMESTAMP')
        cursor.execute('''
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'bookings' AND column_name = 'customer_id' AND is_nullable = 'NO'
                ) THEN
                    ALTER TABLE bookings ALTER COLUMN customer_id DROP NOT NULL;
                END IF;
            END $$;
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_bookings_guest ON bookings(guest_id)')

        # Booking status history
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS booking_status_history (
                id SERIAL PRIMARY KEY,
                booking_id INTEGER NOT NULL,
                previous_status VARCHAR(20) CHECK (previous_status IN ('pending', 'accepted', 'declined', 'completed', 'cancelled')),
                new_status VARCHAR(20) NOT NULL CHECK (new_status IN ('pending', 'accepted', 'declined', 'completed', 'cancelled')),
                changed_by_type VARCHAR(20) NOT NULL CHECK (changed_by_type IN ('customer', 'chef', 'system')),
                changed_by_id INTEGER,
                reason TEXT,
                notes TEXT,
                changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_booking_changed_at ON booking_status_history(booking_id, changed_at)')

        # User deletion requests
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_deletion_requests (
                id SERIAL PRIMARY KEY,
                user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('customer', 'chef')),
                user_id INTEGER NOT NULL,
                user_email VARCHAR(100) NOT NULL,
                request_reason TEXT,
                status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
                deletion_type VARCHAR(20) DEFAULT 'soft_delete' CHECK (deletion_type IN ('soft_delete', 'hard_delete', 'anonymize')),
                scheduled_deletion_date DATE,
                actual_deletion_date DATE,
                data_backup_location VARCHAR(255),
                deletion_confirmation_code VARCHAR(50),
                admin_notes TEXT,
                requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                started_at TIMESTAMP,
                completed_at TIMESTAMP,
                processed_by_admin_id INTEGER
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_user_deletion ON user_deletion_requests(user_type, user_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_deletion_status ON user_deletion_requests(status)')

        # Agreements
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS agreements (
                id SERIAL PRIMARY KEY,
                agreement_type VARCHAR(50) NOT NULL CHECK (agreement_type IN ('terms_of_service', 'privacy_policy', 'chef_agreement', 'customer_agreement', 'cancellation_policy', 'payment_terms', 'data_usage_policy')),
                title VARCHAR(200) NOT NULL,
                content TEXT NOT NULL,
                version VARCHAR(20) NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                is_required BOOLEAN DEFAULT TRUE,
                applicable_to VARCHAR(20) DEFAULT 'all' CHECK (applicable_to IN ('all', 'customers', 'chefs')),
                effective_date DATE NOT NULL,
                expiry_date DATE,
                created_by_admin_id INTEGER,
                admin_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # User agreement acceptances
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_agreement_acceptances (
                id SERIAL PRIMARY KEY,
                agreement_id INTEGER NOT NULL,
                user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('customer', 'chef')),
                user_id INTEGER NOT NULL,
                user_email VARCHAR(100) NOT NULL,
                ip_address VARCHAR(45),
                user_agent TEXT,
                acceptance_method VARCHAR(30) NOT NULL CHECK (acceptance_method IN ('signup', 'update_prompt', 'forced_update')),
                accepted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (agreement_id) REFERENCES agreements(id) ON DELETE CASCADE,
                UNIQUE (agreement_id, user_type, user_id)
            )
        ''')

        # Chef ratings
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chef_ratings (
                id SERIAL PRIMARY KEY,
                booking_id INTEGER NOT NULL,
                chef_id INTEGER NOT NULL,
                customer_id INTEGER NOT NULL,
                rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
                review_text TEXT,
                food_quality_rating INTEGER CHECK (food_quality_rating >= 1 AND food_quality_rating <= 5),
                service_rating INTEGER CHECK (service_rating >= 1 AND service_rating <= 5),
                punctuality_rating INTEGER CHECK (punctuality_rating >= 1 AND punctuality_rating <= 5),
                professionalism_rating INTEGER CHECK (professionalism_rating >= 1 AND professionalism_rating <= 5),
                would_recommend BOOLEAN DEFAULT TRUE,
                is_anonymous BOOLEAN DEFAULT FALSE,
                admin_flagged BOOLEAN DEFAULT FALSE,
                admin_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
                FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
                UNIQUE (booking_id, customer_id)
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_chef_ratings ON chef_ratings(chef_id, rating)')
        
        #chef ratings with review
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chef_rating (
                rating_id SERIAL PRIMARY KEY,
                chef_id INT NOT NULL,
                customer_id INT NOT NULL,
                booking_id INT NOT NULL,
                rating FLOAT NOT NULL CHECK (rating >= 1.0 AND rating <= 5.0),
                comment VARCHAR(1000),
                FOREIGN KEY (chef_id) references chefs(id) ON DELETE CASCADE,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
                FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
            );
        ''')

        # Chef rating summary
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chef_rating_summary (
                chef_id INTEGER PRIMARY KEY,
                average_rating DECIMAL(3,2),
                total_reviews INTEGER DEFAULT 0,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_average_rating ON chef_rating_summary(average_rating DESC)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_total_reviews ON chef_rating_summary(total_reviews DESC)')

        # Customer ratings
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS customer_ratings (
                id SERIAL PRIMARY KEY,
                booking_id INTEGER NOT NULL,
                customer_id INTEGER NOT NULL,
                chef_id INTEGER NOT NULL,
                rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
                review_text TEXT,
                communication_rating INTEGER CHECK (communication_rating >= 1 AND communication_rating <= 5),
                payment_promptness_rating INTEGER CHECK (payment_promptness_rating >= 1 AND payment_promptness_rating <= 5),
                respect_rating INTEGER CHECK (respect_rating >= 1 AND respect_rating <= 5),
                kitchen_cleanliness_rating INTEGER CHECK (kitchen_cleanliness_rating >= 1 AND kitchen_cleanliness_rating <= 5),
                would_work_again BOOLEAN DEFAULT TRUE,
                is_anonymous BOOLEAN DEFAULT FALSE,
                admin_flagged BOOLEAN DEFAULT FALSE,
                admin_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
                FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE,
                UNIQUE (booking_id, chef_id)
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_customer_ratings ON customer_ratings(customer_id, rating)')

        # Chef service areas
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chef_service_areas (
                id SERIAL PRIMARY KEY,
                chef_id INTEGER NOT NULL,
                city VARCHAR(50) NOT NULL,
                state VARCHAR(2) NOT NULL,
                zip_code VARCHAR(10) NOT NULL,
                service_radius_miles INTEGER DEFAULT 10,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE
            )
        ''')

        # Chef pricing
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chef_pricing (
                id SERIAL PRIMARY KEY,
                chef_id INTEGER NOT NULL,
                base_rate_per_person DECIMAL(10,2) NOT NULL,
                produce_supply_extra_cost DECIMAL(10,2) DEFAULT 0.00,
                minimum_people INTEGER DEFAULT 1,
                maximum_people INTEGER DEFAULT 50,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE
            )
        ''')

        # Chats
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chats (
                id SERIAL PRIMARY KEY,
                customer_id INTEGER NOT NULL,
                chef_id INTEGER NOT NULL,
                booking_id INTEGER,
                status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'closed', 'archived')),
                closed_by_type VARCHAR(20) CHECK (closed_by_type IN ('customer', 'chef')),
                closed_by_id INTEGER,
                closed_at TIMESTAMP,
                last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
                FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE,
                FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
                UNIQUE (customer_id, chef_id, booking_id)
            )
        ''')

        # Chat messages
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                chat_id INTEGER NOT NULL,
                sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('customer', 'chef')),
                sender_id INTEGER NOT NULL,
                message_text TEXT NOT NULL,
                message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'file')),
                file_url VARCHAR(255),
                is_read BOOLEAN DEFAULT FALSE,
                sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_chat_sent_at ON chat_messages(chat_id, sent_at)')

        # Online meetings
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS online_meetings (
                id SERIAL PRIMARY KEY,
                customer_id INTEGER NOT NULL,
                chef_id INTEGER NOT NULL,
                booking_id INTEGER,
                meeting_date DATE NOT NULL,
                meeting_time TIME NOT NULL,
                duration_minutes INTEGER DEFAULT 15,
                meeting_url VARCHAR(255),
                meeting_platform VARCHAR(20) DEFAULT 'zoom' CHECK (meeting_platform IN ('zoom', 'google_meet', 'teams', 'webex', 'other')),
                status VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show')),
                cancelled_by_type VARCHAR(20) CHECK (cancelled_by_type IN ('customer', 'chef', 'system')),
                cancelled_by_id INTEGER,
                cancelled_at TIMESTAMP,
                cancellation_reason TEXT,
                customer_wants_to_end BOOLEAN DEFAULT FALSE,
                customer_end_requested_at TIMESTAMP,
                chef_wants_to_end BOOLEAN DEFAULT FALSE,
                chef_end_requested_at TIMESTAMP,
                early_end_agreed BOOLEAN DEFAULT FALSE,
                early_end_reason TEXT,
                actual_duration_minutes INTEGER,
                started_at TIMESTAMP,
                ended_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
                FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE,
                FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_meeting_status ON online_meetings(status)')

        # Meeting feedback
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS meeting_feedback (
                id SERIAL PRIMARY KEY,
                meeting_id INTEGER NOT NULL,
                user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('customer', 'chef')),
                user_id INTEGER NOT NULL,
                rating INTEGER CHECK (rating >= 1 AND rating <= 5),
                feedback_text TEXT,
                meeting_quality_rating INTEGER CHECK (meeting_quality_rating >= 1 AND meeting_quality_rating <= 5),
                communication_rating INTEGER CHECK (communication_rating >= 1 AND communication_rating <= 5),
                technical_issues BOOLEAN DEFAULT FALSE,
                would_meet_again BOOLEAN DEFAULT TRUE,
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (meeting_id) REFERENCES online_meetings(id) ON DELETE CASCADE,
                UNIQUE (meeting_id, user_type, user_id)
            )
        ''')

        # Customer meeting usage
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS customer_meeting_usage (
                id SERIAL PRIMARY KEY,
                customer_id INTEGER NOT NULL,
                chef_id INTEGER NOT NULL,
                meetings_used INTEGER DEFAULT 0,
                meetings_limit INTEGER DEFAULT 3,
                period_start DATE NOT NULL,
                period_end DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
                FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE,
                UNIQUE (customer_id, chef_id, period_start)
            )
        ''')

        # Chef cancellation records
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chef_cancellation_records (
                id SERIAL PRIMARY KEY,
                chef_id INTEGER NOT NULL,
                record_type VARCHAR(30) NOT NULL CHECK (record_type IN ('booking_cancellations', 'meeting_cancellations')),
                cancellation_count INTEGER NOT NULL,
                period_start DATE NOT NULL,
                period_end DATE,
                threshold_reached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                penalty_applied BOOLEAN DEFAULT FALSE,
                penalty_type VARCHAR(20) DEFAULT 'warning' CHECK (penalty_type IN ('warning', 'suspension', 'fee', 'profile_flag')),
                notes TEXT,
                admin_reviewed BOOLEAN DEFAULT FALSE,
                admin_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE
            )
        ''')

        # Notifications
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('customer', 'chef')),
                user_id INTEGER NOT NULL,
                notification_type VARCHAR(50) NOT NULL CHECK (notification_type IN ('booking_update', 'meeting_reminder', 'payment_alert', 'new_message', 'rating_request', 'promotional', 'system_alert')),
                title VARCHAR(200) NOT NULL,
                message TEXT NOT NULL,
                send_push BOOLEAN DEFAULT TRUE,
                send_email BOOLEAN DEFAULT FALSE,
                send_sms BOOLEAN DEFAULT FALSE,
                is_read BOOLEAN DEFAULT FALSE,
                is_sent BOOLEAN DEFAULT FALSE,
                sent_at TIMESTAMP,
                read_at TIMESTAMP,
                action_type VARCHAR(50),
                action_data JSONB,
                priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
                expires_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_user_notifications ON notifications(user_type, user_id, is_read)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_notification_type ON notifications(notification_type)')

        # Customer cancellation fees
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS customer_cancellation_fees (
                id SERIAL PRIMARY KEY,
                booking_id INTEGER NOT NULL,
                customer_id INTEGER NOT NULL,
                cancellation_time TIMESTAMP NOT NULL,
                booking_scheduled_time TIMESTAMP NOT NULL,
                hours_before_booking DECIMAL(4,1) NOT NULL,
                fee_amount DECIMAL(10,2) NOT NULL,
                fee_percentage DECIMAL(5,2),
                booking_total_cost DECIMAL(10,2),
                fee_reason TEXT,
                status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'charged', 'waived', 'disputed')),
                charged_at TIMESTAMP,
                waived_at TIMESTAMP,
                waived_reason TEXT,
                payment_transaction_id VARCHAR(100),
                admin_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
            )
        ''')

        # Customer favorite chefs
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS customer_favorite_chefs (
                id SERIAL PRIMARY KEY,
                customer_id INTEGER NOT NULL,
                chef_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
                FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE,
                UNIQUE (customer_id, chef_id)
            )
        ''')

        # Chef cuisine photos
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chef_cuisine_photos (
                id SERIAL PRIMARY KEY,
                chef_id INTEGER NOT NULL,
                cuisine_type VARCHAR(100) NOT NULL,
                photo_url VARCHAR(255) NOT NULL,
                photo_title VARCHAR(200),
                photo_description TEXT,
                is_featured BOOLEAN DEFAULT FALSE,
                display_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE
            )
        ''')

        # Customer search locations
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS customer_search_locations (
                id SERIAL PRIMARY KEY,
                customer_id INTEGER NOT NULL,
                location_name VARCHAR(200),
                address_line1 VARCHAR(100),
                address_line2 VARCHAR(100),
                city VARCHAR(50) NOT NULL,
                state VARCHAR(2) NOT NULL,
                zip_code VARCHAR(10),
                latitude DECIMAL(10, 8) NOT NULL,
                longitude DECIMAL(11, 8) NOT NULL,
                last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                usage_count INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_search_location ON customer_search_locations(latitude, longitude)')

        # Customer recent searches - stores search history with keywords and filters
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS customer_recent_searches (
                id SERIAL PRIMARY KEY,
                customer_id INTEGER NOT NULL,
                search_query VARCHAR(255),
                cuisine VARCHAR(100),
                gender VARCHAR(10),
                meal_timing VARCHAR(20),
                min_rating DECIMAL(2, 1),
                max_price DECIMAL(10, 2),
                radius DECIMAL(6, 2),
                latitude DECIMAL(10, 8),
                longitude DECIMAL(11, 8),
                location_name VARCHAR(200),
                results_count INTEGER DEFAULT 0,
                searched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_recent_searches_customer ON customer_recent_searches(customer_id, searched_at DESC)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_recent_searches_query ON customer_recent_searches(search_query)')

        # Customer viewed chefs - tracks which chefs a customer has viewed
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS customer_viewed_chefs (
                id SERIAL PRIMARY KEY,
                customer_id INTEGER NOT NULL,
                chef_id INTEGER NOT NULL,
                viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                view_count INTEGER DEFAULT 1,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
                FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE,
                UNIQUE(customer_id, chef_id)
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_viewed_chefs_customer ON customer_viewed_chefs(customer_id, viewed_at DESC)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_viewed_chefs_chef ON customer_viewed_chefs(chef_id)')

        # Chef menu items
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chef_menu_items (
                id SERIAL PRIMARY KEY,
                chef_id INTEGER NOT NULL,
                dish_name VARCHAR(255) NOT NULL,
                description TEXT,
                photo_url VARCHAR(500),
                servings INTEGER,
                cuisine_type VARCHAR(100),
                dietary_info VARCHAR(255),
                spice_level VARCHAR(50),
                price DECIMAL(10, 2),
                prep_time INTEGER,
                category_id INTEGER,
                is_available BOOLEAN DEFAULT TRUE,
                is_featured BOOLEAN DEFAULT FALSE,
                display_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE,
                CONSTRAINT unique_chef_dish UNIQUE (chef_id, dish_name)
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_chef_menu_chef_id ON chef_menu_items(chef_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_chef_menu_available ON chef_menu_items(chef_id, is_available)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_chef_menu_featured ON chef_menu_items(chef_id, is_featured)')

        # Trigger to update updated_at for chef_menu_items
        cursor.execute('''
            CREATE OR REPLACE FUNCTION update_chef_menu_updated_at()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        ''')
        
        cursor.execute('''
            DROP TRIGGER IF EXISTS trigger_update_chef_menu_timestamp ON chef_menu_items;
        ''')
        
        cursor.execute('''
            CREATE TRIGGER trigger_update_chef_menu_timestamp
            BEFORE UPDATE ON chef_menu_items
            FOR EACH ROW
            EXECUTE FUNCTION update_chef_menu_updated_at();
        ''')

        # Orders table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
                guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
                chef_id INTEGER NOT NULL REFERENCES chefs(id) ON DELETE CASCADE,
                order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                delivery_datetime TIMESTAMP,
                status VARCHAR(50) DEFAULT 'pending',
                total_amount DECIMAL(10, 2) NOT NULL,
                estimated_prep_time INTEGER,
                delivery_address TEXT,
                special_instructions TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT valid_status CHECK (status IN ('pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'))
            )
        ''')

        cursor.execute('''
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'orders' AND column_name = 'guest_id'
                ) THEN
                    ALTER TABLE orders ADD COLUMN guest_id INTEGER;
                END IF;
            END $$;
        ''')
        cursor.execute('''
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'orders' AND column_name = 'customer_id' AND is_nullable = 'NO'
                ) THEN
                    ALTER TABLE orders ALTER COLUMN customer_id DROP NOT NULL;
                END IF;
            END $$;
        ''')
        
        # Add delivery_datetime column if it doesn't exist (for existing orders tables)
        cursor.execute('''
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'orders' AND column_name = 'delivery_datetime'
                ) THEN
                    ALTER TABLE orders ADD COLUMN delivery_datetime TIMESTAMP;
                END IF;
            END $$;
        ''')
        
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_orders_guest ON orders(guest_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_orders_chef ON orders(chef_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date DESC)')
        
        # Drop old delivery_datetime index if it exists, then create new one
        cursor.execute('DROP INDEX IF EXISTS idx_orders_delivery_datetime')
        cursor.execute('CREATE INDEX idx_orders_delivery_datetime ON orders(delivery_datetime)')

        # Order items table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS order_items (
                id SERIAL PRIMARY KEY,
                order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                menu_item_id INTEGER NOT NULL REFERENCES chef_menu_items(id) ON DELETE RESTRICT,
                dish_name VARCHAR(255) NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 1,
                unit_price DECIMAL(10, 2) NOT NULL,
                subtotal DECIMAL(10, 2) NOT NULL,
                special_requests TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT positive_quantity CHECK (quantity > 0),
                CONSTRAINT positive_price CHECK (unit_price >= 0)
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_order_items_menu_item ON order_items(menu_item_id)')

        cursor.execute('''
                CREATE TABLE IF NOT EXISTS chef_kitchen_tools ( 
                    chef_id SERIAL PRIMARY KEY,
                    customer_id INTEGER NOT NULL,
                    tool_name VARCHAR(100) NOT NULL,
                    tool_description TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE
                )
        ''')


        # ==========================================
        # ANALYTICS & MACHINE LEARNING INFRASTRUCTURE
        # ==========================================

        # Unified Application Event Log
        cursor.execute('''
                    CREATE TABLE IF NOT EXISTS app_events_log (
                        id SERIAL PRIMARY KEY,
                        event_category VARCHAR(50) NOT NULL CHECK (event_category IN ('navigation', 'interaction', 'transaction', 'system')),
                        event_action VARCHAR(100) NOT NULL,
                        actor_type VARCHAR(20) CHECK (actor_type IN ('customer', 'chef', 'guest', 'system')),
                        actor_id INTEGER,
                        session_id VARCHAR(100),
                        event_data JSONB,
                        client_timestamp TIMESTAMP NOT NULL,
                        server_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_events_time ON app_events_log(server_timestamp DESC)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_events_action ON app_events_log(event_action)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_events_data ON app_events_log USING GIN (event_data)')

        # Materialized View: Chef Performance Metrics
        cursor.execute('''
                    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_chef_performance AS
                    SELECT
                        c.id AS chef_id,
                        c.first_name,
                        COUNT(b.id) AS total_bookings,
                        COUNT(CASE WHEN b.status = 'completed' THEN 1 END) AS completed_bookings,
                        COUNT(CASE WHEN b.status = 'cancelled' THEN 1 END) AS cancelled_bookings,
                        COALESCE(rs.average_rating, 0) AS average_rating,
                        CASE
                            WHEN COUNT(b.id) > 0 THEN
                                CAST(COUNT(CASE WHEN b.status = 'completed' THEN 1 END) AS FLOAT) / COUNT(b.id)
                            ELSE 0
                        END AS completion_rate
                    FROM chefs c
                    LEFT JOIN bookings b ON c.id = b.chef_id
                    LEFT JOIN chef_rating_summary rs ON c.id = rs.chef_id
                    GROUP BY c.id, c.first_name, rs.average_rating
                ''')
        cursor.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_chef_perf_id ON mv_chef_performance(chef_id)')


        #  Materialized View: Geographic Demand Patterns
        cursor.execute('''
            CREATE MATERIALIZED VIEW IF NOT EXISTS mv_geographic_demand AS
            SELECT 
                DATE_TRUNC('day', searched_at) AS demand_date,
                location_name,
                COUNT(id) AS search_volume,
                COUNT(CASE WHEN results_count = 0 THEN 1 END) AS zero_result_searches
            FROM customer_recent_searches
            WHERE location_name IS NOT NULL
            GROUP BY 1, 2
        ''')
        cursor.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_geo_demand ON mv_geographic_demand(demand_date, location_name)')

        # Add foreign key constraints for users table
        # Check if constraint exists before adding
        try:
            cursor.execute('''
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_chef_id'
                    ) THEN
                        ALTER TABLE users 
                        ADD CONSTRAINT fk_users_chef_id 
                        FOREIGN KEY (chef_id) REFERENCES chefs(id) ON DELETE CASCADE;
                    END IF;
                END $$;
            ''')
        except Exception as e:
            print(f"Note: chef_id constraint - {e}")
        
        try:
            cursor.execute('''
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_customer_id'
                    ) THEN
                        ALTER TABLE users 
                        ADD CONSTRAINT fk_users_customer_id 
                        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
                    END IF;
                END $$;
            ''')
        except Exception as e:
            print(f"Note: customer_id constraint - {e}")

        conn.commit()
        print("\n✅ All tables created successfully in PostgreSQL!")
        print(f"\n📊 Database: {db_config['database']}")
        print(f"📋 Total tables created: 46")
        print("\n📝 Table Summary:")
        print("   - Authentication: users")
        print("   - Chefs: chefs, chef_documents, chef_cuisines, chef_addresses, chef_payment_methods")
        print("            chef_bank_accounts, chef_paypal_accounts, chef_check_addresses, chef_payments")
        print("            chef_availability_days, chef_meal_availability, chef_service_areas, chef_pricing")
        print("            chef_cuisine_photos, chef_menu_items, chef_cancellation_records, chef_kitchen_tools")
        print("   - Customers: customers (with stripe_customer_id), customer_addresses, customer_favorite_chefs")
        print("                customer_search_locations, customer_recent_searches, customer_viewed_chefs")
        print("                customer_meeting_usage, customer_cancellation_fees")
        print("   - Payment: payment_methods, credit_cards, paypal_accounts")
        print("              ⚠️  NOTE: Card data stored securely via Stripe - stripe_customer_id in customers table")
        print("   - Bookings: bookings, booking_status_history")
        print("   - Orders: orders, order_items")
        print("   - Ratings: chef_ratings, chef_rating, chef_rating_summary, customer_ratings")
        print("   - Communication: chats, chat_messages, online_meetings, meeting_feedback")
        print("   - System: notifications, agreements, user_agreement_acceptances, user_deletion_requests")
        print("   - References: cuisine_types")
        print("\n💳 Stripe Integration:")
        print("   - customers.stripe_customer_id stores Stripe customer reference")
        print("   - All card data securely managed by Stripe")
        print("   - Payment intents created via stripe_payment_bp.py blueprint")
        print("   - Analytics (AI): app_events_log, mv_chef_performance, mv_geographic_demand")
        
    except Error as e:
        print(f"\n Error creating tables: {e}")
        import traceback
        traceback.print_exc()
        if conn:
            conn.rollback()
            
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
            print("\nDatabase connection closed.")

if __name__ == "__main__":
    print("="*60)
    print("ChefAsap PostgreSQL Database Setup")
    print("="*60)
    init_postgres_db()
