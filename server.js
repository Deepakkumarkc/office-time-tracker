/**
 * WorkPulse - Node.js Express Backend
 * Identical API routes and database schema for JavaScript runtime.
 */

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 5000;
const DB_FILE = path.join(__dirname, 'database.db');
const JWT_SECRET = 'office_tracker_secret_key_2026_super_secure';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) console.error('Failed to open database:', err);
  else console.log(`Connected to SQLite database at ${DB_FILE}`);
});

// Database initialization
db.serialize(() => {
  db.run(`
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
  `);

  db.run(`
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
  `);

  db.run(`
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
  `);
});

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Authorization token required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Token is invalid or expired' });
    req.user = user;
    next();
  });
}

// User settings
app.get('/api/user/settings', authenticateToken, (req, res) => {
  db.get('SELECT name, email, role, target_office_days, target_office_hours, preferred_days FROM users WHERE id = ?', [req.user.sub], (err, row) => {
    if (err || !row) return res.status(404).json({ message: 'User not found' });
    res.json(row);
  });
});

app.post('/api/user/settings', authenticateToken, (req, res) => {
  const { target_office_days = 3, target_office_hours = 24.0, preferred_days = 'Mon,Tue,Wed,Thu,Fri' } = req.body;
  db.run(
    'UPDATE users SET target_office_days = ?, target_office_hours = ?, preferred_days = ? WHERE id = ?',
    [target_office_days, target_office_hours, preferred_days, req.user.sub],
    function(err) {
      if (err) return res.status(500).json({ message: 'Failed to update settings' });
      res.json({ message: 'Settings saved successfully!' });
    }
  );
});

// Start session (Office or Remote)
app.post('/api/sessions/start', authenticateToken, (req, res) => {
  const { date = new Date().toISOString().substring(0, 10), work_mode = 'Office', start_time = new Date().toISOString() } = req.body;
  const statusFlag = work_mode === 'Office' ? 'IN_OFFICE' : 'WORKING_REMOTE';

  db.get(
    'SELECT id, work_mode FROM office_sessions WHERE user_id = ? AND status IN ("IN_OFFICE", "WORKING_REMOTE") AND stop_time IS NULL',
    [req.user.sub],
    (err, row) => {
      if (row) return res.status(400).json({ message: `An active ${row.work_mode} session is already running.` });

      db.run(
        'INSERT INTO office_sessions (user_id, date, work_mode, start_time, status) VALUES (?, ?, ?, ?, ?)',
        [req.user.sub, date, work_mode, start_time, statusFlag],
        function(err) {
          if (err) return res.status(500).json({ message: 'Failed to start session' });
          res.status(201).json({ message: `${work_mode} session started!`, session_id: this.lastID });
        }
      );
    }
  );
});

// Stop session (Auto-stops active task)
app.post('/api/sessions/stop', authenticateToken, (req, res) => {
  const { stop_time = new Date().toISOString(), break_reason = 'End of Workday', notes = '' } = req.body;

  db.get(
    'SELECT id, start_time, work_mode FROM office_sessions WHERE user_id = ? AND status IN ("IN_OFFICE", "WORKING_REMOTE") AND stop_time IS NULL ORDER BY id DESC LIMIT 1',
    [req.user.sub],
    (err, session) => {
      if (!session) return res.status(400).json({ message: 'No active session found.' });

      const startMs = new Date(session.start_time).getTime();
      const stopMs = new Date(stop_time).getTime();
      const durationSeconds = Math.max(0, Math.floor((stopMs - startMs) / 1000));

      db.run(
        'UPDATE office_sessions SET stop_time = ?, duration_seconds = ?, break_reason = ?, notes = ?, status = "COMPLETED" WHERE id = ?',
        [stop_time, durationSeconds, break_reason, notes, session.id],
        function() {
          // Auto-stop active task
          db.get(
            'SELECT id, title, start_time FROM tasks WHERE user_id = ? AND status = "IN_PROGRESS" AND stop_time IS NULL',
            [req.user.sub],
            (err, task) => {
              let autoStopped = null;
              if (task) {
                const tStartMs = new Date(task.start_time).getTime();
                const tDur = Math.max(0, Math.floor((stopMs - tStartMs) / 1000));
                db.run(
                  'UPDATE tasks SET stop_time = ?, duration_seconds = ?, description = COALESCE(description, "") || " (Auto-stopped with session end)", status = "COMPLETED" WHERE id = ?',
                  [stop_time, tDur, task.id]
                );
                autoStopped = { id: task.id, title: task.title, duration_seconds: tDur };
              }

              res.json({
                message: `${session.work_mode} session stopped.`,
                duration_seconds: durationSeconds,
                auto_stopped_task: autoStopped
              });
            }
          );
        }
      );
    }
  );
});

