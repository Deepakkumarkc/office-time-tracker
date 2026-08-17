/* ==========================================================================
   WORKPULSE - TWO-PANEL COMMAND CENTER CONTROLLER (public/js/app.js)
   Manages the split-screen command center, quick mode switching,
   live sessions, 7-day weekly attendance strip, dual progress bars,
   task rendering, and secondary drawers.
   ========================================================================== */

let cachedMonthlyData = null;
let currentUserSettings = null;
let currentWorkMode = 'Office';

// Initialize application on DOM load
document.addEventListener('DOMContentLoaded', () => {
  // Set default date input to today's local YYYY-MM-DD
  const dateInput = document.getElementById('selectedDate');
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (dateInput) dateInput.value = today;

  // Set default monthly report input to current YYYY-MM
  const monthInput = document.getElementById('reportMonth');
  if (monthInput) monthInput.value = today.substring(0, 7);

  // Re-fetch dashboard data when selected date picker changes
  if (dateInput) {
    dateInput.addEventListener('change', () => {
      fetchDashboardData();
    });
  }

  // Check stored auth state and render UI
  checkAuthState();
});

/* Work Mode Switcher Callback */
function setWorkMode(mode) {
  currentWorkMode = mode;
  const modeSelect = document.getElementById('workModeSelect');
  if (modeSelect) modeSelect.value = mode;

  const btnOffice = document.getElementById('modeBtnOffice');
  const btnRemote = document.getElementById('modeBtnRemote');

  if (mode === 'Remote') {
    if (btnRemote) btnRemote.classList.add('active');
    if (btnOffice) btnOffice.classList.remove('active');
  } else {
    if (btnOffice) btnOffice.classList.add('active');
    if (btnRemote) btnRemote.classList.remove('active');
  }

  onWorkModeChange();
}

function onWorkModeChange() {
  const modeSelect = document.getElementById('workModeSelect');
  const mode = modeSelect ? modeSelect.value : currentWorkMode;
  const timerSubtitle = document.getElementById('timerPanelSubtitle');
  const btnStartTimer = document.getElementById('btnStartTimer');
  const activeModeBadge = document.getElementById('activeModeBadge');

  if (mode === 'Remote') {
    if (timerSubtitle) timerSubtitle.textContent = 'LIVE REMOTE TIMER';
    if (btnStartTimer && !window.isSessionActive) {
      btnStartTimer.innerHTML = '<i class="fa-solid fa-laptop-house"></i> Start Remote Session';
    }
    if (activeModeBadge) {
      activeModeBadge.innerHTML = '<i class="fa-solid fa-laptop-house"></i> Remote';
      activeModeBadge.style.color = '#38bdf8';
      activeModeBadge.style.borderColor = 'rgba(56, 189, 248, 0.4)';
    }
  } else {
    if (timerSubtitle) timerSubtitle.textContent = 'LIVE OFFICE TIMER';
    if (btnStartTimer && !window.isSessionActive) {
      btnStartTimer.innerHTML = '<i class="fa-solid fa-play"></i> Start Office Session';
    }
    if (activeModeBadge) {
      activeModeBadge.innerHTML = '<i class="fa-solid fa-building"></i> Office';
      activeModeBadge.style.color = 'var(--status-in-office)';
      activeModeBadge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    }
  }
}

/* ==========================================================================
   STANDARD DASHBOARD FUNCTIONS
   ========================================================================== */

/**
 * Fetches dashboard details (active sessions, tasks, targets, weekly compliance progress, timeline)
 * for the currently selected date.
 */
async function fetchDashboardData() {
  const selectedDateInput = document.getElementById('selectedDate');
  const selectedDate = selectedDateInput ? selectedDateInput.value : new Date().toISOString().substring(0, 10);

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

    // Also fetch monthly summary stats in background
    fetchMonthlyReportData();

  } catch (err) {
    showToast(err.message, 'error');
  }
}

