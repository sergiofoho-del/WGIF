(() => {
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search); const mode = +q.get('mode') || 1;
  const NAMES = { 1: 'выбор аккаунта (раздел «Люди»)', 2: 'выбор персоны', 3: 'выбор Фамилии', 4: 'автосбор из файла ссылок' };
  $('modeName').textContent = '— ' + NAMES[mode];
  if (mode === 1 || mode === 4) document.querySelector('input[name=scope][value=all]').checked = true;
  if (mode === 4) { $('m4').hidden = false; $('urlRow').hidden = true; }
  $('profile').value = JSON.stringify(Extract.DEFAULT_PROFILE, null, 1);
  let dirHandle = null, gedText = '', gedName = '', paused = false, stopped = false, running = false, wake = null;
  const WGIF = 'WGIF · Welcome, Grafted Into the Fam!';
  const log = (s) => { const l = $('log'); l.textContent += s + '\n'; l.scrollTop = l.scrollHeight; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const today = () => new Date().toISOString().slice(0, 10);
  const profile = () => Object.assign({}, Extract.DEFAULT_PROFILE, JSON.parse($('profile').value || '{}'));

  chrome.storage.local.get('profile', (d) => { if (d.profile) $('profile').value = d.profile; });
  (async () => {   // подставить адрес вкладки familio.org и проверить вход
    const tabId = +q.get('src'); let url = '';
    if (tabId) { try { url = (await chrome.tabs.get(tabId)).url; } catch (e) {} }
    $('startUrl').value = url;
    try {
      const r = await fetch(url || 'https://familio.org/', { credentials: 'include' });
      const t = await r.text(); const ok = r.ok && !/type=["']password["']/i.test(t) || /выйти|logout/i.test(t);
      $('auth').textContent = ok ? '✔ Вход выполнен (страница доступна)' : '✖ Похоже, вы не вошли: войдите на familio.org и запустите заново';
    } catch (e) { $('auth').textContent = '✖ Нет доступа к familio.org: ' + e.message; }
  })();

  $('pickDir').onclick = async () => { try { dirHandle = await showDirectoryPicker({ mode: 'readwrite' }); $('dirName').textContent = dirHandle.name; } catch (e) {} };
  $('gedFile').onchange = async (e) => { const f = e.target.files[0]; if (f) { gedText = await f.text(); gedName = f.name; $('outGed').checked = true; } };
  $('pause').onclick = () => { paused = !paused; $('pause').textContent = paused ? 'Продолжить' : 'Пауза'; if (!paused && wake) wake(); log(paused ? '⏸ Пауза' : '▶ Продолжение'); };
  $('stop').onclick = () => { stopped = true; if (wake) wake(); };
  const checkpoint = async () => { while (paused && !stopped) await new Promise((r) => (wake = r)); };

  async function getDoc(url) {
    const r = await fetch(url, { credentials: 'include' }); if (!r.ok) throw new Error('HTTP ' + r.status);
    return new DOMParser().parseFromString(await r.text(), 'text/html');
  }
  async function writeFile(dir, name, data) {
    const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(data); await w.close();
  }
  // «Аккаунт персоны»: список «Люди, добавленные пользователем» разбит на страницы по 10 (…?tab=1&page-userPersons=N)
  async function collectAccount(url, prof) {
    const base = url.split('?')[0]; const out = new Map(); let n = 1; let empty = 0;
    while (n <= 5000 && !stopped) {
      await checkpoint(); const u = base + prof.accountListUrl + n; let doc;
      try { doc = await getDoc(u); } catch (e) { log('✖ ' + u + ' — ' + e.message); break; }
      const before = out.size; Extract.accountPersons(doc, u, prof).forEach((x) => { if (!out.has(x.id)) out.set(x.id, x.url); });
      log(`аккаунт, страница ${n}: всего ${out.size}`);
      if (out.size === before) { if (++empty >= 1) break; } n++; await sleep(+$('delay').value);
    }
    return [...out.values()];
  }
  async function collectList(url, prof) {   // ссылки на людей со страницы списка, с пагинацией
    const out = new Set(); let u = url, pages = 0;
    while (u && pages++ < 500 && !stopped) {
      await checkpoint(); let doc; try { doc = await getDoc(u); } catch (e) { log('✖ ' + u + ' — ' + e.message); break; }
      const before = out.size; Extract.personLinks(doc, u, prof).forEach((l) => out.add(l));
      log(`список ${u}: всего ${out.size}`);
      const n = doc.querySelector(prof.next); const nu = n ? Extract.abs(n.getAttribute('href'), u) : '';
      u = nu && nu !== u && out.size > before ? nu : ''; await sleep(+$('delay').value);
    }
    return [...out];
  }

  // Excel сохраняется во время сбора (каждые 10 персон) и в конце — результат не теряется при остановке или ошибке
  async function saveExcel(root, list, quiet) {
    if (!$('outXlsx').checked || !list.length) return false;
    const rows = [['ID', 'Фамилия', 'Девичья фамилия (у мужчин — до смены)', 'Имя', 'Отчество', 'Пол', 'Дата рождения', 'Год рождения', 'Место рождения', 'Дата смерти', 'Место смерти', 'Супруги (ID)', 'Дети (ID)', 'Родители (ID)', 'События', 'Родственники', 'Обсуждение', 'Файлы медиа', 'Ссылка']];
    list.forEach((p) => rows.push([p.id, p.surname, p.maiden || p.former || '', p.given, p.patronymic, p.sex, p.birthDate, p.birthYear ? +p.birthYear : '', p.birthPlace, p.deathDate, p.deathPlace, (p.spouses || []).join(', '), (p.children || []).join(', '), (p.parents || []).join(', '), $('sEvents').checked ? p.events : '', $('sRelatives').checked ? p.relativesText : '', $('sDiscussion').checked ? p.discussion : '', (p.mediaFiles || []).join(', '), p.url]));
    const fam = [['Персона (ID)', 'Персона', 'Статус', 'Родственник (ID)', 'Фамилия', 'Девичья/прежняя фамилия', 'Имя', 'Отчество', 'Дата рождения', 'Место рождения', 'Дата смерти', 'Место смерти', 'Место жительства', 'Ссылка места рождения', 'Ссылка места смерти']];
    list.forEach((p) => (p.family || []).forEach((f) => fam.push([p.id, `${p.surname} ${p.given} ${p.patronymic}`.trim(), f.status, f.id, f.surname, f.maiden, f.given, f.patronymic, f.birthDate, f.birthPlace, f.deathDate, f.deathPlace, f.residence, f.birthPlaceUrl, f.deathPlaceUrl])));
    await writeFile(root, 'Familio_люди.xlsx', Xlsx.build([{ name: 'Люди', rows }].concat(fam.length > 1 ? [{ name: 'Семья', rows: fam }] : [])));

    if (!quiet) log('Сохранён Familio_люди.xlsx');
    return true;
  }

  async function run() {
    running = true; stopped = false; paused = false;
    log('🌳 ' + WGIF + ' Начинаем собирать семью — режим: ' + NAMES[mode] + '.');
    ['start'].forEach((i) => ($(i).disabled = true)); $('pause').disabled = $('stop').disabled = false;
    const people = {}; let rootDir = null;
    try {
      const prof = profile(); chrome.storage.local.set({ profile: $('profile').value });
      if (!dirHandle) throw new Error('Выберите расположение рабочей папки');
      const root = await dirHandle.getDirectoryHandle(($('folderName').value || 'Welcome_Familio') + '_' + today(), { create: true });
      rootDir = root;
      const mediaDir = await root.getDirectoryHandle('media', { create: true });
      // 1. стартовые ссылки
      let seeds = []; const origin = $('startUrl').value ? new URL($('startUrl').value).origin : 'https://familio.org';
      if (mode === 2) seeds = [$('startUrl').value];
      else if (mode === 1 && /\/users\//.test($('startUrl').value)) seeds = await collectAccount($('startUrl').value, prof);
      else if (mode === 1 || mode === 3) seeds = await collectList($('startUrl').value, prof);
      else {
        const f = $('linksFile').files[0]; if (!f) throw new Error('Выберите файл ссылок .html');
        const d = new DOMParser().parseFromString(await f.text(), 'text/html');
        const accs = [...new Set([...d.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /familio\.org/.test(h)))];
        log('Аккаунтов в файле: ' + accs.length);
        for (const a of accs) {
          const paths = []; if ($('secPeople').checked) paths.push(prof.peoplePath); if ($('secSurnames').checked) paths.push(prof.surnamesPath); if ($('secCustom').value) paths.push($('secCustom').value);
          if (/\/users\//.test(a) && $('secPeople').checked) (await collectAccount(a, prof)).forEach((l) => seeds.push(l));
          for (const p of paths.filter((x) => !(/\/users\//.test(a) && x === prof.peoplePath))) { if (stopped) break; (await collectList(a.replace(/\/$/, '') + p, prof)).forEach((l) => seeds.push(l)); }
        }
      }
      // 2. обход карточек и связей
      const maxDepth = +$('depth').value || 0; const scope = document.querySelector('input[name=scope]:checked').value;
      const startDir = scope === 'anc' ? 'up' : scope === 'desc' ? 'down' : scope === 'all' ? 'all' : 'self';
      const opt = { maleOnly: document.querySelector('input[name=sex]:checked').value === 'm',
        sec: { father: $('sFather').checked, mother: $('sMother').checked, spouses: $('sSpouses').checked, children: $('sChildren').checked } };
      const queue = seeds.map((u) => [u, startDir, 0]); const seen = new Set(seeds); let skipped = 0;
      while (queue.length && !stopped) {
        await checkpoint(); if (stopped) break;
        const [u, dir, dp] = queue.shift(); let p;
        try { const main = await getDoc(u), ex = {};
          if ($('sSpouses').checked || $('sChildren').checked || $('sFather').checked || $('sMother').checked || $('sRelatives').checked) ex.rel = await getDoc(u.split('?')[0] + prof.tabs.relatives).catch(() => null);
          if ($('sEvents').checked) ex.ev = await getDoc(u.split('?')[0] + prof.tabs.events).catch(() => null);
          p = Extract.person(main, u, prof, ex); } catch (e) { log('✖ ' + u + ' — ' + e.message); continue; }
        if (!p.surname) log('⚠ нет имени на странице ' + u + ' — возможно, вход на familio.org не выполнен или вёрстка изменилась');
        if (p.hidden && $('skipHidden').checked) { skipped++; log('⛔ скрытая персона пропущена: ' + u); await sleep(+$('delay').value); continue; }
        people[p.id] = p; if (Object.keys(people).length % 10 === 0) await saveExcel(rootDir, Object.values(people), true).catch((e) => log('⚠ промежуточное сохранение: ' + e.message));
        $('count').textContent = `собрано: ${Object.keys(people).length}, в очереди: ${queue.length}, скрытых пропущено: ${skipped}`;
        log(`✔ ${p.surname} ${p.given} ${p.patronymic} ${p.birthYear} [${dir}]`);
        p.spouses = opt.sec.spouses ? p.spousesUrl.map(Extract.idOf) : []; p.children = opt.sec.children ? p.childrenUrl.map(Extract.idOf) : [];
        p.parents = [].concat(opt.sec.father ? p.fatherUrl : [], opt.sec.mother ? p.motherUrl : []).map(Extract.idOf);
        if (!p.parents.length && (opt.sec.father || opt.sec.mother)) p.parents = p.parentsUrl.map(Extract.idOf);
        if (!maxDepth || dp < maxDepth) Extract.expand(p, dir, opt).forEach(([l, d]) => { if (!seen.has(l)) { seen.add(l); queue.push([l, d, dp + 1]); } });
        if ($('saveMedia').checked) for (let i = 0; i < p.media.length && !stopped; i++) {
          try { const r = await fetch(p.media[i], { credentials: 'include' }); if (!r.ok) continue; const ext = (p.media[i].split('?')[0].match(/\.\w{2,4}$/) || ['.jpg'])[0];
            const name = `${p.id}_${p.surname}_${i + 1}${ext}`.replace(/[\\/:*?"<>|]/g, '_'); await writeFile(mediaDir, name, await r.blob()); (p.mediaFiles = p.mediaFiles || []).push(name); } catch (e) {}
        }
        await sleep(+$('delay').value);
      }
      // children/parents взаимно: родитель→дети достаточно для GEDCOM
      Object.values(people).forEach((p) => (p.parents || []).forEach((pid) => { const par = people[pid]; if (par && !(par.children || []).includes(p.id)) (par.children = par.children || []).push(p.id); }));
      const list = Object.values(people); log(`Сбор ${stopped ? 'остановлен' : 'завершён'}: привито к древу ${list.length} чел.`);
      // 3. сохранение
      if (await saveExcel(root, list)) { /* сохранено */ } else if (!list.length) log('⚠ Не собрано ни одной персоны — файл Excel не создан. Проверьте вход на familio.org, ссылку начала сбора и «Настройки сайта».');
      if ($('outGed').checked && list.length) {
        const act = document.querySelector('input[name=act]:checked').value;
        if (act !== 'new' && !gedText) throw new Error('Укажите файл GEDCOM');
        if (gedText) await writeFile(root, 'ОРИГИНАЛ_' + gedName, gedText);
        const res = await Gedcom.merge(act === 'new' ? '' : gedText, list, { mode: act, confirm: askConfirm });
        const out = act === 'new' ? 'Familio_новый.ged' : gedName.replace(/\.ged$/i, '') + '_обновлён.ged';
        await writeFile(root, out, res.text); log(`Сохранён ${out}: ${JSON.stringify(res.stats)}`);
      }
      log('🌳 Готово. Папка: ' + root.name + '\n   ' + (stopped ? 'Сбор остановлен — продолжить можно в любой момент: ни одна ветвь не потеряна.' : 'Ни одна ветвь не потеряна навсегда: связаны кровью, объединены историей, привиты обратно домой.'));
    } catch (e) { log('✖ ' + e.message); if (rootDir && Object.keys(people).length) { try { await saveExcel(rootDir, Object.values(people)); log('Собранное до ошибки сохранено в Excel.'); } catch (e2) { log('✖ Excel: ' + e2.message); } } }
    running = false; $('start').disabled = false; $('pause').disabled = $('stop').disabled = true;
  }
  function askConfirm(info) {
    return new Promise((res) => {
      $('confirmText').textContent = `${info.person.surname} ${info.person.given} (${info.xref})\n` + info.diff.map((d) => `${d.tag}: «${d.old}» → «${d.neu}»`).join('\n');
      $('confirmBox').hidden = false;
      $('confirmBox').querySelectorAll('button').forEach((b) => (b.onclick = () => { $('confirmBox').hidden = true; res(b.dataset.a); }));
    });
  }
  $('start').onclick = run;
})();
