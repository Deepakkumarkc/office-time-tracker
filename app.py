#!/usr/bin/env python3
"""
Office Time Tracker - Python Backend & Static Server
Runs on Python 3 standard library with SQLite (Zero External Dependencies Required!).
Includes Admin Portal (Deepak / Ananth), Plain-text Password Inspector, Password Reset,
Break Reason Tracking, Session Notes, and Free Email Reports.
"""

import os
import sys
import json
import sqlite3
import hashlib
import hmac
import secrets
import datetime
import urllib.parse
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from http.server import HTTPServer, BaseHTTPRequestHandler

# Configuration
PORT = 5000
DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'database.db')
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public')
JWT_SECRET = "office_tracker_secret_key_2026_super_secure"

# SMTP Configuration
SMTP_HOST = os.environ.get('SMTP_HOST', 'smtp.office365.com')
SMTP_PORT = int(os.environ.get('SMTP_PORT', 587))
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'deepakkumar.kc@sagitec.com')
SENDER_PASSWORD = os.environ.get('SENDER_PASSWORD', '')

# ==============================================================================
# DATABASE INITIALIZATION & MIGRATIONS
# ==============================================================================

def hash_password(password, salt=None):
    if not salt:
        salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000)
    return key.hex(), salt

def verify_password(password, stored_hash, salt):
    key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000)
    return hmac.compare_digest(key.hex(), stored_hash)

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # Create Users Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'USER',
            raw_password TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Create Office Sessions Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS office_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            work_mode TEXT NOT NULL DEFAULT 'Office',
            start_time TEXT NOT NULL,
            stop_time TEXT,
            duration_seconds INTEGER DEFAULT 0,
            break_reason TEXT,
            notes TEXT,
            status TEXT NOT NULL DEFAULT 'IN_OFFICE',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')

    # Column Migrations
    cursor.execute("PRAGMA table_info(users)")
    u_cols = [row[1] for row in cursor.fetchall()]
    if 'role' not in u_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'USER'")
    if 'raw_password' not in u_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN raw_password TEXT")

    cursor.execute("PRAGMA table_info(office_sessions)")
    s_cols = [row[1] for row in cursor.fetchall()]
    if 'break_reason' not in s_cols:
        cursor.execute("ALTER TABLE office_sessions ADD COLUMN break_reason TEXT")
    if 'notes' not in s_cols:
        cursor.execute("ALTER TABLE office_sessions ADD COLUMN notes TEXT")

    # Auto-Seed / Ensure Admin Credentials: Deepak / Ananth
    admin_name = "Deepak"
    admin_email = "deepak@office.com"
    admin_pass = "Ananth"
    admin_hash, admin_salt = hash_password(admin_pass)

    cursor.execute("SELECT id FROM users WHERE LOWER(email) = ?", (admin_email.lower(),))
    admin_rows = cursor.fetchall()
    if admin_rows:
        for r in admin_rows:
            cursor.execute(
                "UPDATE users SET password_hash = ?, salt = ?, role = 'ADMIN', raw_password = ? WHERE id = ?",
                (admin_hash, admin_salt, admin_pass, r[0])
            )
    else:
        cursor.execute(
            "INSERT INTO users (name, email, password_hash, salt, role, raw_password) VALUES (?, ?, ?, ?, 'ADMIN', ?)",
            (admin_name, admin_email, admin_hash, admin_salt, admin_pass)
        )

    conn.commit()
    conn.close()
    print(f"[Database] SQLite database initialized at: {DB_FILE}")
    print(f"[Admin] Admin user registered: '{admin_name}' | Password: '{admin_pass}'")

# ==============================================================================
# SECURITY & AUTHENTICATION HELPERS
# ==============================================================================

