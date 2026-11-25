"""Time/zoom/sector integration: real Chromium, isolated synthetic authentication.
--public-feeds replays captured public provider payloads; never claims live GAS auth.
"""
import argparse,asyncio,json,math,re,sys,tempfile,time
from pathlib import Path
from datetime import datetime,timezone
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from build_dev_pages import build
from public_integration_support import Harness,synthetic_feeds,history,history_url,ETF,BASE,LIST
p=argparse.ArgumentParser();p.add_argument('--widths',type=int,nargs='+',default=[1440,690,344]);p.add_argument('--public-feeds',type=Path);p.add_argument('--published',action='store_true');p.add_argument('--only',choices=['all','clock','chart','sectors'],default='all');p.add_argument('--output',type=Path,default=Path('/tmp/integration-958'));args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
MODE='CAPTURED_PUBLIC_DATA_SYNTHETIC_AUTH' if args.public_feeds else 'SYNTHETIC_ONLY';feeds=synthetic_feeds()
if args.public_feeds:feeds.update(json.loads(args.public_feeds.read_text()))
results=[];timings=[]
async def case(h,name,fn):
 start=time.perf_counter()
 try:await fn();row={'width':h.width,'test':name,'status':'PASS','mode':MODE,'publishedAssets':args.published}
 except Exception as e:
  row={'width':h.width,'test':name,'status':'FAIL','reason':(str(e).splitlines() or [type(e).__name__])[0][:240],'mode':MODE,'publishedAssets':args.published}
  await h.page.screenshot(path=str(args.output/(str(h.width)+'-'+name+'-FAIL.png')))
 row['faultInjection']=name in ['INSUFFICIENT_BARS_AND_MA20_DISCLOSURE','MODAL_OBSERVER_LISTENER_AND_LATE_RESPONSE_CLEANUP','API_FAILURE_IS_SEPARATE_FROM_VALID_ROWS','RAPID_SELECTION_AND_NAVIGATION_DURING_LOAD'];row['elapsedMs']=round((time.perf_counter()-start)*1000);results.append(row);print(json.dumps(row),flush=True)
async def count(page):
 text=await page.locator('.miv-chart-panel > .miv-controls span').inner_text();a,b=map(int,re.search(r'표시 (\d+) / 수신 (\d+)봉',text).groups());return a,b
async def settle_frames(page):await page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
async def open_chart(h):
 b=h.page.locator('.miv-top .miv-controls button').first
 if not (await b.inner_text()).startswith('미국장 표시'):await b.click()
 await h.page.locator('.miv-indicator').filter(has=h.page.locator('strong',has_text='S&P 500')).first.click();await h.page.wait_for_selector('.miv-graph canvas');await settle_frames(h.page)
async def close_chart(h):await h.page.locator('.miv-overlay button',has_text='닫기').click()
def oracle_bars(interval,period):
 d=json.loads(feeds[history_url('^GSPC',interval,period)])['chart']['result'][0];q=d['indicators']['quote'][0];bars=[]
 for i,t in enumerate(d['timestamp']):
  try:row={k:q[k][i] for k in ['open','high','low','close']}
  except (IndexError,KeyError):continue
  if not all(isinstance(v,(int,float)) and v>0 for v in row.values()):continue
  bars.append({'t':t,'c':row['close'],'l':row['low'],'h':row['high']})
 if period=='max':
  grouped={}
  for b in bars:
   key=datetime.fromtimestamp(b['t'],timezone.utc).year
   if key not in grouped:grouped[key]=dict(b)
   else:grouped[key].update(c=b['c'],l=min(grouped[key]['l'],b['l']),h=max(grouped[key]['h'],b['h']))
  bars=list(grouped.values())
 return bars
