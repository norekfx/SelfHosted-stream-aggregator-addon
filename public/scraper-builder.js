(() => {
  const ACTION_TYPES = [
    ['goto', 'Przejdź do URL'],
    ['click', 'Kliknij element'],
    ['type', 'Wpisz tekst'],
    ['select', 'Wybierz opcję'],
    ['press', 'Naciśnij klawisz'],
    ['wait', 'Odczekaj'],
    ['waitFor', 'Czekaj na element'],
    ['scroll', 'Przewiń stronę'],
    ['hover', 'Najedź kursorem'],
    ['script', 'Własny JavaScript strony'],
    ['extract', 'Pobierz adresy z elementów']
  ];

  let programs = [];
  let currentId = null;
  let actions = [];

  function qs(selector, root = document) {
    return root.querySelector(selector);
  }

  function install() {
    const section = qs('#scraping');
    if (!section || section.dataset.builderInstalled === '1') return;
    section.dataset.builderInstalled = '1';
    installStyles();
    section.innerHTML = `
      <article class="panel scraper-builder-panel">
        <div class="panel-header">
          <div><h2>Kreator scraperów Chromium</h2><p class="hint">Pełna automatyzacja strony w Chromium: kliknięcia, formularze, nawigacja, oczekiwanie, selektory i własny JavaScript wykonywany w kontekście strony.</p></div>
          <div class="inline-actions"><button id="scraperNewBtn" class="ghost-btn" type="button">Nowy</button><button id="scraperSaveBtn" class="primary-btn" type="button">Zapisz</button><button id="scraperRunBtn" class="primary-btn" type="button">Zapisz i uruchom</button><button id="scraperDeleteBtn" class="danger-btn" type="button">Usuń</button></div>
        </div>

        <div class="panel-grid two scraper-program-grid">
          <label>Zapisany program<select id="scraperProgramSelect"><option value="">Nowy program</option></select></label>
          <label>Nazwa programu<input id="scraperProgramName" placeholder="Odtwarzacz strony X" /></label>
          <label>URL startowy<input id="scraperProgramUrl" type="url" placeholder="https://example.com/video" /></label>
          <label>User-Agent<input id="scraperUserAgent" placeholder="Domyślny Chrome 124" /></label>
          <label>Szerokość viewportu<input id="scraperViewportWidth" type="number" min="320" max="7680" value="1440" /></label>
          <label>Wysokość viewportu<input id="scraperViewportHeight" type="number" min="240" max="4320" value="900" /></label>
          <label>Początkowe oczekiwanie (ms)<input id="scraperInitialWait" type="number" min="0" max="120000" value="1500" /></label>
          <label>Nagłówki HTTP jako JSON<textarea id="scraperHeaders" rows="3" placeholder='{"Referer":"https://example.com"}'>{}</textarea></label>
          <label class="checkbox"><input id="scraperCloudflare" type="checkbox" /> Dłuższe oczekiwanie dla Cloudflare</label>
          <label class="checkbox"><input id="scraperHeadless" type="checkbox" checked /> Chromium headless</label>
        </div>
        <p class="hint">Tryb bez headless wymaga serwera graficznego DISPLAY. Na TrueNAS standardowo używaj headless — nadal działa pełny Chromium i JavaScript strony.</p>
      </article>

      <article class="panel">
        <div class="panel-header"><div><h2>Program krok po kroku</h2><p class="hint">Kroki są wykonywane dokładnie w pokazanej kolejności. Jeśli lista jest pusta, silnik uruchomi automatyczne wykrywanie przycisków odtwarzania.</p></div><div class="inline-actions"><select id="scraperNewActionType">${actionOptions('click')}</select><button id="scraperAddActionBtn" class="ghost-btn" type="button">Dodaj krok</button></div></div>
        <div id="scraperActions" class="scraper-actions"></div>
      </article>

      <article class="panel">
        <div class="panel-header"><h2>Wynik i diagnostyka</h2><button id="scraperClearOutputBtn" class="ghost-btn" type="button">Wyczyść</button></div>
        <pre id="scraperProgramOutput" class="code-box large">Wybierz program albo utwórz nowy.</pre>
      </article>
      <div id="scrapingList" hidden></div>
    `;

    qs('#scraperNewBtn')?.addEventListener('click', resetForm);
    qs('#scraperSaveBtn')?.addEventListener('click', () => saveProgram(false));
    qs('#scraperRunBtn')?.addEventListener('click', runProgram);
    qs('#scraperDeleteBtn')?.addEventListener('click', deleteProgram);
    qs('#scraperAddActionBtn')?.addEventListener('click', () => addAction(qs('#scraperNewActionType')?.value || 'click'));
    qs('#scraperProgramSelect')?.addEventListener('change', (event) => loadSelected(event.target.value));
    qs('#scraperClearOutputBtn')?.addEventListener('click', () => setOutput(''));
    qs('#scraperActions')?.addEventListener('input', syncActionsFromDom);
    qs('#scraperActions')?.addEventListener('change', syncActionsFromDom);
    qs('#scraperActions')?.addEventListener('click', handleActionButton);
    void loadPrograms();
  }

  function installStyles() {
    if (qs('#scraperBuilderStyles')) return;
    const style = document.createElement('style');
    style.id = 'scraperBuilderStyles';
    style.textContent = `
      .scraper-program-grid textarea{width:100%;resize:vertical}.scraper-actions{display:flex;flex-direction:column;gap:12px}.scraper-action{display:grid;grid-template-columns:52px minmax(130px,.8fr) minmax(180px,1.2fr) minmax(200px,1.6fr) 110px 90px 90px auto;gap:9px;align-items:start;padding:12px;border:1px solid rgba(255,255,255,.11);border-radius:14px;background:rgba(255,255,255,.035)}.scraper-action-number{display:flex;align-items:center;justify-content:center;height:40px;border-radius:10px;background:rgba(255,255,255,.06);font-weight:700}.scraper-action textarea{min-height:70px;resize:vertical}.scraper-action input,.scraper-action select,.scraper-action textarea{width:100%}.scraper-action-buttons{display:flex;flex-wrap:wrap;gap:5px}.scraper-empty{padding:18px;border:1px dashed rgba(255,255,255,.18);border-radius:14px;opacity:.75}@media(max-width:1200px){.scraper-action{grid-template-columns:52px 1fr 1fr}.scraper-action-value{grid-column:2/4}.scraper-action-buttons{grid-column:2/4}}@media(max-width:720px){.scraper-action{grid-template-columns:42px 1fr}.scraper-action>*{grid-column:2}.scraper-action-number{grid-column:1;grid-row:1/8}}
    `;
    document.head.appendChild(style);
  }

  async function loadPrograms(preferredId) {
    try {
      const data = await api('/admin/scraping/programs');
      programs = data.programs || [];
      const select = qs('#scraperProgramSelect');
      if (select) {
        select.innerHTML = '<option value="">Nowy program</option>' + programs.map((program) => `<option value="${escapeHtml(program.id)}">${escapeHtml(program.name)}</option>`).join('');
      }
      const id = preferredId || currentId;
      if (id && programs.some((program) => program.id === id)) {
        if (select) select.value = id;
        loadSelected(id);
      } else if (!currentId) {
        resetForm();
      }
    } catch (error) {
      setOutput(errorMessage(error));
    }
  }

  function loadSelected(id) {
    if (!id) {
      resetForm();
      return;
    }
    const program = programs.find((item) => item.id === id);
    if (!program) return;
    currentId = program.id;
    setValue('#scraperProgramName', program.name);
    setValue('#scraperProgramUrl', program.url);
    setValue('#scraperUserAgent', program.userAgent || '');
    setValue('#scraperViewportWidth', program.viewportWidth || 1440);
    setValue('#scraperViewportHeight', program.viewportHeight || 900);
    setValue('#scraperInitialWait', program.initialWaitMs ?? 1500);
    setValue('#scraperHeaders', JSON.stringify(program.headers || {}, null, 2));
    setChecked('#scraperCloudflare', program.cloudflare);
    setChecked('#scraperHeadless', program.headless !== false);
    actions = (program.actions || []).map((action, index) => normalizeAction(action, index));
    renderActions();
    setOutput(`Załadowano program: ${program.name}\nKroki: ${actions.length}`);
  }

  function resetForm() {
    currentId = null;
    const select = qs('#scraperProgramSelect');
    if (select) select.value = '';
    setValue('#scraperProgramName', '');
    setValue('#scraperProgramUrl', '');
    setValue('#scraperUserAgent', '');
    setValue('#scraperViewportWidth', 1440);
    setValue('#scraperViewportHeight', 900);
    setValue('#scraperInitialWait', 1500);
    setValue('#scraperHeaders', '{}');
    setChecked('#scraperCloudflare', false);
    setChecked('#scraperHeadless', true);
    actions = [];
    renderActions();
    setOutput('Nowy program Chromium. Dodaj kroki lub pozostaw pustą listę dla automatycznego wykrywania.');
  }

  function addAction(type) {
    syncActionsFromDom();
    actions.push(normalizeAction({ actionType: type }, actions.length));
    renderActions();
  }

  function renderActions() {
    const container = qs('#scraperActions');
    if (!container) return;
    if (!actions.length) {
      container.innerHTML = '<div class="scraper-empty">Brak kroków. Silnik użyje automatycznego wykrywania linków i przycisków odtwarzania.</div>';
      return;
    }
    container.innerHTML = actions.map((action, index) => `
      <div class="scraper-action" data-action-index="${index}">
        <div class="scraper-action-number">${index + 1}</div>
        <label>Typ<select data-field="actionType">${actionOptions(action.actionType)}</select></label>
        <label>Selektor CSS<input data-field="selector" value="${escapeHtml(action.selector || '')}" placeholder="#play, input[name=q]" /></label>
        <label class="scraper-action-value">Wartość / JavaScript<textarea data-field="value" placeholder="Tekst, URL, klawisz, atrybut lub kod JS">${escapeHtml(action.value || '')}</textarea></label>
        <label>Po kroku ms<input data-field="waitMs" type="number" min="0" max="120000" value="${Number(action.waitMs || 0)}" /></label>
        <label>X<input data-field="x" type="number" value="${numberOrBlank(action.x)}" /></label>
        <label>Y<input data-field="y" type="number" value="${numberOrBlank(action.y)}" /></label>
        <div class="scraper-action-buttons"><button class="small-btn" type="button" data-action-up="${index}">↑</button><button class="small-btn" type="button" data-action-down="${index}">↓</button><button class="small-btn danger-btn" type="button" data-action-delete="${index}">Usuń</button></div>
      </div>`).join('');
  }

  function syncActionsFromDom() {
    const rows = Array.from(document.querySelectorAll('.scraper-action'));
    if (!rows.length) return;
    actions = rows.map((row, index) => ({
      id: actions[index]?.id,
      actionType: row.querySelector('[data-field="actionType"]')?.value || 'click',
      selector: row.querySelector('[data-field="selector"]')?.value?.trim() || null,
      value: row.querySelector('[data-field="value"]')?.value || null,
      waitMs: numericOrNull(row.querySelector('[data-field="waitMs"]')?.value),
      x: numericOrNull(row.querySelector('[data-field="x"]')?.value),
      y: numericOrNull(row.querySelector('[data-field="y"]')?.value),
      sortOrder: index
    }));
  }

  function handleActionButton(event) {
    const up = event.target.closest('[data-action-up]');
    const down = event.target.closest('[data-action-down]');
    const remove = event.target.closest('[data-action-delete]');
    if (!up && !down && !remove) return;
    syncActionsFromDom();
    const index = Number((up || down || remove).dataset.actionUp ?? (up || down || remove).dataset.actionDown ?? (up || down || remove).dataset.actionDelete);
    if (remove) actions.splice(index, 1);
    if (up && index > 0) [actions[index - 1], actions[index]] = [actions[index], actions[index - 1]];
    if (down && index < actions.length - 1) [actions[index + 1], actions[index]] = [actions[index], actions[index + 1]];
    renderActions();
  }

  async function saveProgram(silent) {
    syncActionsFromDom();
    const payload = getPayload();
    const button = qs('#scraperSaveBtn');
    setBusy(button, true, 'Zapisuję...');
    try {
      const data = await api(currentId ? `/admin/scraping/programs/${encodeURIComponent(currentId)}` : '/admin/scraping/programs', {
        method: currentId ? 'PUT' : 'POST',
        body: payload
      });
      currentId = data.program.id;
      await loadPrograms(currentId);
      if (!silent) setOutput(`Zapisano program ${data.program.name}.\nKroki: ${data.program.actions.length}`);
      return data.program;
    } finally {
      setBusy(button, false, 'Zapisz');
    }
  }

  async function runProgram() {
    const button = qs('#scraperRunBtn');
    setBusy(button, true, 'Uruchamiam Chromium...');
    try {
      const program = await saveProgram(true);
      setOutput(`Uruchamianie Chromium dla ${program.url}...`);
      const data = await api(`/admin/scraping/programs/${encodeURIComponent(program.id)}/run`, { method: 'POST' });
      setOutput(JSON.stringify(data, null, 2));
    } catch (error) {
      setOutput(errorMessage(error));
    } finally {
      setBusy(button, false, 'Zapisz i uruchom');
    }
  }

  async function deleteProgram() {
    if (!currentId || !confirm('Usunąć ten program scrapera?')) return;
    try {
      await api(`/admin/scraping/programs/${encodeURIComponent(currentId)}`, { method: 'DELETE' });
      currentId = null;
      await loadPrograms();
      resetForm();
    } catch (error) {
      setOutput(errorMessage(error));
    }
  }

  function getPayload() {
    const headersText = qs('#scraperHeaders')?.value?.trim() || '{}';
    let headers;
    try {
      headers = JSON.parse(headersText);
      if (!headers || Array.isArray(headers) || typeof headers !== 'object') throw new Error('not object');
    } catch {
      throw new Error('Nagłówki HTTP muszą być poprawnym obiektem JSON.');
    }
    const name = qs('#scraperProgramName')?.value?.trim();
    const url = qs('#scraperProgramUrl')?.value?.trim();
    if (!name) throw new Error('Podaj nazwę programu.');
    if (!url) throw new Error('Podaj URL startowy.');
    return {
      name,
      url,
      cloudflare: Boolean(qs('#scraperCloudflare')?.checked),
      headless: Boolean(qs('#scraperHeadless')?.checked),
      userAgent: qs('#scraperUserAgent')?.value?.trim() || '',
      viewportWidth: Number(qs('#scraperViewportWidth')?.value || 1440),
      viewportHeight: Number(qs('#scraperViewportHeight')?.value || 900),
      initialWaitMs: Number(qs('#scraperInitialWait')?.value || 0),
      headers,
      actions: actions.map((action, index) => ({ ...action, sortOrder: index }))
    };
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: options.body ? { 'content-type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || JSON.stringify(data.details || {}) || `HTTP ${response.status}`);
    return data;
  }

  function normalizeAction(action, index) {
    return {
      id: action.id,
      actionType: action.actionType || 'click',
      selector: action.selector || null,
      value: action.value || null,
      x: action.x ?? null,
      y: action.y ?? null,
      waitMs: action.waitMs ?? 0,
      sortOrder: index
    };
  }

  function actionOptions(selected) {
    return ACTION_TYPES.map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('');
  }

  function setOutput(value) {
    const output = qs('#scraperProgramOutput');
    if (output) output.textContent = value;
  }

  function setValue(selector, value) {
    const element = qs(selector);
    if (element) element.value = String(value ?? '');
  }

  function setChecked(selector, value) {
    const element = qs(selector);
    if (element) element.checked = Boolean(value);
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    button.disabled = busy;
    button.textContent = label;
  }

  function numericOrNull(value) {
    if (value === '' || value == null) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function numberOrBlank(value) {
    return value == null ? '' : Number(value);
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
