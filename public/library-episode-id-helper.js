(() => {
  function enhanceEpisodeIds() {
    const detail = document.querySelector('#libraryMediaDetails:not(.hidden)');
    if (!detail) return;

    const idBox = Array.from(detail.querySelectorAll('.library-detail-box')).find((box) =>
      box.querySelector('span')?.textContent?.trim() === 'Identyfikator'
    );
    const seriesId = idBox?.querySelector('strong')?.textContent?.trim();
    if (!seriesId || !/^tt\d+/i.test(seriesId)) return;

    detail.querySelectorAll('.library-episode-card strong').forEach((title) => {
      const parsed = parseEpisodeTitle(title.textContent?.trim() || '', seriesId);
      if (!parsed) return;
      if (title.dataset.episodeIdEnhanced !== 'true') {
        title.textContent = `${parsed.id} · S${String(parsed.season).padStart(2, '0')}E${String(parsed.episode).padStart(2, '0')} · ${parsed.name}`;
        title.dataset.episodeIdEnhanced = 'true';
      }
      title.closest('.library-episode-card')?.setAttribute('data-episode-id', parsed.id);
      checkDocchiFix(title.closest('.library-episode-card'), parsed.id);
    });
  }

  function parseEpisodeTitle(text, seriesId) {
    if (!text) return null;
    const already = text.match(/^(tt\d+:\d+:\d+)\s*[·-]\s*S(\d+)E(\d+)\s*[·-]\s*(.+)$/i);
    if (already) {
      return { id: already[1], season: Number(already[2]), episode: Number(already[3]), name: already[4] };
    }
    const match = text.match(/^S(\d+)E(\d+)\s*[·-]\s*(.+)$/i);
    if (!match) return null;
    const season = Number.parseInt(match[1] || '0', 10);
    const episode = Number.parseInt(match[2] || '0', 10);
    const name = match[3] || text;
    if (!season || !episode) return null;
    return { id: `${seriesId}:${season}:${episode}`, season, episode, name };
  }

  async function checkDocchiFix(card, episodeId) {
    if (!card || !episodeId || card.dataset.docchiChecked === 'true') return;
    card.dataset.docchiChecked = 'true';
    try {
      const response = await fetch(`/admin/docchi/episode/${encodeURIComponent(episodeId)}`);
      if (!response.ok) return;
      const data = await response.json();
      const fix = data.fix;
      if (!fix?.fixed || !fix.mappedId || fix.mappedId === episodeId) return;
      if (card.querySelector('[data-docchi-fix-badge]')) return;
      const badge = document.createElement('small');
      badge.dataset.docchiFixBadge = 'true';
      badge.style.display = 'inline-block';
      badge.style.marginTop = '0.35rem';
      badge.style.color = '#22c55e';
      badge.style.fontWeight = '700';
      badge.textContent = `Docchi naprawił indeks → ${fix.mappedId}`;
      card.querySelector('div')?.appendChild(badge);
    } catch {}
  }

  const observer = new MutationObserver(enhanceEpisodeIds);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', () => setTimeout(enhanceEpisodeIds, 0));
  setInterval(enhanceEpisodeIds, 1000);
})();