async def assert_ma(h,interval='1d',period='3mo'):
 visible,total=await count(h.page);bars=oracle_bars(interval,period);assert total==len(bars),(total,len(bars));shown=bars[-visible:];low=min(b['l'] for b in shown);high=max(b['h'] for b in shown);span=max(.0001,high-low);trace=await h.page.evaluate('window.__chartTrace')
 for n,color in [(5,'#f5b942'),(20,'#b494f5')]:
  points=trace.get(color) or []
  if total<n:assert not points;continue
  expected=sum(b['c'] for b in bars[-n:])/n;expected_y=55+(high-expected)/span*265;assert points and abs(points[-1][1]-expected_y)<1e-6,(n,points[-1] if points else None,expected_y)
async def clock_checks(browser,artifact,tmp,width):
 for label,stamp,before,after in [('MORNING','2026-11-16T21:59:59Z','미국장','한국장'),('EVENING','2026-11-17T11:59:59Z','한국장','미국장')]:
  h=await Harness(browser,artifact,synthetic_feeds(),width,args.published).start_browser(tmp)
  try:
   await h.page.clock.install(time=stamp);prefs={'KR':['^SOX','^KS11','^KQ11','k3','KRW=X','^IXIC'],'US':['^VIX','^GSPC','^IXIC','NQ=F','^SOX','KRW=X']};await h.ctx.add_init_script('localStorage.setItem("myinvest_market_priority_v2",'+json.dumps(json.dumps(prefs))+')');await h.login()
   async def boundary():
    assert (await h.page.locator('.miv-top .miv-controls button').first.inner_text()).startswith(before+' 표시');await h.page.clock.run_for(1100);assert (await h.page.locator('.miv-top .miv-controls button').first.inner_text()).startswith(after+' 표시')
   await case(h,'KST_'+label+'_EXACT_BOUNDARY',boundary)
   async def manual():
    await h.page.locator('.miv-top .miv-controls button').first.click();text=await h.page.locator('.miv-top .miv-controls button').first.inner_text();await h.page.clock.run_for(61000);assert await h.page.locator('.miv-top .miv-controls button').first.inner_text()==text;await h.go('sectors');await h.go('market');assert (await h.page.locator('.miv-top .miv-controls button').first.inner_text()).startswith(after+' 표시');assert await h.page.evaluate('JSON.parse(localStorage.getItem("myinvest_market_priority_v2"))')==prefs
   await case(h,'KST_'+label+'_MANUAL_VISIT_SCOPE_AND_PRIORITIES',manual)
  finally:await h.close()
