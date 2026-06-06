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
  "linkValidationMode"
];

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
        body[field] = element.type === "number" ? Number(element.value) : element.value;
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
    linkValidationMode: "best"
  };

  for (const field of TRANSCODE_SETTING_FIELDS) {
    const element = document.getElementById(field);
    if (!element) continue;
    element.value = settings[field] ?? defaults[field];
  }
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

function showVodToast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden", 3200));
}

installLogLevelMemory();
installLinkValidationSetting();
installSystemTranscodePanel();

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
  installLinkValidationSetting();
  installSystemTranscodePanel();
  installDiagnosticVodUi();
  if (document.getElementById("systemTranscodePanel")) refreshSystemTranscodePanel();
}, 1000);
