const TRANSCODE_SETTING_FIELDS = [
  "autoTranscodeMinQuality",
  "autoTranscodeMaxQuality",
  "transcodePreset",
  "transcodeCrfMode",
  "transcodeCrfMin",
  "transcodeCrfMax",
  "transcodeBitrateMode",
  "transcodeBitrateMinKbps",
  "transcodeBitrateMaxKbps",
  "linkValidationMode",
  "preferDebrid",
  "detectDebridPlaceholders",
  "debridPlaceholderValidationMode",
  "debridPlaceholderMinSizeMb",
  "debridPlaceholderMinDurationMinutes",
  "debridPlaceholderCompareDeclaredSize",
  "debridPlaceholderSizeDifferenceGb"
];

const BOOLEAN_SETTING_FIELDS = new Set(["preferDebrid", "detectDebridPlaceholders", "debridPlaceholderCompareDeclaredSize"]);
const LOG_LEVEL_STORAGE_KEY = "selfhosted-stream-aggregator:log-level-filter";
const originalFetch = window.fetch.bind(window);

window.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input?.url ?? "";
  const method = String(init.method ?? "GET").toUpperCase();

  if (url === "/admin/settings" && method === "PATCH" && init.body) {
    try {
      const body = JSON.parse(String(init.body));
      for (const field of TRANSCODE_SETTING_FIELDS) {
        const element = document.getElementById(field);
        if (!element) continue;
        if (BOOLEAN_SETTING_FIELDS.has(field)) body[field] = element.value !== "false";
        else body[field] = element.type === "number" ? Number(element.value) : element.value;
      }
      init = { ...init, body: JSON.stringify(body) };
    } catch {
      // Keep the original request if parsing failed.
    }
  }

  const response = await originalFetch(input, init);

  if (url === "/admin/settings" && method === "GET") {
    response.clone().json().then((data) => fillTranscodeSettings(data.settings ?? {})).catch(() => {});
  }

  return response;
};

function fillTranscodeSettings(settings) {
  const defaults = {
    autoTranscodeMinQuality: "144p",
    autoTranscodeMaxQuality: "1080p",
    transcodePreset: "veryfast",
    transcodeCrfMode: "auto",
    transcodeCrfMin: 22,
    transcodeCrfMax: 26,
    transcodeBitrateMode: "auto",
    transcodeBitrateMinKbps: 1000,
    transcodeBitrateMaxKbps: 6000,
    linkValidationMode: "best",
    preferDebrid: true,
    detectDebridPlaceholders: false,
    debridPlaceholderValidationMode: "best",
    debridPlaceholderMinSizeMb: 30,
    debridPlaceholderMinDurationMinutes: 5,
    debridPlaceholderCompareDeclaredSize: false,
    debridPlaceholderSizeDifferenceGb: 5
  };

  for (const field of TRANSCODE_SETTING_FIELDS) {
    const element = document.getElementById(field);
    if (!element) continue;
    const value = settings[field] ?? defaults[field];
    element.value = BOOLEAN_SETTING_FIELDS.has(field) ? String(value === true) : value;
  }

  updateDebridPlaceholderVisibility();
}

function installLinkValidationSetting() {
  const form = document.getElementById("settingsForm");
  const timeout = document.getElementById("streamValidationTimeoutMs");
  if (!form || !timeout || document.getElementById("linkValidationMode")) return;

  const label = document.createElement("label");
  label.innerHTML = `Walidacja linków<select id="linkValidationMode"><option value="best">Szukanie najlepszego</option><option value="all">Wszystkie</option><option value="5">5 najlepszych</option><option value="10">10 najlepszych</option><option value="20">20 najlepszych</option><option value="40">40 najlepszych</option><option value="80">80 najlepszych</option><option value="100">100 najlepszych</option><option value="150">150 najlepszych</option><option value="200">200 najlepszych</option></select>`;
  timeout.closest("label")?.insertAdjacentElement("afterend", label);

  originalFetch("/admin/settings")
    .then((response) => response.json())
    .then((data) => fillTranscodeSettings(data.settings ?? {}))
    .catch(() => {});
}

