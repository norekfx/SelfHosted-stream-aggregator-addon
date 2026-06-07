(() => {
  const DELETE_BUTTON_SELECTOR = '[data-delete-addon]';
  const LIBRARY_VIEW_ID = 'library';
  let providerCache = { movie: [], series: [] };

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
    if (!addonId || !confirm(`Usunąć wyłączony addon: ${addonName}?`)) return;
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
        <div class="panel-header"><h2>Metadane TMDB / IMDb</h2></div>
        <form id="tmdbSettingsForm" class="settings-form single">
          <div class="panel-grid two">
            <label>TMDB API Key<input id="tmdbApiKey" placeholder="api_key" autocomplete="off" /></label>
            <label>TMDB Read Access Token<input id="tmdbReadAccessToken" placeholder="Bearer token v4" autocomplete="off" /></label>
            <label>Język metadanych<input id="tmdbLanguage" placeholder="pl-PL" /></label>
            <label>Region / katalog VOD<input id="tmdbRegion" placeholder="PL" /></label>
            <label>Synchronizacja metadanych<select id="metadataSyncIntervalMinutes"><option value="1440">Raz dziennie</option><option value="0">Za każdym razem, gdy klient pyta</option><option value="720">Co 12 godzin</option><option value="480">Co 8 godzin</option><option value="240">Co 4 godziny</option><option value="120">Co 2 godziny</option><option value="60">Co godzinę</option><option value="30">Co 30 minut</option><option value="10">Co 10 minut</option></select></label>
          </div>
          <p class="hint">TMDB dostarcza okładki, opisy, sezony, odcinki i kategorie providerów. IMDb ID zostaje używane jako kompatybilny identyfikator streamów.</p>
          <button id="saveTmdbSettingsBtn" class="primary-btn" type="submit">Zapisz metadane</button>
        </form>
      </article>
      <article class="panel">
        <div class="panel-header"><h2>Kreator biblioteki Stremio / Nuvio</h2></div>
        <form id="libraryForm" class="settings-form single">
          <div class="panel-grid two">
            <label>Nazwa biblioteki<input id="libraryName" required placeholder="Netflix: popularne filmy" /></label>
            <label>Slug / ID katalogu<input id="librarySlug" placeholder="netflix-popularne-filmy" /></label>
            <label>Typ<select id="libraryType"><option value="movie">Filmy</option><option value="series">Seriale</option></select></label>
            <label>Źródło listy<select id="libraryMode"><option value="discover">Dopasowana biblioteka / Discover</option><option value="trending">Trendy</option><option value="popular">Popularne</option><option value="top_rated">Najwyżej oceniane</option><option value="now_playing">Filmy: teraz w kinach</option><option value="upcoming">Filmy: nadchodzące</option><option value="airing_today">Seriale: dziś emitowane</option><option value="on_the_air">Seriale: obecnie emitowane</option></select></label>
            <label>Preset<select id="libraryPreset"><option value="custom">Własna konfiguracja</option><option value="latest">Najnowsze</option><option value="anime">Anime</option><option value="netflix">Netflix</option><option value="prime">Prime Video</option><option value="disney">Disney+</option><option value="top">Top oceniane</option></select></label>
            <label>Platforma VOD<select id="libraryWatchProvider"><option value="">Dowolna / brak filtra</option></select></label>
            <label>Liczba pozycji<input id="libraryItemLimit" type="number" min="1" max="100" value="50" placeholder="50" /></label>
            <label>Sortowanie<input id="librarySortBy" placeholder="popularity.desc" /></label>
            <label>Gatunki TMDB<input id="libraryGenres" placeholder="16 dla animacji/anime" /></label>
            <label>Słowa kluczowe TMDB<input id="libraryKeywords" placeholder="np. anime keyword" /></label>
            <label>Oryginalny język<input id="libraryOriginalLanguage" placeholder="ja, pl, en..." /></label>
            <label>Rok<input id="libraryYear" placeholder="2026" /></label>
            <label>Minimalna liczba głosów<input id="libraryVoteCount" type="number" min="0" placeholder="50" /></label>
            <label>Minimalna ocena<input id="libraryVoteAverage" type="number" min="0" max="10" step="0.1" placeholder="7.0" /></label>
            <label>Kolejność w Stremio<input id="librarySortOrder" type="number" value="0" /></label>
            <label class="checkbox"><input id="libraryEnabled" type="checkbox" checked /> Włączona w Stremio</label>
          </div>
          <p class="hint">Liczba pozycji domyślnie wynosi 50. TMDB zwraca po 20 pozycji na stronę, więc większy limit pobiera kilka stron i może chwilę potrwać.</p>
          <button id="createLibraryBtn" class="primary-btn" type="submit">Dodaj bibliotekę</button>
        </form>
      </article>
      <article class="panel">
        <div class="panel-header"><h2>Biblioteki</h2><button id="reloadLibrariesBtn" class="ghost-btn">Odśwież</button></div>
        <div id="librariesList" class="table-wrap"><div class="list empty">Ładowanie...</div></div>
      </article>
      <article class="panel">
        <div class="panel-header"><h2>Podgląd / test synchronizacji</h2></div>
        <pre id="libraryTestOutput" class="code-box small">Wybierz „Test” albo „Synchronizuj” przy bibliotece.</pre>
      </article>
    `;

    const settingsSection = document.querySelector('#settings');
    if (settingsSection) settingsSection.before(section); else main.appendChild(section);

    button.addEventListener('click', () => showLibraryView());
    section.querySelector('#reloadLibrariesBtn')?.addEventListener('click', loadLibraries);
    section.querySelector('#tmdbSettingsForm')?.addEventListener('submit', saveTmdbSettings);
    section.querySelector('#libraryForm')?.addEventListener('submit', createLibrary);
    section.querySelector('#libraryType')?.addEventListener('change', () => loadWatchProviders());
    section.querySelector('#libraryPreset')?.addEventListener('change', applyPreset);
  }

  async function showLibraryView() {
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === LIBRARY_VIEW_ID));
    document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === LIBRARY_VIEW_ID));
    const title = document.querySelector('#viewTitle');
    const subtitle = document.querySelector('#viewSubtitle');
    if (title) title.textContent = 'Biblioteka';
    if (subtitle) subtitle.textContent = 'Kreator katalogów TMDB/IMDb widocznych w Stremio i Nuvio.';
    await loadTmdbSettings();
    await Promise.allSettled([loadWatchProviders(), loadLibraries()]);
  }

  async function loadTmdbSettings() {
    const data = await apiRequest('/admin/settings');
    const s = data.settings || {};
    const languageFromAddon = s.preferredAudioLanguage ? `${s.preferredAudioLanguage}-PL` : 'pl-PL';
    setValue('#tmdbApiKey', s.tmdbApiKey || '');
    setValue('#tmdbReadAccessToken', s.tmdbReadAccessToken || '');
    setValue('#tmdbLanguage', s.tmdbLanguage || languageFromAddon);
    setValue('#tmdbRegion', s.tmdbRegion || 'PL');
    setValue('#metadataSyncIntervalMinutes', String(s.metadataSyncIntervalMinutes ?? 1440));
  }

  async function saveTmdbSettings(event) {
    event.preventDefault();
    const button = document.querySelector('#saveTmdbSettingsBtn');
    await runButton(button, 'Zapisuję...', async () => {
      await apiRequest('/admin/settings', {
        method: 'PATCH',
        body: {
          tmdbApiKey: value('#tmdbApiKey'),
          tmdbReadAccessToken: value('#tmdbReadAccessToken'),
          tmdbLanguage: value('#tmdbLanguage') || 'pl-PL',
          tmdbRegion: value('#tmdbRegion') || 'PL',
          metadataSyncIntervalMinutes: Number(value('#metadataSyncIntervalMinutes') || 1440)
        }
      });
      showToast('Ustawienia metadanych zapisane.');
      providerCache = { movie: [], series: [] };
      await loadWatchProviders();
    });
  }

  async function loadWatchProviders() {
    const type = value('#libraryType') || 'movie';
    const select = document.querySelector('#libraryWatchProvider');
    if (!select) return;
    if (!providerCache[type]?.length) {
      try {
        const data = await apiRequest(`/admin/tmdb/watch-providers/${type}`);
        providerCache[type] = data.providers || [];
      } catch {
        providerCache[type] = [];
      }
    }
    const current = select.value;
    select.innerHTML = '<option value="">Dowolna / brak filtra</option>' + providerCache[type].map((provider) => `<option value="${provider.id}">${escapeHtml(provider.name)}</option>`).join('');
    if (current) select.value = current;
  }

  function applyPreset() {
    const preset = value('#libraryPreset');
    if (preset === 'custom') return;
    if (preset === 'latest') { setValue('#libraryMode', 'discover'); setValue('#librarySortBy', 'primary_release_date.desc'); setValue('#libraryVoteCount', '10'); }
    if (preset === 'anime') { setValue('#libraryMode', 'discover'); setValue('#libraryGenres', '16'); setValue('#libraryOriginalLanguage', 'ja'); setValue('#librarySortBy', 'popularity.desc'); }
    if (preset === 'netflix') { setValue('#libraryMode', 'discover'); setValue('#libraryWatchProvider', findProviderId('netflix')); setValue('#librarySortBy', 'popularity.desc'); }
    if (preset === 'prime') { setValue('#libraryMode', 'discover'); setValue('#libraryWatchProvider', findProviderId('prime')); setValue('#librarySortBy', 'popularity.desc'); }
    if (preset === 'disney') { setValue('#libraryMode', 'discover'); setValue('#libraryWatchProvider', findProviderId('disney')); setValue('#librarySortBy', 'popularity.desc'); }
    if (preset === 'top') { setValue('#libraryMode', 'discover'); setValue('#librarySortBy', 'vote_average.desc'); setValue('#libraryVoteCount', '300'); setValue('#libraryVoteAverage', '7'); }
  }

  function findProviderId(fragment) {
    const type = value('#libraryType') || 'movie';
    const provider = (providerCache[type] || []).find((item) => item.name.toLowerCase().includes(fragment));
    return provider ? String(provider.id) : '';
  }

  async function createLibrary(event) {
    event.preventDefault();
    const button = document.querySelector('#createLibraryBtn');
    await runButton(button, 'Tworzę...', async () => {
      const provider = value('#libraryWatchProvider');
      const region = value('#tmdbRegion') || 'PL';
      const itemLimit = Number(value('#libraryItemLimit') || 50);
      const body = {
        name: value('#libraryName'),
        slug: value('#librarySlug') || undefined,
        type: value('#libraryType'),
        mode: value('#libraryMode'),
        enabled: Boolean(document.querySelector('#libraryEnabled')?.checked),
        sortOrder: Number(value('#librarySortOrder') || 0),
        config: {
          language: value('#tmdbLanguage') || undefined,
          region,
          sortBy: value('#librarySortBy') || undefined,
          withGenres: value('#libraryGenres') || undefined,
          withKeywords: value('#libraryKeywords') || undefined,
          withOriginalLanguage: value('#libraryOriginalLanguage') || undefined,
          withWatchProviders: provider || undefined,
          watchRegion: provider ? region : undefined,
          year: value('#libraryYear') || undefined,
          voteCountGte: value('#libraryVoteCount') ? Number(value('#libraryVoteCount')) : undefined,
          voteAverageGte: value('#libraryVoteAverage') ? Number(value('#libraryVoteAverage')) : undefined,
          itemLimit: Number.isFinite(itemLimit) ? itemLimit : 50
        }
      };
      await apiRequest('/admin/libraries', { method: 'POST', body });
      document.querySelector('#libraryForm')?.reset();
      setValue('#libraryItemLimit', '50');
      const enabled = document.querySelector('#libraryEnabled');
      if (enabled) enabled.checked = true;
      showToast('Biblioteka dodana.');
      await loadLibraries();
    });
  }

  async function loadLibraries() {
    const list = document.querySelector('#librariesList');
    if (!list) return;
    const data = await apiRequest('/admin/libraries');
    const libraries = data.libraries || [];
    if (!libraries.length) { list.innerHTML = '<div class="list empty">Brak bibliotek. Dodaj pierwszą bibliotekę TMDB.</div>'; return; }
    list.innerHTML = `<table><thead><tr><th>Biblioteka</th><th>Typ</th><th>Tryb</th><th>Status</th><th>Okładki / config</th><th>Akcje</th></tr></thead><tbody>${libraries.map((library) => `
      <tr>
        <td><strong>${escapeHtml(library.name)}</strong><br><small>${escapeHtml(library.slug)}</small></td>
        <td>${escapeHtml(library.type)}</td>
        <td>${escapeHtml(library.mode)}</td>
        <td>${badge(library.enabled ? 'enabled' : 'disabled')}</td>
        <td><pre class="mini-code">${escapeHtml(JSON.stringify(library.config || {}, null, 2))}</pre></td>
        <td><div class="action-row"><button class="small-btn" data-test-library="${escapeHtml(library.id)}">Test</button><button class="small-btn" data-sync-library="${escapeHtml(library.id)}">Synchronizuj</button><button class="small-btn" data-toggle-library="${escapeHtml(library.id)}" data-enabled="${library.enabled ? 'false' : 'true'}">${library.enabled ? 'Wyłącz' : 'Włącz'}</button><button class="small-btn disabled" data-delete-library="${escapeHtml(library.id)}">Usuń</button></div></td>
      </tr>`).join('')}</tbody></table>`;
    list.querySelectorAll('[data-test-library]').forEach((button) => button.addEventListener('click', () => testLibrary(button.dataset.testLibrary, button)));
    list.querySelectorAll('[data-sync-library]').forEach((button) => button.addEventListener('click', () => syncLibrary(button.dataset.syncLibrary, button)));
    list.querySelectorAll('[data-toggle-library]').forEach((button) => button.addEventListener('click', () => toggleLibrary(button.dataset.toggleLibrary, button.dataset.enabled === 'true')));
    list.querySelectorAll('[data-delete-library]').forEach((button) => button.addEventListener('click', () => removeLibrary(button.dataset.deleteLibrary)));
  }

  async function testLibrary(id, button) {
    const output = document.querySelector('#libraryTestOutput');
    await runButton(button, 'Testuję...', async () => {
      if (output) output.textContent = 'Testuję TMDB i okładki...';
      const data = await apiRequest(`/admin/libraries/${encodeURIComponent(id)}/test`, { method: 'POST' });
      if (output) output.textContent = JSON.stringify(data, null, 2);
    });
  }

  async function syncLibrary(id, button) {
    const output = document.querySelector('#libraryTestOutput');
    await runButton(button, 'Synchronizuję...', async () => {
      await apiRequest(`/admin/libraries/${encodeURIComponent(id)}/refresh`, { method: 'POST' });
      const data = await apiRequest(`/admin/libraries/${encodeURIComponent(id)}/test`, { method: 'POST' });
      if (output) output.textContent = JSON.stringify(data, null, 2);
      showToast('Synchronizacja biblioteki wymuszona.');
    });
  }

  async function toggleLibrary(id, enabled) { await apiRequest(`/admin/libraries/${encodeURIComponent(id)}`, { method: 'PATCH', body: { enabled } }); showToast(enabled ? 'Biblioteka włączona.' : 'Biblioteka wyłączona.'); await loadLibraries(); }
  async function removeLibrary(id) { if (!confirm('Usunąć bibliotekę?')) return; await apiRequest(`/admin/libraries/${encodeURIComponent(id)}`, { method: 'DELETE' }); showToast('Biblioteka usunięta.'); await loadLibraries(); }

  async function apiRequest(path, options = {}) {
    const response = await fetch(path, { method: options.method || 'GET', headers: options.body ? { 'content-type': 'application/json' } : undefined, body: options.body ? JSON.stringify(options.body) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  async function runButton(button, loadingLabel, action) {
    const previous = button?.textContent;
    if (button) { button.disabled = true; button.classList.add('loading'); button.textContent = loadingLabel; }
    try { await action(); } catch (error) { showToast(error instanceof Error ? error.message : 'Operacja nie powiodła się.'); throw error; }
    finally { if (button) { button.disabled = false; button.classList.remove('loading'); button.textContent = previous; } }
  }

  function showToast(message) { const el = document.querySelector('#toast'); if (!el) return; el.textContent = message; el.classList.remove('hidden'); setTimeout(() => el.classList.add('hidden'), 3200); }
  function value(selector) { return document.querySelector(selector)?.value?.trim() || ''; }
  function setValue(selector, inputValue) { const element = document.querySelector(selector); if (element) element.value = inputValue; }
  function badge(value) { return `<span class="badge ${escapeHtml(String(value))}">${escapeHtml(String(value))}</span>`; }
  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }

  document.addEventListener('click', (event) => { const button = event.target?.closest?.(DELETE_BUTTON_SELECTOR); if (button) deleteAddon(button); });
  installDeleteButtons();
  installLibraryPanel();
  setInterval(() => { installDeleteButtons(); installLibraryPanel(); }, 1000);
})();
