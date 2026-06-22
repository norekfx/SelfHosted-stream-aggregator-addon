(() => {
  if (window.__scraperTabsUi) return;
  window.__scraperTabsUi = true;

  let currentSessionId = '';
  let pollTimer = null;

  function qs(selector) { return document.querySelector(selector); }

  function boot() {
    ensureCss();
    const wait = () => {
      const workspace = qs('#scraperLiveWorkspace');
      const toolbar = qs('.scraper-browser-toolbar');
      if (!workspace || !toolbar) return setTimeout(wait, 100);
      ensureTabbar(toolbar);
      improveAdButton();
      startPolling();
    };
    wait();
  }

  function ensureCss() {
    if (qs('#scraperTabsCss')) return;
    const link = document.createElement('link');
    link.id = 'scraperTabsCss';
    link.rel = 'stylesheet';
    link.href = '/scraper-tabs-ui.css?v=20260622-tabs';
    document.head.appendChild(link);
  }

  function ensureTabbar(toolbar) {
    if (qs('#scraperLiveTabs')) return;
    toolbar.insertAdjacentHTML('afterend', '<div id="scraperLiveTabs" class="scraper-tabbar hidden"><button id="scraperLiveNewTab" class="ghost-btn scraper-tab-new" type="button" title="Nowa karta">+</button></div>');
    qs('#scraperLiveTabs')?.addEventListener('click', onTabbarClick);
    qs('#scraperLiveNewTab')?.addEventListener('click', async (event) => {
      event.stopPropagation();
      const id = resolveSessionId();
      if (!id) return;
      try {
        await api(`/admin/scraping/live/${encodeURIComponent(id)}/tabs`, { method: 'POST', body: {} });
        await refreshTabs();
      } catch (error) { showMessage(errorMessage(error), true); }
    });
  }

  function improveAdButton() {
    const button = qs('#scraperLiveMarkAd');
    if (!button) return;
    button.textContent = 'Reklama po tym kliknięciu';
    button.title = 'Oznacza ostatni krok kliknięcia jako mogący otworzyć reklamę, zamyka bieżącą kartę reklamową i wraca do najbardziej podobnej karty źródłowej.';
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(refreshTabs, 700);
    refreshTabs();
  }

  function resolveSessionId() {
    const image = qs('#scraperLiveImage');
    const source = image?.getAttribute('src') || image?.src || '';
    const match = source.match(/\/admin\/scraping\/live\/([^/]+)\/screenshot/);
    if (match?.[1]) currentSessionId = decodeURIComponent(match[1]);
    return currentSessionId;
  }

  async function refreshTabs() {
    const workspace = qs('#scraperLiveWorkspace');
    const tabbar = qs('#scraperLiveTabs');
    if (!workspace || !tabbar || workspace.classList.contains('hidden') || workspace.classList.contains('test-mode')) {
      tabbar?.classList.add('hidden');
      return;
    }
    const id = resolveSessionId();
    if (!id) return;
    try {
      const data = await api(`/admin/scraping/live/${encodeURIComponent(id)}`);
      renderTabs(data.session?.tabs || []);
      decorateAdSteps(data.session?.steps || []);
    } catch {
      // The main runtime already reports session errors.
    }
  }

  function renderTabs(tabs) {
    const tabbar = qs('#scraperLiveTabs');
    if (!tabbar) return;
    tabbar.classList.remove('hidden');
    const newButton = qs('#scraperLiveNewTab');
    tabbar.querySelectorAll('.scraper-tab').forEach((element) => element.remove());
    const html = tabs.map((tab) => `<div class="scraper-tab ${tab.active ? 'active' : ''}" data-tab-id="${escapeHtml(tab.id)}" title="${escapeHtml(tab.url || '')}"><span class="scraper-tab-label">${escapeHtml(tab.label || tab.url || 'Nowa karta')}</span><button class="scraper-tab-close" type="button" data-close-tab="${escapeHtml(tab.id)}" aria-label="Zamknij kartę">×</button></div>`).join('');
    newButton?.insertAdjacentHTML('beforebegin', html);
  }

  async function onTabbarClick(event) {
    const close = event.target.closest('[data-close-tab]');
    const tab = event.target.closest('[data-tab-id]');
    const id = resolveSessionId();
    if (!id) return;
    try {
      if (close) {
        event.stopPropagation();
        await api(`/admin/scraping/live/${encodeURIComponent(id)}/tabs/${encodeURIComponent(close.dataset.closeTab)}`, { method: 'DELETE' });
      } else if (tab) {
        await api(`/admin/scraping/live/${encodeURIComponent(id)}/tabs/${encodeURIComponent(tab.dataset.tabId)}/activate`, { method: 'POST', body: {} });
      }
      await refreshTabs();
    } catch (error) { showMessage(errorMessage(error), true); }
  }

  function decorateAdSteps(steps) {
    const list = qs('#scraperLiveSteps');
    if (!list) return;
    const cards = [...list.querySelectorAll('.scraper-step')];
    cards.forEach((card, index) => {
      card.querySelector('.scraper-ad-step-hint')?.remove();
      const step = steps[index];
      if (!step || !String(step.value || '').startsWith('__ssa_click_meta__:')) return;
      try {
        const metadata = JSON.parse(String(step.value).slice('__ssa_click_meta__:'.length));
        if (metadata.expectAdPopup) card.querySelector('div:last-child')?.insertAdjacentHTML('beforeend', '<span class="scraper-ad-step-hint">może otworzyć reklamę</span>');
      } catch {
        // Ignore malformed legacy metadata.
      }
    });
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
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  function showMessage(text, error = false) {
    const box = qs('#scraperLiveMessage');
    if (!box) return;
    box.textContent = text;
    box.classList.toggle('error', error);
    box.hidden = false;
    setTimeout(() => { box.hidden = true; }, 5000);
  }

  function errorMessage(error) { return error instanceof Error ? error.message : String(error); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
