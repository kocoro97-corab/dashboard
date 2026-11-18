"""Owner-reported sector follow-up: toolbar, common dates, US equities and KST.
Synthetic authentication only. Public issuer membership is never owner holdings.
"""
import argparse,asyncio,json,re,sys,tempfile,time
from datetime import datetime,timezone
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from build_dev_pages import build
from public_integration_support import Harness,synthetic_feeds,history_url,ENDPOINT,US_STOCKS
p=argparse.ArgumentParser();p.add_argument('--widths',type=int,nargs='+',default=[1440,690,344]);p.add_argument('--output',type=Path,default=Path('/tmp/sector-followup'));p.add_argument('--published',action='store_true');p.add_argument('--public-feeds',type=Path);args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True);results=[]
UNIVERSE=json.loads((ROOT/'data/us-theme-instruments.json').read_text());THEME_COUNT=len(UNIVERSE['themes']);MAX_MEMBERS=max(len(t['instruments']) for t in UNIVERSE['themes'])
async def check(h,name,fn):
 try:await fn();row={'test':name,'width':h.width,'status':'PASS'}
 except Exception as e:
  row={'test':name,'width':h.width,'status':'FAIL','reason':(str(e).splitlines() or [type(e).__name__])[0][:250]};await h.page.screenshot(path=str(args.output/(str(h.width)+'-'+name+'-FAIL.png')))
 results.append(row);print(json.dumps(row),flush=True)
async def region(h,target):
 other='미국' if target=='KR' else '한국';b=h.page.get_by_role('button',name='시장 전환: 현재 '+other,exact=True)
 if await b.count():await b.click()
