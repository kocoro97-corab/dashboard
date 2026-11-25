"""Refresh public US listings and issuer theme samples. No credentials/private API.
Safe for the existing development Pages data-only refresh workflow.
"""
import argparse,concurrent.futures,csv,datetime,hashlib,html,io,json,re,threading,urllib.parse,urllib.request
from pathlib import Path
HOSTS={'www.nasdaqtrader.com','www.ark-funds.com','assets.ark-funds.com','api.stock.naver.com','query1.finance.yahoo.com'}
FUNDS=[('arkq','자율주행·로보틱스'),('arkg','유전체·바이오 혁신'),('arkw','차세대 인터넷'),('arkf','핀테크 혁신'),('arkx','우주·방위 혁신'),('arkk','파괴적 혁신')]
def read(url):
 parsed=urllib.parse.urlsplit(url)
 if parsed.scheme!='https' or parsed.hostname not in HOSTS or parsed.username or parsed.password or parsed.port not in (None,443):raise ValueError('PUBLIC_SOURCE_DENIED')
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Accept':'*/*'}),timeout=25) as r:
  if urllib.parse.urlsplit(r.geturl()).hostname not in HOSTS:raise ValueError('PUBLIC_REDIRECT_DENIED')
  raw=r.read(2*1024*1024+1)
  if len(raw)>2*1024*1024:raise ValueError('PUBLIC_RESPONSE_TOO_LARGE')
  return raw
def refresh(output):
 output.mkdir(parents=True,exist_ok=True);now=datetime.datetime.now(datetime.timezone.utc);records={};sources=[];quotes={};lock=threading.Lock()
 for file in ['nasdaqlisted.txt','otherlisted.txt']:
  url='https://www.nasdaqtrader.com/dynamic/SymDir/'+file;raw=read(url);sources.append({'url':url,'sha256':hashlib.sha256(raw).hexdigest()})
  for r in csv.DictReader(io.StringIO(raw.decode('utf-8-sig')),delimiter='|'):
   symbol=r.get('Symbol') or r.get('ACT Symbol');name=r.get('Security Name','').strip()
   if r.get('Test Issue')!='N' or not symbol or not re.fullmatch('[A-Z][A-Z0-9.-]{0,14}',symbol) or not name:continue
   exchange='NASDAQ' if file=='nasdaqlisted.txt' else {'N':'NYSE','A':'AMEX','P':'ARCA','Z':'BATS','V':'IEX'}.get(r.get('Exchange'))
   if exchange:records[symbol]={'symbol':symbol,'nameEn':name,'type':'ETF' if r.get('ETF')=='Y' else 'LISTED_SECURITY','exchange':exchange}
 if len(records)<1000:raise ValueError('US_DIRECTORY_INCOMPLETE')
 def quote(symbol):
  # Reuse verified chart endpoint; a security must identify itself as US equity.
  with lock:
   if symbol in quotes:return quotes[symbol]
  data=json.loads(read('https://query1.finance.yahoo.com/v8/finance/chart/'+urllib.parse.quote(symbol,safe='')+'?interval=1d&range=1y'));result=data['chart']['result'][0];m=result['meta']
  if m.get('symbol')!=symbol or m.get('currency')!='USD' or m.get('instrumentType')!='EQUITY' or m.get('exchangeName') not in ['NMS','NGM','NCM','NYQ','ASE','PCX','BTS']:raise ValueError('US_EQUITY_IDENTITY_MISMATCH')
  if len(result.get('timestamp',[]))<62:raise ValueError('US_HISTORY_TOO_SHORT')
  with lock:quotes[symbol]=m
  return m
 def fund(pair):
  slug,label=pair;page='https://www.ark-funds.com/funds/'+slug;ident=re.search(r'/api/fund/holdings/(\d+)',read(page).decode())[1]
  options={'Heading':'Top 10 Holdings','PdfLinkText':'Full Holdings PDF','CsvLinkText':'Full Holdings CSV','Link':{'Style':'','Href':'','Aria':'','Target':'','Text':''}}
  fragment=read('https://www.ark-funds.com/api/fund/holdings/'+ident+'?fundHoldingData='+urllib.parse.quote(json.dumps(options,separators=(',',':')))).decode();source=html.unescape(re.search(r'href="([^"]+\.csv)"',fragment)[1]);raw=read(source);members=[];dates=set()
  for row in csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))):
   symbol=row.get('ticker','').strip()
   if not re.fullmatch('[A-Z][A-Z0-9.-]{0,14}',symbol):continue
   try:
    date=datetime.datetime.strptime(row['date'],'%m/%d/%Y').date()
    if date>now.date():raise ValueError('FUTURE_MEMBERSHIP')
    m=quote(symbol);dates.add(date.isoformat());members.append({'symbol':symbol,'name':row['company'].strip(),'currency':'USD','exchange':m['exchangeName'],'instrumentType':'EQUITY'})
   except (ValueError,KeyError,TypeError,urllib.error.URLError):continue
   if len(members)==10:break
  if len(members)<3 or len(dates)!=1:raise ValueError('US_THEME_SAMPLE_INCOMPLETE')
  return {'id':slug.upper(),'name':label,'asOf':dates.pop(),'source':source,'sourcePage':page,'sourceSha256':hashlib.sha256(raw).hexdigest(),'selection':'공개 구성자료 순서 상위 10개 미국 상장 일반종목 표본; 식별 미확인·이력 부족 제외','instruments':members}
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:themes=list(pool.map(fund,FUNDS))
 common={'AAPL','MSFT','NVDA','AMZN','GOOG','GOOGL','META','TSLA','AMD','NFLX','PLTR','AVGO','INTC','JPM','KO','BRK.B','SPY','QQQ','XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLC','XLU','XLB','XLRE'}
 targets=common|{r['symbol'] for t in themes for r in t['instruments']}
 # Korean names are accepted only from an exact symbol + USA exchange response.
 def korean(symbol):
  record=records.get(symbol)
  if not record:return None
  suffix={'NASDAQ':'.O','NYSE':'.N','ARCA':'.P','AMEX':'.A','BATS':'.Z'}.get(record['exchange'])
  if not suffix:return None
  url='https://api.stock.naver.com/stock/'+urllib.parse.quote(symbol+suffix,safe='')+'/basic'
  try:
   d=json.loads(read(url));name=d.get('stockName');exchange=d.get('stockExchangeType') or {}
   if d.get('symbolCode')==symbol and exchange.get('nationCode')=='USA' and isinstance(name,str) and re.search('[가-힣]',name):return symbol,name,url
  except (ValueError,KeyError,TypeError,urllib.error.URLError):pass
  return None
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
  names=[r for r in pool.map(korean,sorted(targets)) if r]
 for symbol,name,url in names:records[symbol].update(nameKo=name,koSource=url)
 for symbol,m in quotes.items():
  if symbol in records:records[symbol].update(type='EQUITY',nameEn=m.get('longName') or m.get('shortName') or records[symbol]['nameEn'])
 listing={'schemaVersion':1,'retrievedAt':now.isoformat(),'sources':sources,'instruments':list(sorted(records.values(),key=lambda r:r['symbol']))}
 universe={'schemaVersion':1,'publisher':'ARK Invest','scope':'ISSUER_THEMATIC_EQUITY_SAMPLES','retrievedAt':now.isoformat(),'themes':themes}
 # Validate all sources before replacing either public reference file.
 for name,doc in [('us-instruments.json',listing),('us-theme-instruments.json',universe)]:
  target=output/name;temp=target.with_suffix('.tmp');temp.write_text(json.dumps(doc,ensure_ascii=False,separators=(',',':'))+'\n');temp.replace(target)
 return {'status':'PASS','scope':'PUBLIC_REFERENCE_ONLY','listings':len(records),'koreanNames':len(names),'themes':len(themes),'themeEquities':len({r['symbol'] for t in themes for r in t['instruments']}),'privateCalls':0}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output-root',type=Path,required=True);a=p.parse_args();print(json.dumps(refresh(a.output_root)))