function installPreferDebridSetting() {
  const form = document.getElementById("settingsForm");
  const audio = document.getElementById("preferredAudioLanguage");
  if (!form || !audio || document.getElementById("preferDebrid")) return;

  const wrapper = document.createElement("div");
  wrapper.id = "debridSettingsPatch";
  wrapper.innerHTML = `
    <label>Preferuj debrid<select id="preferDebrid"><option value="true">Tak</option><option value="false">Nie</option></select></label>
    <label>Wykrywanie placeholderów debrid<select id="detectDebridPlaceholders"><option value="false">Nie</option><option value="true">Tak</option></select></label>
    <div id="debridPlaceholderOptions">
      <label>Walidacja placeholderów<select id="debridPlaceholderValidationMode"><option value="best">Szukanie najlepszego</option><option value="all">Wszystkie</option><option value="5">5 najlepszych</option><option value="10">10 najlepszych</option><option value="20">20 najlepszych</option><option value="40">40 najlepszych</option><option value="80">80 najlepszych</option><option value="100">100 najlepszych</option><option value="150">150 najlepszych</option><option value="200">200 najlepszych</option></select></label>
      <label>Minimalny rozmiar pliku MB<input id="debridPlaceholderMinSizeMb" type="number" min="1" max="102400" step="1" value="30"></label>
      <label>Minimalny czas filmu min<input id="debridPlaceholderMinDurationMinutes" type="number" min="1" max="1440" step="1" value="5"></label>
      <label>Uwzględnij wielkość względem podanej<select id="debridPlaceholderCompareDeclaredSize"><option value="false">Nie</option><option value="true">Tak</option></select></label>
      <label id="debridPlaceholderSizeDifferenceLabel">Różnica GB<input id="debridPlaceholderSizeDifferenceGb" type="number" min="1" max="1024" step="1" value="5"></label>
    </div>
  `;
  audio.closest("label")?.insertAdjacentElement("afterend", wrapper);

  document.getElementById("detectDebridPlaceholders")?.addEventListener("change", updateDebridPlaceholderVisibility);
  document.getElementById("debridPlaceholderCompareDeclaredSize")?.addEventListener("change", updateDebridPlaceholderVisibility);

  originalFetch("/admin/settings")
    .then((response) => response.json())
    .then((data) => fillTranscodeSettings(data.settings ?? {}))
    .catch(() => {});
}

function updateDebridPlaceholderVisibility() {
  const options = document.getElementById("debridPlaceholderOptions");
  const difference = document.getElementById("debridPlaceholderSizeDifferenceLabel");
  const enabled = document.getElementById("detectDebridPlaceholders")?.value === "true";
  const compare = document.getElementById("debridPlaceholderCompareDeclaredSize")?.value === "true";
  if (options) options.style.display = enabled ? "contents" : "none";
  if (difference) difference.style.display = enabled && compare ? "" : "none";
}

function installLogLevelMemory() {
  const select = document.getElementById("logLevelFilter");
  if (!select || select.dataset.logLevelMemory === "1") return;

  const saved = localStorage.getItem(LOG_LEVEL_STORAGE_KEY);
  const initialValue = saved === null ? "error" : saved;
  select.value = [...select.options].some((option) => option.value === initialValue) ? initialValue : "error";
  select.dataset.logLevelMemory = "1";
  select.addEventListener("change", () => {
    localStorage.setItem(LOG_LEVEL_STORAGE_KEY, select.value);
  });
}

