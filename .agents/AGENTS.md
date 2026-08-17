# Project Rules & AI Operating Instructions for WorkPulse

## Mandatory Starting Rule for All AI Agents
Whenever you receive a task in this workspace:
1. **Read [PROJECT_CONTEXT.md](file:///y:/Deepak_Projects/office-time-tracker/PROJECT_CONTEXT.md) immediately.** It contains the entire architecture, database schema, business rules, API catalog, and file structure.
2. **Preserve Zero-Dependency Standard**: The backend (`app.py`) is pure Python standard library (`http.server`, `sqlite3`, `json`, `hashlib`, `hmac`). Do not install or require external web frameworks (no Flask/FastAPI/Django).
3. **Security**: Passwords must never be stored or transmitted in plaintext. Passwords must never appear in API responses or UI tables.
4. **Synchronicity**: Office/Remote sessions and granular tasks must remain synchronized (tasks are children of sessions; ghost tasks are auto-closed if sessions stop).
5. **Two Portals**:
   - User workspace is in `public/index.html` (`public/js/app.js`, `public/js/tasks.js`, `public/js/timer.js`, `public/js/auth.js`).
   - Admin portal is in `public/admin.html` (`public/js/admin.js`, `public/css/admin.css`).
6. **Deployment**: Deployed on Render (`https://workpulse-tracker.onrender.com`). After completing changes, always stage, commit, and push (`git push origin main`) so Render builds and updates the live site.
