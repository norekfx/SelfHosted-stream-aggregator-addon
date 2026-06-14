const settingsSaveNormalizerFetch = window.fetch.bind(window);

const OPTIONAL_NUMERIC_SETTINGS = [
  "transcodeCrfMin",
  "transcodeCrfMax",
  "transcodeBitrateMinKbps",
  "transcodeBitrateMaxKbps",
  "vodCrf",
  "vodStartupBufferSeconds",
  "vodSegmentSeconds",
  "vodFixedBatchSegmentCount",
  "debridPlaceholderMinSizeMb",
  "debridPlaceholderMinDurationMinutes",
  "debridPlaceholderSizeDifferenceGb"
];

window.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input?.url ?? "";
  const method = String(init.method ?? "GET").toUpperCase();

  if (url === "/admin/settings" && method === "PATCH" && init.body) {
    try {
      const body = JSON.parse(String(init.body));
      normalizeOptionalNumericSettings(body);
      normalizeInactiveTranscodeRanges(body);
      init = { ...init, body: JSON.stringify(body) };
    } catch {}
  }

  return settingsSaveNormalizerFetch(input, init);
};

function normalizeOptionalNumericSettings(body) {
  const startupMode = document.getElementById("vodStartupBufferMode")?.value;
  if (startupMode === "disabled") body.vodStartupBufferSeconds = 0;

  for (const field of OPTIONAL_NUMERIC_SETTINGS) {
    if (field === "vodStartupBufferSeconds" && startupMode === "disabled") continue;
    const element = document.getElementById(field);
    if (!element) continue;
    const raw = String(element.value ?? "").trim();
    if (raw === "") {
      delete body[field];
      continue;
    }
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      delete body[field];
      continue;
    }
    body[field] = numeric;
  }
}

function normalizeInactiveTranscodeRanges(body) {
  if (document.getElementById("transcodeCrfMode")?.value !== "range") {
    delete body.transcodeCrfMin;
    delete body.transcodeCrfMax;
  }
  if (document.getElementById("transcodeBitrateMode")?.value !== "range") {
    delete body.transcodeBitrateMinKbps;
    delete body.transcodeBitrateMaxKbps;
  }
  if (document.getElementById("vodQualityMode")?.value === "auto") {
    delete body.vodCrf;
    delete body.vodBitrateMode;
  }
  if (document.getElementById("detectDebridPlaceholders")?.value !== "true") {
    delete body.debridPlaceholderMinSizeMb;
    delete body.debridPlaceholderMinDurationMinutes;
    delete body.debridPlaceholderCompareDeclaredSize;
    delete body.debridPlaceholderSizeDifferenceGb;
  } else if (document.getElementById("debridPlaceholderCompareDeclaredSize")?.value !== "true") {
    delete body.debridPlaceholderSizeDifferenceGb;
  }
}