function updateDashboardUI(data) {
  const { 
    current_status, 
    active_session, 
    active_task,
    today_sessions, 
    today_tasks, 
    today_total_minutes, 
    today_office_minutes,
    today_task_seconds,
    category_breakdown,
    timeline,
    user_targets,
    weekly_compliance
  } = data;

  currentUserSettings = user_targets;

  // Track session active flag globally
  const isSessionActive = (current_status === 'IN_OFFICE' || current_status === 'WORKING_REMOTE');
  window.isSessionActive = isSessionActive;

  // Show header mode & date controls
  const headerControls = document.getElementById('headerControlsGroup');
  if (headerControls) headerControls.style.display = 'flex';

  // 1. Live Presence Banner & Mode Controls
  const statusDot = document.getElementById('statusDot');
  const currentStatusText = document.getElementById('currentStatusText');
  const statusSubtext = document.getElementById('statusSubtext');
  const btnStartTimer = document.getElementById('btnStartTimer');
  const btnStopTimer = document.getElementById('btnStopTimer');
  const btnTakeBreak = document.getElementById('btnTakeBreak');
  const timerSubtitle = document.getElementById('timerPanelSubtitle');

  const selectedDateInput = document.getElementById('selectedDate');
  const selectedDate = selectedDateInput ? selectedDateInput.value : '';
  const d = new Date();
  const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const isPastDate = selectedDate && selectedDate < todayStr;

  const btnEditActive = document.getElementById('btnEditActiveSession');

  if (current_status === 'IN_OFFICE') {
    statusDot.className = 'status-indicator-dot active';
    currentStatusText.textContent = 'In Office';
    currentStatusText.style.color = 'var(--status-in-office)';
    statusSubtext.textContent = `Started at ${formatTimeStr(active_session.start_time)}`;
    
    currentActiveSessionData = active_session;
    if (btnEditActive) btnEditActive.style.display = 'inline-flex';

    setWorkMode('Office');
    if (timerSubtitle) timerSubtitle.textContent = 'LIVE OFFICE TIMER';

    btnStartTimer.disabled = true;
    btnStartTimer.title = '';
    btnStopTimer.disabled = false;
    if (btnTakeBreak) btnTakeBreak.disabled = false;

    if (active_session && active_session.start_time) {
      startLiveTimerInterval(active_session.start_time);
    }
  } else if (current_status === 'WORKING_REMOTE') {
    statusDot.className = 'status-indicator-dot active-remote';
    currentStatusText.textContent = 'Working Remotely';
    currentStatusText.style.color = '#38bdf8';
    statusSubtext.textContent = `Started at ${formatTimeStr(active_session.start_time)}`;

    currentActiveSessionData = active_session;
    if (btnEditActive) btnEditActive.style.display = 'inline-flex';

    setWorkMode('Remote');
    if (timerSubtitle) timerSubtitle.textContent = 'LIVE REMOTE TIMER';

    btnStartTimer.disabled = true;
    btnStartTimer.title = '';
    btnStopTimer.disabled = false;
    if (btnTakeBreak) btnTakeBreak.disabled = false;

    if (active_session && active_session.start_time) {
      startLiveTimerInterval(active_session.start_time);
    }
  } else {
    currentActiveSessionData = null;
    if (btnEditActive) btnEditActive.style.display = 'none';

    statusDot.className = 'status-indicator-dot';
    currentStatusText.textContent = 'Out of Office / Inactive';
    currentStatusText.style.color = 'var(--text-main)';

    onWorkModeChange();

    if (isPastDate) {
      statusSubtext.textContent = 'Selected date is in the past.';
      btnStartTimer.disabled = true;
      btnStartTimer.title = 'Cannot start timer for a past date';
    } else {
      statusSubtext.textContent = 'Click "Start Session" to begin tracking';
      btnStartTimer.disabled = false;
      btnStartTimer.title = '';
    }

    btnStopTimer.disabled = true;
    if (btnTakeBreak) btnTakeBreak.disabled = true;
    stopLiveTimerInterval();
  }

  // Store categories if returned
  if (data.categories && data.categories.length > 0) {
    cachedTaskCategories = data.categories;
  }

  // 2. Today's Metric Strip Tiles
  const todayTotalTime = document.getElementById('todayTotalTime');
  const h = Math.floor(today_total_minutes / 60);
  const m = today_total_minutes % 60;
  if (todayTotalTime) todayTotalTime.textContent = `${h}h ${m}m`;

  const taskMinutes = Math.floor(today_task_seconds / 60);
  const tH = Math.floor(taskMinutes / 60);
  const tM = taskMinutes % 60;
  const todayTotalTaskTime = document.getElementById('todayTotalTaskTime');
  if (todayTotalTaskTime) todayTotalTaskTime.textContent = `${tH}h ${tM}m`;

  // Break / Untracked Time
  const breakMinutes = Math.max(0, today_total_minutes - taskMinutes);
  const bH = Math.floor(breakMinutes / 60);
  const bM = breakMinutes % 60;
  const todayBreakTime = document.getElementById('todayBreakTime');
  if (todayBreakTime) todayBreakTime.textContent = `${bH}h ${bM}m`;

  const countSessionsEl = document.getElementById('todaySessionsCount');
  if (countSessionsEl) countSessionsEl.textContent = today_sessions ? today_sessions.length : 0;
  const countTasksEl = document.getElementById('todayTasksCount');
  if (countTasksEl) countTasksEl.textContent = today_tasks ? today_tasks.length : 0;

  // 3. Planned Schedule Reference
  const planSub = document.getElementById('weeklyPlannedScheduleSub');
  if (planSub && user_targets) {
    planSub.textContent = `Planned: ${user_targets.preferred_days || 'Mon-Fri'}`;
  }

  // 4. Flexible Weekly Office Requirements (Dual Progress Bars & 7-Day Strip)
  if (weekly_compliance) {
    const { 
      days_completed, target_days, days_remaining, days_percent,
      hours_completed, target_hours, hours_remaining, hours_percent,
      weekly_days_map
    } = weekly_compliance;

    // Render 7-Day Attendance Strip
    renderWeeklyAttendanceStrip(weekly_days_map || []);

    // Days Meter
    const weeklyTargetDaysText = document.getElementById('weeklyTargetDaysText');
    if (weeklyTargetDaysText) {
      weeklyTargetDaysText.textContent = `${days_completed} / ${target_days} Days`;
    }
    const weeklyDaysRemainingText = document.getElementById('weeklyDaysRemainingText');
    if (weeklyDaysRemainingText) {
      weeklyDaysRemainingText.textContent = days_remaining === 0 ? 'Target Met! 🎉' : `${days_remaining} day${days_remaining > 1 ? 's' : ''} remaining`;
      weeklyDaysRemainingText.style.color = days_remaining === 0 ? 'var(--status-in-office)' : 'var(--text-muted)';
    }
    const weeklyDaysBar = document.getElementById('weeklyProgressBar');
    if (weeklyDaysBar) {
      weeklyDaysBar.style.width = `${days_percent}%`;
    }

    // Hours Meter
    const weeklyTargetHoursText = document.getElementById('weeklyTargetHoursText');
    if (weeklyTargetHoursText) {
      weeklyTargetHoursText.textContent = `${hours_completed}h / ${target_hours}h`;
    }
    const weeklyHoursRemainingText = document.getElementById('weeklyHoursRemainingText');
    if (weeklyHoursRemainingText) {
      weeklyHoursRemainingText.textContent = hours_remaining <= 0 ? 'Target Met! 🎉' : `${hours_remaining}h remaining`;
      weeklyHoursRemainingText.style.color = hours_remaining <= 0 ? 'var(--status-in-office)' : 'var(--text-muted)';
    }
    const weeklyHoursBar = document.getElementById('weeklyHoursProgressBar');
    if (weeklyHoursBar) {
      weeklyHoursBar.style.width = `${hours_percent}%`;
    }
  }

  // 5. Render Live Activity Timeline & Category Badges
  if (typeof renderActivityTimeline === 'function') {
    renderActivityTimeline(timeline || []);
  }

  // 6. Render Tasks UI & Active Task Hero
  if (typeof renderTasksUI === 'function') {
    renderTasksUI(
      today_tasks || [], 
      active_task, 
      today_task_seconds || 0, 
      category_breakdown || {},
      today_total_minutes * 60
    );
  }

  // 7. Render Secondary Tab Tables
  renderSessionsTable(today_sessions || []);
  renderQuickResumeChips(today_tasks || []);
}

