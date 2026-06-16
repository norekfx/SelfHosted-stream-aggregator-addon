const transcodeCacheState = { cache: null, loaded: false };

function installTranscodeCachePanelStyles() {
  if (document.getElementById("transcodeCachePanelStyles")) return;
  const style = document.createElement("style");
  style.id = "transcodeCachePanelStyles";
  style.textContent = `
    .transcode-cache-summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; margin-bottom:12px; }
    .transcode-cache-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:14px; }
    .transcode-cache-card { display:grid; grid-template-columns:72px 1fr; gap:12px; padding:12px; border:1px solid rgba(148,163,184,.25); border-radius:14px; background:rgba(15,23,42,.35); }
    .transcode-cache-poster { width:72px; height:104px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:22px; background:linear-gradient(135deg,rgba(59,130,246,.4),rgba(168,85,247,.35)); color:white; }
    .transcode-cache-body { min-width:0; display:flex; flex-direction:column; gap:6px; }
    .transcode-cache-body strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .transcode-cache-body small { color:var(--muted,#94a3b8); line-height:1.35; }
    .transcode-cache-progress { position:relative; height:10px; overflow:hidden; border-radius:999px; background:rgba(148,163,184,.22); }
    .transcode-cache-progress span { position:absolute; top:0; height:100%; background:linear-gradient(90deg,#22c55e,#3b82f6); border-radius:999px; min-width:2px; }
  `;
  document.head.appendChild(style);
}

function installTranscodeCachePanel() {
  installTranscodeCachePanelStyles();
  const nav = document.querySelector(".nav");
  const settingsButton = document.querySelector('.nav-item[data-view="settings"]');
  const main = document.querySelector(".main");
  if (!nav || !settingsButton || !main) return;
  if (!document.querySelector('.nav-item[data-view="transcoding"]')) {
    const button = document.createElement("button");
    button.className = "nav-item";
    button.dataset.view = "transcoding";
    button.textContent = "Transkodowanie";
    settingsButton.insertAdjacentElement("beforebegin", button);
    button.addEventListener("click", () => showTranscodeCacheView(button));
  }
  if (!document.getElementById("transcoding")) {
    const section = document.createElement("section");
    section.id = "transcoding";
    section.className = "view";
    section.innerHTML = `<article class="panel"><div class="panel-header"><h2>Cache transkodowania</h2><div class="inline-actions"><button id="reloadTranscodeCacheBtn" class="ghost-btn" type="button">Odśwież</button><button id="clearTranscodeCacheBtn" class="danger-btn" type="button">Usuń wszystkie pliki</button></div></div><div class="transcode-cache-summary"><div class="stat-card"><span>Zajęte miejsce</span><strong id="transcodeCacheUsed">-</strong><small id="transcodeCacheLimit">limit: -</small></div><div class="stat-card"><span>Filmy / odcinki</span><strong id="transcodeCacheCount">-</strong><small id="transcodeCacheBreakdown">-</small></div><div class="stat-card"><span>Limit cache</span><strong><input id="transcodeCacheLimitGb" type="number" min="1" max="2048" step="1" style="width:80px" /> GB</strong><small><button id="saveTranscodeCacheLimitBtn" class="small-btn" type="button">Zapisz limit</button></small></div></div><p class="hint">Domyślnie limit wynosi 50 GB. Po dojściu do limitu system usuwa najstarsze wpisy cache transkodowania, aż rozmiar spadnie poniżej limitu.</p></article><article class="panel"><div class="panel-header"><h2>Pliki w cache</h2></div><div id="transcodeCacheItems" class="transcode-cache-grid list empty">Brak danych.</div></article>`;
    document.querySelector("#settings")?.insertAdjacentElement("beforebegin", section);
    document.getElementById("reloadTranscodeCacheBtn")?.addEventListener("click", () => loadTranscodeCachePanel(true));
    document.getElementById("saveTranscodeCacheLimitBtn")?.addEventListener("click", saveTranscodeCacheLimit);
    document.getElementById("clearTranscodeCacheBtn")?.addEventListener("click", clearTranscodeCachePanel);
  }
}

