(() => {
  const MARKER = 'data-library-reorder-installed';
  let busy = false;

  async function installReorderControls() {
    const list = document.querySelector('#librariesList');
    const rows = Array.from(list?.querySelectorAll('tbody tr') || []);
    if (!list || !rows.length) return;
    const libraries = await getLibraries().catch(() => []);
    if (!libraries.length) return;
    const byId = new Map(libraries.map((library, index) => [library.id, { ...library, index }]));
    rows.forEach((row, index) => {
      const actionRow = row.querySelector('td:last-child .action-row');
      const id = actionRow?.querySelector('[data-test-library]')?.dataset.testLibrary;
      if (!actionRow || !id || actionRow.hasAttribute(MARKER)) return;
      actionRow.setAttribute(MARKER, 'true');
      const group = document.createElement('span');
      group.className = 'inline-actions';
      group.style.gap = '4px';
      group.style.marginRight = '4px';
      group.innerHTML = `<button class="small-btn" type="button" data-move-library="up" title="Przesuń bibliotekę wyżej">↑</button><button class="small-btn" type="button" data-move-library="down" title="Przesuń bibliotekę niżej">↓</button>`;
      const up = group.querySelector('[data-move-library="up"]');
      const down = group.querySelector('[data-move-library="down"]');
      if (up) up.disabled = index === 0;
      if (down) down.disabled = index === rows.length - 1;
      up?.addEventListener('click', () => moveLibrary(id, -1, byId));
      down?.addEventListener('click', () => moveLibrary(id, 1, byId));
      actionRow.prepend(group);
      const firstCell = row.querySelector('td:first-child');
      const library = byId.get(id);
      if (firstCell && library && !firstCell.querySelector('[data-sort-order-label]')) {
        const label = document.createElement('small');
        label.dataset.sortOrderLabel = 'true';
        label.textContent = `Kolejność: ${Number(library.sortOrder ?? index)}`;
        firstCell.appendChild(document.createElement('br'));
        firstCell.appendChild(label);
      }
    });
  }

  async function moveLibrary(id, direction, byId) {
    if (busy) return;
    const libraries = Array.from(byId.values()).sort(compareLibraries);
    const index = libraries.findIndex((library) => library.id === id);
    const other = libraries[index + direction];
    const current = libraries[index];
    if (!current || !other) return;
    busy = true;
    try {
      const currentOrder = normalizedOrder(current, index);
      const otherOrder = normalizedOrder(other, index + direction);
      await Promise.all([
        apiRequest(`/admin/libraries/${encodeURIComponent(current.id)}`, { method: 'PATCH', body: { sortOrder: otherOrder } }),
        apiRequest(`/admin/libraries/${encodeURIComponent(other.id)}`, { method: 'PATCH', body: { sortOrder: currentOrder } })
      ]);
      showToast('Zmieniono kolejność bibliotek.');
      document.querySelector('#reloadLibrariesBtn')?.click();
      setTimeout(() => document.querySelector('#reloadLibraryPreviewBtn')?.click(), 600);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Nie udało się zmienić kolejności bibliotek.');
    } finally {
      busy = false;
    }
  }

  function compareLibraries(a, b) {
    const orderDiff = Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0);
    if (orderDiff) return orderDiff;
    return String(a.name || '').localeCompare(String(b.name || ''));
  }

  function normalizedOrder(library, fallback) {
    const value = Number(library.sortOrder);
    return Number.isFinite(value) ? value : fallback;
  }

  async function getLibraries() {
    const data = await apiRequest('/admin/libraries');
    return (data.libraries || []).slice().sort(compareLibraries);
  }

  async function apiRequest(path, options = {}) {
    const response = await fetch(path, { method: options.method || 'GET', headers: options.body ? { 'content-type': 'application/json' } : undefined, body: options.body ? JSON.stringify(options.body) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  function showToast(message) {
    const el = document.querySelector('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3200);
  }

  setInterval(installReorderControls, 1500);
  document.addEventListener('click', () => setTimeout(installReorderControls, 100));
  installReorderControls();
})();
