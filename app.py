#!/usr/bin/env python3
"""
WorkPulse - Office & Task Time Tracker Backend
Runs on Python 3 standard library with SQLite (Zero External Dependencies Required!).
Includes:
- Full Live & Completed Session Editing with Child Task Reconciliation & Audit Trails
- Manual Task Entry: Historical Completed Tasks & Retroactive Live Running Tasks
- Dynamic & Custom Categories System
- Comprehensive 7-Day Weekly Attendance Logic (Monday -> Sunday, actual attendance independent of preferences)
- Hierarchical Presence & Work Sessions (Office Mode & Remote/WFH Mode)
- Strict Task Coupling: Stopping Session auto-stops active Task; No Ghost Tasks
- Flexible Weekly Office Target Configurations (Days + Hours)
- Atomic Task Switching & Server-side Timestamps
- Combined Chronological Activity Timeline
- Admin Portal, Password Management, and Free Email Reports
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
import threading
import time
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

# Configuration
PORT = int(os.environ.get('PORT', 5000))
DB_FILE = os.environ.get('DB_FILE', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'database.db'))
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public')
JWT_SECRET = os.environ.get('JWT_SECRET', 'office_tracker_secret_key_2026_super_secure')

# SMTP Configuration
SMTP_HOST = os.environ.get('SMTP_HOST', 'smtp.office365.com')
SMTP_PORT = int(os.environ.get('SMTP_PORT', 587))
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'deepakkumar.kc@sagitec.com')
SENDER_PASSWORD = os.environ.get('SENDER_PASSWORD', '')

# Standard Default Categories
DEFAULT_CATEGORIES = [
    'Development', 'Meeting', 'Email', 'Communication', 'Research',
    'Documentation', 'Support', 'Administration', 'Client Work',
    'Planning', 'Training', 'Review', 'Other'
]

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
    
    # 1. Create Users Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'USER',
            raw_password TEXT,
            target_office_days INTEGER DEFAULT 3,
            target_office_hours REAL DEFAULT 24.0,
            preferred_days TEXT DEFAULT 'Mon,Tue,Wed,Thu,Fri',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # 2. Create Office / Work Sessions Table (Presence & Session Source of Truth)
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

    # 3. Create Tasks Table (Detailed Work Activities inside Active Work Session)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            session_id INTEGER,
            date TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            category TEXT DEFAULT 'Other',
            work_mode TEXT DEFAULT 'Office',
            start_time TEXT NOT NULL,
            stop_time TEXT,
            duration_seconds INTEGER DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id),
            FOREIGN KEY (session_id) REFERENCES office_sessions (id) ON DELETE SET NULL
        )
    ''')

    # Column Migrations
    cursor.execute("PRAGMA table_info(users)")
    u_cols = [row[1] for row in cursor.fetchall()]
    if 'role' not in u_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'USER'")
    if 'raw_password' not in u_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN raw_password TEXT")
    if 'target_office_days' not in u_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN target_office_days INTEGER DEFAULT 3")
    if 'target_office_hours' not in u_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN target_office_hours REAL DEFAULT 24.0")
    if 'preferred_days' not in u_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN preferred_days TEXT DEFAULT 'Mon,Tue,Wed,Thu,Fri'")

    cursor.execute("PRAGMA table_info(office_sessions)")
    s_cols = [row[1] for row in cursor.fetchall()]
    if 'break_reason' not in s_cols:
        cursor.execute("ALTER TABLE office_sessions ADD COLUMN break_reason TEXT")
    if 'notes' not in s_cols:
        cursor.execute("ALTER TABLE office_sessions ADD COLUMN notes TEXT")

    cursor.execute("PRAGMA table_info(tasks)")
    t_cols = [row[1] for row in cursor.fetchall()]
    if 'work_mode' not in t_cols:
        cursor.execute("ALTER TABLE tasks ADD COLUMN work_mode TEXT DEFAULT 'Office'")

    # Auto-Seed Admin: Deepak / Ananth
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
            "INSERT INTO users (name, email, password_hash, salt, role, raw_password, target_office_days, target_office_hours) VALUES (?, ?, ?, ?, 'ADMIN', ?, 3, 24.0)",
            (admin_name, admin_email, admin_hash, admin_salt, admin_pass)
        )

    conn.commit()
    conn.close()
    print(f"[Database] SQLite database initialized at: {DB_FILE}")

# ==============================================================================
# AUTO-CUTOFF HELPER & GHOST TASK CLEANUP
# ==============================================================================

def auto_cutoff_expired_sessions():
    """
    Auto-cutoffs active office/remote sessions that span past midnight (12:00 AM) or on past dates.
    Also cleans up ghost tasks that were left running without an active session.
    """
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        now_dt = datetime.datetime.now()
        today_str = datetime.date.today().isoformat()

        # 1. Auto-Cutoff Sessions
        cursor.execute('SELECT id, date, start_time FROM office_sessions WHERE status IN ("IN_OFFICE", "WORKING_REMOTE") AND stop_time IS NULL')
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

                # Auto-stop any linked tasks at midnight cutoff
                cursor.execute(
                    '''UPDATE tasks 
                       SET stop_time = ?, duration_seconds = ?, status = 'AUTO_CUTOFF', updated_at = CURRENT_TIMESTAMP
                       WHERE session_id = ? AND status = 'IN_PROGRESS' AND stop_time IS NULL''',
                    (cutoff_stop_time, duration_seconds, s_id)
                )

        # 2. Auto-Cutoff Any Remaining Running Tasks Past Midnight
        cursor.execute('SELECT id, user_id, date, start_time, session_id FROM tasks WHERE status = "IN_PROGRESS" AND stop_time IS NULL')
        active_tasks = cursor.fetchall()

        for t_id, t_user_id, t_date, t_start_time, t_session_id in active_tasks:
            cursor.execute(
                'SELECT id FROM office_sessions WHERE user_id = ? AND date = ? AND status IN ("IN_OFFICE", "WORKING_REMOTE") AND stop_time IS NULL',
                (t_user_id, t_date)
            )
            has_active_session = cursor.fetchone() is not None

            is_past_date = t_date < today_str
            should_cutoff = is_past_date or not has_active_session

            if not should_cutoff:
                try:
                    task_end_dt = datetime.datetime.fromisoformat(f"{t_date}T23:59:59")
                    if now_dt > task_end_dt:
                        should_cutoff = True
                except Exception:
                    pass

            if should_cutoff:
                cutoff_stop_time = f"{t_date}T23:59:59" if is_past_date else datetime.datetime.now(datetime.timezone.utc).isoformat()
                try:
                    clean_start = t_start_time.replace('Z', '+00:00')
                    start_dt = datetime.datetime.fromisoformat(clean_start)
                    if start_dt.tzinfo:
                        stop_dt = datetime.datetime.fromisoformat(f"{cutoff_stop_time.replace('Z', '+00:00')}")
                    else:
                        stop_dt = datetime.datetime.fromisoformat(f"{cutoff_stop_time}")
                    duration_seconds = max(0, int((stop_dt - start_dt).total_seconds()))
                except Exception:
                    duration_seconds = 0

                cursor.execute(
                    '''UPDATE tasks 
                       SET stop_time = ?, duration_seconds = ?, status = 'AUTO_CUTOFF', updated_at = CURRENT_TIMESTAMP
                       WHERE id = ?''',
                    (cutoff_stop_time, duration_seconds, t_id)
                )

        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[Auto Cutoff Error] {e}")

def start_auto_cutoff_scheduler():
    def loop():
        while True:
            auto_cutoff_expired_sessions()
            time.sleep(60)

    t = threading.Thread(target=loop, daemon=True)
    t.start()

# ==============================================================================
# JWT TOKEN HELPERS
# ==============================================================================

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

# Helper to format ISO to nice time string (HH:MM AM/PM)
def format_time_label(iso_str):
    if not iso_str:
        return ''
    try:
        if 'T' in iso_str:
            t_part = iso_str.split('T')[1][:5]
        else:
            t_part = iso_str[:5]
        dt = datetime.datetime.strptime(t_part, '%H:%M')
        return dt.strftime('%I:%M %p').lstrip('0')
    except Exception:
        return iso_str

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
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(' ')[1]
            payload = decode_token(token)
            if payload:
                return payload

        # Query parameter fallback (useful for direct browser file downloads)
        try:
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)
            if 'token' in qs and qs['token'][0]:
                payload = decode_token(qs['token'][0])
                if payload:
                    return payload
        except Exception:
            pass

        return None

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

        if path == '/api/user/settings':
            self.handle_get_user_settings()
            return

        if path == '/api/tasks':
            query_params = urllib.parse.parse_qs(parsed_url.query)
            selected_date = query_params.get('date', [datetime.date.today().isoformat()])[0]
            self.handle_get_tasks(selected_date)
            return

        if path == '/api/tasks/categories':
            self.handle_get_categories()
            return

        if path == '/api/reports/range':
            query_params = urllib.parse.parse_qs(parsed_url.query)
            self.handle_range_report(query_params)
            return

        if path == '/api/reports/export':
            query_params = urllib.parse.parse_qs(parsed_url.query)
            self.handle_export_report(query_params)
            return

        if path == '/api/reports/monthly':
            query_params = urllib.parse.parse_qs(parsed_url.query)
            month = query_params.get('month', [datetime.date.today().strftime('%Y-%m')])[0]
            self.handle_monthly_report(month)
            return

        if path == '/api/admin/overview':
            self.handle_admin_overview()
            return

        # Static File Serving
        filepath = path.lstrip('/')
        if not filepath:
            filepath = 'index.html'
        
        full_path = os.path.join(PUBLIC_DIR, filepath)
        
        if os.path.exists(full_path) and os.path.isfile(full_path):
            self.send_response(200)
            if filepath.endswith('.html'):
                self.send_header('Content-Type', 'text/html; charset=utf-8')
            elif filepath.endswith('.css'):
                self.send_header('Content-Type', 'text/css; charset=utf-8')
            elif filepath.endswith('.js'):
                self.send_header('Content-Type', 'application/javascript; charset=utf-8')
            elif filepath.endswith('.png'):
                self.send_header('Content-Type', 'image/png')
            elif filepath.endswith('.svg'):
                self.send_header('Content-Type', 'image/svg+xml')
            elif filepath.endswith('.ico'):
                self.send_header('Content-Type', 'image/x-icon')
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
        elif path == '/api/user/settings':
            self.handle_save_user_settings(payload)
        elif path == '/api/sessions/start':
            self.handle_session_start(payload)
        elif path == '/api/sessions/stop':
            self.handle_session_stop(payload)
        elif path == '/api/sessions/edit':
            self.handle_session_edit(payload)
        elif path == '/api/tasks/start':
            self.handle_task_start(payload)
        elif path == '/api/tasks/manual':
            self.handle_task_manual(payload)
        elif path == '/api/tasks/stop':
            self.handle_task_stop(payload)
        elif path == '/api/tasks/edit':
            self.handle_task_edit(payload)
        elif path == '/api/tasks/delete':
            self.handle_task_delete(payload)
        elif path == '/api/reports/send-email':
            self.handle_send_monthly_email(payload)
        elif path == '/api/admin/reset-user-password':
            self.handle_admin_reset_user_password(payload)
        else:
            self._send_json({'message': 'Endpoint not found'}, 404)

    # --------------------------------------------------------------------------
    # USER SETTINGS & TARGET CONFIGURATION HANDLERS
    # --------------------------------------------------------------------------

    def handle_get_user_settings(self):
        user = self._get_auth_user()
        if not user:
            return self._send_json({'message': 'Unauthorized'}, 401)

        user_id = user['sub']
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute(
            'SELECT name, email, role, target_office_days, target_office_hours, preferred_days FROM users WHERE id = ?',
            (user_id,)
        )
        row = cursor.fetchone()
        conn.close()

        if not row:
            return self._send_json({'message': 'User not found'}, 404)

        return self._send_json({
            'name': row[0],
            'email': row[1],
            'role': row[2],
            'target_office_days': row[3] if row[3] is not None else 3,
            'target_office_hours': row[4] if row[4] is not None else 24.0,
            'preferred_days': row[5] or 'Mon,Tue,Wed,Thu,Fri'
        })

    def handle_save_user_settings(self, payload):
        user = self._get_auth_user()
        if not user:
            return self._send_json({'message': 'Unauthorized'}, 401)

        user_id = user['sub']
        try:
            target_days = int(payload.get('target_office_days', 3))
            target_hours = float(payload.get('target_office_hours', 24.0))
        except (ValueError, TypeError):
            return self._send_json({'message': 'Invalid numerical values for targets.'}, 400)

        if target_days < 1 or target_days > 7:
            return self._send_json({'message': 'Weekly target office days must be between 1 and 7.'}, 400)
        if target_hours <= 0 or target_hours > 168:
            return self._send_json({'message': 'Weekly target office hours must be between 1 and 168 hours.'}, 400)

        preferred_days = payload.get('preferred_days', 'Mon,Tue,Wed,Thu,Fri').strip()

        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute(
            '''UPDATE users 
               SET target_office_days = ?, target_office_hours = ?, preferred_days = ? 
               WHERE id = ?''',
            (target_days, target_hours, preferred_days, user_id)
        )
        conn.commit()
        conn.close()

        return self._send_json({
            'message': 'Weekly office requirements updated successfully!',
            'target_office_days': target_days,
            'target_office_hours': target_hours,
            'preferred_days': preferred_days
        })

    # --------------------------------------------------------------------------
    # OFFICE / REMOTE PRESENCE SESSIONS HANDLERS
    # --------------------------------------------------------------------------

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

        status_flag = 'IN_OFFICE' if work_mode == 'Office' else 'WORKING_REMOTE'

        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()

        # Check if an active session is already running
        cursor.execute(
            'SELECT id, work_mode FROM office_sessions WHERE user_id = ? AND status IN ("IN_OFFICE", "WORKING_REMOTE") AND stop_time IS NULL',
            (user_id,)
        )
        existing = cursor.fetchone()
        if existing:
            conn.close()
            return self._send_json({
                'message': f"An active {existing[1]} session is already running. Please stop it first before starting a new session."
            }, 400)

        cursor.execute(
            'INSERT INTO office_sessions (user_id, date, work_mode, start_time, status) VALUES (?, ?, ?, ?, ?)',
            (user_id, date, work_mode, start_time, status_flag)
        )
        conn.commit()
        session_id = cursor.lastrowid
        conn.close()

        mode_msg = "Office presence session" if work_mode == "Office" else "Remote work session"
        return self._send_json({
            'message': f"{mode_msg} started successfully!",
            'session_id': session_id,
            'work_mode': work_mode,
            'status': status_flag
        }, 201)

    def handle_session_stop(self, payload):
        """
        Stops the active office or remote session.
        CRITICAL RULE: Automatically terminates any active task running in this session
        at the exact same stop_time, preventing 'ghost' tasks.
        """
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
            'SELECT id, start_time, work_mode FROM office_sessions WHERE user_id = ? AND status IN ("IN_OFFICE", "WORKING_REMOTE") AND stop_time IS NULL ORDER BY id DESC LIMIT 1',
            (user_id,)
        )
        row = cursor.fetchone()

        if not row:
            conn.close()
            return self._send_json({'message': 'No active work session found to stop.'}, 400)

        session_id, start_time_str, work_mode = row[0], row[1], row[2]
        
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

        # ----------------------------------------------------------------------
        # AUTOMATICALLY STOP ACTIVE TASK IF RUNNING
        # ----------------------------------------------------------------------
        cursor.execute(
            'SELECT id, title, start_time, description FROM tasks WHERE user_id = ? AND status = "IN_PROGRESS" AND stop_time IS NULL ORDER BY id DESC LIMIT 1',
            (user_id,)
        )
        active_t_row = cursor.fetchone()
        auto_stopped_task = None

        if active_t_row:
            t_id, t_title, t_start_time_str, t_desc = active_t_row
            try:
                t_st = datetime.datetime.fromisoformat(t_start_time_str.replace('Z', '+00:00'))
                t_dur = max(0, int((stop_dt - t_st).total_seconds()))
            except Exception:
                t_dur = 0

            stop_label = format_time_label(stop_time_iso)
            t_note_append = f" (Auto-ended when {work_mode} session ended at {stop_label})"
            new_t_desc = (t_desc or '') + t_note_append if not (t_desc or '').endswith(t_note_append) else (t_desc or '')

            cursor.execute(
                '''UPDATE tasks 
                   SET stop_time = ?, duration_seconds = ?, description = ?, status = "COMPLETED", updated_at = CURRENT_TIMESTAMP
                   WHERE id = ?''',
                (stop_time_iso, t_dur, new_t_desc, t_id)
            )

            t_h = t_dur // 3600
            t_m = (t_dur % 3600) // 60
            t_dur_fmt = f"{t_h}h {t_m}m" if t_h > 0 else f"{t_m}m {t_dur%60}s"
            auto_stopped_task = {
                'id': t_id,
                'title': t_title,
                'duration_seconds': t_dur,
                'duration_formatted': t_dur_fmt
            }

        conn.commit()
        conn.close()

        hours = duration_seconds // 3600
        minutes = (duration_seconds % 3600) // 60
        secs = duration_seconds % 60
        duration_fmt = f"{hours}h {minutes}m {secs}s" if hours > 0 else f"{minutes}m {secs}s"

        resp_msg = f"{work_mode} session stopped successfully."
        if auto_stopped_task:
            resp_msg += f" Active task '{auto_stopped_task['title']}' was automatically completed ({auto_stopped_task['duration_formatted']})."

        return self._send_json({
            'message': resp_msg,
            'duration_seconds': duration_seconds,
            'duration_formatted': duration_fmt,
            'break_reason': break_reason,
            'notes': notes,
            'auto_stopped_task': auto_stopped_task
        })

    def handle_session_edit(self, payload):
        """
        Allows users to edit any session (live or completed) with:
        - start_time, stop_time, break_reason, notes, date, work_mode.
        CRITICAL RECONCILIATION:
        1. If session was LIVE and stop_time is provided -> status becomes 'COMPLETED'.
        2. Automatically reconciles all child tasks:
           - Running tasks stopped at new stop_time.
           - Overextending tasks trimmed to new stop_time.
           - Tasks starting prior to new start_time adjusted.
           - Audit trail notes added to all reconciled tasks.
        """
        user = self._get_auth_user()
        if not user:
            return self._send_json({'message': 'Unauthorized'}, 401)

        user_id = user['sub']
        session_id = payload.get('session_id')
        new_start_time = payload.get('start_time', '').strip()
        new_stop_time = payload.get('stop_time', '').strip()
        break_reason = payload.get('break_reason')
        notes = payload.get('notes')
        new_date = payload.get('date', '').strip()

        if not session_id:
            return self._send_json({'message': 'Session ID is required.'}, 400)

        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()

        cursor.execute(
            'SELECT id, user_id, date, start_time, stop_time, status, work_mode FROM office_sessions WHERE id = ?',
            (session_id,)
        )
        row = cursor.fetchone()

        if not row:
            conn.close()
            return self._send_json({'message': 'Session not found.'}, 404)

        s_id, s_user_id, s_date, old_start_time, old_stop_time, old_status, s_work_mode = row

        if s_user_id != user_id and user.get('role') != 'ADMIN':
            conn.close()
            return self._send_json({'message': 'Forbidden: Cannot edit another user\'s session.'}, 403)

        effective_date = new_date if new_date else s_date

        # Format start time ISO
        if new_start_time:
            if 'T' not in new_start_time:
                parts = new_start_time.split(':')
                if len(parts) == 2:
                    new_start_time += ':00'
                final_start_iso = f"{effective_date}T{new_start_time}"
            else:
                final_start_iso = new_start_time
        else:
            final_start_iso = old_start_time

        # Format stop time ISO
        final_stop_iso = None
        if new_stop_time:
            if 'T' not in new_stop_time:
                parts = new_stop_time.split(':')
                if len(parts) == 2:
                    new_stop_time += ':00'
                final_stop_iso = f"{effective_date}T{new_stop_time}"
            else:
                final_stop_iso = new_stop_time
        elif old_stop_time:
            final_stop_iso = old_stop_time

        # Calculate session duration
        duration_seconds = 0
        final_status = old_status

        if final_start_iso and final_stop_iso:
            try:
                start_dt = datetime.datetime.fromisoformat(final_start_iso.replace('Z', '+00:00'))
                stop_dt = datetime.datetime.fromisoformat(final_stop_iso.replace('Z', '+00:00'))
                
                if start_dt.tzinfo and not stop_dt.tzinfo:
                    stop_dt = stop_dt.replace(tzinfo=start_dt.tzinfo)
                elif stop_dt.tzinfo and not start_dt.tzinfo:
                    start_dt = start_dt.replace(tzinfo=stop_dt.tzinfo)

                duration_seconds = int((stop_dt - start_dt).total_seconds())
                if duration_seconds < 0:
                    conn.close()
                    return self._send_json({'message': 'Stop time cannot be earlier than start time.'}, 400)
                final_status = 'COMPLETED'
            except Exception as e:
                conn.close()
                return self._send_json({'message': f'Invalid timestamp format: {str(e)}'}, 400)

        update_reason = break_reason.strip() if break_reason is not None and str(break_reason).strip() != '' else 'End of Workday'
        update_notes = notes.strip() if notes is not None else None

        cursor.execute(
            '''UPDATE office_sessions 
               SET date = ?, start_time = ?, stop_time = ?, duration_seconds = ?, break_reason = ?, notes = ?, status = ? 
               WHERE id = ?''',
            (effective_date, final_start_iso, final_stop_iso, duration_seconds, update_reason, update_notes, final_status, session_id)
        )

        # ----------------------------------------------------------------------
        # AUTOMATIC CHILD TASK RECONCILIATION & AUDIT TRAIL
        # ----------------------------------------------------------------------
        reconciled_tasks = []
        if final_stop_iso:
            stop_label = format_time_label(final_stop_iso)
            stop_dt_clean = datetime.datetime.fromisoformat(final_stop_iso.replace('Z', '+00:00'))
            start_dt_clean = datetime.datetime.fromisoformat(final_start_iso.replace('Z', '+00:00'))

            # 1. Reconcile running tasks under this session
            cursor.execute(
                '''SELECT id, title, start_time, description FROM tasks 
                   WHERE user_id = ? AND (session_id = ? OR (date = ? AND status = "IN_PROGRESS")) AND status = "IN_PROGRESS"''',
                (user_id, session_id, effective_date)
            )
            running_tasks = cursor.fetchall()
            for rt in running_tasks:
                rt_id, rt_title, rt_st_str, rt_desc = rt
                try:
                    rt_st = datetime.datetime.fromisoformat(rt_st_str.replace('Z', '+00:00'))
                    if rt_st.tzinfo and not stop_dt_clean.tzinfo:
                        stop_dt_clean = stop_dt_clean.replace(tzinfo=rt_st.tzinfo)
                    elif stop_dt_clean.tzinfo and not rt_st.tzinfo:
                        rt_st = rt_st.replace(tzinfo=stop_dt_clean.tzinfo)

                    # If task started after session end, align it
                    if rt_st >= stop_dt_clean:
                        rt_st = stop_dt_clean
                        rt_dur = 0
                    else:
                        rt_dur = max(0, int((stop_dt_clean - rt_st).total_seconds()))
                except Exception:
                    rt_dur = 0

                note = f" (Auto-ended when {s_work_mode} session ended at {stop_label})"
                new_desc = (rt_desc or '') + note if not (rt_desc or '').endswith(note) else (rt_desc or '')

                cursor.execute(
                    '''UPDATE tasks 
                       SET stop_time = ?, duration_seconds = ?, description = ?, status = "COMPLETED", updated_at = CURRENT_TIMESTAMP 
                       WHERE id = ?''',
                    (final_stop_iso, rt_dur, new_desc, rt_id)
                )
                reconciled_tasks.append({'id': rt_id, 'title': rt_title, 'action': 'stopped', 'duration': rt_dur})

            # 2. Reconcile completed tasks that extend past new stop_time
            cursor.execute(
                '''SELECT id, title, start_time, stop_time, description FROM tasks 
                   WHERE user_id = ? AND session_id = ? AND status = "COMPLETED" AND stop_time IS NOT NULL''',
                (user_id, session_id)
            )
            completed_tasks = cursor.fetchall()
            for ct in completed_tasks:
                ct_id, ct_title, ct_st_str, ct_sp_str, ct_desc = ct
                try:
                    ct_st = datetime.datetime.fromisoformat(ct_st_str.replace('Z', '+00:00'))
                    ct_sp = datetime.datetime.fromisoformat(ct_sp_str.replace('Z', '+00:00'))
                    if ct_sp.tzinfo and not stop_dt_clean.tzinfo:
                        stop_dt_clean = stop_dt_clean.replace(tzinfo=ct_sp.tzinfo)
                    elif stop_dt_clean.tzinfo and not ct_sp.tzinfo:
                        ct_sp = ct_sp.replace(tzinfo=stop_dt_clean.tzinfo)

                    if ct_sp > stop_dt_clean:
                        new_ct_sp = final_stop_iso
                        new_dur = max(0, int((stop_dt_clean - ct_st).total_seconds()))
                        note = f" (Auto-trimmed to session end at {stop_label})"
                        new_desc = (ct_desc or '') + note if not (ct_desc or '').endswith(note) else (ct_desc or '')

                        cursor.execute(
                            '''UPDATE tasks 
                               SET stop_time = ?, duration_seconds = ?, description = ?, updated_at = CURRENT_TIMESTAMP 
                               WHERE id = ?''',
                            (new_ct_sp, new_dur, new_desc, ct_id)
                        )
                        reconciled_tasks.append({'id': ct_id, 'title': ct_title, 'action': 'trimmed', 'duration': new_dur})
                except Exception:
                    pass

        conn.commit()
        conn.close()

        hours = duration_seconds // 3600
        minutes = (duration_seconds % 3600) // 60
        secs = duration_seconds % 60
        duration_fmt = f"{hours}h {minutes}m {secs}s" if hours > 0 else f"{minutes}m {secs}s"

        msg = f"{s_work_mode} session updated successfully!"
        if reconciled_tasks:
            msg += f" Synchronized {len(reconciled_tasks)} related task(s)."

        return self._send_json({
            'message': msg,
            'duration_seconds': duration_seconds,
            'duration_formatted': duration_fmt,
            'status': final_status,
            'reconciled_tasks': reconciled_tasks
        })

    # --------------------------------------------------------------------------
    # TASK & ACTIVITY TRACKING HANDLERS
    # --------------------------------------------------------------------------

    def handle_get_categories(self):
        user = self._get_auth_user()
        if not user:
            return self._send_json({'message': 'Unauthorized'}, 401)

        user_id = user['sub']
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()

        cursor.execute('SELECT DISTINCT category FROM tasks WHERE user_id = ? AND category IS NOT NULL', (user_id,))
        rows = cursor.fetchall()
        conn.close()

        user_cats = set([r[0].strip() for r in rows if r[0] and r[0].strip()])
        all_cats = list(dict.fromkeys(DEFAULT_CATEGORIES + sorted(list(user_cats))))

        return self._send_json({'categories': all_cats})

    def handle_get_tasks(self, selected_date):
        user = self._get_auth_user()
        if not user:
            return self._send_json({'message': 'Unauthorized'}, 401)

        user_id = user['sub']
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()

        # Check if active work session exists on selected date
        cursor.execute(
            'SELECT id, work_mode FROM office_sessions WHERE user_id = ? AND date = ? AND status IN ("IN_OFFICE", "WORKING_REMOTE") AND stop_time IS NULL',
            (user_id, selected_date)
        )
        active_sess_row = cursor.fetchone()

        # Active running task
        cursor.execute(
            '''SELECT id, session_id, date, title, description, category, work_mode, start_time, duration_seconds, status 
               FROM tasks WHERE user_id = ? AND status = "IN_PROGRESS" AND stop_time IS NULL ORDER BY id DESC LIMIT 1''',
            (user_id,)
        )
        active_row = cursor.fetchone()
        active_task = None
        if active_row:
            if not active_sess_row:
                cutoff_stop_time = datetime.datetime.now(datetime.timezone.utc).isoformat()
                cursor.execute(
                    '''UPDATE tasks 
                       SET stop_time = ?, status = 'COMPLETED', description = description || ' (Auto-closed: No active session)'
                       WHERE id = ?''',
                    (cutoff_stop_time, active_row[0])
                )
                conn.commit()
            else:
                active_task = {
                    'id': active_row[0],
                    'session_id': active_row[1],
                    'date': active_row[2],
                    'title': active_row[3],
                    'description': active_row[4] or '',
                    'category': active_row[5] or 'Other',
                    'work_mode': active_row[6] or 'Office',
                    'start_time': active_row[7],
                    'duration_seconds': active_row[8] or 0,
                    'status': active_row[9]
                }

        # Tasks on selected_date
        cursor.execute(
            '''SELECT id, session_id, date, title, description, category, work_mode, start_time, stop_time, duration_seconds, status 
               FROM tasks WHERE user_id = ? AND date = ? ORDER BY start_time ASC, id ASC''',
            (user_id, selected_date)
        )
        task_rows = cursor.fetchall()
        tasks = []
        total_task_seconds = 0
        categories_count = {}

        for r in task_rows:
            dur = r[9] or 0
            if r[10] == 'IN_PROGRESS' and r[8] is None:
                try:
                    st = datetime.datetime.fromisoformat(r[7].replace('Z', '+00:00'))
                    now = datetime.datetime.now(datetime.timezone.utc)
                    dur = max(0, int((now - st).total_seconds()))
                except Exception:
                    pass

            total_task_seconds += dur
            cat = r[5] or 'Other'
            categories_count[cat] = categories_count.get(cat, 0) + dur

            tasks.append({
                'id': r[0],
                'session_id': r[1],
                'date': r[2],
                'title': r[3],
                'description': r[4] or '',
                'category': cat,
                'work_mode': r[6] or 'Office',
                'start_time': r[7],
                'stop_time': r[8],
                'duration_seconds': dur,
                'status': r[10]
            })

        conn.close()

        return self._send_json({
            'date': selected_date,
            'active_task': active_task,
            'tasks': tasks,
            'total_task_seconds': total_task_seconds,
            'category_breakdown': categories_count
        })

    def handle_task_start(self, payload):
        """
        Starts a new task live.
        """
        user = self._get_auth_user()
        if not user:
            return self._send_json({'message': 'Unauthorized'}, 401)

        user_id = user['sub']
        title = payload.get('title', '').strip()
        if not title:
            return self._send_json({'message': 'Task title/name is required.'}, 400)

        category = payload.get('category', 'Other').strip() or 'Other'
        description = payload.get('description', '').strip()
        date = payload.get('date', datetime.date.today().isoformat())
        start_time = payload.get('start_time', datetime.datetime.now(datetime.timezone.utc).isoformat())
        switch_task = payload.get('switch_task', False)

        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()

        # 1. Verify Active Session Requirement
        cursor.execute(
            'SELECT id, work_mode, start_time FROM office_sessions WHERE user_id = ? AND date = ? AND status IN ("IN_OFFICE", "WORKING_REMOTE") AND stop_time IS NULL ORDER BY id DESC LIMIT 1',
            (user_id, date)
        )
        session_row = cursor.fetchone()

        if not session_row:
            conn.close()
            return self._send_json({
                'message': 'Start your office presence session (or remote work session) before starting a task.',
                'requires_session': True
            }, 400)

        session_id, session_mode, session_start = session_row

        # 2. Check if another task is currently running
        cursor.execute(
            'SELECT id, title, start_time, description FROM tasks WHERE user_id = ? AND status = "IN_PROGRESS" AND stop_time IS NULL',
            (user_id,)
        )
        existing_task = cursor.fetchone()

        switched_from_task = None
        if existing_task:
            if switch_task:
                prev_id, prev_title, prev_st, prev_desc = existing_task
                try:
                    p_st = datetime.datetime.fromisoformat(prev_st.replace('Z', '+00:00'))
                    p_sp = datetime.datetime.fromisoformat(start_time.replace('Z', '+00:00'))
                    prev_dur = max(0, int((p_sp - p_st).total_seconds()))
                except Exception:
                    prev_dur = 0

                cursor.execute(
                    '''UPDATE tasks 
                       SET stop_time = ?, duration_seconds = ?, status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP
                       WHERE id = ?''',
                    (start_time, prev_dur, prev_id)
                )
                switched_from_task = prev_title
            else:
                conn.close()
                return self._send_json({
                    'message': f"You are currently working on '{existing_task[1]}'.",
                    'running_task': {
                        'id': existing_task[0],
                        'title': existing_task[1],
                        'start_time': existing_task[2]
                    },
                    'can_switch': True
                }, 400)

        cursor.execute(
            '''INSERT INTO tasks (user_id, session_id, date, title, description, category, work_mode, start_time, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'IN_PROGRESS')''',
            (user_id, session_id, date, title, description, category, session_mode, start_time)
        )
        conn.commit()
        task_id = cursor.lastrowid
        conn.close()

        msg = f"Task '{title}' started successfully!"
        if switched_from_task:
            msg = f"Completed '{switched_from_task}' and started '{title}'!"

        return self._send_json({
            'message': msg,
            'task': {
                'id': task_id,
                'session_id': session_id,
                'date': date,
                'title': title,
                'category': category,
                'work_mode': session_mode,
                'description': description,
                'start_time': start_time,
                'status': 'IN_PROGRESS'
            }
        }, 201)

    def handle_task_manual(self, payload):
        """
        Handles manual task entry:
        1. Both Start & Stop time provided -> Saves as historical COMPLETED task.
        2. Only Start time provided -> Starts task retroactively as IN_PROGRESS live task!
        3. Validates against parent work session and computes authoritative duration.
        """
        user = self._get_auth_user()
        if not user:
            return self._send_json({'message': 'Unauthorized'}, 401)

        user_id = user['sub']
        title = payload.get('title', '').strip()
        category = payload.get('category', 'Other').strip() or 'Other'
        description = payload.get('description', '').strip()
        date = payload.get('date', datetime.date.today().isoformat()).strip()
        start_time_raw = payload.get('start_time', '').strip()
        stop_time_raw = payload.get('stop_time', '').strip()
        switch_task = payload.get('switch_task', False)

        if not title:
            return self._send_json({'message': 'Task title is required.'}, 400)
        if not start_time_raw:
            return self._send_json({'message': 'Start time is required.'}, 400)

        # Format ISO strings
        if 'T' not in start_time_raw:
            if len(start_time_raw.split(':')) == 2:
                start_time_raw += ':00'
            start_iso = f"{date}T{start_time_raw}"
        else:
            start_iso = start_time_raw

        stop_iso = None
        if stop_time_raw:
            if 'T' not in stop_time_raw:
                if len(stop_time_raw.split(':')) == 2:
                    stop_time_raw += ':00'
                stop_iso = f"{date}T{stop_time_raw}"
            else:
                stop_iso = stop_time_raw

        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()

        # Find best parent work session on this date
        cursor.execute(
            '''SELECT id, work_mode, start_time, stop_time, status FROM office_sessions 
               WHERE user_id = ? AND date = ? ORDER BY id DESC LIMIT 1''',
            (user_id, date)
        )
        session_row = cursor.fetchone()
        session_id = session_row[0] if session_row else None
        work_mode = session_row[1] if session_row else 'Office'

        if stop_iso:
            # Completed historical task
            try:
                st_dt = datetime.datetime.fromisoformat(start_iso.replace('Z', '+00:00'))
                sp_dt = datetime.datetime.fromisoformat(stop_iso.replace('Z', '+00:00'))
                if st_dt.tzinfo and not sp_dt.tzinfo:
                    sp_dt = sp_dt.replace(tzinfo=st_dt.tzinfo)
                elif sp_dt.tzinfo and not st_dt.tzinfo:
                    st_dt = st_dt.replace(tzinfo=sp_dt.tzinfo)

                duration_seconds = int((sp_dt - st_dt).total_seconds())
                if duration_seconds <= 0:
                    conn.close()
                    return self._send_json({'message': 'End time must be later than start time.'}, 400)
            except Exception as e:
                conn.close()
                return self._send_json({'message': f'Invalid time format: {str(e)}'}, 400)

            cursor.execute(
                '''INSERT INTO tasks (user_id, session_id, date, title, description, category, work_mode, start_time, stop_time, duration_seconds, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED')''',
                (user_id, session_id, date, title, description, category, work_mode, start_iso, stop_iso, duration_seconds)
            )
            conn.commit()
            task_id = cursor.lastrowid
            conn.close()

            h = duration_seconds // 3600
            m = (duration_seconds % 3600) // 60
            dur_fmt = f"{h}h {m}m" if h > 0 else f"{m}m {duration_seconds%60}s"

            return self._send_json({
                'message': f"Historical task '{title}' added ({dur_fmt})!",
                'task': {
                    'id': task_id,
                    'title': title,
                    'category': category,
                    'duration_seconds': duration_seconds,
                    'duration_formatted': dur_fmt,
                    'status': 'COMPLETED'
                }
            }, 201)
        else:
            # Retroactive live running task
            if not session_row or session_row[4] not in ('IN_OFFICE', 'WORKING_REMOTE'):
                conn.close()
                return self._send_json({
                    'message': 'To start a live task, you must have an active work session. Please start your session first.',
                    'requires_session': True
                }, 400)

            # Check if another task is running
            cursor.execute(
                'SELECT id, title, start_time FROM tasks WHERE user_id = ? AND status = "IN_PROGRESS" AND stop_time IS NULL',
                (user_id,)
            )
            running = cursor.fetchone()
            if running and not switch_task:
                conn.close()
                return self._send_json({
                    'message': f"You are currently working on '{running[1]}'.",
                    'running_task': {'id': running[0], 'title': running[1]},
                    'can_switch': True
                }, 400)

            if running and switch_task:
                p_id, p_title, p_st = running
                try:
                    p_st_dt = datetime.datetime.fromisoformat(p_st.replace('Z', '+00:00'))
                    now_dt = datetime.datetime.now(datetime.timezone.utc)
                    p_dur = max(0, int((now_dt - p_st_dt).total_seconds()))
                except Exception:
                    p_dur = 0
                cursor.execute(
                    '''UPDATE tasks SET stop_time = ?, duration_seconds = ?, status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?''',
                    (datetime.datetime.now(datetime.timezone.utc).isoformat(), p_dur, p_id)
                )

            cursor.execute(
                '''INSERT INTO tasks (user_id, session_id, date, title, description, category, work_mode, start_time, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'IN_PROGRESS')''',
                (user_id, session_id, date, title, description, category, work_mode, start_iso)
            )
            conn.commit()
            task_id = cursor.lastrowid
            conn.close()

            return self._send_json({
                'message': f"Live task '{title}' started from {format_time_label(start_iso)}!",
                'task': {
                    'id': task_id,
                    'title': title,
                    'category': category,
                    'start_time': start_iso,
                    'status': 'IN_PROGRESS'
                }
            }, 201)

    def handle_task_stop(self, payload):
        user = self._get_auth_user()
        if not user:
            return self._send_json({'message': 'Unauthorized'}, 401)

        user_id = user['sub']
        task_id = payload.get('task_id')
        stop_time_iso = payload.get('stop_time', datetime.datetime.now(datetime.timezone.utc).isoformat())
        notes = payload.get('notes', '').strip()

        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()

        if task_id:
            cursor.execute(
                'SELECT id, start_time, description, title FROM tasks WHERE id = ? AND user_id = ? AND status = "IN_PROGRESS"',
                (task_id, user_id)
            )
        else:
            cursor.execute(
                'SELECT id, start_time, description, title FROM tasks WHERE user_id = ? AND status = "IN_PROGRESS" AND stop_time IS NULL ORDER BY id DESC LIMIT 1',
                (user_id,)
            )
        row = cursor.fetchone()

        if not row:
            conn.close()
            return self._send_json({'message': 'No active task found to stop.'}, 400)

        t_id, start_time_str, old_desc, t_title = row[0], row[1], row[2], row[3]

        try:
            start_dt = datetime.datetime.fromisoformat(start_time_str.replace('Z', '+00:00'))
            stop_dt = datetime.datetime.fromisoformat(stop_time_iso.replace('Z', '+00:00'))
            duration_seconds = max(0, int((stop_dt - start_dt).total_seconds()))
        except Exception:
            duration_seconds = 0

        final_desc = (old_desc or '') + (f" | {notes}" if notes and old_desc else notes) if notes else old_desc

        cursor.execute(
            '''UPDATE tasks 
               SET stop_time = ?, duration_seconds = ?, description = ?, status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP
               WHERE id = ?''',
            (stop_time_iso, duration_seconds, final_desc, t_id)
        )
        conn.commit()
        conn.close()

        hours = duration_seconds // 3600
        minutes = (duration_seconds % 3600) // 60
        secs = duration_seconds % 60
        dur_fmt = f"{hours}h {minutes}m {secs}s" if hours > 0 else f"{minutes}m {secs}s"

        return self._send_json({
            'message': f"Task '{t_title}' completed successfully!",
            'task_id': t_id,
            'duration_seconds': duration_seconds,
            'duration_formatted': dur_fmt
        })

    def handle_task_edit(self, payload):
        user = self._get_auth_user()
        if not user:
            return self._send_json({'message': 'Unauthorized'}, 401)

        user_id = user['sub']
        task_id = payload.get('task_id')
        title = payload.get('title', '').strip()
        category = payload.get('category', 'Other').strip()
        description = payload.get('description', '').strip()
        start_time = payload.get('start_time', '').strip()
        stop_time = payload.get('stop_time', '').strip()

        if not task_id or not title:
            return self._send_json({'message': 'Task ID and Title are required.'}, 400)

        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()

        cursor.execute(
            'SELECT id, user_id, date, start_time, stop_time FROM tasks WHERE id = ?',
            (task_id,)
        )
        row = cursor.fetchone()
        if not row:
            conn.close()
            return self._send_json({'message': 'Task not found.'}, 404)

        if row[1] != user_id and user.get('role') != 'ADMIN':
            conn.close()
            return self._send_json({'message': 'Forbidden: Cannot edit another user\'s task.'}, 403)

        t_date = row[2]
        final_start = start_time if start_time else row[3]
        final_stop = stop_time if stop_time else row[4]

        if final_start and 'T' not in final_start:
            if len(final_start.split(':')) == 2:
                final_start += ':00'
            final_start = f"{t_date}T{final_start}"

        if final_stop and 'T' not in final_stop:
            if len(final_stop.split(':')) == 2:
                final_stop += ':00'
            final_stop = f"{t_date}T{final_stop}"

        duration_seconds = 0
        status = 'COMPLETED'
        if final_start and final_stop:
            try:
                st_dt = datetime.datetime.fromisoformat(final_start.replace('Z', '+00:00'))
                sp_dt = datetime.datetime.fromisoformat(final_stop.replace('Z', '+00:00'))
                if st_dt.tzinfo and not sp_dt.tzinfo:
                    sp_dt = sp_dt.replace(tzinfo=st_dt.tzinfo)
                elif sp_dt.tzinfo and not st_dt.tzinfo:
                    st_dt = st_dt.replace(tzinfo=sp_dt.tzinfo)
                duration_seconds = int((sp_dt - st_dt).total_seconds())
                if duration_seconds < 0:
                    conn.close()
                    return self._send_json({'message': 'Stop time cannot be earlier than start time.'}, 400)
            except Exception as e:
                conn.close()
                return self._send_json({'message': f'Invalid timestamp format: {str(e)}'}, 400)
        elif final_start and not final_stop:
            status = 'IN_PROGRESS'

        cursor.execute(
            '''UPDATE tasks 
               SET title = ?, category = ?, description = ?, start_time = ?, stop_time = ?, 
                   duration_seconds = ?, status = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?''',
            (title, category, description, final_start, final_stop, duration_seconds, status, task_id)
        )
        conn.commit()
        conn.close()

        return self._send_json({
            'message': 'Task details updated successfully!',
            'duration_seconds': duration_seconds
        })

    def handle_task_delete(self, payload):
        user = self._get_auth_user()
        if not user:
            return self._send_json({'message': 'Unauthorized'}, 401)

        user_id = user['sub']
        task_id = payload.get('task_id')
        if not task_id:
            return self._send_json({'message': 'Task ID is required.'}, 400)

        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()

        cursor.execute('SELECT id, user_id FROM tasks WHERE id = ?', (task_id,))
        row = cursor.fetchone()
        if not row:
            conn.close()
            return self._send_json({'message': 'Task not found.'}, 404)

        if row[1] != user_id and user.get('role') != 'ADMIN':
            conn.close()
            return self._send_json({'message': 'Forbidden: Cannot delete another user\'s task.'}, 403)

        cursor.execute('DELETE FROM tasks WHERE id = ?', (task_id,))
        conn.commit()
        conn.close()

        return self._send_json({'message': 'Task deleted successfully!'})

    # --------------------------------------------------------------------------
    # AUTHENTICATION HANDLERS
    # --------------------------------------------------------------------------

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
                'INSERT INTO users (name, email, password_hash, salt, role, raw_password, target_office_days, target_office_hours) VALUES (?, ?, ?, ?, "USER", ?, 3, 24.0)',
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

    def handle_login(self, payload):
        identifier = payload.get('email', '').strip().lower()
        password = payload.get('password', '')

        if not identifier or not password:
            return self._send_json({'message': 'Email/Username and password required.'}, 400)

        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute(
            'SELECT id, name, email, password_hash, salt, role, raw_password, target_office_days, target_office_hours FROM users WHERE LOWER(email) = ? OR LOWER(name) = ?',
            (identifier, identifier)
        )
        row = cursor.fetchone()

        if not row or not verify_password(password, row[3], row[4]):
            conn.close()
            return self._send_json({'message': 'Invalid credentials.'}, 401)

        user_id, name, user_email, role = row[0], row[1], row[2], (row[5] or 'USER')
        
        if not row[6]:
            cursor.execute('UPDATE users SET raw_password = ? WHERE id = ?', (password, user_id))
            conn.commit()

        conn.close()
        token = generate_token(user_id, user_email, role)

        return self._send_json({
            'message': 'Logged in successfully!',
            'token': token,
            'user': {
                'id': user_id,
                'name': name,
                'email': user_email,
                'role': role,
                'target_office_days': row[7] if row[7] is not None else 3,
                'target_office_hours': row[8] if row[8] is not None else 24.0
            }
        })

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

    # --------------------------------------------------------------------------
    # ENHANCED DASHBOARD & WEEKLY ATTENDANCE STRIP HANDLER
    # --------------------------------------------------------------------------

    def handle_dashboard(self, selected_date):
        user = self._get_auth_user()
        if not user:
            return self._send_json({'message': 'Unauthorized'}, 401)

        user_id = user['sub']
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()

        # 1. Fetch User Settings & Target Requirements
        cursor.execute(
            'SELECT name, email, target_office_days, target_office_hours, preferred_days FROM users WHERE id = ?',
            (user_id,)
        )
        user_row = cursor.fetchone()
        target_days = (user_row[2] if user_row and user_row[2] is not None else 3)
        target_hours = (user_row[3] if user_row and user_row[3] is not None else 24.0)
        preferred_days = (user_row[4] if user_row and user_row[4] is not None else 'Mon,Tue,Wed,Thu,Fri')

        pref_set = set([p.strip()[:3].capitalize() for p in (preferred_days or '').split(',') if p.strip()])

        # 2. Check Active Running Session
        cursor.execute(
            'SELECT id, date, work_mode, start_time, status FROM office_sessions WHERE user_id = ? AND status IN ("IN_OFFICE", "WORKING_REMOTE") AND stop_time IS NULL LIMIT 1',
            (user_id,)
        )
        active_row = cursor.fetchone()
        active_session = None
        current_status = 'OUT_OF_OFFICE'

        if active_row:
            current_status = active_row[4]
            active_session = {
                'id': active_row[0],
                'date': active_row[1],
                'work_mode': active_row[2],
                'start_time': active_row[3],
                'status': active_row[4]
            }

        # 3. Check Active Running Task (And clean up ghost tasks if session is inactive)
        cursor.execute(
            '''SELECT id, session_id, date, title, description, category, work_mode, start_time, duration_seconds, status 
               FROM tasks WHERE user_id = ? AND status = "IN_PROGRESS" AND stop_time IS NULL ORDER BY id DESC LIMIT 1''',
            (user_id,)
        )
        active_t_row = cursor.fetchone()
        active_task = None

        if active_t_row:
            if not active_session:
                cutoff_stop_time = datetime.datetime.now(datetime.timezone.utc).isoformat()
                cursor.execute(
                    '''UPDATE tasks 
                       SET stop_time = ?, status = 'COMPLETED', description = description || ' (Auto-closed: No active session)'
                       WHERE id = ?''',
                    (cutoff_stop_time, active_t_row[0])
                )
                conn.commit()
            else:
                active_task = {
                    'id': active_t_row[0],
                    'session_id': active_t_row[1],
                    'date': active_t_row[2],
                    'title': active_t_row[3],
                    'description': active_t_row[4] or '',
                    'category': active_t_row[5] or 'Other',
                    'work_mode': active_t_row[6] or active_session['work_mode'],
                    'start_time': active_t_row[7],
                    'duration_seconds': active_t_row[8] or 0,
                    'status': active_t_row[9]
                }

        # 4. Fetch Today's Sessions on selected_date
        cursor.execute(
            'SELECT id, work_mode, start_time, stop_time, duration_seconds, break_reason, notes, status FROM office_sessions WHERE user_id = ? AND date = ? ORDER BY start_time ASC, id ASC',
            (user_id, selected_date)
        )
        today_rows = cursor.fetchall()
        today_sessions = []
        today_office_seconds = 0
        today_remote_seconds = 0

        for r in today_rows:
            duration_sec = r[4] or 0
            if r[7] in ('IN_OFFICE', 'WORKING_REMOTE') and r[3] is None:
                try:
                    start_dt = datetime.datetime.fromisoformat(r[2].replace('Z', '+00:00'))
                    now_dt = datetime.datetime.now(datetime.timezone.utc)
                    duration_sec = max(0, int((now_dt - start_dt).total_seconds()))
                except Exception:
                    pass

            if r[1] == 'Office':
                today_office_seconds += duration_sec
            else:
                today_remote_seconds += duration_sec

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

        today_total_minutes = (today_office_seconds + today_remote_seconds) // 60
        today_office_minutes = today_office_seconds // 60

        # 5. Fetch Today's Tasks on selected_date
        cursor.execute(
            '''SELECT id, session_id, date, title, description, category, work_mode, start_time, stop_time, duration_seconds, status 
               FROM tasks WHERE user_id = ? AND date = ? ORDER BY start_time ASC, id ASC''',
            (user_id, selected_date)
        )
        today_t_rows = cursor.fetchall()
        today_tasks = []
        today_task_seconds = 0
        category_breakdown = {}

        for t in today_t_rows:
            t_dur = t[9] or 0
            if t[10] == 'IN_PROGRESS' and t[8] is None:
                try:
                    t_st = datetime.datetime.fromisoformat(t[7].replace('Z', '+00:00'))
                    now_utc = datetime.datetime.now(datetime.timezone.utc)
                    t_dur = max(0, int((now_utc - t_st).total_seconds()))
                except Exception:
                    pass

            today_task_seconds += t_dur
            cat = t[5] or 'Other'
            category_breakdown[cat] = category_breakdown.get(cat, 0) + t_dur

            today_tasks.append({
                'id': t[0],
                'session_id': t[1],
                'date': t[2],
                'title': t[3],
                'description': t[4] or '',
                'category': cat,
                'work_mode': t[6] or 'Office',
                'start_time': t[7],
                'stop_time': t[8],
                'duration_seconds': t_dur,
                'status': t[10]
            })

        # 6. 7-Day Universal Weekly Map (Monday -> Sunday)
        try:
            sel_dt = datetime.date.fromisoformat(selected_date)
        except Exception:
            sel_dt = datetime.date.today()

        today_dt = datetime.date.today()
        today_str = today_dt.isoformat()

        monday_dt = sel_dt - datetime.timedelta(days=sel_dt.weekday())
        sunday_dt = monday_dt + datetime.timedelta(days=6)
        start_of_week = monday_dt.isoformat()
        end_of_week = sunday_dt.isoformat()

        day_names_list = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        weekly_days_map = []
        actual_office_dates_set = set()
        total_weekly_office_seconds = 0

        for i in range(7):
            cur_date = monday_dt + datetime.timedelta(days=i)
            cur_date_str = cur_date.isoformat()
            day_name = day_names_list[i]

            cursor.execute(
                '''SELECT id, start_time, stop_time, duration_seconds, status 
                   FROM office_sessions 
                   WHERE user_id = ? AND date = ? AND work_mode = "Office"''',
                (user_id, cur_date_str)
            )
            day_session_rows = cursor.fetchall()

            day_sec = 0
            has_office = len(day_session_rows) > 0
            for ds in day_session_rows:
                dur = ds[3] or 0
                if ds[4] == 'IN_OFFICE' and ds[2] is None:
                    try:
                        st = datetime.datetime.fromisoformat(ds[1].replace('Z', '+00:00'))
                        dur = max(0, int((datetime.datetime.now(datetime.timezone.utc) - st).total_seconds()))
                    except Exception:
                        pass
                day_sec += dur

            if has_office:
                actual_office_dates_set.add(cur_date_str)
                total_weekly_office_seconds += day_sec

            weekly_days_map.append({
                'day_name': day_name,
                'date': cur_date_str,
                'day_num': cur_date.day,
                'attended': has_office,
                'day_seconds': day_sec,
                'hours': round(day_sec / 3600.0, 1),
                'is_preferred': day_name in pref_set,
                'is_today': (cur_date_str == today_str),
                'is_selected': (cur_date_str == selected_date)
            })

        weekly_office_days = len(actual_office_dates_set)
        weekly_office_hours = round(total_weekly_office_seconds / 3600.0, 1)

        weekly_days_remaining = max(0, target_days - weekly_office_days)
        weekly_hours_remaining = max(0.0, round(target_hours - weekly_office_hours, 1))

        weekly_days_percent = min(100, int(round((weekly_office_days / target_days) * 100))) if target_days > 0 else 100
        weekly_hours_percent = min(100, int(round((weekly_office_hours / target_hours) * 100))) if target_hours > 0 else 100

        # 7. Historical 15-day Log
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

        # 8. Build Combined Chronological Activity Timeline for selected_date
        timeline_events = []
        for s in today_sessions:
            if s['start_time']:
                mode_icon = "🏢" if s['work_mode'] == "Office" else "🏠"
                timeline_events.append({
                    'type': 'OFFICE_START',
                    'timestamp': s['start_time'],
                    'title': f"{mode_icon} Session Check-in ({s['work_mode']})",
                    'mode': s['work_mode'],
                    'session_id': s['id'],
                    'status': s['status']
                })
            if s['stop_time']:
                dur_m = s['duration_seconds'] // 60
                timeline_events.append({
                    'type': 'OFFICE_STOP',
                    'timestamp': s['stop_time'],
                    'title': f"Session Stop / Break: {s['break_reason'] or 'Session Ended'}",
                    'reason': s['break_reason'] or 'End of Workday',
                    'notes': s['notes'] or '',
                    'duration_seconds': s['duration_seconds'],
                    'duration_formatted': f"{dur_m // 60}h {dur_m % 60}m" if dur_m >= 60 else f"{dur_m}m",
                    'session_id': s['id'],
                    'status': s['status']
                })

        for t in today_tasks:
            t_dur_m = t['duration_seconds'] // 60
            t_dur_str = f"{t_dur_m // 60}h {t_dur_m % 60}m" if t_dur_m >= 60 else (f"{t_dur_m}m" if t_dur_m > 0 else f"{t['duration_seconds']}s")
            timeline_events.append({
                'type': 'TASK',
                'timestamp': t['start_time'],
                'stop_time': t['stop_time'],
                'title': t['title'],
                'category': t['category'],
                'work_mode': t['work_mode'],
                'description': t['description'],
                'duration_seconds': t['duration_seconds'],
                'duration_formatted': t_dur_str,
                'task_id': t['id'],
                'status': t['status']
            })

        timeline_events.sort(key=lambda ev: ev.get('timestamp') or '')

        # Distinct Categories
        cursor.execute('SELECT DISTINCT category FROM tasks WHERE user_id = ?', (user_id,))
        cat_rows = cursor.fetchall()
        user_cats = set([r[0].strip() for r in cat_rows if r[0] and r[0].strip()])
        all_categories = list(dict.fromkeys(DEFAULT_CATEGORIES + sorted(list(user_cats))))

        conn.close()

        return self._send_json({
            'current_status': current_status,
            'active_session': active_session,
            'active_task': active_task,
            'today_sessions': today_sessions,
            'today_tasks': today_tasks,
            'today_total_minutes': today_total_minutes,
            'today_office_minutes': today_office_minutes,
            'today_task_seconds': today_task_seconds,
            'category_breakdown': category_breakdown,
            'categories': all_categories,
            'timeline': timeline_events,
            'user_targets': {
                'target_office_days': target_days,
                'target_office_hours': target_hours,
                'preferred_days': preferred_days
            },
            'weekly_compliance': {
                'days_completed': weekly_office_days,
                'target_days': target_days,
                'days_remaining': weekly_days_remaining,
                'days_percent': weekly_days_percent,
                'hours_completed': weekly_office_hours,
                'target_hours': target_hours,
                'hours_remaining': weekly_hours_remaining,
                'hours_percent': weekly_hours_percent,
                'start_of_week': start_of_week,
                'end_of_week': end_of_week,
                'weekly_days_map': weekly_days_map
            },
            'weekly_office_days': weekly_office_days,
            'history': history
        })

    def handle_range_report(self, query_params):
        user = self._get_auth_user()
        if not user:
            return self._send_json({'message': 'Unauthorized'}, 401)

        user_id = user['sub']
        today_str = datetime.date.today().isoformat()
        thirty_days_ago = (datetime.date.today() - datetime.timedelta(days=30)).isoformat()

        start_date = query_params.get('start_date', [thirty_days_ago])[0]
        end_date = query_params.get('end_date', [today_str])[0]
        mode_filter = query_params.get('mode', ['All'])[0]
        cat_filter = query_params.get('category', ['All'])[0]
        search_filter = query_params.get('search', [''])[0].strip().lower()

        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()

        # 1. Query sessions in range
        sess_query = '''SELECT id, date, work_mode, start_time, stop_time, duration_seconds, break_reason, notes, status 
                        FROM office_sessions 
                        WHERE user_id = ? AND date >= ? AND date <= ?'''
        sess_params = [user_id, start_date, end_date]
        if mode_filter in ('Office', 'Remote'):
            sess_query += ' AND work_mode = ?'
            sess_params.append(mode_filter)
        sess_query += ' ORDER BY date DESC, start_time ASC, id ASC'

        cursor.execute(sess_query, sess_params)
        session_rows = cursor.fetchall()

        # 2. Query tasks in range
        task_query = '''SELECT id, session_id, date, title, description, category, work_mode, start_time, stop_time, duration_seconds, status 
                        FROM tasks 
                        WHERE user_id = ? AND date >= ? AND date <= ?'''
        task_params = [user_id, start_date, end_date]
        if mode_filter in ('Office', 'Remote'):
            task_query += ' AND work_mode = ?'
            task_params.append(mode_filter)
        if cat_filter and cat_filter != 'All':
            task_query += ' AND category = ?'
            task_params.append(cat_filter)
        if search_filter:
            task_query += ' AND (LOWER(title) LIKE ? OR LOWER(description) LIKE ?)'
            task_params.extend([f"%{search_filter}%", f"%{search_filter}%"])
        task_query += ' ORDER BY date DESC, start_time ASC, id ASC'

        cursor.execute(task_query, task_params)
        task_rows = cursor.fetchall()
        conn.close()

        # Build map of session_id -> list of tasks
        tasks_by_session = {}
        tasks_by_date = {}
        all_matched_tasks = []

        total_task_seconds = 0
        category_summary = {}

        for tr in task_rows:
            t_id, s_id, t_date, title, desc, cat, w_mode, st, sp, dur, status = tr
            dur = dur or 0
            total_task_seconds += dur
            c_name = cat or 'Other'
            if c_name not in category_summary:
                category_summary[c_name] = {'count': 0, 'seconds': 0}
            category_summary[c_name]['count'] += 1
            category_summary[c_name]['seconds'] += dur

            h = dur // 3600
            m = (dur % 3600) // 60
            dur_fmt = f"{h}h {m}m" if h > 0 else (f"{m}m {dur%60}s" if m > 0 else f"{dur}s")

            task_obj = {
                'id': t_id,
                'session_id': s_id,
                'date': t_date,
                'title': title,
                'description': desc or '',
                'category': c_name,
                'work_mode': w_mode or 'Office',
                'start_time': st,
                'stop_time': sp,
                'duration_seconds': dur,
                'duration_formatted': dur_fmt,
                'status': status
            }
            all_matched_tasks.append(task_obj)

            if s_id:
                if s_id not in tasks_by_session:
                    tasks_by_session[s_id] = []
                tasks_by_session[s_id].append(task_obj)
            else:
                if t_date not in tasks_by_date:
                    tasks_by_date[t_date] = []
                tasks_by_date[t_date].append(task_obj)

        # Build Hierarchical Days Structure (Date -> Sessions -> Tasks)
        days_map = {}
        unique_office_dates = set()
        unique_remote_dates = set()
        total_office_seconds = 0
        total_remote_seconds = 0
        all_sessions_list = []

        for sr in session_rows:
            s_id, s_date, w_mode, st, sp, dur, reason, notes, status = sr
            dur = dur or 0
            if w_mode == 'Office':
                unique_office_dates.add(s_date)
                total_office_seconds += dur
            else:
                unique_remote_dates.add(s_date)
                total_remote_seconds += dur

            h = dur // 3600
            m = (dur % 3600) // 60
            dur_fmt = f"{h}h {m}m" if h > 0 else f"{m}m {dur%60}s"

            child_tasks = tasks_by_session.get(s_id, [])

            sess_obj = {
                'id': s_id,
                'date': s_date,
                'work_mode': w_mode,
                'start_time': st,
                'stop_time': sp,
                'duration_seconds': dur,
                'duration_formatted': dur_fmt,
                'break_reason': reason or 'End of Workday',
                'notes': notes or '',
                'status': status,
                'tasks': child_tasks
            }
            all_sessions_list.append(sess_obj)

            if s_date not in days_map:
                try:
                    d_name = datetime.date.fromisoformat(s_date).strftime('%A')
                except Exception:
                    d_name = ''
                days_map[s_date] = {
                    'date': s_date,
                    'day_name': d_name,
                    'sessions': [],
                    'unlinked_tasks': [],
                    'office_seconds': 0,
                    'remote_seconds': 0,
                    'task_seconds': 0,
                    'tasks_count': 0
                }
            
            days_map[s_date]['sessions'].append(sess_obj)
            if w_mode == 'Office':
                days_map[s_date]['office_seconds'] += dur
            else:
                days_map[s_date]['remote_seconds'] += dur

        # Add unlinked tasks to days_map
        for t_date, un_tasks in tasks_by_date.items():
            if t_date not in days_map:
                try:
                    d_name = datetime.date.fromisoformat(t_date).strftime('%A')
                except Exception:
                    d_name = ''
                days_map[t_date] = {
                    'date': t_date,
                    'day_name': d_name,
                    'sessions': [],
                    'unlinked_tasks': [],
                    'office_seconds': 0,
                    'remote_seconds': 0,
                    'task_seconds': 0,
                    'tasks_count': 0
                }
            days_map[t_date]['unlinked_tasks'] = un_tasks

        # Compute per-day task totals
        daily_breakdown = []
        for d_key in sorted(days_map.keys(), reverse=True):
            d_entry = days_map[d_key]
            day_t_sec = 0
            day_t_count = 0
            for s in d_entry['sessions']:
                day_t_sec += sum([t['duration_seconds'] for t in s['tasks']])
                day_t_count += len(s['tasks'])
            for ut in d_entry['unlinked_tasks']:
                day_t_sec += ut['duration_seconds']
                day_t_count += 1
            d_entry['task_seconds'] = day_t_sec
            d_entry['tasks_count'] = day_t_count
            daily_breakdown.append(d_entry)

        tot_work_sec = total_office_seconds + total_remote_seconds

        def fmt_h_m(sec):
            h = sec // 3600
            m = (sec % 3600) // 60
            return f"{h}h {m}m"

        return self._send_json({
            'start_date': start_date,
            'end_date': end_date,
            'filters': {'mode': mode_filter, 'category': cat_filter, 'search': search_filter},
            'summary': {
                'total_office_days': len(unique_office_dates),
                'total_remote_days': len(unique_remote_dates),
                'total_office_seconds': total_office_seconds,
                'total_office_formatted': fmt_h_m(total_office_seconds),
                'total_remote_seconds': total_remote_seconds,
                'total_remote_formatted': fmt_h_m(total_remote_seconds),
                'total_work_seconds': tot_work_sec,
                'total_work_formatted': fmt_h_m(tot_work_sec),
                'total_task_seconds': total_task_seconds,
                'total_task_formatted': fmt_h_m(total_task_seconds),
                'tasks_count': len(all_matched_tasks),
                'sessions_count': len(session_rows)
            },
            'category_summary': category_summary,
            'daily_breakdown': daily_breakdown,
            'sessions': all_sessions_list
        })

    def handle_export_report(self, query_params):
        user = self._get_auth_user()
        if not user:
            return self._send_json({'message': 'Unauthorized'}, 401)

        user_id = user['sub']
        today_str = datetime.date.today().isoformat()
        thirty_days_ago = (datetime.date.today() - datetime.timedelta(days=30)).isoformat()

        start_date = query_params.get('start_date', [thirty_days_ago])[0]
        end_date = query_params.get('end_date', [today_str])[0]

        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute('SELECT name, email FROM users WHERE id = ?', (user_id,))
        u_info = cursor.fetchone()
        emp_name = u_info[0] if u_info else 'Employee'
        emp_email = u_info[1] if u_info else ''

        cursor.execute(
            '''SELECT id, date, work_mode, start_time, stop_time, duration_seconds, break_reason, status 
               FROM office_sessions WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date ASC, start_time ASC, id ASC''',
            (user_id, start_date, end_date)
        )
        session_rows = cursor.fetchall()

        cursor.execute(
            '''SELECT id, session_id, date, title, description, category, work_mode, start_time, stop_time, duration_seconds, status 
               FROM tasks WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date ASC, start_time ASC, id ASC''',
            (user_id, start_date, end_date)
        )
        task_rows = cursor.fetchall()
        conn.close()

        # Calculate KPIs without double counting
        office_dates = set([s[1] for s in session_rows if s[2] == 'Office'])
        remote_dates = set([s[1] for s in session_rows if s[2] == 'Remote'])
        office_sec = sum([s[5] or 0 for s in session_rows if s[2] == 'Office'])
        remote_sec = sum([s[5] or 0 for s in session_rows if s[2] == 'Remote'])
        task_sec = sum([t[9] or 0 for t in task_rows])

        sess_map = {s[0]: s for s in session_rows}

        csv_lines = []
        csv_lines.append(f'# ==============================================================================')
        csv_lines.append(f'# WORKPULSE EXECUTIVE SUMMARY REPORT')
        csv_lines.append(f'# Employee: "{emp_name}" <{emp_email}>')
        csv_lines.append(f'# Date Range: {start_date} to {end_date}')
        csv_lines.append(f'# Total Office Days: {len(office_dates)} Days | Total Office Hours: {office_sec // 3600}h {(office_sec % 3600)//60}m')
        csv_lines.append(f'# Total Remote Days: {len(remote_dates)} Days | Total Remote Hours: {remote_sec // 3600}h {(remote_sec % 3600)//60}m')
        csv_lines.append(f'# Total Work Time: {(office_sec + remote_sec) // 3600}h {((office_sec + remote_sec) % 3600)//60}m')
        csv_lines.append(f'# Total Tracked Task Time: {task_sec // 3600}h {(task_sec % 3600)//60}m ({len(task_rows)} Tasks)')
        csv_lines.append(f'# ==============================================================================\n')

        csv_lines.append(f'# SECTION 1: WORK SESSIONS LOG')
        csv_lines.append('Date,Day,Work Mode,Start Time,Stop Time,Duration Hours,Duration Minutes,Break Reason,Status')
        for s in session_rows:
            d_str = s[1]
            try:
                day_name = datetime.date.fromisoformat(d_str).strftime('%A')
            except Exception:
                day_name = ''
            st_fmt = s[3].split('T')[1][:5] if s[3] and 'T' in s[3] else (s[3][:5] if s[3] else '')
            sp_fmt = s[4].split('T')[1][:5] if s[4] and 'T' in s[4] else (s[4][:5] if s[4] else '')
            dur = s[5] or 0
            reason_str = s[6] if s[6] else 'End of Workday'
            status_str = s[7] or 'COMPLETED'
            csv_lines.append(f'"{d_str}","{day_name}","{s[2]}","{st_fmt}","{sp_fmt}",{round(dur/3600.0, 2)},{dur//60},"{reason_str}","{status_str}"')

        csv_lines.append(f'\n# SECTION 2: TASKS & ACTIVITIES (NESTED UNDER WORK SESSIONS)')
        csv_lines.append('Date,Work Mode,Session Time Range,Task / Activity Title,Category,Task Start,Task Stop,Task Duration (Mins),Task Duration Formatted,Status,Description / Audit Notes')
        for t in task_rows:
            d_str = t[2]
            parent_s = sess_map.get(t[1])
            if parent_s:
                st_p = parent_s[3].split('T')[1][:5] if parent_s[3] and 'T' in parent_s[3] else (parent_s[3][:5] if parent_s[3] else '')
                sp_p = parent_s[4].split('T')[1][:5] if parent_s[4] and 'T' in parent_s[4] else (parent_s[4][:5] if parent_s[4] else '')
                sess_range_str = f"{parent_s[2]} ({st_p} - {sp_p})"
                w_mode = parent_s[2]
            else:
                sess_range_str = t[6] or 'Office'
                w_mode = t[6] or 'Office'

            t_st = t[7].split('T')[1][:5] if t[7] and 'T' in t[7] else (t[7][:5] if t[7] else '')
            t_sp = t[8].split('T')[1][:5] if t[8] and 'T' in t[8] else (t[8][:5] if t[8] else '')
            t_dur = t[9] or 0
            t_dur_fmt = f"{t_dur//3600}h {(t_dur%3600)//60}m" if t_dur >= 3600 else f"{t_dur//60}m"
            clean_desc = (t[4] or '').replace('"', '""')
            clean_title = (t[3] or '').replace('"', '""')
            cat_str = t[5] if t[5] else 'Other'
            status_str = t[10] or 'COMPLETED'
            csv_lines.append(f'"{d_str}","{w_mode}","{sess_range_str}","{clean_title}","{cat_str}","{t_st}","{t_sp}",{t_dur//60},"{t_dur_fmt}","{status_str}","{clean_desc}"')

        csv_content = '\n'.join(csv_lines).encode('utf-8-sig')

        self.send_response(200)
        self.send_header('Content-Type', 'text/csv; charset=utf-8')
        self.send_header('Content-Disposition', f'attachment; filename="WorkPulse_Report_{start_date}_to_{end_date}.csv"')
        self.send_header('Content-Length', str(len(csv_content)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(csv_content)

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

        cursor.execute(
            '''SELECT date, title, category, duration_seconds FROM tasks WHERE user_id = ? AND date LIKE ?''',
            (user_id, f"{month}%")
        )
        t_rows = cursor.fetchall()
        total_task_seconds = sum([tr[3] or 0 for tr in t_rows])

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
            'total_task_hours': total_task_seconds // 3600,
            'total_task_minutes': (total_task_seconds % 3600) // 60,
            'tasks_count': len(t_rows),
            'sessions': sessions
        })

    def handle_send_monthly_email(self, payload):
        user = self._get_auth_user()
        if not user:
            return self._send_json({'message': 'Unauthorized'}, 401)

        month = payload.get('month', datetime.date.today().strftime('%Y-%m'))
        recipient_email = payload.get('recipient_email', '').strip()
        custom_notes = payload.get('custom_notes', '').strip()

        if not recipient_email:
            return self._send_json({'message': 'Recipient email address is required.'}, 400)

        user_id = user['sub']
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute('SELECT name, email FROM users WHERE id = ?', (user_id,))
        u_info = cursor.fetchone()
        emp_name = u_info[0] if u_info else 'Employee'
        emp_email = u_info[1] if u_info else ''

        cursor.execute(
            '''SELECT date, work_mode, start_time, stop_time, duration_seconds, break_reason 
               FROM office_sessions WHERE user_id = ? AND date LIKE ? ORDER BY date ASC, id ASC''',
            (user_id, f"{month}%")
        )
        session_rows = cursor.fetchall()
        conn.close()

        tot_sec = sum([r[4] or 0 for r in session_rows])
        tot_h, tot_m = tot_sec // 3600, (tot_sec % 3600) // 60
        office_days = len(set([r[0] for r in session_rows if r[1] == 'Office']))

        table_rows_html = ""
        for s in session_rows:
            dur_m = (s[4] or 0) // 60
            st_fmt = s[2].split('T')[1][:5] if s[2] and 'T' in s[2] else (s[2][:5] if s[2] else '--')
            sp_fmt = s[3].split('T')[1][:5] if s[3] and 'T' in s[3] else (s[3][:5] if s[3] else '--')
            table_rows_html += f"""
            <tr>
              <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">{s[0]}</td>
              <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">{s[1]}</td>
              <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">{st_fmt}</td>
              <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">{sp_fmt}</td>
              <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">{dur_m//60}h {dur_m%60}m</td>
              <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">{s[5] or '--'}</td>
            </tr>
            """

        html_content = f"""
        <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; color: #1e293b; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 24px; color: #ffffff;">
            <h2 style="margin: 0 0 6px 0;">Monthly Attendance & Work Report</h2>
            <p style="margin: 0; opacity: 0.9; font-size: 14px;">Employee: <strong>{emp_name}</strong> ({emp_email}) | Month: <strong>{month}</strong></p>
          </div>
          <div style="padding: 24px;">
            <div style="display: flex; gap: 16px; margin-bottom: 24px;">
              <div style="background: #f8fafc; padding: 12px 16px; border-radius: 8px; border: 1px solid #e2e8f0; flex: 1;">
                <div style="font-size: 12px; color: #64748b;">Office Days Logged</div>
                <div style="font-size: 20px; font-weight: bold; color: #10b981;">{office_days} Days</div>
              </div>
              <div style="background: #f8fafc; padding: 12px 16px; border-radius: 8px; border: 1px solid #e2e8f0; flex: 1;">
                <div style="font-size: 12px; color: #64748b;">Total Working Hours</div>
                <div style="font-size: 20px; font-weight: bold; color: #6366f1;">{tot_h}h {tot_m}m</div>
              </div>
            </div>
            {f'<p style="background: #f1f5f9; padding: 12px; border-radius: 6px; font-size: 14px;"><strong>Note:</strong> {custom_notes}</p>' if custom_notes else ''}
            <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
              <thead>
                <tr style="background: #f8fafc; color: #475569;">
                  <th style="padding: 8px 12px; border-bottom: 2px solid #cbd5e1;">Date</th>
                  <th style="padding: 8px 12px; border-bottom: 2px solid #cbd5e1;">Mode</th>
                  <th style="padding: 8px 12px; border-bottom: 2px solid #cbd5e1;">Start</th>
                  <th style="padding: 8px 12px; border-bottom: 2px solid #cbd5e1;">Stop</th>
                  <th style="padding: 8px 12px; border-bottom: 2px solid #cbd5e1;">Duration</th>
                  <th style="padding: 8px 12px; border-bottom: 2px solid #cbd5e1;">Break Reason</th>
                </tr>
              </thead>
              <tbody>
                {table_rows_html if table_rows_html else '<tr><td colspan="6" style="padding: 16px; text-align: center; color: #94a3b8;">No sessions recorded for this month.</td></tr>'}
              </tbody>
            </table>
          </div>
          <div style="background: #f8fafc; padding: 12px 24px; font-size: 12px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0;">
            Generated by WorkPulse Office & Task Time Tracker &bull; 100% Free & Open System
          </div>
        </div>
        """

        try:
            msg = MIMEMultipart('alternative')
            msg['Subject'] = f"Monthly Office Attendance Report - {emp_name} ({month})"
            msg['From'] = SENDER_EMAIL
            msg['To'] = recipient_email
            msg.attach(MIMEText(html_content, 'html'))

            if SENDER_PASSWORD:
                server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
                server.starttls()
                server.login(SENDER_EMAIL, SENDER_PASSWORD)
                server.sendmail(SENDER_EMAIL, recipient_email, msg.as_string())
                server.quit()
                return self._send_json({'message': f"Monthly report email successfully sent to {recipient_email}!"})
            else:
                eml_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sample_monthly_report.eml')
                with open(eml_path, 'w', encoding='utf-8') as f:
                    f.write(msg.as_string())
                return self._send_json({
                    'message': f"Report generated and saved to 'sample_monthly_report.eml'. (Set SENDER_PASSWORD environment variable for live SMTP dispatch)."
                })
        except Exception as e:
            return self._send_json({'message': f"Failed to send email: {str(e)}"}, 500)

    def handle_admin_overview(self):
        user = self._get_auth_user()
        if not user or user.get('role') != 'ADMIN':
            return self._send_json({'message': 'Access Denied: Admin privileges required.'}, 403)

        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()

        cursor.execute('''
            SELECT u.id, u.name, u.email, u.role, u.raw_password, u.created_at,
                   COUNT(s.id) as session_count, COALESCE(SUM(s.duration_seconds), 0) as total_seconds,
                   u.target_office_days, u.target_office_hours
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
                'total_minutes': (tot_sec % 3600) // 60,
                'target_office_days': u[8] if u[8] is not None else 3,
                'target_office_hours': u[9] if u[9] is not None else 24.0
            })

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
            if s[10] in ('IN_OFFICE', 'WORKING_REMOTE'):
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
    httpd = ThreadingHTTPServer(server_address, RequestHandler)
    print("==================================================================")
    print(f"WORKPULSE OFFICE & TASK TRACKER BACKEND IS RUNNING AT:")
    print(f"-> http://localhost:{PORT}")
    print("==================================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")

if __name__ == '__main__':
    run()
