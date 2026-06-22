(() => {
  let session = null;
  let programId = null;
  let stateTimer = null;
  let screenshotTimer = null;
  let busy = false;
  let touchStart = null;
  let callbacks = { onSaved: null, onClosed: null };

  function qs(selector) { return document.querySelector(selector); }

  async function open(options = {}) {
    await close(false);
    programId = options.programId || null;
    setLoading(true, 'Uruchamianie Chromium...');
    showWorkspace(true);
    try {
      const data = await api('/admin/scraping/live', {
        method: 'POST',
        body: {
          name: options.name,
          url: options.url,
          mobile: Boolean(options.mobile),
          recording: options.recording !== false,
          autoAds: options.autoAds !== false
        }
      });
      session = data.session;
      renderState(session);
      bindWorkspaceOnce();
      startPolling();
      setLoading(false);
    } catch (error) {
      setLoading(false);
      showWorkspace(false);
      throw error;
    }
  }

  function configure(nextCallbacks = {}) {
    callbacks = { ...callbacks, ...nextCallbacks };
    bindWorkspaceOnce();
  }

  async function close(notify = true) {
    stopPolling();
    const old = session;
    session = null;
    if (old?.id) await api(`/admin/scraping/live/${encodeURIComponent(old.id)}`, { method: 'DELETE' }).catch(() => {});
    showWorkspace(false);
    if (notify) callbacks.onClosed?.();
  }

  function startPolling() {
    stopPolling();
    refreshState();
    refreshScreenshot();
    stateTimer = setInterval(refreshState, 900);
    screenshotTimer = setInterval(refreshScreenshot, 650);
  }

  function stopPolling() {
    if (stateTimer) clearInterval(stateTimer);
    if (screenshotTimer) clearInterval(screenshotTimer);
    stateTimer = null;
    screenshotTimer = null;
  }

  async function refreshState() {
    if (!session?.id || busy) return;
    try {
      const data = await api(`/admin/scraping/live/${encodeURIComponent(session.id)}`);
      session = data.session;
      renderState(session);
    } catch (error) {
      inlineMessage(errorMessage(error), true);
      stopPolling();
    }
  }

  function refreshScreenshot() {
    if (!session?.id) return;
    const image = qs('#scraperLiveImage');
    if (!image) return;
    const next = `/admin/scraping/live/${encodeURIComponent(session.id)}/screenshot?t=${Date.now()}`;
    const preload = new Image();
    preload.onload = () => {
      if (session?.id) {
        image.src = next;
        setLoading(false);
      }
    };
    preload.onerror = () => {};
    preload.src = next;
  }

  async function send(path, body) {
    if (!session?.id || busy) return null;
    busy = true;
    try {
      const result = await api(`/admin/scraping/live/${encodeURIComponent(session.id)}${path}`, {
        method: 'POST',
        body
      });
      session = result.session || result.state || result;
      if (result.state) session = result.state;
      renderState(session);
      refreshScreenshot();
      return result;
    } finally {
      busy = false;
    }
  }

  async function saveProgram() {
    if (!session) throw new Error('Brak aktywnej sesji Chromium.');
    const actions = (session.steps || []).map((step, index) => ({
      id: step.id,
      actionType: step.actionType,
      selector: step.selector ?? null,
      value: step.value ?? null,
      x: step.x ?? null,
      y: step.y ?? null,
      waitMs: step.waitMs ?? 0,
      sortOrder: index
    }));
    const payload = {
      name: session.name,
      url: session.startUrl,
      cloudflare: false,
      headless: true,
      userAgent: '',
      viewportWidth: session.viewportWidth,
      viewportHeight: session.viewportHeight,
      initialWaitMs: 1200,
      headers: {},
      actions
    };
    const data = await api(programId ? `/admin/scraping/programs/${encodeURIComponent(programId)}` : '/admin/scraping/programs', {
      method: programId ? 'PUT' : 'POST',
      body: payload
    });
    programId = data.program.id;
    inlineMessage(`Zapisano proces „${data.program.name}” (${actions.length} kroków).`);
    callbacks.onSaved?.(data.program);
    return data.program;
  }

  function bindWorkspaceOnce() {
    const workspace = qs('#scraperLiveWorkspace');
    if (!workspace || workspace.dataset.bound === '1') return;
    workspace.dataset.bound = '1';

    qs('#scraperLiveClose')?.addEventListener('click', () => close(true));
    qs('#scraperLiveSave')?.addEventListener('click', () => runButton('#scraperLiveSave', 'Zapisuję...', saveProgram));
    qs('#scraperLiveBack')?.addEventListener('click', () => send('/command', { command: 'back' }));
    qs('#scraperLiveForward')?.addEventListener('click', () => send('/command', { command: 'forward' }));
    qs('#scraperLiveReload')?.addEventListener('click', () => send('/command', { command: 'reload' }));
    qs('#scraperLiveGo')?.addEventListener('click', navigateFromBar);
    qs('#scraperLiveAddress')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); navigateFromBar(); } });
    qs('#scraperLiveRecording')?.addEventListener('click', () => send('/recording', { enabled: !session?.recording }));
    qs('#scraperLiveAds')?.addEventListener('click', () => send('/ad-protection', { enabled: !session?.autoAds }));
    qs('#scraperLiveMarkAd')?.addEventListener('click', () => send('/mark-ad', {}));
    qs('#scraperLiveMarkSearch')?.addEventListener('click', () => send('/mark-search', {}));
    qs('#scraperLiveUndo')?.addEventListener('click', () => send('/undo', {}));
    qs('#scraperLiveClear')?.addEventListener('click', () => confirm('Wyczyścić wszystkie nagrane kroki?') && send('/clear', {}));
    qs('#scraperLiveSideToggle')?.addEventListener('click', () => qs('#scraperLiveSide')?.classList.toggle('open'));
    qs('#scraperLiveType')?.addEventListener('click', typeFromBar);
    qs('#scraperLiveText')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); typeFromBar(); } });
    qs('#scraperLiveEnter')?.addEventListener('click', () => send('/key', { key: 'Enter' }));
    qs('#scraperLiveBackspace')?.addEventListener('click', () => send('/key', { key: 'Backspace' }));
    qs('#scraperLiveTab')?.addEventListener('click', () => send('/key', { key: 'Tab' }));

    const frame = qs('#scraperLiveFrame');
    frame?.addEventListener('click', onFrameClick);
    frame?.addEventListener('wheel', onFrameWheel, { passive: false });
    frame?.addEventListener('touchstart', onTouchStart, { passive: true });
    frame?.addEventListener('touchend', onTouchEnd, { passive: false });
  }

  async function onFrameClick(event) {
    if (!session || event.target?.id !== 'scraperLiveImage') return;
    const image = event.target;
    const rect = image.getBoundingClientRect();
    const x = Math.round((event.clientX - rect.left) * (session.viewportWidth / rect.width));
    const y = Math.round((event.clientY - rect.top) * (session.viewportHeight / rect.height));
    marker(event.clientX - rect.left, event.clientY - rect.top);
    try {
      const result = await send('/click', { x, y });
      if (result?.element?.editable) {
        const input = qs('#scraperLiveText');
        if (input) { input.placeholder = `Wpisz tekst do: ${result.element.label}`; if (window.matchMedia('(max-width: 900px)').matches) input.focus(); }
      }
    } catch (error) { inlineMessage(errorMessage(error), true); }
  }

  function onFrameWheel(event) {
    event.preventDefault();
    send('/scroll', { deltaY: Math.max(-1600, Math.min(1600, event.deltaY * 2)) }).catch(() => {});
  }

  function onTouchStart(event) {
    const touch = event.changedTouches?.[0];
    if (touch) touchStart = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }

  function onTouchEnd(event) {
    if (!touchStart) return;
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    const elapsed = Date.now() - touchStart.time;
    touchStart = null;
    if (Math.abs(dy) > 35 && Math.abs(dy) > Math.abs(dx)) {
      event.preventDefault();
      send('/scroll', { deltaY: Math.round(-dy * 5) }).catch(() => {});
    } else if (elapsed < 500) {
      const image = qs('#scraperLiveImage');
      if (!image || !session) return;
      const rect = image.getBoundingClientRect();
      const x = Math.round((touch.clientX - rect.left) * (session.viewportWidth / rect.width));
      const y = Math.round((touch.clientY - rect.top) * (session.viewportHeight / rect.height));
      send('/click', { x, y }).catch(() => {});
    }
  }

  async function navigateFromBar() {
    const value = qs('#scraperLiveAddress')?.value?.trim();
    if (!value) return;
    const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try { await send('/navigate', { url }); }
    catch (error) { inlineMessage(errorMessage(error), true); }
  }

  async function typeFromBar() {
    const input = qs('#scraperLiveText');
    const text = input?.value || '';
    if (!text) return;
    try {
      await send('/type', { text, replace: true });
      input.value = '';
    } catch (error) { inlineMessage(errorMessage(error), true); }
  }

  function renderState(next) {
    if (!next) return;
    session = next;
    const address = qs('#scraperLiveAddress');
    if (address && document.activeElement !== address) address.value = next.url || '';
    qs('#scraperLiveFrame')?.classList.toggle('mobile', Boolean(next.mobile));
    const recording = qs('#scraperLiveRecording');
    recording?.classList.toggle('on', Boolean(next.recording));
    if (recording) recording.textContent = next.recording ? '● Nagrywanie' : '○ Nagrywanie';
    const ads = qs('#scraperLiveAds');
    ads?.classList.toggle('on', Boolean(next.autoAds));
    if (ads) ads.textContent = next.autoAds ? 'Reklamy: auto' : 'Reklamy: ręcznie';
    const status = qs('#scraperLiveStatus');
    if (status) { status.textContent = `${next.steps?.length || 0} kroków`; status.classList.toggle('on', Boolean(next.recording)); }
    renderSteps(next.steps || []);
    renderEvents(next.events || []);
  }

  function renderSteps(steps) {
    const list = qs('#scraperLiveSteps');
    if (!list) return;
    list.innerHTML = steps.length ? steps.map((step, index) => `
      <div class="scraper-step"><div class="scraper-step-index">${index + 1}</div><div><strong>${escapeHtml(step.label || step.actionType)}</strong><small>${escapeHtml(step.selector || step.value || `${step.x ?? ''}, ${step.y ?? ''}`)}</small></div></div>`).join('') : '<div class="scraper-empty-state">Włącz nagrywanie i wykonuj działania w Chromium.</div>';
    list.scrollTop = list.scrollHeight;
  }

  function renderEvents(events) {
    const list = qs('#scraperLiveEvents');
    if (!list) return;
    const recent = events.slice(-40).reverse();
    list.innerHTML = recent.length ? recent.map((item) => `<div class="scraper-event ${escapeHtml(item.type)}"><strong>${escapeHtml(item.message)}</strong>${item.url ? `<br><small>${escapeHtml(item.url)}</small>` : ''}</div>`).join('') : '<div class="scraper-empty-state">Brak zdarzeń.</div>';
  }

  function showWorkspace(show) {
    qs('#scraperLiveWorkspace')?.classList.toggle('hidden', !show);
    document.body.style.overflow = show ? 'hidden' : '';
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

  function inlineMessage(text, error = false) {
    const box = qs('#scraperLiveMessage');
    if (!box) return;
    box.textContent = text;
    box.classList.toggle('error', error);
    box.hidden = false;
    setTimeout(() => { box.hidden = true; }, 4500);
  }

  async function runButton(selector, label, action) {
    const button = qs(selector);
    const old = button?.textContent;
    if (button) { button.disabled = true; button.textContent = label; }
    try { await action(); }
    catch (error) { inlineMessage(errorMessage(error), true); }
    finally { if (button) { button.disabled = false; button.textContent = old; } }
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

  window.ScraperLiveRuntime = { configure, open, close, saveProgram, api };
})();