async def settled(h,n=5):await h.page.wait_for_function('(n)=>document.querySelector(".stv2")?.textContent.includes("기간 "+n+"거래일")',arg=n)
async def features(browser,artifact,tmp,width):
 feeds=synthetic_feeds();d=json.loads(feeds[history_url('^KS11')]);d['chart']['result'][0]['indicators']['quote'][0]['close'][-1]=None;feeds[history_url('^KS11')]=json.dumps(d)
 h=await Harness(browser,artifact,feeds,width,args.published).start_browser(tmp)
 try:
  await h.page.clock.set_fixed_time('2026-11-17T03:00:00Z');await h.login('sectors');await h.page.wait_for_function('()=>!THM_BUSY&&THM.length>0')
  async def toolbar():
   assert await h.page.locator('.stv2-region').count()==1;assert await h.page.get_by_role('button',name='5일',exact=True).count()==0
   heading=await h.page.locator('.stv2-heading h2').bounding_box();refresh=await h.page.get_by_role('button',name='테마 데이터 새로고침',exact=True).bounding_box();assert refresh['x']>heading['x'];assert abs(refresh['y']-heading['y'])<20
   await h.page.get_by_role('button',name='스윙',exact=True).click();assert await h.page.get_by_role('button',name='5일',exact=True).get_attribute('aria-pressed')=='true';await h.page.get_by_role('button',name='20일',exact=True).click();await h.page.get_by_role('button',name='단타',exact=True).click();assert await h.page.get_by_role('button',name='60일',exact=True).count()==0;await h.page.get_by_role('button',name='스윙',exact=True).click();assert await h.page.get_by_role('button',name='5일',exact=True).get_attribute('aria-pressed')=='true';assert await h.page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  await check(h,'COMPACT_TOOLBAR_AND_SWING_DEFAULT_5_DAYS',toolbar)
  async def common_dates():
   for days in [5,20,60]:
    await h.page.get_by_role('button',name=str(days)+'일',exact=True).click();await settled(h,days);rows=await h.page.locator('.stv2 table').first.locator('tr').all();assert len(rows)==3
    # Stock latest close is 199; benchmark latest close was removed, so both
    # use the previous common observation (stock 198, index 298).
    expected=(198/(198-days)-1)*100;base=(298/(298-days)-1)*100
    for row in rows[1:]:
     cells=await row.locator('td').all_text_contents();assert abs(float(cells[1].replace('%',''))-expected)<.011;assert abs(float(cells[2].replace('%',''))-(expected-base))<.011
   assert 'DATE_MISMATCH' not in await h.page.locator('.stv2').text_content();assert '공통 관측일' in await h.page.locator('.stv2').inner_text();await h.page.screenshot(path=str(args.output/(str(width)+'-kr-shared-date.png')))
  await check(h,'NULL_LATEST_INDEX_CLOSE_USES_REAL_COMMON_DATES',common_dates)
  async def us_equities():
   await region(h,'US');await h.page.get_by_role('button',name='단타',exact=True).click();await settled(h,1);assert await h.page.locator('.stv2-us-themes .stv2-card').count()==THEME_COUNT;assert not await h.page.locator('.stv2-etfs').get_attribute('open')
   assert '일반종목 표본' in await h.page.locator('.stv2').inner_text();assert '구성 기준 2026-11-17' in await h.page.locator('.stv2-us-themes').inner_text()
   await h.page.locator('.stv2-us-themes .stv2-card').first.click();assert await h.page.locator('.stv2-us-members tr').count()==MAX_MEMBERS+1;cells=await h.page.locator('.stv2-us-members tr').nth(1).locator('td').all_text_contents();assert not any('('+s+')' in cells[0] for s in ['XLK','XLV','SPY']);assert abs(float(cells[1].replace('%',''))-(199/198-1)*100)<.011
   symbol=next(x for x in US_STOCKS if x in cells[0].split());await h.page.locator('.stv2-us-members').get_by_role('button',name='종목분석',exact=True).first.click();await h.page.wait_for_selector('#stockSearch');assert await h.page.locator('#stockSearch').input_value()==symbol;await h.go('sectors');await region(h,'US')
   for days in [5,20,60]:
    if days==5:await h.page.get_by_role('button',name='스윙',exact=True).click()
    await h.page.get_by_role('button',name=str(days)+'일',exact=True).click();await settled(h,days);assert await h.page.locator('.stv2-us-themes .stv2-card').count()==THEME_COUNT;expected=(199/(199-days)-1)*100
    for card in await h.page.locator('.stv2-us-themes .stv2-card').all():assert ('수익률 +'+format(expected,'.2f')+'%') in await card.inner_text()
   await h.page.screenshot(path=str(args.output/(str(width)+'-us-equity-themes.png')))
  await check(h,'FIVE_US_THEMES_REAL_EQUITY_MEMBERS_AND_STOCK_LINK',us_equities)
  async def bad_identity():
   bad=json.loads(feeds[history_url('TSLA')]);bad['chart']['result'][0]['meta']['instrumentType']='ETF';h.overrides[history_url('TSLA')]={'text':json.dumps(bad)};await h.page.get_by_role('button',name='테마 데이터 새로고침',exact=True).click();await h.page.wait_for_function('()=>document.querySelector(".stv2")?.textContent.includes("TSLA (SERIES_UNAVAILABLE)")');assert '확인 '+str(MAX_MEMBERS-1)+'/'+str(MAX_MEMBERS)+'종목' in await h.page.locator('.stv2-us-themes').inner_text()
   assert await h.page.locator('.stv2-status:not([open])').count()>0
  await check(h,'ETF_RESPONSE_REJECTED_FOR_GENERAL_STOCK_MEMBER',bad_identity)
  async def cleanup():
   await h.page.evaluate('MYInvestCalendar.open()');assert await h.page.get_by_role('dialog',name='투자 일정 캘린더',exact=True).count()==1;await h.page.evaluate('logout()');await h.page.wait_for_function('()=>DashboardShell.getStatus().page===null');assert await h.page.locator('.stv2').count()==0;assert await h.page.get_by_role('dialog').count()==0;assert not h.errors;assert not any(r['action'] in ['nhAccounts','nhQuotes','order','saveExternalHoldings','restoreExternalHoldings'] for r in h.requests)
  await check(h,'LOGOUT_CLEARS_THEME_UI_WITH_ZERO_PRIVATE_WRITES',cleanup)
 finally:await h.close()
async def boundaries(browser,artifact,tmp):
 for stamp,initial,target in [('2026-11-17T21:59:58Z','US','KR'),('2026-11-17T11:59:58Z','KR','US')]:
  h=await Harness(browser,artifact,synthetic_feeds(),1440).start_browser(tmp)
  try:
   await h.page.clock.install(time=stamp);await h.login('sectors')
   async def boundary():
    label='한국' if initial=='KR' else '미국';assert await h.page.get_by_role('button',name='시장 전환: 현재 '+label,exact=True).count()==1;await h.page.clock.fast_forward(3000)
    wanted='한국' if target=='KR' else '미국';assert await h.page.get_by_role('button',name='시장 전환: 현재 '+wanted,exact=True).count()==1
    await region(h,initial);await h.page.clock.fast_forward(61000);assert await h.page.get_by_role('button',name='시장 전환: 현재 '+label,exact=True).count()==1;await h.go('news');await h.go('sectors');assert await h.page.get_by_role('button',name='시장 전환: 현재 '+wanted,exact=True).count()==1;assert await h.page.get_by_role('button',name='단타',exact=True).get_attribute('aria-pressed')=='true';assert await h.page.get_by_role('button',name='5일',exact=True).count()==0
   await check(h,'KST_BOUNDARY_'+initial+'_TO_'+target+'_MANUAL_OVERRIDE_REENTRY',boundary)
  finally:await h.close()
