/* ==========================================================================
   WORKPULSE ADMIN PORTAL CONTROLLER (public/js/admin.js)
   Enterprise administration dashboard logic: authentication guard,
   user directory, live presence, hierarchical history inspector,
   audit logging, secure password resets, and CSV reporting.
   ========================================================================== */

// --- Global Admin State ---
let currentAdminUser = null;
let activeAdminPage = 'dashboard';
let adminUsersCache = [];
let adminUsersTotal = 0;
let adminUsersPage = 1;
let adminUsersPerPage = 25;
let adminUserSearch = '';
let adminUserStatusFilter = 'all';

let selectedDrawerUserId = null;
let cachedDrawerUserData = null;
let historySelectedUserId = null;
let allUsersDirectory = []; // Flat list for select dropdowns

// ==========================================================================
// 1. AUTHENTICATION & INITIALIZATION
// ==========================================================================

function getAuthToken() {
  return localStorage.getItem('office_tracker_token') || localStorage.getItem('token');
}

function getAuthHeader() {
  const token = getAuthToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

function getStoredUser() {
  try {
    const raw = localStorage.getItem('office_tracker_user') || localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function checkAdminAuth() {
  const token = getAuthToken();
  const user = getStoredUser();

  if (!token || !user) {
    window.location.href = '/';
    return false;
  }

  if (user.role !== 'ADMIN') {
    alert('Access Denied: Administrator privileges required.');
    window.location.href = '/';
    return false;
  }

  currentAdminUser = user;
  return true;
}

document.addEventListener('DOMContentLoaded', () => {
  if (!checkAdminAuth()) return;

  // Initialize UI header with Admin info
  const nameEl = document.getElementById('adminSidebarName');
  const avatarEl = document.getElementById('adminSidebarAvatar');
  if (nameEl && currentAdminUser) nameEl.textContent = currentAdminUser.name || 'Admin';
  if (avatarEl && currentAdminUser) avatarEl.textContent = (currentAdminUser.name || 'A')[0].toUpperCase();

  // Initialize default date inputs for history & exports
  initAdminDateDefaults();

  // Load initial page data
  switchAdminPage('dashboard');

  // Fetch all users list for dropdown selectors
  fetchUsersForDropdowns();
});

function handleAdminLogout() {
  localStorage.removeItem('office_tracker_token');
  localStorage.removeItem('office_tracker_user');
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/';
}

function initAdminDateDefaults() {
  const now = new Date();
  const todayStr = now.toISOString().substring(0, 10);
  
  const d30 = new Date();
  d30.setDate(d30.getDate() - 30);
  const d30Str = d30.toISOString().substring(0, 10);

  const monthStr = now.toISOString().substring(0, 7);

  const hStart = document.getElementById('historyStartDate');
  const hEnd = document.getElementById('historyEndDate');
  if (hStart && !hStart.value) hStart.value = d30Str;
  if (hEnd && !hEnd.value) hEnd.value = todayStr;

  const expStart = document.getElementById('exportReportStartDate');
  const expEnd = document.getElementById('exportReportEndDate');
  if (expStart && !expStart.value) expStart.value = d30Str;
  if (expEnd && !expEnd.value) expEnd.value = todayStr;

  const mPicker = document.getElementById('exportMonthlyPicker');
  if (mPicker && !mPicker.value) mPicker.value = monthStr;
}

// ==========================================================================
// 2. PAGE NAVIGATION & SHELL CONTROLS
// ==========================================================================

function switchAdminPage(pageId, navEl) {
  activeAdminPage = pageId;

  // Update Navigation Active State
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.classList.remove('active');
  });

  if (navEl) {
    navEl.classList.add('active');
  } else {
    // Find matching nav item
    const items = document.querySelectorAll('.sidebar-nav .nav-item');
    items.forEach(item => {
      const onclickAttr = item.getAttribute('onclick') || '';
      if (onclickAttr.includes(`'${pageId}'`)) {
        item.classList.add('active');
      }
    });
  }

  // Update Page Sections Visibility
  document.querySelectorAll('.admin-page').forEach(page => {
    page.classList.remove('active');
  });

  const targetPage = document.getElementById(`page${capitalizeFirstLetter(pageId)}`);
  if (targetPage) targetPage.classList.add('active');

  // Update Topbar Title
  const titles = {
    'dashboard': 'Executive Command Dashboard',
    'users': 'User Accounts & Workforce Directory',
    'history': 'Work & Task History Inspector',
    'categories': 'Activity & Task Categories',
    'audit': 'Administrative Audit Log',
    'reports': 'Reports & Data Exports'
  };
  const titleEl = document.getElementById('topbarTitle');
  if (titleEl) titleEl.textContent = titles[pageId] || 'Admin Portal';

  // Close mobile sidebar if open
  const sidebar = document.getElementById('adminSidebar');
  if (sidebar) sidebar.classList.remove('mobile-open');

  // Trigger page-specific data load
  if (pageId === 'dashboard') fetchDashboardStats();
  else if (pageId === 'users') fetchUsersList(1);
  else if (pageId === 'history') loadUserHistoryReport();
  else if (pageId === 'categories') fetchCategoriesData();
  else if (pageId === 'audit') fetchAuditLogData();
}

function refreshCurrentAdminPage() {
  showAdminToast('Refreshing data...', 'info');
  switchAdminPage(activeAdminPage);
}

function toggleSidebarCollapse() {
  const sidebar = document.getElementById('adminSidebar');
  const main = document.getElementById('adminMain');
  if (sidebar && main) {
    sidebar.classList.toggle('collapsed');
    main.classList.toggle('sidebar-collapsed');
  }
}

function toggleMobileSidebar() {
  const sidebar = document.getElementById('adminSidebar');
  if (sidebar) sidebar.classList.toggle('mobile-open');
}

function handleGlobalSearch(query) {
  if (activeAdminPage !== 'users') {
    switchAdminPage('users');
  }
  const userSearchInput = document.getElementById('userSearchInput');
  if (userSearchInput) userSearchInput.value = query;
  handleUserFilterChange();
}

function capitalizeFirstLetter(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ==========================================================================
// 3. VIEW 1: DASHBOARD STATS & TEAM GRID
// ==========================================================================

async function fetchDashboardStats() {
  try {
    const res = await fetch('/api/admin/stats', { headers: getAuthHeader() });
    if (res.status === 401 || res.status === 403) {
      handleAdminLogout();
      return;
    }
    if (!res.ok) throw new Error('Failed to load dashboard statistics');

    const data = await res.json();
    renderDashboardStats(data);
  } catch (err) {
    showAdminToast(err.message || 'Error fetching dashboard stats', 'error');
  }
}

function renderDashboardStats(data) {
  const { users, today, week, team_status } = data;

  // KPI Tiles
  setElText('statTotalUsers', users.total || 0);
  setElText('statActiveUsersSub', `${users.active || 0} active employees`);
  setElText('navUsersCountBadge', users.total || 0);

  setElText('statInOfficeToday', today.in_office || 0);
  setElText('statRemoteToday', today.remote || 0);
  setElText('statOfflineToday', today.offline || 0);

  setElText('statOfficeHoursToday', today.office_hours_formatted || '0h 0m');
  setElText('statTasksCompletedToday', today.tasks_completed || 0);
  setElText('statTaskTimeTodaySub', `${today.task_hours_formatted || '0h 0m'} logged`);

  // Weekly Card
  setElText('statWeekOfficeDays', week.office_days || 0);
  setElText('statWeekOfficeHours', week.office_hours_formatted || '0h 0m');
  setElText('statWeekRemoteHours', week.remote_hours_formatted || '0h 0m');
  setElText('statWeekTaskHours', week.task_hours_formatted || '0h 0m');

  // Render Team Status Grid
  renderTeamStatusGrid(team_status || []);
}

function renderTeamStatusGrid(team) {
  const container = document.getElementById('teamStatusGrid');
  if (!container) return;

  if (!team || team.length === 0) {
    container.innerHTML = `
      <div class="state-container" style="grid-column: 1 / -1; padding: 2rem;">
        <div class="state-icon"><i class="fa-solid fa-users-slash"></i></div>
        <div class="state-title">No employees registered yet</div>
        <div class="state-text">Registered employee accounts will appear in this live presence overview.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = team.map(u => {
    const initial = (u.name || 'U')[0].toUpperCase();
    
    let dotClass = 'offline';
    let badgeClass = 'offline';
    let badgeLabel = 'Offline';
    let icon = 'fa-user-slash';

    if (!u.is_active) {
      dotClass = 'inactive';
      badgeClass = 'inactive';
      badgeLabel = 'Deactivated';
      icon = 'fa-ban';
    } else if (u.session_status === 'IN_OFFICE') {
      dotClass = 'office';
      badgeClass = 'in-office';
      badgeLabel = 'In Office';
      icon = 'fa-building-circle-check';
    } else if (u.session_status === 'WORKING_REMOTE') {
      dotClass = 'remote';
      badgeClass = 'remote';
      badgeLabel = 'Remote / WFH';
      icon = 'fa-house-laptop';
    }

    const taskSnippet = u.active_task ? 
      `<div class="team-task-label" title="${escapeHtml(u.active_task)}"><i class="fa-solid fa-spinner fa-spin" style="color: var(--accent-primary);"></i> ${escapeHtml(u.active_task)}</div>` : 
      '';

    return `
      <div class="team-card" onclick="openUserDrawer(${u.id})">
        <div class="team-card-header">
          <div class="team-avatar">
            ${initial}
            <div class="team-status-dot ${dotClass}"></div>
          </div>
          <div style="flex: 1; min-width: 0;">
            <div class="team-name" title="${escapeHtml(u.name)}">${escapeHtml(u.name)}</div>
            <div class="team-email">${escapeHtml(u.email)}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
          <span class="team-status-badge ${badgeClass}">
            <i class="fa-solid ${icon}"></i> ${badgeLabel}
          </span>
          <span style="font-size: 0.7rem; color: var(--text-dim);"><i class="fa-solid fa-chevron-right"></i></span>
        </div>
        ${taskSnippet}
      </div>
    `;
  }).join('');
}

// ==========================================================================
// 4. VIEW 2: USER MANAGEMENT TABLE
// ==========================================================================

async function fetchUsersList(page = 1) {
  adminUsersPage = page;
  const tbody = document.getElementById('usersTableBody');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 2rem;">
          <div class="spinner" style="margin: 0 auto 0.75rem;"></div>
          <span style="color: var(--text-muted); font-size: 0.85rem;">Loading user directory...</span>
        </td>
      </tr>
    `;
  }

  const queryParams = new URLSearchParams({
    page: page,
    per_page: adminUsersPerPage,
    search: adminUserSearch,
    status: adminUserStatusFilter
  });

  try {
    const res = await fetch(`/api/admin/users?${queryParams.toString()}`, {
      headers: getAuthHeader()
    });
    if (!res.ok) throw new Error('Failed to load user list');

    const data = await res.json();
    adminUsersCache = data.users || [];
    adminUsersTotal = data.total || 0;
    renderUsersTable(data);
  } catch (err) {
    showAdminToast(err.message || 'Error loading users', 'error');
  }
}

function renderUsersTable(data) {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  const users = data.users || [];
  if (users.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="state-container" style="padding: 2.5rem;">
            <div class="state-icon"><i class="fa-solid fa-user-xmark"></i></div>
            <div class="state-title">No matching users found</div>
            <div class="state-text">Try adjusting your search query or status filter.</div>
          </div>
        </td>
      </tr>
    `;
    renderPagination(0, 1, 25);
    return;
  }

  tbody.innerHTML = users.map(u => {
    const initial = (u.name || 'U')[0].toUpperCase();
    
    // Role pill
    const rolePill = u.role === 'ADMIN' ? 
      `<span class="status-pill admin-role"><i class="fa-solid fa-user-shield"></i> Admin</span>` : 
      `<span class="status-pill" style="background: rgba(255,255,255,0.05); color: var(--text-muted);"><i class="fa-solid fa-user"></i> User</span>`;

    // Account status pill
    const accountStatusPill = u.is_active ? 
      `<span class="status-pill active-account"><i class="fa-solid fa-circle-check"></i> Active</span>` : 
      `<span class="status-pill inactive-account"><i class="fa-solid fa-ban"></i> Deactivated</span>`;

    // Live mode pill
    let modePill = `<span class="status-pill offline"><i class="fa-solid fa-moon"></i> Offline</span>`;
    if (u.live_status === 'IN_OFFICE') {
      modePill = `<span class="status-pill in-office"><i class="fa-solid fa-building"></i> Office</span>`;
    } else if (u.live_status === 'WORKING_REMOTE') {
      modePill = `<span class="status-pill remote"><i class="fa-solid fa-laptop-house"></i> Remote</span>`;
    }

    const todayHours = `${u.today_hours || 0}h ${u.today_minutes || 0}m`;
    const totalHours = `${u.total_hours || 0}h ${u.total_minutes || 0}m`;
    const targetLabel = `${u.target_days || 3}d / ${u.target_hours || 24}h`;

    const toggleStatusBtn = u.role === 'ADMIN' ? '' : (
      u.is_active ? 
      `<button class="btn-icon-action danger" onclick="toggleUserAccountStatus(${u.id}, true, '${escapeHtml(u.name)}')" title="Deactivate Account"><i class="fa-solid fa-user-xmark"></i></button>` : 
      `<button class="btn-icon-action success" onclick="toggleUserAccountStatus(${u.id}, false, '${escapeHtml(u.name)}')" title="Activate Account"><i class="fa-solid fa-user-check"></i></button>`
    );

    return `
      <tr>
        <td>
          <div class="user-cell">
            <div class="user-cell-avatar">${initial}</div>
            <div>
              <div class="user-cell-name" style="cursor: pointer;" onclick="openUserDrawer(${u.id})">${escapeHtml(u.name)}</div>
              <div class="user-cell-email">${escapeHtml(u.email)}</div>
            </div>
          </div>
        </td>
        <td>${rolePill}</td>
        <td>${accountStatusPill}</td>
        <td>${modePill}</td>
        <td><strong>${todayHours}</strong></td>
        <td style="color: var(--text-muted);">${totalHours} (${u.session_count || 0} sessions)</td>
        <td><span class="badge" style="background: rgba(99,102,241,0.1); color: var(--accent-primary); padding: 3px 8px; border-radius: 4px; font-size: 0.75rem;">${targetLabel}</span></td>
        <td>
          <div class="row-actions">
            <button class="btn-icon-action" onclick="openUserDrawer(${u.id})" title="View Complete Profile"><i class="fa-solid fa-eye"></i></button>
            <button class="btn-icon-action" onclick="openResetPasswordModal(${u.id}, '${escapeHtml(u.name)}')" title="Reset Password"><i class="fa-solid fa-key"></i></button>
            ${toggleStatusBtn}
            <button class="btn-icon-action" onclick="quickExportUserReport(${u.id})" title="Export CSV Data"><i class="fa-solid fa-file-arrow-down"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  renderPagination(data.total || 0, data.page || 1, data.per_page || 25);
}

function renderPagination(total, page, perPage) {
  const info = document.getElementById('usersPaginationInfo');
  const controls = document.getElementById('usersPaginationControls');
  if (!info || !controls) return;

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const start = total === 0 ? 0 : (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);

  info.textContent = `Showing ${start} to ${end} of ${total} employees`;

  let html = `
    <button class="page-btn" ${page <= 1 ? 'disabled' : ''} onclick="fetchUsersList(${page - 1})">
      <i class="fa-solid fa-chevron-left"></i>
    </button>
  `;

  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= page - 1 && p <= page + 1)) {
      html += `<button class="page-btn ${p === page ? 'active' : ''}" onclick="fetchUsersList(${p})">${p}</button>`;
    } else if (p === page - 2 || p === page + 2) {
      html += `<span style="padding: 0 4px; color: var(--text-dim);">...</span>`;
    }
  }

  html += `
    <button class="page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="fetchUsersList(${page + 1})">
      <i class="fa-solid fa-chevron-right"></i>
    </button>
  `;

  controls.innerHTML = html;
}