// Start task (Strict Active Session requirement & Auto-Switch)
app.post('/api/tasks/start', authenticateToken, (req, res) => {
  const { title, category = 'Other', description = '', date = new Date().toISOString().substring(0, 10), start_time = new Date().toISOString(), switch_task = false } = req.body;
  if (!title) return res.status(400).json({ message: 'Task title is required.' });

  db.get(
    'SELECT id, work_mode FROM office_sessions WHERE user_id = ? AND date = ? AND status IN ("IN_OFFICE", "WORKING_REMOTE") AND stop_time IS NULL ORDER BY id DESC LIMIT 1',
    [req.user.sub, date],
    (err, activeSess) => {
      if (!activeSess) {
        return res.status(400).json({ message: 'Start your office session (or remote work session) before starting a task.', requires_session: true });
      }

      db.get(
        'SELECT id, title, start_time FROM tasks WHERE user_id = ? AND status = "IN_PROGRESS" AND stop_time IS NULL',
        [req.user.sub],
        (err, runningTask) => {
          if (runningTask && !switch_task) {
            return res.status(400).json({ message: `You are currently working on '${runningTask.title}'.`, running_task: runningTask, can_switch: true });
          }

          if (runningTask && switch_task) {
            const prevMs = new Date(runningTask.start_time).getTime();
            const nowMs = new Date(start_time).getTime();
            const prevDur = Math.max(0, Math.floor((nowMs - prevMs) / 1000));
            db.run('UPDATE tasks SET stop_time = ?, duration_seconds = ?, status = "COMPLETED" WHERE id = ?', [start_time, prevDur, runningTask.id]);
          }

          db.run(
            'INSERT INTO tasks (user_id, session_id, date, title, description, category, work_mode, start_time, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, "IN_PROGRESS")',
            [req.user.sub, activeSess.id, date, title, description, category, activeSess.work_mode, start_time],
            function(err) {
              if (err) return res.status(500).json({ message: 'Failed to start task' });
              res.status(201).json({ message: `Task '${title}' started!`, task: { id: this.lastID, title, category } });
            }
          );
        }
      );
    }
  );
});

