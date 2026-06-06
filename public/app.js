const state = {
  view: 'dashboard',
  user: null,
  needsRegistration: false,
  addons: [],
  cache: [],
  history: [],
  settings: {},
  sessions: [],
  healthReport: null,
  logs: []
};

const titles = {
  dashboard: ['Dashboard', 'Szybki podgląd działania agregatora.'],
  addons: ['Addony', 'Dodawanie, status i włączanie zewnętrznych addonów.'],
  cache: ['Cache', 'Zapamiętane działające wyniki dla szybkiego ponownego odtwarzania.'],
  history: ['Historia', 'Pełna historia sprawdzania i wyboru plików.'],
  diagnostics: ['Diagnostyka', 'Ręczne testowanie agregacji dla filmu lub odcinka.'],
  system: ['System', 'Health-check techniczny i mały panel logów błędów.'],
  settings: ['Ustawienia', 'Opcje ułatwiające codzienne używanie i dopasowanie do serwera.'],
  security: ['Bezpieczeństwo', 'Hasło administratora, aktywne sesje i wylogowanie urządzeń.']
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

init();

async function init() {
  bindNavigation();
  bindForms();
  await checkAuth();
}

async function checkAuth() {
  const status = await api('/auth/status');
  state.user = status.user ?? null;
  state.needsRegistration = Boolean(status.needsRegistration);

  if (status.authenticated) {
    showApp(status.user);
    await loadAll();
    return;
  }

  showAuth(status.needsRegistration);
}

function showAuth(needsRegistration) {
  $('#appShell').classList.add('hidden');
  $('#authScreen').classList.remove('hidden');
  $('#authTitle').textContent = needsRegistration ? 'Rejestracja administratora' : 'Logowanie administratora';
  $('#authSubtitle').textContent = needsRegistration ? 'Pierwsze uruchomienie' : 'Panel chroniony';
  $('#authDescription').textContent = needsRegistration
    ? 'Utwórz pierwsze konto administratora. Ten ekran pojawia się tylko przed pierwszą rejestracją.'
    : 'Zaloguj się, aby zarządzać addonami, cache, historią i ustawieniami.';
  $('#authSubmit').textContent = needsRegistration ? 'Zarejestruj' : 'Zaloguj';
}

function showApp(user) {
  $('#authScreen').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
  $('#userLabel').textContent = user ? `Zalogowano: ${user.username}` : '';
}

function bindNavigation() {
  $$('.nav-item').forEach((button) => {
    button.addEventListener('click', async () => {
      state.view = button.dataset.view;
      $$('.nav-item').forEach((item) => item.classList.toggle('active', item === button));
      $$('.view').forEach((view) => view.classList.toggle('active', view.id === state.view));
      $('#viewTitle').textContent = titles[state.view][0];
      $('#viewSubtitle').textContent = titles[state.view][1];
      await refreshCurrentView();
    });
  });

  $('#refreshBtn').addEventListener('click', refreshCurrentView);
  $('#reloadCacheBtn').addEventListener('click', loadCache);
  $('#reloadSessionsBtn').addEventListener('click', loadSessions);
  $('#runHealthCheckBtn').addEventListener('click', loadTechnicalHealth);
  $('#reloadLogsBtn').addEventListener('click', loadSystemLogs);
  $('#clearLogsBtn').addEventListener('click', clearSystemLogs);
  $('#logLevelFilter').addEventListener('change', loadSystemLogs);
  $('#logoutBtn').addEventListener('click', logout);
  $('#logoutOtherSessionsBtn').addEventListener('click', logoutOtherSessions);
  $('#logoutAllSessionsBtn').addEventListener('click', logoutAllSessions);
}

function bindForms() {
  $('#authForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = $('#authUsername').value.trim();
    const password = $('#authPassword').value;
    const endpoint = state.needsRegistration ? '/auth/register' : '/auth/login';
    const result = await api(endpoint, { method: 'POST', body: { username, password } });
    $('#authPassword').value = '';
    state.user = result.user;
    showApp(result.user);
    toast(state.needsRegistration ? 'Administrator utworzony.' : 'Zalogowano.');
    await loadAll();
  });

  $('#addonForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const manifestUrl = $('#addonUrl').value.trim();
    await api('/admin/addons', { method: 'POST', body: { manifestUrl } });
    $('#addonUrl').value = '';
    toast('Addon dodany.');
    await loadAddons();
  });

  $('#diagnosticsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const type = $('#diagType').value;
    const id = $('#diagId').value.trim();
    $('#diagnosticsOutput').textContent = 'Uruchamianie diagnostyki...';
    const result = await api(`/admin/aggregate/${type}/${encodeURIComponent(id)}`);
    $('#diagnosticsOutput').textContent = JSON.stringify(result, null, 2);
  });

  $('#settingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = {
      preferredAudioLanguage: $('#preferredAudioLanguage').value.trim(),
      preferredSubtitleLanguage: $('#preferredSubtitleLanguage').value.trim(),
      defaultTranscodeBufferPreset: $('#defaultTranscodeBufferPreset').value,
      streamValidationTimeoutMs: Number($('#streamValidationTimeoutMs').value),
      maxTranscodeSessions: Number($('#maxTranscodeSessions').value),
      publicBaseUrl: $('#publicBaseUrl').value.trim(),
      autoRefreshCache: $('#autoRefreshCache').checked,
      showDiagnosticDetails: $('#showDiagnosticDetails').checked
    };

    const result = await api('/admin/settings', { method: 'PATCH', body });
    state.settings = result.settings;
    renderSettings();
    toast('Ustawienia zapisane.');
  });

  $('#changePasswordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await api('/auth/change-password', {
      method: 'POST',
      body: {
        currentPassword: $('#currentPassword').value,
        newPassword: $('#newPassword').value
      }
    });
    $('#currentPassword').value = '';
    $('#newPassword').value = '';
    toast('Hasło zmienione.');
  });
}

