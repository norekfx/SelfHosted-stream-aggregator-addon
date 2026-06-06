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

setInterval(() => {
  const form = document.getElementById("settingsForm");
  if (!form || form.dataset.transcodeSettingsPatch === "1") return;
  form.dataset.transcodeSettingsPatch = "1";
  originalFetch("/admin/settings")
    .then((response) => response.json())
    .then((data) => fillTranscodeSettings(data.settings ?? {}))
    .catch(() => {});
}, 1000);