function handleUserFilterChange() {
  const searchInput = document.getElementById('userSearchInput');
  adminUserSearch = searchInput ? searchInput.value.trim() : '';
  fetchUsersList(1);
}

function setUserStatusFilter(filter, btnEl) {
  adminUserStatusFilter = filter;
  document.querySelectorAll('.filter-chips .filter-chip').forEach(c => c.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  fetchUsersList(1);
}

// ==========================================================================
// 5. SLIDE-IN USER PROFILE DRAWER
// ==========================================================================

async function openUserDrawer(userId) {
  selectedDrawerUserId = userId;
  const overlay = document.getElementById('drawerOverlay');
  const drawer = document.getElementById('userDrawer');
  if (overlay) overlay.classList.add('open');
  if (drawer) drawer.classList.add('open');

  // Reset Drawer to Profile tab
  switchDrawerTab('profile');

  // Load User Profile Data
  try {
    const res = await fetch(`/api/admin/users/${userId}`, { headers: getAuthHeader() });
    if (!res.ok) throw new Error('Failed to load user profile');
    const data = await res.json();
    cachedDrawerUserData = data;
    renderUserDrawerContent(data);
  } catch (err) {
    showAdminToast(err.message || 'Error opening user profile', 'error');
  }
}

function closeUserDrawer() {
  const overlay = document.getElementById('drawerOverlay');
  const drawer = document.getElementById('userDrawer');
  if (overlay) overlay.classList.remove('open');
  if (drawer) drawer.classList.remove('open');
  selectedDrawerUserId = null;
  cachedDrawerUserData = null;
}

function renderUserDrawerContent(data) {
  const { user, live, today, week } = data;

  // Header
  setElText('drawerAvatar', (user.name || 'U')[0].toUpperCase());
  setElText('drawerName', user.name || 'Employee');
  setElText('drawerEmail', user.email || '');

  // Action Buttons
  const toggleBtn = document.getElementById('drawerToggleStatusBtn');
  if (toggleBtn) {
    if (user.role === 'ADMIN') {
      toggleBtn.style.display = 'none';
    } else {
      toggleBtn.style.display = 'inline-flex';
      if (user.is_active) {
        toggleBtn.className = 'btn btn-red btn-sm';
        toggleBtn.innerHTML = '<i class="fa-solid fa-user-xmark"></i> Deactivate';
      } else {
        toggleBtn.className = 'btn btn-emerald btn-sm';
        toggleBtn.innerHTML = '<i class="fa-solid fa-user-check"></i> Activate';
      }
    }
  }

  // Tab 1: Profile & Compliance
  setElText('drawerRole', user.role || 'USER');
  setElText('drawerStatus', user.is_active ? 'Active' : 'Deactivated');
  setElText('drawerJoined', user.created_at ? user.created_at.substring(0, 10) : '—');
  setElText('drawerPreferredDays', user.preferred_days || 'Mon, Tue, Wed, Thu, Fri');

  setElText('drawerDaysText', `${week.office_days || 0} / ${user.target_days || 3}`);
  setElText('drawerDaysPercent', `${week.days_percent || 0}%`);
  const daysBar = document.getElementById('drawerDaysBar');
  if (daysBar) daysBar.style.width = `${Math.min(100, week.days_percent || 0)}%`;

  setElText('drawerHoursText', `${week.office_hours || 0} / ${user.target_hours || 24}`);
  setElText('drawerHoursPercent', `${week.hours_percent || 0}%`);
  const hoursBar = document.getElementById('drawerHoursBar');
  if (hoursBar) hoursBar.style.width = `${Math.min(100, week.hours_percent || 0)}%`;

  // Tab 2: Today's stats
  setElText('drawerTodayTotal', today.total_formatted || '0h 0m');
  setElText('drawerTodayOffice', today.office_formatted || '0h 0m');
  setElText('drawerTodayRemote', today.remote_formatted || '0h 0m');
  setElText('drawerTodayTask', today.task_formatted || '0h 0m');

  // Render Today's Sessions List
  const sessContainer = document.getElementById('drawerTodaySessionsList');
  if (sessContainer) {
    if (!today.sessions || today.sessions.length === 0) {
      sessContainer.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-dim); padding: 0.5rem 0;">No sessions recorded today.</div>';
    } else {
      sessContainer.innerHTML = today.sessions.map(s => {
        const modeIcon = s.work_mode === 'Office' ? '🏢 Office' : '🏠 Remote';
        const start = s.start_time ? s.start_time.substring(11, 16) : '';
        const stop = s.stop_time ? s.stop_time.substring(11, 16) : 'Running';
        const dur = `${Math.floor(s.duration_seconds / 3600)}h ${Math.floor((s.duration_seconds % 3600) / 60)}m`;
        return `
          <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 6px; padding: 0.5rem 0.75rem; margin-bottom: 0.4rem; font-size: 0.8rem; display: flex; justify-content: space-between;">
            <div><strong>${modeIcon}</strong> <span style="color: var(--text-muted); margin-left: 6px;">${start} → ${stop}</span></div>
            <div style="color: var(--accent-primary); font-weight: 600;">${dur}</div>
          </div>
        `;
      }).join('');
    }
  }

  // Render Today's Tasks List
  const taskContainer = document.getElementById('drawerTodayTasksList');
  if (taskContainer) {
    if (!today.tasks || today.tasks.length === 0) {
      taskContainer.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-dim); padding: 0.5rem 0;">No tasks logged today.</div>';
    } else {
      taskContainer.innerHTML = today.tasks.map(t => {
        const dur = `${Math.floor(t.duration_seconds / 60)}m`;
        return `
          <div style="background: rgba(99,102,241,0.05); border-left: 2px solid var(--accent-primary); border-radius: 4px; padding: 0.45rem 0.65rem; margin-bottom: 0.35rem; font-size: 0.78rem; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <span style="font-weight: 500;">${escapeHtml(t.title)}</span>
              <span style="font-size: 0.7rem; color: var(--text-dim); margin-left: 6px;">[${escapeHtml(t.category || 'Other')}]</span>
            </div>
            <span style="color: var(--accent-primary); font-weight: 600;">${dur}</span>
          </div>
        `;
      }).join('');
    }
  }
}

