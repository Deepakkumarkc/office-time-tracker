/* ==========================================================================
   WORKPULSE - TASK & ACTIVITY CONTROLLER (public/js/tasks.js)
   Manages Live Running Tasks, Retroactive Start, Manual Historical Tasks,
   Atomic Task Switching, Dynamic Categories, and Audit Trail Displays.
   ========================================================================== */

let activeTaskTimerInterval = null;
let currentActiveTaskData = null;
let selectedTaskCategory = 'Development';
let cachedTaskCategories = [
  'Development', 'Meeting', 'Email', 'Communication', 'Research',
  'Documentation', 'Support', 'Administration', 'Client Work',
  'Planning', 'Training', 'Review', 'Other'
];

/**
 * Fast Category Selection Pill for the Quick-Start Task Form
 */
function selectCategoryPill(category, pillElement) {
  selectedTaskCategory = category;
  const pills = document.querySelectorAll('.category-pill');
  pills.forEach(p => p.classList.remove('active'));
  if (pillElement) pillElement.classList.add('active');
}

/**
 * Prompts user for a custom category and adds it to the active pills list
 */
function promptCustomCategory() {
  const custom = prompt("Enter new custom category name (e.g. 'Product Planning', 'Architecture Review'):");
  if (!custom || !custom.trim()) return;

  const cleanCat = custom.trim();
  if (!cachedTaskCategories.includes(cleanCat)) {
    cachedTaskCategories.push(cleanCat);
  }
  selectedTaskCategory = cleanCat;
  renderCategoryPills(cachedTaskCategories, cleanCat);
}

/**
 * Renders dynamic category pills for the quick-input form
 */
function renderCategoryPills(categories, activeCategory = 'Development') {
  const container = document.getElementById('categoryPillsContainer');
  if (!container) return;
  container.innerHTML = '';

  const catList = categories && categories.length > 0 ? categories : cachedTaskCategories;

  const categoryIcons = {
    'Development': 'fa-code',
    'Meeting': 'fa-users',
    'Email': 'fa-envelope',
    'Communication': 'fa-comments',
    'Research': 'fa-magnifying-glass',
    'Documentation': 'fa-file-lines',
    'Support': 'fa-headset',
    'Administration': 'fa-folder-gear',
    'Client Work': 'fa-briefcase',
    'Planning': 'fa-calendar-check',
    'Training': 'fa-graduation-cap',
    'Review': 'fa-clipboard-check',
    'Other': 'fa-list-check'
  };

  // Render top 8 categories
  catList.slice(0, 9).forEach(cat => {
    const icon = categoryIcons[cat] || 'fa-tag';
    const pill = document.createElement('div');
    pill.className = `category-pill ${cat === activeCategory ? 'active' : ''}`;
    pill.innerHTML = `<i class="fa-solid ${icon}"></i> ${cat}`;
    pill.onclick = () => selectCategoryPill(cat, pill);
    container.appendChild(pill);
  });

  // Custom Category Adder Pill
  const customPill = document.createElement('div');
  customPill.className = 'category-pill';
  customPill.style.borderColor = 'rgba(99, 102, 241, 0.4)';
  customPill.style.color = 'var(--accent-primary)';
  customPill.innerHTML = `<i class="fa-solid fa-plus"></i> Custom`;
  customPill.onclick = promptCustomCategory;
  container.appendChild(customPill);
}

/**
 * Starts a new live task using the fast input box
 */
