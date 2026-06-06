const state = {
  view: 'dashboard',
  addons: [],
  cache: [],
  history: [],
  settings: {}
};

const titles = {
  dashboard: ['Dashboard', 'Szybki podgląd działania agregatora.'],
  addons: ['Addony', 'Dodawanie, status i włączanie zewnętrznych addonów.'],
  cache: ['Cache', 'Zapamiętane działające wyniki dla szybkiego ponownego odtwarzania.'],
  history: ['Historia', 'Pełna historia sprawdzania i wyboru plików.'],
  diagnostics: ['Diagnostyka', 'Ręczne testowanie agregacji dla filmu lub odcinka.'],
  settings: ['Ustawienia', 'Opcje ułatwiające codzienne używanie i dopasowanie do serwera.']
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

init();

async function init() {
  bindNavigation();
  bindForms();
  await loadAll();
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
}

function bindForms() {
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
}

async function loadAll() {
  await Promise.allSettled([checkHealth(), loadSettings(), loadAddons(), loadCache(), loadHistory()]);
  renderDashboard();
}

async function refreshCurrentView() {
  if (state.view === 'dashboard') await loadAll();
  if (state.view === 'addons') await loadAddons();
  if (state.view === 'cache') await loadCache();
  if (state.view === 'history') await loadHistory();
  if (state.view === 'settings') await loadSettings();
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
  el.textContent = message;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2500);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
