/**
 * Office Time Tracker - Node.js Express Backend
 * Alternative backend server running on Express, Better-SQLite3, and JSON Web Tokens.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'office_tracker_secret_key_2026_super_secure';

// ==============================================================================
// MIDDLEWARE CONFIGURATION
// ==============================================================================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==============================================================================
// DATABASE INITIALIZATION & MIGRATIONS (SQLite)
// ==============================================================================
const db = new Database(path.join(__dirname, 'database.db'));

// Create core tables if they do not exist
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'USER',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

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
  );
`);

// Migrations
try {
  const uCols = db.pragma('table_info(users)').map(c => c.name);
  if (!uCols.includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'USER';");

  const sCols = db.pragma('table_info(office_sessions)').map(c => c.name);
  if (!sCols.includes('break_reason')) db.exec('ALTER TABLE office_sessions ADD COLUMN break_reason TEXT;');
  if (!sCols.includes('notes')) db.exec('ALTER TABLE office_sessions ADD COLUMN notes TEXT;');
} catch (e) {
  console.log('Migration check complete.');
}

// Seed Admin: Deepak / Ananth
const adminHash = bcrypt.hashSync('Ananth', 10);
const existingAdmin = db.prepare("SELECT id FROM users WHERE LOWER(email) = 'deepak@office.com'").get();
if (existingAdmin) {
  db.prepare("UPDATE users SET password_hash = ?, role = 'ADMIN' WHERE id = ?").run(adminHash, existingAdmin.id);
} else {
  db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES ('Deepak', 'deepak@office.com', ?, 'ADMIN')").run(adminHash);
}

// Auto-Cutoff Helper: Automatically closes active sessions left open on past dates or past 23:59:59
function autoCutoffExpiredSessions() {
  /**
   * Scans database for sessions with status 'IN_OFFICE' and no stop_time.
   * If session date is past, caps stop_time to 23:59:59 of that date and updates status to 'AUTO_CUTOFF'.
   */
  try {
    const todayStr = new Date().toISOString().substring(0, 10);
    const activeSessions = db.prepare('SELECT id, date, start_time FROM office_sessions WHERE status = "IN_OFFICE" AND stop_time IS NULL').all();

    activeSessions.forEach(s => {
      const isPastDate = s.date < todayStr;
      let shouldCutoff = isPastDate;

      if (!shouldCutoff) {
        try {
          const sessionEndDt = new Date(`${s.date}T23:59:59`);
          if (new Date() > sessionEndDt) {
            shouldCutoff = true;
          }
        } catch (e) {}
      }

      if (shouldCutoff) {
        const cutoffStopTime = `${s.date}T23:59:59`;
        let durationSeconds = 0;
        try {
          const startDt = new Date(s.start_time);
          const stopDt = new Date(cutoffStopTime);
          durationSeconds = Math.max(0, Math.floor((stopDt - startDt) / 1000));
        } catch (e) {}

        db.prepare(`
          UPDATE office_sessions 
          SET stop_time = ?, duration_seconds = ?, break_reason = 'Auto Cutoff (Forgot to stop timer)', status = 'AUTO_CUTOFF'
          WHERE id = ?
        `).run(cutoffStopTime, durationSeconds, s.id);
      }
    });
  } catch (err) {
    console.error('[Auto Cutoff Error]', err);
  }
}

// Run auto-cutoff ticker every 60 seconds
setInterval(autoCutoffExpiredSessions, 60000);
autoCutoffExpiredSessions();

// JWT Authentication Middleware: Protects private API endpoints
function authenticateToken(req, res, next) {
  autoCutoffExpiredSessions();
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Unauthorized' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(401).json({ message: 'Invalid token' });
    req.user = user;
    next();
  });
}

// Routes
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'All fields are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail.endsWith('@sagitec.com')) {
    return res.status(400).json({ message: 'Registration is restricted to official @sagitec.com email addresses.' });
  }

  const hash = bcrypt.hashSync(password, 10);

  try {
    const stmt = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'USER')");
    const info = stmt.run(name, cleanEmail, hash);
    const user = { id: info.lastInsertRowid, name, email: cleanEmail, role: 'USER' };
    const token = jwt.sign({ sub: user.id, email: user.email, role: 'USER' }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ message: 'Registration successful!', token, user });
  } catch (err) {
    res.status(400).json({ message: 'Email already registered.' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email/Username and password required.' });

  const cleanIdentifier = email.trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(name) = ?').get(cleanIdentifier, cleanIdentifier);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ message: 'Invalid credentials.' });
  }

  const role = user.role || 'USER';
  const token = jwt.sign({ sub: user.id, email: user.email, role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    message: 'Logged in successfully!',
    token,
    user: { id: user.id, name: user.name, email: user.email, role }
  });
});