function switchDrawerTab(tabName, btnEl) {
  document.querySelectorAll('.drawer-tabs .drawer-tab').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');

  document.querySelectorAll('.drawer-tab-content').forEach(c => c.style.display = 'none');
  const target = document.getElementById(`drawerTab${capitalizeFirstLetter(tabName)}`);
  if (target) target.style.display = 'block';

  if (tabName === 'history' && selectedDrawerUserId) {
    const hStart = document.getElementById('drawerHistStart');
    const hEnd = document.getElementById('drawerHistEnd');
    const now = new Date();
    if (hEnd && !hEnd.value) hEnd.value = now.toISOString().substring(0, 10);
    if (hStart && !hStart.value) {
      const d = new Date();
      d.setDate(d.getDate() - 15);
      hStart.value = d.toISOString().substring(0, 10);
    }
    loadDrawerHistoryReport();
  }
}

async function loadDrawerHistoryReport() {
  if (!selectedDrawerUserId) return;
  const start = document.getElementById('drawerHistStart').value;
  const end = document.getElementById('drawerHistEnd').value;
  const tree = document.getElementById('drawerHistoryTree');
  if (!tree) return;

  tree.innerHTML = '<div style="text-align: center; padding: 1.5rem;"><div class="spinner" style="margin: 0 auto 0.5rem;"></div><span style="font-size: 0.8rem; color: var(--text-muted);">Loading user work history...</span></div>';

  try {
    const res = await fetch(`/api/admin/users/${selectedDrawerUserId}/report?start_date=${start}&end_date=${end}`, {
      headers: getAuthHeader()
    });
    if (!res.ok) throw new Error('Failed to load history');
    const data = await res.json();
    renderHistoryTreeDOM(tree, data);
  } catch (err) {
    tree.innerHTML = `<div style="color: var(--accent-red); font-size: 0.8rem; padding: 1rem;">${err.message || 'Error loading history'}</div>`;
  }
}