async function startNewTask() {
  const titleInput = document.getElementById('taskTitleInput');
  const descInput = document.getElementById('taskDescInput');
  const dateInput = document.getElementById('selectedDate');

  const title = titleInput ? titleInput.value.trim() : '';
  const description = descInput ? descInput.value.trim() : '';
  const date = dateInput ? dateInput.value : new Date().toISOString().substring(0, 10);

  if (!title) {
    showToast('Please enter what you are working on.', 'error');
    if (titleInput) titleInput.focus();
    return;
  }

  // Pre-check if an active work session exists
  if (!window.isSessionActive) {
    showToast('Start your office presence session (or remote work session) before starting a task.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/tasks/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({
        title,
        category: selectedTaskCategory,
        description,
        date,
        start_time: new Date().toISOString(),
        switch_task: false
      })
    });

    const data = await res.json();

    if (res.status === 400 && data.can_switch) {
      openSwitchTaskModal(data.running_task, {
        title,
        category: selectedTaskCategory,
        description,
        date
      });
      return;
    }

    if (!res.ok) {
      throw new Error(data.message || 'Failed to start task');
    }

    if (titleInput) titleInput.value = '';
    if (descInput) descInput.value = '';

    showToast(data.message, 'success');
    fetchDashboardData();

  } catch (err) {
    showToast(err.message, 'error');
  }
}

/**
 * 1-Click Quick Resume from recent task chip
 */
