(() => {
  if (window.__scraperLiveTestRuntime) return;
  window.__scraperLiveTestRuntime = true;

  let test = null;
  let stateTimer = null;
  let screenshotTimer = null;
  let busy = false;
  let touchStart = null;

  function qs(selector) { return document.querySelector(selector); }

  function ensureCss() {
    if (qs('#scraperLiveTestCss')) return;
    const link = document.createElement('link');
    link.id = 'scraperLiveTestCss';
    link.rel = 'stylesheet';
    link.href = '/scraper-live-test.css?v=20260622-live-test';
    document.head.appendChild(link);
  }

  function ensureBanner() {
    const stage = qs('.scraper-browser-stage');
    if (!stage || qs('#scraperTestBanner')) return;
    stage.insertAdjacentHTML('afterbegin', `
      <div id="scraperTestBanner" class="scraper-test-banner hidden">
        <div class="scraper-test-banner-head">
          <div><h3 id="scraperTestTitle">Test procesu</h3><p id="scraperTestMessage">Uruchamianie...</p></div>
          <span id="scraperTestProgress" class="scraper-status-pill">0 / 0</span>
        </div>
        <div id="scraperTestSummary" class="scraper-test-summary"></div>
        <div id="scraperTestActions" class="scraper-test-actions">
          <button id="scraperTestResume" class="primary-btn" type="button">CAPTCHA rozwiązana — wznów</button>
          <button id="scraperTestSkip" class="ghost-btn" type="button">Pomiń bieżący krok</button>
          <button id="scraperTestStop" class="danger-btn" type="button">Zatrzymaj test</button>
          <span class="scraper-test-manual-note">Podczas pauzy możesz klikać i wpisywać tekst bezpośrednio w podglądzie Chromium.</span>
        </div>
      </div>`);
  }

  async function openTest(program) {
    if (!program?.id) throw new Error('Nie wybrano procesu do testowania.');
    await close(false);
    await window.ScraperLiveRuntime?.close?.(false).catch(() => {});
    ensureCss();
    ensureBanner();
    bindOnce();
    setWorkspace(true);
    setLoading(true, 'Uruchamianie testu w Chromium...');
    try {
      const data = await api(`/admin/scraping/live-test/program/${encodeURIComponent(program.id)}`, { method: 'POST' });
      test = data.test;
      render(test);
      startPolling();
      refreshScreenshot();
    } catch (error) {
      setWorkspace(false);
      setLoading(false);
      throw error;
    }
  }

  async function close(notify = true) {
    stopPolling();
    const old = test;
    test = null;
    if (old?.id) await api(`/admin/scraping/live-test/${encodeURIComponent(old.id)}`, { method: 'DELETE' }).catch(() => {});
    resetWorkspace();
    if (notify) window.dispatchEvent(new CustomEvent('scraper:test-closed'));
  }

  function bindOnce() {
    const workspace = qs('#scraperLiveWorkspace');
    if (!workspace || workspace.dataset.testBound === '1') return;
    workspace.dataset.testBound = '1';

    document.addEventListener('click', interceptTestButtons, true);
    qs('#scraperTestResume')?.addEventListener('click', () => send('/resume', { force: true }));
    qs('#scraperTestSkip')?.addEventListener('click', () => send('/skip', {}));
    qs('#scraperTestStop')?.addEventListener('click', () => send('/stop', {}));
    qs('#scraperLiveClose')?.addEventListener('click', () => close(true));
    qs('#scraperLiveBack')?.addEventListener('click', () => manualCommand('back'));
    qs('#scraperLiveForward')?.addEventListener('click', () => manualCommand('forward'));
    qs('#scraperLiveReload')?.addEventListener('click', () => manualCommand('reload'));
    qs('#scraperLiveType')?.addEventListener('click', manualType);
    qs('#scraperLiveEnter')?.addEventListener('click', () => manualKey('Enter'));
    qs('#scraperLiveTab')?.addEventListener('click', () => manualKey('Tab'));
    qs('#scraperLiveBackspace')?.addEventListener('click', () => manualKey('Backspace'));
    qs('#scraperLiveText')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); manualType(); }
    });

    const frame = qs('#scraperLiveFrame');
    frame?.addEventListener('click', manualClick);
    frame?.addEventListener('wheel', manualWheel, { passive: false });
    frame?.addEventListener('touchstart', onTouchStart, { passive: true });
    frame?.addEventListener('touchend', onTouchEnd, { passive: false });
  }

  async function interceptTestButtons(event) {
    const cardButton = event.target?.closest?.('[data-process-test]');
    const detailButton = event.target?.closest?.('#scraperDetailTest');
    if (!cardButton && !detailButton) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      let programId = cardButton?.dataset?.processTest || '';
      if (!programId) {
        const title = qs('#scraperDetailTitle')?.textContent?.trim();
        const url = qs('#scraperDetailUrl')?.textContent?.trim();
        const list = await api('/admin/scraping/programs');
        programId = (list.programs || []).find((item) => item.name === title && item.url === url)?.id || '';
      }
      if (!programId) throw new Error('Nie udało się ustalić procesu do testowania.');
      const data = await api(`/admin/scraping/programs/${encodeURIComponent(programId)}`);
      qs('#scraperDetailModal')?.classList.add('hidden');
      await openTest(data.program);
    } catch (error) {
      const output = qs('#scraperDetailOutput');
      if (output) output.textContent = errorMessage(error);
      else alert(errorMessage(error));
    }
  }

  function startPolling() {
    stopPolling();
    refreshState();
    refreshScreenshot();
    stateTimer = setInterval(refreshState, 700);
    screenshotTimer = setInterval(refreshScreenshot, 550);
  }

  function stopPolling() {
    if (stateTimer) clearInterval(stateTimer);
    if (screenshotTimer) clearInterval(screenshotTimer);
    stateTimer = null;
    screenshotTimer = null;
  }

  async function refreshState() {
    if (!test?.id || busy) return;
    try {
      const data = await api(`/admin/scraping/live-test/${encodeURIComponent(test.id)}`);
      test = data.test;
      render(test);
      if (['completed', 'completed_with_errors', 'failed', 'stopped'].includes(test.status)) {
        clearInterval(stateTimer);
        stateTimer = null;
      }
    } catch (error) {
      showInline(errorMessage(error), true);
      stopPolling();
    }
  }

  function refreshScreenshot() {
    if (!test?.id) return;
    const image = qs('#scraperLiveImage');
    if (!image) return;
    const next = `/admin/scraping/live-test/${encodeURIComponent(test.id)}/screenshot?t=${Date.now()}`;
    const preload = new Image();
    preload.onload = () => {
      if (!test?.id) return;
      image.src = next;
      setLoading(false);
    };
    preload.onerror = () => {};
    preload.src = next;
  }

  async function send(path, body) {
    if (!test?.id || busy) return null;
    busy = true;
    try {
      const data = await api(`/admin/scraping/live-test/${encodeURIComponent(test.id)}${path}`, { method: 'POST', body });
      test = data.test;
      render(test);
      refreshScreenshot();
      if (test.status === 'running' && !stateTimer) stateTimer = setInterval(refreshState, 700);
      return test;
    } catch (error) {
      showInline(errorMessage(error), true);
      return null;
    } finally {
      busy = false;
    }
  }

  function canControlManually() {
    return test?.status === 'paused_captcha';
  }

  async function manualClick(event) {
    if (!test || event.target?.id !== 'scraperLiveImage') return;
    if (!canControlManually()) {
      showInline('Ręczne sterowanie jest dostępne, gdy test zatrzyma się na CAPTCHA.', true);
      return;
    }
    const image = event.target;
    const rect = image.getBoundingClientRect();
    const x = Math.round((event.clientX - rect.left) * (test.viewportWidth / rect.width));
    const y = Math.round((event.clientY - rect.top) * (test.viewportHeight / rect.height));
    marker(event.clientX - rect.left, event.clientY - rect.top);
    await send('/click', { x, y });
  }

  function manualWheel(event) {
    if (!canControlManually()) return;
    event.preventDefault();
    send('/scroll', { deltaY: Math.max(-1600, Math.min(1600, event.deltaY * 2)) });
  }

  async function manualType() {
    if (!canControlManually()) return showInline('Najpierw poczekaj na pauzę CAPTCHA.', true);
    const input = qs('#scraperLiveText');
    const text = input?.value || '';
    if (!text) return;
    const result = await send('/type', { text, replace: true });
    if (result && input) input.value = '';
  }

  function manualKey(key) {
    if (!canControlManually()) return showInline('Najpierw poczekaj na pauzę CAPTCHA.', true);
    send('/key', { key });
  }

  function manualCommand(command) {
    if (!canControlManually()) return showInline('Nawigacja ręczna jest dostępna podczas pauzy CAPTCHA.', true);
    send('/command', { command });
  }

  function onTouchStart(event) {
    const touch = event.changedTouches?.[0];
    if (touch) touchStart = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }

  function onTouchEnd(event) {
    if (!canControlManually() || !touchStart) return;
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    const elapsed = Date.now() - touchStart.time;
    touchStart = null;
    if (Math.abs(dy) > 35 && Math.abs(dy) > Math.abs(dx)) {
      event.preventDefault();
      send('/scroll', { deltaY: Math.round(-dy * 5) });
    } else if (elapsed < 500) {
      const image = qs('#scraperLiveImage');
      if (!image || !test) return;
      const rect = image.getBoundingClientRect();
      const x = Math.round((touch.clientX - rect.left) * (test.viewportWidth / rect.width));
      const y = Math.round((touch.clientY - rect.top) * (test.viewportHeight / rect.height));
      send('/click', { x, y });
    }
  }

  function render(next) {
    if (!next) return;
    test = next;
    const workspace = qs('#scraperLiveWorkspace');
    workspace?.classList.add('test-mode');
    workspace?.classList.toggle('captcha-paused', next.status === 'paused_captcha');
    qs('#scraperLiveFrame')?.classList.toggle('mobile', next.viewportWidth < 600);
    const address = qs('#scraperLiveAddress');
    if (address) { address.value = next.url || ''; address.readOnly = true; }
    const go = qs('#scraperLiveGo');
    if (go) go.hidden = true;
    const status = qs('#scraperLiveStatus');
    if (status) {
      status.textContent = `${Math.min(next.currentStepIndex + 1, next.totalSteps || 0)} / ${next.totalSteps}`;
      status.classList.toggle('on', next.status === 'running');
    }
    const title = qs('.scraper-side-title span:first-child');
    if (title) title.textContent = 'Przebieg testu';
    renderSteps(next.steps || []);
    renderEvents(next.events || []);
    renderBanner(next);
  }

  function renderSteps(steps) {
    const list = qs('#scraperLiveSteps');
    if (!list) return;
    list.innerHTML = steps.length ? steps.map((step, index) => {
      const status = step.status || 'pending';
      const labels = { pending: 'oczekuje', running: 'wykonywany', ok: 'wykonany', failed: 'błąd — pominięty', skipped: 'pominięty' };
      return `<div class="scraper-step test-${escapeHtml(status)}"><div class="scraper-step-index">${index + 1}</div><div><strong>${escapeHtml(step.actionType)}</strong><small>${escapeHtml(step.selector || step.value || `${step.x ?? ''}, ${step.y ?? ''}`)}</small><span class="scraper-step-status ${escapeHtml(status)}">${escapeHtml(labels[status] || status)}</span>${step.message ? `<small>${escapeHtml(step.message)}</small>` : ''}</div></div>`;
    }).join('') : '<div class="scraper-empty-state">Brak kroków do testowania.</div>';
    const active = list.querySelector('.test-running');
    active?.scrollIntoView({ block: 'nearest' });
  }

  function renderEvents(events) {
    const list = qs('#scraperLiveEvents');
    if (!list) return;
    const recent = events.slice(-50).reverse();
    list.innerHTML = recent.length ? recent.map((item) => `<div class="scraper-event ${escapeHtml(item.type)}"><strong>${escapeHtml(item.message)}</strong></div>`).join('') : '<div class="scraper-empty-state">Brak zdarzeń.</div>';
  }

  function renderBanner(next) {
    const banner = qs('#scraperTestBanner');
    const title = qs('#scraperTestTitle');
    const message = qs('#scraperTestMessage');
    const progress = qs('#scraperTestProgress');
    const summary = qs('#scraperTestSummary');
    const actions = qs('#scraperTestActions');
    if (!banner || !title || !message || !progress || !summary || !actions) return;

    banner.className = 'scraper-test-banner';
    progress.textContent = `${next.currentStepIndex} / ${next.totalSteps}`;
    summary.innerHTML = `<span class="scraper-test-chip">✓ ${next.successfulSteps}</span><span class="scraper-test-chip">✕ ${next.failedSteps}</span><span class="scraper-test-chip">↷ ${next.skippedSteps}</span><span class="scraper-test-chip">Media: ${next.videoUrls?.length || 0}</span>`;

    if (next.status === 'running' || next.status === 'starting') {
      title.textContent = `Test: ${next.programName}`;
      message.textContent = `Wykonywanie kroku ${Math.min(next.currentStepIndex + 1, next.totalSteps)} z ${next.totalSteps}. Obraz pokazuje aktualny stan Chromium.`;
      actions.classList.add('hidden');
      banner.classList.remove('hidden');
    } else if (next.status === 'paused_captcha') {
      banner.classList.add('captcha');
      title.textContent = next.captcha?.kind || 'Wykryto CAPTCHA';
      message.textContent = next.captcha?.message || 'Rozwiąż weryfikację ręcznie w podglądzie Chromium.';
      actions.classList.remove('hidden');
      banner.classList.remove('hidden');
    } else if (next.status === 'completed') {
      banner.classList.add('success');
      title.textContent = 'Test zakończony poprawnie';
      message.textContent = `Wszystkie ${next.successfulSteps} kroki wykonano poprawnie.`;
      actions.classList.add('hidden');
      banner.classList.remove('hidden');
    } else if (next.status === 'completed_with_errors') {
      banner.classList.add('error');
      title.textContent = 'Test zakończony z pominiętymi krokami';
      message.textContent = `Poprawne: ${next.successfulSteps}, błędne: ${next.failedSteps}, pominięte: ${next.skippedSteps}. Błędne kroki nie zatrzymały pozostałej części procesu.`;
      actions.classList.add('hidden');
      banner.classList.remove('hidden');
    } else if (next.status === 'failed') {
      banner.classList.add('error');
      title.textContent = 'Test nie wykonał żadnego kroku';
      message.textContent = 'Żaden krok nie mógł zostać wykonany. Sprawdź selektory, stronę startową oraz zdarzenia po prawej stronie.';
      actions.classList.add('hidden');
      banner.classList.remove('hidden');
    } else if (next.status === 'stopped') {
      title.textContent = 'Test zatrzymany';
      message.textContent = 'Test został przerwany przez użytkownika.';
      actions.classList.add('hidden');
      banner.classList.remove('hidden');
    }
  }

  function setWorkspace(show) {
    ensureBanner();
    const workspace = qs('#scraperLiveWorkspace');
    workspace?.classList.toggle('hidden', !show);
    workspace?.classList.toggle('test-mode', show);
    document.body.style.overflow = show ? 'hidden' : '';
  }

  function resetWorkspace() {
    const workspace = qs('#scraperLiveWorkspace');
    workspace?.classList.remove('test-mode', 'captcha-paused');
    workspace?.classList.add('hidden');
    qs('#scraperTestBanner')?.classList.add('hidden');
    const address = qs('#scraperLiveAddress');
    if (address) address.readOnly = false;
    const go = qs('#scraperLiveGo');
    if (go) go.hidden = false;
    document.body.style.overflow = '';
  }

  function setLoading(show, text = 'Ładowanie...') {
    const overlay = qs('#scraperLiveLoading');
    if (!overlay) return;
    overlay.textContent = text;
    overlay.classList.toggle('hidden', !show);
  }

  function marker(x, y) {
    const frame = qs('#scraperLiveFrame');
    if (!frame) return;
    const element = document.createElement('span');
    element.className = 'scraper-click-marker';
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    frame.appendChild(element);
    setTimeout(() => element.remove(), 650);
  }

  function showInline(text, error = false) {
    const box = qs('#scraperLiveMessage');
    if (!box) return;
    box.textContent = text;
    box.classList.toggle('error', error);
    box.hidden = false;
    setTimeout(() => { box.hidden = true; }, 5000);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      method: options.method || 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: options.body ? { 'content-type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  function errorMessage(error) { return error instanceof Error ? error.message : String(error); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }

  function boot() {
    ensureCss();
    const wait = () => {
      if (qs('#scraperLiveWorkspace')) { ensureBanner(); bindOnce(); }
      else setTimeout(wait, 100);
    };
    wait();
  }

  window.ScraperLiveTestRuntime = { openTest, close };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
