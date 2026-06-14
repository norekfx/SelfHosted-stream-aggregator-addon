function getVodTranscodeStrategy() {
  const explicit = document.getElementById("vodTranscodeStrategy")?.value;
  if (explicit) return explicit;
  const progression = document.getElementById("vodBufferProgression")?.value;
  const adaptive = document.getElementById("vodAdaptiveBatchEnabled")?.value;
  const batch = Number(document.getElementById("vodFixedBatchSegmentCount")?.value ?? 0);
  return progression === "infinite" && adaptive === "false" && batch >= 90 ? "worker" : "batch";
}

function applyVodTranscodeStrategy() {
  const strategy = getVodTranscodeStrategy();
  const progression = document.getElementById("vodBufferProgression");
  const adaptive = document.getElementById("vodAdaptiveBatchEnabled");
  const batch = document.getElementById("vodFixedBatchSegmentCount");
  const qualityMode = document.getElementById("vodQualityMode");
  const segmentSeconds = document.getElementById("vodSegmentSeconds");

  if (strategy === "worker") {
    if (progression) progression.value = "infinite";
    if (adaptive) adaptive.value = "false";
    if (batch) batch.value = "100";
    if (qualityMode && qualityMode.value === "auto") qualityMode.value = "disabled";
    if (segmentSeconds) segmentSeconds.value = "6";
  }
}

function normalizeVodStartupBufferInputValidity() {
  const input = document.getElementById("vodStartupBufferSeconds");
  if (!input) return;
  input.min = "0";
  input.setAttribute("min", "0");
  input.setCustomValidity("");
}

function installVodTranscodeStrategyUi() {
  const vodBlock = document.getElementById("vodTranscodeSettingsBlock");
  const qsvLabel = document.getElementById("vodIntelQsvMode")?.closest("label");
  normalizeVodStartupBufferInputValidity();
  if (!vodBlock || !qsvLabel || document.getElementById("vodTranscodeStrategy")) return;
  qsvLabel.insertAdjacentHTML("beforebegin", `
    <label>Sposób transkodowania VOD<select id="vodTranscodeStrategy"><option value="batch">Paczki / seek-friendly</option><option value="worker">Worker / ciągłe dogenerowywanie</option></select></label>
    <p id="vodTranscodeStrategyHint" class="hint"></p>
  `);
  const select = document.getElementById("vodTranscodeStrategy");
  select.value = getVodTranscodeStrategy();
  select.addEventListener("change", () => { applyVodTranscodeStrategy(); updateVodTranscodeStrategyVisibility(); });
}

function updateVodTranscodeStrategyVisibility() {
  installVodTranscodeStrategyUi();
  normalizeVodStartupBufferInputValidity();
  applyVodTranscodeStrategy();
  const transcodeMode = document.getElementById("transcodeMode")?.value ?? "vod";
  const strategy = getVodTranscodeStrategy();
  const isVod = transcodeMode === "vod";
  const isWorker = isVod && strategy === "worker";
  const qualityMode = document.getElementById("vodQualityMode")?.value ?? "auto";
  const crfLabel = document.getElementById("vodCrfLabel");
  const bitrateLabel = document.getElementById("vodBitrateModeLabel");
  const hint = document.getElementById("vodTranscodeStrategyHint");

  const batchOnlyIds = ["vodSegmentSeconds", "vodBufferProgression", "vodAdaptiveBatchEnabled", "vodFixedBatchSegmentCount", "vodQualityMode"];
  for (const id of batchOnlyIds) {
    const label = document.getElementById(id)?.closest("label");
    if (label) label.style.display = isWorker ? "none" : "";
  }

  if (crfLabel) crfLabel.style.display = isVod && (isWorker || qualityMode !== "auto") ? "" : "none";
  if (bitrateLabel) bitrateLabel.style.display = isVod && (isWorker || qualityMode !== "auto") ? "" : "none";
  if (hint) hint.textContent = isWorker
    ? "Worker: po buforze startowym FFmpeg dostaje długą paczkę do przodu. Cel: mniej restartów FFmpeg i bardziej ciągłe użycie CPU/iGPU."
    : "Paczki: obecny tryb, lepszy do częstego przewijania, ale może mieć przerwy między paczkami.";
}

function installVodCrfVisibilityForManualQuality() {
  updateVodTranscodeStrategyVisibility();
  normalizeVodStartupBufferInputValidity();
  for (const id of ["transcodeMode", "vodQualityMode", "vodBufferProgression", "vodAdaptiveBatchEnabled", "vodFixedBatchSegmentCount", "vodStartupBufferSeconds"]) {
    const element = document.getElementById(id);
    if (element && element.dataset.vodCrfVisibilityBound !== "true") {
      element.dataset.vodCrfVisibilityBound = "true";
      element.addEventListener("change", () => setTimeout(updateVodTranscodeStrategyVisibility, 0));
      element.addEventListener("input", () => setTimeout(normalizeVodStartupBufferInputValidity, 0));
    }
  }
}

installVodCrfVisibilityForManualQuality();
setInterval(installVodCrfVisibilityForManualQuality, 1000);
