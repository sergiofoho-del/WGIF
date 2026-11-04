// GEDCOM: разбор, слияние данных Familio, запись. Без DOM и сети — проверяется в Node (tests/run.js).
// Метка времени изменения персоны (CHAN/DATE/TIME) обновляется при ЛЮБОЙ правке записи.
(function (root) {
  'use strict';
  const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

  function parse(text) {
    const recs = []; let cur = null;
    String(text).replace(/^﻿/, '').split(/\r\n|\n|\r/).forEach((raw) => {
      const m = raw.match(/^\s*(\d+)\s+(@[^@]+@\s+)?([^\s]+)(?:\s(.*))?$/);
      if (!m) return;
      const node = { level: +m[1], xref: m[2] ? m[2].trim() : null, tag: m[3], value: m[4] || '', kids: [] };
      if (node.level === 0) { cur = { root: node, stack: [node] }; recs.push(node); return; }
      if (!cur) return;
      while (cur.stack.length > node.level) cur.stack.pop();
      cur.stack[cur.stack.length - 1].kids.push(node); cur.stack[node.level] = node;
    });
    return recs;
  }
  function ser(n, out) {
    out.push(`${n.level}${n.xref ? ' ' + n.xref : ''} ${n.tag}${n.value ? ' ' + n.value : ''}`);
    n.kids.forEach((k) => { k.level = n.level + 1; ser(k, out); });
  }
  function serialize(recs) { const out = []; recs.forEach((r) => ser(r, out)); return out.join('\n') + '\n'; }
  const node = (tag, value, kids) => ({ level: 1, xref: null, tag, value: value || '', kids: kids || [] });
  const child = (n, tag) => n.kids.find((k) => k.tag === tag);

  function stamp(rec, now) {
    now = now || new Date();
    rec.kids = rec.kids.filter((k) => k.tag !== 'CHAN');
    const p = (x) => String(x).padStart(2, '0');
    rec.kids.push(node('CHAN', '', [node('DATE', `${p(now.getDate())} ${MON[now.getMonth()]} ${now.getFullYear()}`,
      [node('TIME', `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`)])]));
  }

  const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
  const yearOf = (s) => { const m = String(s || '').match(/\b(\d{4})\b/); return m ? m[1] : ''; };
  function indiInfo(r) {
    const names = r.kids.filter((k) => k.tag === 'NAME').map((nm) => { const mm = nm.value.match(/^(.*?)\s*\/(.*?)\/?\s*$/); return { given: norm(mm ? mm[1] : nm.value), sur: norm(mm ? mm[2] : '') }; });
    const b = child(r, 'BIRT'); const bd = b && child(b, 'DATE');
    return { names, by: yearOf(bd && bd.value) };
  }
  function personKey(p) { const g = norm([p.given, p.patronymic].filter(Boolean).join(' '));
    return { names: [p.surname, p.maiden].filter(Boolean).map((x) => ({ given: g, sur: norm(x) })), by: yearOf(p.birthYear || p.birthDate) }; }
  // совпадение по имени и по любой из фамилий (замужняя / девичья)
  function same(a, b) { return a.names.some((x) => b.names.some((y) => x.given === y.given && x.sur === y.sur)) && (!a.by || !b.by || a.by === b.by); }

  // Факты персоны Familio -> узлы INDI
  function facts(p) {
    const n = [];
    const name = [p.given, p.patronymic].filter(Boolean).join(' ');
    // «Иванова (Жегалова)»: основное имя — по девичьей фамилии (TYPE birth), второе — по фамилии в браке (TYPE married)
    const main = p.maiden || p.surname || '';
    n.push(node('NAME', `${name} /${main}/`, [p.given ? node('GIVN', name) : null, main ? node('SURN', main) : null, p.maiden ? node('TYPE', 'birth') : null].filter(Boolean)));
    if (p.maiden && p.surname) n.push(node('NAME', `${name} /${p.surname}/`, [node('GIVN', name), node('SURN', p.surname), node('TYPE', 'married')]));
    if (p.sex) n.push(node('SEX', p.sex));
    const ev = (tag, d, pl) => { if (d || pl) n.push(node(tag, '', [d ? node('DATE', d) : null, pl ? node('PLAC', pl) : null].filter(Boolean))); };
    ev('BIRT', p.birthDate || p.birthYear, p.birthPlace);
    ev('DEAT', p.deathDate, p.deathPlace);
    (p.notes || []).forEach((t) => n.push(node('NOTE', t)));
    if (p.url) n.push(node('SOUR', '', [node('PAGE', p.url)]));
    return n;
  }
  const SIMPLE = ['NAME', 'SEX', 'BIRT', 'DEAT'];

  // diff для подтверждения: что отличается у найденной персоны
  function diff(rec, p) {
    const out = [];
    facts(p).filter((f, i, arr) => SIMPLE.includes(f.tag) && arr.findIndex((q) => q.tag === f.tag) === i).forEach((f) => {
      if (f.tag === 'NAME') {   // имя совпало с любым из имён персоны (замужнее/девичье) — различия нет
        const info = indiInfo(rec), mine = personKey(p);
        if (info.names.length && mine.names.some((x) => info.names.some((y) => x.given === y.given && x.sur === y.sur))) return;
      }
      const old = child(rec, f.tag);
      const val = (x) => x.tag === 'BIRT' || x.tag === 'DEAT' ? [child(x, 'DATE'), child(x, 'PLAC')].map((k) => k ? k.value : '').join(' ').trim() : x.value;
      if (!old) out.push({ tag: f.tag, old: '', neu: val(f) });
      else if (norm(val(old)) !== norm(val(f))) out.push({ tag: f.tag, old: val(old), neu: val(f) });
    });
    return out;
  }

  // добавляет недостающие имена (девичья / в браке), если такого NAME у персоны ещё нет
  function addMissingNames(rec, p) {
    const have = indiInfo(rec).names; let n = 0;
    facts(p).filter((f) => f.tag === 'NAME').forEach((f) => {
      const mm = f.value.match(/^(.*?)\s*\/(.*?)\/?\s*$/); const k = { given: norm(mm ? mm[1] : f.value), sur: norm(mm ? mm[2] : '') };
      if (!have.some((y) => y.given === k.given && y.sur === k.sur)) { rec.kids.push(f); have.push(k); n++; }
    });
    return n;
  }
  // mode: 'replace' | 'append' | 'confirm' | 'new'; confirm(info) -> 'replace'|'append'|'skip' (Promise)
  async function merge(gedText, people, opt) {
    opt = opt || {}; const mode = opt.mode || 'append'; const now = opt.now || new Date();
    const recs = mode === 'new' ? parse('0 HEAD\n1 CHAR UTF-8\n0 TRLR') : parse(gedText);
    const head = recs.find((r) => r.tag === 'HEAD'); const trlr = recs.filter((r) => r.tag === 'TRLR');
    const body = recs.filter((r) => r.tag !== 'TRLR');
    const indis = body.filter((r) => r.tag === 'INDI'), fams = body.filter((r) => r.tag === 'FAM');
    let maxI = 0, maxF = 0;
    indis.forEach((r) => { const m = r.xref.match(/(\d+)/); if (m) maxI = Math.max(maxI, +m[1]); });
    fams.forEach((r) => { const m = r.xref.match(/(\d+)/); if (m) maxF = Math.max(maxF, +m[1]); });
    const stats = { added: 0, replaced: 0, appended: 0, skipped: 0 };
    const byId = {}; // id Familio -> xref
    for (const p of people) {
      const key = personKey(p);
      const found = mode === 'new' ? null : indis.find((r) => same(indiInfo(r), key));
      if (!found) {
        const r = { level: 0, xref: `@I${++maxI}@`, tag: 'INDI', value: '', kids: facts(p) };
        stamp(r, now); body.push(r); indis.push(r); byId[p.id] = r.xref; stats.added++; continue;
      }
      byId[p.id] = found.xref;
      let act = mode;
      if (mode === 'confirm') { const d = diff(found, p); act = d.length ? await opt.confirm({ xref: found.xref, person: p, diff: d }) : 'skip'; }
      if (act === 'skip') { stats.skipped++; continue; }
      const d = diff(found, p);
      const addedNames = addMissingNames(found, p);
      if (!d.length) { if (addedNames) { stamp(found, now); stats.appended++; } else stats.skipped++; continue; }
      if (act === 'replace') {
        d.forEach((x) => { found.kids = found.kids.filter((k) => k.tag !== x.tag); });
        facts(p).filter((f) => d.some((x) => x.tag === f.tag)).forEach((f) => found.kids.push(f)); stats.replaced++;
      } else {
        d.forEach((x) => { const f = facts(p).find((q) => q.tag === x.tag);
          const cur = child(found, x.tag);
          if (!cur) found.kids.push(f);
          else if (x.tag === 'BIRT' || x.tag === 'DEAT') {
            // дополняем пустые подполя (DATE/PLAC); отличающееся значение — в примечание
            f.kids.forEach((sub) => { const o = child(cur, sub.tag);
              if (!o) cur.kids.push(sub);
              else if (norm(o.value) !== norm(sub.value)) found.kids.push(node('NOTE', `Familio: ${x.tag} ${sub.tag} — ${sub.value}`)); });
          } else found.kids.push(node('NOTE', `Familio: ${x.tag} — ${x.neu}`)); });
        stats.appended++;
      }
      stamp(found, now);
    }
    // семьи
    const hasFam = (a, b) => fams.some((f) => { const h = child(f, 'HUSB'), w = child(f, 'WIFE'); const s = [h && h.value, w && w.value]; return s.includes(a) && s.includes(b); });
    const famOf = {};
    const pairKey = (a, b) => [a, b].sort().join('|');
    const sexOf = {}; people.forEach((p) => { sexOf[p.id] = p.sex; });
    people.forEach((p) => (p.spouses || []).forEach((sid) => {
      const a = byId[p.id], b = byId[sid]; if (!a || !b) return;
      const k = pairKey(a, b); if (famOf[k] || hasFam(a, b)) return;
      const male = sexOf[p.id] === 'M' || sexOf[sid] === 'F';
      const f = { level: 0, xref: `@F${++maxF}@`, tag: 'FAM', value: '', kids: [node('HUSB', male ? a : b), node('WIFE', male ? b : a)] };
      stamp(f, now); body.push(f); fams.push(f); famOf[k] = f;
      [a, b].forEach((x) => { const r = indis.find((i) => i.xref === x); r.kids.push(node('FAMS', f.xref)); stamp(r, now); });
    }));
    people.forEach((p) => (p.children || []).forEach((cid) => {
      const c = byId[cid]; if (!c) return;
      const parents = [byId[p.id]].concat((p.spouses || []).map((s) => byId[s])).filter(Boolean);
      let fam = fams.find((f) => { const h = child(f, 'HUSB'), w = child(f, 'WIFE'); return [h && h.value, w && w.value].includes(byId[p.id]); });
      if (!fam) { fam = { level: 0, xref: `@F${++maxF}@`, tag: 'FAM', value: '', kids: [node(sexOf[p.id] === 'F' ? 'WIFE' : 'HUSB', byId[p.id])] };
        body.push(fam); fams.push(fam); const r = indis.find((i) => i.xref === byId[p.id]); r.kids.push(node('FAMS', fam.xref)); stamp(r, now); }
      if (!fam.kids.some((k) => k.tag === 'CHIL' && k.value === c)) {
        fam.kids.push(node('CHIL', c)); stamp(fam, now);
        const r = indis.find((i) => i.xref === c); if (!r.kids.some((k) => k.tag === 'FAMC' && k.value === fam.xref)) { r.kids.push(node('FAMC', fam.xref)); stamp(r, now); }
      }
    }));
    return { text: serialize(body.concat(trlr.length ? trlr : [{ level: 0, xref: null, tag: 'TRLR', value: '', kids: [] }])), stats };
  }

  const api = { parse, serialize, merge, stamp, diff, personKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Gedcom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
