(() => {
  let programs = [];
  let selectedProgram = null;

  function qs(selector, root = document) { return root.querySelector(selector); }

  function install() {
    const section = qs('#scraping');
    if (!section || section.dataset.liveWizard === '1') return;
    section.dataset.liveWizard = '1';
    ensureStyles();
    section.innerHTML = homeMarkup();
    document.body.insertAdjacentHTML('beforeend', createModalMarkup() + detailModalMarkup() + workspaceMarkup());
    bindHome();
    window.ScraperLiveRuntime?.configure({
      onSaved: () => loadPrograms(),
      onClosed: () => loadPrograms()
    });
    loadPrograms();
  }

  function ensureStyles() {
    if (qs('#scraperLiveCss')) return;
    const link = document.createElement('link');
    link.id = 'scraperLiveCss';
    link.rel = 'stylesheet';
    link.href = '/scraper-live-ui.css?v=20260622-live-wizard';
    document.head.appendChild(link);
  }

  function homeMarkup() {
    return `<div class="scraper-home">
      <article class="panel scraper-home-head">
        <div><h2>Kreator scraperów Chromium</h2><p>Twórz proces przez normalne przeglądanie strony. Kliknięcia, wpisywanie, klawisze i przewijanie są nagrywane jako kroki. Ochrona reklamowa zamyka obce karty i pozwala oznaczyć błędne przekierowanie.</p></div>
        <button id="scraperCreateNew" class="primary-btn" type="button">Utwórz nowy</button>
      </article>
      <article class="panel">
        <div class="panel-header"><div><h2>Stworzone procesy</h2><p class="hint">Kliknij proces, aby zobaczyć kroki, przetestować go albo nagrać ponownie.</p></div><button id="scraperReloadPrograms" class="ghost-btn" type="button">Odśwież</button></div>
        <div id="scraperProcessGrid" class="scraper-process-grid"><div class="scraper-empty-state">Ładowanie procesów...</div></div>
      </article>
    </div>`;
  }

  function createModalMarkup() {
    return `<div id="scraperCreateModal" class="scraper-modal hidden">
      <form id="scraperCreateForm" class="scraper-modal-card">
        <h2>Nowy proces scrapowania</h2>
        <p class="hint">Nadaj nazwę i podaj stronę startową. Po kliknięciu „Dalej” uruchomi się Chromium w panelu.</p>
        <div class="scraper-create-grid">
          <label class="full">Nazwa procesu<input id="scraperCreateName" required placeholder="Wyszukiwanie filmu na stronie X" /></label>
          <label class="full">Startowy URL<input id="scraperCreateUrl" required type="url" placeholder="https://example.com" /></label>
          <label>Widok<select id="scraperCreateDevice"><option value="desktop">Komputer</option><option value="mobile">Telefon</option></select></label>
          <label class="checkbox"><input id="scraperCreateRecording" type="checkbox" checked /> Nagrywaj działania od początku</label>
          <label class="checkbox"><input id="scraperCreateAds" type="checkbox" checked /> Automatycznie zamykaj karty reklamowe</label>
        </div>
        <div id="scraperCreateMessage" class="scraper-toast-inline" hidden></div>
        <div class="scraper-modal-actions"><button id="scraperCreateCancel" class="ghost-btn" type="button">Anuluj</button><button id="scraperCreateNext" class="primary-btn" type="submit">Dalej — uruchom Chromium</button></div>
      </form>
    </div>`;
  }

  function detailModalMarkup() {
    return `<div id="scraperDetailModal" class="scraper-modal hidden">
      <div class="scraper-modal-card wide">
        <div class="panel-header"><div><h2 id="scraperDetailTitle">Proces</h2><p id="scraperDetailUrl" class="hint"></p></div><button id="scraperDetailClose" class="ghost-btn" type="button">Zamknij</button></div>
        <div id="scraperDetailSteps" class="scraper-side-list"></div>
        <pre id="scraperDetailOutput" class="code-box scraper-detail-json">Kliknij „Testuj”, aby uruchomić proces.</pre>
        <div class="scraper-modal-actions"><button id="scraperDetailDelete" class="danger-btn" type="button">Usuń</button><button id="scraperDetailRecord" class="ghost-btn" type="button">Nagraj ponownie</button><button id="scraperDetailTest" class="primary-btn" type="button">Testuj proces</button></div>
      </div>
    </div>`;
  }

  function workspaceMarkup() {
    return `<div id="scraperLiveWorkspace" class="scraper-workspace hidden">
      <div class="scraper-browser-toolbar">
        <div class="nav-group"><button id="scraperLiveBack" class="ghost-btn" type="button">←</button><button id="scraperLiveForward" class="ghost-btn" type="button">→</button><button id="scraperLiveReload" class="ghost-btn" type="button">↻</button></div>
        <div class="scraper-address"><input id="scraperLiveAddress" aria-label="Adres strony" /><button id="scraperLiveGo" class="ghost-btn" type="button">Idź</button></div>
        <div class="tool-group"><button id="scraperLiveRecording" class="ghost-btn scraper-recording" type="button">● Nagrywanie</button><button id="scraperLiveAds" class="ghost-btn" type="button">Reklamy: auto</button><button id="scraperLiveMarkAd" class="ghost-btn" type="button">To jest reklama</button><button id="scraperLiveMarkSearch" class="ghost-btn" type="button">Oznacz wyszukiwarkę</button><button id="scraperLiveSideToggle" class="ghost-btn" type="button">Kroki</button><button id="scraperLiveSave" class="primary-btn" type="button">Zapisz proces</button><button id="scraperLiveClose" class="danger-btn" type="button">Zamknij</button></div>
      </div>
      <div class="scraper-workspace-main">
        <div class="scraper-browser-column">
          <div class="scraper-browser-stage">
            <div id="scraperLiveFrame" class="scraper-browser-frame"><img id="scraperLiveImage" alt="Zdalne Chromium" draggable="false" /><div id="scraperLiveLoading" class="scraper-browser-loading">Uruchamianie Chromium...</div></div>
          </div>
          <div class="scraper-input-bar"><input id="scraperLiveText" placeholder="Kliknij pole w Chromium, potem wpisz tekst tutaj" /><button id="scraperLiveType" class="primary-btn" type="button">Wpisz</button><button id="scraperLiveEnter" class="ghost-btn" type="button">Enter</button><button id="scraperLiveTab" class="ghost-btn" type="button">Tab</button><button id="scraperLiveBackspace" class="ghost-btn" type="button">⌫</button></div>
          <div id="scraperLiveMessage" class="scraper-toast-inline" hidden></div>
        </div>
        <aside id="scraperLiveSide" class="scraper-side">
          <div class="scraper-side-title"><span>Nagrane kroki</span><span id="scraperLiveStatus" class="scraper-status-pill">0 kroków</span></div>
          <div id="scraperLiveSteps" class="scraper-side-list"></div>
          <div class="scraper-side-actions"><button id="scraperLiveUndo" class="small-btn" type="button">Cofnij krok</button><button id="scraperLiveClear" class="small-btn danger-btn" type="button">Wyczyść kroki</button></div>
          <div><div class="scraper-side-title">Zdarzenia i reklamy</div><div id="scraperLiveEvents" class="scraper-side-list"></div></div>
        </aside>
      </div>
    </div>`;
  }

  function bindHome() {
    qs('#scraperCreateNew')?.addEventListener('click', () => openCreate());
    qs('#scraperReloadPrograms')?.addEventListener('click', loadPrograms);
    qs('#scraperCreateCancel')?.addEventListener('click', () => toggle('#scraperCreateModal', false));
    qs('#scraperCreateForm')?.addEventListener('submit', startNewProcess);
    qs('#scraperDetailClose')?.addEventListener('click', () => toggle('#scraperDetailModal', false));
    qs('#scraperDetailTest')?.addEventListener('click', testSelected);
    qs('#scraperDetailDelete')?.addEventListener('click', deleteSelected);
    qs('#scraperDetailRecord')?.addEventListener('click', recordSelectedAgain);
    qs('#scraperProcessGrid')?.addEventListener('click', handleCardClick);
    qs('#scraperCreateModal')?.addEventListener('click', (event) => { if (event.target.id === 'scraperCreateModal') toggle('#scraperCreateModal', false); });
    qs('#scraperDetailModal')?.addEventListener('click', (event) => { if (event.target.id === 'scraperDetailModal') toggle('#scraperDetailModal', false); });
  }

  function openCreate(values = {}) {
    qs('#scraperCreateForm')?.reset();
    setValue('#scraperCreateName', values.name || '');
    setValue('#scraperCreateUrl', values.url || '');
    setValue('#scraperCreateDevice', values.mobile ? 'mobile' : 'desktop');
    setChecked('#scraperCreateRecording', true);
    setChecked('#scraperCreateAds', true);
    message('#scraperCreateMessage', '', false, true);
    toggle('#scraperCreateModal', true);
    setTimeout(() => qs('#scraperCreateName')?.focus(), 30);
  }

  async function startNewProcess(event) {
    event.preventDefault();
    const button = qs('#scraperCreateNext');
    setBusy(button, true, 'Uruchamianie...');
    try {
      const options = {
        name: value('#scraperCreateName'),
        url: value('#scraperCreateUrl'),
        mobile: value('#scraperCreateDevice') === 'mobile',
        recording: Boolean(qs('#scraperCreateRecording')?.checked),
        autoAds: Boolean(qs('#scraperCreateAds')?.checked)
      };
      toggle('#scraperCreateModal', false);
      await window.ScraperLiveRuntime.open(options);
    } catch (error) {
      toggle('#scraperCreateModal', true);
      message('#scraperCreateMessage', errorMessage(error), true);
    } finally { setBusy(button, false, 'Dalej — uruchom Chromium'); }
  }

  async function loadPrograms() {
    const grid = qs('#scraperProcessGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="scraper-empty-state">Ładowanie procesów...</div>';
    try {
      const data = await window.ScraperLiveRuntime.api('/admin/scraping/programs');
      programs = data.programs || [];
      renderPrograms();
    } catch (error) { grid.innerHTML = `<div class="scraper-empty-state">${escapeHtml(errorMessage(error))}</div>`; }
  }

  function renderPrograms() {
    const grid = qs('#scraperProcessGrid');
    if (!grid) return;
    if (!programs.length) {
      grid.innerHTML = '<div class="scraper-empty-state">Nie utworzono jeszcze żadnego procesu. Kliknij „Utwórz nowy”, aby nagrać pierwszy.</div>';
      return;
    }
    grid.innerHTML = programs.map((program) => `<article class="scraper-process-card" data-process-id="${escapeHtml(program.id)}">
      <h3>${escapeHtml(program.name)}</h3><small>${escapeHtml(program.url)}</small>
      <div class="scraper-process-meta"><span class="badge enabled">${program.actions?.length || 0} kroków</span><span class="badge">${program.viewportWidth && program.viewportWidth < 600 ? 'telefon' : 'komputer'}</span><span class="badge">${formatDate(program.updatedAt)}</span></div>
      <div class="scraper-process-actions"><button class="small-btn" data-process-open="${escapeHtml(program.id)}" type="button">Otwórz</button><button class="small-btn" data-process-test="${escapeHtml(program.id)}" type="button">Testuj</button></div>
    </article>`).join('');
  }

  function handleCardClick(event) {
    const test = event.target.closest('[data-process-test]');
    const open = event.target.closest('[data-process-open]');
    const card = event.target.closest('[data-process-id]');
    const id = test?.dataset.processTest || open?.dataset.processOpen || card?.dataset.processId;
    if (!id) return;
    selectedProgram = programs.find((item) => item.id === id) || null;
    if (!selectedProgram) return;
    showDetails();
    if (test) testSelected();
  }

  function showDetails() {
    const program = selectedProgram;
    if (!program) return;
    qs('#scraperDetailTitle').textContent = program.name;
    qs('#scraperDetailUrl').textContent = program.url;
    const steps = qs('#scraperDetailSteps');
    steps.innerHTML = program.actions?.length ? program.actions.map((step, index) => `<div class="scraper-step"><div class="scraper-step-index">${index + 1}</div><div><strong>${escapeHtml(stepLabel(step))}</strong><small>${escapeHtml(step.selector || step.value || `${step.x ?? ''}, ${step.y ?? ''}`)}</small></div></div>`).join('') : '<div class="scraper-empty-state">Ten proces nie ma ręcznych kroków i użyje automatycznego wykrywania.</div>';
    qs('#scraperDetailOutput').textContent = 'Kliknij „Testuj proces”, aby uruchomić go w Chromium.';
    toggle('#scraperDetailModal', true);
  }

  async function testSelected() {
    if (!selectedProgram) return;
    const button = qs('#scraperDetailTest');
    setBusy(button, true, 'Testuję...');
    qs('#scraperDetailOutput').textContent = 'Uruchamianie procesu...';
    try {
      const data = await window.ScraperLiveRuntime.api(`/admin/scraping/programs/${encodeURIComponent(selectedProgram.id)}/run`, { method: 'POST' });
      qs('#scraperDetailOutput').textContent = JSON.stringify(data, null, 2);
    } catch (error) { qs('#scraperDetailOutput').textContent = errorMessage(error); }
    finally { setBusy(button, false, 'Testuj proces'); }
  }

  async function deleteSelected() {
    if (!selectedProgram || !confirm(`Usunąć proces „${selectedProgram.name}”?`)) return;
    try {
      await window.ScraperLiveRuntime.api(`/admin/scraping/programs/${encodeURIComponent(selectedProgram.id)}`, { method: 'DELETE' });
      toggle('#scraperDetailModal', false); selectedProgram = null; await loadPrograms();
    } catch (error) { qs('#scraperDetailOutput').textContent = errorMessage(error); }
  }

  async function recordSelectedAgain() {
    if (!selectedProgram) return;
    const program = selectedProgram;
    toggle('#scraperDetailModal', false);
    try {
      await window.ScraperLiveRuntime.open({
        programId: program.id,
        name: program.name,
        url: program.url,
        mobile: Number(program.viewportWidth || 1280) < 600,
        recording: true,
        autoAds: true
      });
    } catch (error) { alert(errorMessage(error)); }
  }

  function stepLabel(step) {
    const labels = { goto: 'Przejdź do adresu', click: 'Kliknij element', type: 'Wpisz tekst', select: 'Wybierz opcję', press: 'Naciśnij klawisz', wait: 'Odczekaj', waitFor: 'Czekaj na element', scroll: 'Przewiń stronę', hover: 'Najedź kursorem', script: 'Wykonaj JavaScript', extract: 'Pobierz adresy' };
    return labels[step.actionType] || step.actionType;
  }

  function toggle(selector, show) { qs(selector)?.classList.toggle('hidden', !show); }
  function value(selector) { return qs(selector)?.value?.trim() || ''; }
  function setValue(selector, next) { const element = qs(selector); if (element) element.value = next; }
  function setChecked(selector, next) { const element = qs(selector); if (element) element.checked = Boolean(next); }
  function setBusy(button, busy, label) { if (!button) return; button.disabled = busy; button.textContent = label; }
  function message(selector, text, error = false, hide = false) { const box = qs(selector); if (!box) return; box.textContent = text; box.classList.toggle('error', error); box.hidden = hide || !text; }
  function formatDate(value) { try { return new Date(value).toLocaleString(); } catch { return '-'; } }
  function errorMessage(error) { return error instanceof Error ? error.message : String(error); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