function openResetPasswordModalForDrawer() {
  if (!cachedDrawerUserData) return;
  openResetPasswordModal(cachedDrawerUserData.user.id, cachedDrawerUserData.user.name);
}

function openEditUserModalFromDrawer() {
  if (!cachedDrawerUserData) return;
  openEditUserModal(cachedDrawerUserData.user);
}

function exportUserFromDrawer() {
  if (!selectedDrawerUserId) return;
  quickExportUserReport(selectedDrawerUserId);
}

function toggleUserStatusFromDrawer() {
  if (!cachedDrawerUserData) return;
  const u = cachedDrawerUserData.user;
  toggleUserAccountStatus(u.id, u.is_active, u.name, () => {
    openUserDrawer(u.id); // Reload drawer after toggle
  });
}

// ==========================================================================
// 6. VIEW 3: WORK & TASK HISTORY INSPECTOR (Hierarchical Tree)
// ==========================================================================

async function fetchUsersForDropdowns() {
  try {
    const res = await fetch('/api/admin/users?per_page=500', { headers: getAuthHeader() });
    if (!res.ok) return;
    const data = await res.json();
    allUsersDirectory = data.users || [];

    const hSelect = document.getElementById('historyUserSelect');
    const expSelect = document.getElementById('exportReportUserSelect');

    const optionsHTML = allUsersDirectory.map(u => `
      <option value="${u.id}">${escapeHtml(u.name)} (${escapeHtml(u.email)})</option>
    `).join('');

    if (hSelect) {
      hSelect.innerHTML = optionsHTML;
      if (allUsersDirectory.length > 0 && !historySelectedUserId) {
        historySelectedUserId = allUsersDirectory[0].id;
        hSelect.value = historySelectedUserId;
      }
    }

    if (expSelect) {
      expSelect.innerHTML = optionsHTML;
    }
  } catch (err) {
    console.error('Failed to load dropdown users:', err);
  }
}

