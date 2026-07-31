# 🏢 Office Time Tracker Application

A modern, fast, and responsive web application designed for IT professionals and corporate coworkers to record office attendance, start/stop multiple working sessions each day, track daily total hours, log break reasons & notes, and monitor weekly 3-day office attendance target goals.

---

## ✨ Features

* 🔐 **Authentication System**: Secure user Registration & Login with PBKDF2 password encryption and JWT authentication tokens.
* 🏢 **Office Attendance Tracking**: Select date and switch between `🏢 Office Mode` and `🏠 Remote / WFH`.
* ⏱️ **Live Session Timer**: Real-time ticking clock (`HH:MM:SS`) with glowing "IN OFFICE" status indicator.
* 🥪 **Break Reason & Notes**:
  - Modal prompt when stopping a timer to record the reason for stopping.
  - Presets: **Lunch Break**, **Tea/Coffee Break**, **Client Meeting**, **Personal Work**, **Going Outside Office**, **Work From Home**, **End of Workday**, **Other** (custom input).
  - Optional session notes / comments text box.
* 📊 **Multi-Session Reports & History**:
  - Store and calculate each individual session duration.
  - Calculate total office hours spent each day.
  - Color-coded reason badges and notes snippets in today's sessions table and attendance history log.
* 🎯 **Weekly 3-Day Target Compliance**: Visual progress bar tracking compliance towards the 3-days-a-week office requirement.

---

## 🛠️ Technology Stack

* **Frontend**: HTML5, CSS3 Custom Glassmorphism Design System (Google Fonts *Outfit* & *Inter*, dark/light gradients, micro-animations, modal dialogs), Vanilla JavaScript (ES6+ Fetch API, Async state management).
* **Backend**: Python 3 standard library REST API (`http.server` + `sqlite3` + `hashlib`) - **Requires ZERO external pip packages!** Also includes a Node.js `server.js` + `package.json` option.
* **Database**: SQLite3 (`database.db`) automatically initialized with schema migration support.

---

## 📁 Project Structure

```text
Office Tracker/
├── app.py                  # Zero-dependency Python 3 Backend & Static File Server
├── server.js               # Node.js Express Backend (Alternative Node setup)
├── package.json            # Node.js configuration & dependencies
├── database.db             # Auto-generated SQLite Database (created on first run)
├── README.md               # Complete Setup, Tech QA & Deployment Guide
└── public/
    ├── index.html          # Main Web Dashboard UI & Break Reason Modal
    ├── css/
    │   └── style.css       # Custom Glassmorphism CSS & Modal System
    └── js/
        ├── app.js          # Core App State Manager & UI Renderer
        ├── auth.js         # Authentication & JWT Token Controller
        └── timer.js        # Real-time Ticking Timer & Break Modal Controller
```

---

## 🚀 Local Setup Instructions

### Option A: Using Python (Recommended - 100% Zero Dependencies!)

Since Python 3 is already installed on your system, you can start the application with a single command without installing any packages:

1. Open your terminal in the project directory:
   ```bash
   cd "c:\Users\deepakkumar.kc\OneDrive - Sagitec Solutions, LLC\D-DRIVE\PROJECT\Office Tracker"
   ```
2. Run the application:
   ```bash
   python app.py
   ```
3. Open your browser and navigate to:
   ```text
   http://localhost:5000
   ```

---

### Option B: Using Node.js

If you prefer Node.js in the future:
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the Node.js server:
   ```bash
   npm start
   ```
3. Access at `http://localhost:5000`.

---

## 🗄️ Database Setup & Schema

The database is powered by **SQLite** (`database.db`). Columns for `break_reason` and `notes` are created automatically.

### Database Tables:

1. **`users` Table**
   - `id`: INTEGER PRIMARY KEY
   - `name`: TEXT (Employee full name)
   - `email`: TEXT (Unique employee login email)
   - `password_hash`: TEXT (PBKDF2 SHA-256 encrypted password)
   - `salt`: TEXT (Random cryptographic salt)
   - `created_at`: DATETIME

2. **`office_sessions` Table**
   - `id`: INTEGER PRIMARY KEY
   - `user_id`: INTEGER (FK to users)
   - `date`: TEXT (`YYYY-MM-DD`)
   - `work_mode`: TEXT (`Office` or `Remote`)
   - `start_time`: TEXT (ISO Timestamp)
   - `stop_time`: TEXT (ISO Timestamp)
   - `duration_seconds`: INTEGER
   - `break_reason`: TEXT (Preset or custom break reason)
   - `notes`: TEXT (User comments)
   - `status`: TEXT (`IN_OFFICE` or `COMPLETED`)

---

## 🌐 Complete Cloud Deployment Guide (Free)

1. **Push to GitHub**: Create a repository named `office-time-tracker` and upload project files.
2. **Backend API (Render.com)**: Create a Web Service connected to your repository with command `python app.py`.
3. **Frontend (Vercel)**: Import your repository to Vercel and deploy.
4. **Browser Access**: Share your Vercel URL (e.g. `https://office-time-tracker.vercel.app`) with coworkers.
