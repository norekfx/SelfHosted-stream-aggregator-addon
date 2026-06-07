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
      if (title.dataset.episodeIdEnhanced === 'true') return;
      const text = title.textContent?.trim() || '';
      if (/^tt\d+/i.test(text)) {
        title.dataset.episodeIdEnhanced = 'true';
        return;
      }

      const match = text.match(/^S(\d+)E(\d+)\s*[·-]\s*(.+)$/i);
      if (!match) return;
      const season = Number.parseInt(match[1] || '0', 10);
      const episode = Number.parseInt(match[2] || '0', 10);
      const name = match[3] || text;
      if (!season || !episode) return;

      title.textContent = `${seriesId}:${season}:${episode} · S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')} · ${name}`;
      title.dataset.episodeIdEnhanced = 'true';
    });
  }

  const observer = new MutationObserver(enhanceEpisodeIds);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', () => setTimeout(enhanceEpisodeIds, 0));
  setInterval(enhanceEpisodeIds, 1000);
})();
