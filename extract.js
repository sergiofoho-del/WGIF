// Разбор страниц familio.org. Работает над готовым Document (DOMParser), без сети.
// ВАЖНО: разметка сайта подгоняется профилем (profile) на вкладке «Настройки сайта» — правила по умолчанию эвристические.
(function (root) {
  const DEFAULT_PROFILE = {
    personUrl: '/(person|persona|people|man|human)[/-]?[\\w-]*\\d',   // ссылки на карточки людей
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
      children: 'Дети|Ребен',
      parents: 'Родител|Отец|Мать',
      father: 'Отец', mother: 'Мать',
      events: 'События', relatives: 'Родственники', discussion: 'Обсуждение'
    },
    hidden: 'Скрыт(ая|ый|ые) персон|конфиденциальн',   // пометка конфиденциальности — такие персоны не собираются
    next: 'a[rel=next], .pagination .next a, a.next',
    peoplePath: '/people', surnamesPath: '/surnames'
  };
  const txt = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
  const abs = (h, base) => { try { return new URL(h, base).href.split('#')[0]; } catch (e) { return ''; } };

  function idOf(url) { const m = url.match(/(\d+)(?:[^\d]*)$/); return m ? m[1] : url; }

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
  function sectionText(doc, re) {
    const rx = new RegExp('^(' + re + ')\\b', 'i');
    for (const h of doc.querySelectorAll('h1,h2,h3,h4,h5,dt,th,b,strong,legend,.section-title')) {
      if (rx.test(txt(h)) && txt(h).length < 40) { const box = h.nextElementSibling; if (box) return txt(box).slice(0, 5000); }
    }
    return '';
  }
  function person(doc, url, profile) {
    profile = Object.assign({}, DEFAULT_PROFILE, profile || {});
    const L = profile.labels, S = profile.sections;
    const h = txt(doc.querySelector('h1')) || txt(doc.querySelector('title'));
    const words = h.replace(/\(.*?\)/g, '').split(/\s+/).filter(Boolean);
    const p = { id: idOf(url), url, given: '', patronymic: '', surname: '' };
    const map = { S: 'surname', G: 'given', P: 'patronymic' };
    String(profile.nameOrder).split('').forEach((c, i) => { if (words[i]) p[map[c]] = words[i]; });
    p.birthDate = labelValue(doc, L.birth); p.birthYear = (p.birthDate.match(/\d{4}/) || [''])[0];
    p.birthPlace = labelValue(doc, L.birthPlace);
    p.deathDate = labelValue(doc, L.death); p.deathPlace = labelValue(doc, L.deathPlace);
    const sx = labelValue(doc, L.sex); p.sex = /^м/i.test(sx) ? 'M' : /^ж/i.test(sx) ? 'F' : '';
    p.spousesUrl = section(doc, S.spouses, url, profile); p.childrenUrl = section(doc, S.children, url, profile);
    p.parentsUrl = section(doc, S.parents, url, profile);
    p.fatherUrl = section(doc, S.father, url, profile); p.motherUrl = section(doc, S.mother, url, profile);
    if (!p.parentsUrl.length) p.parentsUrl = p.fatherUrl.concat(p.motherUrl);
    p.hidden = new RegExp(profile.hidden, 'i').test(txt(doc.body));
    p.events = sectionText(doc, S.events); p.relativesText = sectionText(doc, S.relatives); p.discussion = sectionText(doc, S.discussion);
    p.media = []; const seen = new Set();
    doc.querySelectorAll('img[src], a[href$=".jpg"], a[href$=".jpeg"], a[href$=".png"], video source[src], a[href$=".pdf"]').forEach((e) => {
      const u = abs(e.getAttribute('src') || e.getAttribute('href'), url);
      if (u && !/avatar|icon|logo|sprite|emoji|\/static\//i.test(u) && !seen.has(u)) { seen.add(u); p.media.push(u); }
    });
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
    } else if (dir === 'down') {
      if (sec.children !== false && !(opt.maleOnly && p.sex === 'F')) (p.childrenUrl || []).forEach((u) => out.push([u, 'down']));
      if (sec.spouses !== false) (p.spousesUrl || []).forEach((u) => out.push([u, 'side']));
    }
    return out;
  }
  const api = { expand, DEFAULT_PROFILE, person, personLinks, idOf, abs };
  root.Extract = api; if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
