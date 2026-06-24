(() => {
  const select = (selector) => document.querySelector(selector);

  function renderAuth(needsRegistration) {
    select('#appShell')?.classList.add('hidden');
    select('#authScreen')?.classList.remove('hidden');
    const title = select('#authTitle');
    const subtitle = select('#authSubtitle');
    const description = select('#authDescription');
    const submit = select('#authSubmit');
    const password = select('#authPassword');
    if (title) title.textContent = needsRegistration ? 'Rejestracja administratora' : 'Logowanie administratora';
    if (subtitle) subtitle.textContent = needsRegistration ? 'Pierwsze uruchomienie' : 'Panel chroniony';
    if (description) description.textContent = needsRegistration
      ? 'Utwórz pierwsze konto administratora. Ten ekran pojawia się tylko przed pierwszą rejestracją.'
      : 'Zaloguj się, aby zarządzać panelem.';
    if (submit) submit.textContent = needsRegistration ? 'Zarejestruj' : 'Zaloguj';
    if (password) password.autocomplete = needsRegistration ? 'new-password' : 'current-password';
    document.documentElement.dataset.authMode = needsRegistration ? 'register' : 'login';
  }

  function renderApp(user) {
    select('#authScreen')?.classList.add('hidden');
    select('#appShell')?.classList.remove('hidden');
    const label = select('#userLabel');
    if (label && user?.username) label.textContent = `Zalogowano: ${user.username}`;
  }

  async function request(path, options = {}) {
    const response = await fetch(path, {
      cache: 'no-store',
      credentials: 'same-origin',
      ...options,
      headers: options.body ? { 'content-type': 'application/json', ...(options.headers ?? {}) } : options.headers
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
    return payload;
  }

  async function bootstrap() {
    try {
      const status = await request(`/auth/status?_=${Date.now()}`);
      if (status.authenticated) renderApp(status.user);
      else renderAuth(Boolean(status.needsRegistration));
    } catch (error) {
      const description = select('#authDescription');
      if (description) description.textContent = `Nie udało się sprawdzić statusu logowania: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    void bootstrap();

    const form = select('#authForm');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const registering = document.documentElement.dataset.authMode === 'register';
      const username = select('#authUsername')?.value.trim() ?? '';
      const passwordInput = select('#authPassword');
      const password = passwordInput?.value ?? '';
      const submit = select('#authSubmit');
      if (submit) submit.disabled = true;
      try {
        const result = await request(registering ? '/auth/register' : '/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, password })
        });
        if (passwordInput) passwordInput.value = '';
        renderApp(result.user);
        location.reload();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const description = select('#authDescription');
        if (registering && /already exists|już istnieje/i.test(message)) {
          renderAuth(false);
          if (description) description.textContent = 'Konto administratora już istnieje. Zaloguj się.';
        } else if (description) {
          description.textContent = message;
        }
      } finally {
        if (submit) submit.disabled = false;
      }
    }, true);
  });
})();
