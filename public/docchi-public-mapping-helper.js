(() => {
  const MODES = [
    ['disabled', 'Wyłączone'],
    ['animation_series', 'Tylko seriale z kategorii animacji'],
    ['series', 'Tylko seriale'],
    ['all', 'Dla wszystkich']
  ];
  const LIBRARY_MODES = [['inherit', 'Dziedzicz globalne'], ...MODES];

  async function initDocchiPanel() {
    injectDocchiSettingsPanel();
    injectLibraryCreateControl();
    await refreshDocchiStatus();
    await loadDocchiSettings();
    decorateAddonRows();
    decorateLibraryRows();
  }

  function injectDocchiSettingsPanel() {
    if (document.querySelector('#docchiPublicMappingPanel')) return;
    const settings = document.querySelector('#settings') || document.querySelector('.main');
    if (!settings) return;
    const panel = document.createElement('article');
    panel.className = 'panel';
    panel.id = 'docchiPublicMappingPanel';
    panel.innerHTML = `
      <div class="panel-header"><h2>Docchi public — eksperymentalne mapowanie anime</h2><button id="refreshDocchiStatusBtn" class="ghost-btn" type="button">Sprawdź Docchi</button></div>
      <form id="docchiPublicMappingForm" class="settings-form single">
        <div class="panel-grid two">
          <label>Eksperymentalne mapowanie przez Docchi public<select id="docchiPublicMappingMode">${MODES.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
          <label>Status Docchi<input id="docchiDetectedStatus" readonly value="Sprawdzanie..." /></label>
        </div>
        <p class="hint">Domyślnie wyłączone. Nasz addon wykrywa zainstalowany i włączony Docchi po nazwie/opisie/URL manifestu. Publiczny Docchi nie gwarantuje mapowania IMDb, dlatego tryb jest eksperymentalny.</p>
        <div class="action-row">
          <button class="primary-btn" type="submit">Zapisz ustawienia Docchi</button>
          <button id="restoreDocchiOriginalIndexesBtn" class="small-btn danger" type="button">Cofnij indeksy Docchi do TMDB/IMDb</button>
        </div>
        <p class="hint">Cofnięcie usuwa wszystkie zapisane mapowania Docchi i czyści cache metadanych oraz bibliotek. Po tym Stremio/Nuvio dostają ponownie oryginalne ID sezonów/odcinków z TMDB/IMDb.</p>
      </form>
    `;
    const firstPanel = settings.querySelector('.panel');
    if (firstPanel) firstPanel.before(panel); else settings.prepend(panel);
    panel.querySelector('#refreshDocchiStatusBtn')?.addEventListener('click', refreshDocchiStatus);
    panel.querySelector('#docchiPublicMappingForm')?.addEventListener('submit', saveDocchiSettings);
    panel.querySelector('#restoreDocchiOriginalIndexesBtn')?.addEventListener('click', restoreDocchiOriginalIndexes);
  }

  function injectLibraryCreateControl() {
    if (document.querySelector('#libraryDocchiPublicMappingMode')) return;
    const grid = document.querySelector('#libraryForm .panel-grid');
    if (!grid) return;
    const label = document.createElement('label');
    label.innerHTML = `Docchi mapowanie<select id="libraryDocchiPublicMappingMode">${LIBRARY_MODES.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select>`;
    grid.appendChild(label);
  }

  async function loadDocchiSettings() {
    try {
      const data = await apiRequest('/admin/settings');
      setValue('#docchiPublicMappingMode', data.settings?.docchiPublicMappingMode || 'disabled');
    } catch {}
  }

  async function saveDocchiSettings(event) {
    event.preventDefault();
    const button = event.submitter;
    await runButton(button, 'Zapisuję...', async () => {
      await apiRequest('/admin/settings', {
        method: 'PATCH',
        body: { docchiPublicMappingMode: value('#docchiPublicMappingMode') || 'disabled' }
      });
      showToast('Ustawienia Docchi zapisane.');
      await refreshDocchiStatus();
    });
  }

  async function restoreDocchiOriginalIndexes(event) {
    const button = event.currentTarget;
    const confirmed = confirm('Cofnąć wszystkie indeksy Docchi do oryginalnego TMDB/IMDb?\n\nTo usunie zapisane mapowania Docchi i wyczyści cache metadanych oraz bibliotek.');
    if (!confirmed) return;
    await runButton(button, 'Cofam...', async () => {
      const data = await apiRequest('/admin/docchi/restore-original-indexes', { method: 'POST' });
      const reset = data.reset || {};
      showToast(`Cofnięto Docchi: mapowania ${reset.deletedMappings || 0}, meta cache ${reset.clearedMetaCache || 0}, library cache ${reset.clearedLibraryCache || 0}.`);
      document.querySelector('#reloadLibrariesBtn')?.click();
      await refreshDocchiStatus();
    });
  }

  async function refreshDocchiStatus() {
    try {
      const data = await apiRequest('/admin/docchi/status');
      const status = document.querySelector('#docchiDetectedStatus');
      if (status) {
        status.value = data.enabled ? `Wykryto i włączono (${data.addons.length})` : data.detected ? `Wykryto, ale nie jest włączony online (${data.addons.length})` : 'Nie wykryto';
      }
      annotateDocchiAddonRows(data.addons || []);
    } catch {
      const status = document.querySelector('#docchiDetectedStatus');
      if (status) status.value = 'Nie udało się sprawdzić';
    }
  }

  function decorateAddonRows() {
    document.querySelectorAll('#addonsList tbody tr').forEach((row) => {
      const text = row.textContent || '';
      if (!/docc?h?i/i.test(text) || row.querySelector('[data-docchi-detected-badge]')) return;
      const firstCell = row.querySelector('td:first-child');
      if (!firstCell) return;
      const badge = document.createElement('span');
      badge.className = 'badge enabled';
      badge.dataset.docchiDetectedBadge = 'true';
      badge.textContent = 'Wykryto Docchi';
      firstCell.appendChild(document.createElement('br'));
      firstCell.appendChild(badge);
    });
  }

  function annotateDocchiAddonRows(addons) {
    const urls = new Set(addons.map((addon) => addon.manifestUrl));
    document.querySelectorAll('#addonsList tbody tr').forEach((row) => {
      const text = row.textContent || '';
      if (![...urls].some((url) => text.includes(url)) && !/docc?h?i/i.test(text)) return;
      if (row.querySelector('[data-docchi-detected-badge]')) return;
      const firstCell = row.querySelector('td:first-child');
      if (!firstCell) return;
      const badge = document.createElement('span');
      badge.className = 'badge enabled';
      badge.dataset.docchiDetectedBadge = 'true';
      badge.textContent = 'Wykryto Docchi';
      firstCell.appendChild(document.createElement('br'));
      firstCell.appendChild(badge);
    });
  }

  function decorateLibraryRows() {
    document.querySelectorAll('[data-test-library]').forEach((button) => {
      const row = button.closest('tr');
      const actions = button.closest('.action-row');
      if (!row || !actions || actions.querySelector('[data-docchi-library]')) return;
      const id = button.dataset.testLibrary;
      const configText = row.querySelector('.mini-code')?.textContent || '{}';
      let current = 'inherit';
      try { current = JSON.parse(configText).docchiPublicMappingMode || 'inherit'; } catch {}
      const docchiButton = document.createElement('button');
      docchiButton.className = 'small-btn';
      docchiButton.type = 'button';
      docchiButton.textContent = current === 'inherit' ? 'Docchi: globalne' : `Docchi: ${current}`;
      docchiButton.dataset.docchiLibrary = id || '';
      docchiButton.dataset.docchiCurrent = current;
      docchiButton.addEventListener('click', () => changeLibraryDocchiMode(docchiButton));
      actions.appendChild(docchiButton);
    });
  }

  async function changeLibraryDocchiMode(button) {
    const current = button.dataset.docchiCurrent || 'inherit';
    const next = prompt(`Tryb Docchi dla tej biblioteki:\ninherit, disabled, animation_series, series, all`, current);
    if (next === null) return;
    const allowed = new Set(LIBRARY_MODES.map(([value]) => value));
    if (!allowed.has(next)) { showToast('Nieprawidłowy tryb Docchi.'); return; }
    await runButton(button, 'Zapisuję...', async () => {
      await apiRequest(`/admin/libraries/${encodeURIComponent(button.dataset.docchiLibrary || '')}`, {
        method: 'PATCH',
        body: { config: { docchiPublicMappingMode: next } }
      });
      showToast('Tryb Docchi dla biblioteki zapisany.');
      document.querySelector('#reloadLibrariesBtn')?.click();
    });
  }

  function patchLibraryFormSubmitPayload() {
    const form = document.querySelector('#libraryForm');
    if (!form || form.dataset.docchiPatched === 'true') return;
    form.dataset.docchiPatched = 'true';
    form.addEventListener('submit', () => {
      const select = document.querySelector('#libraryDocchiPublicMappingMode');
      if (!select) return;
      setTimeout(async () => {
        try {
          const libs = await apiRequest('/admin/libraries');
          const latest = (libs.libraries || []).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
          if (latest && select.value && select.value !== 'inherit') {
            await apiRequest(`/admin/libraries/${encodeURIComponent(latest.id)}`, { method: 'PATCH', body: { config: { docchiPublicMappingMode: select.value } } });
            document.querySelector('#reloadLibrariesBtn')?.click();
          }
        } catch {}
      }, 1200);
    }, true);
  }

  async function apiRequest(path, options = {}) {
    const response = await fetch(path, { method: options.method || 'GET', headers: options.body ? { 'content-type': 'application/json' } : undefined, body: options.body ? JSON.stringify(options.body) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }
  async function runButton(button, loadingLabel, action) {
    const previous = button?.textContent;
    if (button) { button.disabled = true; button.textContent = loadingLabel; }
    try { await action(); } catch (error) { showToast(error instanceof Error ? error.message : 'Operacja nie powiodła się.'); }
    finally { if (button) { button.disabled = false; button.textContent = previous; } }
  }
  function value(selector) { return document.querySelector(selector)?.value?.trim() || ''; }
  function setValue(selector, inputValue) { const element = document.querySelector(selector); if (element) element.value = inputValue; }
  function showToast(message) { const el = document.querySelector('#toast'); if (!el) return; el.textContent = message; el.classList.remove('hidden'); setTimeout(() => el.classList.add('hidden'), 3200); }

  initDocchiPanel();
  setInterval(() => { initDocchiPanel(); patchLibraryFormSubmitPayload(); decorateAddonRows(); decorateLibraryRows(); }, 1200);
})();
