# 🏢 Office & Task Time Tracker (WorkPulse)

A fast, modern, and responsive web application designed for IT professionals and corporate coworkers to track office attendance, monitor live work sessions, record break reasons & session notes, manage weekly 3-day office targets, and generate monthly attendance reports.

---

## ✨ Key Features

* 🔐 **User Authentication System**:
  - Secure Registration & Login with PBKDF2 SHA-256 / bcrypt password encryption and JWT token authorization.
  - Domain validation restricting employee registration to official `@sagitec.com` accounts.
  - Password Reset capability for employees and dedicated Admin override functionality.

* 🏢 **Office Attendance & Session Tracking**:
  - Select any date and toggle between `🏢 Office Mode` and `🏠 Remote / WFH`.
  - **Live Session Timer**: Real-time ticking clock (`HH:MM:SS`) with active "IN OFFICE" status indicator.
  - Multi-session logging allows starting and stopping multiple work segments in a single day.

* 🥪 **Break Reason & Session Notes**:
  - Interactive Modal dialog presented upon stopping a timer segment.
  - Preset break choices: **Lunch Break**, **Tea/Coffee Break**, **Client Meeting**, **Personal Work**, **Going Outside Office**, **Work From Home**, **End of Workday**, and **Other** (custom input).
  - Optional session notes text box for logging ticket IDs or session details.

* 📊 **Dashboard & Weekly Compliance Target**:
  - Live summary of daily hours logged (`Xh Ym`).
  - Visual progress bar calculating compliance toward the weekly 3-days-in-office target requirement.
  - Detailed daily session tables with status badges, edit capabilities, and 15-day attendance history.

* 🛡️ **Admin Portal**:
  - Accessible via Admin credentials (`deepak@office.com`).
  - Master employee directory with plain-text password visibility toggle and direct password reset options.
  - Master team attendance log showing total hours across all employees.

* 🌙 **Automatic Session Cutoff**:
  - Built-in daemon ticker auto-closes forgotten active sessions at 23:59:59 of that date to maintain accurate metrics.

---

## 🛠️ Technology Stack & Architecture

- **Frontend**: HTML5, Vanilla JavaScript (ES6+ Fetch API, Async state management), Custom Glassmorphism CSS design system with Google Fonts (*Outfit* & *Inter*) and FontAwesome icons.
- **Backend Options**:
  - **Option A (Python)**: Zero-dependency Python 3 standard library REST API server (`app.py` using `http.server`, `sqlite3`, `hashlib`, `hmac`). **Requires no external pip packages!**
  - **Option B (Node.js)**: Express.js server (`server.js` using `better-sqlite3`, `jsonwebtoken`, `bcryptjs`, `cors`).
- **Database**: SQLite3 (`database.db`) auto-created and migrated on first launch.

---

## 📁 Project Structure

```text
Office Tracker/
├── app.py                      # Zero-dependency Python 3 Backend & Static Web Server
├── server.js                   # Node.js Express Backend alternative
├── package.json                # Node.js package configuration & dependencies
├── database.db                 # SQLite database (auto-generated on first run)
├── .gitignore                  # Git ignore patterns for SQLite DB, cache, and node_modules
├── view_db.py                  # CLI Database Inspector script
├── generate_sample_email.py    # Email report generator script
├── sample_monthly_report.eml    # Sample monthly report EML output
├── README.md                   # Project Configuration & Deployment Guide
└── public/
    ├── index.html              # Core Web Dashboard UI & Break Reason Modal
    ├── css/
    │   └── style.css           # Glassmorphism CSS & Responsive UI Styles
    └── js/
        ├── app.js              # Dashboard State Manager & Admin Panel Controller
        ├── auth.js             # User Auth, JWT storage & @sagitec.com validator
        └── timer.js            # Live Ticking Timer & Break Reason Modal Handler
```

---

## 🚀 Step-by-Step Configuration & Local Setup

### Prerequisites
- **Python 3.8+** (installed on most systems) OR **Node.js 16+** (if choosing Node setup).
- A web browser (Chrome, Edge, Firefox, Safari).

---

### Option 1: Running with Python (Recommended — 0 Setup / 0 Dependencies)

Since Python 3 is pre-installed on Windows/macOS/Linux:

1. Open your terminal in the project directory:
   ```powershell
   cd "c:\Users\deepakkumar.kc\OneDrive - Sagitec Solutions, LLC\D-DRIVE\PROJECT\Office Tracker"
   ```

2. Start the Python server:
   ```powershell
   python app.py
   ```

3. Open your browser and navigate to:
   ```text
   http://localhost:5000
   ```

---

### Option 2: Running with Node.js & Express

If you prefer using Node.js:

1. Open your terminal in the project directory:
   ```powershell
   cd "c:\Users\deepakkumar.kc\OneDrive - Sagitec Solutions, LLC\D-DRIVE\PROJECT\Office Tracker"
   ```

2. Install Node dependencies:
   ```powershell
   npm install
   ```

3. Start the server:
   ```powershell
   npm start
   ```

4. Open your browser at `http://localhost:5000`.

---

## 🔑 Credentials & Admin Access

### Default Admin Account (Pre-seeded):
- **Email / Username**: `deepak@office.com` (or `Deepak`)
- **Password**: `Ananth`
- **Role**: `ADMIN`

*Admins can inspect employee accounts, view plain passwords, reset employee passwords, and audit team-wide attendance.*

### Regular Employee Account:
- Click **Register** on the login screen.
- Use any `@sagitec.com` email address (e.g. `yourname@sagitec.com`).

---

## 🔌 REST API Reference

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Register employee account (`@sagitec.com`) | No |
| `POST` | `/api/auth/login` | Authenticate user & get JWT token | No |
| `POST` | `/api/auth/reset-password` | Reset user password | No |
| `GET` | `/api/dashboard?date=YYYY-MM-DD` | Fetch daily sessions, status & weekly compliance | Yes (Bearer) |
| `POST` | `/api/sessions/start` | Start an IN_OFFICE timer session | Yes (Bearer) |
| `POST` | `/api/sessions/stop` | Stop active session, save reason & notes | Yes (Bearer) |
| `POST` | `/api/sessions/edit` | Edit session stop time, reason, or notes | Yes (Bearer) |
| `GET` | `/api/reports/monthly?month=YYYY-MM` | Fetch monthly breakdown & attendance stats | Yes (Bearer) |
| `GET` | `/api/admin/overview` | Admin view of all users & team sessions | Admin Only |
| `POST` | `/api/admin/reset-user-password` | Admin override for employee password reset | Admin Only |

---

## 📤 How to Push Code to GitHub

Your local directory is initialized with Git, branch configured to `main`, and `.gitignore` set up to exclude SQLite database files.

### 1. Create Repository on GitHub
Go to [github.com/new](https://github.com/new) and create a repository (e.g. `workpulse` or `office-time-tracker`). Do **not** initialize with a README or .gitignore.

### 2. Connect Remote Repository
In terminal, run:
```powershell
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME.git
```

### 3. Push your Code
```powershell
git push -u origin main
```

---

## 📄 License
This project is licensed under the **MIT License**.