/* ==========================================================================
   7-DAY WEEKLY ATTENDANCE STRIP RENDERER
   ========================================================================== */

function renderWeeklyAttendanceStrip(daysMap) {
  const container = document.getElementById('weeklyAttendanceStrip');
  if (!container) return;
  container.innerHTML = '';

  if (!daysMap || daysMap.length === 0) return;

  daysMap.forEach(d => {
    const chip = document.createElement('div');
    chip.className = 'weekly-day-chip';

    if (d.attended) chip.classList.add('attended');
    if (d.is_today) chip.classList.add('today');
    if (d.is_selected) chip.classList.add('selected');

    let badgeHTML = '';
    if (d.attended) {
      badgeHTML = `<span class="day-chip-badge attended"><i class="fa-solid fa-circle-check"></i> ${d.hours}h</span>`;
    } else if (d.is_preferred) {
      badgeHTML = `<span class="day-chip-badge plan"><i class="fa-regular fa-calendar"></i> Plan</span>`;
    } else {
      badgeHTML = `<span class="day-chip-badge off">Off</span>`;
    }

    chip.innerHTML = `
      <div class="day-chip-header">
        <span class="day-chip-name">${d.day_name}</span>
        <span class="day-chip-num">${d.day_num}</span>
      </div>
      <div class="day-chip-status">
        ${badgeHTML}
      </div>
    `;

    // Click on any day to navigate to that day's dashboard
    chip.onclick = () => {
      const dateInput = document.getElementById('selectedDate');
      if (dateInput) {
        dateInput.value = d.date;
        fetchDashboardData();
      }
    };

    chip.title = `Click to view activity for ${d.day_name}, ${d.date} (${d.attended ? d.hours + 'h attended' : (d.is_preferred ? 'Planned office day' : 'Off')})`;

    container.appendChild(chip);
  });
}

