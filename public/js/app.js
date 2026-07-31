/* ==========================================================================
   OFFICE TRACKER - MAIN APP & ADMIN CONTROLLER
   ========================================================================== */

let cachedMonthlyData = null;
let cachedAdminMasterSessions = [];

document.addEventListener('DOMContentLoaded', () => {
  const dateInput = document.getElementById('selectedDate');
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (dateInput) dateInput.value = today;

  const monthInput = document.getElementById('reportMonth');
  if (monthInput) monthInput.value = today.substring(0, 7);

  if (dateInput) {
    dateInput.addEventListener('change', () => {
      fetchDashboardData();
    });
  }

  checkAuthState();
});

/* ==========================================================================
   STANDARD DASHBOARD FUNCTIONS
   ========================================================================== */

async function fetchDashboardData() {
  const selectedDate = document.getElementById('selectedDate').value;

  try {
    const res = await fetch(`/api/dashboard?date=${selectedDate}`, {
      headers: getAuthHeader()
    });

    if (res.status === 401) {
      logoutUser();
      return;
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to fetch dashboard data');

    updateDashboardUI(data);

  } catch (err) {
    showToast(err.message, 'error');
  }
}

function updateDashboardUI(data) {
  const { current_status, active_session, today_sessions, today_total_minutes, weekly_office_days, history } = data;

  const statusDot = document.getElementById('statusDot');
  const currentStatusText = document.getElementById('currentStatusText');
  const statusSubtext = document.getElementById('statusSubtext');
  const btnStartTimer = document.getElementById('btnStartTimer');
  const btnStopTimer = document.getElementById('btnStopTimer');

  const selectedDateInput = document.getElementById('selectedDate');
  const selectedDate = selectedDateInput ? selectedDateInput.value : '';
  const d = new Date();
  const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const isPastDate = selectedDate && selectedDate < todayStr;

  if (current_status === 'IN_OFFICE') {
    statusDot.className = 'status-indicator-dot active';
    currentStatusText.textContent = 'In Office (Timer Active)';
    currentStatusText.style.color = 'var(--status-in-office)';
    statusSubtext.textContent = `Active session started at ${formatTimeStr(active_session.start_time)}`;
    
    btnStartTimer.disabled = true;
    btnStartTimer.title = '';
    btnStopTimer.disabled = false;

    if (active_session && active_session.start_time) {
      startLiveTimerInterval(active_session.start_time);
    }
  } else {
    statusDot.className = 'status-indicator-dot';
    currentStatusText.textContent = 'Out of Office';
    currentStatusText.style.color = 'var(--text-main)';

    if (isPastDate) {
      statusSubtext.textContent = 'Selected date is in the past. Session timer cannot be started.';
      btnStartTimer.disabled = true;
      btnStartTimer.title = 'Cannot start timer for a past date';
    } else {
      statusSubtext.textContent = 'Click "Start Session" when you arrive at the office.';
      btnStartTimer.disabled = false;
      btnStartTimer.title = '';
    }

    btnStopTimer.disabled = true;

    stopLiveTimerInterval();
  }

  const todayTotalTime = document.getElementById('todayTotalTime');
  const hours = Math.floor(today_total_minutes / 60);
  const minutes = today_total_minutes % 60;
  todayTotalTime.textContent = `${hours}h ${minutes}m`;

  document.getElementById('todaySessionsCount').textContent = today_sessions ? today_sessions.length : 0;

  const daysCompleted = Math.min(weekly_office_days || 0, 3);
  const percent = Math.min(Math.round((daysCompleted / 3) * 100), 100);
  document.getElementById('weeklyTargetText').textContent = `${daysCompleted} / 3 Days`;
  document.getElementById('weeklyProgressBar').style.width = `${percent}%`;

  renderSessionsTable(today_sessions || []);
  renderHistoryTable(history || []);
}

/* ==========================================================================
   ADMIN PORTAL CONTROLLER
   ========================================================================== */

async function fetchAdminOverviewData() {
  try {
    const res = await fetch('/api/admin/overview', {
      headers: getAuthHeader()
    });

    if (res.status === 401 || res.status === 403) {
      showToast('Admin authorization failed', 'error');
      logoutUser();
      return;
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to fetch admin overview');

    updateAdminUI(data);

  } catch (err) {
    showToast(err.message, 'error');
  }
}

function updateAdminUI(data) {
  const { stats, users, master_sessions } = data;

  document.getElementById('adminTotalUsersCount').textContent = stats.total_users || 0;
  document.getElementById('adminActiveInOfficeCount').textContent = stats.active_in_office_today || 0;
  document.getElementById('adminTeamTotalHours').textContent = `${stats.team_total_hours || 0}h`;

  cachedAdminMasterSessions = master_sessions || [];

  renderAdminUsersTable(users || []);
  renderAdminMasterSessionsTable(cachedAdminMasterSessions);
}

function renderAdminUsersTable(users) {
  const tbody = document.getElementById('adminUsersTableBody');
  tbody.innerHTML = '';

  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-muted);">No registered users found.</td></tr>';
    return;
  }

  users.forEach(u => {
    const tr = document.createElement('tr');
    const roleBadge = u.role === 'ADMIN' ? 
      '<span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4);"><i class="fa-solid fa-user-shield"></i> ADMIN</span>' :
      '<span class="badge badge-secondary"><i class="fa-solid fa-user"></i> USER</span>';

    const regDate = u.created_at ? u.created_at.substring(0, 10) : '--';
    const plainPass = u.password || '******';
    const passSpanId = `pass_span_${u.id}`;

    tr.innerHTML = `
      <td><strong>#${u.id}</strong></td>
      <td><strong>${u.name}</strong></td>
      <td>${u.email}</td>
      <td>${roleBadge}</td>
      <td>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span id="${passSpanId}" style="font-family: monospace; font-weight: bold; background: rgba(0,0,0,0.3); padding: 0.2rem 0.5rem; border-radius: 4px;">••••••••</span>
          <button class="btn-logout" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; border: 1px solid var(--glass-border);" onclick="togglePasswordVisibility('${passSpanId}', '${plainPass.replace(/'/g, "\\'")}', this)">
            <i class="fa-solid fa-eye"></i> Show
          </button>
        </div>
      </td>
      <td>${regDate}</td>
      <td>${u.session_count} session(s)</td>
      <td><strong>${u.total_hours}h ${u.total_minutes}m</strong></td>
      <td>
        <button class="btn-primary" style="padding: 0.35rem 0.75rem; font-size: 0.78rem; width: auto; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);" onclick="promptAdminResetPassword(${u.id}, '${u.name.replace(/'/g, "\\'")}', '${u.email}')">
          <i class="fa-solid fa-key"></i> Set Password
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function togglePasswordVisibility(spanId, passText, btnElement) {
  const span = document.getElementById(spanId);
  if (span.textContent === '••••••••') {
    span.textContent = passText;
    span.style.color = '#fbbf24';
    btnElement.innerHTML = '<i class="fa-solid fa-eye-slash"></i> Hide';
  } else {
    span.textContent = '••••••••';
    span.style.color = 'inherit';
    btnElement.innerHTML = '<i class="fa-solid fa-eye"></i> Show';
  }
}


async function promptAdminResetPassword(userId, userName, userEmail) {
  const newPassword = prompt(`🔑 Admin Password Reset:\n\nEnter new password for employee '${userName}' (${userEmail}):`);
  if (!newPassword || !newPassword.trim()) return;

  try {
    const res = await fetch('/api/admin/reset-user-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({ user_id: userId, new_password: newPassword.trim() })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to reset user password');

    showToast(data.message, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}


function renderAdminMasterSessionsTable(sessions) {
  const tbody = document.getElementById('adminMasterSessionsTableBody');
  tbody.innerHTML = '';

  if (sessions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No session records found.</td></tr>';
    return;
  }

  sessions.forEach((s, idx) => {
    const tr = document.createElement('tr');
    
    const startTimeFormatted = formatTimeStr(s.start_time);
    const stopTimeFormatted = s.stop_time ? formatTimeStr(s.stop_time) : '<em>In Progress...</em>';
    const durationFormatted = s.stop_time ? formatDurationStr(s.duration_seconds) : '---';
    
    let statusBadge = '';
    if (s.status === 'IN_OFFICE') {
      statusBadge = '<span class="badge badge-active"><i class="fa-solid fa-satellite-dish"></i> IN OFFICE</span>';
    } else if (s.status === 'AUTO_CUTOFF') {
      statusBadge = '<span class="badge badge-autocutoff"><i class="fa-solid fa-triangle-exclamation"></i> AUTO CUTOFF</span>';
    } else {
      statusBadge = '<span class="badge badge-success"><i class="fa-solid fa-check"></i> COMPLETED</span>';
    }

    const reasonHTML = getReasonBadgeHTML(s.break_reason, s.notes);
    const editBtnHTML = `
      <button class="btn-logout btn-edit-session" style="padding: 0.25rem 0.6rem; font-size: 0.78rem; border: 1px solid var(--glass-border); background: rgba(59, 130, 246, 0.15); color: #60a5fa;" 
        onclick="openEditStopTimeModal(${s.id}, '${s.start_time}', '${s.stop_time || ''}', '${(s.break_reason || '').replace(/'/g, "\\'")}', '${(s.notes || '').replace(/'/g, "\\'")}')" title="Manually edit stop time">
        <i class="fa-solid fa-pen"></i> Edit
      </button>
    `;

    tr.innerHTML = `
      <td><strong>${idx + 1}</strong></td>
      <td>
        <strong style="color: var(--text-main);">${s.employee_name}</strong>
        <div style="font-size: 0.75rem; color: var(--text-muted);">${s.employee_email}</div>
      </td>
      <td>${s.date} <span class="badge badge-secondary" style="font-size: 0.7rem;">${s.work_mode}</span></td>
      <td>${startTimeFormatted}</td>
      <td>${stopTimeFormatted}</td>
      <td><strong>${durationFormatted}</strong></td>
      <td>${reasonHTML}</td>
      <td>${statusBadge}</td>
      <td>${editBtnHTML}</td>
    `;
    tbody.appendChild(tr);
  });
}

function filterAdminSessionsTable() {
  const query = document.getElementById('adminFilterInput').value.trim().toLowerCase();
  if (!query) {
    renderAdminMasterSessionsTable(cachedAdminMasterSessions);
    return;
  }

  const filtered = cachedAdminMasterSessions.filter(s => 
    (s.employee_name && s.employee_name.toLowerCase().includes(query)) ||
    (s.employee_email && s.employee_email.toLowerCase().includes(query)) ||
    (s.break_reason && s.break_reason.toLowerCase().includes(query))
  );

  renderAdminMasterSessionsTable(filtered);
}

/* ==========================================================================
   MONTHLY REPORT & CSV FUNCTIONS
   ========================================================================== */

async function fetchMonthlyReportData() {
  const monthInput = document.getElementById('reportMonth');
  const month = monthInput ? monthInput.value : new Date().toISOString().substring(0, 7);

  try {
    const res = await fetch(`/api/reports/monthly?month=${month}`, {
      headers: getAuthHeader()
    });

    if (!res.ok) return;

    const data = await res.json();
    cachedMonthlyData = data;

    document.getElementById('monthlyOfficeDaysText').textContent = `${data.total_office_days} Days`;
    document.getElementById('monthlyHoursText').textContent = `${data.total_hours}h ${data.total_minutes}m`;
    document.getElementById('monthlySessionsCountText').textContent = data.session_count || 0;

  } catch (err) {
    console.error('Failed to fetch monthly report:', err);
  }
}

function exportMonthlyCSV() {
  if (!cachedMonthlyData || !cachedMonthlyData.sessions || cachedMonthlyData.sessions.length === 0) {
    showToast('No session data found for the selected month to export.', 'error');
    return;
  }

  const { month, sessions } = cachedMonthlyData;
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Date,Work Mode,Start Time,Stop Time,Duration (Seconds),Break Reason,Notes,Status\n";

  sessions.forEach(s => {
    const date = s.date;
    const mode = s.work_mode;
    const start = s.start_time || '';
    const stop = s.stop_time || '';
    const dur = s.duration_seconds || 0;
    const reason = `"${(s.break_reason || '').replace(/"/g, '""')}"`;
    const notes = `"${(s.notes || '').replace(/"/g, '""')}"`;
    const status = s.status;

    csvContent += `${date},${mode},${start},${stop},${dur},${reason},${notes},${status}\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `office_attendance_report_${month}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast(`Downloaded CSV report for ${month}!`, 'success');
}

