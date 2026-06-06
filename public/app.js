const fallbackLanguages = [
  ['pl', 'Polski / Polish'], ['en', 'English / English'], ['de', 'Deutsch / German'], ['fr', 'Français / French'],
  ['es', 'Español / Spanish'], ['it', 'Italiano / Italian'], ['pt', 'Português / Portuguese'], ['nl', 'Nederlands / Dutch'],
  ['cs', 'Čeština / Czech'], ['sk', 'Slovenčina / Slovak'], ['uk', 'Українська / Ukrainian'], ['ru', 'Русский / Russian'],
  ['sv', 'Svenska / Swedish'], ['no', 'Norsk / Norwegian'], ['da', 'Dansk / Danish'], ['fi', 'Suomi / Finnish'],
  ['tr', 'Türkçe / Turkish'], ['ro', 'Română / Romanian'], ['hu', 'Magyar / Hungarian'], ['el', 'Ελληνικά / Greek']
].map(([code, label]) => ({ code, label }));

const state = {
  view: 'dashboard',
  user: null,
  needsRegistration: false,
  addons: [],
  cache: [],
  history: [],
  settings: {},
  languages: fallbackLanguages,
  sessions: [],
  healthReport: null,
  logs: [],
  historyDetails: null
};

const titles = {
  dashboard: ['Dashboard', 'Szybki podgląd działania agregatora.'],
  install: ['Instalacja', 'Gotowe linki i checklisty dla Stremio/Nuvio.'],
  addons: ['Addony', 'Dodawanie, status i włączanie zewnętrznych addonów.'],
  cache: ['Cache', 'Zapamiętane działające wyniki dla szybkiego ponownego odtwarzania.'],
  history: ['Historia', 'Pełna historia sprawdzania i wyboru plików.'],
  diagnostics: ['Diagnostyka', 'Ręczne testowanie agregacji dla filmu lub odcinka.'],
  system: ['System', 'Health-check techniczny i logi systemowe.'],
  settings: ['Ustawienia', 'Opcje ułatwiające codzienne używanie i dopasowanie do serwera.'],
  security: ['Bezpieczeństwo', 'Hasło administratora, aktywne sesje i wylogowanie urządzeń.']
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

init();

async function init() {
  bindNavigation();
  bindForms();
  renderLanguageSelects();
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
  $('#runHealthCheckBtn').addEventListener('click', () => runButtonAction($('#runHealthCheckBtn'), 'Test...', loadTechnicalHealth));
  $('#reloadLogsBtn').addEventListener('click', loadSystemLogs);
  $('#clearLogsBtn').addEventListener('click', clearSystemLogs);
  $('#logLevelFilter').addEventListener('change', loadSystemLogs);
  $('#copyManifestBtn').addEventListener('click', () => copyText(getManifestUrl(), 'Skopiowano URL manifestu.'));
  $('#copyTestStreamBtn').addEventListener('click', () => copyText(getTestStreamUrl(), 'Skopiowano testowy URL streamów.'));
  $('#diagnosticsOutputSize').addEventListener('change', updateDiagnosticsOutputSize);
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
    await loadSystemLogs();
  });

  $('#diagnosticsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await runDiagnostics();
  });

  $('#settingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = {
      preferredAudioLanguage: $('#preferredAudioLanguage').value || 'pl',
      preferredSubtitleLanguage: $('#preferredSubtitleLanguage').value || 'pl',
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
    renderInstall();
    toast('Ustawienia zapisane.');
    await loadSystemLogs();
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

async function logout() { await api('/auth/logout', { method: 'POST' }); resetPrivateState(); showAuth(false); }
async function logoutOtherSessions() { await api('/auth/logout-other-sessions', { method: 'POST' }); toast('Inne sesje zostały wylogowane.'); await loadSessions(); }
async function logoutAllSessions() { await api('/auth/logout-all-sessions', { method: 'POST' }); resetPrivateState(); showAuth(false); }
function resetPrivateState() { state.user = null; state.addons = []; state.cache = []; state.history = []; state.sessions = []; state.healthReport = null; state.logs = []; state.historyDetails = null; }

async function loadAll() {
  await Promise.allSettled([checkHealth(), loadLanguages(), loadSettings(), loadAddons(), loadCache(), loadHistory(), loadSessions(), loadTechnicalHealth(), loadSystemLogs()]);
  renderDashboard(); renderInstall();
}

async function refreshCurrentView() {
  if (state.view === 'dashboard') await loadAll();
  if (state.view === 'install') renderInstall();
  if (state.view === 'addons') await loadAddons();
  if (state.view === 'cache') await loadCache();
  if (state.view === 'history') await loadHistory();
  if (state.view === 'system') await Promise.all([loadTechnicalHealth(), loadSystemLogs()]);
  if (state.view === 'settings') await Promise.all([loadLanguages(), loadSettings()]);
  if (state.view === 'security') await loadSessions();
}

async function checkHealth() { try { await api('/health'); $('.status-dot').className = 'status-dot ok'; $('#healthLabel').textContent = 'API online'; } catch { $('.status-dot').className = 'status-dot bad'; $('#healthLabel').textContent = 'API offline'; } }

async function loadLanguages() {
  try {
    const data = await api('/admin/languages');
    const languages = data.languages ?? [];
    state.languages = languages.length ? languages : fallbackLanguages;
  } catch {
    state.languages = fallbackLanguages;
  }
  renderLanguageSelects();
}

async function loadSettings() { const data = await api('/admin/settings'); state.settings = data.settings; renderSettings(); renderSettingsSummary(); renderInstall(); }
async function loadAddons() { const data = await api('/admin/addons'); state.addons = data.addons ?? []; renderAddons(); renderDashboard(); renderInstall(); }
async function loadCache() { const data = await api('/admin/cache?limit=100'); state.cache = data.cache ?? []; renderCache(); renderDashboard(); }
async function loadHistory() { const data = await api('/admin/history?limit=100'); state.history = data.history ?? []; renderHistory(); renderDashboard(); }
async function loadHistoryDetails(historyId) { $('#historyDetails').innerHTML = '<div class="list empty">Sprawdzam znalezione pliki...</div>'; const data = await api(`/admin/history/${encodeURIComponent(historyId)}`); state.historyDetails = data.details; renderHistoryDetails(); }
async function loadSessions() { const data = await api('/auth/sessions'); state.sessions = data.sessions ?? []; renderSessions(); }
async function loadTechnicalHealth() { const data = await api('/admin/system/health'); state.healthReport = data.report; renderTechnicalHealth(); renderInstall(); toast(`Health-check: ${data.report.status}`); }
async function loadSystemLogs() { const level = $('#logLevelFilter').value; const query = level ? `?level=${encodeURIComponent(level)}&limit=200` : '?limit=200'; const data = await api(`/admin/system/logs${query}`); state.logs = data.logs ?? []; renderSystemLogs(); }
async function clearSystemLogs() { await api('/admin/system/logs', { method: 'DELETE' }); await loadSystemLogs(); toast('Logi wyczyszczone.'); }

async function runDiagnostics() {
  const type = $('#diagType').value;
  const id = $('#diagId').value.trim();
  const button = $('#runDiagnosticsBtn');
  await runButtonAction(button, 'Pracuje...', async () => {
    $('#diagnosticsOutput').textContent = 'Diagnostyka pracuje...';
    toast('Diagnostyka pracuje...');
    const result = await api(`/admin/aggregate/${type}/${encodeURIComponent(id)}`);
    $('#diagnosticsOutput').textContent = JSON.stringify(result, null, 2);
    toast(result.selectedOriginal ? 'Diagnostyka zakończona: znaleziono działający Original.' : 'Diagnostyka zakończona: brak działającego Original.');
    await loadHistory(); await loadSystemLogs();
  });
}

function renderDashboard() { $('#statAddons').textContent = state.addons.length; $('#statOnline').textContent = state.addons.filter((addon) => addon.status === 'online').length; $('#statCache').textContent = state.cache.length; $('#statHistory').textContent = state.history.length; const recent = state.cache.slice(0, 5); $('#recentCache').innerHTML = recent.length ? recent.map((item) => `<div class="kv"><span>${escapeHtml(item.type)}:${escapeHtml(item.mediaId)}</span><strong>${badge(item.status)}</strong></div>`).join('') : 'Brak danych.'; $('#recentCache').classList.toggle('empty', recent.length === 0); renderSettingsSummary(); }
function renderSettingsSummary() { const s = state.settings ?? {}; $('#settingsSummary').innerHTML = [['Audio', languageLabel(s.preferredAudioLanguage)], ['Napisy', languageLabel(s.preferredSubtitleLanguage)], ['Bufor', s.defaultTranscodeBufferPreset], ['Timeout walidacji', `${s.streamValidationTimeoutMs ?? '-'} ms`], ['Sesje transkodowania', s.maxTranscodeSessions], ['Publiczny URL', s.publicBaseUrl || 'nie ustawiono']].map(([key, value]) => `<div class="kv"><span>${key}</span><strong>${escapeHtml(String(value ?? '-'))}</strong></div>`).join(''); }
function renderInstall() { const manifestUrl = getManifestUrl(); const testStreamUrl = getTestStreamUrl(); $('#manifestInstallUrl').textContent = manifestUrl; $('#testStreamUrl').textContent = testStreamUrl; const baseUrl = getInstallBaseUrl(); const healthStatus = state.healthReport?.status ?? 'warn'; const hasHttps = baseUrl.startsWith('https://'); const hasAddons = state.addons.length > 0; const hasOnlineAddon = state.addons.some((addon) => addon.status === 'online'); const checks = [['Publiczny URL', hasHttps ? 'ok' : 'warn', hasHttps ? 'Skonfigurowano HTTPS.' : 'Dla zdalnego Stremio/Nuvio ustaw HTTPS w Publicznym URL.'], ['Manifest', 'ok', 'Endpoint manifestu pozostaje publiczny.'], ['Playback bez logowania', 'ok', 'Stream/proxy/transcode endpointy są publiczne dla klientów.'], ['Addony', hasAddons ? (hasOnlineAddon ? 'ok' : 'warn') : 'warn', hasAddons ? (hasOnlineAddon ? 'Masz co najmniej jeden addon online.' : 'Addony są dodane, ale żaden nie jest online.') : 'Dodaj co najmniej jeden zewnętrzny addon.'], ['Health-check', healthStatus, state.healthReport ? `Ostatni status: ${healthStatus}.` : 'Uruchom test w zakładce System.']]; $('#installChecklist').innerHTML = checks.map(([label, status, message]) => `<div class="check-item"><div><strong>${escapeHtml(label)}</strong><br><span>${escapeHtml(message)}</span></div>${badge(status)}</div>`).join(''); }

function renderAddons() {
  if (!state.addons.length) { $('#addonsList').innerHTML = '<div class="list empty">Nie dodano addonów.</div>'; return; }
  $('#addonsList').innerHTML = table(['Nazwa', 'Status', 'Tryb', 'Zasoby', 'Typy', 'Czas', 'Akcje'], state.addons.map((addon) => { const toggleClass = addon.enabled ? (addon.status === 'online' ? 'enabled' : 'warning') : 'disabled'; return [`<strong>${escapeHtml(addon.name ?? addon.manifestUrl)}</strong><br><small>${escapeHtml(addon.manifestUrl)}</small>`, badge(addon.status), badge(addon.enabled ? 'enabled' : 'disabled'), escapeHtml((addon.supportedResources ?? []).join(', ') || '-'), escapeHtml((addon.supportedTypes ?? []).join(', ') || '-'), `${addon.responseTimeMs ?? '-'} ms`, `<div class="action-row"><button class="small-btn" data-check-addon="${addon.id}">Sprawdź</button><button class="small-btn ${toggleClass}" data-toggle-addon="${addon.id}" data-enabled="${!addon.enabled}">${addon.enabled ? 'Wyłącz' : 'Włącz'}</button></div>`]; }));
  $$('[data-check-addon]').forEach((button) => button.addEventListener('click', async () => { await runButtonAction(button, 'Sprawdzam...', async () => { const data = await api(`/admin/addons/${button.dataset.checkAddon}/check`, { method: 'POST' }); toast(data.addon?.status === 'online' ? 'Addon działa.' : `Addon ma błąd: ${data.addon?.lastError ?? 'nieznany błąd'}`); await loadAddons(); await loadSystemLogs(); }); }));
  $$('[data-toggle-addon]').forEach((button) => button.addEventListener('click', async () => { await api(`/admin/addons/${button.dataset.toggleAddon}`, { method: 'PATCH', body: { enabled: button.dataset.enabled === 'true' } }); toast('Zmieniono status addonu.'); await loadAddons(); await loadSystemLogs(); }));
}

function renderCache() { if (!state.cache.length) { $('#cacheList').innerHTML = '<div class="list empty">Cache jest pusty.</div>'; return; } $('#cacheList').innerHTML = table(['Media', 'Status', 'Wybrany plik', 'Statystyki', 'Ostatnia aktualizacja', 'Akcje'], state.cache.map((item) => [`<strong>${escapeHtml(item.type)}:${escapeHtml(item.mediaId)}</strong>`, badge(item.status), escapeHtml(item.selectedOriginal?.title ?? '-'), escapeHtml(formatStats(item.stats)), escapeHtml(formatDate(item.updatedAt)), `<button class="small-btn" data-refresh-cache="${item.type}:${item.mediaId}">Odśwież</button>`])); $$('[data-refresh-cache]').forEach((button) => button.addEventListener('click', async () => { const { type, id } = parseTypedMediaId(button.dataset.refreshCache); await runButtonAction(button, 'Odświeżam...', async () => { await api(`/admin/cache/${type}/${encodeURIComponent(id)}/refresh`, { method: 'POST' }); toast('Cache odświeżony.'); await loadCache(); await loadSystemLogs(); }); })); }
function renderHistory() { if (!state.history.length) { $('#historyList').innerHTML = '<div class="list empty">Brak historii.</div>'; return; } $('#historyList').innerHTML = table(['Data', 'Media', 'Streamy', 'Działające', 'Błędne', 'Wybrany Original', 'Akcje'], state.history.map((item) => [escapeHtml(formatDate(item.searchedAt)), `${escapeHtml(item.type)}:${escapeHtml(item.mediaId)}`, item.streamCount, item.workingStreamCount, item.failedStreamCount, escapeHtml(item.selectedOriginal?.title ?? '-'), `<button class="small-btn" data-history-details="${item.id}">Sprawdź</button>`])); $$('[data-history-details]').forEach((button) => button.addEventListener('click', async () => { await runButtonAction(button, 'Sprawdzam...', async () => loadHistoryDetails(button.dataset.historyDetails)); })); }
function renderHistoryDetails() { const details = state.historyDetails; if (!details?.result) { $('#historyDetails').innerHTML = '<div class="list empty">Brak szczegółów dla tego wpisu.</div>'; return; } const selectedId = details.selectedOriginal?.id; const streams = details.result.rankedStreams ?? []; $('#historyDetails').innerHTML = `<div class="kv-list"><div class="kv"><span>Media</span><strong>${escapeHtml(details.type)}:${escapeHtml(details.mediaId)}</strong></div><div class="kv"><span>Wybrany Original</span><strong>${escapeHtml(details.selectedOriginal?.title ?? 'brak')}</strong></div><div class="kv"><span>Statystyki</span><strong>${details.workingStreamCount}/${details.streamCount} działa</strong></div></div><p>To jest analiza wyniku wyszukiwania. Każdy znaleziony plik jest pokazany osobno z powodem wyboru albo odrzucenia.</p><h3>Znalezione pliki</h3>${streams.length ? streams.map((stream) => renderStreamCard(stream, selectedId)).join('') : '<div class="list empty">Brak plików w szczegółach.</div>'}`; }
function renderStreamCard(stream, selectedId) { const isSelected = stream.id === selectedId; const reason = isSelected ? 'Wybrany jako najlepszy działający Original.' : explainRejection(stream); return `<article class="stream-card"><header><strong>${escapeHtml(stream.title ?? stream.name ?? stream.id)}</strong>${badge(isSelected ? 'selected' : (stream.validationStatus ?? 'unknown'))}</header><div class="stream-meta"><span>${escapeHtml(stream.sourceAddon ?? 'unknown addon')}</span><span>${escapeHtml(stream.quality ?? 'unknown quality')}</span><span>audio: ${escapeHtml(stream.audioLanguage ?? '-')}</span><span>napisy: ${escapeHtml(stream.subtitleLanguage ?? '-')}</span></div><div class="reject-reason">${escapeHtml(reason)}</div></article>`; }
function explainRejection(stream) { const validationReason = String(stream.validationReason ?? ''); if (stream.validationStatus === 'failed') { if (/format|unsupported|container|codec/i.test(validationReason)) return `Nieobsługiwany format albo kodek: ${validationReason}`; return `Nie działa: ${validationReason || 'walidacja źródła nie powiodła się.'}`; } if (stream.validationStatus === 'pending') return 'Nie został jeszcze zwalidowany.'; if (stream.isValidated === false) return 'Nie przeszedł walidacji.'; if (stream.audioLanguage && stream.audioLanguage !== state.settings.preferredAudioLanguage) return `Język audio niezgodny z preferencją (${languageLabel(state.settings.preferredAudioLanguage)}).`; if (stream.subtitleLanguage && stream.subtitleLanguage !== state.settings.preferredSubtitleLanguage) return `Język napisów niezgodny z preferencją (${languageLabel(state.settings.preferredSubtitleLanguage)}).`; if (!stream.quality) return 'Brak rozpoznanej jakości, więc ranking dał niższy priorytet.'; if (['144p', '240p', '360p'].includes(stream.quality)) return 'Jakość niezadowalająca względem lepiej ocenionych wyników.'; return 'Działa, ale ranking wybrał lepszy plik według języka, jakości lub źródła.'; }
function renderTechnicalHealth() { const report = state.healthReport; if (!report) { $('#technicalHealth').innerHTML = '<div class="list empty">Nie uruchomiono testu.</div>'; return; } $('#technicalHealth').innerHTML = table(['Status', 'Test', 'Wiadomość', 'Szczegóły'], report.checks.map((check) => [badge(check.status), escapeHtml(check.name), escapeHtml(check.message), `<pre class="mini-code">${escapeHtml(JSON.stringify(check.details ?? {}, null, 2))}</pre>`])); }
function renderSystemLogs() { if (!state.logs.length) { $('#systemLogs').innerHTML = '<div class="list empty">Brak logów dla wybranego filtra.</div>'; return; } $('#systemLogs').innerHTML = table(['Data', 'Poziom', 'Źródło', 'Komunikat', 'Szczegóły'], state.logs.map((log) => [escapeHtml(formatDate(log.createdAt)), badge(log.level), escapeHtml(log.source), escapeHtml(log.message), `<pre class="mini-code">${escapeHtml(JSON.stringify(log.details ?? {}, null, 2))}</pre>`])); }
function renderSessions() { if (!state.sessions.length) { $('#sessionsList').innerHTML = '<div class="list empty">Brak aktywnych sesji.</div>'; return; } $('#sessionsList').innerHTML = table(['Sesja', 'Utworzona', 'Ostatnio widziana', 'Wygasa'], state.sessions.map((session) => [session.isCurrent ? badge('current') : escapeHtml(session.id.slice(0, 8)), escapeHtml(formatDate(session.createdAt)), escapeHtml(formatDate(session.lastSeenAt)), escapeHtml(formatDate(session.expiresAt))])); }

function getLanguageOptions() { return state.languages.length ? state.languages : fallbackLanguages; }
function renderLanguageSelects() { const options = getLanguageOptions().map((language) => `<option value="${escapeHtml(language.code)}">${escapeHtml(language.label ?? `${language.nativeName ?? language.code} / ${language.englishName ?? language.code}`)}</option>`).join(''); const audio = $('#preferredAudioLanguage'); const subtitles = $('#preferredSubtitleLanguage'); if (audio) audio.innerHTML = options; if (subtitles) subtitles.innerHTML = options; }
function renderSettings() { const s = state.settings ?? {}; renderLanguageSelects(); $('#preferredAudioLanguage').value = s.preferredAudioLanguage ?? 'pl'; $('#preferredSubtitleLanguage').value = s.preferredSubtitleLanguage ?? 'pl'; $('#defaultTranscodeBufferPreset').value = s.defaultTranscodeBufferPreset ?? 'auto'; $('#streamValidationTimeoutMs').value = s.streamValidationTimeoutMs ?? 10000; $('#maxTranscodeSessions').value = s.maxTranscodeSessions ?? 2; $('#publicBaseUrl').value = s.publicBaseUrl ?? ''; $('#autoRefreshCache').checked = s.autoRefreshCache !== false; $('#showDiagnosticDetails').checked = s.showDiagnosticDetails !== false; }
function table(headers, rows) { return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`; }
function badge(value) { return `<span class="badge ${escapeHtml(String(value))}">${escapeHtml(String(value ?? '-'))}</span>`; }
async function api(path, options = {}) { const response = await fetch(path, { method: options.method ?? 'GET', headers: options.body ? { 'content-type': 'application/json' } : undefined, body: options.body ? JSON.stringify(options.body) : undefined }); const data = await response.json().catch(() => ({})); if (response.status === 401 && !path.startsWith('/auth/')) { showAuth(false); throw new Error('Sesja wygasła. Zaloguj się ponownie.'); } if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`); return data; }
async function runButtonAction(button, loadingLabel, action) { const previous = button.textContent; button.disabled = true; button.classList.add('loading'); button.textContent = loadingLabel; try { await action(); } catch (error) { toast(error instanceof Error ? error.message : 'Operacja nie powiodła się.'); throw error; } finally { button.disabled = false; button.classList.remove('loading'); button.textContent = previous; } }
function updateDiagnosticsOutputSize() { const output = $('#diagnosticsOutput'); output.classList.remove('small', 'large', 'full'); output.classList.add($('#diagnosticsOutputSize').value); }
function getInstallBaseUrl() { return (state.settings?.publicBaseUrl || window.location.origin).replace(/\/$/, ''); }
function getManifestUrl() { return `${getInstallBaseUrl()}/manifest.json`; }
function getTestStreamUrl() { return `${getInstallBaseUrl()}/stream/movie/tt0133093.json`; }
async function copyText(value, message) { try { await navigator.clipboard.writeText(value); toast(message); } catch { toast(value); } }
function languageLabel(code) { const language = getLanguageOptions().find((item) => item.code === code); return language ? (language.label ?? `${language.nativeName ?? language.code} / ${language.englishName ?? language.code}`) : (code ?? '-'); }
function formatStats(stats = {}) { return `działa: ${stats.workingStreamCount ?? 0}, błędy: ${stats.failedStreamCount ?? 0}, wszystkie: ${stats.streamCount ?? 0}`; }
function formatDate(value) { if (!value) return '-'; return new Date(value).toLocaleString(); }
function parseTypedMediaId(value = '') { const separatorIndex = value.indexOf(':'); if (separatorIndex === -1) return { type: value, id: '' }; return { type: value.slice(0, separatorIndex), id: value.slice(separatorIndex + 1) }; }
function toast(message) { const el = $('#toast'); if (!el) return; el.textContent = message; el.classList.remove('hidden'); setTimeout(() => el.classList.add('hidden'), 3200); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
