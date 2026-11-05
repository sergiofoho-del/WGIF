// Ручное указание секторов страницы персоны (тестовая версия 0.7.0): выбор мышью на странице, затем разбор по выбранным секторам.
// Разбор работает над Document (DOMParser) без сети — проверяется в браузере (tests/e2e_sectors.py).
(function (root) {
  'use strict';
  const ROLES = [
    { id: 'sections', title: 'Сектор разделов (вкладки «События», «Родственники», «Обсуждение»)', hint: 'Рамка вокруг строки вкладок', tab: false },
    { id: 'eventsCols', title: 'Сектор названий столбцов раздела «События»', hint: 'Откройте вкладку «События» и укажите строку с названиями столбцов', tab: true },
    { id: 'relCols', title: 'Сектор названий столбцов раздела «Родственники»', hint: 'Откройте вкладку «Родственники» и укажите строку «статус / Фамилия Имя Отчество / Дата рождения …»', tab: true },
    { id: 'header', title: 'Сектор заголовка «Фамилия Имя Отчество» персоны', hint: 'Имя персоны вверху страницы', tab: false },
    { id: 'family', title: 'Основной сектор состава семьи персоны (строки родственников)', hint: 'Откройте вкладку «Родственники» и укажите область со строками родственников', tab: true },
    { id: 'summary', title: 'Сектор «Фотография персоны» и «сводная информация о персоне»', hint: 'Левый блок под шапкой: фото и краткие сведения', tab: false }
  ];

  // ---- Работает внутри страницы familio.org (внедряется через chrome.scripting.executeScript; самодостаточна) ----
  function pickerInPage(role, title) {
    if (window.__wgifPicker) window.__wgifPicker.stop();
    const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
    const box = document.createElement('div'); box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:3px solid #2f6b3a;background:rgba(47,107,58,.15);display:none;transition:all .05s';
    const bar = document.createElement('div'); bar.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;right:0;padding:10px 14px;background:#2f6b3a;color:#fff;font:14px system-ui;text-align:center';
    bar.textContent = '🌳 WGIF: наведите на нужный сектор и нажмите. ' + title + '  (Esc — отмена)';
    document.documentElement.append(box, bar);
    let cur = null; const trail = [];
    const pathOf = (el) => { const parts = []; for (let e = el; e && e !== document.body && e.parentElement; e = e.parentElement) { let i = 1; for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === e.tagName) i++; parts.unshift(e.tagName.toLowerCase() + ':nth-of-type(' + i + ')'); } return 'body > ' + parts.join(' > '); };
    const show = () => { const r = cur.getBoundingClientRect(); Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' }); bar.textContent = '🌳 WGIF: наведите и нажмите. ↑ — крупнее, ↓ — мельче. Esc — отмена.  Выбрано: <' + cur.tagName.toLowerCase() + '> «' + norm(cur.textContent).slice(0, 40) + '»  — ' + title; };
    let lx = -1, ly = -1;
    const move = (ev) => { if (ev.clientX === lx && ev.clientY === ly) return; lx = ev.clientX; ly = ev.clientY; const el = document.elementFromPoint(ev.clientX, ev.clientY); if (!el || el === bar || el === box || el === cur) return; cur = el; trail.length = 0; show(); };
    const stop = () => { document.removeEventListener('mousemove', move, true); document.removeEventListener('click', click, true); document.removeEventListener('keydown', key, true); box.remove(); bar.remove(); window.__wgifPicker = null; };
    const click = async (ev) => {
      ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); if (!cur) return;
      const el = cur; stop();
      const spec = { role, selector: pathOf(el), text: norm(el.textContent).slice(0, 120), tag: el.tagName.toLowerCase(), tab: new URLSearchParams(location.search).get('tab') || '0', path: location.pathname, verified: false, rawText: '' };
      try { const raw = await fetch(location.pathname + (spec.tab !== '0' ? '?tab=' + spec.tab : ''), { credentials: 'include' }).then((r) => r.text()); const d = new DOMParser().parseFromString(raw, 'text/html'); const f = d.querySelector(spec.selector); spec.rawText = f ? norm(f.textContent).slice(0, 120) : ''; spec.verified = !!f && spec.rawText.slice(0, 30) === spec.text.slice(0, 30); } catch (e) {}
      chrome.runtime.sendMessage({ type: 'wgif-picked', spec });
    };
    const key = (ev) => {
      if (ev.key === 'ArrowUp' && cur && cur.parentElement && cur.parentElement !== document.body) { ev.preventDefault(); trail.push(cur); cur = cur.parentElement; show(); return; }
      if (ev.key === 'ArrowDown' && trail.length) { ev.preventDefault(); cur = trail.pop(); show(); return; }
      if (ev.key === 'Escape') { stop(); chrome.runtime.sendMessage({ type: 'wgif-picked', spec: { role, cancelled: true } }); } };
    document.addEventListener('mousemove', move, true); document.addEventListener('click', click, true); document.addEventListener('keydown', key, true);
    window.__wgifPicker = { stop };
  }

  // ---- Разбор по выбранным секторам ----
  const txt = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
  const COLS = [['status', /^статус/i], ['name', /^фамилия имя отчество|^фио/i], ['birthDate', /^дата рождения/i], ['birthPlace', /^место рождения/i], ['deathDate', /^дата смерти/i], ['deathPlace', /^место смерти/i], ['residence', /^место жительства/i]];
  const STAT = [['father', /^отец/i], ['mother', /^мать/i], ['spouses', /(муж|жена|супруг)/i], ['children', /^(сын|дочь|ребен|дет)/i], ['siblings', /^(брат|сестра)/i]];
  const MALE = /^(отец|сын|брат|муж)/i, FEMALE = /^(мать|дочь|сестра|жена)/i;

  function resolve(doc, spec) {
    if (!spec || !spec.selector) return null;
    let el = null; try { el = doc.querySelector(spec.selector); } catch (e) {}
    if (el) return el;
    if (spec.role === 'eventsCols' || spec.role === 'relCols' || spec.role === 'sections') {   // подписи столбцов/вкладок одинаковы на всех страницах
      const key = (spec.text || '').slice(0, 25); if (!key) return null; let best = null;
      doc.querySelectorAll(spec.tag || '*').forEach((e) => { if (txt(e).startsWith(key) && (!best || e.querySelectorAll('*').length < best.querySelectorAll('*').length)) best = e; });
      return best;
    }
    return null;
  }
  const cellsOf = (row) => { let c = [...row.children]; if (c.length === 1 && c[0].children.length >= 3) c = [...c[0].children]; return c; };
  function columnsOf(colsEl) {
    const idx = {}; const cells = colsEl.tagName === 'TR' || colsEl.children.length >= 2 ? cellsOf(colsEl) : [...colsEl.querySelectorAll('th,td,div,span')];
    cells.forEach((c, i) => { const t = txt(c); const k = COLS.find(([, r]) => r.test(t)); if (k && idx[k[0]] === undefined) idx[k[0]] = i; });
    return { idx, names: cells.map(txt), n: cells.length };
  }
  function rowsOf(el, colsEl) {
    let rows = [...el.querySelectorAll('tr')];
    if (!rows.length) { rows = [...el.children]; if (rows.length === 1 && rows[0].children.length > 1) rows = [...rows[0].children]; }
    const hdr = colsEl ? txt(colsEl) : '';
    return rows.filter((r) => r !== colsEl && !(colsEl && r.contains(colsEl)) && !(hdr && txt(r) === hdr) && cellsOf(r).length >= 3);
  }

  function parseFamily(doc, url, specs, profile) {
    const E = root.Extract; const rx = new RegExp(profile.personUrl, 'i');
    const famEl = resolve(doc, specs.family), colsEl = resolve(doc, specs.relCols);
    if (!famEl || !colsEl) return { rows: [], error: !famEl ? 'не найден сектор «состав семьи»' : 'не найден сектор названий столбцов «Родственники»' };
    const cols = columnsOf(colsEl); const rows = [];
    rowsOf(famEl, colsEl).forEach((r) => {
      const cells = cellsOf(r); const cell = (k) => (cols.idx[k] !== undefined ? cells[cols.idx[k]] : null);
      const nc = cell('name') || r; const a = [...nc.querySelectorAll('a[href]')].find((x) => rx.test(E.abs(x.getAttribute('href'), url)));
      if (!a) return; const u = E.abs(a.getAttribute('href'), url);
      const status = txt(cell('status')); const rel = (STAT.find(([, x]) => x.test(status)) || ['relative'])[0];
      const place = (k) => { const c = cell(k); const l = c && c.querySelector('a[href]'); return { text: txt(c), url: l ? E.abs(l.getAttribute('href'), url) : '' }; };
      rows.push(Object.assign({ url: u, id: E.idOf(u), rel, status, text: txt(a), sex: MALE.test(status) ? 'M' : FEMALE.test(status) ? 'F' : '',
        birthDate: txt(cell('birthDate')), deathDate: txt(cell('deathDate')), birthPlace: place('birthPlace').text, birthPlaceUrl: place('birthPlace').url,
        deathPlace: place('deathPlace').text, deathPlaceUrl: place('deathPlace').url, residence: place('residence').text, residenceUrl: place('residence').url }, E.parseName(txt(a))));
    });
    return { rows, columns: cols.names };
  }
  function parseEvents(doc, specs) {
    const colsEl = resolve(doc, specs.eventsCols); if (!colsEl) return { rows: [], error: 'не найден сектор названий столбцов «События»' };
    const names = cellsOf(colsEl).map(txt); const rows = [];
    let list = []; const tbl = colsEl.closest('table');
    if (tbl) list = [...tbl.querySelectorAll('tr')].filter((r) => r !== colsEl && !r.contains(colsEl));
    else { for (let q = colsEl.nextElementSibling; q; q = q.nextElementSibling) list.push(q); if (list.length === 1 && list[0].children.length > 1) list = [...list[0].children]; }
    list.forEach((r) => { const c = cellsOf(r).map(txt); if (c.filter(Boolean).length) rows.push(c.map((v, i) => (names[i] ? names[i] + ': ' : '') + v).filter((x) => !/: $/.test(x)).join('; ')); });
    return { rows, columns: names };
  }
  function summaryOf(el, url) {
    const E = root.Extract; const t = txt(el); const out = { text: t, photo: '', sex: '', birthDate: '', deathDate: '', hidden: /Скрыт(ая|ый|ые) персон/i.test(t) };
    const m = t.match(/(мужской|женский),?\s*родил(?:ся|ась)\s*(.*)$/i);
    if (m) { out.sex = /^м/i.test(m[1]) ? 'M' : 'F'; let r = m[2]; const d = r.match(/(умер(?:ла)?)\s*(.*)$/i); if (d) { out.deathDate = d[2].trim(); r = r.slice(0, d.index); } out.birthDate = /^неизвестно$/i.test(r.trim()) ? '' : r.trim(); }
    const img = el.querySelector('img[src]'); if (img && !/avatar|icon|logo|sprite|emoji|placeholder/i.test(img.getAttribute('src'))) out.photo = E.abs(img.getAttribute('src'), url);
    return out;
  }
  // docs: { [tab]: Document }
  function extractPerson(docs, url, specs, profile) {
    const E = root.Extract; profile = Object.assign({}, E.DEFAULT_PROFILE, profile || {});
    const docOf = (role) => docs[(specs[role] && specs[role].tab) || '0'] || docs['0'];
    const warn = [];
    const hEl = resolve(docOf('header'), specs.header); const nm = E.parseName(hEl ? txt(hEl) : txt(docOf('header').querySelector('h1')));
    if (!hEl) warn.push('не найден сектор заголовка');
    const sEl = resolve(docOf('summary'), specs.summary); const sum = sEl ? summaryOf(sEl, url) : { text: '', hidden: false }; if (!sEl) warn.push('не найден сектор сводной информации');
    const fam = parseFamily(docOf('family'), url, specs, profile); if (fam.error) warn.push(fam.error);
    const ev = parseEvents(docOf('eventsCols'), specs); if (ev.error) warn.push(ev.error);
    const p = Object.assign({ id: E.idOf(url), url, sex: sum.sex || '', birthDate: sum.birthDate || '', deathDate: sum.deathDate || '', birthYear: ((sum.birthDate || '').match(/\d{4}/) || [''])[0], photo: sum.photo || '', summary: sum.text || '', hidden: !!sum.hidden, family: fam.rows, events: ev.rows, warn }, nm);
    p.former = ''; if (p.maiden && p.sex === 'M') { p.former = p.maiden; p.maiden = ''; }
    return p;
  }
  const api = { ROLES, pickerInPage, resolve, parseFamily, parseEvents, summaryOf, extractPerson };
  root.Sectors = api; if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
