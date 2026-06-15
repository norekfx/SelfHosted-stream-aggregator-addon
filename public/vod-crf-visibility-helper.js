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
  const segmentSeconds = document.getElementById("vodSegmentSeconds");

  if (strategy === "worker") {
    if (progression) progression.value = "infinite";
    if (adaptive) adaptive.value = "false";
    if (batch) batch.value = "100";
    if (segmentSeconds) segmentSeconds.value = "6";
  }
}

function installVodTranscodeStrategyUi() {
  const vodBlock = document.getElementById("vodTranscodeSettingsBlock");
  const qsvLabel = document.getElementById("vodIntelQsvMode")?.closest("label");
  if (!vodBlock || !qsvLabel || document.getElementById("vodTranscodeStrategy")) return;
  qsvLabel.insertAdjacentHTML("beforebegin", `
    <label>Sposób transkodowania VOD<select id="vodTranscodeStrategy"><option value="batch">Paczki / seek-friendly</option><option value="worker">Worker / pełna playlista VOD</option></select></label>
    <p id="vodTranscodeStrategyHint" class="hint"></p>
  `);
  const select = document.getElementById("vodTranscodeStrategy");
  select.value = getVodTranscodeStrategy();
  select.addEventListener("change", () => { applyVodTranscodeStrategy(); updateVodTranscodeStrategyVisibility(); });
}

function updateVodTranscodeStrategyVisibility() {
  installVodTranscodeStrategyUi();
  applyVodTranscodeStrategy();
  const transcodeMode = document.getElementById("transcodeMode")?.value ?? "vod";
  const strategy = getVodTranscodeStrategy();
  const isVod = transcodeMode === "vod";
  const isWorker = isVod && strategy === "worker";
  const qualityMode = document.getElementById("vodQualityMode")?.value ?? "auto";
  const crfLabel = document.getElementById("vodCrfLabel") ?? document.getElementById("vodCrf")?.closest("label");
  const bitrateLabel = document.getElementById("vodBitrateModeLabel") ?? document.getElementById("vodBitrateMode")?.closest("label");
  const qualityLabel = document.getElementById("vodQualityMode")?.closest("label");
  const hint = document.getElementById("vodTranscodeStrategyHint");

  const workerHiddenIds = ["vodSegmentSeconds", "vodBufferProgression", "vodAdaptiveBatchEnabled", "vodFixedBatchSegmentCount"];
  for (const id of workerHiddenIds) {
    const label = document.getElementById(id)?.closest("label");
    if (label) label.style.display = isWorker ? "none" : "";
  }

  if (qualityLabel) qualityLabel.style.display = isVod ? "" : "none";
  if (crfLabel) crfLabel.style.display = isVod && (isWorker || qualityMode !== "auto") ? "" : "none";
  if (bitrateLabel) bitrateLabel.style.display = isVod && (isWorker || qualityMode !== "auto") ? "" : "none";
  if (hint) hint.textContent = isWorker
    ? "Worker: pełna playlista VOD, segmenty powstają do przodu jednym długim FFmpeg od aktualnego miejsca. Tryb jakości Auto dostraja CRF i bitrate dla kolejnych segmentów, celując w ok. 1.15x."
    : "Paczki: obecny tryb, lepszy do częstego przewijania, ale może mieć przerwy między paczkami.";
}

function installVodCrfVisibilityForManualQuality() {
  updateVodTranscodeStrategyVisibility();
  for (const id of ["transcodeMode", "vodQualityMode", "vodBufferProgression", "vodAdaptiveBatchEnabled", "vodFixedBatchSegmentCount", "vodTranscodeStrategy"]) {
    const element = document.getElementById(id);
    if (element && element.dataset.vodCrfVisibilityBound !== "true") {
      element.dataset.vodCrfVisibilityBound = "true";
      element.addEventListener("change", () => setTimeout(updateVodTranscodeStrategyVisibility, 0));
    }
  }
}

installVodCrfVisibilityForManualQuality();
setInterval(installVodCrfVisibilityForManualQuality, 1000);
