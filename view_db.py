#!/usr/bin/env python3
"""
Database Viewer Utility for Office Time Tracker
Run this script anytime to inspect users and office session records in SQLite.
"""

import os
import sqlite3

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'database.db')

def view_database():
    try:
        import sys
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

    if not os.path.exists(DB_FILE):
        print(f"Database file not found at: {DB_FILE}")
        print("Run `python app.py` first to initialize the database.")
        return

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    print("==================================================================")
    print(" USERS TABLE (`users`)")
    print("==================================================================")

    cursor.execute("SELECT id, name, email, created_at FROM users")
    users = cursor.fetchall()
    if not users:
        print("No users registered yet.")
    else:
        print(f"{'ID':<4} | {'Name':<20} | {'Email':<30} | {'Registered At'}")
        print("-" * 75)
        for u in users:
            print(f"{u[0]:<4} | {u[1]:<20} | {u[2]:<30} | {u[3]}")

    print("\n" + "=" * 90)
    print(" OFFICE SESSIONS TABLE (`office_sessions`)")
    print("==================================================================")

    cursor.execute("""
        SELECT s.id, u.name, s.date, s.work_mode, s.start_time, s.stop_time, 
               s.duration_seconds, s.break_reason, s.notes, s.status 
        FROM office_sessions s
        LEFT JOIN users u ON s.user_id = u.id
        ORDER BY s.id DESC
    """)
    sessions = cursor.fetchall()
    if not sessions:
        print("No office sessions recorded yet.")
    else:
        print(f"{'ID':<4} | {'Employee':<15} | {'Date':<10} | {'Mode':<8} | {'Start Time':<12} | {'Stop Time':<12} | {'Duration':<10} | {'Reason':<18} | {'Status'}")
        print("-" * 115)
        for s in sessions:
            emp_name = s[1] or f"User {s[0]}"
            start_fmt = s[4].split('T')[1][:8] if s[4] and 'T' in s[4] else (s[4][:8] if s[4] else '--')
            stop_fmt = s[5].split('T')[1][:8] if s[5] and 'T' in s[5] else (s[5][:8] if s[5] else 'In Office')
            
            dur_sec = s[6] or 0
            h, m = dur_sec // 3600, (dur_sec % 3600) // 60
            dur_str = f"{h}h {m}m" if h > 0 else f"{m}m {dur_sec%60}s"
            
            reason = s[7] or '--'
            status = s[9]

            print(f"{s[0]:<4} | {emp_name:<15} | {s[2]:<10} | {s[3]:<8} | {start_fmt:<12} | {stop_fmt:<12} | {dur_str:<10} | {reason:<18} | {status}")

    conn.close()
    print("==================================================================")

if __name__ == '__main__':
    view_database()
