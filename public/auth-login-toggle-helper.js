const authFormElement = document.querySelector('#authForm');
const authCardElement = authFormElement?.closest('.auth-card');

if (authFormElement && authCardElement) {
  const modeButton = document.createElement('button');
  modeButton.type = 'button';
  modeButton.className = 'ghost-btn';
  modeButton.style.marginTop = '12px';
  modeButton.style.width = '100%';

  const updateModeButton = () => {
    modeButton.textContent = state.needsRegistration
      ? 'Mam już konto — przejdź do logowania'
      : 'Nie mam konta — przejdź do rejestracji';
  };

  modeButton.addEventListener('click', () => {
    state.needsRegistration = !state.needsRegistration;
    showAuth(state.needsRegistration);
    updateModeButton();
  });

  authCardElement.appendChild(modeButton);
  updateModeButton();

  const titleObserver = new MutationObserver(updateModeButton);
  const titleElement = document.querySelector('#authTitle');
  if (titleElement) titleObserver.observe(titleElement, { childList: true, subtree: true });

  authFormElement.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();

    const submitButton = document.querySelector('#authSubmit');
    const username = document.querySelector('#authUsername')?.value.trim() ?? '';
    const passwordInput = document.querySelector('#authPassword');
    const password = passwordInput?.value ?? '';
    const registering = state.needsRegistration;
    const endpoint = registering ? '/auth/register' : '/auth/login';

    if (submitButton) submitButton.disabled = true;

    try {
      const result = await api(endpoint, { method: 'POST', body: { username, password } });
      if (passwordInput) passwordInput.value = '';
      state.needsRegistration = false;
      state.user = result.user;
      showApp(result.user);
      toast(registering ? 'Administrator utworzony.' : 'Zalogowano.');
      await loadAll();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Uwierzytelnianie nie powiodło się.';
      if (registering && /already exists|już istnieje/i.test(message)) {
        state.needsRegistration = false;
        showAuth(false);
        updateModeButton();
        toast('Konto administratora już istnieje. Zaloguj się.');
      } else {
        toast(message);
      }
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }, true);
}
