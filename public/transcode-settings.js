const TRANSCODE_SETTING_FIELDS = [
  "autoTranscodeMinQuality",
  "autoTranscodeMaxQuality",
  "transcodePreset",
  "transcodeCrfMode",
  "transcodeCrfMin",
  "transcodeCrfMax",
  "transcodeBitrateMode",
  "transcodeBitrateMinKbps",
  "transcodeBitrateMaxKbps"
];

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
    transcodeBitrateMaxKbps: 6000
  };

  for (const field of TRANSCODE_SETTING_FIELDS) {
    const element = document.getElementById(field);
    if (!element) continue;
    element.value = settings[field] ?? defaults[field];
  }
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
  setTimeout(() => el.classList.add("hidden"), 3200);
}

setInterval(() => {
  const form = document.getElementById("settingsForm");
  if (form && form.dataset.transcodeSettingsPatch !== "1") {
    form.dataset.transcodeSettingsPatch = "1";
    originalFetch("/admin/settings")
      .then((response) => response.json())
      .then((data) => fillTranscodeSettings(data.settings ?? {}))
      .catch(() => {});
  }

  installDiagnosticVodUi();
}, 1000);
