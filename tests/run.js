const G = require('../gedcom.js'); const assert = require('assert');
const ged = `0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Иван Петрович /Ладыгин/\n1 SEX M\n1 BIRT\n2 DATE 1850\n1 CHAN\n2 DATE 01 JAN 2000\n3 TIME 00:00:00\n0 TRLR\n`;
const now = new Date(2026, 10, 2, 5, 51, 7);
const P = [
  { id: 'a', given: 'Иван', patronymic: 'Петрович', surname: 'Ладыгин', sex: 'M', birthYear: '1850', birthPlace: 'Москва', spouses: ['b'], children: ['c'] },
  { id: 'b', given: 'Мария', surname: 'Ладыгина', sex: 'F', birthYear: '1855', spouses: ['a'] },
  { id: 'c', given: 'Пётр', surname: 'Ладыгин', sex: 'M', birthYear: '1880' }];
(async () => {
  let r = await G.merge(ged, P, { mode: 'append', now });
  assert.deepStrictEqual(r.stats, { added: 2, replaced: 0, appended: 1, skipped: 0 });
  assert(r.text.includes('2 PLAC Москва') && r.text.includes('1 FAMS @F1@') && r.text.includes('1 CHIL @I3@'));
  assert(r.text.includes('2 DATE 02 NOV 2026') && r.text.includes('3 TIME 05:51:07') && !r.text.includes('01 JAN 2000'));
  r = await G.merge(ged, [{ id: 'a', given: 'Иван', patronymic: 'Петрович', surname: 'Ладыгин', sex: 'M', birthYear: '1850', birthPlace: 'Тула' }], { mode: 'replace', now });
  assert(r.stats.replaced === 1 && r.text.includes('Тула'));
  let asked = 0; r = await G.merge(ged, P.slice(0, 1), { mode: 'confirm', now, confirm: async () => { asked++; return 'skip'; } });
  assert(asked === 1 && r.stats.skipped === 1 && !r.text.includes('Москва'));
  r = await G.merge('', P, { mode: 'new', now }); assert(r.stats.added === 3 && r.text.startsWith('0 HEAD'));
    // девичья фамилия: существующая персона записана по мужу, найти по девичьей и добавить второе имя
  const g2 = `0 HEAD\n0 @I1@ INDI\n1 NAME Мария Федоровна /Иванова/\n1 SEX F\n1 BIRT\n2 DATE 1900\n0 TRLR\n`;
  r = await G.merge(g2, [{ id: 'z', given: 'Мария', patronymic: 'Федоровна', surname: 'Иванова', maiden: 'Жегалова', sex: 'F', birthYear: '1900' }], { mode: 'append', now });
  assert(r.stats.added === 0 && r.text.includes('/Жегалова/') && r.text.includes('2 TYPE birth') && r.text.includes('3 TIME 05:51:07'), r.text);
  r = await G.merge('', [{ id: 'z', given: 'Мария', patronymic: 'Федоровна', surname: 'Иванова', maiden: 'Жегалова', sex: 'F' }], { mode: 'new', now });
  assert(r.text.includes('1 NAME Мария Федоровна /Жегалова/') && r.text.includes('1 NAME Мария Федоровна /Иванова/') && r.text.includes('2 TYPE married'));
  r = await G.merge('', [{ id: 'm', given: 'Петр', patronymic: 'Иванович', surname: 'Иванов', former: 'Жепанин', sex: 'M' }], { mode: 'new', now });
  assert(r.text.includes('1 NAME Петр Иванович /Иванов/') && r.text.includes('1 NAME Петр Иванович /Жепанин/') && r.text.includes('2 TYPE aka'));
  console.log('gedcom: OK');
})().catch((e) => { console.error(e); process.exit(1); });
require('../xlsx.js'); (async () => {
  const b = globalThis.Xlsx.build([{ name: 'Люди', rows: [['Имя', 'Год'], ['Иван', 1850]] }]);
  require('fs').writeFileSync(process.env.TMPDIR ? process.env.TMPDIR + '/t.xlsx' : '/tmp/t.xlsx', Buffer.from(await b.arrayBuffer())); console.log('xlsx written');
})();
const E = require('../extract.js'); const assert2 = require('assert');
const pp = { sex: 'M', fatherUrl: ['f'], motherUrl: ['m'], spousesUrl: ['s'], childrenUrl: ['c'], parentsUrl: [] };
assert2.deepStrictEqual(E.expand(pp, 'up', { maleOnly: true, sec: {} }), [['f', 'up'], ['s', 'side']]);
assert2.deepStrictEqual(E.expand(pp, 'up', { sec: {} }).map((x) => x[0]), ['f', 'm', 's']);
assert2.deepStrictEqual(E.expand({ ...pp, sex: 'F' }, 'down', { maleOnly: true, sec: {} }), [['s', 'side']]);
assert2.deepStrictEqual(E.expand(pp, 'self', { sec: {} }), []);
console.log('expand: OK');
const pn = E.parseName('Иванова (Жегалова) Мария Федоровна');
assert2.deepStrictEqual(pn, { surname: 'Иванова', maiden: 'Жегалова', given: 'Мария', patronymic: 'Федоровна' });
assert2.deepStrictEqual(E.parseName('Старкина Анастасия Федоровна'), { surname: 'Старкина', maiden: '', given: 'Анастасия', patronymic: 'Федоровна' });
console.log('names: OK');