def observed_prices(feeds,symbol):
 d=json.loads(feeds[history_url(symbol)])['chart']['result'][0];regular=d['meta'].get('currentTradingPeriod',{}).get('regular',{});active=datetime.fromtimestamp(regular['start'],timezone.utc).date() if regular.get('end',0)>time.time() else None
 return {datetime.fromtimestamp(t,timezone.utc).date():v for t,v in zip(d['timestamp'],d['indicators']['quote'][0]['close']) if isinstance(v,(int,float)) and v>0 and datetime.fromtimestamp(t,timezone.utc).date()!=active}
async def public_equities(browser,artifact,tmp,width):
 feeds=synthetic_feeds();feeds.update(json.loads(args.public_feeds.read_text()));universe=json.loads((ROOT/'data/us-theme-instruments.json').read_text());h=await Harness(browser,artifact,feeds,width,args.published).start_browser(tmp)
 try:
  await h.login('sectors');await region(h,'US');await h.page.get_by_role('button',name='단타',exact=True).click()
  async def actual_themes():
   benchmark=observed_prices(feeds,'SPY')
   for n in [1,5,20,60]:
    if n==5:await h.page.get_by_role('button',name='스윙',exact=True).click()
    if n>1:await h.page.get_by_role('button',name=str(n)+'일',exact=True).click()
    await settled(h,n);dates=list(benchmark)[-n-1:];base=(benchmark[dates[-1]]/benchmark[dates[0]]-1)*100
    cards=await h.page.locator('.stv2-us-themes .stv2-card').all();assert len(cards)==len(universe['themes'])
    for t in universe['themes']:
     expected=[]
     for stock in t['instruments']:
      values=observed_prices(feeds,stock['symbol'])
      if all(day in values for day in dates):expected.append((values[dates[-1]]/values[dates[0]]-1)*100)
     card=h.page.locator('.stv2-us-themes .stv2-card').filter(has=h.page.locator('strong',has_text=t['name']));text=await card.inner_text();numbers=re.search(r'표본 수익률 ([+-]?[\d.]+)% · SPY 대비 ([+-]?[\d.]+)%',text);value=sum(expected)/len(expected);assert abs(float(numbers[1])-value)<.011,(t['id'],n,numbers[1],value);assert abs(float(numbers[2])-(value-base))<.011
    if n==1:
     await cards[0].click();assert await h.page.locator('.stv2-us-members tr').count()>=3;assert await h.page.locator('.stv2-us-members').get_by_role('button',name='종목분석',exact=True).count()>=2;await h.page.screenshot(path=str(args.output/(str(width)+'-actual-general-stocks.png')));await h.page.get_by_role('button',name='← 테마 순위로',exact=True).click()
   assert await h.page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');assert not h.errors;await h.page.screenshot(path=str(args.output/(str(width)+'-actual-us-themes.png')))
  await check(h,'PUBLIC_5_THEMES_19_UNIQUE_EQUITIES_COMMON_DATE_RETURN_ORACLE',actual_themes)
 finally:await h.close()
async def main():
 with tempfile.TemporaryDirectory() as tmp:
  artifact=Path(tmp)/'public';build(artifact,relay_endpoint=ENDPOINT)
  async with async_playwright() as pw:
   browser=await pw.chromium.launch(headless=True)
   try:
    for width in args.widths:
     if args.public_feeds:await public_equities(browser,artifact,tmp,width)
     else:await features(browser,artifact,tmp,width)
    if not args.published and not args.public_feeds:await boundaries(browser,artifact,tmp)
   finally:await browser.close()
 args.output.joinpath('results.json').write_text(json.dumps(results,indent=2));print(json.dumps({'passed':sum(r['status']=='PASS' for r in results),'failed':sum(r['status']=='FAIL' for r in results),'scope':'PUBLIC_RESPONSE_REPLAY_SYNTHETIC_AUTH' if args.public_feeds else 'SYNTHETIC_AUTH_AND_PRICES_PUBLIC_ISSUER_MEMBERSHIP','published':args.published}));return int(any(r['status']=='FAIL' for r in results))
raise SystemExit(asyncio.run(main()))
