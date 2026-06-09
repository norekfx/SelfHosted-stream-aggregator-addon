(() => {
  const DOCCHI_FIELD_ID = 'libraryDocchiAutomationMode';
  const DOCCHI_INTERVAL_ID = 'libraryDocchiAutomationIntervalHours';
  const ANIMESUB_FIELD_ID = 'libraryAnimeSubAutomationMode';
  const ANIMESUB_INTERVAL_ID = 'libraryAnimeSubAutomationIntervalHours';

  function installAutomationFields() {
    const grid = document.querySelector('#libraryForm .panel-grid.two');
    if (!grid) return;
    hideLegacyDocchiField();
    if (document.querySelector(`#${DOCCHI_FIELD_ID}`)) return;

    const legacy = document.querySelector('#libraryDocchiPublicMappingMode');
    const legacyValue = legacy?.value || 'inherit';

    const docchiMode = document.createElement('label');
    docchiMode.dataset.libraryAutomationField = 'docchi';
    docchiMode.innerHTML = `Docchi mapowanie<select id="${DOCCHI_FIELD_ID}">
      <option value="inherit">Dziedzicz globalne</option>
      <option value="disabled">Wyłączone</option>
      <option value="animation_series">Tylko seriale z kategorii animacji</option>
      <option value="series">Tylko seriale</option>
      <option value="all">Dla wszystkich</option>
    </select>`;

    const docchiInterval = document.createElement('label');
    docchiInterval.dataset.docchiIntervalWrap = 'true';
    docchiInterval.dataset.libraryAutomationField = 'docchi-interval';
    docchiInterval.innerHTML = `Interwał Docchi<select id="${DOCCHI_INTERVAL_ID}">${intervalOptions()}</select>`;

    const animeSubMode = document.createElement('label');
    animeSubMode.dataset.libraryAutomationField = 'animesub';
    animeSubMode.innerHTML = `Pobieranie napisów AnimeSub<select id="${ANIMESUB_FIELD_ID}">
      <option value="24h">Co 24 godziny</option>
      <option value="3d">Co 3 dni</option>
      <option value="7d" selected>Co 7 dni</option>
      <option value="14d">Co 14 dni</option>
      <option value="30d">Co 30 dni</option>
      <option value="manual">Tylko wymuszenie</option>
    </select>`;

    const animeSubInterval = document.createElement('label');
    animeSubInterval.dataset.animesubIntervalWrap = 'true';
    animeSubInterval.dataset.libraryAutomationField = 'animesub-interval';
    animeSubInterval.innerHTML = `Interwał AnimeSub<select id="${ANIMESUB_INTERVAL_ID}">${intervalOptions()}</select>`;

    const enabled = document.querySelector('#libraryEnabled')?.closest('label');
    if (enabled?.parentNode === grid) {
      grid.insertBefore(docchiMode, enabled);
      grid.insertBefore(docchiInterval, enabled);
      grid.insertBefore(animeSubMode, enabled);
      grid.insertBefore(animeSubInterval, enabled);
    } else {
      grid.append(docchiMode, docchiInterval, animeSubMode, animeSubInterval);
    }

    const docchiSelect = document.querySelector(`#${DOCCHI_FIELD_ID}`);
    if (docchiSelect) docchiSelect.value = legacyValue;
    docchiSelect?.addEventListener('change', () => { if (legacy) legacy.value = docchiSelect.value; syncIntervalVisibility(); });
    document.querySelector(`#${ANIMESUB_FIELD_ID}`)?.addEventListener('change', syncIntervalVisibility);
    syncIntervalVisibility();
  }

  function hideLegacyDocchiField() {
    const legacy = document.querySelector('#libraryDocchiPublicMappingMode');
    const label = legacy?.closest('label');
    if (label) label.style.display = 'none';
  }

  function intervalOptions() { return `<option value="24">24 h</option><option value="72">3 dni</option><option value="168" selected>7 dni</option><option value="336">14 dni</option><option value="720">30 dni</option>`; }
  function syncIntervalVisibility() { const docchi = document.querySelector(`#${DOCCHI_FIELD_ID}`)?.value || 'inherit'; const animeSub = document.querySelector(`#${ANIMESUB_FIELD_ID}`)?.value || '7d'; const docchiWrap = document.querySelector('[data-docchi-interval-wrap]'); const animeWrap = document.querySelector('[data-animesub-interval-wrap]'); if (docchiWrap) docchiWrap.style.display = docchi === 'disabled' ? 'none' : ''; if (animeWrap) animeWrap.style.display = animeSub === 'manual' ? 'none' : ''; }

  function patchLibraryFetch() {
    if (window.__libraryAutomationFetchPatched) return;
    window.__libraryAutomationFetchPatched = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      try {
        const path = typeof input === 'string' ? input : input?.url || '';
        const method = String(init?.method || 'GET').toUpperCase();
        if (path === '/admin/libraries' && method === 'POST' && init.body) {
          const body = JSON.parse(init.body);
          body.config = { ...(body.config || {}), ...readAutomationConfig() };
          init = { ...init, body: JSON.stringify(body) };
        }
        if (/^\/admin\/libraries\/[^/]+$/.test(path) && method === 'PATCH' && init.body) {
          const body = JSON.parse(init.body);
          if (body.config?.docchiPublicMappingMode && !body.config.docchiAutomationMode) body.config.docchiAutomationMode = body.config.docchiPublicMappingMode;
          init = { ...init, body: JSON.stringify(body) };
        }
      } catch {}
      return originalFetch(input, init);
    };
  }

  function readAutomationConfig() {
    const docchiMode = document.querySelector(`#${DOCCHI_FIELD_ID}`)?.value || document.querySelector('#libraryDocchiPublicMappingMode')?.value || 'inherit';
    const animeSubMode = document.querySelector(`#${ANIMESUB_FIELD_ID}`)?.value || '7d';
    const config = { docchiPublicMappingMode: docchiMode, docchiAutomationMode: docchiMode, animeSubAutomationMode: animeSubMode };
    if (docchiMode !== 'disabled') config.docchiAutomationIntervalHours = Number(document.querySelector(`#${DOCCHI_INTERVAL_ID}`)?.value || 168);
    if (animeSubMode !== 'manual') config.animeSubAutomationIntervalHours = Number(document.querySelector(`#${ANIMESUB_INTERVAL_ID}`)?.value || 168);
    return config;
  }

  function installDashboardProgressBox() {
    const dashboard = document.querySelector('#dashboard');
    if (!dashboard || document.querySelector('#libraryAutomationProgressPanel')) return;
    const panel = document.createElement('article');
    panel.id = 'libraryAutomationProgressPanel';
    panel.className = 'panel hidden';
    panel.innerHTML = '<div class="panel-header"><h2>Automatyzacja bibliotek</h2><div class="inline-actions"><button class="small-btn" data-library-auto-action="pause" type="button">Wstrzymaj</button><button class="small-btn" data-library-auto-action="resume" type="button">Wznów</button><button class="small-btn danger" data-library-auto-action="stop" type="button">Zatrzymaj</button></div></div><div id="libraryAutomationProgress" class="list empty">Brak aktywnego indeksowania.</div>';
    dashboard.appendChild(panel);
    panel.querySelectorAll('[data-library-auto-action]').forEach((button) => button.addEventListener('click', () => controlAutomation(button.dataset.libraryAutoAction)));
  }

  async function controlAutomation(action) {
    if (!action) return;
    await fetch(`/admin/library-automation/${action}`, { method: 'POST' }).catch(() => null);
    refreshAutomationProgress();
  }

  async function refreshAutomationProgress() {
    installDashboardProgressBox();
    const panel = document.querySelector('#libraryAutomationProgressPanel');
    const box = document.querySelector('#libraryAutomationProgress');
    if (!panel || !box) return;
    try {
      const response = await fetch('/admin/library-automation/status');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const active = data.active || [];
      panel.classList.toggle('hidden', active.length === 0 && !data.control?.paused && !data.control?.running);
      if (!active.length) { box.innerHTML = data.control?.paused ? 'Automatyzacja jest wstrzymana.' : 'Brak aktywnego indeksowania.'; return; }
      box.innerHTML = active.map((item) => {
        const pct = item.total ? Math.round((item.done / item.total) * 100) : 0;
        const status = item.status === 'paused' ? 'wstrzymane' : 'trwa';
        return `<div class="kv"><span>${escapeHtml(item.libraryId)} · ${escapeHtml(item.task)} · ${status}</span><strong>${escapeHtml(item.done)} / ${escapeHtml(item.total)} (${pct}%)</strong></div>`;
      }).join('');
    } catch { panel?.classList.add('hidden'); }
  }

  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
  patchLibraryFetch();
  setInterval(() => { installAutomationFields(); refreshAutomationProgress(); }, 2000);
  document.addEventListener('click', () => setTimeout(() => { installAutomationFields(); refreshAutomationProgress(); }, 50));
  installAutomationFields();
  refreshAutomationProgress();
})();