async function sendMonthlyEmailReport() {
  const monthInput = document.getElementById('reportMonth');
  const month = monthInput ? monthInput.value : new Date().toISOString().substring(0, 7);

  showToast('Generating and sending monthly report...', 'info');

  try {
    const res = await fetch('/api/reports/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({ month })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to send email report');

    showToast(data.message, 'success');
    if (data.email_note) {
      setTimeout(() => showToast(data.email_note, 'info'), 2500);
    }

  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* Helper formatting functions */

function getReasonBadgeHTML(reason, notes) {
  if (!reason) return '<span class="badge badge-secondary">In Progress...</span>';

  let badgeClass = 'badge-secondary';
  let icon = 'fa-tag';

  if (reason.includes('Auto Cutoff') || reason.includes('Forgot')) {
    badgeClass = 'badge-reason-autocutoff';
    icon = 'fa-clock-rotate-left';
  } else if (reason.includes('Lunch')) {
    badgeClass = 'badge-reason-lunch';
    icon = 'fa-utensils';
  } else if (reason.includes('Tea') || reason.includes('Coffee')) {
    badgeClass = 'badge-reason-tea';
    icon = 'fa-mug-hot';
  } else if (reason.includes('Meeting')) {
    badgeClass = 'badge-reason-meeting';
    icon = 'fa-users';
  } else if (reason.includes('Personal')) {
    badgeClass = 'badge-reason-personal';
    icon = 'fa-user-clock';
  } else if (reason.includes('Outside')) {
    badgeClass = 'badge-reason-outside';
    icon = 'fa-person-walking-arrow-right';
  } else if (reason.includes('Home') || reason.includes('WFH')) {
    badgeClass = 'badge-reason-wfh';
    icon = 'fa-laptop-house';
  } else if (reason.includes('End')) {
    badgeClass = 'badge-reason-end';
    icon = 'fa-house-flag';
  }

  let html = `<span class="badge ${badgeClass}"><i class="fa-solid ${icon}"></i> ${reason}</span>`;
  if (notes) {
    html += `<span class="notes-snippet"><i class="fa-regular fa-comment"></i> ${notes}</span>`;
  }

  return html;
}

function renderSessionsTable(sessions) {
  const tbody = document.getElementById('sessionsTableBody');
  const emptyState = document.getElementById('emptySessionsState');

  tbody.innerHTML = '';

  if (sessions.length === 0) {
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';

  sessions.forEach((s, idx) => {
    const tr = document.createElement('tr');
    
    const startTimeFormatted = formatTimeStr(s.start_time);
    const stopTimeFormatted = s.stop_time ? formatTimeStr(s.stop_time) : '<em>In Progress...</em>';
    const durationFormatted = s.stop_time ? formatDurationStr(s.duration_seconds) : '---';
    
    let statusBadge = '';
    if (s.status === 'IN_OFFICE') {
      statusBadge = '<span class="badge badge-active">In Office</span>';
    } else if (s.status === 'AUTO_CUTOFF') {
      statusBadge = '<span class="badge badge-autocutoff"><i class="fa-solid fa-triangle-exclamation"></i> Auto Cutoff</span>';
    } else {
      statusBadge = '<span class="badge badge-success">Completed</span>';
    }

    const reasonHTML = getReasonBadgeHTML(s.break_reason, s.notes);
    const editBtnHTML = `
      <button class="btn-logout btn-edit-session" style="padding: 0.25rem 0.6rem; font-size: 0.78rem; border: 1px solid var(--glass-border); background: rgba(59, 130, 246, 0.15); color: #60a5fa;" 
        onclick="openEditStopTimeModal(${s.id}, '${s.start_time}', '${s.stop_time || ''}', '${(s.break_reason || '').replace(/'/g, "\\'")}', '${(s.notes || '').replace(/'/g, "\\'")}')" title="Manually edit stop time">
        <i class="fa-solid fa-pen"></i> Edit
      </button>
    `;

    tr.innerHTML = `
      <td><strong>${idx + 1}</strong></td>
      <td><span class="badge badge-secondary">${s.work_mode || 'Office'}</span></td>
      <td>${startTimeFormatted}</td>
      <td>${stopTimeFormatted}</td>
      <td><strong>${durationFormatted}</strong></td>
      <td>${reasonHTML}</td>
      <td>${statusBadge}</td>
      <td>${editBtnHTML}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderHistoryTable(history) {
  const tbody = document.getElementById('historyTableBody');
  tbody.innerHTML = '';

  if (history.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No attendance history recorded yet.</td></tr>';
    return;
  }

  history.forEach(h => {
    const tr = document.createElement('tr');
    const hours = Math.floor(h.total_minutes / 60);
    const minutes = h.total_minutes % 60;
    
    const reasonsSummary = h.reasons_summary ? 
      `<span style="font-size: 0.82rem; color: var(--text-muted);">${h.reasons_summary}</span>` : '--';

    tr.innerHTML = `
      <td><strong>${h.date}</strong></td>
      <td><span class="badge badge-secondary">${h.work_mode}</span></td>
      <td>${h.session_count} session(s)</td>
      <td><strong>${hours}h ${minutes}m</strong></td>
      <td>${reasonsSummary}</td>
      <td><span class="badge badge-success">Recorded</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function formatTimeStr(isoString) {
  if (!isoString) return '--';
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDurationStr(totalSeconds) {
  if (!totalSeconds && totalSeconds !== 0) return '--';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icon = type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-check';
  toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