function installSystemTranscodePanel() {
  const system = document.getElementById("system");
  if (!system || document.getElementById("systemTranscodePanel")) return;

  const healthPanel = document.getElementById("technicalHealth")?.closest("article");
  const panel = document.createElement("article");
  panel.id = "systemTranscodePanel";
  panel.className = "panel";
  panel.innerHTML = `
    <div class="panel-header">
      <h2>Transkodowanie</h2>
      <div class="inline-actions">
        <span id="systemTranscodeBadge" class="badge">oczekiwanie</span>
        <button id="stopSystemTranscodeBtn" class="danger-btn" type="button" disabled>Zatrzymaj</button>
      </div>
    </div>
    <div id="systemTranscodeStatus" class="list empty">Brak danych o transkodowaniu.</div>
    <div id="systemTranscodeHistory" class="table-wrap"></div>
  `;

  if (healthPanel?.nextSibling) {
    system.insertBefore(panel, healthPanel.nextSibling);
  } else {
    system.prepend(panel);
  }

  document.getElementById("stopSystemTranscodeBtn")?.addEventListener("click", stopActiveSystemTranscode);
  refreshSystemTranscodePanel();
}

async function refreshSystemTranscodePanel() {
  const panel = document.getElementById("systemTranscodePanel");
  if (!panel) return;

  try {
    const response = await originalFetch("/transcode/sessions");
    const data = await response.json();
    renderSystemTranscodePanel(data.sessions ?? []);
  } catch {
    const status = document.getElementById("systemTranscodeStatus");
    if (status) {
      status.classList.add("empty");
      status.textContent = "Nie udało się pobrać statusu transkodowania.";
    }
  }
}

function renderSystemTranscodePanel(sessions) {
  const active = sessions.find((session) => ["starting", "running"].includes(session.status));
  const lastThree = sessions.slice(0, 3);
  const badge = document.getElementById("systemTranscodeBadge");
  const stopButton = document.getElementById("stopSystemTranscodeBtn");
  const status = document.getElementById("systemTranscodeStatus");
  const history = document.getElementById("systemTranscodeHistory");
  if (!badge || !stopButton || !status || !history) return;

  const representative = active ?? lastThree[0];
  badge.className = `badge ${representative?.status ?? "idle"}`;
  badge.textContent = getTranscodePanelLabel(representative?.status);
  stopButton.disabled = !active;
  stopButton.dataset.sessionId = active?.id ?? "";

  if (!representative) {
    status.classList.add("empty");
    status.textContent = "Oczekiwanie — nie było jeszcze transkodowania.";
    history.innerHTML = "";
    return;
  }

  status.classList.remove("empty");
  status.innerHTML = renderTranscodeSummary(representative, active ? "Obecnie" : "Ostatnio");
  history.innerHTML = lastThree.length ? renderTranscodeHistoryTable(lastThree) : "";
}

function getTranscodePanelLabel(status) {
  if (status === "running" || status === "starting") return "🔄 transkoduje...";
  if (status === "exited") return "⏹ zatrzymano";
  if (status === "failed") return "⚠️ błąd";
  return "⏳ oczekiwanie";
}

function renderTranscodeSummary(session, prefix) {
  const profile = session.profile ?? {};
  const stats = session.speedStats ?? {};
  const bitrate = profile.videoBitrateKbps ? `${profile.videoBitrateKbps} kbps` : (session.progress?.bitrate ?? "auto");
  return `
    <div class="kv-list">
      <div class="kv"><span>${escapeTranscodeHtml(prefix) + " transkodowane"}</span><strong>${escapeTranscodeHtml(session.title || session.streamId || "-")}</strong></div>
      <div class="kv"><span>Źródło</span><strong>${escapeTranscodeHtml([session.sourceQuality, session.sourceAddon].filter(Boolean).join(" / ") || "-")}</strong></div>
      <div class="kv"><span>Cel</span><strong>${escapeTranscodeHtml(session.quality)} | ${escapeTranscodeHtml(bitrate)} | CRF ${escapeTranscodeHtml(profile.crf ?? "-")} | ${escapeTranscodeHtml(profile.preset ?? "-")}</strong></div>
      <div class="kv"><span>Prędkość</span><strong>avg ${formatTranscodeSpeed(stats.average)} / min ${formatTranscodeSpeed(stats.min)} / max ${formatTranscodeSpeed(stats.max)}</strong></div>
      <div class="kv"><span>Postęp</span><strong>${escapeTranscodeHtml(session.progress?.outTime ?? "-")} | ${escapeTranscodeHtml(session.progress?.speed ?? "-")} | bufor ${escapeTranscodeHtml(session.buffer?.estimatedSeconds ?? 0)}s</strong></div>
    </div>
  `;
}

