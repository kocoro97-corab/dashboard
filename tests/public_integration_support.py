"""Public-only fixtures and asynchronous loopback Worker adapter for UI review."""
import asyncio,json,mimetypes,os,subprocess,time,urllib.request
from pathlib import Path
from urllib.parse import urlsplit,quote
ROOT=Path(__file__).resolve().parents[1]
BASE='https://kocoro97-corab.github.io/dashboard-v2-dev/'
ENDPOINT='https://myinvest-v2-dev-relay.synthetic.workers.dev/api'
ETF=['XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLC','XLU','XLB','XLRE']
LIST='https://m.stock.naver.com/api/stocks/theme?page=1&pageSize=100'
def history_url(symbol,interval='1d',period='1y'):return 'https://query1.finance.yahoo.com/v8/finance/chart/'+quote(symbol,safe="~()*!.'")+'?interval='+interval+'&range='+period
LAST=1794528000 # 2026-11-13 UTC, before all test clock boundaries.
def history(symbol,count=100,step=None,interval='1d',period='1y'):
 step=step or (ETF.index(symbol)+1 if symbol in ETF else 1);base=200 if symbol in ['SPY','^KS11'] else 100
 if interval=='1mo':
  months=range(1990*12,2026*12) if period=='max' else range(2021*12+11,2026*12+11)
  from datetime import datetime,timezone
  times=[int(datetime(m//12,m%12+1,1,tzinfo=timezone.utc).timestamp()) for m in months];count=len(times)
 else:times=[LAST-(count-1-i)*(7 if interval=='1wk' else 1)*86400 for i in range(count)]
 values=[base+i*step for i in range(count)];domestic=symbol.endswith(('.KS','.KQ')) or symbol in ['^KS11','^KQ11'];exchange='KOE' if symbol.endswith('.KQ') or symbol=='^KQ11' else 'KSC' if domestic else 'PCX'
 return {'chart':{'result':[{'meta':{'symbol':symbol,'currency':'KRW' if domestic else 'USD','exchangeName':exchange,'regularMarketPrice':values[-1],'chartPreviousClose':values[-2] if count>1 else None,'regularMarketTime':times[-1]},'timestamp':times,'indicators':{'quote':[{'open':[v-1 for v in values],'high':[v+2 for v in values],'low':[v-2 for v in values],'close':values,'volume':[1000]*count}]}}]}}
def synthetic_feeds():
 def row(code,name,rate,val):return {'itemCode':code,'stockName':name,'fluctuationsRatio':str(rate),'accumulatedTradingValue':str(val),'accumulatedTradingVolume':'100'}
 data={LIST:json.dumps({'groups':[{'no':12,'name':'합성테마 A','changeRate':'4'},{'no':13,'name':'합성테마 B','changeRate':'2'}]}),'https://m.stock.naver.com/api/stocks/theme/12?page=1&pageSize=100':json.dumps({'stocks':[row('005930','삼성전자',2,100),row('000660','SK하이닉스',-1,300),row('035720','카카오',0,200)]}),'https://m.stock.naver.com/api/stocks/theme/13?page=1&pageSize=100':json.dumps({'stocks':[row('005930','삼성전자',2,100),row('344820','KCC글라스',-2,500),row('352700','씨앤투스',1,400)]})}
 symbols=ETF+['SPY','^KS11','^KQ11','^GSPC','^IXIC','^DJI','^SOX','^VIX','^TNX','^IRX','KRW=X','GC=F','CL=F','NQ=F','ES=F','YM=F','005930.KS','000660.KS','035720.KS','344820.KS','352700.KQ']
 for symbol in symbols:
  for interval,period in [('1d','1d'),('1d','1y'),('1d','3mo'),('1wk','2y'),('1mo','5y'),('1mo','10y'),('1mo','max')]:data[history_url(symbol,interval,period)]=json.dumps(history(symbol,interval=interval,period=period))
 return data
TRACE="""(()=>{window.__chartTrace={};window.__resizeListeners=new Set();window.__activeRO=0;const add=window.addEventListener,remove=window.removeEventListener;window.addEventListener=function(t,f,o){if(t==='resize')__resizeListeners.add(f);return add.call(this,t,f,o)};window.removeEventListener=function(t,f,o){if(t==='resize')__resizeListeners.delete(f);return remove.call(this,t,f,o)};const RO=window.ResizeObserver;window.ResizeObserver=class extends RO{observe(...a){if(!this._reviewActive){this._reviewActive=true;__activeRO++}return super.observe(...a)}disconnect(){if(this._reviewActive){__activeRO--;this._reviewActive=false}return super.disconnect()}};const p=CanvasRenderingContext2D.prototype,b=p.beginPath,m=p.moveTo,l=p.lineTo,s=p.stroke;p.beginPath=function(){this._reviewPath=[];return b.apply(this,arguments)};p.moveTo=function(x,y){this._reviewPath?.push([x,y]);return m.apply(this,arguments)};p.lineTo=function(x,y){this._reviewPath?.push([x,y]);return l.apply(this,arguments)};p.stroke=function(){if(['#f5b942','#b494f5'].includes(this.strokeStyle))__chartTrace[this.strokeStyle]=this._reviewPath?.slice();return s.apply(this,arguments)}})()"""
class Harness:
 def __init__(self,browser,artifact,feeds,width,published=False):self.browser=browser;self.artifact=artifact;self.feeds=feeds;self.width=width;self.published=published;self.requests=[];self.errors=[];self.overrides={};self.active_routes=set();self.closing=False;self.start=time.perf_counter();self.endpoint='https://myinvest-v2-dev-relay.kocoro97.workers.dev/api' if published else ENDPOINT
 async def start_browser(self,tmp):
  fixture=Path(tmp)/('feeds-'+str(time.time_ns())+'.json');fixture.write_text(json.dumps(self.feeds));self.bridge=subprocess.Popen(['node','tests/worker_browser_bridge.mjs'],cwd=ROOT,env=dict(os.environ,MYINVEST_TEST_PUBLIC_FIXTURE=str(fixture)),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);self.port=json.loads(self.bridge.stdout.readline())['port'];self.ctx=await self.browser.new_context(viewport={'width':self.width,'height':1000},timezone_id='UTC',has_touch=True,service_workers='block');await self.ctx.add_init_script(TRACE);self.page=await self.ctx.new_page();self.page.on('pageerror',lambda e:self.errors.append(type(e).__name__));await self.ctx.route('**/*',self.route);self.page.set_default_timeout(12000);return self
 async def route(self,r):
  task=asyncio.current_task();self.active_routes.add(task)
  try:return await self._route(r)
  except Exception:
   if not self.closing:raise
  finally:self.active_routes.discard(task)
 async def _route(self,r):
  u=urlsplit(r.request.url)
  if u.hostname=='kocoro97-corab.github.io' and u.path.startswith('/dashboard-v2-dev/'):
   if self.published:await r.continue_();return
   f=self.artifact/(u.path.removeprefix('/dashboard-v2-dev/') or 'index.html')
   if f.is_file() and self.artifact in f.resolve().parents:await r.fulfill(content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream',body=f.read_bytes());return
  if r.request.url==self.endpoint:
   body=json.loads(r.request.post_data or '{}');record={'action':body.get('action'),'url':body.get('url'),'startMs':round((time.perf_counter()-self.start)*1000)};self.requests.append(record)
   payload={'headers':r.request.headers,'method':r.request.method,'body':r.request.post_data}
   if body.get('url') in self.overrides:payload['publicFixture']={'url':body['url'],**self.overrides[body['url']]}
   def send():
    req=urllib.request.Request('http://127.0.0.1:'+str(self.port),data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=20) as response:return json.load(response)
   res=await asyncio.to_thread(send);record.update(http=res['status'],endMs=round((time.perf_counter()-self.start)*1000));await r.fulfill(status=res['status'],headers=res['headers'],body=res['body']);return
  await r.abort()
 async def login(self,area='market'):
  self.login_start=time.perf_counter();await self.page.goto(BASE+'index.html#/'+area,wait_until='domcontentloaded');await self.page.wait_for_selector('#devBanner');await self.page.locator('#authId').fill('synthetic');await self.page.locator('#authPw').fill('SYNTHETIC_PRIVATE_PASSWORD');await self.page.locator('#authSubmitBtn').click();await self.page.wait_for_selector('#dashboardNav');self.first_frame_ms=round((time.perf_counter()-self.login_start)*1000);await self.page.wait_for_function('()=>document.getElementById("pageStatus")?.textContent.startsWith("연결됨")');self.initial_data_ms=round((time.perf_counter()-self.login_start)*1000);render_start=time.perf_counter();await self.page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');self.initial_render_ms=round((time.perf_counter()-render_start)*1000)
 async def close(self):
  self.closing=True;await self.ctx.close()
  if self.active_routes:await asyncio.gather(*list(self.active_routes),return_exceptions=True)
  self.bridge.terminate();self.bridge.wait(timeout=5)
 async def go(self,area):await self.page.locator('#dashboardNav a[href="#/'+area+'"]').click();await self.page.wait_for_function('(s)=>DashboardShell.getStatus().page===s',arg=area)
