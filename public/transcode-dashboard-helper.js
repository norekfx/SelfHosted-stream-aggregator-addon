function installDashboardTranscodePanel() {
  const dashboard = document.getElementById("dashboard");
  const settingsSummary = document.getElementById("settingsSummary")?.closest("article");
  if (!dashboard || !settingsSummary) return;
  if (document.getElementById("dashboardTranscodePanel")) return;

  const panel = document.createElement("article");
  panel.id = "dashboardTranscodePanel";
  panel.className = "panel";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="panel-header">
      <h2>Transkodowanie</h2>
      <div class="inline-actions">
        <span id="dashboardTranscodeBadge" class="badge">oczekiwanie</span>
        <button id="stopDashboardTranscodeBtn" class="danger-btn" type="button">Zatrzymaj</button>
      </div>
    </div>
    <div id="dashboardTranscodeStatus" class="kv-list"></div>
  `;
  settingsSummary.insertAdjacentElement("beforebegin", panel);
  document.getElementById("stopDashboardTranscodeBtn")?.addEventListener("click", forceStopAllTranscoding);
}

async function refreshDashboardTranscodePanel() {
  installDashboardTranscodePanel();
  const panel = document.getElementById("dashboardTranscodePanel");
  const status = document.getElementById("dashboardTranscodeStatus");
  const badge = document.getElementById("dashboardTranscodeBadge");
  const stopButton = document.getElementById("stopDashboardTranscodeBtn");
  if (!panel || !status || !badge) return;

  try {
    const response = await fetch("/transcode/sessions");
    const data = await response.json();
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    const active = sessions.find((session) => ["starting", "running"].includes(session.status));

    updateSystemTranscodeQsvRow(active ?? sessions[0]);
    patchSystemTranscodeStopButton();

    if (!active) {
      panel.style.display = "none";
      if (stopButton) stopButton.disabled = true;
      return;
    }

    const profile = active.profile ?? {};
    const stats = active.speedStats ?? {};
    const qsv = resolveSessionQsv(active);
    const speed = active.progress?.speed || formatDashboardSpeed(stats.average);
    const bitrate = profile.videoBitrateKbps ? `${profile.videoBitrateKbps} kbps` : (active.progress?.bitrate ?? "auto");
    const mode = active.mode === "vod" ? "VOD HLS" : "Live HLS";

    badge.className = "badge running";
    badge.textContent = "transkoduje";
    if (stopButton) stopButton.disabled = false;
    panel.style.display = "";
    status.innerHTML = `
      <div class="kv"><span>Film</span><strong>${escapeDashboardTranscodeHtml(active.title || active.streamId || "-")}</strong></div>
      <div class="kv"><span>Prędkość</span><strong>${escapeDashboardTranscodeHtml(speed || "-")} · avg ${formatDashboardSpeed(stats.average)}</strong></div>
      <div class="kv"><span>Format</span><strong>${escapeDashboardTranscodeHtml(mode)} · ${escapeDashboardTranscodeHtml(active.quality || "-")} · H.264/AAC/HLS</strong></div>
      <div class="kv"><span>Profil</span><strong>${escapeDashboardTranscodeHtml(bitrate)} · CRF ${escapeDashboardTranscodeHtml(profile.crf ?? "-")} · ${escapeDashboardTranscodeHtml(profile.preset ?? "-")}</strong></div>
      <div class="kv"><span>Enkoder</span><strong>${renderDashboardQsvText(qsv)}</strong></div>
    `;
  } catch {
    panel.style.display = "none";
  }
}

function patchSystemTranscodeStopButton() {
  const button = document.getElementById("stopSystemTranscodeBtn");
  if (!button || button.dataset.forceStopPatched === "1") return;
  button.dataset.forceStopPatched = "1";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    forceStopAllTranscoding(event);
  }, true);
}

async function forceStopAllTranscoding(event) {
  const button = event?.currentTarget instanceof HTMLElement ? event.currentTarget : document.getElementById("stopDashboardTranscodeBtn") || document.getElementById("stopSystemTranscodeBtn");
  const old = button?.textContent;
  if (button) { button.disabled = true; button.textContent = "Zatrzymuję..."; }
  try {
    const response = await fetch("/transcode/sessions/stop-all", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const count = Array.isArray(data.stopped) ? data.stopped.length : 0;
    showDashboardVodToast(count > 0 ? `Zatrzymano transkodowanie (${count}).` : "Nie było aktywnego transkodowania.");
  } catch (error) {
    showDashboardVodToast(error instanceof Error ? error.message : "Nie udało się zatrzymać transkodowania.");
  } finally {
    if (button) { button.textContent = old || "Zatrzymaj"; }
    await refreshDashboardTranscodePanel();
    if (typeof refreshSystemTranscodePanel === "function") refreshSystemTranscodePanel();
  }
}

function showDashboardVodToast(message) {
  if (typeof showVodToast === "function") { showVodToast(message); return; }
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 3200);
}

function updateSystemTranscodeQsvRow(session) {
  const status = document.getElementById("systemTranscodeStatus");
  if (!status || status.classList.contains("empty")) return;
  const qsv = resolveSessionQsv(session);
  const existing = document.getElementById("systemTranscodeQsvRow");
  if (!qsv && !existing) return;
  const row = existing ?? document.createElement("div");
  row.id = "systemTranscodeQsvRow";
  row.className = "kv";
  row.innerHTML = `<span>Intel / enkoder</span><strong>${renderDashboardQsvText(qsv)}</strong>`;
  const kvList = status.querySelector(".kv-list") ?? status;
  if (!existing) kvList.appendChild(row);
}

function resolveSessionQsv(session) {
  if (!session) return undefined;
  return session.qsv || session.activeBatch?.qsv || session.lastBatch?.qsv || session.buffer?.activeBatch?.qsv || session.buffer?.lastBatch?.qsv;
}

function renderDashboardQsvText(qsv) {
  if (!qsv) return "CPU libx264 / brak danych Intel";
  if (qsv.runtimeMode === "qsv_decode_encode" && qsv.active) return "Intel QSV aktywny · wejście + wyjście";
  if (qsv.runtimeMode === "qsv_encode" && qsv.active) return "Intel QSV aktywny · tylko wyjście";
  if (qsv.runtimeMode === "vaapi_encode" && qsv.active) return `Intel VAAPI aktywny · h264_vaapi / i965${qsv.reason ? ` · ${escapeDashboardTranscodeHtml(qsv.reason)}` : ""}`;
  const reason = qsv.fallbackReason || qsv.reason;
  return `CPU libx264${qsv.requestedMode && qsv.requestedMode !== "disabled" ? " · fallback z Intel" : ""}${reason ? ` · ${escapeDashboardTranscodeHtml(reason)}` : ""}`;
}

function formatDashboardSpeed(value) { return Number.isFinite(value) ? `${value.toFixed(2)}x` : "-"; }
function escapeDashboardTranscodeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }

installDashboardTranscodePanel();
refreshDashboardTranscodePanel();
setInterval(refreshDashboardTranscodePanel, 2500);