# Auto-Cutoff Helper & Background Scheduler
def auto_cutoff_expired_sessions():
    """
    Auto-cutoff active office sessions that span past midnight (12:00 AM) or were left running on previous dates.
    Sets stop_time to 23:59:59 of the session date, status to 'AUTO_CUTOFF', and break_reason to 'Auto Cutoff (Forgot to stop timer)'.
    """
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        now_dt = datetime.datetime.now()
        today_str = datetime.date.today().isoformat()

        cursor.execute('SELECT id, date, start_time FROM office_sessions WHERE status = "IN_OFFICE" AND stop_time IS NULL')
        active_sessions = cursor.fetchall()

        for s_id, s_date, s_start_time in active_sessions:
            is_past_date = s_date < today_str
            should_cutoff = is_past_date
            if not should_cutoff:
                try:
                    session_end_dt = datetime.datetime.fromisoformat(f"{s_date}T23:59:59")
                    if now_dt > session_end_dt:
                        should_cutoff = True
                except Exception:
                    pass

            if should_cutoff:
                cutoff_stop_time = f"{s_date}T23:59:59"
                try:
                    clean_start = s_start_time.replace('Z', '+00:00')
                    start_dt = datetime.datetime.fromisoformat(clean_start)
                    if start_dt.tzinfo:
                        stop_dt = datetime.datetime.fromisoformat(f"{s_date}T23:59:59+00:00")
                    else:
                        stop_dt = datetime.datetime.fromisoformat(f"{s_date}T23:59:59")
                    duration_seconds = max(0, int((stop_dt - start_dt).total_seconds()))
                except Exception:
                    duration_seconds = 0

                cursor.execute(
                    '''UPDATE office_sessions 
                       SET stop_time = ?, duration_seconds = ?, break_reason = 'Auto Cutoff (Forgot to stop timer)', status = 'AUTO_CUTOFF' 
                       WHERE id = ?''',
                    (cutoff_stop_time, duration_seconds, s_id)
                )

        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[Auto Cutoff Error] {e}")

import threading
import time

def start_auto_cutoff_scheduler():
    def loop():
        while True:
            auto_cutoff_expired_sessions()
            time.sleep(60)

    t = threading.Thread(target=loop, daemon=True)
    t.start()

def generate_token(user_id, email, role='USER'):
    header = json.dumps({"alg": "HS256", "typ": "JWT"}).encode('utf-8')
    payload = json.dumps({
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": int((datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=7)).timestamp())
    }).encode('utf-8')

    def base64url(data):
        import base64
        return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')

    unsigned_token = f"{base64url(header)}.{base64url(payload)}"
    signature = hmac.new(JWT_SECRET.encode('utf-8'), unsigned_token.encode('utf-8'), hashlib.sha256).digest()
    
    import base64
    sig_str = base64.urlsafe_b64encode(signature).rstrip(b'=').decode('utf-8')
    return f"{unsigned_token}.{sig_str}"

def decode_token(token):
    if not token or '.' not in token:
        return None
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        import base64
        def b64_decode(data):
            padding = '=' * (-len(data) % 4)
            return base64.urlsafe_b64decode(data + padding)
        
        payload_json = b64_decode(parts[1]).decode('utf-8')
        payload = json.loads(payload_json)
        
        if payload.get("exp") and datetime.datetime.now(datetime.timezone.utc).timestamp() > payload["exp"]:
            return None
        return payload
    except Exception:
        return None

# ==============================================================================
# HTTP REQUEST HANDLER
# ==============================================================================

