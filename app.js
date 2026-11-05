(() => {
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search); const srcTab = +q.get('src') || 0;
  let sectors = {}, dirHandle = null, paused = false, stopped = false, wake = null;
  const log = (s) => { const l = $('log'); l.textContent += s + '\n'; l.scrollTop = l.scrollHeight; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const today = () => new Date().toISOString().slice(0, 10);
  const prof = Extract.DEFAULT_PROFILE;

  // ---- сектора ----
  const store = () => chrome.storage.local.set({ wgifSectors: sectors });
  function drawSectors() {
    $('sectors').innerHTML = '';
    Sectors.ROLES.forEach((r) => {
      const s = sectors[r.id]; const tr = document.createElement('tr');
      const st = !s ? '<span class="bad">✖ не указан</span>' : `<span class="${s.verified ? 'ok' : 'warn'}">${s.verified ? '✔' : '⚠'} ${s.verified ? 'указан' : 'указан, но не подтверждён в исходной странице'}</span><br>«${(s.text || '').slice(0, 70).replace(/</g, '&lt;')}»${r.tab ? ' · вкладка ' + s.tab : ''}`;
      tr.innerHTML = `<td><b>${r.title}</b><br><small>${r.hint}</small></td><td class="st">${st}</td><td><button data-r="${r.id}">Указать</button></td>`;
      $('sectors').append(tr);
    });
    $('sectors').querySelectorAll('button').forEach((b) => (b.onclick = () => pick(b.dataset.r)));
  }
  async function pick(role) {
    if (!srcTab) { log('✖ Не найдена вкладка familio.org — откройте окно расширения из значка на странице персоны.'); return; }
    const r = Sectors.ROLES.find((x) => x.id === role);
    try { await chrome.tabs.update(srcTab, { active: true }); await chrome.scripting.executeScript({ target: { tabId: srcTab }, func: Sectors.pickerInPage, args: [role, r.title] }); }
    catch (e) { log('✖ Не удалось запустить выбор на вкладке: ' + e.message); }
  }
  chrome.runtime.onMessage.addListener(async (msg) => {
    if (!msg || msg.type !== 'wgif-picked' || !msg.spec) return;
    const s = msg.spec; try { const t = await chrome.tabs.getCurrent(); if (t) await chrome.tabs.update(t.id, { active: true }); } catch (e) {}
    if (s.cancelled) { log('Указание сектора отменено.'); return; }
    sectors[s.role] = s; store(); drawSectors();
    log(`Сектор «${Sectors.ROLES.find((x) => x.id === s.role).title}» ${s.verified ? 'указан и подтверждён.' : '⚠ указан, но не найден в исходной странице: попробуйте указать другой сектор (чуть крупнее или мельче).'}`);
  });
  chrome.storage.local.get('wgifSectors', (d) => { sectors = d.wgifSectors || {}; drawSectors(); });
  $('reset').onclick = () => { sectors = {}; store(); drawSectors(); $('prev').hidden = true; };

  // ---- загрузка страниц ----
  async function getDoc(u) { const r = await fetch(u, { credentials: 'include' }); if (!r.ok) throw new Error('HTTP ' + r.status); return new DOMParser().parseFromString(await r.text(), 'text/html'); }
  const tabsNeeded = () => [...new Set(Sectors.ROLES.map((r) => (sectors[r.id] && sectors[r.id].tab) || '0'))];
  async function loadPerson(url) {
    const base = url.split('?')[0]; const docs = {};
    for (const t of tabsNeeded()) docs[t] = await getDoc(base + '?tab=' + t);
    if (!docs['0']) docs['0'] = await getDoc(base);
    return Sectors.extractPerson(docs, base, sectors, prof);
  }
  const missing = () => Sectors.ROLES.filter((r) => !sectors[r.id]).map((r) => r.title);

  (async () => {   // вход + адрес вкладки
    let url = ''; if (srcTab) { try { url = (await chrome.tabs.get(srcTab)).url; } catch (e) {} } $('startUrl').value = url;
    try { const r = await fetch(url || 'https://familio.org/', { credentials: 'include' }); const t = await r.text();
      $('auth').innerHTML = r.ok && /выйти|logout|my-persons/i.test(t) ? '<span class="ok">✔ Вход выполнен</span>' : '<span class="bad">✖ Похоже, вход не выполнен: войдите на familio.org и откройте расширение заново</span>'; }
    catch (e) { $('auth').innerHTML = '<span class="bad">✖ Нет доступа к familio.org: ' + e.message + '</span>'; }
  })();

  $('check').onclick = async () => {
    $('prev').hidden = false; $('prev').textContent = 'Проверяю…';
    try {
      const m = missing(); let url = $('startUrl').value; if (srcTab) { try { url = (await chrome.tabs.get(srcTab)).url; } catch (e) {} }
      if (!/\/persons\//.test(url)) throw new Error('Откройте на сайте страницу персоны (/persons/…)');
      const p = await loadPerson(url);
      $('prev').textContent = (m.length ? '⚠ Не указаны сектора: ' + m.join('; ') + '\n\n' : '') +
        `Имя: ${p.surname}${p.maiden ? ' (' + p.maiden + ')' : ''}${p.former ? ' (до смены: ' + p.former + ')' : ''} ${p.given} ${p.patronymic}\nПол: ${p.sex || '?'}  Родился: ${p.birthDate || '—'}  Умер: ${p.deathDate || '—'}  Фото: ${p.photo ? 'есть' : 'нет'}  Скрытая: ${p.hidden ? 'да' : 'нет'}\n` +
        `\nРодственников: ${p.family.length}\n` + p.family.map((f) => `  ${f.status || '?'} [${f.rel}] — ${f.text} · ${f.birthDate || ''} ${f.birthPlace || ''}`).join('\n') +
        `\n\nСобытий: ${p.events.length}\n` + p.events.map((e) => '  ' + e).join('\n') + (p.warn.length ? '\n\n⚠ ' + p.warn.join('\n⚠ ') : '');
    } catch (e) { $('prev').textContent = '✖ ' + e.message; }
  };

  // ---- сбор ----
  $('pickDir').onclick = async () => { try { dirHandle = await showDirectoryPicker({ mode: 'readwrite' }); $('dirName').textContent = dirHandle.name; } catch (e) {} };
  $('pause').onclick = () => { paused = !paused; $('pause').textContent = paused ? 'Продолжить' : 'Пауза'; if (!paused && wake) wake(); log(paused ? '⏸ Пауза' : '▶ Продолжение'); };
  $('stop').onclick = () => { stopped = true; if (wake) wake(); };
  const checkpoint = async () => { while (paused && !stopped) await new Promise((r) => (wake = r)); };
  async function writeFile(dir, name, data) { const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(data); await w.close(); }
  async function save(root, results, quiet) {
    if (!results.length) return false; const res = Family.build(results);
    await writeFile(root, 'WGIF_семьи.xlsx', Xlsx.build(Family.sheets(res)));
    if ($('outGed').checked) { const g = await Gedcom.merge('', res.people, { mode: 'new' }); await writeFile(root, 'WGIF_древо.ged', g.text); }
    if (!quiet) log(`Сохранено: WGIF_семьи.xlsx${$('outGed').checked ? ', WGIF_древо.ged' : ''} (людей ${res.people.length}, карточек ${res.cards.length})`);
    return true;
  }
  async function run() {
    const m = missing(); if (m.length) { log('✖ Сначала укажите все сектора. Не указаны:\n  • ' + m.join('\n  • ')); return; }
    if (!dirHandle) { log('✖ Выберите расположение рабочей папки.'); return; }
    const start = $('startUrl').value; if (!/\/persons\//.test(start)) { log('✖ Укажите ссылку на страницу персоны (/persons/…).'); return; }
    stopped = false; paused = false; $('start').disabled = true; $('pause').disabled = $('stop').disabled = false;
    log('🌳 WGIF · Welcome, Grafted Into the Fam! Начинаем: страница персоны.');
    const results = []; let root = null;
    try {
      root = await dirHandle.getDirectoryHandle(($('folderName').value || 'WGIF') + '_' + today(), { create: true });
      const maxDepth = $('follow').checked ? Math.max(1, +$('depth').value || 1) : 0; const queue = [[start.split('?')[0], 0]]; const seen = new Set([Extract.idOf(start)]);
      while (queue.length && !stopped) {
        await checkpoint(); if (stopped) break; const [u, dp] = queue.shift(); let p;
        try { p = await loadPerson(u); } catch (e) { log('✖ ' + u + ' — ' + e.message); continue; }
        if (p.warn.length) log('⚠ ' + (p.surname || u) + ': ' + p.warn.join('; '));
        if (p.hidden) { log('⛔ скрытая персона пропущена: ' + u); await sleep(+$('delay').value); continue; }
        results.push(p); $('count').textContent = `собрано: ${results.length}, в очереди: ${queue.length}`;
        log(`✔ ${p.surname} ${p.given} ${p.patronymic} — родственников: ${p.family.length}, событий: ${p.events.length}`);
        if (maxDepth && dp < maxDepth) p.family.forEach((f) => { if (!seen.has(f.id)) { seen.add(f.id); queue.push([f.url.split('?')[0], dp + 1]); } });
        if (results.length % 10 === 0) await save(root, results, true).catch((e) => log('⚠ промежуточное сохранение: ' + e.message));
        await sleep(+$('delay').value);
      }
      if (!(await save(root, results))) log('⚠ Не собрано ни одной персоны — файл не создан. Проверьте сектора кнопкой «Проверить разбор».');
      log(stopped ? '🌳 Сбор остановлен. Данные сохранены.' : '🌳 Готово. Папка: ' + root.name + '\n   Ни одна ветвь не потеряна навсегда: связаны кровью, объединены историей, привиты обратно домой.');
    } catch (e) { log('✖ ' + e.message); if (root && results.length) { try { await save(root, results); log('Собранное до ошибки сохранено.'); } catch (e2) { log('✖ ' + e2.message); } } }
    $('start').disabled = false; $('pause').disabled = $('stop').disabled = true; $('pause').textContent = 'Пауза';
  }
  $('start').onclick = run;
})();
