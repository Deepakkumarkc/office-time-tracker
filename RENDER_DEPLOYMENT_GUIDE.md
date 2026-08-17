# 🚀 Complete Production Deployment Manual: Hosting WorkPulse on Render.com ($0 Free Tier)

This document provides a comprehensive, step-by-step guide to deploying the **WorkPulse Office & Task Time Tracker** application to **Render.com** at **zero cost ($0/month)**.

---

## 📌 Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Step 1 — Verify Local Cloud-Ready Files](#step-1--verify-local-cloud-ready-files)
4. [Step 2 — Push Code to GitHub](#step-2--push-code-to-github)
5. [Step 3 — Create Web Service on Render (Click-by-Click)](#step-3--create-web-service-on-render-click-by-click)
6. [Step 4 — Configure Environment Variables](#step-4--configure-environment-variables)
7. [Step 5 — Monitor Deployment & Verify Startup Logs](#step-5--monitor-deployment--verify-startup-logs)
8. [Step 6 — Test Live Application (Laptop & Mobile)](#step-6--test-live-application-laptop--mobile)
9. [Step 7 — Free-Tier SQLite Persistence & Backup Strategy](#step-7--free-tier-sqlite-persistence--backup-strategy)
10. [Step 8 — Optional Email SMTP Configuration](#step-8--optional-email-smtp-configuration)
11. [Troubleshooting & Common Questions (FAQ)](#troubleshooting--common-questions-faq)
12. [Future Scaling & PostgreSQL Migration](#future-scaling--postgresql-migration)

---

## 1. Architecture Overview

WorkPulse is built as a **self-contained monolithic web application**:
* **Backend**: Pure Python 3 standard library (`http.server.ThreadingHTTPServer` + `sqlite3`). No heavy pip dependencies required!
* **Frontend**: Vanilla HTML5, modern CSS3 design system (Glassmorphism), and modular ES6 JavaScript (`app.js`, `timer.js`, `tasks.js`, `auth.js`).
* **Database**: Embedded SQLite (`database.db`) with automatic table creation (`init_db()`) and admin seeding.
* **Unified Serving**: The Python backend serves both the `/api/...` REST endpoints and the static frontend assets (`public/`) simultaneously on a single port.

```
┌────────────────────────────────────────────────────────────┐
│                    RENDER CLOUD GATEWAY                    │
│                 (Free SSL / HTTPS / DDoS)                  │
└─────────────────────────────┬──────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│                  RENDER FREE WEB SERVICE                   │
│                    (Python 3 Runtime)                      │
│                                                            │
│  ┌───────────────────────┐      ┌───────────────────────┐  │
│  │   Frontend Server     │      │   REST API Backend    │  │
│  │   (public/ directory) │      │   (/api/... routes)   │  │
│  └──────────┬────────────┘      └───────────┬───────────┘  │
│             │                               │              │
│             └───────────────┬───────────────┘              │
│                             │                              │
│                             ▼                              │
│                 ┌───────────────────────┐                  │
│                 │ Embedded SQLite DB    │                  │
│                 │ (database.db)         │                  │
│                 └───────────────────────┘                  │
└────────────────────────────────────────────────────────────┘
```

---

## 2. Prerequisites

Before starting, ensure you have:
1. A **GitHub Account**: [https://github.com](https://github.com)
2. A **Render Account**: [https://render.com](https://render.com) (Sign up with GitHub for 1-click repository linking)
3. Git installed on your computer.

---

## Step 1 — Verify Local Cloud-Ready Files

The repository is already pre-configured with the required cloud deployment manifests:

### 1. `Procfile`
Instructs Render how to start the web process:
```text
web: python app.py
```

### 2. `requirements.txt`
Signals Render that this is a Python 3 service:
```text
# WorkPulse Office & Task Tracker
# Pure Python 3 standard library application - zero external pip dependencies required.
```

### 3. Dynamic Port in `app.py`
Ensures the server binds dynamically to Render's cloud port (`PORT` environment variable):
```python
PORT = int(os.environ.get('PORT', 5000))
DB_FILE = os.environ.get('DB_FILE', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'database.db'))
JWT_SECRET = os.environ.get('JWT_SECRET', 'office_tracker_secret_key_2026_super_secure')
```

### 4. `.gitignore`
Prevents local temporary files and sensitive credentials from being committed:
```gitignore
*.db
*.sqlite3
__pycache__/
.env
```

---

## Step 2 — Push Code to GitHub

Open PowerShell or Terminal in your project directory:

```powershell
# Navigate to project directory
cd y:\Deepak_Projects\office-time-tracker

# Check current branch and changes
git status

# Stage all files
git add .

# Commit changes
git commit -m "Add complete Render deployment configuration and documentation"

# Push to your GitHub repository
git push origin main
```

---

## Step 3 — Create Web Service on Render (Click-by-Click)

1. Log into your Render Dashboard at **[https://dashboard.render.com](https://dashboard.render.com)**.
2. In the top-right corner, click the blue **`New +`** button.
3. From the dropdown menu, select **`Web Service`**.
4. Under **"Connect a repository"**:
   * Search for `office-time-tracker`.
   * Click **`Connect`** next to your repository `Deepakkumarkc/office-time-tracker`.
5. Configure the service parameters on the creation form:

| Form Field | Exact Value to Enter | Notes / Rationale |
| :--- | :--- | :--- |
| **Name** | `workpulse-tracker` *(or any custom name)* | This defines your free URL: `https://<name>.onrender.com` |
| **Region** | **Singapore (Southeast Asia)** or **Frankfurt (EU)** | Pick whichever region is geographically closest to your users. |
| **Branch** | `main` | Production branch to deploy. |
| **Root Directory** | *(Leave blank)* | Uses root directory of repository. |
| **Runtime** | **Python 3** | Uses Render's native Python runtime. |
| **Build Command** | `pip install -r requirements.txt` | *(Runs instant dependency check)* |
| **Start Command** | `python app.py` | Launches the unified Python backend & static server. |
| **Instance Type** | **Free ($0/month)** | 512 MB RAM, 0.1 CPU, 750 free compute hours/month. |

---

## Step 4 — Configure Environment Variables

Scroll down to the **Environment Variables** section on the Render setup page. Click **`Add Environment Variable`** for each of the following:

| Key | Value | Purpose |
| :--- | :--- | :--- |
| `PYTHONUNBUFFERED` | `1` | Forces unbuffered live logs in the Render console. |
| `JWT_SECRET` | `workpulse_production_secret_2026_x89q` *(or your custom secure key)* | Cryptographic key used to sign and verify login JWT tokens. |
| `SMTP_HOST` | `smtp.office365.com` *(Optional)* | SMTP server hostname for email attendance statements. |
| `SMTP_PORT` | `587` *(Optional)* | SMTP port (STARTTLS). |
| `SENDER_EMAIL` | `deepakkumar.kc@sagitec.com` *(Optional)* | Outgoing email address for attendance reports. |
| `SENDER_PASSWORD` | `your_app_password_here` *(Optional)* | App-specific password for SMTP server. |

> [!NOTE]
> Render automatically injects the `PORT` variable (typically `10000`). You do **not** need to add `PORT` manually.

---

## Step 5 — Monitor Deployment & Verify Startup Logs

1. Click the blue **`Create Web Service`** button at the bottom of the page.
2. Render will automatically clone your GitHub repository, verify files, and launch your application.
3. In the Render deployment log stream, you will observe:
   ```text
   ==> Cloning from https://github.com/Deepakkumarkc/office-time-tracker...
   ==> Checking out commit ... in branch main
   ==> Running build command 'pip install -r requirements.txt'...
   ==> Generating container image from build...
   ==> Starting service with 'python app.py'...
   [Database] SQLite database initialized at: /opt/render/project/src/database.db
   ==================================================================
   WORKPULSE OFFICE & TASK TRACKER BACKEND IS RUNNING AT:
   -> http://localhost:10000
   ==================================================================
   ==> Your service is live 🎉
   ```
4. Once the status shows a green **`Live`** badge, your application is live on the internet!
5. Click on the URL generated at the top left of the Render dashboard (e.g. `https://workpulse-tracker.onrender.com`).

---

## Step 6 — Test Live Application (Laptop & Mobile)

Test your live URL across different devices:

### 1. Initial Login (Admin Credentials Pre-Seeded):
* **Admin Email**: `deepak@office.com`
* **Admin Password**: `Ananth`
* **Admin Access**: View employee targets, password manager, and master attendance logs.

### 2. Employee Registration:
* Click **Register** on the login screen.
* Enter your full name, email (e.g. `deepakkumar.kc@sagitec.com`), and a secure password.
* Log in and verify the personalized dashboard.

### 3. Core Tracking Workflows:
* **🏢 Office Tracking**: Click **Check In to Office** $\rightarrow$ Verify real-time clock runs $\rightarrow$ Stop session with break reason.
* **🏠 Remote Work**: Switch mode to Remote $\rightarrow$ Start Remote timer $\rightarrow$ Edit session time $\rightarrow$ Verify duration updates.
* **🎯 Task Tracking**: Click **+ Start Task** or **+ Add Task Manually** $\rightarrow$ Verify tasks nest under current work session.
* **📅 Date-Range Explorer**: Open **Date-Range Explorer** $\rightarrow$ Click `This Week` / `This Month` $\rightarrow$ Expand date tree nodes to review sessions and tasks.
* **📥 Multi-Section Export**: Open **Reports & Export** $\rightarrow$ Click **Download Multi-Sheet CSV / Excel** $\rightarrow$ Confirm instant download of complete structured report with zero double-counting.

---

## Step 7 — Free-Tier SQLite Persistence & Backup Strategy

On Render's Free tier, services operate on ephemeral container disks. This means:
* **During normal usage (starts, stops, sessions, tasks)**: SQLite persists data normally across user sessions.
* **During a new `git push` or manual code redeploy**: Render spins up a fresh container, which re-initializes SQLite with seed data.

### Recommended Free Backup Strategy:
1. **Periodic 1-Click Export**:
   Before triggering manual major code redeploys, go to **Reports & Export** $\rightarrow$ click **Download Multi-Sheet CSV / Excel** to save a complete backup statement of all historical logs.
2. **Zero Maintenance**:
   Since Render only redeploys when you explicitly run `git push`, your database will remain intact during regular daily operations.

---

## Step 8 — Optional Email SMTP Configuration

WorkPulse includes built-in email reporting via Python's standard `smtplib`. To enable direct email report delivery:

### For Microsoft 365 / Outlook (`@sagitec.com` / `@office365.com`):
* `SMTP_HOST`: `smtp.office365.com`
* `SMTP_PORT`: `587`
* `SENDER_EMAIL`: `your_email@sagitec.com`
* `SENDER_PASSWORD`: *Your Microsoft 365 App Password (generated from Microsoft Account Security)*

### For Gmail:
* `SMTP_HOST`: `smtp.gmail.com`
* `SMTP_PORT`: `587`
* `SENDER_EMAIL`: `your_email@gmail.com`
* `SENDER_PASSWORD`: *Your 16-character Google App Password*

---

## Troubleshooting & Common Questions (FAQ)

### Q1: Why does the first load take 30–45 seconds in the morning?
* **Answer**: On Render's Free tier, the service automatically spins down (sleeps) after 15 minutes of zero traffic to conserve resources. The first request wakes the container up (cold start). All subsequent requests throughout the day are lightning fast.

### Q2: How do I update the application after making code changes?
* **Answer**: Simply commit and push your changes to GitHub:
  ```powershell
  git add .
  git commit -m "Update feature X"
  git push origin main
  ```
  Render will detect the push, automatically build, and update your live site within 60 seconds!

### Q3: How do I view live server logs or errors?
* **Answer**: In your Render Dashboard, click your web service $\rightarrow$ navigate to the **Logs** tab on the left sidebar. You can monitor live HTTP requests, database events, and debug exceptions in real time.

### Q4: Can I use a custom domain (e.g. `tracker.mycompany.com`)?
* **Answer**: Yes! In your Render service dashboard, go to **Settings** $\rightarrow$ **Custom Domains** $\rightarrow$ Add your domain name $\rightarrow$ Add the provided CNAME record to your DNS provider. Render will automatically issue a free Let's Encrypt SSL/TLS certificate.

---

## Future Scaling & PostgreSQL Migration

If your team grows from 10 to 100+ coworkers:
1. **Upgrade Render Tier ($7/month)**:
   Switch instance from *Free* to *Starter* in Render settings. This completely eliminates cold starts and keeps the container running 24/7/365 with dedicated CPU.
2. **Connect Free Cloud PostgreSQL**:
   Create a free PostgreSQL instance on **Supabase** or **Neon.tech** (500 MB free) and update `DB_FILE` or add a PostgreSQL connector to achieve permanent cloud database persistence across any number of deployments.
