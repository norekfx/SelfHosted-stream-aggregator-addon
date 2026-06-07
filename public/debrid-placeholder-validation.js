const PLACEHOLDER_VALIDATION_MODE_FIELD = "debridPlaceholderValidationMode";
const PLACEHOLDER_VALIDATION_MODE_OPTIONS = '<option value="best">Szukanie najlepszego</option><option value="all">Wszystkie</option><option value="5">5 najlepszych</option><option value="10">10 najlepszych</option><option value="20">20 najlepszych</option><option value="40">40 najlepszych</option><option value="80">80 najlepszych</option><option value="100">100 najlepszych</option><option value="150">150 najlepszych</option><option value="200">200 najlepszych</option>';

const previousFetchForPlaceholderValidation = window.fetch.bind(window);

window.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input?.url ?? "";
  const method = String(init.method ?? "GET").toUpperCase();

  if (url === "/admin/settings" && method === "PATCH" && init.body) {
    try {
      const body = JSON.parse(String(init.body));
      const mode = document.getElementById(PLACEHOLDER_VALIDATION_MODE_FIELD)?.value;
      if (mode) body[PLACEHOLDER_VALIDATION_MODE_FIELD] = mode;
      init = { ...init, body: JSON.stringify(body) };
    } catch {
      // Keep original request if parsing failed.
    }
  }

  const response = await previousFetchForPlaceholderValidation(input, init);

  if (url === "/admin/settings" && method === "GET") {
    response.clone().json().then((data) => fillDebridPlaceholderValidationMode(data.settings ?? {})).catch(() => {});
  }

  return response;
};

function installDebridPlaceholderValidationMode() {
  const options = document.getElementById("debridPlaceholderOptions");
  if (!options || document.getElementById(PLACEHOLDER_VALIDATION_MODE_FIELD)) return;

  const label = document.createElement("label");
  label.innerHTML = `Walidacja placeholderów<select id="${PLACEHOLDER_VALIDATION_MODE_FIELD}">${PLACEHOLDER_VALIDATION_MODE_OPTIONS}</select>`;
  options.insertAdjacentElement("afterbegin", label);

  previousFetchForPlaceholderValidation("/admin/settings")
    .then((response) => response.json())
    .then((data) => fillDebridPlaceholderValidationMode(data.settings ?? {}))
    .catch(() => {});
}

function fillDebridPlaceholderValidationMode(settings) {
  const select = document.getElementById(PLACEHOLDER_VALIDATION_MODE_FIELD);
  if (!select) return;
  select.value = settings.debridPlaceholderValidationMode ?? "best";
}

installDebridPlaceholderValidationMode();
setInterval(installDebridPlaceholderValidationMode, 1000);