async function resumeTask(taskTitle, taskCategory) {
  if (!window.isSessionActive) {
    showToast('Start your work session first before resuming a task.', 'error');
    return;
  }

  const dateInput = document.getElementById('selectedDate');
  const date = dateInput ? dateInput.value : new Date().toISOString().substring(0, 10);

  try {
    const res = await fetch('/api/tasks/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({
        title: taskTitle,
        category: taskCategory || 'Other',
        description: 'Quick resumed task',
        date,
        start_time: new Date().toISOString(),
        switch_task: true
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to resume task');

    showToast(data.message, 'success');
    fetchDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ==========================================================================
   MANUAL TASK MODAL CONTROLLER (Historical or Retroactive Live)
   ========================================================================== */

function openManualTaskModal() {
  const modal = document.getElementById('manualTaskModal');
  if (!modal) return;

  const dateInput = document.getElementById('selectedDate');
  const manualDateInput = document.getElementById('manualTaskDateInput');
  if (manualDateInput && dateInput) {
    manualDateInput.value = dateInput.value || new Date().toISOString().substring(0, 10);
  }

  // Populate Categories in dropdown
  const select = document.getElementById('manualTaskCategorySelect');
  if (select) {
    select.innerHTML = '';
    cachedTaskCategories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      if (cat === selectedTaskCategory) opt.selected = true;
      select.appendChild(opt);
    });
    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = '✏️ + Custom Category...';
    select.appendChild(customOpt);
  }

  // Default start time to now
  const startTimeInput = document.getElementById('manualTaskStartTimeInput');
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (startTimeInput) startTimeInput.value = timeStr;

  const stopTimeInput = document.getElementById('manualTaskStopTimeInput');
  if (stopTimeInput) stopTimeInput.value = '';

  const customCatInput = document.getElementById('manualTaskCustomCategoryInput');
  if (customCatInput) {
    customCatInput.style.display = 'none';
    customCatInput.value = '';
  }

  modal.classList.add('open');
  const titleInput = document.getElementById('manualTaskTitleInput');
  if (titleInput) {
    titleInput.value = '';
    setTimeout(() => titleInput.focus(), 150);
  }
}

function closeManualTaskModal() {
  const modal = document.getElementById('manualTaskModal');
  if (modal) modal.classList.remove('open');
}

function onManualCategoryChange(val) {
  const customInput = document.getElementById('manualTaskCustomCategoryInput');
  if (!customInput) return;
  if (val === '__custom__') {
    customInput.style.display = 'block';
    customInput.focus();
  } else {
    customInput.style.display = 'none';
  }
}

async function submitManualTask() {
  const title = document.getElementById('manualTaskTitleInput').value.trim();
  const date = document.getElementById('manualTaskDateInput').value;
  const startTime = document.getElementById('manualTaskStartTimeInput').value;
  const stopTime = document.getElementById('manualTaskStopTimeInput').value;
  const description = document.getElementById('manualTaskDescInput').value.trim();
  const categorySelect = document.getElementById('manualTaskCategorySelect');
  const customCatInput = document.getElementById('manualTaskCustomCategoryInput');

  let category = categorySelect ? categorySelect.value : 'Other';
  if (category === '__custom__') {
    category = customCatInput && customCatInput.value.trim() ? customCatInput.value.trim() : 'Other';
  }

  if (!title) {
    showToast('Task title is required.', 'error');
    return;
  }
  if (!startTime) {
    showToast('Start time is required.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/tasks/manual', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({
        title,
        category,
        date,
        start_time: startTime,
        stop_time: stopTime || null,
        description,
        switch_task: true
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to save manual task');

    closeManualTaskModal();
    showToast(data.message, 'success');
    fetchDashboardData();

  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ==========================================================================
   SWITCH TASK MODAL CONTROLLER
   ========================================================================== */

let pendingSwitchData = null;

function openSwitchTaskModal(runningTask, newTaskData) {
  const modal = document.getElementById('switchTaskModal');
  if (!modal) return;

  pendingSwitchData = newTaskData;
  const currentTitleEl = document.getElementById('switchCurrentTaskTitle');
  const newTitleEl = document.getElementById('switchNewTaskTitle');

  if (currentTitleEl) currentTitleEl.textContent = runningTask.title || 'Current Task';
  if (newTitleEl) newTitleEl.textContent = newTaskData.title || 'New Task';

  modal.classList.add('open');
}

function closeSwitchTaskModal() {
  const modal = document.getElementById('switchTaskModal');
  if (modal) modal.classList.remove('open');
  pendingSwitchData = null;
}

async function confirmSwitchTask() {
  if (!pendingSwitchData) return;

  try {
    const res = await fetch('/api/tasks/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({
        ...pendingSwitchData,
        start_time: new Date().toISOString(),
        switch_task: true
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to switch task');

    closeSwitchTaskModal();
    showToast(data.message, 'success');

    const titleInput = document.getElementById('taskTitleInput');
    const descInput = document.getElementById('taskDescInput');
    if (titleInput) titleInput.value = '';
    if (descInput) descInput.value = '';

    fetchDashboardData();

  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ==========================================================================
   STOP TASK MODAL CONTROLLER
   ========================================================================== */

function openStopTaskModal(taskId, taskTitle) {
  const modal = document.getElementById('stopTaskModal');
  if (!modal) return;

  const targetId = taskId || (currentActiveTaskData ? currentActiveTaskData.id : null);
  const targetTitle = taskTitle || (currentActiveTaskData ? currentActiveTaskData.title : 'Active Task');

  document.getElementById('stopTaskIdInput').value = targetId || '';
  document.getElementById('stopTaskTitleDisplay').textContent = targetTitle;
  document.getElementById('stopTaskNotesInput').value = '';

  modal.classList.add('open');
}

function closeStopTaskModal() {
  const modal = document.getElementById('stopTaskModal');
  if (modal) modal.classList.remove('open');
}

async function confirmStopTask() {
  const taskId = document.getElementById('stopTaskIdInput').value;
  const notes = document.getElementById('stopTaskNotesInput').value.trim();

  try {
    const res = await fetch('/api/tasks/stop', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({
        task_id: taskId ? parseInt(taskId, 10) : null,
        stop_time: new Date().toISOString(),
        notes
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to stop task');

    closeStopTaskModal();
    showToast(data.message, 'success');
    fetchDashboardData();

  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ==========================================================================
   EDIT TASK MODAL CONTROLLER
   ========================================================================== */

function openEditTaskModal(task) {
  const modal = document.getElementById('editTaskModal');
  if (!modal) return;

  document.getElementById('editTaskId').value = task.id;
  document.getElementById('editTaskTitleInput').value = task.title;
  document.getElementById('editTaskCategorySelect').value = task.category || 'Other';
  document.getElementById('editTaskDescriptionInput').value = task.description || '';

  const parseTime = (iso) => {
    if (!iso) return '';
    if (iso.includes('T')) return iso.split('T')[1].substring(0, 5);
    return iso.substring(0, 5);
  };

  document.getElementById('editTaskStartTimeInput').value = parseTime(task.start_time);
  document.getElementById('editTaskStopTimeInput').value = parseTime(task.stop_time);

  modal.classList.add('open');
}

function closeEditTaskModal() {
  const modal = document.getElementById('editTaskModal');
  if (modal) modal.classList.remove('open');
}

async function confirmEditTask() {
  const taskId = document.getElementById('editTaskId').value;
  const title = document.getElementById('editTaskTitleInput').value.trim();
  const category = document.getElementById('editTaskCategorySelect').value;
  const startTime = document.getElementById('editTaskStartTimeInput').value;
  const stopTime = document.getElementById('editTaskStopTimeInput').value;
  const description = document.getElementById('editTaskDescriptionInput').value.trim();

  if (!title) {
    showToast('Task title cannot be empty.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/tasks/edit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({
        task_id: parseInt(taskId, 10),
        title,
        category,
        start_time: startTime,
        stop_time: stopTime,
        description
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to update task');

    closeEditTaskModal();
    showToast(data.message, 'success');
    fetchDashboardData();

  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteTask(taskId, taskTitle) {
  if (!confirm(`Are you sure you want to delete task "${taskTitle}"?`)) return;

  try {
    const res = await fetch('/api/tasks/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({ task_id: taskId })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to delete task');

    showToast(data.message, 'success');
    fetchDashboardData();

  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ==========================================================================
   UI RENDERING FOR TASKS & ACTIVE TASK HERO
   ========================================================================== */

function renderTasksUI(tasks, activeTask, totalTaskSeconds, categoryBreakdown, totalSessionSeconds) {
  currentActiveTaskData = activeTask;

  // 1. Render Active Task Hero Banner
  const heroBanner = document.getElementById('activeTaskBanner');
  const heroTitle = document.getElementById('activeTaskTitle');
  const heroCat = document.getElementById('activeTaskCategory');
  const heroDesc = document.getElementById('activeTaskDesc');

  if (activeTask && activeTask.status === 'IN_PROGRESS') {
    if (heroBanner) heroBanner.style.display = 'flex';
    if (heroTitle) heroTitle.textContent = activeTask.title;
    if (heroCat) heroCat.textContent = activeTask.category || 'Other';
    if (heroDesc) heroDesc.textContent = activeTask.description ? `— ${activeTask.description}` : '';

    startActiveTaskTicker(activeTask.start_time);
  } else {
    if (heroBanner) heroBanner.style.display = 'none';
    stopActiveTaskTicker();
  }

  // 2. Render Dynamic Category Pills in Quick Start
  renderCategoryPills(cachedTaskCategories, selectedTaskCategory);

  // 3. Render Detailed Tasks in Secondary Tab
  renderTasksTable(tasks);
}

function startActiveTaskTicker(startTimeIso) {
  stopActiveTaskTicker();
  if (!startTimeIso) return;

  const timerDisplay = document.getElementById('activeTaskTimerDisplay');
  if (!timerDisplay) return;

  const startMs = new Date(startTimeIso).getTime();

  function tick() {
    const nowMs = Date.now();
    const elapsedSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));

    const h = Math.floor(elapsedSec / 3600);
    const m = Math.floor((elapsedSec % 3600) / 60);
    const s = elapsedSec % 60;

    timerDisplay.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  tick();
  activeTaskTimerInterval = setInterval(tick, 1000);
}

function stopActiveTaskTicker() {
  if (activeTaskTimerInterval) {
    clearInterval(activeTaskTimerInterval);
    activeTaskTimerInterval = null;
  }
}

function renderTasksTable(tasks) {
  const tbody = document.getElementById('tasksTableBody');
  const emptyState = document.getElementById('emptyTasksState');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!tasks || tasks.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  tasks.forEach((t, idx) => {
    const tr = document.createElement('tr');

    const startFmt = formatTimeStr(t.start_time);
    const stopFmt = t.stop_time ? formatTimeStr(t.stop_time) : '<em>Running...</em>';
    const durFmt = t.stop_time ? formatDurationStr(t.duration_seconds) : '---';

    let statusBadge = '';
    if (t.status === 'IN_PROGRESS') {
      statusBadge = '<span class="badge badge-active"><i class="fa-solid fa-spinner fa-spin"></i> Active</span>';
    } else if (t.status === 'AUTO_CUTOFF') {
      statusBadge = '<span class="badge badge-autocutoff"><i class="fa-solid fa-triangle-exclamation"></i> Auto Cutoff</span>';
    } else {
      statusBadge = '<span class="badge badge-success">Completed</span>';
    }

    // Check for audit trail notes
    const isAutoSync = t.description && (t.description.includes('Auto-ended') || t.description.includes('Auto-trimmed') || t.description.includes('Auto-adjusted') || t.description.includes('Auto-stopped'));
    const auditBadge = isAutoSync ? '<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-size: 0.7rem; margin-left: 0.35rem;" title="Automatically synchronized with parent session"><i class="fa-solid fa-arrows-rotate"></i> Synchronized</span>' : '';

    const taskObjJson = JSON.stringify(t).replace(/"/g, '&quot;');

    tr.innerHTML = `
      <td><strong>${idx + 1}</strong></td>
      <td>
        <strong style="color: var(--text-main); font-size: 0.88rem;">${t.title}</strong>
        ${auditBadge}
        ${t.description ? `<div style="font-size: 0.74rem; color: var(--text-muted); margin-top: 1px;"><i class="fa-regular fa-comment"></i> ${t.description}</div>` : ''}
      </td>
      <td><span class="category-badge">${t.category || 'Other'}</span></td>
      <td>${startFmt}</td>
      <td>${stopFmt}</td>
      <td><strong>${durFmt}</strong></td>
      <td>${statusBadge}</td>
      <td>
        <div style="display: flex; gap: 0.3rem;">
          <button class="btn-action-icon" style="color: #60a5fa;" onclick="openEditTaskModal(${taskObjJson})" title="Edit Task">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn-action-icon" style="color: #ef4444;" onclick="deleteTask(${t.id}, '${t.title.replace(/'/g, "\\'")}')" title="Delete Task">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/* ==========================================================================
   TIMELINE RENDERER WITH COMBINED SESSIONS & TASKS
   ========================================================================== */

function renderActivityTimeline(events) {
  const container = document.getElementById('activityTimelineContainer');
  const emptyState = document.getElementById('emptyTimelineState');
  if (!container) return;
  container.innerHTML = '';

  if (!events || events.length === 0) {
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  const tree = document.createElement('div');
  tree.className = 'timeline-tree';

  events.forEach(ev => {
    const item = document.createElement('div');
    item.className = 'timeline-item';

    const timeFmt = formatTimeStr(ev.timestamp);

    let markerBg = '#6366f1';
    let iconClass = 'fa-solid fa-list-check';
    let typeLabel = 'Task Activity';

    if (ev.type === 'OFFICE_START') {
      markerBg = '#10b981';
      iconClass = 'fa-solid fa-building-circle-check';
      typeLabel = `${ev.mode || 'Office'} Session Started`;
    } else if (ev.type === 'OFFICE_STOP') {
      markerBg = '#f59e0b';
      iconClass = 'fa-solid fa-circle-pause';
      typeLabel = `Session End / Break (${ev.reason || 'Completed'})`;
    }

    let durHtml = ev.duration_formatted ? `<span class="badge badge-secondary" style="font-size: 0.72rem; font-weight: 600;"><i class="fa-regular fa-clock"></i> ${ev.duration_formatted}</span>` : '';
    let catHtml = ev.category ? `<span class="category-badge" style="font-size: 0.7rem;">${ev.category}</span>` : '';

    item.innerHTML = `
      <div class="timeline-marker" style="background: ${markerBg};">
        <i class="${iconClass}"></i>
      </div>
      <div class="timeline-content">
        <div class="timeline-header">
          <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
            <strong class="timeline-title">${ev.title}</strong>
            ${catHtml}
          </div>
          <span class="timeline-time">${timeFmt}</span>
        </div>
        ${ev.description ? `<div class="timeline-desc" style="font-size: 0.76rem; color: var(--text-muted);"><i class="fa-regular fa-comment-dots"></i> ${ev.description}</div>` : ''}
        ${durHtml ? `<div style="margin-top: 0.3rem;">${durHtml}</div>` : ''}
      </div>
    `;

    tree.appendChild(item);
  });

  container.appendChild(tree);
}
