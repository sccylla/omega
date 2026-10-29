'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const form = $('owner-login');
  const password = $('password');
  const submit = $('login-submit');
  const message = $('login-message');
  const loggedIn = $('logged-in');
  function notice(text, good=false) {
    message.textContent = text;
    message.className = 'message' + (good ? ' ok' : '');
    message.hidden = false;
  }
  async function brokerSession(action, body) {
    const options = { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: {'X-Omega-Request':'1'}};
    if (body) {options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body);}
    const response = await fetch('/api/demo?action=' + encodeURIComponent(action), options);
    const data = await response.json().catch(() => ({error:'Authentication service returned an invalid response'}));
    if (!response.ok) throw new Error(data.error || 'Authentication could not be completed');
    return data;
  }
  function setSignedIn(value) {
    form.hidden = value;
    loggedIn.hidden = !value;
    if (value) message.hidden = true;
  }
  $('show-password').addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    $('show-password').textContent = show ? 'Hide' : 'Show';
    $('show-password').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const pass = password.value;
    if (!pass) return notice('Enter your dashboard password.');
    submit.disabled = true;
    submit.textContent = 'Signing in securely…';
    message.hidden = true;
    try {
      const response = await brokerSession('login', {password: pass});
      password.value = '';
      if (!response.authenticated) throw new Error('Could not verify the session.');
      setSignedIn(true);
      location.assign('/#connections');
    } catch (error) {
      notice(error.message);
    } finally {
      submit.disabled = false;
      submit.textContent = 'Sign in securely →';
    }
  });
  $('logout').addEventListener('click', async () => {
    try {
      await brokerSession('logout', {});
      setSignedIn(false);
      password.value = '';
      notice('Signed out securely.',true);
    } catch (error) { notice(error.message); }
  });
  brokerSession('status').then(data => {
    if (!data.passwordConfigured) notice('Dashboard authentication has not been set up correctly. Check OMEGA_DASHBOARD_PASSWORD and OMEGA_SESSION_SECRET in Vercel.');
    setSignedIn(!!data.authenticated);
  }).catch(error => notice('Unable to check login status: ' + error.message));
})();
