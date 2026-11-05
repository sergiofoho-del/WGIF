// Карточки семей без дублирования персон. Чистая логика (Node-тесты tests/run.js).
// Вход: результаты разбора страниц персон (Sectors.extractPerson). Выход: единый список людей, карточки, события.
(function (root) {
  'use strict';
  const ORIGIN = ['father', 'mother', 'siblings'], OWN = ['spouses', 'children'];
  const GROUP = (rel) => (ORIGIN.includes(rel) ? 'Семья происхождения' : OWN.includes(rel) ? 'Своя семья' : 'Прочие');
  const FIELDS = ['surname', 'maiden', 'former', 'given', 'patronymic', 'sex', 'birthDate', 'birthYear', 'birthPlace', 'deathDate', 'deathPlace', 'residence', 'url'];

  function build(results) {
    const people = new Map(); const cards = [];
    const own = new Map(results.filter((r) => !r.hidden).map((r) => [r.id, r]));
    const fill = (dst, src) => FIELDS.forEach((f) => { if (!dst[f] && src[f]) dst[f] = src[f]; });
    // 1. человек = одна запись; сведения собственной страницы главнее строк из чужих карточек
    own.forEach((r) => { const p = { id: r.id, visited: true }; fill(p, r); p.photo = r.photo; people.set(r.id, p); });
    results.forEach((r) => { if (r.hidden) return; (r.family || []).forEach((m) => { if (m.id === r.id) return; let p = people.get(m.id); if (!p) { p = { id: m.id, visited: false }; people.set(m.id, p); } if (!p.visited) { fill(p, m); if (!m.maiden && !m.former) return; if (m.sex === 'M' && m.maiden && !p.former) { p.former = m.maiden; p.maiden = ''; } } }); });
    // 2. карточки: у каждой персоны-центра родственники без повторов
    results.forEach((r) => {
      if (r.hidden) return; const seen = new Set([r.id]); const members = [];
      (r.family || []).forEach((m) => {
        if (seen.has(m.id)) { const ex = members.find((x) => x.id === m.id); if (ex && m.status && !ex.statuses.includes(m.status)) ex.statuses.push(m.status); return; }
        seen.add(m.id); members.push(Object.assign({}, m, { statuses: [m.status].filter(Boolean), group: GROUP(m.rel) }));
      });
      members.forEach((m) => {
        const o = own.get(m.id);
        m.fromOtherFamily = m.rel === 'spouses';           // муж/жена пришли из другой родовой ветки
        const par = o ? (o.family || []).filter((x) => x.rel === 'father' || x.rel === 'mother').map((x) => x.text || [x.surname, x.given, x.patronymic].filter(Boolean).join(' ')) : [];
        m.originParents = par.join('; '); m.originCollected = !!o;
      });
      cards.push({ centerId: r.id, center: people.get(r.id), members });
    });
    // 3. связи для GEDCOM
    const rel = {}; own.forEach((r) => { const f = r.family || []; const ids = (k) => [...new Set(f.filter((x) => x.rel === k && x.id !== r.id).map((x) => x.id))];
      rel[r.id] = { spouses: ids('spouses'), children: ids('children'), parents: ids('father').concat(ids('mother')) }; });
    const list = [...people.values()].map((p) => Object.assign({ notes: [] }, p, { spouses: (rel[p.id] || {}).spouses || [], children: (rel[p.id] || {}).children || [], parents: (rel[p.id] || {}).parents || [] }));
    list.forEach((p) => (p.parents || []).forEach((pid) => { const par = list.find((x) => x.id === pid); if (par && !par.children.includes(p.id)) par.children.push(p.id); }));
    const events = []; results.forEach((r) => { if (!r.hidden) (r.events || []).forEach((e) => events.push({ id: r.id, name: `${r.surname || ''} ${r.given || ''} ${r.patronymic || ''}`.trim(), text: e })); });
    return { people: list, cards, events };
  }

  const fio = (p) => [p.surname, p.given, p.patronymic].filter(Boolean).join(' ');
  function sheets(res) {
    const H1 = ['Карточка (центр)', 'Центр ID', 'Группа', 'Статус', 'Фамилия', 'Девичья / до смены', 'Имя', 'Отчество', 'Пол', 'Дата рождения', 'Место рождения', 'Дата смерти', 'Место смерти', 'Место жительства', 'ID', 'Из другой семьи', 'Родители (если страница собрана)', 'Ссылка'];
    const cards = [H1];
    res.cards.forEach((c) => {
      const cp = c.center || {}; cards.push([fio(cp), c.centerId, 'Центр', 'Персона', cp.surname, cp.maiden || cp.former || '', cp.given, cp.patronymic, cp.sex, cp.birthDate, cp.birthPlace, cp.deathDate, cp.deathPlace, cp.residence || '', c.centerId, '', '', cp.url]);
      ['Семья происхождения', 'Своя семья', 'Прочие'].forEach((g) => c.members.filter((m) => m.group === g).forEach((m) =>
        cards.push([fio(cp), c.centerId, g, m.statuses.join(' / '), m.surname, m.maiden || '', m.given, m.patronymic, m.sex, m.birthDate, m.birthPlace, m.deathDate, m.deathPlace, m.residence, m.id,
          m.fromOtherFamily ? 'да' : '', m.fromOtherFamily ? (m.originCollected ? m.originParents || '(родители не указаны)' : 'не собрано') : (m.originCollected ? m.originParents : ''), m.url])));
    });
    const H2 = ['ID', 'Фамилия', 'Девичья фамилия', 'Прежняя фамилия (мужчины)', 'Имя', 'Отчество', 'Пол', 'Дата рождения', 'Год рождения', 'Место рождения', 'Дата смерти', 'Место смерти', 'Место жительства', 'Страница собрана', 'Ссылка'];
    const people = [H2].concat(res.people.map((p) => [p.id, p.surname, p.maiden || '', p.former || '', p.given, p.patronymic, p.sex, p.birthDate, p.birthYear ? +p.birthYear : '', p.birthPlace, p.deathDate, p.deathPlace, p.residence || '', p.visited ? 'да' : 'нет', p.url]));
    const ev = [['Персона', 'ID', 'Событие']].concat(res.events.map((e) => [e.name, e.id, e.text]));
    return [{ name: 'Карточки семей', rows: cards }, { name: 'Люди', rows: people }].concat(res.events.length ? [{ name: 'События', rows: ev }] : []);
  }
  const api = { build, sheets };
  root.Family = api; if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