async def chart_checks(browser,artifact,tmp,width):
 h=await Harness(browser,artifact,feeds,width,args.published).start_browser(tmp)
 try:
  start=time.perf_counter();await h.login();first=round((time.perf_counter()-start)*1000);baseline=await h.page.evaluate('({listeners:__resizeListeners.size,observers:__activeRO})');await open_chart(h)
  async def controls():
   a,total=await count(h.page);await h.page.get_by_role('button',name='+ 확대',exact=True).click();b,_=await count(h.page);assert b<a;await h.page.get_by_role('button',name='− 축소',exact=True).click();c,_=await count(h.page);assert c>b
   slider=h.page.get_by_label('차트 표시 봉 수',exact=True);box=await slider.bounding_box();await slider.click(position={'x':box['width']*.4,'y':box['height']/2});assert (await count(h.page))[0]==int(await slider.input_value());await assert_ma(h);await h.page.get_by_role('button',name='전체 보기',exact=True).click();assert (await count(h.page))[0]==total
  await case(h,'CHART_BUTTONS_SLIDER_FULL_AND_MA',controls)
  async def wheel_pinch():
   canvas=h.page.locator('.miv-graph canvas');box=await canvas.bounding_box();cx=box['x']+box['width']/2;cy=box['y']+box['height']/2;a,_=await count(h.page);await h.page.mouse.move(cx,cy);await h.page.keyboard.down('Control');await h.page.mouse.wheel(0,-120);await h.page.keyboard.up('Control');await settle_frames(h.page);b,_=await count(h.page);assert b<a
   cdp=await h.ctx.new_cdp_session(h.page)
   points=lambda d:[{'x':cx-d,'y':cy,'id':1},{'x':cx+d,'y':cy,'id':2}]
   await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':points(25)});await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':points(60)});await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});await settle_frames(h.page);assert (await count(h.page))[0]<b;await cdp.detach()
  await case(h,'CTRL_WHEEL_AND_TWO_FINGER_PINCH',wheel_pinch)
  async def viewport():
   await h.page.get_by_role('button',name='전체 보기',exact=True).click();await h.page.get_by_role('button',name='+ 확대',exact=True).click();before,_=await count(h.page);await h.page.set_viewport_size({'width':max(300,round(width*.7)) if width>344 else 550,'height':1000});await settle_frames(h.page);after,_=await count(h.page);assert after!=before,("canvas-resize",before,after)
   cdp=await h.ctx.new_cdp_session(h.page);a,_=await count(h.page);await cdp.send('Emulation.setPageScaleFactor',{'pageScaleFactor':1.5});await settle_frames(h.page);b,_=await count(h.page);assert b<a,("viewport-scale",a,b);await cdp.send('Emulation.setPageScaleFactor',{'pageScaleFactor':1});await h.page.set_viewport_size({'width':width,'height':1000});await settle_frames(h.page);await cdp.detach()
   # Manual controls remain usable after automatic viewport updates.
   a,_=await count(h.page);await h.page.get_by_role('button',name='+ 확대',exact=True).click();assert (await count(h.page))[0]<a
  await case(h,'VIEWPORT_SIZE_AND_BROWSER_SCALE_COUPLING',viewport)
  async def periods():
   for name,interval,period in [('주','1wk','2y'),('월','1mo','5y'),('년','1mo','max'),('일','1d','3mo')]:
    await h.page.locator('.miv-chart-panel > .miv-controls').first.get_by_role('button',name=name,exact=True).click();await h.page.wait_for_selector('.miv-graph canvas');await settle_frames(h.page);await assert_ma(h,interval,period);a,total=await count(h.page);await h.page.get_by_role('button',name='+ 확대',exact=True).click();assert (await count(h.page))[0]<a;await h.page.get_by_role('button',name='전체 보기',exact=True).click();assert (await count(h.page))[0]==total
   await h.page.screenshot(path=str(args.output/(str(width)+'-chart.png')))
  await case(h,'PERIODS_ANNUAL_AGGREGATION_AND_MA',periods)
  async def cleanup():
   await close_chart(h);assert await h.page.evaluate('({listeners:__resizeListeners.size,observers:__activeRO})')==baseline
   url=history_url('^GSPC','1d','3mo');h.overrides[url]={'text':json.dumps(history('^GSPC')),'delayMs':500};await h.page.locator('.miv-indicator').filter(has=h.page.locator('strong',has_text='S&P 500')).first.click();await close_chart(h);await h.page.wait_for_timeout(550);assert await h.page.locator('.miv-overlay').count()==0;assert await h.page.evaluate('({listeners:__resizeListeners.size,observers:__activeRO})')==baseline
  await case(h,'MODAL_OBSERVER_LISTENER_AND_LATE_RESPONSE_CLEANUP',cleanup)
  async def insufficient():
   url=history_url('^GSPC','1d','3mo');h.overrides[url]={'text':json.dumps(history('^GSPC',count=1))};await open_chart_without_canvas(h);assert await h.page.locator('.miv-graph canvas').count()==0;assert '수신 실패' in await h.page.locator('.miv-graph').inner_text();await close_chart(h)
   h.overrides[url]={'text':json.dumps(history('^GSPC',count=10))};await open_chart(h);assert 'MA20 표본 부족' in await h.page.locator('.miv-chart-panel').inner_text();await close_chart(h)
  await case(h,'INSUFFICIENT_BARS_AND_MA20_DISCLOSURE',insufficient)
  timings.append({'area':'market','width':width,'mode':MODE,'firstDisplayMs':first,'firstFrameMs':h.first_frame_ms,'initialDataMs':h.initial_data_ms,'initialRenderSettleMs':h.initial_render_ms,'requestCount':len(h.requests),'lastResponseMs':max((r.get('endMs',0) for r in h.requests),default=0)})
 finally:await h.close()
