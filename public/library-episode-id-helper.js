(() => {
  const statusCache = new Map();

  function enhanceEpisodeIds() {
    const detail = document.querySelector('#libraryMediaDetails:not(.hidden)');
    if (!detail) return;

    installForceDocchiButton(detail);
    installDebugStyles();

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

  function installDebugStyles() {
    if (document.querySelector('#docchiDebugPopupStyles')) return;
    const style = document.createElement('style');
    style.id = 'docchiDebugPopupStyles';
    style.textContent = `
      .docchi-debug-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px}.docchi-debug-modal{width:min(1180px,96vw);max-height:92vh;overflow:hidden;border:1px solid rgba(255,255,255,.16);border-radius:18px;background:#0f172a;color:#e5e7eb;box-shadow:0 24px 80px rgba(0,0,0,.5);display:flex;flex-direction:column}.docchi-debug-head{display:flex;justify-content:space-between;gap:16px;align-items:start;padding:18px 20px;border-bottom:1px solid rgba(255,255,255,.12)}.docchi-debug-head h2{margin:0;font-size:20px}.docchi-debug-head p{margin:.3rem 0 0;opacity:.78}.docchi-debug-body{padding:16px 20px;overflow:auto}.docchi-debug-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-bottom:16px}.docchi-debug-stat{padding:11px 12px;border-radius:12px;background:rgba(255,255,255,.07)}.docchi-debug-stat span{display:block;font-size:12px;opacity:.7;margin-bottom:4px}.docchi-debug-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 14px}.docchi-debug-tabs button{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:inherit;border-radius:999px;padding:7px 12px;cursor:pointer}.docchi-debug-tabs button.active{background:#2563eb;border-color:#60a5fa}.docchi-debug-table-wrap{overflow:auto;border:1px solid rgba(255,255,255,.10);border-radius:12px;margin-bottom:14px}.docchi-debug-table{width:100%;border-collapse:collapse;font-size:12px}.docchi-debug-table th,.docchi-debug-table td{padding:8px 9px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left;vertical-align:top}.docchi-debug-table th{position:sticky;top:0;background:#111827}.docchi-debug-json{white-space:pre-wrap;max-height:360px;overflow:auto;background:#020617;border-radius:12px;padding:12px;border:1px solid rgba(255,255,255,.10);font-size:12px}.docchi-debug-close{border:0;background:#334155;color:white;border-radius:10px;padding:8px 12px;cursor:pointer}.docchi-debug-ok{color:#22c55e;font-weight:700}.docchi-debug-warn{color:#f59e0b;font-weight:700}.docchi-debug-bad{color:#f87171;font-weight:700}
    `;
    document.head.appendChild(style);
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
    const results = [];
    try {
      for (let index = 0; index < ids.length; index += 1) {
        const id = ids[index];
        button.textContent = `Docchi ${index + 1}/${ids.length}`;
        const response = await fetch(`/admin/docchi/episode/${encodeURIComponent(id)}`);
        if (!response.ok) { results.push({ id, error: `HTTP ${response.status}` }); continue; }
        const data = await response.json();
        const fix = data.fix;
        results.push({ id, fix });
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
      showDocchiDebugPopup({ seriesId, ids, fixed, results });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Nie udało się wymusić Docchi.');
      showDocchiDebugPopup({ seriesId, ids, fixed, results, error: error instanceof Error ? error.message : String(error) });
    } finally {
      button.disabled = false;
      button.textContent = previous;
    }
  }

  function showDocchiDebugPopup(report) {
    installDebugStyles();
    document.querySelector('.docchi-debug-backdrop')?.remove();
    const accepted = report.results.filter((item) => item.fix?.docchiId).length;
    const fixed = report.results.filter((item) => item.fix?.fixed && item.fix?.mappedId !== item.id).length;
    const rejected = report.results.filter((item) => !item.fix?.docchiId).length;
    const firstDebug = report.results.find((item) => item.fix?.debug)?.fix?.debug;
    const backdrop = document.createElement('div');
    backdrop.className = 'docchi-debug-backdrop';
    backdrop.innerHTML = `
      <div class="docchi-debug-modal" role="dialog" aria-modal="true">
        <div class="docchi-debug-head"><div><h2>Debug Docchi: ${escapeHtml(report.seriesId || 'serial')}</h2><p>Pełny raport z wymuszonego indeksowania: co wysłano do Docchi, co wróciło i jak wybrano mapping.</p></div><button class="docchi-debug-close" type="button" data-docchi-debug-close>Zamknij</button></div>
        <div class="docchi-debug-body">
          <div class="docchi-debug-grid">
            <div class="docchi-debug-stat"><span>Odcinki sprawdzone</span><strong>${report.results.length}/${report.ids.length}</strong></div>
            <div class="docchi-debug-stat"><span>Docchi indexed</span><strong class="docchi-debug-ok">${accepted}</strong></div>
            <div class="docchi-debug-stat"><span>Naprawione ID</span><strong class="docchi-debug-ok">${fixed}</strong></div>
            <div class="docchi-debug-stat"><span>Odrzucone</span><strong class="docchi-debug-warn">${rejected}</strong></div>
            <div class="docchi-debug-stat"><span>Search terms</span><strong>${escapeHtml((firstDebug?.searchTerms || []).join(', ') || 'brak')}</strong></div>
          </div>
          ${renderDebugTabs(report, firstDebug)}
        </div>
      </div>`;
    backdrop.querySelector('[data-docchi-debug-close]')?.addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
    installDebugTabs(backdrop);
  }

  function renderDebugTabs(report, debug) {
    return `
      <div class="docchi-debug-tabs"><button class="active" data-docchi-tab="summary">Wyniki</button><button data-docchi-tab="plans">Plany Docchi</button><button data-docchi-tab="candidates">Kandydaci</button><button data-docchi-tab="raw">Raw JSON</button></div>
      <section data-docchi-panel="summary">${renderSummaryTable(report.results)}</section>
      <section data-docchi-panel="plans" hidden>${renderPlans(debug)}</section>
      <section data-docchi-panel="candidates" hidden>${renderCandidates(report.results)}</section>
      <section data-docchi-panel="raw" hidden><pre class="docchi-debug-json">${escapeHtml(JSON.stringify(report, null, 2))}</pre></section>`;
  }

  function renderSummaryTable(results) {
    return `<div class="docchi-debug-table-wrap"><table class="docchi-debug-table"><thead><tr><th>ID wejściowe</th><th>Status</th><th>Mapping</th><th>Docchi ID</th><th>Metoda</th><th>Score</th></tr></thead><tbody>${results.map((item) => {
      const fix = item.fix || {};
      const status = item.error ? `<span class="docchi-debug-bad">${escapeHtml(item.error)}</span>` : fix.docchiId ? '<span class="docchi-debug-ok">indexed</span>' : '<span class="docchi-debug-warn">rejected</span>';
      return `<tr><td>${escapeHtml(item.id)}</td><td>${status}</td><td>${escapeHtml(fix.mappedId || '-')}</td><td>${escapeHtml(fix.docchiId || '-')}</td><td>${escapeHtml(fix.matchMethod || fix.debug?.decision || '-')}</td><td>${escapeHtml(fix.confidence ?? '-')}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function renderPlans(debug) {
    if (!debug?.plans?.length) return '<p>Brak danych planu Docchi.</p>';
    return debug.plans.map((plan) => `<h3>${escapeHtml(plan.addonName || plan.addonId)}</h3><p><strong>Anime:</strong> ${escapeHtml(plan.anime.map((item) => `${item.id} ${item.name || ''} (${item.episodeCount})`).join(' | '))}</p><p><strong>Sezony:</strong> ${escapeHtml(plan.seasons.map((s) => `S${s.season}: ${s.episodes} odc. ${s.firstDate || ''} - ${s.lastDate || ''}`).join(' | '))}</p><div class="docchi-debug-table-wrap"><table class="docchi-debug-table"><thead><tr><th>#</th><th>S/E</th><th>Docchi ID</th><th>Data</th><th>Tytuł</th><th>Anime</th></tr></thead><tbody>${plan.rows.map((row) => `<tr><td>${row.absoluteIndex}</td><td>S${row.season}E${row.episode}</td><td>${escapeHtml(row.docchiId)}</td><td>${escapeHtml(row.released || '-')}</td><td>${escapeHtml(row.title || '-')}</td><td>${escapeHtml(row.animeName || '-')}</td></tr>`).join('')}</tbody></table></div>`).join('');
  }

  function renderCandidates(results) {
    const rows = results.flatMap((item) => (item.fix?.debug?.plans || []).flatMap((plan) => (plan.candidates || []).map((candidate) => ({ input: item.id, ...candidate }))));
    if (!rows.length) return '<p>Brak kandydatów dopasowania.</p>';
    return `<div class="docchi-debug-table-wrap"><table class="docchi-debug-table"><thead><tr><th>Wejście</th><th>Docchi ID</th><th>S/E</th><th>Data</th><th>Tytuł</th><th>Score</th><th>Date</th><th>Title</th><th>Metoda</th><th>Rejected</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.input)}</td><td>${escapeHtml(row.docchiId)}</td><td>S${row.season}E${row.episode}</td><td>${escapeHtml(row.released || '-')}</td><td>${escapeHtml(row.title || '-')}</td><td>${row.score}</td><td>${row.dateScore}</td><td>${Number(row.titleScore || 0).toFixed(2)}</td><td>${escapeHtml(row.method)}</td><td>${escapeHtml(row.rejected || '')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function installDebugTabs(root) {
    root.querySelectorAll('[data-docchi-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        const tab = button.getAttribute('data-docchi-tab');
        root.querySelectorAll('[data-docchi-tab]').forEach((item) => item.classList.toggle('active', item === button));
        root.querySelectorAll('[data-docchi-panel]').forEach((panel) => { panel.hidden = panel.getAttribute('data-docchi-panel') !== tab; });
      });
    });
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
    badge.textContent = fix?.debug?.decision ? `Docchi: ${fix.debug.decision}` : (fix?.triedIds?.length ? `Docchi: brak naprawy (${fix.triedIds.length} prób)` : 'Docchi: brak naprawy');
    card.querySelector('div')?.appendChild(badge);
  }

  function showToast(message) {
    const el = document.querySelector('#toast');
    if (!el) return alert(message);
    el.textContent = message;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3200);
  }

  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }

  const observer = new MutationObserver(enhanceEpisodeIds);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', () => setTimeout(enhanceEpisodeIds, 0));
  setInterval(enhanceEpisodeIds, 1000);
})();