function renderTranscodeHistoryTable(sessions) {
  const rows = sessions.map((session) => {
    const profile = session.profile ?? {};
    const stats = session.speedStats ?? {};
    const bitrate = profile.videoBitrateKbps ? `${profile.videoBitrateKbps} kbps` : (session.progress?.bitrate ?? "auto");
    return `<tr>
      <td>${escapeTranscodeHtml(new Date(session.startedAt).toLocaleString())}<br>${getTranscodePanelLabel(session.status)}</td>
      <td><strong>${escapeTranscodeHtml(session.title || session.streamId || "-")}</strong><br><small>${escapeTranscodeHtml([session.sourceQuality, session.sourceAddon].filter(Boolean).join(" / ") || "-")}</small></td>
      <td>${escapeTranscodeHtml(session.quality)}<br><small>${escapeTranscodeHtml(bitrate)} | CRF ${escapeTranscodeHtml(profile.crf ?? "-")} | ${escapeTranscodeHtml(profile.preset ?? "-")}</small></td>
      <td>avg ${formatTranscodeSpeed(stats.average)}<br><small>min ${formatTranscodeSpeed(stats.min)} / max ${formatTranscodeSpeed(stats.max)}</small></td>
    </tr>`;
  }).join("");

  return `<table><thead><tr><th>Status</th><th>Plik</th><th>Profil</th><th>Prędkość</th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function stopActiveSystemTranscode() {
  const button = document.getElementById("stopSystemTranscodeBtn");
  const sessionId = button?.dataset.sessionId;
  if (!button || !sessionId) return;

  const old = button.textContent;
  button.disabled = true;
  button.textContent = "Zatrzymuję...";
  try {
    const response = await originalFetch(`/transcode/sessions/${encodeURIComponent(sessionId)}/stop`, { method: "POST" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    showVodToast("Zatrzymano aktywne transkodowanie.");
  } catch {
    showVodToast("Nie udało się zatrzymać transkodowania.");
  } finally {
    button.textContent = old;
    refreshSystemTranscodePanel();
  }
}

function formatTranscodeSpeed(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}x` : "-";
}

function escapeTranscodeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function installDiagnosticVodUi() {
  const modeSelect = document.getElementById("transcodeModeSelect");
  if (!modeSelect || document.getElementById("transcodePlaybackModeSelect")) return;

  const playbackSelect = document.createElement("select");
  playbackSelect.id = "transcodePlaybackModeSelect";
  playbackSelect.innerHTML = '<option value="live">HLS live</option><option value="vod">VOD HLS seek</option>';
  modeSelect.insertAdjacentElement("afterend", playbackSelect);

  document.addEventListener("click", handleVodDiagnosticClick, true);
}

function handleVodDiagnosticClick(event) {
  const target = event.target;
  if (!target || !["playTranscodeCandidateBtn", "copyTranscodeUrlBtn"].includes(target.id)) return;

  const playbackMode = document.getElementById("transcodePlaybackModeSelect")?.value ?? "live";
  const transcodeMode = document.getElementById("transcodeModeSelect")?.value ?? "original";
  if (playbackMode !== "vod" || transcodeMode === "original") return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const url = getVodDiagnosticUrl();
  if (!url) {
    showVodToast("Najpierw wybierz plik.");
    return;
  }

  if (target.id === "copyTranscodeUrlBtn") {
    navigator.clipboard?.writeText(url);
    showVodToast("Skopiowano URL VOD HLS.");
    return;
  }

  playVodDiagnosticUrl(url, transcodeMode);
}

