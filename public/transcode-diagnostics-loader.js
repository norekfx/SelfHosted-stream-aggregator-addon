const TRANSCODE_DIAGNOSTICS_MODES = ["auto", "4k", "1440p", "1080p", "720p", "480p", "360p", "240p", "144p"];

function installMovieTranscodeDiagnostics() {
  const candidateSelect = document.getElementById("transcodeCandidateSelect");
  const loadButton = document.getElementById("loadTranscodeCandidatesBtn");
  const modeSelect = document.getElementById("transcodeModeSelect");
  if (!candidateSelect || !loadButton || !modeSelect) return;
  if (candidateSelect.dataset.movieLoader === "1") return;
  candidateSelect.dataset.movieLoader = "1";

  loadButton.textContent = "Znajdź film";
  loadButton.classList.remove("ghost-btn");
  loadButton.classList.add("primary-btn");

  const controls = candidateSelect.closest(".inline-form");
  if (controls && !document.getElementById("transcodeMovieIdInput")) {
    const movieInput = document.createElement("input");
    movieInput.id = "transcodeMovieIdInput";
    movieInput.placeholder = "tt0133093";
    movieInput.value = document.getElementById("diagId")?.value?.trim()?.match(/^tt\d+$/i) ? document.getElementById("diagId").value.trim() : "tt0133093";
    movieInput.autocomplete = "off";
    movieInput.inputMode = "text";
    candidateSelect.insertAdjacentElement("beforebegin", movieInput);
    movieInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        loadTranscodeMovieById();
      }
    });
  }

  candidateSelect.innerHTML = '<option value="">Najpierw znajdź film po IMDb ID...</option>';
  setTranscodeStatus("Wpisz IMDb ID filmu, np. tt0133093, i kliknij „Znajdź film”.", true);

  loadButton.addEventListener("click", loadTranscodeMovieById);
  document.getElementById("playTranscodeCandidateBtn")?.addEventListener("click", playSelectedTranscodeDiagnostic);
  document.getElementById("copyTranscodeUrlBtn")?.addEventListener("click", copySelectedTranscodeDiagnosticUrl);
}

