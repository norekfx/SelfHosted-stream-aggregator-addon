(() => {
  const DELETE_BUTTON_SELECTOR = '[data-delete-addon]';
  const LIBRARY_VIEW_ID = 'library';

  function installDeleteButtons() {
    const rows = Array.from(document.querySelectorAll('#addonsList tbody tr'));
    for (const row of rows) {
      const actionCell = row.querySelector('td:last-child .action-row');
      if (!actionCell || actionCell.querySelector(DELETE_BUTTON_SELECTOR)) continue;

      const toggleButton = actionCell.querySelector('[data-toggle-addon]');
      if (!toggleButton || toggleButton.dataset.enabled !== 'true') continue;

      const addonId = toggleButton.dataset.toggleAddon;
      const name = row.querySelector('td:first-child strong')?.textContent?.trim() || 'addon';
      const button = document.createElement('button');
      button.className = 'small-btn disabled';
      button.type = 'button';
      button.textContent = 'Usuń';
      button.dataset.deleteAddon = addonId;
      button.dataset.addonName = name;
      actionCell.appendChild(button);
    }
  }

  async function deleteAddon(button) {
    const addonId = button.dataset.deleteAddon;
    const addonName = button.dataset.addonName || 'addon';
    if (!addonId) return;
    if (!confirm(`Usunąć wyłączony addon: ${addonName}?`)) return;

    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = 'Usuwam...';
    try {
      await apiRequest(`/admin/addons/${encodeURIComponent(addonId)}`, { method: 'DELETE' });
      showToast('Addon usunięty.');
      document.querySelector('#refreshBtn')?.click();
    } catch (error) {
      button.disabled = false;
      button.textContent = oldText;
      alert(error instanceof Error ? error.message : 'Nie udało się usunąć addonu.');
    }
  }

  function installLibraryPanel() {
    const nav = document.querySelector('.nav');
    const systemButton = document.querySelector('.nav-item[data-view="system"]');
    const main = document.querySelector('.main');
    if (!nav || !systemButton || !main || document.querySelector(`[data-view="${LIBRARY_VIEW_ID}"]`)) return;

    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.view = LIBRARY_VIEW_ID;
    button.textContent = 'Biblioteka';
    systemButton.after(button);

    const section = document.createElement('section');
    section.id = LIBRARY_VIEW_ID;
    section.className = 'view';
    section.innerHTML = `
      <article class="panel">
        <div class="panel-header"><h2>TMDB</h2></div>
        <form id="tmdbSettingsForm" class="settings-form single">
          <div class="panel-grid two">
            <label>TMDB API Key<input id="tmdbApiKey" placeholder="api_key" autocomplete="off" /></label>
            <label>TMDB Read Access Token<input id="tmdbReadAccessToken" placeholder="Bearer token v4" autocomplete="off" /></label>
            <label>Język TMDB<input id="tmdbLanguage" placeholder="pl-PL" /></label>
            <label>Region TMDB<input id="tmdbRegion" placeholder="PL" /></label>
          </div>
          <p class="hint">Wystarczy API Key albo Read Access Token. Token ma pierwszeństwo, jeśli wpiszesz oba.</p>
          <button class="primary-btn" type="submit">Zapisz TMDB</button>
        </form>
      </article>
      <article class="panel">
        <div class="panel-header"><h2>Dodaj bibliotekę Stremio</h2></div>
        <form id="libraryForm" class="settings-form single">
          <div class="panel-grid two">
            <label>Nazwa<input id="libraryName" required placeholder="Najnowsze filmy" /></label>
            <label>Slug / ID katalogu<input id="librarySlug" placeholder="najnowsze-filmy" /></label>
            <label>Typ<select id="libraryType"><option value="movie">movie</option><option value="series">series</option></select></label>
            <label>Tryb<select id="libraryMode"><option value="discover">Discover</option><option value="trending">Trending</option><option value="popular">Popular</option><option value="top_rated">Top rated</option><option value="now_playing">Now playing movie</option><option value="upcoming">Upcoming movie</option><option value="airing_today">Airing today series</option><option value="on_the_air">On the air series</option></select></label>
            <label>Sortowanie Discover<input id="librarySortBy" placeholder="popularity.desc" /></label>
            <label>Gatunki TMDB<input id="libraryGenres" placeholder="16 dla animacji/anime" /></label>
            <label>Słowa kluczowe TMDB<input id="libraryKeywords" placeholder="np. 210024" /></label>
            <label>Oryginalny język<input id="libraryOriginalLanguage" placeholder="ja, pl, en..." /></label>
            <label>Rok<input id="libraryYear" placeholder="2026" /></label>
            <label>Minimalna liczba głosów<input id="libraryVoteCount" type="number" min="0" placeholder="50" /></label>
            <label>Kolejność<input id="librarySortOrder" type="number" value="0" /></label>
            <label class="checkbox"><input id="libraryEnabled" type="checkbox" checked /> Włączona w Stremio</label>
          </div>
          <p class="hint">Po zapisaniu odśwież/zainstaluj manifest w Stremio. Pozycje z TMDB są mapowane na IMDb ID, żeby dalej działał istniejący agregator streamów.</p>
          <button class="primary-btn" type="submit">Dodaj bibliotekę</button>
        </form>
      </article>
      <article class="panel">
        <div class="panel-header"><h2>Biblioteki</h2><button id="reloadLibrariesBtn" class="ghost-btn">Odśwież</button></div>
        <div id="librariesList" class="table-wrap"><div class="list empty">Ładowanie...</div></div>
      </article>
      <article class="panel">
        <div class="panel-header"><h2>Test biblioteki</h2></div>
        <pre id="libraryTestOutput" class="code-box small">Wybierz „Test” przy bibliotece.</pre>
      </article>
    `;

    const settingsSection = document.querySelector('#settings');
    if (settingsSection) settingsSection.before(section);
    else main.appendChild(section);

    button.addEventListener('click', () => showLibraryView());
    section.querySelector('#reloadLibrariesBtn')?.addEventListener('click', loadLibraries);
    section.querySelector('#tmdbSettingsForm')?.addEventListener('submit', saveTmdbSettings);
    section.querySelector('#libraryForm')?.addEventListener('submit', createLibrary);
  }

  async function showLibraryView() {
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === LIBRARY_VIEW_ID));
    document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === LIBRARY_VIEW_ID));
    const title = document.querySelector('#viewTitle');
    const subtitle = document.querySelector('#viewSubtitle');
    if (title) title.textContent = 'Biblioteka';
    if (subtitle) subtitle.textContent = 'Konfigurowalne katalogi TMDB widoczne w Stremio.';
    await Promise.all([loadTmdbSettings(), loadLibraries()]);
  }

  async function loadTmdbSettings() {
    const data = await apiRequest('/admin/settings');
    const s = data.settings || {};
    setValue('#tmdbApiKey', s.tmdbApiKey || '');
    setValue('#tmdbReadAccessToken', s.tmdbReadAccessToken || '');
    setValue('#tmdbLanguage', s.tmdbLanguage || 'pl-PL');
    setValue('#tmdbRegion', s.tmdbRegion || 'PL');
  }

  async function saveTmdbSettings(event) {
    event.preventDefault();
    await apiRequest('/admin/settings', {
      method: 'PATCH',
      body: {
        tmdbApiKey: value('#tmdbApiKey'),
        tmdbReadAccessToken: value('#tmdbReadAccessToken'),
        tmdbLanguage: value('#tmdbLanguage') || 'pl-PL',
        tmdbRegion: value('#tmdbRegion') || 'PL'
      }
    });
    showToast('Ustawienia TMDB zapisane.');
  }

  async function createLibrary(event) {
    event.preventDefault();
    const body = {
      name: value('#libraryName'),
      slug: value('#librarySlug') || undefined,
      type: value('#libraryType'),
      mode: value('#libraryMode'),
      enabled: Boolean(document.querySelector('#libraryEnabled')?.checked),
      sortOrder: Number(value('#librarySortOrder') || 0),
      config: {
        sortBy: value('#librarySortBy') || undefined,
        withGenres: value('#libraryGenres') || undefined,
        withKeywords: value('#libraryKeywords') || undefined,
        withOriginalLanguage: value('#libraryOriginalLanguage') || undefined,
        year: value('#libraryYear') || undefined,
        voteCountGte: value('#libraryVoteCount') ? Number(value('#libraryVoteCount')) : undefined
      }
    };
    await apiRequest('/admin/libraries', { method: 'POST', body });
    document.querySelector('#libraryForm')?.reset();
    const enabled = document.querySelector('#libraryEnabled');
    if (enabled) enabled.checked = true;
    showToast('Biblioteka dodana.');
    await loadLibraries();
  }

  async function loadLibraries() {
    const list = document.querySelector('#librariesList');
    if (!list) return;
    const data = await apiRequest('/admin/libraries');
    const libraries = data.libraries || [];
    if (!libraries.length) {
      list.innerHTML = '<div class="list empty">Brak bibliotek. Dodaj pierwszą bibliotekę TMDB.</div>';
      return;
    }

    list.innerHTML = `<table><thead><tr><th>Nazwa</th><th>Typ</th><th>Tryb</th><th>Status</th><th>Konfiguracja</th><th>Akcje</th></tr></thead><tbody>${libraries.map((library) => `
      <tr>
        <td><strong>${escapeHtml(library.name)}</strong><br><small>${escapeHtml(library.slug)}</small></td>
        <td>${escapeHtml(library.type)}</td>
        <td>${escapeHtml(library.mode)}</td>
        <td>${badge(library.enabled ? 'enabled' : 'disabled')}</td>
        <td><pre class="mini-code">${escapeHtml(JSON.stringify(library.config || {}, null, 2))}</pre></td>
        <td><div class="action-row"><button class="small-btn" data-test-library="${escapeHtml(library.id)}">Test</button><button class="small-btn" data-toggle-library="${escapeHtml(library.id)}" data-enabled="${library.enabled ? 'false' : 'true'}">${library.enabled ? 'Wyłącz' : 'Włącz'}</button><button class="small-btn" data-refresh-library="${escapeHtml(library.id)}">Cache</button><button class="small-btn disabled" data-delete-library="${escapeHtml(library.id)}">Usuń</button></div></td>
      </tr>`).join('')}</tbody></table>`;

    list.querySelectorAll('[data-test-library]').forEach((button) => button.addEventListener('click', () => testLibrary(button.dataset.testLibrary)));
    list.querySelectorAll('[data-toggle-library]').forEach((button) => button.addEventListener('click', () => toggleLibrary(button.dataset.toggleLibrary, button.dataset.enabled === 'true')));
    list.querySelectorAll('[data-refresh-library]').forEach((button) => button.addEventListener('click', () => refreshLibrary(button.dataset.refreshLibrary)));
    list.querySelectorAll('[data-delete-library]').forEach((button) => button.addEventListener('click', () => removeLibrary(button.dataset.deleteLibrary)));
  }

  async function testLibrary(id) {
    const output = document.querySelector('#libraryTestOutput');
    if (output) output.textContent = 'Testuję TMDB...';
    const data = await apiRequest(`/admin/libraries/${encodeURIComponent(id)}/test`, { method: 'POST' });
    if (output) output.textContent = JSON.stringify(data, null, 2);
  }

  async function toggleLibrary(id, enabled) {
    await apiRequest(`/admin/libraries/${encodeURIComponent(id)}`, { method: 'PATCH', body: { enabled } });
    showToast(enabled ? 'Biblioteka włączona.' : 'Biblioteka wyłączona.');
    await loadLibraries();
  }

  async function refreshLibrary(id) {
    await apiRequest(`/admin/libraries/${encodeURIComponent(id)}/refresh`, { method: 'POST' });
    showToast('Cache biblioteki wyczyszczony.');
  }

  async function removeLibrary(id) {
    if (!confirm('Usunąć bibliotekę?')) return;
    await apiRequest(`/admin/libraries/${encodeURIComponent(id)}`, { method: 'DELETE' });
    showToast('Biblioteka usunięta.');
    await loadLibraries();
  }

  async function apiRequest(path, options = {}) {
    const response = await fetch(path, {
      method: options.method || 'GET',
      headers: options.body ? { 'content-type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  function showToast(message) {
    const el = document.querySelector('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3200);
  }

  function value(selector) { return document.querySelector(selector)?.value?.trim() || ''; }
  function setValue(selector, inputValue) { const element = document.querySelector(selector); if (element) element.value = inputValue; }
  function badge(value) { return `<span class="badge ${escapeHtml(String(value))}">${escapeHtml(String(value))}</span>`; }
  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }

  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.(DELETE_BUTTON_SELECTOR);
    if (button) deleteAddon(button);
  });

  installDeleteButtons();
  installLibraryPanel();
  setInterval(() => { installDeleteButtons(); installLibraryPanel(); }, 1000);
})();
