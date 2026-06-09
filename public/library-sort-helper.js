(() => {
  const SELECT_ID = 'librarySortBySelect';
  const CUSTOM_ID = 'librarySortByCustom';
  const HINT_ID = 'librarySortByHint';
  const CUSTOM_VALUE = '__custom__';
  const DEFAULT_SORT = 'popularity.desc';
  const SORT_OPTIONS = [
    ['popularity.desc', 'Popularność ↓', 'Najpopularniejsze tytuły najpierw. Domyślne ustawienie TMDB.'],
    ['popularity.asc', 'Popularność ↑', 'Najmniej popularne tytuły najpierw. Raczej diagnostyczne.'],
    ['vote_average.desc', 'Ocena ↓', 'Najwyżej oceniane najpierw. Warto ustawić też minimalną liczbę głosów.'],
    ['vote_average.asc', 'Ocena ↑', 'Najniżej oceniane najpierw. Głównie do testów.'],
    ['vote_count.desc', 'Liczba głosów ↓', 'Tytuły z największą liczbą ocen najpierw.'],
    ['vote_count.asc', 'Liczba głosów ↑', 'Tytuły z najmniejszą liczbą ocen najpierw.'],
    ['primary_release_date.desc', 'Filmy: data premiery ↓', 'Najnowsze filmy najpierw. Najlepsze dla typu Filmy.'],
    ['primary_release_date.asc', 'Filmy: data premiery ↑', 'Najstarsze filmy najpierw. Najlepsze dla typu Filmy.'],
    ['title.asc', 'Filmy: tytuł A → Z', 'Sortowanie filmów alfabetycznie po tytule.'],
    ['title.desc', 'Filmy: tytuł Z → A', 'Sortowanie filmów odwrotnie alfabetycznie po tytule.'],
    ['revenue.desc', 'Filmy: przychód ↓', 'Filmy o najwyższym przychodzie najpierw.'],
    ['revenue.asc', 'Filmy: przychód ↑', 'Filmy o najniższym przychodzie najpierw.'],
    ['first_air_date.desc', 'Seriale: data emisji ↓', 'Najnowsze seriale najpierw. Najlepsze dla typu Seriale.'],
    ['first_air_date.asc', 'Seriale: data emisji ↑', 'Najstarsze seriale najpierw. Najlepsze dla typu Seriale.'],
    ['name.asc', 'Seriale: nazwa A → Z', 'Sortowanie seriali alfabetycznie po nazwie.'],
    ['name.desc', 'Seriale: nazwa Z → A', 'Sortowanie seriali odwrotnie alfabetycznie po nazwie.']
  ];

  function installSortSelector() {
    const input = document.querySelector('#librarySortBy');
    if (!input || document.querySelector(`#${SELECT_ID}`)) return;
    const label = input.closest('label');
    if (!label) return;
    const current = input.value?.trim() || DEFAULT_SORT;
    input.type = 'hidden';
    input.value = current;
    const select = document.createElement('select');
    select.id = SELECT_ID;
    select.innerHTML = `${SORT_OPTIONS.map(([value, labelText, description]) => `<option value="${escapeAttr(value)}" title="${escapeAttr(description)}">${escapeHtml(labelText)} — ${escapeHtml(value)}</option>`).join('')}<option value="${CUSTOM_VALUE}">Własne...</option>`;
    const custom = document.createElement('input');
    custom.id = CUSTOM_ID;
    custom.placeholder = 'np. popularity.desc albo primary_release_date.desc';
    custom.style.display = 'none';
    const hint = document.createElement('small');
    hint.id = HINT_ID;
    hint.className = 'hint';
    label.innerHTML = 'Sortowanie';
    label.appendChild(select);
    label.appendChild(custom);
    label.appendChild(input);
    label.appendChild(hint);
    setSelectorFromValue(current, select, custom, input);
    select.addEventListener('change', () => syncSortValue(select, custom, input));
    custom.addEventListener('input', () => syncSortValue(select, custom, input));
    document.querySelector('#libraryType')?.addEventListener('change', () => updateHint(select));
    updateHint(select);
  }

  function setSelectorFromValue(value, select, custom, input) {
    const known = SORT_OPTIONS.some(([option]) => option === value);
    if (known) select.value = value;
    else { select.value = CUSTOM_VALUE; custom.value = value; custom.style.display = ''; }
    input.value = value || DEFAULT_SORT;
    syncSortValue(select, custom, input);
  }

  function syncSortValue(select, custom, input) {
    const isCustom = select.value === CUSTOM_VALUE;
    custom.style.display = isCustom ? '' : 'none';
    input.value = isCustom ? (custom.value.trim() || DEFAULT_SORT) : select.value;
    updateHint(select);
  }

  function updateHint(select) {
    const hint = document.querySelector(`#${HINT_ID}`);
    if (!hint) return;
    if (select.value === CUSTOM_VALUE) {
      hint.textContent = 'Własne sortowanie zostanie przekazane bezpośrednio do TMDB jako sort_by. Używaj wartości zgodnych z discover TMDB.';
      return;
    }
    const option = SORT_OPTIONS.find(([value]) => value === select.value);
    const type = document.querySelector('#libraryType')?.value || 'movie';
    const typeNote = /primary_release_date|title|revenue/.test(select.value) && type === 'series' ? ' Uwaga: to sortowanie jest filmowe.' : /first_air_date|name/.test(select.value) && type === 'movie' ? ' Uwaga: to sortowanie jest serialowe.' : '';
    hint.textContent = option ? `${option[2]}${typeNote}` : '';
  }

  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
  function escapeAttr(value) { return escapeHtml(value).replace(/`/g, '&#96;'); }

  setInterval(installSortSelector, 1500);
  document.addEventListener('click', () => setTimeout(installSortSelector, 50));
  installSortSelector();
})();
