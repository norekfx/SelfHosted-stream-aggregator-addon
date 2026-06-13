function updateVodCrfVisibilityForManualQuality() {
  const transcodeMode = document.getElementById("transcodeMode")?.value ?? "vod";
  const qualityMode = document.getElementById("vodQualityMode")?.value ?? "auto";
  const crfLabel = document.getElementById("vodCrfLabel");
  const bitrateLabel = document.getElementById("vodBitrateModeLabel");
  if (crfLabel) crfLabel.style.display = transcodeMode === "vod" && qualityMode !== "auto" ? "" : "none";
  if (bitrateLabel) bitrateLabel.style.display = transcodeMode === "vod" && qualityMode !== "auto" ? "" : "none";
}

function installVodCrfVisibilityForManualQuality() {
  updateVodCrfVisibilityForManualQuality();
  for (const id of ["transcodeMode", "vodQualityMode"]) {
    const element = document.getElementById(id);
    if (element && element.dataset.vodCrfVisibilityBound !== "true") {
      element.dataset.vodCrfVisibilityBound = "true";
      element.addEventListener("change", () => setTimeout(updateVodCrfVisibilityForManualQuality, 0));
    }
  }
}

installVodCrfVisibilityForManualQuality();
setInterval(installVodCrfVisibilityForManualQuality, 1000);
