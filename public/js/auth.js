/* ==========================================================================
   AUTHENTICATION & USER STATE CONTROLLER
   ========================================================================== */

let currentAuthMode = 'login'; // 'login', 'register', or 'reset'

function switchAuthTab(mode) {
  currentAuthMode = mode;
  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  const tabReset = document.getElementById('tabReset');
  
  const nameGroup = document.getElementById('nameGroup');
  const passwordGroup = document.getElementById('passwordGroup');
  const confirmPasswordGroup = document.getElementById('confirmPasswordGroup');
  const forgotPasswordLink = document.getElementById('forgotPasswordLink');
  const passwordLabel = document.getElementById('passwordLabel');

  const authTitle = document.getElementById('authTitle');
  const authSubtitle = document.getElementById('authSubtitle');
  const authSubmitBtn = document.getElementById('authSubmitBtn');

  // Reset tab active states
  tabLogin.classList.remove('active');
  tabRegister.classList.remove('active');
  tabReset.classList.remove('active');

  if (mode === 'register') {
    tabRegister.classList.add('active');
    nameGroup.style.display = 'block';
    confirmPasswordGroup.style.display = 'none';
    forgotPasswordLink.style.display = 'none';
    passwordLabel.textContent = 'Password';
    authTitle.textContent = 'Create an Account';
    authSubtitle.textContent = 'Register with your @sagitec.com email to start tracking';
    authSubmitBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Register Account';
    document.getElementById('authEmail').placeholder = 'e.g. name@sagitec.com';
  } else if (mode === 'reset') {
    tabReset.classList.add('active');
    nameGroup.style.display = 'none';
    confirmPasswordGroup.style.display = 'block';
    forgotPasswordLink.style.display = 'none';
    passwordLabel.textContent = 'New Password';
    authTitle.textContent = 'Reset Password';
    authSubtitle.textContent = 'Enter your registered email and choose a new password';
    authSubmitBtn.innerHTML = '<i class="fa-solid fa-key"></i> Reset Password';
    document.getElementById('authEmail').placeholder = 'e.g. name@sagitec.com';
  } else {
    tabLogin.classList.add('active');
    nameGroup.style.display = 'none';
    confirmPasswordGroup.style.display = 'none';
    forgotPasswordLink.style.display = 'inline';
    passwordLabel.textContent = 'Password';
    authTitle.textContent = 'Welcome Back';
    authSubtitle.textContent = 'Log in to track your office attendance & working hours';
    authSubmitBtn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> Sign In';
    document.getElementById('authEmail').placeholder = 'e.g. deepak@office.com or name@sagitec.com';
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const name = document.getElementById('regName').value.trim();

  if (!email || !password) {
    showToast('Please enter both email and password.', 'error');
    return;
  }

  // Enforce @sagitec.com domain for registration
  if (currentAuthMode === 'register' && !email.toLowerCase().endsWith('@sagitec.com')) {
    showToast('Registration is restricted to official @sagitec.com email addresses.', 'error');
    return;
  }

  // Handle Reset Password Mode
  if (currentAuthMode === 'reset') {
    const confirmPass = document.getElementById('confirmPassword').value;
    if (password !== confirmPass) {
      showToast('New passwords do not match.', 'error');
      return;
    }

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, new_password: password })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Password reset failed');

      showToast(data.message || 'Password reset successful!', 'success');
      
      // Clear password fields and switch back to login tab
      document.getElementById('authPassword').value = '';
      document.getElementById('confirmPassword').value = '';
      switchAuthTab('login');

    } catch (err) {
      showToast(err.message, 'error');
    }
    return;
  }

  // Handle Login or Register Mode
  const endpoint = currentAuthMode === 'register' ? '/api/auth/register' : '/api/auth/login';
  const payload = currentAuthMode === 'register' ? { name, email, password } : { email, password };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || 'Authentication failed');
    }

    showToast(data.message || 'Successfully authenticated!', 'success');
    
    // Save authentication details
    localStorage.setItem('office_tracker_token', data.token);
    localStorage.setItem('office_tracker_user', JSON.stringify(data.user));

    checkAuthState();
    fetchDashboardData();

  } catch (err) {
    showToast(err.message, 'error');
  }
}

function getCurrentUser() {
  const userStr = localStorage.getItem('office_tracker_user');
  return userStr ? JSON.parse(userStr) : null;
}

function getAuthHeader() {
  const token = localStorage.getItem('office_tracker_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

function logoutUser() {
  localStorage.removeItem('office_tracker_token');
  localStorage.removeItem('office_tracker_user');
  stopLiveTimerInterval();
  showToast('Logged out successfully', 'success');
  checkAuthState();
}

function checkAuthState() {
  const token = localStorage.getItem('office_tracker_token');
  const user = getCurrentUser();

  const authScreen = document.getElementById('authScreen');
  const dashboardScreen = document.getElementById('dashboardScreen');
  const adminDashboardScreen = document.getElementById('adminDashboardScreen');
  const userProfileBadge = document.getElementById('userProfileBadge');
  const userNameDisplay = document.getElementById('userNameDisplay');
  const userAvatar = document.getElementById('userAvatar');

  if (token && user) {
    authScreen.style.display = 'none';
    userProfileBadge.style.display = 'flex';
    userNameDisplay.textContent = user.role === 'ADMIN' ? `${user.name} (Admin)` : (user.name || user.email);
    userAvatar.textContent = (user.name || user.email).charAt(0).toUpperCase();

    if (user.role === 'ADMIN') {
      dashboardScreen.style.display = 'none';
      adminDashboardScreen.style.display = 'block';
      fetchAdminOverviewData();
    } else {
      adminDashboardScreen.style.display = 'none';
      dashboardScreen.style.display = 'block';
      fetchDashboardData();
    }
  } else {
    authScreen.style.display = 'block';
    dashboardScreen.style.display = 'none';
    adminDashboardScreen.style.display = 'none';
    userProfileBadge.style.display = 'none';
  }
}


document.getElementById('btnLogout').addEventListener('click', logoutUser);