function showTranscodeCacheView(button) { if (typeof state === "object") state.view = "transcoding"; document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item === button)); document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === "transcoding")); const title = document.getElementById("viewTitle"); const subtitle = document.getElementById("viewSubtitle"); if (title) title.textContent = "Transkodowanie"; if (subtitle) subtitle.textContent = "Cache transkodowania, mapa wygenerowanych fragmentów i limit miejsca."; loadTranscodeCachePanel(!transcodeCacheState.loaded); }

async function loadTranscodeCachePanel(showLoading = false) {
  installTranscodeCachePanel();
  const container = document.getElementById("transcodeCacheItems");
  if (showLoading && container && !transcodeCacheState.loaded) container.innerHTML = '<div class="list empty">Wczytuję cache transkodowania...</div>';
  try { const data = await transcodeCacheApi("/admin/transcode/cache"); transcodeCacheState.cache = data.cache; transcodeCacheState.loaded = true; renderTranscodeCachePanel(); }
  catch (error) { if (container && !transcodeCacheState.loaded) container.innerHTML = `<div class="list empty">Błąd wczytywania: ${escapeTranscodeCacheHtml(error?.message ?? error)}</div>`; }
}

async function saveTranscodeCacheLimit() { const input = document.getElementById("transcodeCacheLimitGb"); const value = Number(input?.value ?? 50); if (!Number.isFinite(value) || value < 1) { showTranscodeCacheToast("Podaj poprawny limit GB."); return; } await transcodeCacheApi("/admin/settings", { method: "PATCH", body: { transcodeCacheLimitGb: Math.round(value) } }); await transcodeCacheApi("/admin/transcode/cache/prune", { method: "POST" }); showTranscodeCacheToast("Limit cache transkodowania zapisany."); await loadTranscodeCachePanel(false); }
async function clearTranscodeCachePanel() { if (!confirm("Usunąć wszystkie pliki cache transkodowania?")) return; await transcodeCacheApi("/admin/transcode/cache", { method: "DELETE" }); transcodeCacheState.loaded = false; showTranscodeCacheToast("Cache transkodowania wyczyszczony."); await loadTranscodeCachePanel(true); }
function renderTranscodeCachePanel() { const cache = transcodeCacheState.cache ?? {}; const items = Array.isArray(cache.items) ? cache.items : []; document.getElementById("transcodeCacheUsed").textContent = formatTranscodeCacheBytes(cache.totalBytes ?? 0); document.getElementById("transcodeCacheLimit").textContent = `limit: ${formatTranscodeCacheBytes(cache.limitBytes ?? 0)}`; document.getElementById("transcodeCacheCount").textContent = String(cache.itemCount ?? items.length); document.getElementById("transcodeCacheBreakdown").textContent = `filmy: ${cache.movieCount ?? 0}, odcinki: ${cache.episodeCount ?? 0}`; const limitInput = document.getElementById("transcodeCacheLimitGb"); if (limitInput) limitInput.value = String(cache.limitGb ?? 50); const container = document.getElementById("transcodeCacheItems"); if (!container) return; if (!items.length) { container.innerHTML = '<div class="list empty">Cache transkodowania jest pusty.</div>'; return; } container.innerHTML = items.map(renderTranscodeCacheItem).join(""); }

