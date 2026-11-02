(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const ok = tab && /^https:\/\/([^/]+\.)?familio\.org\//.test(tab.url || '');
  const st = document.getElementById('st');
  st.textContent = ok ? 'Страница familio.org: ' + tab.url : 'Откройте familio.org и войдите в аккаунт, затем запустите расширение.';
  document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    if (!ok && b.dataset.m !== '4') { st.textContent = 'Сначала откройте familio.org и пройдите авторизацию.'; return; }
    chrome.runtime.sendMessage({ type: 'open-app', mode: b.dataset.m, tabId: ok ? tab.id : '' }, () => window.close());
  }));
})();
