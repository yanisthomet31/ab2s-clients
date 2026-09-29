document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('l-username').value.trim();
  const password = document.getElementById('l-password').value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Connexion…';
  const showError = msg => {
    errEl.textContent = msg;
    errEl.style.display = 'flex';
    btn.disabled = false;
    btn.textContent = 'Se connecter';
  };

  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (r.ok) {
      window.location.href = '/';
    } else {
      const data = await r.json().catch(() => ({}));
      showError(data.error || 'Identifiants incorrects');
    }
  } catch (err) {
    showError('Erreur de connexion au serveur');
  }
});