// Dashboard endpoint (7-Day Weekly Attendance Map & Dual Compliance)
app.get('/api/dashboard', authenticateToken, (req, res) => {
  const selectedDate = req.query.date || new Date().toISOString().substring(0, 10);
  const userId = req.user.sub;

  db.get('SELECT name, email, target_office_days, target_office_hours, preferred_days FROM users WHERE id = ?', [userId], (err, user) => {
    if (err || !user) return res.status(404).json({ message: 'User not found' });

    const targetDays = user.target_office_days || 3;
    const targetHours = user.target_office_hours || 24.0;
    const preferredDays = user.preferred_days || 'Mon,Tue,Wed,Thu,Fri';
    const prefSet = new Set(preferredDays.split(',').map(p => p.trim().substring(0, 3).toUpperCase()));

    db.all('SELECT * FROM office_sessions WHERE user_id = ? AND date = ? ORDER BY start_time ASC', [userId, selectedDate], (err, todaySessions) => {
      db.all('SELECT * FROM tasks WHERE user_id = ? AND date = ? ORDER BY start_time ASC', [userId, selectedDate], (err, todayTasks) => {
        
        // Compute active state
        const activeSess = (todaySessions || []).find(s => ['IN_OFFICE', 'WORKING_REMOTE'].includes(s.status) && !s.stop_time);
        const activeTask = (todayTasks || []).find(t => t.status === 'IN_PROGRESS' && !t.stop_time);
        const currentStatus = activeSess ? activeSess.status : 'OUT_OF_OFFICE';

        let todayOfficeSec = 0;
        let todayRemoteSec = 0;
        (todaySessions || []).forEach(s => {
          if (s.work_mode === 'Office') todayOfficeSec += (s.duration_seconds || 0);
          else todayRemoteSec += (s.duration_seconds || 0);
        });

        let todayTaskSec = 0;
        const categoryBreakdown = {};
        (todayTasks || []).forEach(t => {
          const dur = t.duration_seconds || 0;
          todayTaskSec += dur;
          const cat = t.category || 'Other';
          categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + dur;
        });

        // 7-Day Monday -> Sunday calculation
        const selDt = new Date(selectedDate);
        const dayOfWeek = (selDt.getDay() + 6) % 7; // 0 = Monday, 6 = Sunday
        const mondayDt = new Date(selDt);
        mondayDt.setDate(selDt.getDate() - dayOfWeek);

        const dayNamesList = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const startOfWeek = mondayDt.toISOString().substring(0, 10);
        const sundayDt = new Date(mondayDt);
        sundayDt.setDate(mondayDt.getDate() + 6);
        const endOfWeek = sundayDt.toISOString().substring(0, 10);

        db.all(
          'SELECT date, duration_seconds FROM office_sessions WHERE user_id = ? AND work_mode = "Office" AND date >= ? AND date <= ?',
          [userId, startOfWeek, endOfWeek],
          (err, weekOfficeSessions) => {
            const actualDatesSet = new Set();
            const daySecondsMap = {};

            (weekOfficeSessions || []).forEach(ws => {
              actualDatesSet.add(ws.date);
              daySecondsMap[ws.date] = (daySecondsMap[ws.date] || 0) + (ws.duration_seconds || 0);
            });

            const weeklyDaysMap = [];
            let totalWeeklySec = 0;
            const todayStr = new Date().toISOString().substring(0, 10);

            for (let i = 0; i < 7; i++) {
              const curDt = new Date(mondayDt);
              curDt.setDate(mondayDt.getDate() + i);
              const curDateStr = curDt.toISOString().substring(0, 10);
              const dName = dayNamesList[i];
              const dSec = daySecondsMap[curDateStr] || 0;
              const attended = actualDatesSet.has(curDateStr);

              totalWeeklySec += dSec;
              weeklyDaysMap.push({
                day_name: dName,
                date: curDateStr,
                day_num: curDt.getDate(),
                attended: attended,
                day_seconds: dSec,
                hours: parseFloat((dSec / 3600).toFixed(1)),
                is_preferred: prefSet.has(dName.toUpperCase()),
                is_today: curDateStr === todayStr,
                is_selected: curDateStr === selectedDate
              });
            }

            const weeklyOfficeDays = actualDatesSet.size;
            const weeklyOfficeHours = parseFloat((totalWeeklySec / 3600).toFixed(1));

            res.json({
              current_status: currentStatus,
              active_session: activeSess || null,
              active_task: activeTask || null,
              today_sessions: todaySessions || [],
              today_tasks: todayTasks || [],
              today_total_minutes: Math.floor((todayOfficeSec + todayRemoteSec) / 60),
              today_office_minutes: Math.floor(todayOfficeSec / 60),
              today_task_seconds: todayTaskSec,
              category_breakdown: categoryBreakdown,
              user_targets: { target_office_days: targetDays, target_office_hours: targetHours, preferred_days: preferredDays },
              weekly_compliance: {
                days_completed: weeklyOfficeDays,
                target_days: targetDays,
                days_remaining: Math.max(0, targetDays - weeklyOfficeDays),
                days_percent: Math.min(100, Math.round((weeklyOfficeDays / targetDays) * 100)),
                hours_completed: weeklyOfficeHours,
                target_hours: targetHours,
                hours_remaining: Math.max(0, parseFloat((targetHours - weeklyOfficeHours).toFixed(1))),
                hours_percent: Math.min(100, Math.round((weeklyOfficeHours / targetHours) * 100)),
                start_of_week: startOfWeek,
                end_of_week: endOfWeek,
                weekly_days_map: weeklyDaysMap
              }
            });
          }
        );
      });
    });
  });
});

app.listen(PORT, () => {
  console.log(`Node.js Express Server running on http://localhost:${PORT}`);
});