async function loadTranscodeMovieById() {
  const input = document.getElementById("transcodeMovieIdInput");
  const button = document.getElementById("loadTranscodeCandidatesBtn");
  const candidateSelect = document.getElementById("transcodeCandidateSelect");
  const rawId = input?.value?.trim() ?? "";
  const movieId = rawId.match(/^tt\d+$/i)?.[0];
  if (!movieId) {
    showTranscodeDiagnosticToast("Podaj poprawne IMDb ID filmu, np. tt0133093.");
    input?.focus();
    return;
  }

  const previousLabel = button?.textContent ?? "Znajdź film";
  if (button) {
    button.disabled = true;
    button.textContent = "Szukam...";
  }
  if (candidateSelect) candidateSelect.innerHTML = '<option value="">Szukam filmu...</option>';
  setTranscodeStatus(`Szukam streamów dla filmu ${movieId} przez system agregacji...`, true);

  try {
    const response = await fetch(`/stream/movie/${encodeURIComponent(movieId)}.json`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    const streams = Array.isArray(data.streams) ? data.streams : [];
    const candidate = buildTranscodeCandidateFromStreams(movieId, streams);
    window.transcodeDiagnostics = {
      ...(window.transcodeDiagnostics ?? {}),
      mediaType: "movie",
      mediaId: movieId,
      streams,
      candidates: candidate ? [candidate] : []
    };

    if (!candidate) {
      if (candidateSelect) candidateSelect.innerHTML = '<option value="">Nie znaleziono działającego Original.</option>';
      setTranscodeStatus(`Nie znaleziono działającego streamu dla ${movieId}. Uruchom Test agregacji, żeby zobaczyć szczegóły walidacji.`, true);
      showTranscodeDiagnosticToast("Nie znaleziono działającego Original.");
      return;
    }

    if (candidateSelect) {
      candidateSelect.innerHTML = `<option value="${escapeDiagnosticHtml(candidate.id)}">${escapeDiagnosticHtml(candidate.title)}</option>`;
      candidateSelect.value = candidate.id;
    }
    setTranscodeStatus(`Załadowano film ${movieId}. Możesz testować Original, Live HLS albo VOD HLS seek.`, false);
    setTranscodeDetails({ media: `movie:${movieId}`, selected: candidate.title, availableModes: Object.keys(candidate.urls), streams: streams.map((stream) => ({ name: stream.name, title: stream.title, url: stream.url })) });
    showTranscodeDiagnosticToast("Film załadowany do testów transkodowania.");
  } catch (error) {
    if (candidateSelect) candidateSelect.innerHTML = '<option value="">Błąd ładowania filmu.</option>';
    setTranscodeStatus(error instanceof Error ? error.message : "Nie udało się załadować filmu.", true);
    showTranscodeDiagnosticToast("Nie udało się załadować filmu.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previousLabel;
    }
  }
}

function buildTranscodeCandidateFromStreams(movieId, streams) {
  const original = streams.find((stream) => String(stream.name ?? "").toLowerCase() === "original") ?? streams.find((stream) => stream.url && !/\/transcode\//.test(stream.url));
  const urls = {};
  if (original?.url) urls.original = original.url;

  for (const stream of streams) {
    const url = stream.url ?? "";
    const match = url.match(/\/transcode\/([^/]+)\/([^/]+)\/master\.m3u8(?:$|[?#])/);
    if (!match) continue;
    const quality = decodeURIComponent(match[2] ?? "");
    if (TRANSCODE_DIAGNOSTICS_MODES.includes(quality)) urls[quality] = url;
  }

  if (!urls.original && !Object.keys(urls).length) return null;
  const idFromUrl = Object.values(urls).find((url) => /\/transcode\//.test(url))?.match(/\/transcode\/([^/]+)\//)?.[1];
  const id = idFromUrl ? decodeURIComponent(idFromUrl) : movieId;
  const title = original?.title?.split("\n")?.[0] || streams[0]?.title || `movie:${movieId}`;
  return { id, title, urls, original, streams };
}

function getSelectedTranscodeDiagnosticUrl() {
  const candidateId = document.getElementById("transcodeCandidateSelect")?.value;
  const candidate = window.transcodeDiagnostics?.candidates?.find((item) => item.id === candidateId);
  const mode = document.getElementById("transcodeModeSelect")?.value ?? "original";
  const playbackMode = document.getElementById("transcodePlaybackModeSelect")?.value ?? "live";
  if (!candidate) return undefined;
  if (mode === "original") return candidate.urls.original;
  const liveUrl = candidate.urls[mode];
  if (!liveUrl) return undefined;
  return playbackMode === "vod" ? liveUrl.replace("/transcode/", "/transcode-vod/") : liveUrl;
}

function playSelectedTranscodeDiagnostic(event) {
  const playbackMode = document.getElementById("transcodePlaybackModeSelect")?.value ?? "live";
  const mode = document.getElementById("transcodeModeSelect")?.value ?? "original";
  if (playbackMode === "vod" && mode !== "original") return;

  event?.preventDefault?.();
  const url = getSelectedTranscodeDiagnosticUrl();
  if (!url) {
    showTranscodeDiagnosticToast("Najpierw znajdź film i wybierz tryb transkodowania.");
    return;
  }
  playTranscodeDiagnosticUrl(url, mode, playbackMode);
}

async function copySelectedTranscodeDiagnosticUrl(event) {
  const playbackMode = document.getElementById("transcodePlaybackModeSelect")?.value ?? "live";
  const mode = document.getElementById("transcodeModeSelect")?.value ?? "original";
  if (playbackMode === "vod" && mode !== "original") return;

  event?.preventDefault?.();
  const url = getSelectedTranscodeDiagnosticUrl();
  if (!url) {
    showTranscodeDiagnosticToast("Najpierw znajdź film i wybierz tryb transkodowania.");
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    showTranscodeDiagnosticToast("Skopiowano URL testowy.");
  } catch {
    showTranscodeDiagnosticToast(url);
  }
}

function playTranscodeDiagnosticUrl(url, mode, playbackMode) {
  const video = document.getElementById("transcodeVideo");
  if (!video) return;

  if (window.transcodeDiagnostics?.hls) {
    window.transcodeDiagnostics.hls.destroy();
    window.transcodeDiagnostics.hls = null;
  }

  const isHls = /\.m3u8(?:$|[?#])/.test(url);
  setTranscodeStatus(`Odtwarzam: ${mode} / ${playbackMode}${isHls ? " HLS" : ""}<br><code>${escapeDiagnosticHtml(url)}</code>`, false);

  if (isHls && window.Hls && Hls.isSupported()) {
    const hls = new Hls({ debug: false, lowLatencyMode: playbackMode === "live" });
    window.transcodeDiagnostics = { ...(window.transcodeDiagnostics ?? {}), hls };
    hls.on(Hls.Events.ERROR, (_, data) => {
      setTranscodeStatus(`HLS error: ${escapeDiagnosticHtml(data.type)} / ${escapeDiagnosticHtml(data.details)} / fatal=${escapeDiagnosticHtml(data.fatal)}`, true, true);
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
  } else {
    video.src = url;
    video.play().catch(() => {});
  }
}

function setTranscodeStatus(message, isEmpty = false, append = false) {
  const status = document.getElementById("transcodeStatus");
  if (!status) return;
  status.classList.toggle("empty", isEmpty);
  status.innerHTML = append ? `${status.innerHTML}<br>${message}` : message;
}

function setTranscodeDetails(details) {
  const element = document.getElementById("transcodeDetails");
  if (!element) return;
  element.textContent = JSON.stringify(details, null, 2);
}

function showTranscodeDiagnosticToast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3200);
}

function escapeDiagnosticHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

installMovieTranscodeDiagnostics();
setInterval(installMovieTranscodeDiagnostics, 1000);
