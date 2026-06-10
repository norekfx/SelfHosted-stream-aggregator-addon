(() => {
  const PANEL_ID = 'systemStoragePanel';
  const BODY_ID = 'systemStorageBody';

  function installStoragePanel() {
    const system = document.querySelector('#system');
    if (!system || document.querySelector(`#${PANEL_ID}`)) return;
    const panel = document.createElement('article');
    panel.id = PANEL_ID;
    panel.className = 'panel';
    panel.innerHTML = '<div class="panel-header"><h2>Pamięć</h2><div class="inline-actions"><button id="reloadStorageBtn" class="ghost-btn" type="button">Odśwież</button></div></div><p class="hint">Rozmiary danych i plików tworzonych przez addon: baza, cache, napisy, historia, logi i transkodowanie.</p><div id="systemStorageSummary" class="stats-grid"></div><div id="systemStorageBody" class="table-wrap">Ładowanie...</div>';
    system.insertBefore(panel, system.firstChild);
    panel.querySelector('#reloadStorageBtn')?.addEventListener('click', loadStorageReport);
    loadStorageReport();
  }

  async function loadStorageReport() {
    const body = document.querySelector(`#${BODY_ID}`);
    const summary = document.querySelector('#systemStorageSummary');
    if (!body || !summary) return;
    body.textContent = 'Ładowanie...';
    try {
      const response = await fetch('/admin/system/storage');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const storage = data.storage || {};
      summary.innerHTML = `<article class="stat-card"><span>Łącznie</span><strong>${formatBytes(storage.totalBytes)}</strong><small>dodatkowe dane addonu</small></article><article class="stat-card"><span>Pliki</span><strong>${storage.files?.length || 0}</strong><small>plików/katalogów</small></article><article class="stat-card"><span>Kategorie DB</span><strong>${storage.categories?.length || 0}</strong><small>cache i historia</small></article>`;
      body.innerHTML = renderStorageTables(storage);
    } catch (error) {
      body.innerHTML = `<p class="hint">Nie udało się pobrać raportu pamięci: ${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
    }
  }

  function renderStorageTables(storage) {
    const categories = storage.categories || [];
    const files = storage.files || [];
    return `<h3>Rozbicie bazy danych</h3>${renderCategoryTable(categories)}<h3>Pliki i katalogi</h3>${renderFileTable(files)}<p class="hint">Uwaga: rozbicie bazy jest estymacją na podstawie rozmiaru pól JSON/tekstowych. Rzeczywisty plik SQLite może być większy przez indeksy, wolne strony i WAL.</p>`;
  }

  function renderCategoryTable(rows) {
    if (!rows.length) return '<p class="hint">Brak danych w bazie.</p>';
    return `<table><thead><tr><th>Kategoria</th><th>Rozmiar</th><th>Wpisy</th><th>Opis</th></tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${escapeHtml(row.label)}</strong></td><td>${formatBytes(row.bytes)}</td><td>${escapeHtml(row.rows ?? 0)}</td><td>${escapeHtml(row.description || '')}</td></tr>`).join('')}</tbody></table>`;
  }

  function renderFileTable(rows) {
    if (!rows.length) return '<p class="hint">Nie znaleziono plików addonu.</p>';
    return `<table><thead><tr><th>Element</th><th>Typ</th><th>Rozmiar</th><th>Ścieżka</th><th>Opis</th></tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${escapeHtml(row.label)}</strong></td><td>${row.kind === 'directory' ? 'katalog' : 'plik'}</td><td>${formatBytes(row.bytes)}</td><td><code>${escapeHtml(row.path)}</code></td><td>${escapeHtml(row.description || '')}</td></tr>`).join('')}</tbody></table>`;
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }

  setInterval(installStoragePanel, 2000);
  document.addEventListener('click', () => setTimeout(() => { installStoragePanel(); if (document.querySelector('#system.view.active')) loadStorageReport(); }, 100));
  installStoragePanel();
})();