async function logout() {
  await api('/auth/logout', { method: 'POST' });
  resetPrivateState();
  showAuth(false);
}

async function logoutOtherSessions() {
  await api('/auth/logout-other-sessions', { method: 'POST' });
  toast('Inne sesje zostały wylogowane.');
  await loadSessions();
}

async function logoutAllSessions() {
  await api('/auth/logout-all-sessions', { method: 'POST' });
  resetPrivateState();
  showAuth(false);
}

function resetPrivateState() {
  state.user = null;
  state.addons = [];
  state.cache = [];
  state.history = [];
  state.sessions = [];
  state.healthReport = null;
  state.logs = [];
}

async function loadAll() {
  await Promise.allSettled([checkHealth(), loadSettings(), loadAddons(), loadCache(), loadHistory(), loadSessions(), loadTechnicalHealth(), loadSystemLogs()]);
  renderDashboard();
}

async function refreshCurrentView() {
  if (state.view === 'dashboard') await loadAll();
  if (state.view === 'addons') await loadAddons();
  if (state.view === 'cache') await loadCache();
  if (state.view === 'history') await loadHistory();
  if (state.view === 'system') await Promise.all([loadTechnicalHealth(), loadSystemLogs()]);
  if (state.view === 'settings') await loadSettings();
  if (state.view === 'security') await loadSessions();
}

async function checkHealth() {
  try {
    await api('/health');
    $('.status-dot').className = 'status-dot ok';
    $('#healthLabel').textContent = 'API online';
  } catch {
    $('.status-dot').className = 'status-dot bad';
    $('#healthLabel').textContent = 'API offline';
  }
}

async function loadSettings() {
  const data = await api('/admin/settings');
  state.settings = data.settings;
  renderSettings();
  renderSettingsSummary();
}

async function loadAddons() {
  const data = await api('/admin/addons');
  state.addons = data.addons ?? [];
  renderAddons();
  renderDashboard();
}

async function loadCache() {
  const data = await api('/admin/cache?limit=100');
  state.cache = data.cache ?? [];
  renderCache();
  renderDashboard();
}

async function loadHistory() {
  const data = await api('/admin/history?limit=100');
  state.history = data.history ?? [];
  renderHistory();
  renderDashboard();
}

async function loadSessions() {
  const data = await api('/auth/sessions');
  state.sessions = data.sessions ?? [];
  renderSessions();
}

async function loadTechnicalHealth() {
  const data = await api('/admin/system/health');
  state.healthReport = data.report;
  renderTechnicalHealth();
}

