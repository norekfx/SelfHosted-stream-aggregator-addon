(() => {
  const statusCache = new Map();

  function enhanceEpisodeIds() {
    const detail = document.querySelector('#libraryMediaDetails:not(.hidden)');
    if (!detail) return;

    installForceDocchiButton(detail);

    const idBox = Array.from(detail.querySelectorAll('.library-detail-box')).find((box) =>
      box.querySelector('span')?.textContent?.trim() === 'Identyfikator'
    );
    const seriesId = idBox?.querySelector('strong')?.textContent?.trim();
    if (!seriesId || !/^tt\d+/i.test(seriesId)) return;

    installDocchiRuntimeStatus(detail, seriesId);

    detail.querySelectorAll('.library-episode-card strong').forEach((title) => {
      const parsed = parseEpisodeTitle(title.textContent?.trim() || '', seriesId);
      if (!parsed) return;
      if (title.dataset.episodeIdEnhanced !== 'true') {
        title.textContent = `${parsed.id} · S${String(parsed.season).padStart(2, '0')}E${String(parsed.episode).padStart(2, '0')} · ${parsed.name}`;
        title.dataset.episodeIdEnhanced = 'true';
      }
      title.closest('.library-episode-card')?.setAttribute('data-episode-id', parsed.id);
    });
  }

  function installForceDocchiButton(detail) {
    if (detail.querySelector('[data-force-docchi]')) return;
    const closeButton = detail.querySelector('[data-close-library-detail]');
    if (!closeButton) return;
    const button = document.createElement('button');
    button.className = 'small-btn';
    button.type = 'button';
    button.dataset.forceDocchi = 'true';
    button.textContent = 'Wymuś Docchi';
    button.style.float = 'right';
    button.style.marginRight = '0.5rem';
    button.addEventListener('click', () => forceDocchiForVisibleEpisodes(button));
    closeButton.before(button);
  }

  function installDocchiRuntimeStatus(detail, seriesId) {
    const runtimeBox = Array.from(detail.querySelectorAll('.library-detail-box')).find((box) =>
      box.querySelector('span')?.textContent?.trim() === 'Runtime'
    );
    if (!runtimeBox || runtimeBox.dataset.docchiStatusFor === seriesId) return;
    runtimeBox.dataset.docchiStatusFor = seriesId;
    renderRuntimeStatus(runtimeBox, { loading: true });
    getDocchiSeriesStatus(seriesId)
      .then((status) => renderRuntimeStatus(runtimeBox, status))
      .catch(() => renderRuntimeStatus(runtimeBox, { fixed: false, error: true }));
  }

  async function getDocchiSeriesStatus(seriesId) {
    if (statusCache.has(seriesId)) return statusCache.get(seriesId);
    const response = await fetch(`/admin/docchi/series/${encodeURIComponent(seriesId)}/status`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const status = await response.json();
    statusCache.set(seriesId, status);
    return status;
  }

  function renderRuntimeStatus(runtimeBox, status) {
    runtimeBox.querySelector('[data-docchi-runtime-status]')?.remove();
    const badge = document.createElement('small');
    badge.dataset.docchiRuntimeStatus = 'true';
    badge.style.display = 'inline-block';
    badge.style.marginTop = '0.35rem';
    badge.style.marginLeft = '0.35rem';
    badge.style.fontWeight = '700';
    if (status.loading) {
      badge.style.opacity = '0.7';
      badge.textContent = 'Docchi: sprawdzam...';
    } else if (status.fixed) {
      badge.style.color = '#22c55e';
      const seasons = Array.isArray(status.mappedSeasons) && status.mappedSeasons.length ? ` · sezony ${status.mappedSeasons.join(', ')}` : '';
      badge.textContent = `Docchi fixed · ${status.mappedCount || 0} odc.${seasons}`;
    } else {
      badge.style.opacity = '0.65';
      badge.textContent = status.error ? 'Docchi: status niedostępny' : 'Docchi: brak indeksacji';
    }
    runtimeBox.appendChild(badge);
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

  async function forceDocchiForVisibleEpisodes(button) {
    const detail = document.querySelector('#libraryMediaDetails:not(.hidden)');
    if (!detail) return;
    enhanceEpisodeIds();
    const idBox = Array.from(detail.querySelectorAll('.library-detail-box')).find((box) => box.querySelector('span')?.textContent?.trim() === 'Identyfikator');
    const seriesId = idBox?.querySelector('strong')?.textContent?.trim();
    const cards = Array.from(detail.querySelectorAll('.library-episode-card[data-episode-id]'));
    const ids = cards.map((card) => card.getAttribute('data-episode-id')).filter(Boolean);
    if (!ids.length) { showToast('Brak odcinków do sprawdzenia przez Docchi.'); return; }
    const previous = button.textContent;
    button.disabled = true;
    let fixed = 0;
    try {
      for (let index = 0; index < ids.length; index += 1) {
        const id = ids[index];
        button.textContent = `Docchi ${index + 1}/${ids.length}`;
        const response = await fetch(`/admin/docchi/episode/${encodeURIComponent(id)}`);
        if (!response.ok) continue;
        const data = await response.json();
        const fix = data.fix;
        const card = cards.find((item) => item.getAttribute('data-episode-id') === id);
        if (fix?.fixed && fix.mappedId && fix.mappedId !== id) {
          fixed += 1;
          showDocchiBadge(card, fix);
        } else if (fix?.docchiId) {
          showDocchiIndexedBadge(card, fix);
        } else {
          markDocchiMiss(card, fix);
        }
      }
      if (seriesId) statusCache.delete(seriesId);
      if (seriesId) installDocchiRuntimeStatus(detail, seriesId);
      showToast(`Docchi sprawdził ${ids.length} odc., naprawiono: ${fixed}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Nie udało się wymusić Docchi.');
    } finally {
      button.disabled = false;
      button.textContent = previous;
    }
  }

  function showDocchiBadge(card, fix) {
    if (!card) return;
    card.querySelector('[data-docchi-miss-badge]')?.remove();
    const existing = card.querySelector('[data-docchi-fix-badge]');
    if (existing) { existing.textContent = `Docchi naprawił indeks → ${fix.mappedId}`; return; }
    const badge = document.createElement('small');
    badge.dataset.docchiFixBadge = 'true';
    badge.style.display = 'inline-block';
    badge.style.marginTop = '0.35rem';
    badge.style.color = '#22c55e';
    badge.style.fontWeight = '700';
    badge.textContent = `Docchi naprawił indeks → ${fix.mappedId}`;
    card.querySelector('div')?.appendChild(badge);
  }

  function showDocchiIndexedBadge(card, fix) {
    if (!card || card.querySelector('[data-docchi-fix-badge]')) return;
    card.querySelector('[data-docchi-miss-badge]')?.remove();
    const badge = document.createElement('small');
    badge.dataset.docchiFixBadge = 'true';
    badge.style.display = 'inline-block';
    badge.style.marginTop = '0.35rem';
    badge.style.color = '#22c55e';
    badge.style.fontWeight = '700';
    badge.textContent = `Docchi indexed → ${fix.docchiId}`;
    card.querySelector('div')?.appendChild(badge);
  }

  function markDocchiMiss(card, fix) {
    if (!card || card.querySelector('[data-docchi-fix-badge]') || card.querySelector('[data-docchi-miss-badge]')) return;
    const badge = document.createElement('small');
    badge.dataset.docchiMissBadge = 'true';
    badge.style.display = 'inline-block';
    badge.style.marginTop = '0.35rem';
    badge.style.opacity = '0.65';
    badge.textContent = fix?.triedIds?.length ? `Docchi: brak naprawy (${fix.triedIds.length} prób)` : 'Docchi: brak naprawy';
    card.querySelector('div')?.appendChild(badge);
  }

  function showToast(message) {
    const el = document.querySelector('#toast');
    if (!el) return alert(message);
    el.textContent = message;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3200);
  }

  const observer = new MutationObserver(enhanceEpisodeIds);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', () => setTimeout(enhanceEpisodeIds, 0));
  setInterval(enhanceEpisodeIds, 1000);
})();