/* Render Quick Resume Suggestions for Recent Tasks */
function renderQuickResumeChips(tasks) {
  const container = document.getElementById('quickResumeContainer');
  const section = document.getElementById('quickResumeSection');
  if (!container || !section) return;

  if (!tasks || tasks.length === 0) {
    section.style.display = 'none';
    return;
  }

  // Get unique recent task titles (last 4)
  const uniqueTasks = [];
  const seenTitles = new Set();

  for (let i = tasks.length - 1; i >= 0; i--) {
    const t = tasks[i];
    if (t.title && !seenTitles.has(t.title.toLowerCase())) {
      seenTitles.add(t.title.toLowerCase());
      uniqueTasks.push(t);
      if (uniqueTasks.length >= 4) break;
    }
  }

  if (uniqueTasks.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  container.innerHTML = '';

  uniqueTasks.forEach(t => {
    const chip = document.createElement('button');
    chip.className = 'quick-resume-chip';
    chip.innerHTML = `<i class="fa-solid fa-rotate-right"></i> ${t.title.substring(0, 24)}${t.title.length > 24 ? '...' : ''}`;
    chip.onclick = () => resumeTask(t.title, t.category || 'Other');
    container.appendChild(chip);
  });
}

/* Switch Secondary Tab Content */
function switchSecondaryTab(tabKey, btnElement) {
  const buttons = document.querySelectorAll('.secondary-tab-btn');
  buttons.forEach(b => b.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');

  const tabTasks = document.getElementById('tabContentTasks');
  const tabSessions = document.getElementById('tabContentSessions');
  const tabHistory = document.getElementById('tabContentHistory');
  const tabMonthly = document.getElementById('tabContentMonthly');

  if (tabTasks) tabTasks.style.display = 'none';
  if (tabSessions) tabSessions.style.display = 'none';
  if (tabHistory) tabHistory.style.display = 'none';
  if (tabMonthly) tabMonthly.style.display = 'none';

  if (tabKey === 'sessions' && tabSessions) {
    tabSessions.style.display = 'block';
  } else if (tabKey === 'history' && tabHistory) {
    tabHistory.style.display = 'block';
    fetchRangeReportData();
  } else if (tabKey === 'monthly' && tabMonthly) {
    tabMonthly.style.display = 'block';
    syncCurrentMonthExport();
  } else if (tabTasks) {
    tabTasks.style.display = 'block';
  }
}

/* ==========================================================================
   USER TARGET CONFIGURATION MODAL HANDLERS
   ========================================================================== */

function openTargetSettingsModal() {
  const modal = document.getElementById('targetSettingsModal');
  if (!modal) return;

  if (currentUserSettings) {
    document.getElementById('targetDaysInput').value = currentUserSettings.target_office_days || 3;
    document.getElementById('targetHoursInput').value = currentUserSettings.target_office_hours || 24;
    document.getElementById('preferredDaysInput').value = currentUserSettings.preferred_days || 'Mon,Tue,Wed,Thu,Fri';
  }

  modal.classList.add('open');
}

function closeTargetSettingsModal() {
  const modal = document.getElementById('targetSettingsModal');
  if (modal) modal.classList.remove('open');
}

async function saveTargetSettings() {
  const targetDays = parseInt(document.getElementById('targetDaysInput').value, 10);
  const targetHours = parseFloat(document.getElementById('targetHoursInput').value);
  const preferredDays = document.getElementById('preferredDaysInput').value.trim();

  if (isNaN(targetDays) || targetDays < 1 || targetDays > 7) {
    showToast('Weekly target days must be between 1 and 7.', 'error');
    return;
  }

  if (isNaN(targetHours) || targetHours <= 0 || targetHours > 168) {
    showToast('Weekly target hours must be between 1 and 168 hours.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/user/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({
        target_office_days: targetDays,
        target_office_hours: targetHours,
        preferred_days: preferredDays
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to save target settings');

    closeTargetSettingsModal();
    showToast('Weekly office target requirements updated!', 'success');
    fetchDashboardData();

  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ==========================================================================
   APP VIEW SWITCHER (FOR ADMINS: COMMAND CENTER VS ADMIN PORTAL)
   ========================================================================== */

function switchAppView(view) {
  if (view === 'admin') {
    window.location.href = '/admin.html';
  } else {
    fetchDashboardData();
  }
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

    const daysEl = document.getElementById('monthlyOfficeDaysText');
    if (daysEl) daysEl.textContent = `${data.total_office_days} Days`;

    const hoursEl = document.getElementById('monthlyHoursText');
    if (hoursEl) hoursEl.textContent = `${data.total_hours}h ${data.total_minutes}m`;

    const countEl = document.getElementById('monthlySessionsCountText');
    if (countEl) countEl.textContent = data.session_count || 0;

    const taskHoursEl = document.getElementById('monthlyTaskHoursText');
    if (taskHoursEl) taskHoursEl.textContent = `${data.total_task_hours || 0}h ${data.total_task_minutes || 0}m`;

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

  const currentUser = getCurrentUser();
  const recipient = prompt("Enter email address to send monthly report:", (currentUser ? currentUser.email : ''));
  if (!recipient || !recipient.trim()) return;

  showToast('Generating and sending monthly report...', 'info');

  try {
    const res = await fetch('/api/reports/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({ month, recipient_email: recipient.trim() })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to send email report');

    showToast(data.message, 'success');

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
  } else if (reason.includes('Home') || reason.includes('WFH') || reason.includes('Remote')) {
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

  if (!tbody) return;
  tbody.innerHTML = '';

  if (sessions.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  sessions.forEach((s, idx) => {
    const tr = document.createElement('tr');
    
    const startTimeFormatted = formatTimeStr(s.start_time);
    const stopTimeFormatted = s.stop_time ? formatTimeStr(s.stop_time) : '<em>In Progress...</em>';
    const durationFormatted = s.stop_time ? formatDurationStr(s.duration_seconds) : '---';
    
    let statusBadge = '';
    if (s.status === 'IN_OFFICE') {
      statusBadge = '<span class="badge badge-active">In Office</span>';
    } else if (s.status === 'WORKING_REMOTE') {
      statusBadge = '<span class="badge" style="background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4);"><i class="fa-solid fa-laptop-house"></i> Remote</span>';
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

/* ==========================================================================
   DATE-RANGE EXPLORER & HIERARCHICAL REPORTING CONTROLLER
   ========================================================================== */

let rangeSearchDebounceTimer = null;
let currentRangeReportData = null;

function initRangeReportDefaults() {
  const today = new Date();
  const todayStr = today.toISOString().substring(0, 10);
  
  const d30 = new Date();
  d30.setDate(d30.getDate() - 30);
  const d30Str = d30.toISOString().substring(0, 10);

  const startInput = document.getElementById('historyStartDate');
  const endInput = document.getElementById('historyEndDate');
  if (startInput && !startInput.value) startInput.value = d30Str;
  if (endInput && !endInput.value) endInput.value = todayStr;

  const exportStart = document.getElementById('exportStartDate');
  const exportEnd = document.getElementById('exportEndDate');
  if (exportStart && !exportStart.value) exportStart.value = d30Str;
  if (exportEnd && !exportEnd.value) exportEnd.value = todayStr;

  const monthInput = document.getElementById('reportMonth');
  if (monthInput && !monthInput.value) {
    monthInput.value = today.toISOString().substring(0, 7);
  }
}

function selectRangePreset(preset, btnElement) {
  const pills = document.querySelectorAll('.range-preset-pill');
  pills.forEach(p => p.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');

  const today = new Date();
  const todayStr = today.toISOString().substring(0, 10);

  let startStr = todayStr;
  let endStr = todayStr;

  if (preset === 'today') {
    startStr = todayStr;
    endStr = todayStr;
  } else if (preset === 'yesterday') {
    const yest = new Date(today);
    yest.setDate(yest.getDate() - 1);
    startStr = yest.toISOString().substring(0, 10);
    endStr = startStr;
  } else if (preset === 'this_week') {
    const day = (today.getDay() + 6) % 7; // Mon = 0
    const mon = new Date(today);
    mon.setDate(mon.getDate() - day);
    startStr = mon.toISOString().substring(0, 10);
    endStr = todayStr;
  } else if (preset === 'last_week') {
    const day = (today.getDay() + 6) % 7;
    const lastSun = new Date(today);
    lastSun.setDate(lastSun.getDate() - day - 1);
    const lastMon = new Date(lastSun);
    lastMon.setDate(lastSun.getDate() - 6);
    startStr = lastMon.toISOString().substring(0, 10);
    endStr = lastSun.toISOString().substring(0, 10);
  } else if (preset === 'last_30_days') {
    const d30 = new Date(today);
    d30.setDate(d30.getDate() - 30);
    startStr = d30.toISOString().substring(0, 10);
    endStr = todayStr;
  } else if (preset === 'this_month') {
    startStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    endStr = todayStr;
  } else if (preset === 'last_month') {
    const firstDayLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastDayLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    startStr = firstDayLastMonth.toISOString().substring(0, 10);
    endStr = lastDayLastMonth.toISOString().substring(0, 10);
  } else if (preset === 'custom') {
    return;
  }

  const startInput = document.getElementById('historyStartDate');
  const endInput = document.getElementById('historyEndDate');
  if (startInput) startInput.value = startStr;
  if (endInput) endInput.value = endStr;

  const expStart = document.getElementById('exportStartDate');
  const expEnd = document.getElementById('exportEndDate');
  if (expStart) expStart.value = startStr;
  if (expEnd) expEnd.value = endStr;

  fetchRangeReportData();
}

function onCustomDateChange() {
  const pills = document.querySelectorAll('.range-preset-pill');
  pills.forEach(p => p.classList.remove('active'));
  const customPill = Array.from(pills).find(p => p.textContent.trim() === 'Custom');
  if (customPill) customPill.classList.add('active');

  fetchRangeReportData();
}

function debounceRangeSearch() {
  if (rangeSearchDebounceTimer) clearTimeout(rangeSearchDebounceTimer);
  rangeSearchDebounceTimer = setTimeout(() => {
    fetchRangeReportData();
  }, 300);
}

async function fetchRangeReportData() {
  initRangeReportDefaults();

  const startInput = document.getElementById('historyStartDate');
  const endInput = document.getElementById('historyEndDate');
  const modeSelect = document.getElementById('historyModeFilter');
  const catSelect = document.getElementById('historyCategoryFilter');
  const searchInput = document.getElementById('historySearchInput');

  const startDate = startInput ? startInput.value : '';
  const endDate = endInput ? endInput.value : '';
  const mode = modeSelect ? modeSelect.value : 'All';
  const category = catSelect ? catSelect.value : 'All';
  const search = searchInput ? searchInput.value.trim() : '';

  if (!startDate || !endDate) return;

  try {
    const url = `/api/reports/range?start_date=${startDate}&end_date=${endDate}&mode=${mode}&category=${encodeURIComponent(category)}&search=${encodeURIComponent(search)}`;
    const res = await fetch(url, { headers: getAuthHeader() });

    if (!res.ok) throw new Error('Failed to fetch range report data');

    const data = await res.json();
    currentRangeReportData = data;

    // 1. Update KPI Summary Tiles
    const { summary, daily_breakdown } = data;
    const rangeOfficeDays = document.getElementById('rangeOfficeDaysText');
    const rangeOfficeHours = document.getElementById('rangeOfficeHoursSub');
    const rangeRemoteHours = document.getElementById('rangeRemoteHoursText');
    const rangeRemoteDays = document.getElementById('rangeRemoteDaysSub');
    const rangeTotalWork = document.getElementById('rangeTotalWorkText');
    const rangeSessionsSub = document.getElementById('rangeSessionsCountSub');
    const rangeTaskHours = document.getElementById('rangeTaskHoursText');
    const rangeTasksSub = document.getElementById('rangeTasksCountSub');

    if (rangeOfficeDays) rangeOfficeDays.textContent = `${summary.total_office_days} Days`;
    if (rangeOfficeHours) rangeOfficeHours.textContent = `${summary.total_office_formatted} total`;
    if (rangeRemoteHours) rangeRemoteHours.textContent = summary.total_remote_formatted;
    if (rangeRemoteDays) rangeRemoteDays.textContent = `${summary.total_remote_days} days`;
    if (rangeTotalWork) rangeTotalWork.textContent = summary.total_work_formatted;
    if (rangeSessionsSub) rangeSessionsSub.textContent = `${summary.sessions_count} session(s)`;
    if (rangeTaskHours) rangeTaskHours.textContent = summary.total_task_formatted;
    if (rangeTasksSub) rangeTasksSub.textContent = `${summary.tasks_count} tasks completed`;

    // Also sync to Export Tab Executive Snapshot
    const mOfficeDays = document.getElementById('monthlyOfficeDaysText');
    const mOfficeHours = document.getElementById('monthlyOfficeHoursText');
    const mRemoteHours = document.getElementById('monthlyRemoteHoursText');
    const mTaskHours = document.getElementById('monthlyTaskHoursText');
    if (mOfficeDays) mOfficeDays.textContent = `${summary.total_office_days} Days`;
    if (mOfficeHours) mOfficeHours.textContent = summary.total_office_formatted;
    if (mRemoteHours) mRemoteHours.textContent = summary.total_remote_formatted;
    if (mTaskHours) mTaskHours.textContent = `${summary.total_task_formatted} (${summary.tasks_count}t)`;

    // 2. Populate Category Filter Dropdown
    if (catSelect && cachedTaskCategories && cachedTaskCategories.length > 0) {
      const curVal = catSelect.value;
      catSelect.innerHTML = '<option value="All">All Categories</option>';
      cachedTaskCategories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        if (c === curVal) opt.selected = true;
        catSelect.appendChild(opt);
      });
    }

    // 3. Render Hierarchical Collapsible Tree
    renderHistoryRangeTree(daily_breakdown);

  } catch (err) {
    console.error('Error fetching range report:', err);
  }
}

function renderHistoryRangeTree(dailyBreakdown) {
  const container = document.getElementById('historyRangeTreeContainer');
  const emptyState = document.getElementById('emptyHistoryRangeState');
  if (!container) return;
  container.innerHTML = '';

  if (!dailyBreakdown || dailyBreakdown.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  dailyBreakdown.forEach((day, dayIdx) => {
    const dateNode = document.createElement('div');
    dateNode.className = 'date-tree-node';

    const fmtSec = (sec) => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    const totDayWorkSec = day.office_seconds + day.remote_seconds;
    const dayNameStr = day.day_name || '';

    // Header HTML with quick day badges
    let officeBadge = day.office_seconds > 0 ? `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);"><i class="fa-solid fa-building"></i> ${fmtSec(day.office_seconds)}</span>` : '';
    let remoteBadge = day.remote_seconds > 0 ? `<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);"><i class="fa-solid fa-laptop-house"></i> ${fmtSec(day.remote_seconds)}</span>` : '';
    let taskBadge = day.tasks_count > 0 ? `<span class="badge" style="background: rgba(99, 102, 241, 0.15); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.3);"><i class="fa-solid fa-list-check"></i> ${day.tasks_count} Task(s) (${fmtSec(day.task_seconds)})</span>` : '<span class="badge badge-secondary" style="font-size: 0.72rem;">0 Tasks</span>';

    const header = document.createElement('div');
    header.className = 'date-tree-header';
    header.innerHTML = `
      <div class="date-tree-title-group">
        <i class="fa-solid fa-chevron-down tree-arrow"></i>
        <strong style="color: #fff; font-size: 0.95rem;">${dayNameStr ? dayNameStr + ', ' : ''}${day.date}</strong>
        <span class="tree-total-pill"><i class="fa-regular fa-clock"></i> ${fmtSec(totDayWorkSec)} Total</span>
      </div>
      <div class="date-tree-badges-group">
        ${officeBadge}
        ${remoteBadge}
        ${taskBadge}
      </div>
    `;

    const body = document.createElement('div');
    body.className = 'date-tree-body';

    // Render Work Sessions under this date
    if (day.sessions && day.sessions.length > 0) {
      day.sessions.forEach((s, sIdx) => {
        const sessionCard = document.createElement('div');
        sessionCard.className = 'session-tree-card';

        const isOffice = s.work_mode === 'Office';
        const modeIcon = isOffice ? 'fa-building' : 'fa-laptop-house';
        const modeColor = isOffice ? '#10b981' : '#38bdf8';

        const stFmt = formatTimeStr(s.start_time);
        const spFmt = s.stop_time ? formatTimeStr(s.stop_time) : '<em>In Progress...</em>';

        // Render Session Card Header
        let reasonBadge = s.break_reason ? `<span class="badge badge-secondary" style="font-size: 0.74rem;"><i class="fa-solid fa-tag"></i> ${s.break_reason}</span>` : '';
        let statusBadge = s.status === 'COMPLETED' ? '<span class="badge badge-success" style="font-size: 0.72rem;">Completed</span>' : '<span class="badge badge-active" style="font-size: 0.72rem;">Active</span>';

        sessionCard.innerHTML = `
          <div class="session-tree-header">
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <span class="badge" style="background: ${isOffice ? 'rgba(16, 185, 129, 0.2)' : 'rgba(56, 189, 248, 0.2)'}; color: ${modeColor}; border: 1px solid ${isOffice ? 'rgba(16, 185, 129, 0.4)' : 'rgba(56, 189, 248, 0.4)'}; font-weight: 700;">
                <i class="fa-solid ${modeIcon}"></i> ${s.work_mode} Session #${sIdx + 1}
              </span>
              <strong style="color: var(--text-main); font-size: 0.88rem;">${stFmt} &rarr; ${spFmt}</strong>
              <strong style="color: ${modeColor}; font-size: 0.88rem; background: rgba(0,0,0,0.25); padding: 0.15rem 0.5rem; border-radius: 4px;">${s.duration_formatted}</strong>
              ${reasonBadge}
            </div>
            <div>${statusBadge}</div>
          </div>
        `;

        // Render Tasks nested under this session
        const tasksContainer = document.createElement('div');
        tasksContainer.className = 'session-nested-tasks';

        if (s.tasks && s.tasks.length > 0) {
          const taskTable = document.createElement('table');
          taskTable.className = 'table table-compact nested-tasks-table';
          taskTable.innerHTML = `
            <thead>
              <tr>
                <th style="width: 25px;">#</th>
                <th>Task / Activity</th>
                <th>Category</th>
                <th>Time Range</th>
                <th>Duration</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${s.tasks.map((t, tIdx) => {
                const tSt = formatTimeStr(t.start_time);
                const tSp = t.stop_time ? formatTimeStr(t.stop_time) : '<em>Running...</em>';
                const isAutoSync = t.description && (t.description.includes('Auto-ended') || t.description.includes('Auto-trimmed') || t.description.includes('Auto-adjusted'));
                const auditBadge = isAutoSync ? '<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-size: 0.68rem; margin-left: 0.3rem;"><i class="fa-solid fa-arrows-rotate"></i> Synchronized</span>' : '';

                return `
                  <tr>
                    <td><strong>${tIdx + 1}</strong></td>
                    <td>
                      <strong style="color: var(--text-main); font-size: 0.84rem;">${t.title}</strong>
                      ${auditBadge}
                      ${t.description ? `<div style="font-size: 0.73rem; color: var(--text-muted);"><i class="fa-regular fa-comment"></i> ${t.description}</div>` : ''}
                    </td>
                    <td><span class="category-badge" style="font-size: 0.7rem;">${t.category || 'Other'}</span></td>
                    <td style="font-size: 0.78rem;">${tSt} &rarr; ${tSp}</td>
                    <td><strong>${t.duration_formatted}</strong></td>
                    <td><span class="badge badge-success" style="font-size: 0.7rem;">${t.status}</span></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          `;
          tasksContainer.appendChild(taskTable);
        } else {
          tasksContainer.innerHTML = `
            <div class="empty-session-tasks">
              <i class="fa-solid fa-circle-info" style="color: var(--text-muted);"></i> No specific tasks were recorded during this work session.
            </div>
          `;
        }

        sessionCard.appendChild(tasksContainer);
        body.appendChild(sessionCard);
      });
    }

    // Toggle expand/collapse on header click
    header.onclick = () => {
      const isCollapsed = body.style.display === 'none';
      body.style.display = isCollapsed ? 'block' : 'none';
      const arrow = header.querySelector('.tree-arrow');
      if (arrow) {
        arrow.className = isCollapsed ? 'fa-solid fa-chevron-down tree-arrow' : 'fa-solid fa-chevron-right tree-arrow';
      }
    };

    dateNode.appendChild(header);
    dateNode.appendChild(body);
    container.appendChild(dateNode);
  });
}

function expandAllRangeDays() {
  const bodies = document.querySelectorAll('.date-tree-body');
  bodies.forEach(b => b.style.display = 'block');
  const arrows = document.querySelectorAll('.tree-arrow');
  arrows.forEach(a => a.className = 'fa-solid fa-chevron-down tree-arrow');
}

function collapseAllRangeDays() {
  const bodies = document.querySelectorAll('.date-tree-body');
  bodies.forEach(b => b.style.display = 'none');
  const arrows = document.querySelectorAll('.tree-arrow');
  arrows.forEach(a => a.className = 'fa-solid fa-chevron-right tree-arrow');
}

/* Multi-Sheet Export Trigger */
async function triggerRangeExport() {
  const sDate = document.getElementById('exportStartDate').value || document.getElementById('historyStartDate').value;
  const eDate = document.getElementById('exportEndDate').value || document.getElementById('historyEndDate').value;

  if (!sDate || !eDate) {
    showToast('Please specify a valid start and end date for export.', 'error');
    return;
  }

  showToast('Generating and downloading Multi-Section Attendance & Tasks report...', 'info');

  try {
    const res = await fetch(`/api/reports/export?start_date=${sDate}&end_date=${eDate}`, {
      headers: getAuthHeader()
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.message || 'Failed to download export report');
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `WorkPulse_Report_${sDate}_to_${eDate}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      window.URL.revokeObjectURL(url);
      a.remove();
    }, 2000);

    showToast('Report downloaded successfully!', 'success');
  } catch (err) {
    showToast(err.message || 'Export download failed.', 'error');
  }
}

function exportMonthlyCSV() {
  triggerRangeExport();
}

function syncMonthToExportRange(monthStr) {
  if (!monthStr) return;
  const parts = monthStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);

  const firstDay = `${monthStr}-01`;
  const lastDayObj = new Date(year, month, 0);
  const lastDay = lastDayObj.toISOString().substring(0, 10);

  document.getElementById('exportStartDate').value = firstDay;
  document.getElementById('exportEndDate').value = lastDay;

  document.getElementById('historyStartDate').value = firstDay;
  document.getElementById('historyEndDate').value = lastDay;

  fetchRangeReportData();
}

function syncCurrentMonthExport() {
  const today = new Date();
  const monthStr = today.toISOString().substring(0, 7);
  const monthInput = document.getElementById('reportMonth');
  if (monthInput) monthInput.value = monthStr;
  syncMonthToExportRange(monthStr);
}

function downloadMonthlyStatement() {
  const monthInput = document.getElementById('reportMonth');
  const monthStr = monthInput ? monthInput.value : '';
  if (monthStr) {
    syncMonthToExportRange(monthStr);
  }
  triggerRangeExport();
}

async function sendRangeEmailReport() {
  const sDate = document.getElementById('exportStartDate').value;
  const eDate = document.getElementById('exportEndDate').value;

  const user = getCurrentUser();
  const defaultEmail = (user && user.email) ? user.email : '';
  const email = prompt("Enter recipient email address for the attendance statement:", defaultEmail);
  if (!email || !email.trim()) return;

  try {
    const res = await fetch('/api/reports/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({
        recipient_email: email.trim(),
        month: sDate.substring(0, 7),
        custom_notes: `Date range statement from ${sDate} to ${eDate}`
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to send email report');

    showToast(data.message, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
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
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icon = type === 'error' ? 'fa-triangle-exclamation' : (type === 'success' ? 'fa-circle-check' : 'fa-circle-info');
  toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
