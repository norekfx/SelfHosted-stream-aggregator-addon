(() => {
  const titles = {
    dashboard: ['Dashboard', 'Szybki podgląd działania agregatora.'],
    install: ['Instalacja', 'Gotowe linki i checklisty dla Stremio/Nuvio.'],
    addons: ['Addony', 'Dodawanie, status i włączanie zewnętrznych addonów.'],
    cache: ['Cache', 'Zapamiętane działające wyniki dla szybkiego ponownego odtwarzania.'],
    history: ['Historia', 'Pełna historia sprawdzania i wyboru plików.'],
    diagnostics: ['Diagnostyka', 'Ręczne testowanie agregacji dla filmu lub odcinka.'],
    system: ['System', 'Health-check techniczny i logi systemowe.'],
    scraping: ['Scraping', 'Rekorderek scrapowania stron internetowych.'],
    settings: ['Ustawienia', 'Opcje ułatwiające codzienne używanie i dopasowanie do serwera.'],
    security: ['Bezpieczeństwo', 'Hasło administratora, aktywne sesje i wylogowanie urządzeń.'],
    library: ['Biblioteka', 'Podgląd bibliotek i metadanych.']
  };

  function select(selector) {
    return document.querySelector(selector);
  }

  function switchView(button) {
    const viewId = button?.dataset?.view;
    if (!viewId) return;
    const target = document.getElementById(viewId);
    if (!target) return;

    document.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.toggle('active', item === button);
    });
    document.querySelectorAll('.view').forEach((view) => {
      view.classList.toggle('active', view === target);
    });

    const [title, subtitle] = titles[viewId] ?? [button.textContent?.trim() || viewId, ''];
    const titleElement = select('#viewTitle');
    const subtitleElement = select('#viewSubtitle');
    if (titleElement) titleElement.textContent = title;
    if (subtitleElement) subtitleElement.textContent = subtitle;

    window.dispatchEvent(new CustomEvent('aggregator:view-changed', { detail: { viewId } }));
  }

  async function updateHealth() {
    const label = select('#healthLabel');
    const dot = select('.status-dot');
    try {
      const response = await fetch(`/health?_=${Date.now()}`, {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (label) label.textContent = 'API online';
      if (dot) dot.className = 'status-dot ok';
    } catch (error) {
      if (label) label.textContent = 'API offline';
      if (dot) dot.className = 'status-dot bad';
      console.error('Panel health-check failed:', error);
    }
  }

  function install() {
    if (window.__aggregatorPanelBootstrapInstalled) return;
    window.__aggregatorPanelBootstrapInstalled = true;

    document.addEventListener('click', (event) => {
      const button = event.target?.closest?.('.nav-item[data-view]');
      if (!button) return;
      event.preventDefault();
      switchView(button);
    }, true);

    select('#refreshBtn')?.addEventListener('click', () => void updateHealth());
    void updateHealth();
    window.setInterval(updateHealth, 30000);

    document.documentElement.dataset.panelBootstrap = 'active';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
