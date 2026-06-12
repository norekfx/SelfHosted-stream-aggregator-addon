const VOD_SETTING_FIELDS = [
  "transcodeMode",
  "vodSegmentSeconds",
  "vodStartupBufferSeconds",
  "vodBufferProgression",
  "vodAdaptiveBatchEnabled",
  "vodFixedBatchSegmentCount",
  "vodQualityMode",
  "vodCrf",
  "vodBitrateMode",
  "vodAudioMode"
];

const VOD_BOOLEAN_FIELDS = new Set(["vodAdaptiveBatchEnabled"]);
const vodSettingsFetch = window.fetch.bind(window);

window.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input?.url ?? "";
  const method = String(init.method ?? "GET").toUpperCase();
  if (url === "/admin/settings" && method === "PATCH" && init.body) {
    try {
      const body = JSON.parse(String(init.body));
      for (const field of VOD_SETTING_FIELDS) {
        const element = document.getElementById(field);
        if (!element) continue;
        body[field] = VOD_BOOLEAN_FIELDS.has(field) ? element.value !== "false" : element.type === "number" ? Number(element.value) : element.value;
      }
      init = { ...init, body: JSON.stringify(body) };
    } catch {}
  }
  const response = await vodSettingsFetch(input, init);
  if (url === "/admin/settings" && method === "GET") {
    response.clone().json().then((data) => fillVodTranscodeSettings(data.settings ?? {})).catch(() => {});
  }
  return response;
};

function installVodTranscodeSettingsUi() {
  const liveAnchor = document.getElementById("defaultTranscodeBufferPreset");
  if (!liveAnchor || document.getElementById("transcodeMode")) return;
  const panel = liveAnchor.closest("article");
  const form = liveAnchor.closest(".settings-form");
  if (!panel || !form) return;

  panel.querySelector("h2").textContent = "Transkodowanie";
  liveAnchor.closest("label")?.insertAdjacentHTML("beforebegin", `
    <label>Rodzaj transkodowania<select id="transcodeMode"><option value="vod">VOD HLS</option><option value="live">Live HLS</option></select></label>
    <div id="liveTranscodeSettingsBlock" style="display:contents">
      <p class="hint">Poniższe ustawienia dotyczą tylko Live HLS.</p>
    </div>
  `);

  const liveBlock = document.getElementById("liveTranscodeSettingsBlock");
  const liveLabels = ["defaultTranscodeBufferPreset", "autoTranscodeMinQuality", "autoTranscodeMaxQuality", "transcodePreset", "transcodeCrfMode", "transcodeCrfMin", "transcodeCrfMax", "transcodeBitrateMode", "transcodeBitrateMinKbps", "transcodeBitrateMaxKbps"].map((id) => document.getElementById(id)?.closest("label")).filter(Boolean);
  for (const label of liveLabels) liveBlock?.appendChild(label);

  form.insertAdjacentHTML("beforeend", `
    <div id="vodTranscodeSettingsBlock" style="display:contents">
      <p class="hint">Poniższe ustawienia dotyczą tylko VOD HLS. Linki transkodowane w streamach będą domyślnie używać VOD HLS.</p>
      <label>Długość segmentów<select id="vodSegmentSeconds"><option value="4">4 sek</option><option value="6">6 sek</option><option value="8">8 sek</option><option value="10">10 sek</option><option value="12">12 sek</option><option value="15">15 sek</option><option value="20">20 sek</option></select></label>
      <label>Bufor startowy<input id="vodStartupBufferSeconds" type="number" min="1" max="600" step="1" value="20" /></label>
      <label>Progresja buforu<select id="vodBufferProgression"><option value="target">Bufor ustawiony powyżej</option><option value="infinite">Nieskończony / do końca filmu</option></select></label>
      <label>Bufor zwiększający segmenty<select id="vodAdaptiveBatchEnabled"><option value="true">Włączony</option><option value="false">Wyłączony</option></select></label>
      <label id="vodFixedBatchSegmentCountLabel">Ilość segmentów w jednej paczce<input id="vodFixedBatchSegmentCount" type="number" min="1" max="100" step="1" value="2" /></label>
      <label>Zmiana jakości segmentów<select id="vodQualityMode"><option value="disabled">Wyłączona</option><option value="enabled">Włączona</option><option value="auto">Automatyczna</option></select></label>
      <label id="vodCrfLabel">CRF<input id="vodCrf" type="number" min="16" max="35" step="1" value="26" /></label>
      <label id="vodBitrateModeLabel">Bitrate<select id="vodBitrateMode"><option value="auto">Automatyczny</option><option value="250">250 kbps</option><option value="500">500 kbps</option><option value="800">800 kbps</option><option value="1200">1200 kbps</option><option value="1800">1800 kbps</option><option value="2500">2500 kbps</option><option value="3500">3500 kbps</option><option value="5000">5000 kbps</option><option value="8000">8000 kbps</option><option value="12000">12000 kbps</option><option value="18000">18000 kbps</option></select></label>
      <label>Audio<select id="vodAudioMode"><option value="aac">AAC</option><option value="copy">Kopiuj ze źródła</option><option value="disabled">Wyłączone</option></select></label>
    </div>
  `);

  for (const id of ["transcodeMode", "vodAdaptiveBatchEnabled", "vodQualityMode"]) document.getElementById(id)?.addEventListener("change", updateVodSettingsVisibility);
  vodSettingsFetch("/admin/settings").then((response) => response.json()).then((data) => fillVodTranscodeSettings(data.settings ?? {})).catch(() => {});
  updateVodSettingsVisibility();
}

function fillVodTranscodeSettings(settings) {
  const defaults = { transcodeMode: "vod", vodSegmentSeconds: 10, vodStartupBufferSeconds: 20, vodBufferProgression: "infinite", vodAdaptiveBatchEnabled: true, vodFixedBatchSegmentCount: 2, vodQualityMode: "auto", vodCrf: 26, vodBitrateMode: "auto", vodAudioMode: "aac" };
  for (const field of VOD_SETTING_FIELDS) {
    const element = document.getElementById(field);
    if (!element) continue;
    const value = settings[field] ?? defaults[field];
    element.value = VOD_BOOLEAN_FIELDS.has(field) ? String(value === true) : String(value);
  }
  updateVodSettingsVisibility();
}

function updateVodSettingsVisibility() {
  const mode = document.getElementById("transcodeMode")?.value ?? "vod";
  const live = document.getElementById("liveTranscodeSettingsBlock");
  const vod = document.getElementById("vodTranscodeSettingsBlock");
  if (live) live.style.display = mode === "live" ? "contents" : "none";
  if (vod) vod.style.display = mode === "vod" ? "contents" : "none";
  const adaptive = document.getElementById("vodAdaptiveBatchEnabled")?.value !== "false";
  const qualityMode = document.getElementById("vodQualityMode")?.value ?? "auto";
  const batchLabel = document.getElementById("vodFixedBatchSegmentCountLabel");
  const crfLabel = document.getElementById("vodCrfLabel");
  const bitrateLabel = document.getElementById("vodBitrateModeLabel");
  if (batchLabel) batchLabel.style.display = mode === "vod" && !adaptive ? "" : "none";
  if (crfLabel) crfLabel.style.display = mode === "vod" && qualityMode === "enabled" ? "" : "none";
  if (bitrateLabel) bitrateLabel.style.display = mode === "vod" && qualityMode !== "auto" ? "" : "none";
}

installVodTranscodeSettingsUi();
setInterval(installVodTranscodeSettingsUi, 1000);