async def open_chart_without_canvas(h):
 await h.page.locator('.miv-indicator').filter(has=h.page.locator('strong',has_text='S&P 500')).first.click();await h.page.wait_for_function('()=>document.querySelector(".miv-graph")?.textContent.includes("수신 실패")')
def returns(symbol,n,benchmark=None):
 d=json.loads(feeds[history_url(symbol)])['chart']['result'][0];regular=d['meta'].get('currentTradingPeriod',{}).get('regular',{});active=datetime.fromtimestamp(regular['start'],timezone.utc).date() if regular.get('end',0)>time.time() else None
 values={datetime.fromtimestamp(t,timezone.utc).date():v for t,v in zip(d['timestamp'],d['indicators']['quote'][0]['close']) if isinstance(v,(int,float)) and v>0 and datetime.fromtimestamp(t,timezone.utc).date()!=active}
 if benchmark:
  b=json.loads(feeds[history_url(benchmark)])['chart']['result'][0];dates=[datetime.fromtimestamp(t,timezone.utc).date() for t,v in zip(b['timestamp'],b['indicators']['quote'][0]['close']) if isinstance(v,(int,float)) and v>0][-n-1:]
  if len(dates)<=n or any(day not in values for day in dates):return None
  close=[values[day] for day in dates]
 else:close=list(values.values())
 return (close[-1]/close[-1-n]-1)*100 if len(close)>n else None
async def select_sector_market(h,market):
 label={'KR':'한국','US':'미국'}[market]
 tab=h.page.locator('.stv2-toolbar .stv2-tabs').first.get_by_role('button',name=label,exact=True)
 if await tab.get_attribute('aria-pressed')!='true':await tab.click()
 assert await tab.get_attribute('aria-pressed')=='true'
