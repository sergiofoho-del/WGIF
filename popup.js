(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const ok = tab && /^https:\/\/([^/]+\.)?familio\.org\//.test(tab.url || '');
  const st = document.getElementById('st');
  st.textContent = ok ? 'Страница familio.org: ' + tab.url.split('?')[0] : 'Откройте на familio.org страницу персоны (после входа в аккаунт) и нажмите кнопку.';
  document.getElementById('go').addEventListener('click', () => {
    if (!ok) { st.textContent = 'Сначала откройте страницу персоны на familio.org (после входа).'; return; }
    chrome.runtime.sendMessage({ type: 'open-app', mode: 'person', tabId: tab.id }, () => window.close());
  });
})();
