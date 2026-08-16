/* ==========================================================================
   WORKPULSE - WORK / PRESENCE SESSION & TIMER CONTROLLER (public/js/timer.js)
   Handles Live Office/Remote Timers, Full Session Editing with Child Task
   Synchronization, Break Modals, and Accurate Duration Calculations.
   ========================================================================== */

let liveTimerInterval = null;
let currentActiveSessionData = null;
let selectedBreakReason = 'End of Workday';

/**
 * Starts the live UI ticker clock for active presence sessions
 */
function startLiveTimerInterval(startTimeIso) {
  stopLiveTimerInterval();
  if (!startTimeIso) return;

  const timerDisplay = document.getElementById('timerDisplay');
  if (!timerDisplay) return;

  const startMs = new Date(startTimeIso).getTime();

  function updateTick() {
    const nowMs = Date.now();
    const elapsedSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));

    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;

    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');

    timerDisplay.textContent = `${hh}:${mm}:${ss}`;
  }

  updateTick();
  liveTimerInterval = setInterval(updateTick, 1000);
}

function stopLiveTimerInterval() {
  if (liveTimerInterval) {
    clearInterval(liveTimerInterval);
    liveTimerInterval = null;
  }
  const timerDisplay = document.getElementById('timerDisplay');
  if (timerDisplay) {
    timerDisplay.textContent = "00:00:00";
  }
}

/**
 * Starts an Office or Remote work session
 */