class RequestHandler(BaseHTTPRequestHandler):

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()
        self.wfile.write(body)

    def _get_auth_user(self):
        auth_header = self.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return None
        token = auth_header.split(' ')[1]
        payload = decode_token(token)
        if not payload:
            return None
        return payload

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()

    def do_GET(self):
        auto_cutoff_expired_sessions()
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        if path == '/api/dashboard':
            query_params = urllib.parse.parse_qs(parsed_url.query)
            selected_date = query_params.get('date', [datetime.date.today().isoformat()])[0]
            self.handle_dashboard(selected_date)
            return

        if path == '/api/reports/monthly':
            query_params = urllib.parse.parse_qs(parsed_url.query)
            month = query_params.get('month', [datetime.date.today().strftime('%Y-%m')])[0]
            self.handle_monthly_report(month)
            return

        if path == '/api/admin/overview':
            self.handle_admin_overview()
            return

        filepath = path.lstrip('/')
        if not filepath:
            filepath = 'index.html'
        
        full_path = os.path.join(PUBLIC_DIR, filepath)
        
        if os.path.exists(full_path) and os.path.isfile(full_path):
            self.send_response(200)
            if filepath.endswith('.html'):
                self.send_header('Content-Type', 'text/html')
            elif filepath.endswith('.css'):
                self.send_header('Content-Type', 'text/css')
            elif filepath.endswith('.js'):
                self.send_header('Content-Type', 'application/javascript')
            elif filepath.endswith('.png'):
                self.send_header('Content-Type', 'image/png')
            elif filepath.endswith('.svg'):
                self.send_header('Content-Type', 'image/svg+xml')
            self.end_headers()

            with open(full_path, 'rb') as f:
                self.wfile.write(f.read())
        else:
            self.send_error(404, 'File Not Found')

    def do_POST(self):
        auto_cutoff_expired_sessions()
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else '{}'
        
        try:
            payload = json.loads(post_data) if post_data else {}
        except Exception:
            payload = {}

        if path == '/api/auth/register':
            self.handle_register(payload)
        elif path == '/api/auth/login':
            self.handle_login(payload)
        elif path == '/api/auth/reset-password':
            self.handle_reset_password(payload)
        elif path == '/api/sessions/start':
            self.handle_session_start(payload)
        elif path == '/api/sessions/stop':
            self.handle_session_stop(payload)
        elif path == '/api/sessions/edit':
            self.handle_session_edit(payload)
        elif path == '/api/reports/send-email':
            self.handle_send_monthly_email(payload)
        elif path == '/api/admin/reset-user-password':
            self.handle_admin_reset_user_password(payload)
        else:
            self._send_json({'message': 'Endpoint not found'}, 404)

    # --------------------------------------------------------------------------
    # API HANDLERS
    # --------------------------------------------------------------------------

    def handle_admin_reset_user_password(self, payload):
        user = self._get_auth_user()
        if not user or user.get('role') != 'ADMIN':
            return self._send_json({'message': 'Access Denied: Admin privileges required.'}, 403)

        target_user_id = payload.get('user_id')
        new_password = payload.get('new_password', '').strip()

        if not target_user_id or not new_password:
            return self._send_json({'message': 'User ID and new password are required.'}, 400)

        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute('SELECT name, email FROM users WHERE id = ?', (target_user_id,))
        row = cursor.fetchone()

        if not row:
            conn.close()
            return self._send_json({'message': 'User not found.'}, 404)

        pass_hash, salt = hash_password(new_password)
        cursor.execute('UPDATE users SET password_hash = ?, salt = ?, raw_password = ? WHERE id = ?', (pass_hash, salt, new_password, target_user_id))
        conn.commit()
        conn.close()

        return self._send_json({'message': f"Successfully reset password for employee '{row[0]}' ({row[1]})!"})

    def handle_login(self, payload):
        identifier = payload.get('email', '').strip().lower()
        password = payload.get('password', '')

        if not identifier or not password:
            return self._send_json({'message': 'Email/Username and password required.'}, 400)

        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute(
            'SELECT id, name, email, password_hash, salt, role, raw_password FROM users WHERE LOWER(email) = ? OR LOWER(name) = ?',
            (identifier, identifier)
        )
        row = cursor.fetchone()

        if not row or not verify_password(password, row[3], row[4]):
            conn.close()
            return self._send_json({'message': 'Invalid credentials.'}, 401)

        user_id, name, user_email, role = row[0], row[1], row[2], (row[5] or 'USER')
        
        # Save raw password if missing
        if not row[6]:
            cursor.execute('UPDATE users SET raw_password = ? WHERE id = ?', (password, user_id))
            conn.commit()

        conn.close()
        token = generate_token(user_id, user_email, role)

        return self._send_json({
            'message': 'Logged in successfully!',
            'token': token,
            'user': {'id': user_id, 'name': name, 'email': user_email, 'role': role}
        })

    def handle_register(self, payload):
        name = payload.get('name', '').strip()
        email = payload.get('email', '').strip().lower()
        password = payload.get('password', '')

        if not name or not email or not password:
            return self._send_json({'message': 'All fields are required.'}, 400)

        if not email.endswith('@sagitec.com'):
            return self._send_json({'message': 'Registration is restricted to official @sagitec.com email addresses.'}, 400)

        pass_hash, salt = hash_password(password)

        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        try:
            cursor.execute(
                'INSERT INTO users (name, email, password_hash, salt, role, raw_password) VALUES (?, ?, ?, ?, "USER", ?)',
                (name, email, pass_hash, salt, password)
            )
            conn.commit()
            user_id = cursor.lastrowid
            token = generate_token(user_id, email, 'USER')
            return self._send_json({
                'message': 'Registration successful!',
                'token': token,
                'user': {'id': user_id, 'name': name, 'email': email, 'role': 'USER'}
            }, 201)
        except sqlite3.IntegrityError:
            return self._send_json({'message': 'An account with this email already exists.'}, 400)
        finally:
            conn.close()

    def handle_reset_password(self, payload):
        email = payload.get('email', '').strip().lower()
        new_password = payload.get('new_password', '')

        if not email or not new_password:
            return self._send_json({'message': 'Email and new password are required.'}, 400)

        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM users WHERE LOWER(email) = ? OR LOWER(name) = ?', (email, email))
        row = cursor.fetchone()

        if not row:
            conn.close()
            return self._send_json({'message': 'No account found with this email/name.'}, 404)

        user_id = row[0]
        pass_hash, salt = hash_password(new_password)
        cursor.execute('UPDATE users SET password_hash = ?, salt = ?, raw_password = ? WHERE id = ?', (pass_hash, salt, new_password, user_id))
        conn.commit()
        conn.close()

        return self._send_json({'message': 'Password reset successful! You can now log in with your new password.'})

    def handle_session_start(self, payload):
        user = self._get_auth_user()
        if not user:
            return self._send_json({'message': 'Unauthorized'}, 401)

        user_id = user['sub']
        date = payload.get('date', datetime.date.today().isoformat())
        work_mode = payload.get('work_mode', 'Office')
        start_time = payload.get('start_time', datetime.datetime.now(datetime.timezone.utc).isoformat())

        today_str = datetime.date.today().isoformat()
        if date < today_str:
            return self._send_json({'message': 'Cannot start timer for a past date.'}, 400)

        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()

        cursor.execute(
            'SELECT id FROM office_sessions WHERE user_id = ? AND status = "IN_OFFICE" AND stop_time IS NULL',
            (user_id,)
        )
        existing = cursor.fetchone()
        if existing:
            conn.close()
            return self._send_json({'message': 'An active office session is already running.'}, 400)

        cursor.execute(
            'INSERT INTO office_sessions (user_id, date, work_mode, start_time, status) VALUES (?, ?, ?, ?, ?)',
            (user_id, date, work_mode, start_time, 'IN_OFFICE')
        )
        conn.commit()
        session_id = cursor.lastrowid
        conn.close()

        return self._send_json({
            'message': 'Office session started!',
            'session_id': session_id
        }, 201)

    def handle_session_stop(self, payload):
        user = self._get_auth_user()
        if not user:
            return self._send_json({'message': 'Unauthorized'}, 401)

        user_id = user['sub']
        stop_time_iso = payload.get('stop_time', datetime.datetime.now(datetime.timezone.utc).isoformat())
        break_reason = payload.get('break_reason', 'End of Workday').strip()
        notes = payload.get('notes', '').strip()
        
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()

        cursor.execute(
            'SELECT id, start_time FROM office_sessions WHERE user_id = ? AND status = "IN_OFFICE" AND stop_time IS NULL ORDER BY id DESC LIMIT 1',
            (user_id,)
        )
        row = cursor.fetchone()

        if not row:
            conn.close()
            return self._send_json({'message': 'No active session found to stop.'}, 400)

        session_id, start_time_str = row[0], row[1]
        
        try:
            start_dt = datetime.datetime.fromisoformat(start_time_str.replace('Z', '+00:00'))
            stop_dt = datetime.datetime.fromisoformat(stop_time_iso.replace('Z', '+00:00'))
            duration_seconds = max(0, int((stop_dt - start_dt).total_seconds()))
        except Exception:
            duration_seconds = 0

        cursor.execute(
            'UPDATE office_sessions SET stop_time = ?, duration_seconds = ?, break_reason = ?, notes = ?, status = "COMPLETED" WHERE id = ?',
            (stop_time_iso, duration_seconds, break_reason, notes, session_id)
        )
        conn.commit()
        conn.close()

        hours = duration_seconds // 3600
        minutes = (duration_seconds % 3600) // 60
        secs = duration_seconds % 60
        duration_fmt = f"{hours}h {minutes}m {secs}s" if hours > 0 else f"{minutes}m {secs}s"

        return self._send_json({
            'message': 'Session stopped successfully.',
            'duration_seconds': duration_seconds,
            'duration_formatted': duration_fmt,
            'break_reason': break_reason,
            'notes': notes
        })

    def handle_session_edit(self, payload):
        user = self._get_auth_user()
        if not user:
            return self._send_json({'message': 'Unauthorized'}, 401)

        user_id = user['sub']
        session_id = payload.get('session_id')
        new_stop_time = payload.get('stop_time', '').strip()
        break_reason = payload.get('break_reason')
        notes = payload.get('notes')

        if not session_id or not new_stop_time:
            return self._send_json({'message': 'Session ID and Stop Time are required.'}, 400)

        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()

        cursor.execute(
            'SELECT id, user_id, date, start_time, stop_time, status FROM office_sessions WHERE id = ?',
            (session_id,)
        )
        row = cursor.fetchone()

        if not row:
            conn.close()
            return self._send_json({'message': 'Session not found.'}, 404)

        s_id, s_user_id, s_date, start_time_str, old_stop_time, old_status = row

        if s_user_id != user_id and user.get('role') != 'ADMIN':
            conn.close()
            return self._send_json({'message': 'Forbidden: Cannot edit another user\'s session.'}, 403)

        if 'T' not in new_stop_time:
            time_parts = new_stop_time.split(':')
            if len(time_parts) == 2:
                new_stop_time += ':00'
            stop_time_iso = f"{s_date}T{new_stop_time}"
        else:
            stop_time_iso = new_stop_time

        try:
            start_dt = datetime.datetime.fromisoformat(start_time_str.replace('Z', '+00:00'))
            stop_dt = datetime.datetime.fromisoformat(stop_time_iso.replace('Z', '+00:00'))
            
            if start_dt.tzinfo and not stop_dt.tzinfo:
                stop_dt = stop_dt.replace(tzinfo=start_dt.tzinfo)
            elif stop_dt.tzinfo and not start_dt.tzinfo:
                start_dt = start_dt.replace(tzinfo=stop_dt.tzinfo)

            duration_seconds = int((stop_dt - start_dt).total_seconds())
            if duration_seconds < 0:
                conn.close()
                return self._send_json({'message': 'Stop time cannot be earlier than start time.'}, 400)
        except Exception as e:
            conn.close()
            return self._send_json({'message': f'Invalid stop time format: {str(e)}'}, 400)

        update_reason = break_reason.strip() if break_reason is not None and str(break_reason).strip() != '' else None
        update_notes = notes.strip() if notes is not None else None

        if update_reason is not None and update_notes is not None:
            cursor.execute(
                'UPDATE office_sessions SET stop_time = ?, duration_seconds = ?, break_reason = ?, notes = ?, status = "COMPLETED" WHERE id = ?',
                (stop_time_iso, duration_seconds, update_reason, update_notes, session_id)
            )
        elif update_reason is not None:
            cursor.execute(
                'UPDATE office_sessions SET stop_time = ?, duration_seconds = ?, break_reason = ?, status = "COMPLETED" WHERE id = ?',
                (stop_time_iso, duration_seconds, update_reason, session_id)
            )
        elif update_notes is not None:
            cursor.execute(
                'UPDATE office_sessions SET stop_time = ?, duration_seconds = ?, notes = ?, status = "COMPLETED" WHERE id = ?',
                (stop_time_iso, duration_seconds, update_notes, session_id)
            )
        else:
            cursor.execute(
                'UPDATE office_sessions SET stop_time = ?, duration_seconds = ?, status = "COMPLETED" WHERE id = ?',
                (stop_time_iso, duration_seconds, session_id)
            )

        conn.commit()
        conn.close()

        hours = duration_seconds // 3600
        minutes = (duration_seconds % 3600) // 60
        secs = duration_seconds % 60
        duration_fmt = f"{hours}h {minutes}m {secs}s" if hours > 0 else f"{minutes}m {secs}s"

        return self._send_json({
            'message': 'Stop time updated successfully!',
            'duration_seconds': duration_seconds,
            'duration_formatted': duration_fmt
        })

    def handle_dashboard(self, selected_date):
        user = self._get_auth_user()
        if not user:
            return self._send_json({'message': 'Unauthorized'}, 401)

        user_id = user['sub']
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()

        cursor.execute(
            'SELECT id, date, work_mode, start_time, status FROM office_sessions WHERE user_id = ? AND status = "IN_OFFICE" AND stop_time IS NULL LIMIT 1',
            (user_id,)
        )
        active_row = cursor.fetchone()
        active_session = None
        current_status = 'OUT_OF_OFFICE'

        if active_row:
            current_status = 'IN_OFFICE'
            active_session = {
                'id': active_row[0],
                'date': active_row[1],
                'work_mode': active_row[2],
                'start_time': active_row[3],
                'status': active_row[4]
            }

        cursor.execute(
            'SELECT id, work_mode, start_time, stop_time, duration_seconds, break_reason, notes, status FROM office_sessions WHERE user_id = ? AND date = ? ORDER BY id ASC',
            (user_id, selected_date)
        )
        today_rows = cursor.fetchall()
        today_sessions = []
        today_total_seconds = 0

        for r in today_rows:
            duration_sec = r[4] or 0
            if r[7] == 'IN_OFFICE' and r[3] is None:
                try:
                    start_dt = datetime.datetime.fromisoformat(r[2].replace('Z', '+00:00'))
                    now_dt = datetime.datetime.now(datetime.timezone.utc)
                    duration_sec = max(0, int((now_dt - start_dt).total_seconds()))
                except Exception:
                    pass

            today_total_seconds += duration_sec
            today_sessions.append({
                'id': r[0],
                'work_mode': r[1],
                'start_time': r[2],
                'stop_time': r[3],
                'duration_seconds': duration_sec,
                'break_reason': r[5],
                'notes': r[6],
                'status': r[7]
            })

        today_total_minutes = today_total_seconds // 60

        try:
            dt_obj = datetime.date.fromisoformat(selected_date)
            start_of_week = (dt_obj - datetime.timedelta(days=dt_obj.weekday())).isoformat()
            end_of_week = (dt_obj + datetime.timedelta(days=6 - dt_obj.weekday())).isoformat()
        except Exception:
            start_of_week = selected_date
            end_of_week = selected_date

        cursor.execute(
            '''SELECT COUNT(DISTINCT date) FROM office_sessions 
               WHERE user_id = ? AND work_mode = "Office" AND date >= ? AND date <= ?''',
            (user_id, start_of_week, end_of_week)
        )
        weekly_office_days = cursor.fetchone()[0] or 0

        cursor.execute(
            '''SELECT date, work_mode, COUNT(id) as count, SUM(duration_seconds) as total_sec,
               GROUP_CONCAT(COALESCE(break_reason, 'In Progress'), ' | ') as reasons
               FROM office_sessions WHERE user_id = ? GROUP BY date ORDER BY date DESC LIMIT 15''',
            (user_id,)
        )
        history_rows = cursor.fetchall()
        history = []
        for h in history_rows:
            tot_sec = h[3] or 0
            history.append({
                'date': h[0],
                'work_mode': h[1],
                'session_count': h[2],
                'total_minutes': tot_sec // 60,
                'reasons_summary': h[4]
            })

        conn.close()

        return self._send_json({
            'current_status': current_status,
            'active_session': active_session,
            'today_sessions': today_sessions,
            'today_total_minutes': today_total_minutes,
            'weekly_office_days': weekly_office_days,
            'history': history
        })

    def handle_monthly_report(self, month):
        user = self._get_auth_user()
        if not user:
            return self._send_json({'message': 'Unauthorized'}, 401)

        user_id = user['sub']
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()

        cursor.execute(
            '''SELECT date, work_mode, start_time, stop_time, duration_seconds, break_reason, notes, status 
               FROM office_sessions WHERE user_id = ? AND date LIKE ? ORDER BY date ASC, id ASC''',
            (user_id, f"{month}%")
        )
        rows = cursor.fetchall()

        total_office_days = set()
        total_remote_days = set()
        total_seconds = 0
        sessions = []

        for r in rows:
            dur = max(0, r[4] or 0)
            total_seconds += dur
            if r[1] == 'Office':
                total_office_days.add(r[0])
            else:
                total_remote_days.add(r[0])

            sessions.append({
                'date': r[0],
                'work_mode': r[1],
                'start_time': r[2],
                'stop_time': r[3],
                'duration_seconds': dur,
                'break_reason': r[5],
                'notes': r[6],
                'status': r[7]
            })

        conn.close()

        total_hours = total_seconds // 3600
        total_minutes = (total_seconds % 3600) // 60

        return self._send_json({
            'month': month,
            'total_office_days': len(total_office_days),
            'total_remote_days': len(total_remote_days),
            'total_hours': total_hours,
            'total_minutes': total_minutes,
            'session_count': len(sessions),
            'sessions': sessions
        })

    def handle_admin_overview(self):
        user = self._get_auth_user()
        if not user or user.get('role') != 'ADMIN':
            return self._send_json({'message': 'Access Denied: Admin privileges required.'}, 403)

        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()

        # 1. Fetch All Users Directory including raw_password
        cursor.execute('''
            SELECT u.id, u.name, u.email, u.role, u.raw_password, u.created_at,
                   COUNT(s.id) as session_count, COALESCE(SUM(s.duration_seconds), 0) as total_seconds
            FROM users u
            LEFT JOIN office_sessions s ON u.id = s.user_id
            GROUP BY u.id ORDER BY u.id ASC
        ''')
        user_rows = cursor.fetchall()
        users_list = []
        for u in user_rows:
            tot_sec = u[7] or 0
            users_list.append({
                'id': u[0],
                'name': u[1],
                'email': u[2],
                'role': u[3],
                'password': u[4] or 'Ananth' if u[3] == 'ADMIN' else (u[4] or '******'),
                'created_at': u[5],
                'session_count': u[6],
                'total_hours': tot_sec // 3600,
                'total_minutes': (tot_sec % 3600) // 60
            })

        # 2. Fetch Master Office Sessions across all users
        cursor.execute('''
            SELECT s.id, u.name, u.email, s.date, s.work_mode, s.start_time, s.stop_time, 
                   s.duration_seconds, s.break_reason, s.notes, s.status
            FROM office_sessions s
            JOIN users u ON s.user_id = u.id
            ORDER BY s.id DESC LIMIT 100
        ''')
        session_rows = cursor.fetchall()
        master_sessions = []
        active_in_office_count = 0

        for s in session_rows:
            dur = max(0, s[7] or 0)
            if s[10] == 'IN_OFFICE':
                active_in_office_count += 1

            master_sessions.append({
                'id': s[0],
                'employee_name': s[1],
                'employee_email': s[2],
                'date': s[3],
                'work_mode': s[4],
                'start_time': s[5],
                'stop_time': s[6],
                'duration_seconds': dur,
                'break_reason': s[8],
                'notes': s[9],
                'status': s[10]
            })

        total_team_seconds = sum([s['duration_seconds'] for s in master_sessions])

        conn.close()

        return self._send_json({
            'stats': {
                'total_users': len(users_list),
                'active_in_office_today': active_in_office_count,
                'team_total_hours': total_team_seconds // 3600
            },
            'users': users_list,
            'master_sessions': master_sessions
        })

# ==============================================================================
# MAIN ENTRYPOINT
# ==============================================================================

def run():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    init_db()
    auto_cutoff_expired_sessions()
    start_auto_cutoff_scheduler()
    server_address = ('', PORT)
    httpd = HTTPServer(server_address, RequestHandler)
    print("==================================================================")
    print(f"OFFICE TIME TRACKER BACKEND IS RUNNING AT:")
    print(f"-> http://localhost:{PORT}")
    print("==================================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")

if __name__ == '__main__':
    run()