function selectAdminHistoryPreset(presetKey, btnEl) {
  document.querySelectorAll('.date-range-presets .preset-chip').forEach(c => c.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');

  const now = new Date();
  let start = new Date();
  let end = new Date();

  if (presetKey === 'today') {
    // start = end = today
  } else if (presetKey === 'yesterday') {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (presetKey === 'this_week') {
    const day = now.getDay() || 7;
    start.setDate(now.getDate() - day + 1);
  } else if (presetKey === 'last_week') {
    const day = now.getDay() || 7;
    start.setDate(now.getDate() - day - 6);
    end = new Date(start);
    end.setDate(start.getDate() + 6);
  } else if (presetKey === 'last_30_days') {
    start.setDate(now.getDate() - 30);
  } else if (presetKey === 'this_month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (presetKey === 'last_month') {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    end = new Date(now.getFullYear(), now.getMonth(), 0);
  }

  const sInput = document.getElementById('historyStartDate');
  const eInput = document.getElementById('historyEndDate');
  if (sInput) sInput.value = start.toISOString().substring(0, 10);
  if (eInput) eInput.value = end.toISOString().substring(0, 10);

  loadUserHistoryReport();
}

async function loadUserHistoryReport() {
  const userSelect = document.getElementById('historyUserSelect');
  const userId = userSelect ? userSelect.value : historySelectedUserId;
  if (!userId) return;
  historySelectedUserId = userId;

  const start = document.getElementById('historyStartDate').value;
  const end = document.getElementById('historyEndDate').value;
  const tree = document.getElementById('historyTreeContainer');
  const summaryPills = document.getElementById('historySummaryPills');

  if (tree) {
    tree.innerHTML = `
      <div class="state-container" style="padding: 3rem;">
        <div class="spinner"></div>
        <div class="state-text" style="margin-top: 0.5rem;">Fetching hierarchical work sessions & tasks...</div>
      </div>
    `;
  }

  try {
    const res = await fetch(`/api/admin/users/${userId}/report?start_date=${start}&end_date=${end}`, {
      headers: getAuthHeader()
    });
    if (!res.ok) throw new Error('Failed to load user work history');

    const data = await res.json();
    
    // Render Range Summary KPIs
    if (summaryPills) {
      const s = data.summary || {};
      summaryPills.innerHTML = `
        <div class="history-summary-pill">
          <span class="pill-label">Total Work Time</span>
          <span class="pill-value">${s.total_work_formatted || '0h 0m'}</span>
        </div>
        <div class="history-summary-pill">
          <span class="pill-label">Office Time (${s.total_office_days || 0} days)</span>
          <span class="pill-value" style="color: var(--accent-emerald);">${s.total_office_formatted || '0h 0m'}</span>
        </div>
        <div class="history-summary-pill">
          <span class="pill-label">Remote Time (${s.total_remote_days || 0} days)</span>
          <span class="pill-value" style="color: var(--accent-sky);">${s.total_remote_formatted || '0h 0m'}</span>
        </div>
        <div class="history-summary-pill">
          <span class="pill-label">Tasks Logged (${s.tasks_count || 0})</span>
          <span class="pill-value" style="color: var(--accent-primary);">${s.total_task_formatted || '0h 0m'}</span>
        </div>
        <div class="history-summary-pill">
          <span class="pill-label">Sessions Recorded</span>
          <span class="pill-value">${s.sessions_count || 0}</span>
        </div>
      `;
    }

    // Render Tree
    renderHistoryTreeDOM(tree, data);
  } catch (err) {
    if (tree) {
      tree.innerHTML = `
        <div class="state-container" style="color: var(--accent-red);">
          <div class="state-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
          <div class="state-title">Error loading history</div>
          <div class="state-text">${err.message}</div>
        </div>
      `;
    }
  }
}

function renderHistoryTreeDOM(container, data) {
  if (!container) return;

  const days = data.daily_breakdown || [];
  if (days.length === 0) {
    container.innerHTML = `
      <div class="state-container" style="padding: 3rem;">
        <div class="state-icon"><i class="fa-solid fa-calendar-xmark"></i></div>
        <div class="state-title">No attendance sessions in selected period</div>
        <div class="state-text">No office or remote work records exist between ${data.start_date} and ${data.end_date}.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = days.map((day, idx) => {
    const isFirst = idx === 0;
    const officeDur = formatSeconds(day.office_seconds);
    const remoteDur = formatSeconds(day.remote_seconds);

    const sessionsHTML = (day.sessions || []).map(sess => {
      const modeIconClass = sess.work_mode === 'Office' ? 'office' : 'remote';
      const modeIcon = sess.work_mode === 'Office' ? 'fa-building' : 'fa-house-laptop';
      const startT = formatTimeLabel(sess.start_time);
      const stopT = sess.stop_time ? formatTimeLabel(sess.stop_time) : 'Running';
      const reasonBadge = sess.break_reason ? `<span class="badge" style="background: rgba(255,255,255,0.06); font-size: 0.7rem; margin-left: 6px;"><i class="fa-solid fa-tag"></i> ${escapeHtml(sess.break_reason)}</span>` : '';

      const tasksHTML = (sess.tasks && sess.tasks.length > 0) ? `
        <div class="session-tasks">
          <div style="font-size: 0.72rem; font-weight: 600; color: var(--text-dim); text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.05em;">
            Child Activities Logged (${sess.tasks.length}):
          </div>
          ${sess.tasks.map(t => `
            <div class="task-row">
              <div class="task-cat-dot"></div>
              <div class="task-title-text">${escapeHtml(t.title)} <span style="font-size: 0.7rem; color: var(--text-dim);">[${escapeHtml(t.category || 'Other')}]</span></div>
              <div class="task-time-range">${formatTimeLabel(t.start_time)} → ${t.stop_time ? formatTimeLabel(t.stop_time) : 'Active'}</div>
              <div class="task-dur">${t.duration_formatted || '0m'}</div>
            </div>
          `).join('')}
        </div>
      ` : `
        <div class="session-tasks" style="padding-top: 0;">
          <span style="font-size: 0.73rem; color: var(--text-dim); font-style: italic;">No specific task breakdown logged inside this session.</span>
        </div>
      `;

      return `
        <div class="session-block">
          <div class="session-header">
            <div class="session-mode-icon ${modeIconClass}"><i class="fa-solid ${modeIcon}"></i></div>
            <div class="session-info">
              <div class="session-times">${sess.work_mode} Session: ${startT} → ${stopT} ${reasonBadge}</div>
              <div class="session-duration">Duration: <strong>${sess.duration_formatted}</strong> • Status: ${sess.status}</div>
            </div>
          </div>
          ${tasksHTML}
        </div>
      `;
    }).join('');

    return `
      <div class="history-day">
        <div class="history-day-header ${isFirst ? 'expanded' : ''}" onclick="toggleHistoryDay(this)">
          <div class="history-day-date-badge">${day.date}</div>
          <div class="history-day-name">${day.day_name}</div>
          <div class="history-day-meta">
            ${day.office_seconds > 0 ? `<div class="meta-item" style="color: var(--accent-emerald);"><i class="fa-solid fa-building"></i> ${officeDur}</div>` : ''}
            ${day.remote_seconds > 0 ? `<div class="meta-item" style="color: var(--accent-sky);"><i class="fa-solid fa-house-laptop"></i> ${remoteDur}</div>` : ''}
            <div class="meta-item"><i class="fa-solid fa-layer-group"></i> ${day.sessions.length} sessions</div>
            <div class="meta-item"><i class="fa-solid fa-list-check"></i> ${day.tasks_count} tasks</div>
          </div>
          <i class="fa-solid fa-chevron-right history-day-chevron"></i>
        </div>
        <div class="history-day-body ${isFirst ? 'open' : ''}">
          ${sessionsHTML}
        </div>
      </div>
    `;
  }).join('');
}

function toggleHistoryDay(headerEl) {
  headerEl.classList.toggle('expanded');
  const body = headerEl.nextElementSibling;
  if (body) body.classList.toggle('open');
}

function exportSelectedUserReport() {
  const userSelect = document.getElementById('historyUserSelect');
  const userId = userSelect ? userSelect.value : historySelectedUserId;
  if (!userId) {
    showAdminToast('Please select a user to export.', 'error');
    return;
  }
  const start = document.getElementById('historyStartDate').value;
  const end = document.getElementById('historyEndDate').value;
  triggerDirectCSVDownload(`/api/admin/users/${userId}/export?start_date=${start}&end_date=${end}`);
}

function quickExportUserReport(userId) {
  const start = document.getElementById('historyStartDate') ? document.getElementById('historyStartDate').value : '';
  const end = document.getElementById('historyEndDate') ? document.getElementById('historyEndDate').value : '';
  triggerDirectCSVDownload(`/api/admin/users/${userId}/export?start_date=${start}&end_date=${end}`);
}

// ==========================================================================
// 7. VIEW 4: CATEGORIES DIRECTORY
// ==========================================================================

async function fetchCategoriesData() {
  const grid = document.getElementById('categoriesGrid');
  if (grid) {
    grid.innerHTML = '<div class="spinner" style="margin: 2rem auto;"></div>';
  }

  try {
    const res = await fetch('/api/admin/categories', { headers: getAuthHeader() });
    if (!res.ok) throw new Error('Failed to load categories');
    const data = await res.json();
    renderCategoriesGrid(data.categories || []);
  } catch (err) {
    showAdminToast(err.message || 'Error loading categories', 'error');
  }
}

function renderCategoriesGrid(cats) {
  const grid = document.getElementById('categoriesGrid');
  if (!grid) return;

  if (cats.length === 0) {
    grid.innerHTML = '<div class="state-container"><div class="state-title">No categories found</div></div>';
    return;
  }

  grid.innerHTML = cats.map(c => `
    <div class="category-card">
      <div class="category-icon-box"><i class="fa-solid fa-tag"></i></div>
      <div class="category-info">
        <div class="category-name">${escapeHtml(c.name)}</div>
        <div class="category-count">${c.count} tasks logged</div>
      </div>
      ${c.is_default ? '<span class="default-badge">DEFAULT</span>' : ''}
    </div>
  `).join('');
}

// ==========================================================================
// 8. VIEW 5: ADMIN AUDIT LOG
// ==========================================================================

async function fetchAuditLogData() {
  const list = document.getElementById('auditLogList');
  if (list) {
    list.innerHTML = '<div class="spinner" style="margin: 2rem auto;"></div>';
  }

  try {
    const res = await fetch('/api/admin/audit-log', { headers: getAuthHeader() });
    if (!res.ok) throw new Error('Failed to load audit log');
    const data = await res.json();
    renderAuditLogList(data.entries || []);
  } catch (err) {
    showAdminToast(err.message || 'Error loading audit log', 'error');
  }
}

function renderAuditLogList(entries) {
  const list = document.getElementById('auditLogList');
  if (!list) return;

  if (entries.length === 0) {
    list.innerHTML = `
      <div class="state-container" style="padding: 2.5rem;">
        <div class="state-icon"><i class="fa-solid fa-shield-check"></i></div>
        <div class="state-title">No administrative actions logged yet</div>
        <div class="state-text">Actions such as password resets, account deactivations, and exports will be recorded here.</div>
      </div>
    `;
    return;
  }

  list.innerHTML = entries.map(e => {
    let iconClass = 'default';
    let icon = 'fa-shield';

    if (e.action.includes('RESET')) {
      iconClass = 'reset';
      icon = 'fa-key';
    } else if (e.action.includes('ACTIVAT')) {
      iconClass = 'activate';
      icon = 'fa-user-check';
    } else if (e.action.includes('DEACTIVAT')) {
      iconClass = 'deactivate';
      icon = 'fa-user-xmark';
    } else if (e.action.includes('EXPORT')) {
      iconClass = 'export';
      icon = 'fa-file-arrow-down';
    } else if (e.action.includes('UPDATE')) {
      iconClass = 'update';
      icon = 'fa-user-pen';
    }

    return `
      <div class="audit-entry">
        <div class="audit-icon ${iconClass}"><i class="fa-solid ${icon}"></i></div>
        <div class="audit-content">
          <div class="audit-action">${escapeHtml(e.action)} <span style="font-weight: 400; color: var(--text-dim); font-size: 0.75rem;">by ${escapeHtml(e.admin)}</span></div>
          ${e.target ? `<div class="audit-target">Target: <strong>${escapeHtml(e.target)}</strong></div>` : ''}
          ${e.details ? `<div class="audit-details">${escapeHtml(e.details)}</div>` : ''}
        </div>
        <div class="audit-ts">${e.timestamp || ''}</div>
      </div>
    `;
  }).join('');
}

// ==========================================================================
// 9. VIEW 6: REPORTS & EXPORTS
// ==========================================================================

function triggerAdminReportExport() {
  const userSelect = document.getElementById('exportReportUserSelect');
  const userId = userSelect ? userSelect.value : '';
  const start = document.getElementById('exportReportStartDate').value;
  const end = document.getElementById('exportReportEndDate').value;

  if (!userId) {
    showAdminToast('Please select an employee to export.', 'error');
    return;
  }
  if (!start || !end) {
    showAdminToast('Please select valid start and end dates.', 'error');
    return;
  }

  triggerDirectCSVDownload(`/api/admin/users/${userId}/export?start_date=${start}&end_date=${end}`);
}

function triggerAdminMonthlyExport() {
  const month = document.getElementById('exportMonthlyPicker').value;
  if (!month) {
    showAdminToast('Please select a valid month.', 'error');
    return;
  }
  
  // Calculate first and last day of month
  const parts = month.split('-');
  const year = parseInt(parts[0]);
  const m = parseInt(parts[1]);
  const lastDay = new Date(year, m, 0).getDate();
  const start = `${month}-01`;
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;

  triggerDirectCSVDownload(`/api/reports/export?start_date=${start}&end_date=${end}`);
}

async function triggerDirectCSVDownload(url) {
  showAdminToast('Generating CSV statement...', 'info');

  try {
    const res = await fetch(url, { headers: getAuthHeader() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Export download failed');
    }

    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobUrl;
    
    // Extract filename from header or fallback
    const disp = res.headers.get('Content-Disposition') || '';
    let filename = 'WorkPulse_Admin_Report.csv';
    if (disp.includes('filename=')) {
      filename = disp.split('filename=')[1].replace(/"/g, '').trim();
    }
    
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      window.URL.revokeObjectURL(blobUrl);
      a.remove();
    }, 2000);

    showAdminToast('Report downloaded successfully!', 'success');
  } catch (err) {
    showAdminToast(err.message || 'Export failed', 'error');
  }
}

// ==========================================================================
// 10. MODALS: SECURE PASSWORD RESET & EDIT USER
// ==========================================================================

let resetTargetUserId = null;

function openResetPasswordModal(userId, userName) {
  resetTargetUserId = userId;
  const nameEl = document.getElementById('resetModalTargetName');
  const input = document.getElementById('adminNewPasswordInput');
  if (nameEl) nameEl.textContent = userName;
  if (input) input.value = '';

  const modal = document.getElementById('resetPasswordModal');
  if (modal) modal.classList.add('open');
}

function closeResetPasswordModal() {
  const modal = document.getElementById('resetPasswordModal');
  if (modal) modal.classList.remove('open');
  resetTargetUserId = null;
}

async function submitAdminPasswordReset() {
  if (!resetTargetUserId) return;
  const input = document.getElementById('adminNewPasswordInput');
  const newPass = input ? input.value.trim() : '';

  if (!newPass || newPass.length < 4) {
    showAdminToast('Password must be at least 4 characters long.', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/admin/users/${resetTargetUserId}/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({ new_password: newPass })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to reset password');

    closeResetPasswordModal();
    showAdminToast(data.message || 'Password reset successfully!', 'success');
  } catch (err) {
    showAdminToast(err.message || 'Error resetting password', 'error');
  }
}

function openEditUserModal(user) {
  document.getElementById('editUserIdHidden').value = user.id;
  document.getElementById('editUserNameInput').value = user.name || '';
  document.getElementById('editUserDaysInput').value = user.target_days || 3;
  document.getElementById('editUserHoursInput').value = user.target_hours || 24.0;
  document.getElementById('editUserPrefDaysInput').value = user.preferred_days || 'Mon,Tue,Wed,Thu,Fri';

  const modal = document.getElementById('editUserModal');
  if (modal) modal.classList.add('open');
}

function closeEditUserModal() {
  const modal = document.getElementById('editUserModal');
  if (modal) modal.classList.remove('open');
}

async function submitEditUserDetails() {
  const uid = document.getElementById('editUserIdHidden').value;
  const name = document.getElementById('editUserNameInput').value.trim();
  const days = document.getElementById('editUserDaysInput').value;
  const hours = document.getElementById('editUserHoursInput').value;
  const pref = document.getElementById('editUserPrefDaysInput').value.trim();

  if (!name) {
    showAdminToast('Employee name is required.', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/admin/users/${uid}/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({
        name: name,
        target_office_days: days,
        target_office_hours: hours,
        preferred_days: pref
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to update user');

    closeEditUserModal();
    showAdminToast(data.message || 'User details updated!', 'success');

    // Refresh views
    fetchUsersList(adminUsersPage);
    if (selectedDrawerUserId == uid) openUserDrawer(uid);
  } catch (err) {
    showAdminToast(err.message || 'Error updating user', 'error');
  }
}

async function toggleUserAccountStatus(userId, currentIsActive, userName, onSuccess) {
  const action = currentIsActive ? 'deactivate' : 'activate';
  const confirmMsg = currentIsActive ? 
    `Are you sure you want to deactivate ${userName}? They will be prevented from logging in.` : 
    `Activate account for ${userName}?`;

  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch(`/api/admin/users/${userId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({ action: action })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to change account status');

    showAdminToast(data.message, 'success');
    fetchUsersList(adminUsersPage);
    if (onSuccess) onSuccess();
  } catch (err) {
    showAdminToast(err.message || 'Error toggling account status', 'error');
  }
}

// ==========================================================================
// 11. HELPERS & TOAST NOTIFICATIONS
// ==========================================================================

function showAdminToast(message, type = 'info') {
  const container = document.getElementById('adminToastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `admin-toast ${type}`;

  let icon = 'fa-info-circle';
  if (type === 'success') icon = 'fa-circle-check';
  else if (type === 'error') icon = 'fa-triangle-exclamation';
  else if (type === 'warning') icon = 'fa-triangle-exclamation';

  toast.innerHTML = `
    <i class="fa-solid ${icon}" style="font-size: 1rem;"></i>
    <span style="flex: 1;">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function setElText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function formatSeconds(sec) {
  if (!sec) return '0h 0m';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatTimeLabel(isoStr) {
  if (!isoStr) return '';
  try {
    let tPart = isoStr.includes('T') ? isoStr.split('T')[1].substring(0, 5) : isoStr.substring(0, 5);
    const parts = tPart.split(':');
    let h = parseInt(parts[0]);
    const m = parts[1];
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
  } catch (e) {
    return isoStr;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