async def sectors_checks(browser,artifact,tmp,width):
 h=await Harness(browser,artifact,feeds,width,args.published).start_browser(tmp)
 try:

  if not args.public_feeds:await h.page.clock.set_fixed_time('2026-11-17T03:00:00Z')
  started=time.perf_counter();await h.login('sectors');
  await select_sector_market(h,'KR')
  await h.page.wait_for_function('()=>!THM_BUSY&&THM.length>0');first=round((time.perf_counter()-started)*1000)
  async def day():
   assert await h.page.locator('.stv2-ranks .stv2-card').count()>0;rows=h.page.locator('.stv2-overview table tr');labels=await rows.locator('td:first-child').all_text_contents();assert len(labels)==len(set(labels));values=[float(s.replace(',','')) for s in await rows.locator('td:nth-child(4)').all_text_contents()];assert values==sorted(values,reverse=True)
  await case(h,'KR_DAY_THEME_BREADTH_LEADERS_MAINTAINED',day)
  async def us():
   await select_sector_market(h,'US')
   for days in [1,5,20,60]:
    if days==5:await h.page.locator('.stv2-tabs button',has_text='스윙').click()
    if days!=1:await h.page.locator('.stv2-tabs button').filter(has_text=re.compile('^'+str(days)+'일$')).click()
    await h.page.wait_for_function('(n)=>document.querySelector(".stv2")?.textContent.includes("기간 "+n+"거래일")',arg=days)
    await h.page.locator('.stv2-etfs').evaluate('(e)=>e.open=true');rows=await h.page.locator('.stv2-etfs table tr').all();assert len(rows)==12
    for row in rows[1:]:
     cells=await row.locator('td').all_text_contents();symbol=re.search(r'\(([A-Z]+)\)',cells[0])[1];value=returns(symbol,days);relative=value-returns('SPY',days);assert abs(float(cells[1].replace('%',''))-value)<.011,(symbol,days,cells[1],value);assert abs(float(cells[2].replace('%',''))-relative)<.011,(symbol,days,cells[2],relative)
    assert '개별 미국 테마' in await h.page.locator('.stv2').text_content()
   await h.page.screenshot(path=str(args.output/(str(width)+'-us-sector.png')))
  await case(h,'US_11_ETFS_SPY_1_5_20_60_RETURNS_AND_RS',us)
  async def kr():
   await select_sector_market(h,'KR');await h.page.locator('.stv2-tabs button',has_text='스윙').click()
   for days in [5,20,60]:
    await h.page.locator('.stv2-tabs button').filter(has_text=re.compile('^'+str(days)+'일$')).click();await h.page.wait_for_function('(n)=>document.querySelector(".stv2")?.textContent.includes("기간 "+n+"거래일")',arg=days)
    rows=await h.page.locator('.stv2 table').first.locator('tr').all();assert len(rows)>1
    samples=await h.page.evaluate('THM.map(t=>({no:t.no,codes:t.rows.slice(0,5).map(r=>r.code)}))');master={r['code']:r['market'] for r in json.loads((ROOT/'data/krx-instruments.json').read_text())['instruments']}
    for row in rows[1:]:
     cells=await row.locator('td').all_text_contents();no=int(re.search(r'\((\d+)\)',cells[0])[1]);codes=next(t['codes'] for t in samples if int(t['no'])==no);values=[]
     for code in codes:
      suffix='.KS' if master.get(code)=='KOSPI' else '.KQ' if master.get(code)=='KOSDAQ' else None
      if suffix and history_url(code+suffix) in feeds:
       v=returns(code+suffix,days,'^KS11')
       if v is not None:values.append(v)
     assert len(values)>=2;expected=sum(values)/len(values);assert abs(float(cells[1].replace('%',''))-expected)<.011;assert abs(float(cells[2].replace('%',''))-(expected-returns('^KS11',days)))<.011
    assert '전체 테마 수익률 또는 확정 스윙 순위가 아닙니다' in await h.page.locator('.stv2').inner_text()
   await h.page.screenshot(path=str(args.output/(str(width)+'-kr-swing.png')))
  await case(h,'KR_REGISTERED_EXCHANGES_SAMPLE_5_20_60_RETURNS_RS',kr)
  async def partial():
   if args.public_feeds:return
   h.overrides[history_url('XLE')]={'text':json.dumps({'chart':{'result':[]}})};await select_sector_market(h,'US');await h.page.locator('.stv2-tabs button',has_text='단타').click();await h.page.get_by_role('button',name='현재 페이지 갱신',exact=True).click();await h.page.wait_for_function('()=>DevelopmentDiagnostics.snapshot().issues.some(r=>r.page==="sectors"&&r.code==="SERIES_UNAVAILABLE"&&r.active)');assert '검증 수신 10/11개 ETF' in await h.page.locator('.stv2').text_content();assert await h.page.locator('.stv2-etfs table tr').count()==11
  if not args.public_feeds:await case(h,'API_FAILURE_IS_SEPARATE_FROM_VALID_ROWS',partial)
  # The previous scenarios intentionally refresh dozens of public instruments.
  # Use an independent real Worker-gate instance for the rapid-switch race so
  # the per-IP rolling quota is not exhausted by unrelated coverage tests.
  # Quota/backoff behavior remains covered by browser_relay_busy.py.
  if not args.public_feeds:
   fresh=await Harness(browser,artifact,feeds,width,args.published).start_browser(tmp)
   try:
    await fresh.page.clock.set_fixed_time('2026-11-17T03:00:00Z')
    await fresh.login('sectors')
    await fresh.page.wait_for_function('()=>!THM_BUSY&&THM.length>0')
    async def rapid():
     fresh.overrides[history_url('SPY')]={'text':feeds[history_url('SPY')],'delayMs':400}
     fresh.overrides[history_url('XLE')]={'text':feeds[history_url('XLE')]}
     await select_sector_market(fresh,'US')
     await fresh.page.wait_for_timeout(200)  # SPY request starts, remains in-flight
     await select_sector_market(fresh,'KR')
     await fresh.page.locator('.stv2-tabs button',has_text='단타').click()
     await select_sector_market(fresh,'US')
     await fresh.page.locator('.stv2-tabs button',has_text='스윙').click()
     await fresh.page.locator('.stv2-tabs button').filter(has_text=re.compile('^20일$')).click()
     try:
      await fresh.page.wait_for_function('()=>document.querySelector(".stv2")?.textContent.includes("미국 11개 섹터 ETF 상대강도")&&document.querySelector(".stv2")?.textContent.includes("기간 20거래일")')
     except Exception as exc:
      state=await fresh.page.evaluate("""() => ({
        activeUS:document.querySelector('.stv2-toolbar .stv2-tabs button[aria-pressed=true]')?.textContent==='미국',
        period20:document.querySelector('.stv2')?.textContent.includes('기간 20거래일'),
        etfTitle:document.querySelector('.stv2')?.textContent.includes('미국 11개 섹터 ETF 상대강도'),
        hasLoading:document.querySelector('.stv2')?.textContent.includes('실제 일봉 데이터 분석 중'),
        hasError:document.querySelector('.stv2')?.textContent.includes('시계열 수신 또는 검증 실패'),
        selectedLabels:[...document.querySelectorAll('.stv2-toolbar .stv2-tabs button[aria-pressed=true]')].map(x=>x.textContent.slice(0,20)),
        transport:typeof DashboardTransport?.readState==='function'?DashboardTransport.readState():null
      })""")
      raise AssertionError('RAPID_UI_DIAGNOSTIC '+json.dumps(state,ensure_ascii=False)) from exc
     assert '국내 상위 테마 구성종목 표본 분석' not in await fresh.page.locator('.stv2').inner_text()
     await fresh.page.get_by_role('button',name='현재 페이지 갱신',exact=True).click()
     await fresh.go('news')
     assert await fresh.page.locator('.stv2').count()==0
    await case(fresh,'RAPID_SELECTION_AND_NAVIGATION_DURING_LOAD',rapid)
    assert not fresh.errors,fresh.errors
    assert not any(x['action'] in ['nhAccounts','nhQuotes','order','saveExternalHoldings'] for x in fresh.requests)
   finally:
    await fresh.close()
  assert not h.errors,h.errors;assert not any(r['action'] in ['nhAccounts','nhQuotes','order','saveExternalHoldings'] for r in h.requests)
  timings.append({'area':'sectors','width':width,'mode':MODE,'firstDisplayMs':first,'firstFrameMs':h.first_frame_ms,'initialDataMs':h.initial_data_ms,'initialRenderSettleMs':h.initial_render_ms,'requestCount':len(h.requests),'lastResponseMs':max((r.get('endMs',0) for r in h.requests),default=0)})
 finally:await h.close()
async def main():
 with tempfile.TemporaryDirectory() as tmp:
  artifact=Path(tmp)/'public';build(artifact)
  # Local fixtures need the synthetic pinned endpoint, not the real deployment.
  if not args.published:
   from public_integration_support import ENDPOINT
   import shutil
   shutil.rmtree(artifact);build(artifact,relay_endpoint=ENDPOINT)
  async with async_playwright() as p:
   browser=await p.chromium.launch(headless=True)
   try:
    for width in args.widths:
     if args.only in ['all','clock'] and not args.public_feeds:await clock_checks(browser,artifact,tmp,width)
     if args.only in ['all','chart']:await chart_checks(browser,artifact,tmp,width)
     if args.only in ['all','sectors']:await sectors_checks(browser,artifact,tmp,width)
   finally:await browser.close()
 args.output.joinpath('results.json').write_text(json.dumps(results,indent=2));args.output.joinpath('timings.json').write_text(json.dumps(timings,indent=2));print(json.dumps({'passed':sum(r['status']=='PASS' for r in results),'failed':sum(r['status']=='FAIL' for r in results),'mode':MODE}));return 1 if any(r['status']=='FAIL' for r in results) else 0
raise SystemExit(asyncio.run(main()))