function getVodDiagnosticUrl() {
  const candidateId = document.getElementById("transcodeCandidateSelect")?.value;
  const candidate = window.transcodeDiagnostics?.candidates?.find((item) => item.id === candidateId);
  const mode = document.getElementById("transcodeModeSelect")?.value ?? "auto";
  const liveUrl = candidate?.urls?.[mode];
  return liveUrl ? liveUrl.replace("/transcode/", "/transcode-vod/") : undefined;
}

function playVodDiagnosticUrl(url, mode) {
  const video = document.getElementById("transcodeVideo");
  const status = document.getElementById("transcodeStatus");
  if (!video || !status) return;

  if (window.transcodeDiagnostics?.hls) {
    window.transcodeDiagnostics.hls.destroy();
    window.transcodeDiagnostics.hls = null;
  }

  status.innerHTML = `<strong>Tryb:</strong> ${mode} / VOD HLS seek<br><strong>URL:</strong> <code>${url}</code><br><small>VOD HLS najpierw robi ffprobe, potem generuje segmenty dopiero przy żądaniu odtwarzacza lub po seeku.</small>`;

  if (window.Hls && Hls.isSupported()) {
    const hls = new Hls({ debug: false, lowLatencyMode: false });
    window.transcodeDiagnostics.hls = hls;
    hls.on(Hls.Events.ERROR, (_, data) => {
      status.innerHTML += `<br><strong>VOD HLS error:</strong> ${data.type} / ${data.details} / fatal=${data.fatal}`;
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
  } else {
    video.src = url;
    video.play().catch(() => {});
  }
}

function installHistoryDetailsPatch() {
  if (document.body?.dataset.fullHistoryDetailsPatch === "1") return;
  if (document.body) document.body.dataset.fullHistoryDetailsPatch = "1";

  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-history-details]");
    const historyId = button?.dataset?.historyDetails;
    if (!historyId) return;
    setTimeout(() => renderFullHistoryDetails(historyId), 350);
  }, true);
}

