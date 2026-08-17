# WorkPulse (Office Time & Task Tracker) — Comprehensive AI Context & System Architecture

> **NOTE FOR FUTURE AI AGENTS**:
> **Read this entire document before answering questions or making code changes.**
> This file is the single source of truth for the WorkPulse codebase. It details the architecture, database schema, business rules, API endpoints, frontend routing, security standards, and deployment workflow.

---

## 1. Executive Summary & Tech Stack

WorkPulse is a full-stack, enterprise-grade attendance, remote work (WFH), and granular task/activity tracking system.

| Layer | Technology | Key Constraints |
| :--- | :--- | :--- |
| **Backend Runtime** | Python 3 (Standard Library) | **Zero external dependencies** (no Flask, Django, or FastAPI). Uses `http.server.ThreadingHTTPServer` and `BaseHTTPRequestHandler`. |
| **Database** | SQLite3 (`office_tracker.db`) | Single file DB with automated migrations, indexing, and PRAGMA checks on startup (`init_db()`). |
| **Authentication** | Custom HMAC-SHA256 JWT | Tokens signed with `JWT_SECRET` (from `os.environ` or fallback), 7-day expiration. Stored in client `localStorage` under `office_tracker_token` & `office_tracker_user`. |
| **Frontend** | Vanilla HTML5, CSS3, JavaScript (ES6+) | No frontend build tool or framework. Modern dark glassmorphism design system using Google Fonts (Inter & Outfit) and FontAwesome icons. |
| **Deployment** | Render (Web Service) | Repo: `https://github.com/Deepakkumarkc/office-time-tracker.git`<br>Live URL: `https://workpulse-tracker.onrender.com`<br>Command: `python app.py` (binds to `os.environ.get('PORT', 5000)`). |

---

## 2. Directory Structure & File Map

```
office-time-tracker/
├── app.py                      # Main backend server (HTTP handler, DB migrations, JWT, API routes)
├── PROJECT_CONTEXT.md          # THIS FILE: Single source of truth for all AI agents & developers
├── RENDER_DEPLOYMENT_GUIDE.md  # Step-by-step deployment and environment guide for Render
├── office_tracker.db           # Local SQLite database file (auto-created on startup)
└── public/                     # Static frontend directory served by app.py
    ├── index.html              # Main user workspace (Command center, live timers, secondary tabs)
    ├── admin.html              # Dedicated Enterprise Admin Portal (Sidebar, dashboard, directory, drawer, logs)
    ├── css/
    │   ├── style.css           # User workspace CSS (Glassmorphism design system, responsive split-screen)
    │   └── admin.css           # Admin portal CSS (Sidebar shell, KPI tiles, tree inspector, drawers, modals)
    └── js/
        ├── auth.js             # Authentication controller (Login, Register, Password Reset, Auth Guard)
        ├── timer.js            # Office & Remote live session timers (Start, Stop, Modal reasons, Auto-sync)
        ├── tasks.js            # Activity & Task tracking (Start, Stop, Manual Add, Edit, Delete, Quick chips)
        ├── app.js              # User workspace controller (Dashboard data, weekly strip, date-range reports)
        └── admin.js            # Admin portal controller (Stats, paginated users, slide drawer, audit logs)
```

---

## 3. Database Schema (`office_tracker.db`)