async function loadSystemLogs() {
  const level = $('#logLevelFilter').value;
  const query = level ? `?level=${encodeURIComponent(level)}&limit=100` : '?limit=100';
  const data = await api(`/admin/system/logs${query}`);
  state.logs = data.logs ?? [];
  renderSystemLogs();
}

async function clearSystemLogs() {
  await api('/admin/system/logs', { method: 'DELETE' });
  state.logs = [];
  renderSystemLogs();
  toast('Logi wyczyszczone.');
}

function renderDashboard() {
  $('#statAddons').textContent = state.addons.length;
  $('#statOnline').textContent = state.addons.filter((addon) => addon.status === 'online').length;
  $('#statCache').textContent = state.cache.length;
  $('#statHistory').textContent = state.history.length;

  const recent = state.cache.slice(0, 5);
  $('#recentCache').innerHTML = recent.length
    ? recent.map((item) => `<div class="kv"><span>${escapeHtml(item.type)}:${escapeHtml(item.mediaId)}</span><strong>${badge(item.status)}</strong></div>`).join('')
    : 'Brak danych.';
  $('#recentCache').classList.toggle('empty', recent.length === 0);
  renderSettingsSummary();
}

function renderSettingsSummary() {
  const s = state.settings ?? {};
  $('#settingsSummary').innerHTML = [
    ['Audio', s.preferredAudioLanguage],
    ['Napisy', s.preferredSubtitleLanguage],
    ['Bufor', s.defaultTranscodeBufferPreset],
    ['Timeout walidacji', `${s.streamValidationTimeoutMs ?? '-'} ms`],
    ['Sesje transkodowania', s.maxTranscodeSessions],
    ['Publiczny URL', s.publicBaseUrl || 'nie ustawiono']
  ].map(([key, value]) => `<div class="kv"><span>${key}</span><strong>${escapeHtml(String(value ?? '-'))}</strong></div>`).join('');
}

function renderAddons() {
  if (!state.addons.length) {
    $('#addonsList').innerHTML = '<div class="list empty">Nie dodano addonów.</div>';
    return;
  }

  $('#addonsList').innerHTML = table(['Nazwa', 'Status', 'Zasoby', 'Typy', 'Czas', 'Akcje'], state.addons.map((addon) => [
    `<strong>${escapeHtml(addon.name ?? addon.manifestUrl)}</strong><br><small>${escapeHtml(addon.manifestUrl)}</small>`,
    badge(addon.status),
    escapeHtml((addon.supportedResources ?? []).join(', ') || '-'),
    escapeHtml((addon.supportedTypes ?? []).join(', ') || '-'),
    `${addon.responseTimeMs ?? '-'} ms`,
    `<div class="action-row"><button class="small-btn" data-check-addon="${addon.id}">Sprawdź</button><button class="small-btn" data-toggle-addon="${addon.id}" data-enabled="${!addon.enabled}">${addon.enabled ? 'Wyłącz' : 'Włącz'}</button></div>`
  ]));

  $$('[data-check-addon]').forEach((button) => button.addEventListener('click', async () => {
    await api(`/admin/addons/${button.dataset.checkAddon}/check`, { method: 'POST' });
    toast('Sprawdzono addon.');
    await loadAddons();
  }));

  $$('[data-toggle-addon]').forEach((button) => button.addEventListener('click', async () => {
    await api(`/admin/addons/${button.dataset.toggleAddon}`, { method: 'PATCH', body: { enabled: button.dataset.enabled === 'true' } });
    toast('Zmieniono status addonu.');
    await loadAddons();
  }));
}

function renderCache() {
  if (!state.cache.length) {
    $('#cacheList').innerHTML = '<div class="list empty">Cache jest pusty.</div>';
    return;
  }

  $('#cacheList').innerHTML = table(['Media', 'Status', 'Wybrany plik', 'Statystyki', 'Ostatnia aktualizacja', 'Akcje'], state.cache.map((item) => [
    `<strong>${escapeHtml(item.type)}:${escapeHtml(item.mediaId)}</strong>`,
    badge(item.status),
    escapeHtml(item.selectedOriginal?.title ?? '-'),
    escapeHtml(formatStats(item.stats)),
    escapeHtml(formatDate(item.updatedAt)),
    `<button class="small-btn" data-refresh-cache="${item.type}:${item.mediaId}">Odśwież</button>`
  ]));

  $$('[data-refresh-cache]').forEach((button) => button.addEventListener('click', async () => {
    const [type, id] = button.dataset.refreshCache.split(':');
    await api(`/admin/cache/${type}/${encodeURIComponent(id)}/refresh`, { method: 'POST' });
    toast('Cache odświeżony.');
    await loadCache();
  }));
}

