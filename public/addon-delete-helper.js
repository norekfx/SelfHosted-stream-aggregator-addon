(() => {
  const DELETE_BUTTON_SELECTOR = '[data-delete-addon]';

  function installDeleteButtons() {
    const rows = Array.from(document.querySelectorAll('#addonsList tbody tr'));
    for (const row of rows) {
      const actionCell = row.querySelector('td:last-child .action-row');
      if (!actionCell || actionCell.querySelector(DELETE_BUTTON_SELECTOR)) continue;

      const toggleButton = actionCell.querySelector('[data-toggle-addon]');
      if (!toggleButton || toggleButton.dataset.enabled !== 'true') continue;

      const addonId = toggleButton.dataset.toggleAddon;
      const name = row.querySelector('td:first-child strong')?.textContent?.trim() || 'addon';
      const button = document.createElement('button');
      button.className = 'small-btn disabled';
      button.type = 'button';
      button.textContent = 'Usuń';
      button.dataset.deleteAddon = addonId;
      button.dataset.addonName = name;
      actionCell.appendChild(button);
    }
  }

  async function deleteAddon(button) {
    const addonId = button.dataset.deleteAddon;
    const addonName = button.dataset.addonName || 'addon';
    if (!addonId) return;
    if (!confirm(`Usunąć wyłączony addon: ${addonName}?`)) return;

    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = 'Usuwam...';
    try {
      const response = await fetch(`/admin/addons/${encodeURIComponent(addonId)}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      document.querySelector('#toast').textContent = 'Addon usunięty.';
      document.querySelector('#toast').classList.remove('hidden');
      setTimeout(() => document.querySelector('#toast')?.classList.add('hidden'), 3200);
      document.querySelector('#refreshBtn')?.click();
    } catch (error) {
      button.disabled = false;
      button.textContent = oldText;
      alert(error instanceof Error ? error.message : 'Nie udało się usunąć addonu.');
    }
  }

  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.(DELETE_BUTTON_SELECTOR);
    if (button) deleteAddon(button);
  });

  installDeleteButtons();
  setInterval(installDeleteButtons, 1000);
})();