function renderTranscodeCacheItem(item) {
  const percent = Number.isFinite(item.progressPercent) ? item.progressPercent : 0;
  const title = item.title || item.streamId || item.id;
  const generated = item.totalSegments ? `${item.segmentCount}/${item.totalSegments} segmentów` : `${item.segmentCount ?? 0} segmentów`;
  const seconds = item.totalSeconds ? ` · ${formatTranscodeCacheDuration(item.generatedSeconds ?? 0)} / ${formatTranscodeCacheDuration(item.totalSeconds)}` : "";
  const quality = [item.mode?.toUpperCase(), item.quality, item.sourceQuality, item.strategy].filter(Boolean).join(" • ") || "-";
  const rangeText = formatTranscodeCacheRanges(item.generatedRanges ?? []);
  return `<article class="transcode-cache-card"><div class="transcode-cache-poster">${escapeTranscodeCacheHtml(getTranscodeCacheInitials(title))}</div><div class="transcode-cache-body"><strong>${escapeTranscodeCacheHtml(title)}</strong><small>${escapeTranscodeCacheHtml(quality)}</small><div class="transcode-cache-progress" title="${escapeTranscodeCacheHtml(rangeText || `${percent}%`)}">${renderTranscodeCacheRangeBars(item)}</div><small>Przetranskodowano: ${escapeTranscodeCacheHtml(generated)}${escapeTranscodeCacheHtml(seconds)}</small><small>Fragmenty: ${escapeTranscodeCacheHtml(rangeText || "brak szczegółowej mapy")}</small><small>Rozmiar: ${formatTranscodeCacheBytes(item.sizeBytes ?? 0)} · aktualizacja: ${escapeTranscodeCacheHtml(formatTranscodeCacheDate(item.lastModifiedAt))}</small></div></article>`;
}
function renderTranscodeCacheRangeBars(item) { const ranges = Array.isArray(item.generatedRanges) ? item.generatedRanges : []; const total = Number(item.totalSegments) || 0; if (ranges.length && total > 0) return ranges.map((range) => { const left = Math.max(0, Math.min(100, (Number(range.start) / total) * 100)); const width = Math.max(0.8, Math.min(100 - left, ((Number(range.end) - Number(range.start) + 1) / total) * 100)); return `<span style="left:${left}%;width:${width}%"></span>`; }).join(""); const percent = Number.isFinite(item.progressPercent) ? item.progressPercent : 0; return `<span style="left:0;width:${Math.max(0, Math.min(100, percent))}%"></span>`; }
function formatTranscodeCacheRanges(ranges) { if (!Array.isArray(ranges) || !ranges.length) return ""; return ranges.slice(0, 4).map((range) => { if (Number.isFinite(range.startSeconds) && Number.isFinite(range.endSeconds)) return `${formatTranscodeCacheDuration(range.startSeconds)}-${formatTranscodeCacheDuration(range.endSeconds)}`; return `seg. ${range.start}-${range.end}`; }).join(", ") + (ranges.length > 4 ? ` +${ranges.length - 4}` : ""); }
async function transcodeCacheApi(path, options = {}) { const response = await fetch(path, { method: options.method ?? "GET", headers: options.body ? { "content-type": "application/json" } : undefined, body: options.body ? JSON.stringify(options.body) : undefined }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`); return data; }
function formatTranscodeCacheBytes(bytes) { const value = Number(bytes) || 0; if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`; if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`; if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`; return `${value} B`; }
function formatTranscodeCacheDuration(seconds) { const value = Math.max(0, Math.round(Number(seconds) || 0)); const h = Math.floor(value / 3600); const m = Math.floor((value % 3600) / 60); const s = value % 60; return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`; }
function formatTranscodeCacheDate(value) { return value ? new Date(value).toLocaleString() : "-"; }
function getTranscodeCacheInitials(value) { return String(value || "T").split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "T"; }
function escapeTranscodeCacheHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
function showTranscodeCacheToast(message) { if (typeof toast === "function") { toast(message); return; } const el = document.getElementById("toast"); if (!el) return; el.textContent = message; el.classList.remove("hidden"); setTimeout(() => el.classList.add("hidden"), 3200); }
installTranscodeCachePanel();
setInterval(() => { if (document.getElementById("transcoding")?.classList.contains("active")) loadTranscodeCachePanel(false); }, 5000);
