// Разбор страниц familio.org. Работает над готовым Document (DOMParser), без сети.
// ВАЖНО: разметка сайта подгоняется профилем (profile) на вкладке «Настройки сайта» — правила по умолчанию эвристические.
(function (root) {
  const DEFAULT_PROFILE = {
    personUrl: '/persons/[0-9a-f]{8}-[0-9a-f-]{27}',   // ссылки на карточки людей
    nameOrder: 'SGP',        // порядок в заголовке: S=Фамилия G=Имя P=Отчество
    labels: {
      birth: 'Родил(ся|ась)|Дата рождения|Рожд',
      birthPlace: 'Место рождения',
      death: 'Умер|Умерла|Дата смерти',
      deathPlace: 'Место смерти',
      sex: 'Пол'
    },
    sections: {
      spouses: 'Супруг|Жена|Муж|Брак',
      children: 'Дети|Ребен|Сын|Дочь',
      parents: 'Родител|Отец|Мать',
      father: 'Отец', mother: 'Мать',
      events: 'События', relatives: 'Родственники', discussion: 'Обсуждение'
    },
    exclude: 'header, nav, footer, aside',   // шапка и технический правый сектор — не собираем
    accountHeading: 'Люди, добавленные пользователем',
    accountListUrl: '?tab=1&page-userPersons=',   // страницы списка аккаунта: …/users/<id>?tab=1&page-userPersons=N
    hidden: 'Скрыт(ая|ый|ые) персон',   // пометка конфиденциальности — такие персоны не собираются
    next: 'a[rel=next], .pagination .next a, a.next',
    peoplePath: '/profile/my-persons', surnamesPath: '/profile/my-surnames',
    tabs: { events: '?tab=0', relatives: '?tab=1' }   // вкладки карточки: События, Родственники
  };
  const txt = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
  const abs = (h, base) => { try { return new URL(h, base).href.split('#')[0]; } catch (e) { return ''; } };

  // «Старкина Анастасия Федоровна» = Фамилия Имя Отчество; «Иванова (Жегалова) Мария Федоровна» — в скобках девичья фамилия
  function parseName(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim(); const r = { surname: '', maiden: '', given: '', patronymic: '' };
    const m = t.match(/^(\S+)\s*\(([^)]+)\)\s*(.*)$/);
    const rest = (m ? m[3] : t.replace(/^\S+\s*/, '')).split(' ').filter(Boolean);
    r.surname = m ? m[1] : (t.split(' ')[0] || ''); if (m) r.maiden = m[2].trim();
    r.given = rest[0] || ''; r.patronymic = rest.slice(1).join(' ');
    return r;
  }
  const REL = [['father', /^Отец(?![а-яё])/i], ['mother', /^Мать(?![а-яё])/i], ['spouses', /^(Супруг|Жена|Муж)/i], ['children', /^(Дети|Сын|Дочь|Ребен)/i], ['siblings', /^(Брат|Сестра|Братья|Сестры)/i]];
  // Все ссылки на людей в основной части страницы с названием связи (по ближайшей подписи) и разобранным именем
  function relatives(doc, base, profile) {
    const rx = new RegExp(profile.personUrl, 'i'); const out = []; const seen = new Set();
    const label = (a) => {
      for (let e = a, up = 0; e && e.parentElement && up < 6; e = e.parentElement, up++) {
        for (let q = e.previousElementSibling, n = 0; q && n < 4; q = q.previousElementSibling, n++) {
          const t = txt(q); if (t.length < 40) { const r = REL.find(([, x]) => x.test(t)); if (r) return r[0]; }
        }
        const own = txt(e.parentElement).slice(0, 40); const r = REL.find(([, x]) => x.test(own)); if (r && txt(e.parentElement).length < 400) return r[0];
      }
      return 'relative';
    };
    doc.querySelectorAll('a[href]').forEach((a) => {
      if (a.closest(profile.exclude || 'header, nav, footer, aside')) return;
      const u = abs(a.getAttribute('href'), base); if (!u || !rx.test(new URL(u).pathname) || idOf(u) === idOf(base)) return;
      const key = idOf(u) + label(a); if (seen.has(key)) return; seen.add(key);
      out.push(Object.assign({ url: u, id: idOf(u), rel: label(a), text: txt(a) }, parseName(txt(a))));
    });
    return out;
  }
  const STAT = [['father', /^отец/i], ['mother', /^мать/i], ['spouses', /(муж|жена|супруг)/i], ['children', /^(сын|дочь|ребен|дет)/i], ['siblings', /^(брат|сестра)/i]];
  const MALE = /^(отец|сын|брат|муж)/i, FEMALE = /^(мать|дочь|сестра|жена)/i;
  const COLS = [['status', /^статус/i], ['name', /^фамилия имя отчество/i], ['birthDate', /^дата рождения/i], ['birthPlace', /^место рождения/i], ['deathDate', /^дата смерти/i], ['deathPlace', /^место смерти/i], ['residence', /^место жительства/i]];
  // Таблица состава семьи: столбцы «статус», «Фамилия Имя Отчество», «Дата рождения», «Место рождения», «Дата смерти», «Место смерти» (+ «Место жительства»).
  // Ссылки в столбцах мест собираются (placeUrl), но по ним не переходят.
  function familyTable(doc, base, profile) {
    const rx = new RegExp(profile.personUrl, 'i'); const ex = profile.exclude || 'header, nav, footer, aside';
    let hr = null, best = 1e9;
    doc.querySelectorAll('tr, div, li, ul').forEach((e) => { if (e.closest(ex) || e.children.length < 4) return;
      const t = [...e.children].map(txt); if (t.some((x) => COLS[2][1].test(x)) && t.some((x) => COLS[3][1].test(x)) && e.querySelectorAll('*').length < best) { hr = e; best = e.querySelectorAll('*').length; } });
    if (!hr) return [];
    const idx = {}; [...hr.children].forEach((c, i) => { const t = txt(c); const k = COLS.find(([, r]) => r.test(t)); if (k && idx[k[0]] === undefined) idx[k[0]] = i; });
    let rows = []; const after = (el) => { const r = []; for (let q = el.nextElementSibling; q; q = q.nextElementSibling) r.push(q); return r; };
    if (hr.tagName === 'TR') rows = [...hr.closest('table').querySelectorAll('tr')].filter((r) => r !== hr);
    else { rows = after(hr); if (!rows.some((r) => r.querySelector('a[href]'))) rows = after(hr.parentElement).flatMap((x) => (x.children.length >= 4 ? [x] : [...x.children])); }
    const out = [];
    rows.forEach((r) => { const cells = [...r.children]; if (cells.length < 3) return;
      const cell = (k) => (idx[k] !== undefined ? cells[idx[k]] : null);
      const nc = cell('name') || r; const a = [...nc.querySelectorAll('a[href]')].find((x) => rx.test(abs(x.getAttribute('href'), base)));
      if (!a) return; const u = abs(a.getAttribute('href'), base); if (idOf(u) === idOf(base)) return;
      const status = txt(cell('status')); const rel = (STAT.find(([, x]) => x.test(status)) || ['relative'])[0];
      const place = (k) => { const c = cell(k); const l = c && c.querySelector('a[href]'); return { text: txt(c), url: l ? abs(l.getAttribute('href'), base) : '' }; };
      const nm = parseName(txt(a)); const sex = MALE.test(status) ? 'M' : FEMALE.test(status) ? 'F' : '';
      out.push(Object.assign({ url: u, id: idOf(u), rel, status, text: txt(a), sex, birthDate: txt(cell('birthDate')), deathDate: txt(cell('deathDate')),
        birthPlace: place('birthPlace').text, birthPlaceUrl: place('birthPlace').url, deathPlace: place('deathPlace').text, deathPlaceUrl: place('deathPlace').url,
        residence: place('residence').text, residenceUrl: place('residence').url }, nm));
    });
    return out;
  }
  // Страница аккаунта: ссылки на людей под заголовком «Люди, добавленные пользователем»
  function accountPersons(doc, base, profile) {
    const ex = profile.exclude || 'header, nav, footer, aside', rx = new RegExp(profile.personUrl, 'i'); const hq = new RegExp(profile.accountHeading, 'i');
    let scope = null;
    for (const h of doc.querySelectorAll('h1,h2,h3,h4,h5,div,span,p')) { if (h.children.length > 2 || !hq.test(txt(h)) || txt(h).length > 80) continue;
      for (let e = h; e && e !== doc.body; e = e.parentElement) { if ([...e.querySelectorAll('a[href]')].some((a) => rx.test(abs(a.getAttribute('href'), base)))) { scope = e; break; } } if (scope) break; }
    const out = []; const seen = new Set();
    (scope || doc).querySelectorAll('a[href]').forEach((a) => { if (a.closest(ex)) return; const u = abs(a.getAttribute('href'), base);
      if (u && rx.test(new URL(u).pathname) && !seen.has(idOf(u))) { seen.add(idOf(u)); out.push({ url: u, id: idOf(u), text: txt(a) }); } });
    return out;
  }
  function idOf(url) { const g = String(url).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i); if (g) return g[0].toLowerCase(); const m = url.match(/(\d+)(?:[^\d]*)$/); return m ? m[1] : url; }

  function personLinks(doc, base, profile, within) {
    const rx = new RegExp(profile.personUrl, 'i'); const seen = new Set(), out = [];
    (within || doc).querySelectorAll('a[href]').forEach((a) => { const u = abs(a.getAttribute('href'), base);
      if (u && rx.test(new URL(u).pathname) && !seen.has(u)) { seen.add(u); out.push(u); } });
    return out;
  }
  function labelValue(doc, re) {
    const rx = new RegExp('^(' + re + ')\\s*:?', 'i');
    for (const e of doc.querySelectorAll('dt, th, td, span, div, b, strong, li, p, label')) {
      if (e.children.length > 3) continue; const t = txt(e);
      if (rx.test(t)) {
        const sib = e.nextElementSibling; if (sib && txt(sib) && !rx.test(txt(sib))) return txt(sib);
        const rest = t.replace(rx, '').trim(); if (rest) return rest;
      }
    }
    return '';
  }
  function section(doc, re, base, profile) {
    const rx = new RegExp(re, 'i');
    for (const h of doc.querySelectorAll('h1,h2,h3,h4,h5,dt,th,b,strong,legend,div.title,.section-title')) {
      if (rx.test(txt(h)) && txt(h).length < 60) {
        let box = h.nextElementSibling; if (!box || !box.querySelector('a')) box = h.parentElement;
        const l = personLinks(doc, base, profile, box); if (l.length) return l;
      }
    }
    return [];
  }
  // «Отец: Иванов Иван» / «Мать: не указана» — строка с подписью и ссылкой
  function lineLinks(doc, re, base, profile) {
    const rx = new RegExp('^(' + re + ')\\s*:', 'i');
    for (const e of doc.querySelectorAll('p, li')) { if (e.children.length > 6) continue;
      if (rx.test(txt(e))) { const l = personLinks(doc, base, profile, e); if (l.length) return l; } }
    return [];
  }
  function sectionText(doc, re) {
    const rx = new RegExp('^(' + re + ')(?![а-яё])', 'i');
    for (const h of doc.querySelectorAll('h1,h2,h3,h4,h5,dt,th,b,strong,legend,.section-title')) {
      if (rx.test(txt(h)) && txt(h).length < 40) { const box = h.nextElementSibling; if (box) return txt(box).slice(0, 5000); }
    }
    return '';
  }
  function person(doc, url, profile, extra) {
    extra = extra || {}; const relDoc = extra.rel || doc, evDoc = extra.ev || doc;
    profile = Object.assign({}, DEFAULT_PROFILE, profile || {});
    const L = profile.labels, S = profile.sections;
    const h = txt(doc.querySelector('h1')) || txt(doc.querySelector('title'));
    const p = Object.assign({ id: idOf(url), url }, parseName(h));
    const sm = [...doc.querySelectorAll('p, div, span')].map(txt).find((t) => /^(мужской|женский),\s*родил(ся|ась)/i.test(t));
    p.birthDate = labelValue(doc, L.birth);
    if (sm) { const m = sm.match(/^(мужской|женский),\s*родил(?:ся|ась)\s*(.*)$/i); if (m) { if (!p.birthDate) p.birthDate = m[2].replace(/\s*(умер|умерла).*$/i, '').trim(); p.sex0 = /^м/i.test(m[1]) ? 'M' : 'F'; } }
    if (/^неизвестно$/i.test(p.birthDate)) p.birthDate = ''; p.birthYear = (p.birthDate.match(/\d{4}/) || [''])[0];
    p.birthPlace = labelValue(doc, L.birthPlace);
    p.deathDate = labelValue(doc, L.death); p.deathPlace = labelValue(doc, L.deathPlace);
    const sx = labelValue(doc, L.sex); p.sex = /^м/i.test(sx) ? 'M' : /^ж/i.test(sx) ? 'F' : (p.sex0 || '');
    p.spousesUrl = section(relDoc, S.spouses, url, profile).concat(relDoc === doc ? [] : section(doc, S.spouses, url, profile)); p.childrenUrl = section(relDoc, S.children, url, profile).concat(relDoc === doc ? [] : section(doc, S.children, url, profile));
    p.parentsUrl = section(relDoc, S.parents, url, profile);
    p.fatherUrl = lineLinks(doc, S.father, url, profile).concat(section(doc, S.father, url, profile)).slice(0, 1); p.motherUrl = lineLinks(doc, S.mother, url, profile).concat(section(doc, S.mother, url, profile)).slice(0, 1);
    p.family = familyTable(doc, url, profile); if (!p.family.length && relDoc !== doc) p.family = familyTable(relDoc, url, profile);
    p.relatives = p.family.concat(relatives(relDoc, url, profile), relDoc === doc ? [] : relatives(doc, url, profile)).filter((x, i, a) => a.findIndex((y) => y.id === x.id && y.rel === x.rel) === i);
    const byRel = (r) => [...new Set(p.relatives.filter((x) => x.rel === r).map((x) => x.url))];
    p.siblingsUrl = byRel('siblings');
    if (byRel('father').length) p.fatherUrl = byRel('father').slice(0, 1); if (byRel('mother').length) p.motherUrl = byRel('mother').slice(0, 1);
    if (!p.fatherUrl.length) p.fatherUrl = byRel('father').slice(0, 1); if (!p.motherUrl.length) p.motherUrl = byRel('mother').slice(0, 1);
    if (byRel('spouses').length) p.spousesUrl = byRel('spouses'); if (byRel('children').length) p.childrenUrl = byRel('children');
    if (!p.spousesUrl.length) p.spousesUrl = byRel('spouses'); if (!p.childrenUrl.length) p.childrenUrl = byRel('children');
    if (!p.parentsUrl.length) p.parentsUrl = p.fatherUrl.concat(p.motherUrl);
    p.hidden = new RegExp(profile.hidden, 'i').test(txt(doc.body));
    p.events = extra.ev ? [...evDoc.querySelectorAll('tr')].map((r) => [...r.children].map(txt).filter(Boolean).join(' / ')).filter(Boolean).join(' | ').slice(0, 5000) : sectionText(doc, S.events);
    p.relativesText = p.relatives.length ? p.relatives.map((x) => x.rel + ': ' + x.text).join('; ') : sectionText(doc, S.relatives); p.discussion = sectionText(doc, S.discussion);
    p.media = []; const seen = new Set();
    doc.querySelectorAll('img[src], a[href$=".jpg"], a[href$=".jpeg"], a[href$=".png"], video source[src], a[href$=".pdf"]').forEach((e) => {
      const u = abs(e.getAttribute('src') || e.getAttribute('href'), url);
      if (u && !/avatar|icon|logo|sprite|emoji|\/static\//i.test(u) && !seen.has(u)) { seen.add(u); p.media.push(u); }
    });
    // скобки: у женщин — девичья фамилия, у мужчин — фамилия до смены
    p.former = ''; if (p.maiden && p.sex === 'M') { p.former = p.maiden; p.maiden = ''; }
    p.notes = [];
    if (p.events) p.notes.push('События: ' + p.events);
    if (p.relativesText) p.notes.push('Родственники: ' + p.relativesText);
    return p;
  }
  // Что читать дальше после карточки p. dir: 'self' | 'up' (предки) | 'down' (потомки) | 'side' (семейные связи, без дальнейшего хода)
  // opt: {maleOnly, sec:{father,mother,spouses,children}}
  function expand(p, dir, opt) {
    const sec = opt.sec || {}, out = [];
    if (dir === 'up') {
      const fa = sec.father !== false ? (p.fatherUrl || []) : [], mo = sec.mother !== false && !opt.maleOnly ? (p.motherUrl || []) : [];
      const both = !fa.length && !mo.length ? (opt.maleOnly ? [] : p.parentsUrl || []) : [];
      fa.concat(mo, both).forEach((u) => out.push([u, 'up']));
      if (sec.spouses !== false) (p.spousesUrl || []).forEach((u) => out.push([u, 'side']));
    } else if (dir === 'all') {   // вся родовая ветка: все связи
      const add = (k, on) => { if (on !== false) (p[k] || []).forEach((u) => out.push([u, 'all'])); };
      add('fatherUrl', sec.father); add('motherUrl', sec.mother); add('spousesUrl', sec.spouses); add('childrenUrl', sec.children); add('siblingsUrl', true);
    } else if (dir === 'down') {
      if (sec.children !== false && !(opt.maleOnly && p.sex === 'F')) (p.childrenUrl || []).forEach((u) => out.push([u, 'down']));
      if (sec.spouses !== false) (p.spousesUrl || []).forEach((u) => out.push([u, 'side']));
    }
    return out;
  }
  const api = { familyTable, accountPersons, parseName, relatives, expand, DEFAULT_PROFILE, person, personLinks, idOf, abs };
  root.Extract = api; if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
