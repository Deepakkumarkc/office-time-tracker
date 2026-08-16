#!/usr/bin/env python3
"""
Database Viewer Utility for WorkPulse Office & Task Time Tracker
Run this script anytime to inspect users, office session records, and task entries in SQLite.
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

    print("==========================================================================================")
    print(" USERS TABLE (`users`) & CONFIGURED WEEKLY REQUIREMENTS")
    print("==========================================================================================")

    cursor.execute("SELECT id, name, email, role, target_office_days, target_office_hours, preferred_days, created_at FROM users")
    users = cursor.fetchall()
    if not users:
        print("No users registered yet.")
    else:
        print(f"{'ID':<4} | {'Name':<15} | {'Email':<28} | {'Role':<6} | {'Target Days':<11} | {'Target Hours':<12} | {'Preferred Days'}")
        print("-" * 105)
        for u in users:
            print(f"{u[0]:<4} | {u[1]:<15} | {u[2]:<28} | {u[3]:<6} | {u[4] or 3:<11} | {u[5] or 24.0:<12} | {u[6] or 'Mon-Fri'}")

    print("\n" + "=" * 115)
    print(" OFFICE SESSIONS TABLE (`office_sessions`) - ATTENDANCE SOURCE OF TRUTH")
    print("==========================================================================================")

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

    print("\n" + "=" * 115)
    print(" WORK TASKS TABLE (`tasks`) - DETAILED WORK ACTIVITIES INSIDE OFFICE TIME")
    print("==========================================================================================")

    cursor.execute("""
        SELECT t.id, u.name, t.date, t.title, t.category, t.start_time, t.stop_time, 
               t.duration_seconds, t.status 
        FROM tasks t
        LEFT JOIN users u ON t.user_id = u.id
        ORDER BY t.id DESC
    """)
    tasks = cursor.fetchall()
    if not tasks:
        print("No tasks recorded yet.")
    else:
        print(f"{'ID':<4} | {'Employee':<15} | {'Date':<10} | {'Category':<14} | {'Task Title':<28} | {'Start':<9} | {'Stop':<9} | {'Duration':<10} | {'Status'}")
        print("-" * 115)
        for t in tasks:
            emp_name = t[1] or f"User {t[0]}"
            start_fmt = t[5].split('T')[1][:5] if t[5] and 'T' in t[5] else (t[5][:5] if t[5] else '--')
            stop_fmt = t[6].split('T')[1][:5] if t[6] and 'T' in t[6] else (t[6][:5] if t[6] else 'Running')
            
            dur_sec = t[7] or 0
            h, m = dur_sec // 3600, (dur_sec % 3600) // 60
            dur_str = f"{h}h {m}m" if h > 0 else f"{m}m {dur_sec%60}s"

            print(f"{t[0]:<4} | {emp_name:<15} | {t[2]:<10} | {t[4] or 'Other':<14} | {t[3][:26]:<28} | {start_fmt:<9} | {stop_fmt:<9} | {dur_str:<10} | {t[8]}")

    conn.close()
    print("==========================================================================================")

if __name__ == '__main__':
    view_database()