app.get('/api/admin/overview', authenticateToken, (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ message: 'Access Denied: Admin privileges required.' });

  const usersList = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.raw_password, u.created_at,
           COUNT(s.id) as session_count, COALESCE(SUM(s.duration_seconds), 0) as total_seconds
    FROM users u
    LEFT JOIN office_sessions s ON u.id = s.user_id
    GROUP BY u.id ORDER BY u.id ASC
  `).all().map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    password: u.raw_password || (u.role === 'ADMIN' ? 'Ananth' : '******'),
    created_at: u.created_at,
    session_count: u.session_count,
    total_hours: Math.floor((u.total_seconds || 0) / 3600),
    total_minutes: Math.floor(((u.total_seconds || 0) % 3600) / 60)
  }));


  const masterSessions = db.prepare(`
    SELECT s.id, u.name as employee_name, u.email as employee_email, s.date, s.work_mode,
           s.start_time, s.stop_time, s.duration_seconds, s.break_reason, s.notes, s.status
    FROM office_sessions s
    JOIN users u ON s.user_id = u.id
    ORDER BY s.id DESC LIMIT 100
  `).all();

  const activeInOfficeCount = masterSessions.filter(s => s.status === 'IN_OFFICE').length;
  const totalTeamSeconds = masterSessions.reduce((acc, s) => acc + (s.duration_seconds || 0), 0);

  res.json({
    stats: {
      total_users: usersList.length,
      active_in_office_today: activeInOfficeCount,
      team_total_hours: Math.floor(totalTeamSeconds / 3600)
    },
    users: usersList,
    master_sessions: masterSessions
  });
});

app.post('/api/sessions/edit', authenticateToken, (req, res) => {
  autoCutoffExpiredSessions();
  const userId = req.user.sub;
  const role = req.user.role;
  const { session_id, stop_time, break_reason, notes } = req.body;

  if (!session_id || !stop_time) {
    return res.status(400).json({ message: 'Session ID and Stop Time are required.' });
  }

  const session = db.prepare('SELECT * FROM office_sessions WHERE id = ?').get(session_id);
  if (!session) {
    return res.status(404).json({ message: 'Session not found.' });
  }

  if (session.user_id !== userId && role !== 'ADMIN') {
    return res.status(403).json({ message: 'Forbidden: Cannot edit another user\'s session.' });
  }

  let stopTimeIso = stop_time.trim();
  if (!stopTimeIso.includes('T')) {
    if (stopTimeIso.split(':').length === 2) stopTimeIso += ':00';
    stopTimeIso = `${session.date}T${stopTimeIso}`;
  }

  let durationSeconds = 0;
  try {
    const startDt = new Date(session.start_time);
    const stopDt = new Date(stopTimeIso);
    durationSeconds = Math.floor((stopDt - startDt) / 1000);
    if (durationSeconds < 0) {
      return res.status(400).json({ message: 'Stop time cannot be earlier than start time.' });
    }
  } catch (err) {
    return res.status(400).json({ message: 'Invalid stop time format.' });
  }

  const finalReason = (break_reason && break_reason.trim()) ? break_reason.trim() : session.break_reason;
  const finalNotes = (notes !== undefined) ? notes.trim() : session.notes;

  db.prepare(`
    UPDATE office_sessions 
    SET stop_time = ?, duration_seconds = ?, break_reason = ?, notes = ?, status = 'COMPLETED'
    WHERE id = ?
  `).run(stopTimeIso, durationSeconds, finalReason, finalNotes, session_id);

  res.json({
    message: 'Stop time updated successfully!',
    duration_seconds: durationSeconds
  });
});

app.post('/api/admin/reset-user-password', authenticateToken, (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ message: 'Access Denied: Admin privileges required.' });

  const { user_id, new_password } = req.body;
  if (!user_id || !new_password) return res.status(400).json({ message: 'User ID and new password required.' });

  const user = db.prepare('SELECT name, email FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ message: 'User not found.' });

  const hash = bcrypt.hashSync(new_password.trim(), 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user_id);

  res.json({ message: `Successfully reset password for employee '${user.name}' (${user.email})!` });
});


app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
