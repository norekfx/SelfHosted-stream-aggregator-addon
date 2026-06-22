(() => {
  if (window.__scraperLiveWizardLoader) return;
  window.__scraperLiveWizardLoader = true;

  function load(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Nie udało się załadować ${src}`));
      document.head.appendChild(script);
    });
  }

  load('/scraper-live-runtime.js?v=20260622-live-runtime')
    .then(() => load('/scraper-live-ui.js?v=20260622-live-ui'))
    .catch((error) => {
      const section = document.querySelector('#scraping');
      if (section) section.innerHTML = `<article class="panel"><h2>Kreator scraperów</h2><p>${String(error.message || error)}</p></article>`;
    });
})();
