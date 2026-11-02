// Открывает рабочую страницу расширения с выбранным режимом (1–4) и запоминает вкладку familio.org.
chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (msg && msg.type === 'open-app') {
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html') + '?mode=' + msg.mode + '&src=' + (msg.tabId || '') });
    send({ ok: true });
  }
});
