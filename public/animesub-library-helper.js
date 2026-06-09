(() => {
  function enhanceAnimeSubButtons() {
    const detail = document.querySelector('#libraryMediaDetails:not(.hidden)');
    if (!detail) return;
    installAnimeSubStyles();

    const idBox = Array.from(detail.querySelectorAll('.library-detail-box')).find((box) =>
      box.querySelector('span')?.textContent?.trim() === 'Identyfikator'
    );
    const mediaId = idBox?.querySelector('strong')?.textContent?.trim();
    if (!mediaId || !/^tt\d+/i.test(mediaId)) return;

    const episodeCards = Array.from(detail.querySelectorAll('.library-episode-card'));
    if (episodeCards.length) {
      installAnimeSubEpisodeButtons(detail, mediaId, episodeCards);
      return;
    }

    installAnimeSubMovieButton(detail, mediaId);
  }

  function installAnimeSubMovieButton(detail, mediaId) {
    if (detail.querySelector('[data-force-animesub-movie]')) return;
    const closeButton = detail.querySelector('[data-close-library-detail]');
    if (!closeButton) return;
    const button = document.createElement('button');
    button.className = 'small-btn';
    button.type = 'button';
    button.dataset.forceAnimesubMovie = 'true';
    button.textContent = 'Wymuś napisy';
    button.style.float = 'right';
    button.style.marginRight = '0.5rem';
    button.addEventListener('click', () => forceAnimeSub(button, 'movie', mediaId));
    closeButton.before(button);
  }

  function installAnimeSubEpisodeButtons(detail, seriesId, episodeCards) {
    for (const card of episodeCards) {
      const episodeId = getEpisodeId(card, seriesId);
      if (!episodeId || card.querySelector('[data-force-animesub-episode]')) continue;
      card.setAttribute('data-animesub-episode-id', episodeId);
      const button = document.createElement('button');
      button.className = 'small-btn animesub-episode-btn';
      button.type = 'button';
      button.dataset.forceAnimesubEpisode = episodeId;
      button.textContent = 'Wymuś napisy';
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        forceAnimeSub(button, 'series', episodeId, card);
      });
      const target = card.querySelector('div') ?? card;
      target.appendChild(button);
    }
  }

  function getEpisodeId(card, seriesId) {
    const existing = card.getAttribute('data-episode-id') || card.getAttribute('data-animesub-episode-id');
    if (existing && /^tt\d+:\d+:\d+$/i.test(existing)) return existing;
    const title = card.querySelector('strong')?.textContent?.trim() || '';
    const parsed = parseEpisodeTitle(title, seriesId);
    return parsed?.id;
  }

  function parseEpisodeTitle(text, seriesId) {
    if (!text) return null;
    const already = text.match(/^(tt\d+:\d+:\d+)\s*[·-]\s*S(\d+)E(\d+)\s*[·-]\s*(.+)$/i);
    if (already) return { id: already[1], season: Number(already[2]), episode: Number(already[3]), name: already[4] };
    const match = text.match(/^S(\d+)E(\d+)\s*[·-]\s*(.+)$/i);
    if (!match) return null;
    const season = Number.parseInt(match[1] || '0', 10);
    const episode = Number.parseInt(match[2] || '0', 10);
    if (!season || !episode) return null;
    return { id: `${seriesId}:${season}:${episode}`, season, episode, name: match[3] || text };
  }

  async function forceAnimeSub(button, type, id, card) {
    const previous = button.textContent;
    button.disabled = true;
    button.textContent = 'Pobieram napisy...';
    try {
      const response = await fetch(`/admin/animesub/${encodeURIComponent(type)}/${encodeURIComponent(id)}/fetch`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const cache = data.cache;
      const count = cache?.subtitles?.length ?? 0;
      showAnimeSubBadge(card, count);
      showAnimeSubPopup({ type, id, cache });
      showToast(`AnimeSub: pobrano napisów ${count}.`);
    } catch (error) {
      showAnimeSubBadge(card, 0, true);
      showToast(error instanceof Error ? error.message : 'Nie udało się pobrać napisów AnimeSub.');
    } finally {
      button.disabled = false;
      button.textContent = previous;
    }
  }

  function showAnimeSubBadge(card, count, error = false) {
    if (!card) return;
    card.querySelector('[data-animesub-badge]')?.remove();
    const badge = document.createElement('small');
    badge.dataset.animesubBadge = 'true';
    badge.style.display = 'inline-block';
    badge.style.marginLeft = '0.5rem';
    badge.style.marginTop = '0.35rem';
    badge.style.fontWeight = '700';
    badge.style.color = error ? '#f87171' : (count > 0 ? '#22c55e' : '#f59e0b');
    badge.textContent = error ? 'AnimeSub: błąd' : `AnimeSub: ${count} napisów`;
    (card.querySelector('div') ?? card).appendChild(badge);
  }

  function showAnimeSubPopup(report) {
    installAnimeSubStyles();
    document.querySelector('.animesub-backdrop')?.remove();
    const subtitles = report.cache?.subtitles ?? [];
    const addonResults = report.cache?.addonResults ?? [];
    const publicUrl = `/subtitles/${encodeURIComponent(report.type)}/${encodeURIComponent(report.id)}.json`;
    const backdrop = document.createElement('div');
    backdrop.className = 'animesub-backdrop';
    backdrop.innerHTML = `
      <div class="animesub-modal" role="dialog" aria-modal="true">
        <div class="animesub-head"><div><h2>Napisy AnimeSub</h2><p>${escapeHtml(report.type)}:${escapeHtml(report.id)}</p></div><button class="animesub-close" type="button" data-animesub-close>Zamknij</button></div>
        <div class="animesub-body">
          <div class="animesub-grid">
            <div class="animesub-stat"><span>Znalezione napisy</span><strong>${subtitles.length}</strong></div>
            <div class="animesub-stat"><span>Publiczny endpoint</span><strong>${escapeHtml(publicUrl)}</strong></div>
            <div class="animesub-stat"><span>Ostatnie pobranie</span><strong>${escapeHtml(formatDate(report.cache?.updatedAt))}</strong></div>
          </div>
          <h3>Napisy</h3>
          ${subtitles.length ? renderSubtitleTable(subtitles) : '<p>AnimeSub nie zwrócił napisów dla tego tytułu.</p>'}
          <h3>Log pobrania</h3>
          ${renderAddonResults(addonResults)}
        </div>
      </div>`;
    backdrop.querySelector('[data-animesub-close]')?.addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  }

  function renderSubtitleTable(subtitles) {
    return `<div class="animesub-table-wrap"><table class="animesub-table"><thead><tr><th>Język</th><th>Nazwa</th><th>Addon</th><th>URL</th></tr></thead><tbody>${subtitles.map((subtitle) => `<tr><td>${escapeHtml(subtitle.lang || '-')}</td><td>${escapeHtml(subtitle.name || subtitle.id || '-')}</td><td>${escapeHtml(subtitle.addonName || subtitle.addonId || '-')}</td><td>${subtitle.url ? `<a href="${escapeHtml(subtitle.url)}" target="_blank" rel="noreferrer">Otwórz</a>` : '-'}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderAddonResults(results) {
    if (!results.length) return '<p>Brak wyników addonów.</p>';
    return `<div class="animesub-table-wrap"><table class="animesub-table"><thead><tr><th>Addon</th><th>Status</th><th>Napisy</th><th>Czas</th><th>Błąd</th></tr></thead><tbody>${results.map((result) => `<tr><td>${escapeHtml(result.addonName || result.addonId || '-')}</td><td>${escapeHtml(result.status || '-')}</td><td>${escapeHtml(result.subtitleCount ?? 0)}</td><td>${escapeHtml(result.responseTimeMs ?? '-')} ms</td><td>${escapeHtml(result.error || '-')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function installAnimeSubStyles() {
    if (document.querySelector('#animeSubLibraryStyles')) return;
    const style = document.createElement('style');
    style.id = 'animeSubLibraryStyles';
    style.textContent = `
      .animesub-episode-btn{margin-top:.45rem;margin-right:.45rem}.animesub-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px}.animesub-modal{width:min(980px,96vw);max-height:90vh;overflow:hidden;border:1px solid rgba(255,255,255,.16);border-radius:18px;background:#0f172a;color:#e5e7eb;box-shadow:0 24px 80px rgba(0,0,0,.5);display:flex;flex-direction:column}.animesub-head{display:flex;justify-content:space-between;gap:16px;align-items:start;padding:18px 20px;border-bottom:1px solid rgba(255,255,255,.12)}.animesub-head h2{margin:0;font-size:20px}.animesub-head p{margin:.3rem 0 0;opacity:.78}.animesub-body{padding:16px 20px;overflow:auto}.animesub-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-bottom:16px}.animesub-stat{padding:11px 12px;border-radius:12px;background:rgba(255,255,255,.07);overflow-wrap:anywhere}.animesub-stat span{display:block;font-size:12px;opacity:.7;margin-bottom:4px}.animesub-table-wrap{overflow:auto;border:1px solid rgba(255,255,255,.10);border-radius:12px;margin-bottom:14px}.animesub-table{width:100%;border-collapse:collapse;font-size:12px}.animesub-table th,.animesub-table td{padding:8px 9px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left;vertical-align:top}.animesub-table th{position:sticky;top:0;background:#111827}.animesub-close{border:0;background:#334155;color:white;border-radius:10px;padding:8px 12px;cursor:pointer}
    `;
    document.head.appendChild(style);
  }

  function showToast(message) {
    const el = document.querySelector('#toast');
    if (!el) return alert(message);
    el.textContent = message;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3200);
  }

  function formatDate(value) { if (!value) return '-'; return new Date(value).toLocaleString(); }
  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }

  const observer = new MutationObserver(enhanceAnimeSubButtons);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', () => setTimeout(enhanceAnimeSubButtons, 0));
  setInterval(enhanceAnimeSubButtons, 1000);
})();
