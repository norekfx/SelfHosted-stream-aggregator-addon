(() => {
  function installDocchiDebugExportButtons() {
    const modal = document.querySelector('.docchi-debug-modal');
    const head = modal?.querySelector('.docchi-debug-head');
    const close = modal?.querySelector('[data-docchi-debug-close]');
    if (!modal || !head || !close || head.querySelector('[data-docchi-copy-json]')) return;

    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.gap = '8px';
    wrap.style.alignItems = 'center';

    const copy = document.createElement('button');
    copy.className = 'docchi-debug-close';
    copy.type = 'button';
    copy.dataset.docchiCopyJson = 'true';
    copy.textContent = 'Kopiuj JSON';
    copy.addEventListener('click', async () => {
      const json = getRawJson(modal);
      if (!json) return showToast('Brak raw JSON w popupie.');
      try {
        await navigator.clipboard.writeText(json);
        showToast('Raw JSON skopiowany do schowka.');
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = json;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
        showToast('Raw JSON skopiowany do schowka.');
      }
    });

    const save = document.createElement('button');
    save.className = 'docchi-debug-close';
    save.type = 'button';
    save.dataset.docchiSaveJson = 'true';
    save.textContent = 'Pobierz JSON';
    save.addEventListener('click', () => {
      const json = getRawJson(modal);
      if (!json) return showToast('Brak raw JSON w popupie.');
      const seriesId = modal.querySelector('h2')?.textContent?.match(/tt\d+/i)?.[0] || 'docchi';
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${seriesId}-docchi-debug.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });

    wrap.append(copy, save, close);
    head.appendChild(wrap);
  }

  function getRawJson(modal) {
    return modal.querySelector('.docchi-debug-json')?.textContent || '';
  }

  function showToast(message) {
    const el = document.querySelector('#toast');
    if (!el) return alert(message);
    el.textContent = message;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3200);
  }

  const observer = new MutationObserver(installDocchiDebugExportButtons);
  observer.observe(document.body, { childList: true, subtree: true });
  setInterval(installDocchiDebugExportButtons, 1000);
})();
