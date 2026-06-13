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
    <div class="panel-header"><h2>Transkodowanie</h2><span id="dashboardTranscodeBadge" class="badge">oczekiwanie</span></div>
    <div id="dashboardTranscodeStatus" class="kv-list"></div>
  `;
  settingsSummary.insertAdjacentElement("beforebegin", panel);
}

async function refreshDashboardTranscodePanel() {
  installDashboardTranscodePanel();
  const panel = document.getElementById("dashboardTranscodePanel");
  const status = document.getElementById("dashboardTranscodeStatus");
  const badge = document.getElementById("dashboardTranscodeBadge");
  if (!panel || !status || !badge) return;

  try {
    const response = await fetch("/transcode/sessions");
    const data = await response.json();
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    const active = sessions.find((session) => ["starting", "running"].includes(session.status));

    updateSystemTranscodeQsvRow(active ?? sessions[0]);

    if (!active) {
      panel.style.display = "none";
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

function updateSystemTranscodeQsvRow(session) {
  const status = document.getElementById("systemTranscodeStatus");
  if (!status || status.classList.contains("empty")) return;
  const qsv = resolveSessionQsv(session);
  const existing = document.getElementById("systemTranscodeQsvRow");
  if (!qsv && !existing) return;
  const row = existing ?? document.createElement("div");
  row.id = "systemTranscodeQsvRow";
  row.className = "kv";
  row.innerHTML = `<span>Intel QSV / enkoder</span><strong>${renderDashboardQsvText(qsv)}</strong>`;
  const kvList = status.querySelector(".kv-list") ?? status;
  if (!existing) kvList.appendChild(row);
}

function resolveSessionQsv(session) {
  if (!session) return undefined;
  return session.qsv || session.activeBatch?.qsv || session.lastBatch?.qsv || session.buffer?.activeBatch?.qsv || session.buffer?.lastBatch?.qsv;
}

function renderDashboardQsvText(qsv) {
  if (!qsv) return "CPU libx264 / brak danych QSV";
  if (qsv.runtimeMode === "qsv_decode_encode" && qsv.active) return "Intel QSV aktywny · wejście + wyjście";
  if (qsv.runtimeMode === "qsv_encode" && qsv.active) return "Intel QSV aktywny · tylko wyjście";
  const reason = qsv.fallbackReason || qsv.reason;
  return `CPU libx264${qsv.requestedMode && qsv.requestedMode !== "disabled" ? " · fallback z QSV" : ""}${reason ? ` · ${escapeDashboardTranscodeHtml(reason)}` : ""}`;
}

function formatDashboardSpeed(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}x` : "-";
}

function escapeDashboardTranscodeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

installDashboardTranscodePanel();
refreshDashboardTranscodePanel();
setInterval(refreshDashboardTranscodePanel, 2500);