function renderHistory() {
  if (!state.history.length) {
    $('#historyList').innerHTML = '<div class="list empty">Brak historii.</div>';
    return;
  }

  $('#historyList').innerHTML = table(['Data', 'Media', 'Streamy', 'Działające', 'Błędne', 'Wybrany Original'], state.history.map((item) => [
    escapeHtml(formatDate(item.searchedAt)),
    `${escapeHtml(item.type)}:${escapeHtml(item.mediaId)}`,
    item.streamCount,
    item.workingStreamCount,
    item.failedStreamCount,
    escapeHtml(item.selectedOriginal?.title ?? '-')
  ]));
}

function renderTechnicalHealth() {
  const report = state.healthReport;
  if (!report) {
    $('#technicalHealth').innerHTML = '<div class="list empty">Nie uruchomiono testu.</div>';
    return;
  }

  $('#technicalHealth').innerHTML = table(['Status', 'Test', 'Wiadomość', 'Szczegóły'], report.checks.map((check) => [
    badge(check.status),
    escapeHtml(check.name),
    escapeHtml(check.message),
    `<pre class="mini-code">${escapeHtml(JSON.stringify(check.details ?? {}, null, 2))}</pre>`
  ]));
}

function renderSystemLogs() {
  if (!state.logs.length) {
    $('#systemLogs').innerHTML = '<div class="list empty">Brak logów dla wybranego filtra.</div>';
    return;
  }

  $('#systemLogs').innerHTML = table(['Data', 'Poziom', 'Źródło', 'Komunikat', 'Szczegóły'], state.logs.map((log) => [
    escapeHtml(formatDate(log.createdAt)),
    badge(log.level),
    escapeHtml(log.source),
    escapeHtml(log.message),
    `<pre class="mini-code">${escapeHtml(JSON.stringify(log.details ?? {}, null, 2))}</pre>`
  ]));
}

function renderSessions() {
  if (!state.sessions.length) {
    $('#sessionsList').innerHTML = '<div class="list empty">Brak aktywnych sesji.</div>';
    return;
  }

  $('#sessionsList').innerHTML = table(['Sesja', 'Utworzona', 'Ostatnio widziana', 'Wygasa'], state.sessions.map((session) => [
    session.isCurrent ? badge('current') : escapeHtml(session.id.slice(0, 8)),
    escapeHtml(formatDate(session.createdAt)),
    escapeHtml(formatDate(session.lastSeenAt)),
    escapeHtml(formatDate(session.expiresAt))
  ]));
}

function renderSettings() {
  const s = state.settings ?? {};
  $('#preferredAudioLanguage').value = s.preferredAudioLanguage ?? 'pl';
  $('#preferredSubtitleLanguage').value = s.preferredSubtitleLanguage ?? 'pl';
  $('#defaultTranscodeBufferPreset').value = s.defaultTranscodeBufferPreset ?? 'auto';
  $('#streamValidationTimeoutMs').value = s.streamValidationTimeoutMs ?? 10000;
  $('#maxTranscodeSessions').value = s.maxTranscodeSessions ?? 2;
  $('#publicBaseUrl').value = s.publicBaseUrl ?? '';
  $('#autoRefreshCache').checked = s.autoRefreshCache !== false;
  $('#showDiagnosticDetails').checked = s.showDiagnosticDetails !== false;
}

function table(headers, rows) {
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function badge(value) {
  return `<span class="badge ${escapeHtml(String(value))}">${escapeHtml(String(value ?? '-'))}</span>`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.startsWith('/auth/')) {
    showAuth(false);
    throw new Error('Sesja wygasła. Zaloguj się ponownie.');
  }
  if (!response.ok) {
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  return data;
}

function formatStats(stats = {}) {
  return `działa: ${stats.workingStreamCount ?? 0}, błędy: ${stats.failedStreamCount ?? 0}, wszystkie: ${stats.streamCount ?? 0}`;
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function toast(message) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2500);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