async function startTimerSession() {
  const selectedDateInput = document.getElementById('selectedDate');
  const selectedDate = selectedDateInput ? selectedDateInput.value : new Date().toISOString().substring(0, 10);
  
  const modeSelect = document.getElementById('workModeSelect');
  const workMode = modeSelect ? modeSelect.value : (currentWorkMode || 'Office');

  const nowIso = new Date().toISOString();

  try {
    const res = await fetch('/api/sessions/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({
        date: selectedDate,
        work_mode: workMode,
        start_time: nowIso
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to start session');

    showToast(data.message, 'success');
    fetchDashboardData();

  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ==========================================================================
   BREAK / STOP SESSION MODAL CONTROLLER
   ========================================================================== */

function openBreakModal() {
  const modal = document.getElementById('breakReasonModal');
  if (!modal) return;

  const activeTaskWarn = document.getElementById('sessionActiveTaskWarning');
  const activeTaskName = document.getElementById('sessionActiveTaskName');
  if (activeTaskWarn && activeTaskName) {
    if (currentActiveTaskData && currentActiveTaskData.title) {
      activeTaskName.textContent = currentActiveTaskData.title;
      activeTaskWarn.style.display = 'flex';
    } else {
      activeTaskWarn.style.display = 'none';
    }
  }

  const customGroup = document.getElementById('customReasonGroup');
  const customInput = document.getElementById('customReasonInput');
  const notesInput = document.getElementById('sessionNotesInput');

  if (customGroup) customGroup.style.display = 'none';
  if (customInput) customInput.value = '';
  if (notesInput) notesInput.value = '';

  selectReasonPill('Lunch Break');
  modal.classList.add('open');
}

function closeBreakModal() {
  const modal = document.getElementById('breakReasonModal');
  if (modal) modal.classList.remove('open');
}

function selectReasonPill(reasonText, pillElement) {
  selectedBreakReason = reasonText;

  const pills = document.querySelectorAll('.reason-pill');
  pills.forEach(p => p.classList.remove('active'));

  if (pillElement) {
    pillElement.classList.add('active');
  } else {
    pills.forEach(p => {
      if (p.textContent.trim().includes(reasonText)) {
        p.classList.add('active');
      }
    });
  }

  const customGroup = document.getElementById('customReasonGroup');
  if (customGroup) {
    customGroup.style.display = (reasonText === 'Other') ? 'block' : 'none';
    if (reasonText === 'Other') {
      const input = document.getElementById('customReasonInput');
      if (input) input.focus();
    }
  }
}

async function confirmStopSession() {
  let breakReason = selectedBreakReason;
  if (breakReason === 'Other') {
    const customInput = document.getElementById('customReasonInput');
    breakReason = customInput && customInput.value.trim() ? customInput.value.trim() : 'Other Break';
  }

  const notesInput = document.getElementById('sessionNotesInput');
  const notes = notesInput ? notesInput.value.trim() : '';

  try {
    const res = await fetch('/api/sessions/stop', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({
        stop_time: new Date().toISOString(),
        break_reason: breakReason,
        notes: notes
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to stop session');

    closeBreakModal();
    showToast(data.message, 'success');

    if (data.auto_stopped_task) {
      setTimeout(() => {
        showToast(`Task '${data.auto_stopped_task.title}' automatically completed (${data.auto_stopped_task.duration_formatted})`, 'info');
      }, 800);
    }

    fetchDashboardData();

  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ==========================================================================
   FULL SESSION EDIT MODAL (LIVE OR COMPLETED WITH RECONCILIATION)
   ========================================================================== */

function openActiveSessionEditModal() {
  if (!currentActiveSessionData) {
    showToast('No active session to edit.', 'error');
    return;
  }
  openEditFullSessionModal(
    currentActiveSessionData.id,
    currentActiveSessionData.start_time,
    currentActiveSessionData.stop_time,
    currentActiveSessionData.break_reason || 'End of Workday',
    currentActiveSessionData.notes || '',
    currentActiveSessionData.work_mode || 'Remote',
    currentActiveSessionData.date
  );
}

function openEditFullSessionModal(sessionId, startTime, stopTime, reason, notes, workMode, date) {
  const modal = document.getElementById('editFullSessionModal');
  if (!modal) return;

  document.getElementById('editSessionFullId').value = sessionId;
  
  const parseTime = (iso) => {
    if (!iso) return '';
    if (iso.includes('T')) return iso.split('T')[1].substring(0, 5);
    return iso.substring(0, 5);
  };

  const selectedDateInput = document.getElementById('selectedDate');
  document.getElementById('editSessionDateInput').value = date || (selectedDateInput ? selectedDateInput.value : new Date().toISOString().substring(0, 10));
  document.getElementById('editSessionStartTimeInput').value = parseTime(startTime);
  document.getElementById('editSessionStopTimeInput').value = parseTime(stopTime);
  
  const reasonSelect = document.getElementById('editSessionBreakReasonSelect');
  if (reasonSelect) reasonSelect.value = reason || 'End of Workday';

  document.getElementById('editSessionNotesInput').value = notes || '';

  modal.classList.add('open');
}

function closeEditFullSessionModal() {
  const modal = document.getElementById('editFullSessionModal');
  if (modal) modal.classList.remove('open');
}

async function confirmEditFullSession() {
  const sessionId = document.getElementById('editSessionFullId').value;
  const date = document.getElementById('editSessionDateInput').value;
  const startTime = document.getElementById('editSessionStartTimeInput').value;
  const stopTime = document.getElementById('editSessionStopTimeInput').value;
  const breakReason = document.getElementById('editSessionBreakReasonSelect').value;
  const notes = document.getElementById('editSessionNotesInput').value.trim();

  if (!sessionId) {
    showToast('Session ID is required.', 'error');
    return;
  }
  if (!startTime) {
    showToast('Start time is required.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/sessions/edit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({
        session_id: parseInt(sessionId, 10),
        date,
        start_time: startTime,
        stop_time: stopTime || null,
        break_reason: breakReason,
        notes: notes
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to edit session');

    closeEditFullSessionModal();
    showToast(data.message, 'success');

    if (data.reconciled_tasks && data.reconciled_tasks.length > 0) {
      setTimeout(() => {
        showToast(`Synchronized ${data.reconciled_tasks.length} related task(s) to match new session time!`, 'info');
      }, 700);
    }

    fetchDashboardData();

  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ==========================================================================
   LEGACY EDIT STOP TIME MODAL CONTROLLER (Preserved for compatibility)
   ========================================================================== */

function openEditStopTimeModal(sessionId, startTimeStr, stopTimeStr, breakReason, notes) {
  openEditFullSessionModal(sessionId, startTimeStr, stopTimeStr, breakReason, notes, 'Office', null);
}

function closeEditStopTimeModal() {
  closeEditFullSessionModal();
}

function confirmEditStopTime() {
  confirmEditFullSession();
}
