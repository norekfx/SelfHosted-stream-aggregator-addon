const TRANSCODE_DIAGNOSTICS_MODES = ["auto", "4k", "1440p", "1080p", "720p", "480p", "360p", "240p", "144p"];

function installEarlyTranscodeDiagnosticClickCapture() {
  if (window.__transcodeDiagnosticEarlyCapture === "1") return;
  window.__transcodeDiagnosticEarlyCapture = "1";
  window.addEventListener("click", (event) => {
    const target = event.target?.closest?.("#playTranscodeCandidateBtn,#copyTranscodeUrlBtn");
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (target.id === "copyTranscodeUrlBtn") copySelectedTranscodeDiagnosticUrl(event);
    else playSelectedTranscodeDiagnostic(event);
  }, true);
}

function disableLegacyVodDiagnosticHandler() {
  if (typeof window.handleVodDiagnosticClick === "function") {
    document.removeEventListener("click", window.handleVodDiagnosticClick, true);
  }
}

function installMovieTranscodeDiagnostics() {
  installEarlyTranscodeDiagnosticClickCapture();
  disableLegacyVodDiagnosticHandler();
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
      if (candidateSelect) candidateSelect.innerHTML = '<option value="">Nie znaleziono działającego Original ani linku HLS.</option>';
      setTranscodeStatus(`Nie znaleziono działającego streamu dla ${movieId}. Uruchom Test agregacji, żeby zobaczyć szczegóły walidacji.`, true);
      showTranscodeDiagnosticToast("Nie znaleziono działającego Original ani HLS.");
      return;
    }

    if (candidateSelect) {
      candidateSelect.innerHTML = `<option value="${escapeDiagnosticHtml(candidate.id)}">${escapeDiagnosticHtml(candidate.title)}</option>`;
      candidateSelect.value = candidate.id;
    }
    setTranscodeStatus(`Załadowano film ${movieId}. Możesz testować Original, Live HLS albo VOD HLS seek.`, false);
    setTranscodeDetails({ media: `movie:${movieId}`, selected: candidate.title, availableModes: Object.keys(candidate.urls), streamId: candidate.id, streams: streams.map((stream) => ({ name: stream.name, title: stream.title, url: stream.url })) });
    await refreshDiagnosticTranscodeStatus();
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
  const original = streams.find((stream) => String(stream.name ?? "").toLowerCase() === "original") ?? streams.find((stream) => stream.url && !/\/transcode(?:-vod)?\//.test(stream.url));
  const urls = {};
  if (original?.url) urls.original = original.url;

  for (const stream of streams) {
    const url = stream.url ?? "";
    const match = url.match(/\/transcode(?:-vod)?\/([^/]+)\/([^/]+)\/master\.m3u8(?:$|[?#])/);
    if (!match) continue;
    const quality = decodeURIComponent(match[2] ?? "");
    if (!TRANSCODE_DIAGNOSTICS_MODES.includes(quality)) continue;
    const normalized = normalizeTranscodeDiagnosticUrl(url);
    urls[quality] = normalized.live;
    urls[`vod:${quality}`] = normalized.vod;
  }

  const hlsUrl = Object.values(urls).find((url) => /\/transcode(?:-vod)?\//.test(url));
  if (!urls.original && !hlsUrl) return null;
  const idFromUrl = hlsUrl?.match(/\/transcode(?:-vod)?\/([^/]+)\//)?.[1];
  const id = idFromUrl ? decodeURIComponent(idFromUrl) : movieId;
  const title = original?.title?.split("\n")?.[0] || streams[0]?.title || `movie:${movieId}`;
  return { id, title, urls, original, streams };
}

function normalizeTranscodeDiagnosticUrl(url) {
  return {
    live: url.replace("/transcode-vod/", "/transcode/"),
    vod: url.replace("/transcode/", "/transcode-vod/")
  };
}

function getSelectedTranscodeDiagnosticUrl() {
  const candidateId = document.getElementById("transcodeCandidateSelect")?.value;
  const candidates = window.transcodeDiagnostics?.candidates ?? [];
  const candidate = candidates.find((item) => item.id === candidateId) ?? candidates[0];
  const mode = document.getElementById("transcodeModeSelect")?.value ?? "original";
  const playbackMode = document.getElementById("transcodePlaybackModeSelect")?.value ?? "live";
  if (!candidate) return undefined;
  if (mode === "original") return candidate.urls.original;
  return candidate.urls[playbackMode === "vod" ? `vod:${mode}` : mode] ?? buildFallbackTranscodeDiagnosticUrl(candidate, mode, playbackMode);
}

function buildFallbackTranscodeDiagnosticUrl(candidate, mode, playbackMode) {
  const streamId = getDiagnosticCandidateStreamId(candidate);
  if (!streamId || !TRANSCODE_DIAGNOSTICS_MODES.includes(mode)) return undefined;
  const path = playbackMode === "vod" ? "transcode-vod" : "transcode";
  return `${window.location.origin}/${path}/${encodeURIComponent(streamId)}/${encodeURIComponent(mode)}/master.m3u8`;
}

function getDiagnosticCandidateStreamId(candidate) {
  const fromUrls = Object.values(candidate?.urls ?? {}).find((url) => /\/transcode(?:-vod)?\//.test(String(url)))?.match(/\/transcode(?:-vod)?\/([^/]+)\//)?.[1];
  if (fromUrls) return decodeURIComponent(fromUrls);
  if (candidate?.id && !/^tt\d+$/i.test(candidate.id)) return candidate.id;
  return undefined;
}

function playSelectedTranscodeDiagnostic(event) {
  event?.preventDefault?.();
  event?.stopImmediatePropagation?.();
  const playbackMode = document.getElementById("transcodePlaybackModeSelect")?.value ?? "live";
  const mode = document.getElementById("transcodeModeSelect")?.value ?? "original";
  const url = getSelectedTranscodeDiagnosticUrl();
  if (!url) {
    showTranscodeDiagnosticToast("Nie udało się zbudować URL transkodowania dla tego filmu. Kliknij Znajdź film ponownie.");
    setTranscodeDetails({ error: "missing_transcode_url", mode, playbackMode, candidates: window.transcodeDiagnostics?.candidates ?? [], streams: window.transcodeDiagnostics?.streams ?? [] });
    return;
  }
  void playTranscodeDiagnosticUrl(url, mode, playbackMode);
}

async function copySelectedTranscodeDiagnosticUrl(event) {
  event?.preventDefault?.();
  event?.stopImmediatePropagation?.();
  const url = getSelectedTranscodeDiagnosticUrl();
  if (!url) {
    showTranscodeDiagnosticToast("Nie udało się zbudować URL transkodowania dla tego filmu. Kliknij Znajdź film ponownie.");
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    showTranscodeDiagnosticToast("Skopiowano URL testowy.");
  } catch {
    showTranscodeDiagnosticToast(url);
  }
}

async function playTranscodeDiagnosticUrl(url, mode, playbackMode) {
  const video = document.getElementById("transcodeVideo");
  if (!video) return;

  if (window.transcodeDiagnostics?.hls) {
    window.transcodeDiagnostics.hls.destroy();
    window.transcodeDiagnostics.hls = null;
  }

  video.pause();
  video.removeAttribute("src");
  video.load();

  const isHls = /\.m3u8(?:$|[?#])/.test(url);
  setTranscodeStatus(`Odtwarzam: ${mode} / ${playbackMode}${isHls ? " HLS" : ""}<br><code>${escapeDiagnosticHtml(url)}</code>`, false);
  window.transcodeDiagnostics = { ...(window.transcodeDiagnostics ?? {}), currentPlaybackMode: playbackMode, currentMode: mode, currentUrl: url };
  refreshDiagnosticTranscodeStatus();

  if (isHls) {
    void preflightHlsPlaylist(url, mode, playbackMode);
  }

  if (isHls && window.Hls && Hls.isSupported()) {
    const hls = new Hls({ debug: false, lowLatencyMode: playbackMode === "live" });
    window.transcodeDiagnostics = { ...(window.transcodeDiagnostics ?? {}), hls };
    hls.on(Hls.Events.ERROR, (_, data) => {
      setTranscodeStatus(`HLS error: ${escapeDiagnosticHtml(data.type)} / ${escapeDiagnosticHtml(data.details)} / fatal=${escapeDiagnosticHtml(data.fatal)}`, true, true);
    });
    hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(url));
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch((error) => setTranscodeStatus(`Nie udało się wystartować video.play(): ${escapeDiagnosticHtml(error?.message ?? error)}`, true, true)));
    hls.attachMedia(video);
  } else {
    video.src = url;
    video.addEventListener("error", () => setTranscodeStatus(`Błąd elementu video przy URL: <code>${escapeDiagnosticHtml(url)}</code>`, true, true), { once: true });
    video.play().catch((error) => setTranscodeStatus(`Nie udało się wystartować video.play(): ${escapeDiagnosticHtml(error?.message ?? error)}`, true, true));
  }
}

async function preflightHlsPlaylist(url, mode, playbackMode) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    const text = await response.text().catch(() => "");
    setTranscodeDetails({ mode, playbackMode, url, playlistStatus: response.status, playlistPreview: text.slice(0, 800), candidates: window.transcodeDiagnostics?.candidates ?? [] });
    if (!response.ok) {
      setTranscodeStatus(`Playlist HLS jeszcze nie jest gotowa: HTTP ${response.status}<br><code>${escapeDiagnosticHtml(url)}</code><pre>${escapeDiagnosticHtml(text.slice(0, 800))}</pre>`, false, true);
      return false;
    }
    if (!/^#EXTM3U/m.test(text)) {
      setTranscodeStatus(`Endpoint diagnostyczny nie zwrócił jeszcze playlisty HLS.<br><code>${escapeDiagnosticHtml(url)}</code><pre>${escapeDiagnosticHtml(text.slice(0, 800))}</pre>`, false, true);
      return false;
    }
    return true;
  } catch (error) {
    setTranscodeStatus(`Diagnostyczny preflight playlisty HLS nie powiódł się, ale odtwarzacz nadal próbuje uruchomić stream: ${escapeDiagnosticHtml(error?.message ?? error)}<br><code>${escapeDiagnosticHtml(url)}</code>`, false, true);
    setTranscodeDetails({ mode, playbackMode, url, error: String(error), candidates: window.transcodeDiagnostics?.candidates ?? [] });
    return false;
  }
}

async function refreshDiagnosticTranscodeStatus() {
  const liveStatus = document.getElementById("transcodeLiveStatus");
  if (!liveStatus) return;
  const candidateId = document.getElementById("transcodeCandidateSelect")?.value;
  const mode = document.getElementById("transcodeModeSelect")?.value ?? window.transcodeDiagnostics?.currentMode ?? "auto";
  const playbackMode = document.getElementById("transcodePlaybackModeSelect")?.value ?? window.transcodeDiagnostics?.currentPlaybackMode ?? "live";

  try {
    const response = await fetch("/transcode/sessions");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const sessions = data.sessions ?? [];
    const session = findDiagnosticSession(sessions, candidateId, mode, playbackMode);
    if (!session) {
      liveStatus.classList.add("empty");
      liveStatus.textContent = "Brak aktywnych danych diagnostycznych dla wybranego testu.";
      return;
    }
    liveStatus.classList.remove("empty");
    liveStatus.innerHTML = renderDiagnosticSession(session);
    setTranscodeDetails(session);
  } catch (error) {
    liveStatus.classList.add("empty");
    liveStatus.textContent = `Nie udało się pobrać diagnostyki transkodowania: ${error instanceof Error ? error.message : "nieznany błąd"}`;
  }
}

function findDiagnosticSession(sessions, candidateId, mode, playbackMode) {
  const normalizedMode = mode === "original" ? undefined : mode;
  const wantedVod = playbackMode === "vod";
  const normalizedCandidate = decodeURIComponent(candidateId ?? "");
  const matching = sessions.filter((session) => {
    const sessionStreamId = decodeURIComponent(session.streamId ?? "");
    if (normalizedCandidate && session.streamId !== candidateId && sessionStreamId !== normalizedCandidate) return false;
    if (normalizedMode && session.quality !== normalizedMode) return false;
    if (wantedVod && session.mode !== "vod") return false;
    if (!wantedVod && session.mode === "vod") return false;
    return true;
  });
  return matching.find((session) => ["running", "starting"].includes(session.status)) ?? matching[0] ?? sessions.find((session) => ["running", "starting"].includes(session.status)) ?? sessions[0];
}

function renderDiagnosticSession(session) {
  const buffer = session.buffer ?? {};
  const stats = session.speedStats ?? {};
  const activeBatch = buffer.activeBatch ?? session.activeBatch;
  const lastBatch = buffer.lastBatch ?? session.lastBatch;
  const ranges = Array.isArray(buffer.generatedRanges) ? buffer.generatedRanges : [];
  return `
    <div class="kv-list">
      <div class="kv"><span>Tryb</span><strong>${escapeDiagnosticHtml(session.modeLabel ?? session.mode ?? "-")} / ${escapeDiagnosticHtml(session.quality ?? "-")} / ${escapeDiagnosticHtml(session.status ?? "-")}</strong></div>
      <div class="kv"><span>Prędkość</span><strong>teraz ${escapeDiagnosticHtml(session.progress?.speed ?? "-")} · fps ${escapeDiagnosticHtml(session.progress?.fps ?? "-")} · avg ${formatDiagnosticSpeed(stats.average)}</strong></div>
      <div class="kv"><span>Segmenty</span><strong>${escapeDiagnosticHtml(buffer.generatedSegments ?? buffer.segmentCount ?? 0)} / ${escapeDiagnosticHtml(buffer.totalSegments ?? "-")} wygenerowane · ${escapeDiagnosticHtml(buffer.remainingSegments ?? "-")} zostało</strong></div>
      <div class="kv"><span>Bufor na dysku</span><strong>${escapeDiagnosticHtml(buffer.estimatedGeneratedSeconds ?? buffer.estimatedSeconds ?? 0)}s · segment ${escapeDiagnosticHtml(buffer.segmentSeconds ?? "-")}s · target ${escapeDiagnosticHtml(buffer.targetSeconds ?? "-")}s</strong></div>
      <div class="kv"><span>Paczki</span><strong>batch ${escapeDiagnosticHtml(buffer.batchSegmentCount ?? "-")} segmentów · prewarm ${escapeDiagnosticHtml(buffer.prewarmSegmentCount ?? "-")} segmentów · kolejka ${escapeDiagnosticHtml(session.queuedSegments ?? 0)}</strong></div>
      <div class="kv"><span>Profil</span><strong>${escapeDiagnosticHtml((session.profile?.preset ?? activeBatch?.preset) ?? "-")} · CRF ${escapeDiagnosticHtml((session.profile?.crf ?? activeBatch?.crf) ?? "-")} · ${escapeDiagnosticHtml((session.profile?.videoBitrateKbps ?? activeBatch?.videoBitrateKbps) ?? "auto")} kbps</strong></div>
      <div class="kv"><span>Aktywna paczka</span><strong>${renderBatchLabel(activeBatch)}</strong></div>
      <div class="kv"><span>Ostatnia paczka</span><strong>${renderBatchLabel(lastBatch)}</strong></div>
      <div class="kv"><span>Zakresy na dysku</span><strong>${ranges.length ? ranges.map((range) => `${range.start}-${range.end}`).join(", ") : "-"}</strong></div>
    </div>
  `;
}

function renderBatchLabel(batch) {
  if (!batch) return "-";
  const duration = Number.isFinite(Number(batch.durationSeconds)) ? `${Math.round(Number(batch.durationSeconds))}s` : "-";
  return `${escapeDiagnosticHtml(batch.firstSegmentName ?? batch.firstSegmentIndex ?? "?")} → ${escapeDiagnosticHtml(batch.lastSegmentName ?? batch.lastSegmentIndex ?? "?")} · ${escapeDiagnosticHtml(batch.segmentCount ?? "?")} segmentów · ${duration} · ${escapeDiagnosticHtml(batch.speed ?? "")}`;
}

function formatDiagnosticSpeed(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(2)}x` : "-";
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

installEarlyTranscodeDiagnosticClickCapture();
disableLegacyVodDiagnosticHandler();
installMovieTranscodeDiagnostics();
setInterval(installMovieTranscodeDiagnostics, 1000);
setInterval(refreshDiagnosticTranscodeStatus, 2000);