async function renderFullHistoryDetails(historyId) {
  const target = document.getElementById("historyDetails");
  if (!target) return;

  try {
    const response = await originalFetch(`/admin/history/${encodeURIComponent(historyId)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const details = data.details;
    const result = details?.result;
    if (!details || !result) return;

    const selectedOriginal = result.selectedOriginal ?? details.selectedOriginal;
    const selectedKey = getHistoryStreamKey(selectedOriginal);
    const rankByKey = new Map((result.rankedStreams ?? []).map((stream) => [getHistoryStreamKey(stream), stream]));
    const streams = (result.streams ?? []).map((stream, index) => ({ ...stream, ...(rankByKey.get(getHistoryStreamKey(stream)) ?? {}), originalIndex: index + 1 }));
    const selectedStream = streams.find((stream) => getHistoryStreamKey(stream) === selectedKey) ?? selectedOriginal;
    const scoreBands = getHistoryScoreBands(streams);

    target.innerHTML = `<div class="kv-list"><div class="kv"><span>Media</span><strong>${escapeTranscodeHtml(details.type)}:${escapeTranscodeHtml(details.mediaId)}</strong></div><div class="kv"><span>Wybrany Original</span><strong>${escapeTranscodeHtml(selectedStream?.title ?? selectedStream?.name ?? "brak")}</strong></div><div class="kv"><span>Statystyki</span><strong>${details.workingStreamCount}/${details.streamCount} działa | ${result.validatedStreamCount ?? details.workingStreamCount + details.failedStreamCount + details.unsupportedStreamCount} sprawdzone | ${streams.length} odebrane</strong></div></div><p>Kolory punktów: zielony = najlepsze 10%, czerwony = środek rankingu, pomarańczowy = najgorsze 40% wyników.</p><h3>Wybrany Original — pełne dane</h3>${selectedStream ? renderFullHistoryStreamCard(selectedStream, selectedKey, scoreBands, true) : '<div class="list empty">Brak wybranego Original.</div>'}<h3>Znalezione pliki (${streams.length})</h3>${streams.length ? streams.map((stream) => renderFullHistoryStreamCard(stream, selectedKey, scoreBands, false)).join("") : '<div class="list empty">Brak plików w szczegółach.</div>'}`;
  } catch (error) {
    target.innerHTML = `<div class="list empty">Nie udało się wczytać pełnych szczegółów historii: ${escapeTranscodeHtml(error instanceof Error ? error.message : "nieznany błąd")}</div>`;
  }
}

function renderFullHistoryStreamCard(stream, selectedKey, scoreBands, selectedPanel = false) {
  const metadata = stream.metadata ?? {};
  const validation = stream.validation ?? {};
  const title = stream.title || stream.name || metadata.rawText || stream.url || stream.externalUrl || `Stream #${stream.originalIndex ?? "-"}`;
  const isSelected = getHistoryStreamKey(stream) === selectedKey;
  const status = isSelected ? "selected" : (validation.status ?? stream.validationStatus ?? "pending");
  const scoreReasons = Array.isArray(stream.scoreReasons) ? stream.scoreReasons : [];
  const matchedTokens = Array.isArray(metadata.matchedTokens) ? metadata.matchedTokens : [];
  const reason = isSelected ? "Wybrany jako najlepszy działający Original." : getFullHistoryReason(stream);
  const url = stream.url || stream.externalUrl || stream.originalUrl || "";
  const scoreBadge = renderHistoryScoreBadge(stream, scoreBands);
  const selectedLabel = selectedPanel ? `<div class="reject-reason"><strong>Wybrany Original:</strong> pełne dane wybranego pliku.</div>` : "";

  return `<article class="stream-card">${scoreBadge}<header><strong>#${escapeTranscodeHtml(stream.originalIndex ?? "-")} ${escapeTranscodeHtml(title)}</strong>${fullHistoryBadge(status)}</header><div class="stream-meta"><span>addon: ${escapeTranscodeHtml(stream.addonName || stream.sourceAddon || stream.addonId || "-")}</span><span>jakość: ${escapeTranscodeHtml(metadata.quality || stream.quality || "unknown")}</span><span>źródło: ${escapeTranscodeHtml(metadata.source || "unknown")}</span><span>kodek: ${escapeTranscodeHtml(metadata.videoCodec || "unknown")}</span><span>audio: ${escapeTranscodeHtml(metadata.audioLanguage || stream.audioLanguage || "-")}</span><span>typ audio: ${escapeTranscodeHtml(metadata.audioKind || "-")}</span><span>napisy: ${escapeTranscodeHtml(metadata.subtitleLanguage || stream.subtitleLanguage || "-")}</span><span>rozmiar: ${escapeTranscodeHtml(metadata.size || "-")}</span><span>wynik: ${escapeTranscodeHtml(formatHistoryScore(stream.score))}</span><span>walidacja: ${escapeTranscodeHtml(validation.method || "-")} ${escapeTranscodeHtml(validation.httpStatus || "")}</span><span>czas: ${escapeTranscodeHtml(validation.responseTimeMs ?? "-")} ms</span><span>range: ${validation.acceptsRanges === undefined ? "-" : validation.acceptsRanges ? "tak" : "nie"}</span></div>${selectedLabel}${stream.description ? `<p class="reject-reason"><strong>Opis:</strong> ${escapeTranscodeHtml(stream.description)}</p>` : ""}${metadata.rawText ? `<p class="reject-reason"><strong>Tekst analizowany:</strong> ${escapeTranscodeHtml(metadata.rawText)}</p>` : ""}<div class="reject-reason"><strong>Decyzja:</strong> ${escapeTranscodeHtml(reason)}</div>${url ? `<div class="reject-reason"><strong>URL:</strong> <code>${escapeTranscodeHtml(url.slice(0, 500))}</code></div>` : ""}${validation.reason ? `<div class="reject-reason"><strong>Walidacja:</strong> ${escapeTranscodeHtml(validation.reason)}</div>` : ""}${scoreReasons.length ? `<div class="reject-reason"><strong>Punkty:</strong> ${escapeTranscodeHtml(scoreReasons.join("; "))}</div>` : ""}${matchedTokens.length ? `<div class="reject-reason"><strong>Tokeny:</strong> ${escapeTranscodeHtml(matchedTokens.join(", "))}</div>` : ""}</article>`;
}

function getHistoryScoreBands(streams) {
  const scored = streams
    .map((stream) => ({ key: getHistoryStreamKey(stream), score: Number(stream.score) }))
    .filter((item) => item.key && Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score);
  const bands = new Map();
  if (!scored.length) return bands;
  const topCount = Math.max(1, Math.ceil(scored.length * 0.10));
  const worstCount = Math.max(1, Math.ceil(scored.length * 0.40));
  scored.forEach((item, index) => {
    if (index < topCount) bands.set(item.key, "top");
    else if (index >= scored.length - worstCount) bands.set(item.key, "worst");
    else bands.set(item.key, "middle");
  });
  return bands;
}

function renderHistoryScoreBadge(stream, scoreBands) {
  const score = Number(stream.score);
  const band = scoreBands.get(getHistoryStreamKey(stream)) ?? "none";
  const styleByBand = {
    top: "background:#137333;color:#fff;border:1px solid #0f5f2a;",
    middle: "background:#b3261e;color:#fff;border:1px solid #8c1d18;",
    worst: "background:#f29900;color:#1f1f1f;border:1px solid #c77800;",
    none: "background:#5f6368;color:#fff;border:1px solid #4a4d51;"
  };
  const labelByBand = { top: "top 10%", middle: "środek", worst: "najgorsze 40%", none: "brak rankingu" };
  return `<div style="${styleByBand[band]};display:inline-block;padding:4px 10px;border-radius:999px;font-weight:700;margin-bottom:8px;">Punkty: ${escapeTranscodeHtml(formatHistoryScore(score))} · ${escapeTranscodeHtml(labelByBand[band])}</div>`;
}

function formatHistoryScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? String(Math.round(score)) : "brak";
}

function fullHistoryBadge(value) {
  return `<span class="badge ${escapeTranscodeHtml(String(value))}">${escapeTranscodeHtml(String(value ?? "-"))}</span>`;
}

function getFullHistoryReason(stream) {
  const validation = stream.validation ?? {};
  if (validation.status === "working") return "Link działa, ale ranking mógł wybrać lepszy wynik.";
  if (validation.status === "failed") return `Nie działa: ${validation.reason || "walidacja źródła nie powiodła się."}`;
  if (validation.status === "unsupported") return `Nieobsługiwany albo pominięty: ${validation.reason || "brak obsługi tego typu streamu."}`;
  if (validation.status === "pending") return validation.reason || "Nie sprawdzono — limit walidacji albo tryb Szukanie najlepszego zatrzymał dalsze testy.";
  return "Brak wyniku walidacji.";
}

function getHistoryStreamKey(stream) {
  if (!stream) return "";
  return [stream.addonId || stream.sourceAddon || "", stream.url || stream.externalUrl || stream.originalUrl || stream.infoHash || "", stream.fileIdx ?? "", stream.title || stream.name || ""].join("|");
}

function showVodToast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3200);
}

installLogLevelMemory();
installPreferDebridSetting();
installLinkValidationSetting();
installSystemTranscodePanel();
installHistoryDetailsPatch();

setInterval(() => {
  const form = document.getElementById("settingsForm");
  if (form && form.dataset.transcodeSettingsPatch !== "1") {
    form.dataset.transcodeSettingsPatch = "1";
    originalFetch("/admin/settings")
      .then((response) => response.json())
      .then((data) => fillTranscodeSettings(data.settings ?? {}))
      .catch(() => {});
  }

  installLogLevelMemory();
  installPreferDebridSetting();
  installLinkValidationSetting();
  installSystemTranscodePanel();
  installHistoryDetailsPatch();
  installDiagnosticVodUi();
  updateDebridPlaceholderVisibility();
  if (document.getElementById("systemTranscodePanel")) refreshSystemTranscodePanel();
}, 1000);
