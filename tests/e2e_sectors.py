# Проверка ручного указания секторов: имитация сайта, выбор мышью, разбор.  python3 tests/e2e_sectors.py
import json, sys
from playwright.sync_api import sync_playwright
ID='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; F='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; W='cccccccc-cccc-cccc-cccc-cccccccccccc'; C='dddddddd-dddd-dddd-dddd-dddddddddddd'
def page(tab):
    head='<header><nav><a href="/x">Меню</a><a href="/persons/%s">шапка</a></nav></header>'%C
    left='<div class="left"><img src="/media/ph.jpg"><div class="sum"><h1>Иванов (Жепанин) Пётр Иванович</h1><p>мужской, родился 1900</p></div></div>'
    tabs='<div class="tabs"><a>События</a><a>Родственники</a><a>Обсуждение<b>0</b></a></div>'
    if tab=='1':
        body='''<table class="fam"><thead><tr><th>статус</th><th>Фамилия Имя Отчество</th><th>Дата рождения</th><th>Место рождения</th><th>Дата смерти</th><th>Место смерти</th></tr></thead>
<tbody><tr><td>Отец</td><td><a href="/persons/%s">Иванов Фёдор Петрович</a></td><td>1870</td><td><a href="/places/1">Москва</a></td><td>1940</td><td>Тула</td></tr>
<tr><td>Жена</td><td><a href="/persons/%s">Иванова (Жегалова) Мария Федоровна</a></td><td>1902</td><td>Рязань</td><td></td><td></td></tr></tbody></table>'''%(F,W)
    elif tab=='0':
        body='<table class="ev"><thead><tr><th>Событие</th><th>Участники</th><th>Место</th><th>Комментарий</th></tr></thead><tbody><tr><td>Рождение</td><td>Иванов Пётр</td><td>Москва</td><td>запись 5</td></tr></tbody></table>'
    else: body=''
    return '<html><body>%s<main>%s<section>%s<div class="content">%s</div></section></main><footer>Политика конфиденциальности</footer></body></html>'%(head,left,tabs,body)
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1100,'height':800})
    def route(r):
        u=r.request.url
        if '/persons/' in u:
            tab=(u.split('tab=')[1] if 'tab=' in u else '0'); r.fulfill(body=page(tab),content_type='text/html; charset=utf-8')
        else: r.fulfill(status=404)
    pg.route('https://familio.org/**',route)
    pg.add_script_tag(path='extract.js'); 
    out={}
    def pick(tab,selector_loc,role,up=0):
        pg.goto('https://familio.org/persons/%s?tab=%s'%(ID,tab)); pg.add_script_tag(path='extract.js'); pg.add_script_tag(path='sectors.js')
        pg.evaluate("window.chrome={runtime:{sendMessage:(m)=>{window.__msg=m}}}; window.__msg=null")
        pg.evaluate("([r,t])=>Sectors.pickerInPage(r,t)",[role,role])
        bb=pg.locator(selector_loc).first.bounding_box(); pg.mouse.move(bb['x']+bb['width']/2,bb['y']+bb['height']/2); pg.mouse.move(bb['x']+bb['width']/2+1,bb['y']+bb['height']/2); [pg.keyboard.press('ArrowUp') for _ in range(up)]; pg.mouse.click(bb['x']+bb['width']/2+1,bb['y']+bb['height']/2)
        pg.wait_for_function("window.__msg!==null"); out[role]=pg.evaluate("window.__msg.spec")
    pick('0','.tabs a','sections',1); pick('0','h1','header'); pick('0','.sum h1','summary',1)
    pick('0','table.ev th','eventsCols',1); pick('1','table.fam th','relCols',1); pick('1','table.fam tbody td','family',2)
    print({k:(v['verified'],v['selector'],v['text'][:30],v['rawText'][:30]) for k,v in out.items()})
    assert all(v['verified'] for v in out.values()), 'не подтверждены'
    pg.goto('https://familio.org/persons/%s'%ID); pg.add_script_tag(path='extract.js'); pg.add_script_tag(path='sectors.js')
    r=pg.evaluate("""async(specs)=>{const g=async t=>new DOMParser().parseFromString(await (await fetch('/persons/%s?tab='+t)).text(),'text/html');
      const docs={'0':await g(0),'1':await g(1)}; return Sectors.extractPerson(docs,'https://familio.org/persons/%s',specs,Extract.DEFAULT_PROFILE)}"""%(ID,ID),out)
    print(json.dumps({k:r[k] for k in ('surname','maiden','former','given','patronymic','sex','birthDate','photo','hidden','warn','events')},ensure_ascii=False))
    print([ (f['rel'],f['surname'],f['maiden'],f['birthPlace'],f['birthPlaceUrl']) for f in r['family']])
    assert r['former']=='Жепанин' and r['sex']=='M' and r['birthYear']=='1900' and not r['hidden'] and not r['warn']
    assert [f['rel'] for f in r['family']]==['father','spouses'] and r['family'][1]['maiden']=='Жегалова' and r['events'] and 'Рождение' in r['events'][0]
    print('sectors e2e: OK')