### `users` Table
```sql
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'USER',           -- 'USER' or 'ADMIN'
    raw_password TEXT,                          -- Legacy only; never stored/exposed in new registrations
    target_office_days INTEGER DEFAULT 3,        -- Weekly required office days
    target_office_hours REAL DEFAULT 24.0,       -- Weekly required office hours
    preferred_days TEXT DEFAULT 'Mon,Tue,Wed,Thu,Fri',
    is_active INTEGER DEFAULT 1,                 -- 1 = Active, 0 = Deactivated
    must_change_password INTEGER DEFAULT 0,      -- 1 = Force change password on next login
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### `office_sessions` Table (Source of Truth for Presence)
```sql
CREATE TABLE IF NOT EXISTS office_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,                         -- ISO format: YYYY-MM-DD
    work_mode TEXT NOT NULL DEFAULT 'Office',   -- 'Office' or 'Remote'
    start_time TEXT NOT NULL,                   -- ISO timestamp: YYYY-MM-DDTHH:MM:SS
    stop_time TEXT,                             -- NULL if currently active
    duration_seconds INTEGER DEFAULT 0,
    break_reason TEXT,                          -- e.g. 'Lunch Break', 'Tea Break', 'Meeting', 'End of Day'
    notes TEXT,                                 -- Optional user notes
    status TEXT NOT NULL DEFAULT 'IN_OFFICE',   -- 'IN_OFFICE', 'WORKING_REMOTE', 'COMPLETED', 'AUTO_CUTOFF'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
);
```

### `tasks` Table (Granular Activities linked to Parent Session)
```sql
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    session_id INTEGER,                         -- FK to office_sessions (NULL for legacy or unlinked)
    date TEXT NOT NULL,                         -- ISO format: YYYY-MM-DD
    title TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'Other',              -- e.g. 'Development', 'Meeting', 'Code Review', 'Client Support'
    work_mode TEXT DEFAULT 'Office',            -- 'Office' or 'Remote'
    start_time TEXT NOT NULL,                   -- ISO timestamp
    stop_time TEXT,                             -- NULL if currently active
    duration_seconds INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'IN_PROGRESS', -- 'IN_PROGRESS', 'COMPLETED', 'AUTO_CUTOFF'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (session_id) REFERENCES office_sessions (id) ON DELETE SET NULL
);
```

### `admin_audit_log` Table (Immutable Governance Trail)
```sql
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL,
    admin_name TEXT NOT NULL,
    action TEXT NOT NULL,                       -- 'RESET_PASSWORD', 'USER_ACTIVATED', 'USER_DEACTIVATED', 'USER_UPDATED', 'USER_DATA_EXPORTED'
    target_user_id INTEGER,
    target_user_name TEXT,
    details TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 4. Core Business Rules & Architectural Logic

### A. Session & Presence Lifecycle
1. **Work Modes**: `Office` (on-premise) and `Remote` (WFH). A user can switch between modes throughout the day.
2. **Single Active Session Rule**: A user can have at most one active session (`stop_time IS NULL`) at any given moment.
3. **Automated Cutoff**: Background thread (`auto_cutoff_expired_sessions()`) runs every 60 seconds. Any session left running past midnight (11:59:59 PM) or spanning across past dates is automatically closed with status `AUTO_CUTOFF`. Any active child tasks are simultaneously stopped.
4. **Session Stop Modals**: When stopping an office session, users are prompted with preset reasons (`Lunch Break`, `Tea/Coffee Break`, `Meeting`, `Personal / Permission`, `Going Outside`, `WFH / Work From Home`, `End of Day`).

### B. Task & Activity Synchronization
1. **Parent-Child Link**: Active tasks automatically link to the user's active session (`session_id`).
2. **Ghost Task Cleanup**: If a session is stopped while a task is still active, the dashboard auto-closes orphan tasks so impossible time overlaps are prevented.
3. **Manual Entry**: Users can retroactively add tasks via the **Add Task Manually** modal with custom start/stop times and categories.

### C. Weekly Targets & Compliance
1. **Rolling Week Model**: Monday to Sunday based on the currently selected date.
2. **Compliance Metrics**:
   - **Office Days Attended**: Count of distinct calendar days in the week with at least one Office session.
   - **Office Hours**: Sum of Office session durations in the week.
   - **Dual Progress Bars**: Visual progress against configured user targets (default: 3 days / 24 hours).

### D. Authentication & Security Guardrails
1. **Open Email Format**: Registration is open to any valid email format (`@` and domain check). No forced domain restriction.
2. **Default Seeded Admin**:
   - **Name**: `Deepak`
   - **Email**: `deepak@office.com`
   - **Password**: `Ananth` (Role: `ADMIN`)
3. **Zero Plaintext Passwords**: Passwords are hashed using SHA-256 + 16-byte random salt. Passwords are never returned in any API response or UI table.
4. **Admin Protection**: All `/api/admin/*` endpoints verify JWT signatures and reject non-admin users with HTTP 403.

---

## 5. Complete API Endpoint Reference

### Authentication & User
* `POST /api/auth/register` — Create account (`name`, `email`, `password`). Returns JWT + user object.
* `POST /api/auth/login` — Authenticate by email/username + password. Returns JWT + user object (blocks deactivated users).
* `POST /api/auth/reset-password` — Self-service password reset (`email`, `new_password`).
* `GET /api/user/settings` — Get user profile & weekly targets.
* `POST /api/user/settings` — Update target office days, target hours, and preferred days.

### Dashboard & Operations
* `GET /api/dashboard?date=YYYY-MM-DD` — Full command center payload: active session, active task, today's sessions, today's tasks, weekly compliance map, and category breakdowns.
* `POST /api/sessions/start` — Start office or remote session (`work_mode`).
* `POST /api/sessions/stop` — Stop active session (`break_reason`, `notes`).
* `POST /api/sessions/edit` — Edit start/stop timestamps, duration, and notes for an existing session.

