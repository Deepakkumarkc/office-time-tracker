/* ==========================================================================
   LIVE TIMER & BREAK REASON MODAL CONTROLLER
   ========================================================================== */

let activeTimerInterval = null;
let activeSessionStartTime = null;
let selectedBreakReason = 'Lunch Break';

function formatSecondsToHMS(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (num) => String(num).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function startLiveTimerInterval(startTimeISO) {
  stopLiveTimerInterval();
  activeSessionStartTime = new Date(startTimeISO).getTime();

  function updateDisplay() {
    const now = new Date().getTime();
    const elapsedSeconds = Math.max(0, Math.floor((now - activeSessionStartTime) / 1000));
    document.getElementById('timerDisplay').textContent = formatSecondsToHMS(elapsedSeconds);
  }

  updateDisplay();
  activeTimerInterval = setInterval(updateDisplay, 1000);
}

function stopLiveTimerInterval() {
  if (activeTimerInterval) {
    clearInterval(activeTimerInterval);
    activeTimerInterval = null;
  }
  activeSessionStartTime = null;
  document.getElementById('timerDisplay').textContent = '00:00:00';
}

/* Modal Open & Selection Handlers */

function openBreakModal() {
  const modal = document.getElementById('breakReasonModal');
  modal.classList.add('open');
}

function closeBreakModal() {
  const modal = document.getElementById('breakReasonModal');
  modal.classList.remove('open');
}

function selectReasonPill(reason, el) {
  selectedBreakReason = reason;

  // Toggle active class on pills
  const pills = document.querySelectorAll('.reason-pill');
  pills.forEach(p => p.classList.remove('active'));
  el.classList.add('active');

  // Show/Hide custom reason input
  const customGroup = document.getElementById('customReasonGroup');
  if (reason === 'Other') {
    customGroup.style.display = 'block';
    document.getElementById('customReasonInput').focus();
  } else {
    customGroup.style.display = 'none';
  }
}

async function startTimerSession() {
  const selectedDate = document.getElementById('selectedDate').value;
  const workMode = document.getElementById('workModeSelect').value;

  if (!selectedDate) {
    showToast('Please select a valid date.', 'error');
    return;
  }

  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (selectedDate < today) {
    showToast('Cannot start timer for a past date.', 'error');
    return;
  }

  if (workMode !== 'Office') {
    showToast('Please select "Office Mode" to start an in-office session timer.', 'error');
    return;
  }

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
        start_time: new Date().toISOString()
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to start session');

    showToast('Session started! You are logged as IN OFFICE.', 'success');
    fetchDashboardData();

  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function confirmStopSession() {
  const selectedDate = document.getElementById('selectedDate').value;
  let finalReason = selectedBreakReason;

  if (selectedBreakReason === 'Other') {
    const customText = document.getElementById('customReasonInput').value.trim();
    if (!customText) {
      showToast('Please specify a custom reason.', 'error');
      return;
    }
    finalReason = customText;
  }

  const notes = document.getElementById('sessionNotesInput').value.trim();

  try {
    const res = await fetch('/api/sessions/stop', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({
        date: selectedDate,
        stop_time: new Date().toISOString(),
        break_reason: finalReason,
        notes: notes
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to stop session');

    closeBreakModal();
    showToast(`Session stopped! Reason: ${finalReason} (${data.duration_formatted || 'recorded'})`, 'success');
    
    // Reset modal form
    document.getElementById('customReasonInput').value = '';
    document.getElementById('sessionNotesInput').value = '';

    fetchDashboardData();

  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* Edit Stop Time Modal Handlers */

function openEditStopTimeModal(sessionId, startTimeIso, stopTimeIso, reason, notes) {
  document.getElementById('editSessionId').value = sessionId;

  const startDt = new Date(startTimeIso);
  document.getElementById('editSessionStartDisplay').textContent = startDt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (' + startTimeIso.substring(0, 10) + ')';

  let defaultTimeStr = '';
  if (stopTimeIso) {
    const stopDt = new Date(stopTimeIso);
    const h = String(stopDt.getHours()).padStart(2, '0');
    const m = String(stopDt.getMinutes()).padStart(2, '0');
    defaultTimeStr = `${h}:${m}`;
  } else {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    defaultTimeStr = `${h}:${m}`;
  }
  document.getElementById('editStopTimeInput').value = defaultTimeStr;

  const reasonSelect = document.getElementById('editBreakReasonSelect');
  if (reason) {
    const matchedOption = Array.from(reasonSelect.options).find(opt => opt.value === reason);
    if (matchedOption) {
      reasonSelect.value = reason;
    } else {
      reasonSelect.value = 'Other';
    }
  } else {
    reasonSelect.value = 'End of Workday';
  }

  document.getElementById('editNotesInput').value = notes || '';

  const modal = document.getElementById('editStopTimeModal');
  modal.classList.add('open');
}

function closeEditStopTimeModal() {
  const modal = document.getElementById('editStopTimeModal');
  modal.classList.remove('open');
}

async function confirmEditStopTime() {
  const sessionId = document.getElementById('editSessionId').value;
  const timeVal = document.getElementById('editStopTimeInput').value;
  const reasonVal = document.getElementById('editBreakReasonSelect').value;
  const notesVal = document.getElementById('editNotesInput').value.trim();

  if (!sessionId || !timeVal) {
    showToast('Please select a valid stop time.', 'error');
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
        stop_time: timeVal,
        break_reason: reasonVal,
        notes: notesVal
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to update stop time');

    closeEditStopTimeModal();
    showToast(data.message || 'Session stop time updated!', 'success');

    if (typeof fetchDashboardData === 'function') fetchDashboardData();
    if (typeof fetchAdminOverviewData === 'function' && document.getElementById('adminDashboardScreen').style.display !== 'none') {
      fetchAdminOverviewData();
    }

  } catch (err) {
    showToast(err.message, 'error');
  }
}
