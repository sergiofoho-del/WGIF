(() => {
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search); const mode = +q.get('mode') || 1;
  const NAMES = { 1: 'выбор аккаунта (раздел «Люди»)', 2: 'выбор персоны', 3: 'выбор Фамилии', 4: 'автосбор из файла ссылок' };
  $('modeName').textContent = '— ' + NAMES[mode];
  if (mode === 4) { $('m4').hidden = false; $('urlRow').hidden = true; }
  $('profile').value = JSON.stringify(Extract.DEFAULT_PROFILE, null, 1);
  let dirHandle = null, gedText = '', gedName = '', paused = false, stopped = false, running = false, wake = null;
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

  async function run() {
    running = true; stopped = false; paused = false;
    ['start'].forEach((i) => ($(i).disabled = true)); $('pause').disabled = $('stop').disabled = false;
    try {
      const prof = profile(); chrome.storage.local.set({ profile: $('profile').value });
      if (!dirHandle) throw new Error('Выберите расположение рабочей папки');
      const root = await dirHandle.getDirectoryHandle(($('folderName').value || 'Welcome_Familio') + '_' + today(), { create: true });
      const mediaDir = await root.getDirectoryHandle('media', { create: true });
      // 1. стартовые ссылки
      let seeds = []; const origin = $('startUrl').value ? new URL($('startUrl').value).origin : 'https://familio.org';
      if (mode === 2) seeds = [$('startUrl').value];
      else if (mode === 1 || mode === 3) seeds = await collectList($('startUrl').value, prof);
      else {
        const f = $('linksFile').files[0]; if (!f) throw new Error('Выберите файл ссылок .html');
        const d = new DOMParser().parseFromString(await f.text(), 'text/html');
        const accs = [...new Set([...d.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /familio\.org/.test(h)))];
        log('Аккаунтов в файле: ' + accs.length);
        for (const a of accs) {
          const paths = []; if ($('secPeople').checked) paths.push(prof.peoplePath); if ($('secSurnames').checked) paths.push(prof.surnamesPath); if ($('secCustom').value) paths.push($('secCustom').value);
          for (const p of paths) { if (stopped) break; (await collectList(a.replace(/\/$/, '') + p, prof)).forEach((l) => seeds.push(l)); }
        }
      }
      // 2. обход карточек и связей
      const maxDepth = +$('depth').value || 0; const people = {}; const queue = seeds.map((u) => [u, 0]); const seen = new Set(seeds);
      while (queue.length && !stopped) {
        await checkpoint(); if (stopped) break;
        const [u, dp] = queue.shift(); let p;
        try { p = Extract.person(await getDoc(u), u, prof); } catch (e) { log('✖ ' + u + ' — ' + e.message); continue; }
        people[p.id] = p; $('count').textContent = `собрано: ${Object.keys(people).length}, в очереди: ${queue.length}`;
        log(`✔ ${p.surname} ${p.given} ${p.patronymic} ${p.birthYear}`);
        const rel = []; if ($('fSpouses').checked) rel.push(['spousesUrl', 'spouses']); if ($('fChildren').checked) rel.push(['childrenUrl', 'children']); if ($('fParents').checked) rel.push(['parentsUrl', 'parents']);
        p.spouses = []; p.children = []; p.parents = [];
        rel.forEach(([from, to]) => p[from].forEach((l) => { p[to].push(Extract.idOf(l));
          if (!seen.has(l) && (!maxDepth || dp < maxDepth)) { seen.add(l); queue.push([l, dp + 1]); } }));
        if ($('saveMedia').checked) for (let i = 0; i < p.media.length && !stopped; i++) {
          try { const r = await fetch(p.media[i], { credentials: 'include' }); if (!r.ok) continue; const ext = (p.media[i].split('?')[0].match(/\.\w{2,4}$/) || ['.jpg'])[0];
            const name = `${p.id}_${p.surname}_${i + 1}${ext}`.replace(/[\\/:*?"<>|]/g, '_'); await writeFile(mediaDir, name, await r.blob()); (p.mediaFiles = p.mediaFiles || []).push(name); } catch (e) {}
        }
        await sleep(+$('delay').value);
      }
      // children/parents взаимно: родитель→дети достаточно для GEDCOM
      Object.values(people).forEach((p) => (p.parents || []).forEach((pid) => { const par = people[pid]; if (par && !(par.children || []).includes(p.id)) (par.children = par.children || []).push(p.id); }));
      const list = Object.values(people); log(`Сбор ${stopped ? 'остановлен' : 'завершён'}: ${list.length} чел.`);
      // 3. сохранение
      if ($('outXlsx').checked && list.length) {
        const rows = [['ID', 'Фамилия', 'Имя', 'Отчество', 'Пол', 'Дата рождения', 'Год рождения', 'Место рождения', 'Дата смерти', 'Место смерти', 'Супруги (ID)', 'Дети (ID)', 'Родители (ID)', 'Файлы медиа', 'Ссылка']];
        list.forEach((p) => rows.push([p.id, p.surname, p.given, p.patronymic, p.sex, p.birthDate, p.birthYear ? +p.birthYear : '', p.birthPlace, p.deathDate, p.deathPlace, (p.spouses || []).join(', '), (p.children || []).join(', '), (p.parents || []).join(', '), (p.mediaFiles || []).join(', '), p.url]));
        await writeFile(root, 'Familio_люди.xlsx', Xlsx.build([{ name: 'Люди', rows }])); log('Сохранён Familio_люди.xlsx');
      }
      if ($('outGed').checked && list.length) {
        const act = document.querySelector('input[name=act]:checked').value;
        if (act !== 'new' && !gedText) throw new Error('Укажите файл GEDCOM');
        if (gedText) await writeFile(root, 'ОРИГИНАЛ_' + gedName, gedText);
        const res = await Gedcom.merge(act === 'new' ? '' : gedText, list, { mode: act, confirm: askConfirm });
        const out = act === 'new' ? 'Familio_новый.ged' : gedName.replace(/\.ged$/i, '') + '_обновлён.ged';
        await writeFile(root, out, res.text); log(`Сохранён ${out}: ${JSON.stringify(res.stats)}`);
      }
      log('Готово. Папка: ' + root.name);
    } catch (e) { log('✖ ' + e.message); }
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