### Tasks & Activities
* `GET /api/tasks?date=YYYY-MM-DD` — List tasks for date.
* `POST /api/tasks/start` — Start live task (`title`, `category`, `description`).
* `POST /api/tasks/manual` — Manually log past or completed task (`title`, `category`, `date`, `start_time`, `stop_time`, `description`).
* `POST /api/tasks/stop` — Stop active task.
* `POST /api/tasks/edit` — Update task title, times, and category.
* `POST /api/tasks/delete` — Remove task record.
* `GET /api/tasks/categories` — List distinct task categories.

### Reporting & Multi-Section Exports
* `GET /api/reports/range?start_date=...&end_date=...` — Hierarchical date-range report (`daily_breakdown` $\rightarrow$ `sessions` $\rightarrow$ `tasks`).
* `GET /api/reports/export?start_date=...&end_date=...` — Structured multi-section CSV download (Executive summary, daily sessions, child tasks).
* `GET /api/reports/monthly?month=YYYY-MM` — Monthly aggregate summary.
* `POST /api/reports/send-email` — Send monthly report via SMTP (if configured).

### Enterprise Admin Portal
* `GET /api/admin/stats` — Organization KPI dashboard & live team presence grid.
* `GET /api/admin/users?page=1&per_page=25&search=...&status=...` — Searchable, filterable, paginated user list.
* `GET /api/admin/users/<id>` — Full user profile, target compliance, and today's activity.
* `GET /api/admin/users/<id>/report?start_date=...&end_date=...` — Hierarchical work & task history tree for a specific user.
* `POST /api/admin/users/<id>/reset-password` — Secure admin password reset (`new_password`), triggers mandatory change on next login.
* `POST /api/admin/users/<id>/status` — Activate or deactivate account (`action: 'activate' | 'deactivate'`).
* `POST /api/admin/users/<id>/update` — Update employee targets and profile details.
* `GET /api/admin/users/<id>/export` — Direct CSV export of employee attendance & tasks.
* `GET /api/admin/audit-log?page=1&per_page=50` — Paginated administrative audit trail.
* `GET /api/admin/categories` — Directory of all categories with organization-wide usage counts.

---

## 6. Frontend Architecture & Client Controllers

1. **`public/index.html` (User Workspace)**:
   - **Header**: Mode toggle (Office/Remote), date picker, Admin Portal link (if Admin), user avatar, and logout.
   - **Split Screen**: Left panel houses live session & task timers with stop reason buttons; right panel houses 7-day weekly compliance strip with dual progress bars.
   - **Secondary Tabs**: Detailed Tasks table, Office/Work Sessions table, Date-Range Explorer (hierarchical Day $\rightarrow$ Session $\rightarrow$ Task tree), and Monthly Export tab.

2. **`public/admin.html` (Dedicated Admin Portal)**:
   - **Sidebar Shell**: Collapsible sidebar with navigation to Dashboard, Users, History, Categories, Audit Log, and Reports.
   - **Views**:
     - *Dashboard*: KPI tiles (Total users, In-Office today, Remote today, Offline today, Office hours, Tasks completed) + Live Team Presence Grid.
     - *User Management*: Searchable, filterable, paginated user table with row actions.
     - *Work History*: User dropdown + date presets $\rightarrow$ Hierarchical Day $\rightarrow$ Session $\rightarrow$ Task collapsible tree with CSV export.
     - *Categories*: Grid showing all registered categories with usage counters.
     - *Audit Log*: Formatted list of all admin actions with icons, details, and timestamps.
     - *Reports*: Direct CSV export tools.
   - **Slide-in Drawer**: Opens detailed user profile, weekly compliance bars, today's session timeline, and live activity without leaving the page.
   - **Modals**: Secure password reset dialog, user target editor dialog.

---

## 7. Guidelines for AI Agents Working on this Project

1. **DO NOT introduce external Python dependencies**: Maintain standard library compatibility (`http.server`, `sqlite3`, `json`, `hashlib`, `hmac`).
2. **DO NOT expose passwords**: Never store or return plaintext passwords in API responses or frontend tables.
3. **Maintain Parent-Child Synchronicity**: When modifying sessions or tasks, always preserve the logical relationship (`session_id` link, time containment, ghost task cleanup).
4. **Deploying Updates**: When making code changes, always verify them locally, stage with `git add .`, commit with a descriptive message, and push with `git push origin main` so Render can automatically re-deploy.
5. **Keep User and Admin Portals Separate**: User interface is in `public/index.html` (`app.js`), Admin interface is in `public/admin.html` (`admin.js`).
