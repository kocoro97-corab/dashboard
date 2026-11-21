(function () {
const modules = {};
/* Public market reads through the existing getTxt transport. */
(function (root) {
  'use strict';

  const domestic = new Map([['^KS11', 'KOSPI'], ['^KQ11', 'KOSDAQ']]);
  const global = new Map([
    ['^GSPC', '.INX'], ['^IXIC', '.IXIC'], ['^DJI', '.DJI'],
    ['^SOX', '.SOX'], ['^VIX', '.VIX']
  ]);
  const newsQueries = new Map([
    ['market', '코스피 OR 증시 OR 나스닥 when:2d'],
    ['holdings', '(삼성전자 OR SK하이닉스 OR 한미반도체 OR 알테오젠) when:2d']
  ]);

  function numeric(value) {
    if (typeof value === 'string' && /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value.trim())) {
      value = Number(value.replace(/,/g, ''));
    }
    return Number.isFinite(value) ? value : null;
  }

  function naverQuote(row) {
    const p = numeric(row?.closePrice ?? row?.calcPrice);
    if (p === null) return null;
    let change = numeric(row.compareToPreviousClosePrice ?? row.fluctuations);
    const direction = row.compareToPreviousPrice ?? row.fluctuationsType;
    const code = String(direction?.code ?? '');
    const label = String(direction?.name ?? '') + String(direction?.text ?? '');
    if (change !== null) {
      if (/^[45]$/.test(code) || /FALL|하락|하한/.test(label)) change = -Math.abs(change);
      else if (/^[12]$/.test(code) || /RIS|상승|상한/.test(label)) change = Math.abs(change);
    }
    return { p, prev: change === null ? null : numeric(p - change) };
  }

  function create({ readText, parseXml = text => new DOMParser().parseFromString(text, 'text/xml') }) {
    if (typeof readText !== 'function') throw new TypeError('readText is required');

    async function read(url, parse) {
      try {
        const text = await readText(url);
        return typeof text === 'string' && text.trim() ? parse(text) : null;
      } catch {
        return null;
      }
    }

    async function fromNaver(url, identity, code, allowUnidentified = false) {
      const body = await read(url, JSON.parse);
      if (body?.success === false || body?.error) return null;
      const payload = body?.datas ?? body?.result ?? body?.data ?? body?.items ?? body;
      const rows = Array.isArray(payload) ? payload : [payload];
      const single = allowUnidentified && rows.length === 1 && identity(rows[0]) == null;
      const row = rows.find(item => identity(item) === code) ?? (single ? rows[0] : null);
      return naverQuote(row);
    }

    async function fromYahoo(symbol) {
      const body = await read('https://query1.finance.yahoo.com/v8/finance/chart/' +
        encodeURIComponent(symbol) + '?interval=1d&range=1d', JSON.parse);
      const meta = body?.chart?.result?.[0]?.meta;
      if (body?.chart?.error || meta?.symbol !== symbol) return null;
      const p = numeric(meta.regularMarketPrice);
      return p === null ? null : { p, prev: numeric(meta.chartPreviousClose ?? meta.previousClose) };
    }

    async function index(symbol) {
      if (typeof symbol !== 'string' || !/^\^[A-Z0-9]{1,15}$/.test(symbol)) return null;
      let quote;
      if (domestic.has(symbol)) {
        const code = domestic.get(symbol);
        quote = await fromNaver('https://polling.finance.naver.com/api/realtime/domestic/index/' + code,
          row => row?.itemCode ?? row?.symbolCode, code, true);
      } else if (global.has(symbol)) {
        const code = global.get(symbol);
        quote = await fromNaver('https://stock.naver.com/api/polling/worldstock/index?reutersCodes=' + code,
          row => row?.reutersCode ?? row?.symbolCode, code);
      }
      return quote ? { ...quote, source: 'N' } : yahooQuote(symbol);
    }

    async function yahooQuote(symbol) {
      const quote = await fromYahoo(symbol);
      return quote ? { ...quote, source: 'Y' } : null;
    }

    async function quote(symbol) {
      if (typeof symbol !== 'string' || !/^[A-Z0-9][A-Z0-9=.-]{0,31}$/.test(symbol)) return null;
      if (!/^\d{6}$/.test(symbol)) return yahooQuote(symbol);
      const result = await fromNaver('https://polling.finance.naver.com/api/realtime/domestic/stock/' + symbol,
        row => row?.itemCode ?? row?.stockCode ?? row?.symbolCode, symbol);
      return result ? { ...result, source: 'N' } : null;
    }

    async function news(topic) {
      if (!newsQueries.has(topic)) return null;
      const doc = await read('https://news.google.com/rss/search?q=' +
        encodeURIComponent(newsQueries.get(topic)) + '&hl=ko&gl=KR&ceid=KR:ko', parseXml);
      if (!doc || doc.documentElement?.localName !== 'rss' || doc.querySelector('parsererror')) return null;
      const channel = doc.querySelector('rss > channel');
      if (!channel) return null;
      const articles = [];
      const seen = new Set();
      for (const item of channel.querySelectorAll('item')) {
        const field = name => item.querySelector(name)?.textContent?.trim() ?? '';
        const t = field('title');
        const l = field('link');
        const d = new Date(field('pubDate'));
        if (!t || !Number.isFinite(d.getTime()) || seen.has(l)) continue;
        try {
          const url = new URL(l);
          if (!/^https:\/\//i.test(l) || url.username || url.password || /[\s\\]/.test(l)) continue;
        } catch {
          continue;
        }
        seen.add(l);
        articles.push({ t, l, s: field('source'), d });
      }
      return articles.sort((a, b) => b.d - a.d);
    }

    return Object.freeze({ index, quote, news });
  }

  const api = Object.freeze({ create });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MarketDataV2 = api;
})(modules);

;
(function (root) {
  'use strict';

  const markets = ['KR', 'US'];
  const clock = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit'
  });
  const zones = { KR: 'Asia/Seoul', US: 'America/New_York' };

  function item(value) {
    if (!value || typeof value.id !== 'string' || !/^[\w.-]{1,48}$/.test(value.id) ||
        typeof value.name !== 'string' || !value.name.trim()) return null;
    const result = { id: value.id, name: value.name.trim().slice(0, 80) };
    for (const field of ['y', 'tv', 't', 'fut', 'inv']) {
      if (typeof value[field] === 'string') result[field] = value[field].slice(0, 80);
    }
    for (const field of ['m', 'vis']) {
      if (typeof value[field] === 'boolean' || Number.isFinite(value[field])) result[field] = value[field];
    }
    return result;
  }

  function normalize(settings, defaults = {}) {
    return Object.fromEntries(markets.map(market => {
      const source = Array.isArray(settings?.[market]) ? settings[market] : defaults[market];
      const seen = new Set();
      const cards = (Array.isArray(source) ? source : []).map(item).filter(card => {
        if (!card || seen.has(card.id)) return false;
        seen.add(card.id);
        return true;
      });
      return [market, cards];
    }));
  }

  function edit(settings, market, action, defaults) {
    const next = normalize(settings, defaults);
    if (!markets.includes(market) || !action) return next;
    const cards = next[market];
    const index = cards.findIndex(card => card.id === action.id);
    if (action.type === 'add') {
      const card = item(action.card);
      if (card && !cards.some(current => current.id === card.id)) cards.push(card);
    } else if (action.type === 'remove' && index >= 0) {
      cards.splice(index, 1);
    } else if (action.type === 'move' && index >= 0 && Number.isInteger(action.to) && action.to >= 0 && action.to < cards.length) {
      cards.splice(action.to, 0, cards.splice(index, 1)[0]);
    }
    return next;
  }

  function layout(settings, { defaults, now = Date.now(), calendar } = {}) {
    if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new RangeError('INVALID_TIME');
    const parts = Object.fromEntries(clock.formatToParts(now).map(part => [part.type, part.value]));
    const hour = Number(parts.hour);
    const primary = hour >= 7 && hour < 21 ? 'KR' : 'US';
    const order = primary === 'KR' ? markets.slice() : markets.slice().reverse();
    const cards = normalize(settings, defaults);
    const tradingDays = Object.fromEntries(order.map(market => {
      const date = new Intl.DateTimeFormat('en-US', { timeZone: zones[market], year: 'numeric', month: '2-digit',
        day: '2-digit', weekday: 'short' });
      const fields = Object.fromEntries(date.formatToParts(now).map(part => [part.type, part.value]));
      const localDate = fields.year + '-' + fields.month + '-' + fields.day;
      const override = calendar?.[market]?.[localDate];
      const status = ['open', 'closed'].includes(override) ? override :
        ['Sat', 'Sun'].includes(fields.weekday) ? 'closed' : 'unconfirmed';
      return [market, { localDate, status }];
    }));
    const visibleCards = Object.fromEntries(order.map(market => [market, cards[market].filter(card => card.vis !== 0 && card.vis !== false)]));
    return { primary, order, cards, visibleCards, tradingDays };
  }

  const api = Object.freeze({ normalize, edit, layout });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkMarketSettings = api;
})(modules);

;
(function(root){
  'use strict';
  const rows = [
    ['SPX','S&P 500','US','points','^GSPC'],['NASDAQ','나스닥 종합','US','points','^IXIC'],
    ['DOW','다우존스','US','points','^DJI'],['RUT','러셀 2000','US','points','^RUT'],
    ['SOX','필라델피아 반도체','US','points','^SOX'],['KOSPI','코스피','KR','points','^KS11'],
    ['KOSDAQ','코스닥','KR','points','^KQ11'],['K200F','코스피200 선물','KR','points'],
    ['KQ150F','코스닥150 선물','KR','points'],['ES','S&P 500 선물','US','points','ES=F'],
    ['NQ','나스닥100 선물','US','points','NQ=F'],['YM','다우 선물','US','points','YM=F'],
    ['US2Y','미국 2년 금리','US','percent'],['US10Y','미국 10년 금리','US','percent','^TNX'],
    ['CURVE','미국 10Y–2Y','US','bp'],['KR3Y','한국 국채 3년','KR','percent'],
    ['KR10Y','한국 국채 10년','KR','percent'],['CREDIT','미국 회사채 스프레드','US','bp'],
    ['DXY','달러지수','US','points','DX-Y.NYB'],['KRW','달러/원','KR','price','KRW=X','KRW'],
    ['EURUSD','유로/달러','US','price','EURUSD=X','USD'],['USDJPY','달러/엔','US','price','JPY=X','JPY'],
    ['VIX','VIX','US','points','^VIX'],['TICK','NYSE $TICK','US','count'],
    ['USBREADTH','미국 상승 종목 비율','US','percent'],['KRBREADTH','한국 상승 종목 비율','KR','percent'],
    ['USADV','미국 상승 종목 수','US','count'],['USDECL','미국 하락 종목 수','US','count'],
    ['KRADV','한국 상승 종목 수','KR','count'],['KRDECL','한국 하락 종목 수','KR','count'],
    ['KRFLOW','코스피 외국인 순매수','KR','amount',null,'KRW'],
    ['KRINST','코스피 기관 순매수','KR','amount',null,'KRW'],
    ['USTURN','미국 시장 거래대금','US','amount',null,'USD'],['KRTURN','한국 시장 거래대금','KR','amount',null,'KRW'],
    ['WTI','WTI','US','price','CL=F','USD'],['GOLD','금','US','price','GC=F','USD'],['COPPER','구리','US','price','HG=F','USD'],
    ...[['XLK','기술'],['XLF','금융'],['XLE','에너지'],['XLY','경기소비재'],['XLP','필수소비재'],
      ['XLV','헬스케어'],['XLI','산업재'],['XLU','유틸리티'],['XLC','커뮤니케이션'],['XLB','소재'],['XLRE','부동산']]
      .map(([symbol,name])=>[symbol,'미국 '+name,'US','price',symbol,'USD','sector']),
    ...[['KRCHIP','반도체'],['KRBANK','금융'],['KRSHIP','조선'],['KRDEF','방산'],['KRPOWER','전력'],['KRNUC','원전']]
      .map(([id,name])=>[id,'한국 '+name,'KR','points',null,null,'sector'])
  ];
  const catalog = Object.freeze(Object.fromEntries(rows.map(([id,name,market,unit,symbol=null,currency=null,group=null])=>
    [id,Object.freeze({id,name,market,unit,symbol,currency,group})])));
  const zones={KR:'Asia/Seoul',US:'America/New_York'};
  const isTime=v=>Number.isSafeInteger(v)&&v>=0&&v<=8640000000000000;
  const num=v=>Number.isFinite(v)?v:null;
  const formats=Object.fromEntries(Object.entries(zones).map(([key,timeZone])=>[key,
    new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})]));
  function session(market, now, calendar={}){
    const f=Object.fromEntries(formats[market].formatToParts(now).map(x=>[x.type,x.value]));
    const date=[f.year,f.month,f.day].join('-');
    const official=calendar?.[market]?.[date];
    const localMinute=Number(f.hour)*60+Number(f.minute);
    const range=market==='US'?[570,960]:[540,930];
    const hasHours=Number.isInteger(official?.open)&&Number.isInteger(official?.close)&&
      official.open>=0&&official.close<=1440&&official.open<official.close;
    const [open,close]=hasHours?[official.open,official.close]:range;
    const within=localMinute>=open&&localMinute<close;
    const weekend=['Sat','Sun'].includes(f.weekday);
    return {date,status:official==='closed'||(!hasHours&&weekend)?'closed':
      !within?'outside-regular':hasHours?'open':'scheduled-unconfirmed'};
  }
  function priority(now) {
    const hour=Number(formats.KR.formatToParts(now).find(x=>x.type==='hour').value);
    return hour>=7&&hour<21?'KR':'US';
  }
  function normalize(def, raw, options){
    const {now,provenance,maxAgeMs=7*864e5,liveAgeMs=15*60000,calendar}=options;
    const value=num(raw?.value),previous=num(raw?.previous);
    const observedAt=isTime(raw?.observedAt)?raw.observedAt:null;
    const receivedAt=isTime(raw?.receivedAt)?raw.receivedAt:null;
    const source=typeof raw?.source==='string'&&raw.source.trim()?raw.source.slice(0,64):null;
    const issues=[];
    const linked=raw?.linked===true;
    if(!linked)issues.push('UNCONNECTED');
    if(raw?.error)issues.push('SOURCE_ERROR');
    if(value===null)issues.push('VALUE_MISSING');
    if(!source)issues.push('SOURCE_MISSING');
    if(observedAt===null)issues.push('OBSERVATION_UNKNOWN');
    if(raw?.unit!==def.unit&&linked)issues.push('UNIT_MISMATCH');
    if(def.currency&&raw?.currency!==def.currency&&linked)issues.push('CURRENCY_MISMATCH');
    if(raw?.provenance!==provenance&&linked)issues.push('PROVENANCE_MISMATCH');
    if((observedAt!==null&&observedAt>now)||(receivedAt!==null&&receivedAt>now)||
      (observedAt!==null&&receivedAt!==null&&observedAt>receivedAt))issues.push('TIME_INVALID');
    if((def.unit==='points'||def.unit==='price')&&value!==null&&value<=0||
      ['USBREADTH','KRBREADTH'].includes(def.id)&&value!==null&&(value<0||value>100)||
      ['USADV','USDECL','KRADV','KRDECL'].includes(def.id)&&value!==null&&(!Number.isInteger(value)||value<0))issues.push('VALUE_INVALID');
    const age=observedAt===null?null:now-observedAt;
    const retention=raw?.delivery==='close'?maxAgeMs:
      def.id==='TICK'?Math.min(maxAgeMs,15*60000):
      ['realtime','delayed'].includes(raw?.delivery)?Math.min(maxAgeMs,36*36e5):Math.min(maxAgeMs,4*864e5);
    // Timestamped provider observations can inform analysis even when the
    // provider does not disclose delivery speed. They never get a live badge.
    const usable=issues.length===0&&age<=retention&&['close','delayed','realtime','timestamped'].includes(raw.delivery);
    const regular=['SPX','NASDAQ','DOW','RUT','SOX','KOSPI','KOSDAQ','VIX'].includes(def.id)||def.group==='sector';
    const status=!linked?'unconnected':issues.length?'unconfirmed':age>retention?'stale':
      raw.delivery==='close'?'close':raw.delivery==='delayed'?'delayed':
      raw.delivery==='realtime'&&age<=liveAgeMs&&(!regular||session(def.market,now,calendar).status==='open')?
        'realtime':'unconfirmed';
    const change=value!==null&&previous!==null?num(value-previous):null;
    const changePct=change!==null&&previous!==0?num(change/Math.abs(previous)*100):null;
    const latestByDay=new Map();
    for(const point of Array.isArray(raw?.history)?raw.history:[]){
      if(!isTime(point?.at)||observedAt===null||point.at>observedAt||num(point.value)===null||
          (['points','price'].includes(def.unit)&&point.value<=0))continue;
      const day=Math.floor(point.at/864e5);
      if(!latestByDay.has(day)||latestByDay.get(day).at<point.at)latestByDay.set(day,{at:point.at,value:point.value});
    }
    return {...def,value,previous,change,changePct,observedAt,receivedAt,source,provenance,
      linked,status,usable,issues,volume:num(raw?.volume),previousVolume:num(raw?.previousVolume),
      turnover:num(raw?.turnover),previousTurnover:num(raw?.previousTurnover),contract:typeof raw?.contract==='string'?raw.contract:null,
      history:[...latestByDay.values()].sort((a,b)=>a.at-b.at).slice(-100)};
  }
  function snapshot(raw={},options={}){
    const {now=Date.now(),provenance='live',calendar={}}=options;
    if(!isTime(now)||!['synthetic','live'].includes(provenance))throw new RangeError('INVALID_SNAPSHOT');
    const config={...options,now,provenance,calendar};
    const indicators=Object.fromEntries(Object.entries(catalog).map(([id,def])=>[id,normalize(def,raw?.[id],config)]));
    function derive(id,inputs,calculate,maxSkewMs){
      const items=inputs.map(key=>indicators[key]);
      if(!items.every(x=>x.usable)||Math.max(...items.map(x=>x.observedAt))-Math.min(...items.map(x=>x.observedAt))>maxSkewMs)return;
      const value=calculate(items.map(x=>x.value));
      if(value===null)return;
      indicators[id]=normalize(catalog[id],{linked:true,provenance,source:items.map(x=>x.source).join(' + '),
        value,previous:items.every(x=>x.previous!==null)?calculate(items.map(x=>x.previous)):null,
        observedAt:Math.min(...items.map(x=>x.observedAt)),
        receivedAt:items.every(x=>x.receivedAt!==null)?Math.max(...items.map(x=>x.receivedAt)):null,
        unit:catalog[id].unit,delivery:items.every(x=>x.status==='close')?'close':'delayed'},config);
    }
    derive('CURVE',['US10Y','US2Y'],([a,b])=>num((a-b)*100),6*36e5);
    for(const market of ['US','KR'])if(!indicators[market+'BREADTH'].usable)
      derive(market+'BREADTH',[market+'ADV',market+'DECL'],([a,b])=>a+b>0?100*a/(a+b):null,15*60000);
    const events=Array.isArray(options.events)?options.events.filter(e=>e?.provenance===provenance&&isTime(e.at)&&
      ['US','KR'].includes(e.market)&&typeof e.name==='string'&&e.name.trim()&&typeof e.source==='string'&&e.source.trim())
      .map(e=>({name:e.name.slice(0,100),market:e.market,at:e.at,source:e.source.slice(0,64),
        importance:['high','medium','low'].includes(e.importance)?e.importance:'unknown',
        actual:num(e.actual),expected:num(e.expected),unit:typeof e.unit==='string'?e.unit.slice(0,24):null,
        surprise:e.unit&&num(e.actual)!==null&&num(e.expected)!==null?num(e.actual-e.expected):null}))
      .sort((a,b)=>a.at-b.at):[];
    return {now,provenance,indicators,priority:priority(now),sessions:{KR:session('KR',now,calendar),US:session('US',now,calendar)},
      events,eventsConnected:options.eventsConnected===true};
  }

  // Quote-only fallback preserves the existing API; it has no provider timestamp.
  async function collect({marketData,readSeries,ids,now=Date.now,provenance='live',staticRows={},...options}={}){
    const requested=[...new Set(Array.isArray(ids)?ids:[])].filter(id=>Object.hasOwn(catalog,id));
    const raw={...staticRows};
    for(const id of requested){
      const def=catalog[id];
      if(!def.symbol)continue;
      const supplied=raw[id];
      if(supplied?.linked&&isTime(supplied.observedAt))continue;
      try{
        const sample=typeof readSeries==='function'?await readSeries(def):null;
        if(sample){raw[id]={...sample,receivedAt:now(),provenance,linked:true};continue;}
        if(!marketData||supplied?.linked)continue;
        const read=def.symbol.startsWith('^')?marketData.index:marketData.quote;
        if(typeof read!=='function')continue;
        const quote=await read.call(marketData,def.symbol);
        raw[id]={linked:true,provenance,unit:def.unit,currency:def.currency,value:quote?.p,previous:quote?.prev,
          source:quote?.source,receivedAt:now(),delivery:'unknown',error:!quote};
      }catch {
        raw[id]=supplied?.linked?{...supplied,error:true}:
          {linked:true,error:true,provenance,receivedAt:now(),unit:def.unit,currency:def.currency};
      }
    }
    return snapshot(raw,{...options,now:now(),provenance});
  }

  function yahooSeries(readText){
    return async def=>{
      if(typeof def?.symbol!=='string'||!Object.hasOwn(catalog,def.id)||catalog[def.id]!==def)return null;
      const body=await readText('https://query1.finance.yahoo.com/v8/finance/chart/'+
        encodeURIComponent(def.symbol)+'?interval=1d&range=1y');
      if(typeof body!=='string'||!body.trim())return null;
      const parsed=JSON.parse(body);
      const result=parsed?.chart?.result?.[0],meta=result?.meta,series=result?.indicators?.quote?.[0];
      if(parsed?.chart?.error||meta?.symbol!==def.symbol||!Array.isArray(result?.timestamp)||!Array.isArray(series?.close))return null;
      const points=result.timestamp.flatMap((at,i)=>isTime(at*1000)&&Number.isFinite(at)&&Number.isFinite(series.close[i])?
        [{at:at*1000,value:series.close[i],volume:num(series.volume?.[i])}]:[]).sort((a,b)=>a.at-b.at);
      const observedAt=Number.isFinite(meta.regularMarketTime)?meta.regularMarketTime*1000:null;
      if(def.currency&&meta.currency!==def.currency)return null;
      const exchangeZone=typeof meta.exchangeTimezoneName==='string'?meta.exchangeTimezoneName:zones[def.market];
      const day=new Intl.DateTimeFormat('en-CA',{timeZone:exchangeZone,year:'numeric',month:'2-digit',day:'2-digit'});
      const observedDay=observedAt===null?null:day.format(observedAt);
      const completed=points.filter(p=>observedDay!==null&&day.format(p.at)<observedDay);
      // A daily bar's timestamp usually denotes session start. Use timestamped
      // provider quote metadata for the current value, no guess at live delivery.
      const prior=completed.at(-1);
      const previous=prior?.value??num(meta.previousClose);
      const closeAt=meta.currentTradingPeriod?.regular?.end;
      const closeConfirmed=Number.isFinite(closeAt)&&observedAt!==null&&observedAt>=closeAt*1000&&observedAt-closeAt*1000<=60000;
      return {value:num(meta.regularMarketPrice),previous,observedAt,history:completed,
        source:'Y',unit:def.unit,currency:def.currency,delivery:closeConfirmed?'close':
          Number.isFinite(meta.exchangeDataDelayedBy)&&meta.exchangeDataDelayedBy>0?'delayed':'timestamped',
        volume:null,previousVolume:prior?.volume};
    };
  }
  function legacyQuotes({quotes={},sources={},received={},futures={}}={}) {
    const sourcesByCode=new Set(['N','Y','D']);
    return Object.fromEntries(Object.values(catalog).flatMap(def=>{
      const key=def.id==='K200F'?'k3':def.symbol;
      const sample=def.id==='K200F'?futures.k3:quotes[key];
      const source=def.id==='K200F'?'D':sourcesByCode.has(sources[key])?sources[key]:null;
      if(!sample||!source)return [];
      return [[def.id,{value:sample.p,previous:sample.prev,linked:true,provenance:'live',source,
        unit:def.unit,currency:def.currency,receivedAt:received[key],delivery:'unknown'}]];
    }));
  }
  const api=Object.freeze({catalog,snapshot,collect,yahooSeries,legacyQuotes,session});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.WorkMacroData=api;
})(modules);

;
(function(root){
  'use strict';
  const names={riskOn:'상승 추세·위험 선호',warning:'상승 추세·위험 경고',sideways:'횡보·방향 탐색',
    riskOff:'하락 추세·위험 회피',volatile:'변동성 확대·불확실',unknown:'데이터 부족·판단 보류'};
  const defaults=Object.freeze({fast:5,slow:20,changePct:0.25,vixJump:8,dollarMove:0.5,rateBp:5,
    breadthBand:5,riskScore:0.25,minCoverage:0.5,eventHorizonHours:24,relativeThreshold:0.5,
    weights:Object.freeze({equity:3,volatility:2,dollar:1,rates:1,breadth:2,sector:1})});
  const sign=(n,limit)=>n>limit?1:n<-limit?-1:0;
  const mean=arr=>arr.reduce((sum,x)=>sum+x/arr.length,0);
  const usable=x=>x?.usable===true&&Number.isFinite(x.value);
  const pct=(now,previous)=>Number.isFinite(now)&&previous>0&&Number.isFinite(now/previous)?(now/previous-1)*100:null;

  function analyze(snapshot,options={}){
    const p={...defaults,...options,weights:{...defaults.weights,...options.weights}};
    if(!Number.isInteger(p.fast)||!Number.isInteger(p.slow)||p.fast<2||p.slow<=p.fast||p.slow>100||
      ['changePct','vixJump','dollarMove','rateBp','breadthBand','eventHorizonHours','relativeThreshold']
        .some(k=>!Number.isFinite(p[k])||p[k]<=0)||
      ![p.riskScore,p.minCoverage].every(x=>typeof x==='number'&&x>0&&x<=1)||
      Object.keys(defaults.weights).some(k=>!Number.isFinite(p.weights[k])||p.weights[k]<=0||p.weights[k]>100))throw new RangeError('INVALID_ANALYSIS_POLICY');
    const q=snapshot.indicators;
    const get=id=>usable(q[id])?q[id]:null;
    const asOf=snapshot.now;
    const near=(a,b)=>a&&b&&Math.abs(a.observedAt-b.observedAt)<=6*36e5;
    const move=id=>get(id)?.changePct??null;
    const delta=id=>get(id)?.change??null;
    const rate=id=>delta(id)===null?null:delta(id)*100;
    const trend=id=>{
      const row=get(id);
      if(!row)return null;
      const points=row.history.map(x=>x.value);
      const maFast=points.length>=p.fast?mean(points.slice(-p.fast)):null;
      const maSlow=points.length>=p.slow?mean(points.slice(-p.slow)):null;
      const direction=maSlow===null?'unconfirmed':row.value>maFast&&maFast>maSlow?'up':
        row.value<maFast&&maFast<maSlow?'down':'range';
      return {id,direction,maFast,maSlow,changePct:row.changePct,
        recentReturn:pct(row.value,points.at(-5)),mediumReturn:pct(row.value,points.at(-20))};
    };
    const trends=Object.fromEntries(['SPX','NASDAQ','DOW','RUT','SOX','KOSPI','KOSDAQ'].map(id=>[id,trend(id)]));
    for(const [id,t] of Object.entries(trends)){
      if(!t)continue;
      const benchmark=q[id].market==='KR'?'KOSPI':'SPX';
      if(id===benchmark)continue;
      t.benchmark=benchmark;
      t.relativePctPoints=near(get(id),get(benchmark))&&t.changePct!==null&&move(benchmark)!==null?
        t.changePct-move(benchmark):null;
    }
    const sectors=Object.values(q).filter(row=>row.group==='sector'||row.id==='SOX').map(row=>{
      const basis=get(row.market==='KR'?'KOSPI':'SPX');
      const aligned=usable(row)&&near(row,basis);
      const relative=aligned&&row.changePct!==null&&basis.changePct!==null?row.changePct-basis.changePct:null;
      const current=aligned?trend(row.id):null;
      const benchmark=aligned?trend(basis.id):null;
      const relative5d=current?.recentReturn!=null&&benchmark?.recentReturn!=null&&
        row.history.length>=5&&basis.history.length>=5&&near({observedAt:row.history.at(-5).at},{observedAt:basis.history.at(-5).at})?
        current.recentReturn-benchmark.recentReturn:null;
      return {id:row.id,name:row.name,market:row.market,status:row.status,relative,relative5d,changePct:move(row.id),
        volumeChange:usable(row)?pct(row.volume,row.previousVolume):null,
        turnoverChange:usable(row)?pct(row.turnover,row.previousTurnover):null};
    }).sort((a,b)=>(b.relative??-Infinity)-(a.relative??-Infinity));
    const upcoming=snapshot.events.filter(event=>event.at>=asOf).slice(0,8);
    const recent=snapshot.events.filter(event=>event.at<asOf&&event.at>=asOf-24*36e5).slice(-8);
    const events={connected:snapshot.eventsConnected,upcoming,recent,
      highRisk:snapshot.eventsConnected&&upcoming.some(e=>e.importance==='high'&&e.at-asOf<=p.eventHorizonHours*36e5)};
    const liquidity={us2yBp:rate('US2Y'),us10yBp:rate('US10Y'),curveBp:get('CURVE')?.value??null,
      curveChangeBp:delta('CURVE'),kr3yBp:rate('KR3Y'),kr10yBp:rate('KR10Y'),creditChangeBp:delta('CREDIT'),
      growthRateRisk:rate('US10Y')===null?null:rate('US10Y')>p.rateBp};
    function market(marketId){
      const kr=marketId==='KR',base=kr?'KOSPI':'SPX';
      const signals=[];
      const missing=[];
      const add=(key,ids,value,description)=>{
        if(value===null){missing.push({key,ids});return;}
        signals.push({key,ids,sign:value,description,weight:p.weights[key]});
      };
      const t=trends[base];
      const equity=t?.direction==='up'?1:t?.direction==='down'?-1:t?.direction==='range'?0:null;
      add('equity',[base],equity,'대표 지수의 '+p.fast+'·'+p.slow+'개 일봉 평균 대비 위치');
      const vix=move('VIX'),dollar=move(kr?'KRW':'DXY');
      const yieldMove=kr?(liquidity.kr10yBp??liquidity.us10yBp):liquidity.us10yBp;
      const yieldId=kr&&liquidity.kr10yBp!==null?'KR10Y':'US10Y';
      add('volatility',['VIX'],vix===null?null:-sign(vix,p.vixJump),'VIX 전일 대비 '+(vix?.toFixed(2)??'—')+'%');
      add('dollar',[kr?'KRW':'DXY'],dollar===null?null:-sign(dollar,p.dollarMove),
        (kr?'달러/원':'달러지수')+' 전일 대비 '+(dollar?.toFixed(2)??'—')+'%');
      add('rates',[yieldId],yieldMove===null?null:-sign(yieldMove,p.rateBp),
        (yieldId==='KR10Y'?'한국 10년물':'미국 10년물')+' 금리 변화 '+(yieldMove?.toFixed(1)??'—')+'bp');
      const breadth=get(kr?'KRBREADTH':'USBREADTH')?.value??null;
      add('breadth',[kr?'KRBREADTH':'USBREADTH'],breadth===null?null:sign(breadth-50,p.breadthBand),'상승 종목 비율 '+(breadth?.toFixed(1)??'—')+'%');
      const comparable=sectors.filter(s=>s.market===marketId&&s.relative!==null);
      const leaders=comparable.filter(s=>s.relative>p.relativeThreshold);
      const laggards=comparable.filter(s=>s.relative<-p.relativeThreshold);
      add('sector',comparable.map(x=>x.id),comparable.length<2?null:Math.sign(leaders.length-laggards.length),
        '비교 가능 업종 '+comparable.length+'개 중 상대강세 '+leaders.length+'개, 상대약세 '+laggards.length+'개');
      const maxWeight=Object.keys(defaults.weights).reduce((sum,k)=>sum+p.weights[k],0);
      const weight=signals.reduce((sum,x)=>sum+x.weight,0);
      const score=weight?signals.reduce((sum,x)=>sum+x.sign*x.weight,0)/weight:null;
      const coverage=weight/maxWeight;
      const risk=coverage<p.minCoverage?'unknown':score>=p.riskScore?'on':score<=-p.riskScore?'off':'neutral';
      const positive=signals.filter(x=>x.sign>0),negative=signals.filter(x=>x.sign<0);
      const conflicts=[];
      if(equity===1&&yieldMove>p.rateBp)conflicts.push('지수 상승 추세와 금리 상승이 동시 발생');
      if(positive.length&&negative.length)conflicts.push('위험 선호와 경계 신호가 함께 나타남');
      if(near(get('SOX'),get('NASDAQ'))&&move('SOX')!==null&&move('NASDAQ')!==null&&
        sign(move('SOX'),p.changePct)*sign(move('NASDAQ'),p.changePct)===-1)conflicts.push('반도체와 나스닥 방향 불일치');
      const regime=coverage<p.minCoverage||equity===null?'unknown':
        vix>2*p.vixJump||vix>p.vixJump&&(equity<=0||risk!=='on')?'volatile':
        equity>0?risk==='on'&&!negative.length?'riskOn':'warning':equity<0&&risk==='off'?'riskOff':'sideways';
      return {market:marketId,regime,label:names[regime],risk,score,coverage,
        confidence:regime==='unknown'?'insufficient':coverage>=0.8&&breadth!==null&&
          signals.every(signal=>signal.ids.every(id=>get(id)?.status!=='unconfirmed'))?'high':'limited',
        signals,positive,negative,conflicts,missing,leaders,laggards,
        invalidators:[missing.length?'누락된 지표의 확인':null,'대표 지수의 중기 이동평균 이탈 또는 회복',
          'VIX·금리·환율의 동반 반전',events.highRisk?'주요 경제지표 발표 이후 반응':null].filter(Boolean)};
    }
    const kr=market('KR'),us=market('US');
    const bridge=[
      ['SPX','미국 대형주'],['NASDAQ','미국 성장주'],['SOX','한국 반도체와 비교할 미국 반도체'],
      ['ES','미국 대표 선물'],['NQ','미국 기술주 선물'],['KRW','원화 약세·강세'],['US10Y','미국 장기금리'],['KRFLOW','한국 외국인 수급']
    ].map(([id,reason])=>({id,reason,value:get(id)?.value??null,changePct:move(id),changeBp:id==='US10Y'?rate(id):null,
      status:q[id].status,observedAt:get(id)?.observedAt??null}));
    const bridgeFactors=[
      {id:'SPX',v:get('SPX')?.status==='close'?move('SPX'):null},
      {id:'SOX',v:get('SOX')?.status==='close'?move('SOX'):null},
      {id:'NQ',v:asOf-(get('NQ')?.observedAt??0)<=6*36e5?move('NQ'):null},
      {id:'KRW',v:asOf-(get('KRW')?.observedAt??0)<=24*36e5&&move('KRW')!==null?-move('KRW'):null},
      {id:'US10Y',v:liquidity.us10yBp===null?null:-liquidity.us10yBp/10},
      {id:'KRFLOW',v:get('KRFLOW')?.value!=null?sign(get('KRFLOW').value,0):null}
    ].filter(x=>x.v!==null).map(x=>({id:x.id,direction:sign(x.v,p.changePct)}));
    const support=bridgeFactors.filter(x=>x.direction>0).length;
    const pressure=bridgeFactors.filter(x=>x.direction<0).length;
    const crossMarket={factors:bridgeFactors,bias:bridgeFactors.length<3?'근거 부족 · 한국장 영향 판단 보류':
      support&&pressure?'미국·환율·수급 신호 혼재':support?'한국장에 우호적인 신호 우세':
      pressure?'한국장에 부담을 주는 신호 우세':'방향을 제시하는 신호 부족'};
    const tick=get('TICK');
    const tickLabel=snapshot.provenance==='live'&&tick&&['realtime','delayed'].includes(tick.status)&&asOf-tick.observedAt<=15*60000?
      tick.value>=1000?'극단 매수 우위':tick.value<=-1000?'극단 매도 우위':'±1,000 범위 안':null;
    const changes=Object.values(q).filter(row=>usable(row)&&row.changePct!==null&&
      ['SPX','NASDAQ','SOX','KOSPI','KOSDAQ','KRW','DXY','VIX','WTI','GOLD','COPPER'].includes(row.id))
      .sort((a,b)=>Math.abs(b.changePct)-Math.abs(a.changePct)).slice(0,5).map(x=>({id:x.id,changePct:x.changePct}));
    return {asOf,provenance:snapshot.provenance,priority:snapshot.priority,sessions:snapshot.sessions,
      markets:{KR:kr,US:us},trends,liquidity,sectors,events,bridge,crossMarket,tick:tickLabel,changes};
  }
  function response(analysis,snapshot){
    return Object.fromEntries(['KR','US'].map(id=>{
      const market=analysis.markets[id];
      const breadth=snapshot.indicators[id+'BREADTH'];
      const turnover=snapshot.indicators[id+'TURN'];
      const volumeConfirmed=usable(turnover)&&Number.isFinite(turnover.previous)&&turnover.previous>0;
      const breadthConfirmed=usable(breadth);
      const guarded=['riskOff','volatile','unknown'].includes(market.regime);
      const highEvent=analysis.events.highRisk;
      const day=guarded?'관망 우선':market.regime==='riskOn'&&breadthConfirmed&&breadth.value>=55&&
        volumeConfirmed&&turnover.value>=turnover.previous&&!highEvent?'적극적 탐색 가능':'선별적 진입';
      const sustained=market.leaders.some(sector=>sector.relative5d>0);
      const swing=market.regime==='riskOff'||market.regime==='volatile'?'위험 축소':
        market.regime==='riskOn'&&sustained&&!highEvent?'신규 진입 검토':'보유 포지션 관리 우선';
      const checks=[breadthConfirmed?'상승 종목 비율 '+breadth.value.toFixed(1)+'%':'시장 폭 확인 필요',
        volumeConfirmed?'시장 거래대금 변화 '+pct(turnover.value,turnover.previous)?.toFixed(1)+'%':'거래대금 비교값 확인 필요',
        '시초·장중 급등의 추격 진입과 변동성 확대에 유의',
        !analysis.events.connected?'경제 일정 미연결 · 일정 확인 필요':highEvent?'주요 발표 전후 변동성 유의':null,
        sustained?'상대강세 업종의 5거래일 강도 확인':'업종 강도 지속성 확인 필요'].filter(Boolean);
      return [id,{day,swing,checks}];
    }));
  }
  const api=Object.freeze({analyze,response,defaults});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.WorkMacroAnalysis=api;
})(modules);

;
(function(root){
  'use strict';
  const labels={unconnected:'미연결',unconfirmed:'미확인',close:'종가',delayed:'지연',realtime:'실시간',stale:'오래됨'};
  const units={points:'p',percent:'%',price:'',count:'',bp:'bp',amount:''};
  const local=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'});
  const value=(n,unit='')=>Number.isFinite(n)?n.toLocaleString('ko-KR',{maximumFractionDigits:4})+unit:'—';
  const time=t=>t==null?'—':local.format(t);
  const pct=n=>value(n,'%');
  const sessions={closed:'휴장',open:'정규장 개장','scheduled-unconfirmed':'정규장 시간대 · 공식 일정 미확인','outside-regular':'정규장 시간 외'};
  const risk={on:'위험 선호',off:'위험 회피',neutral:'중립',unknown:'미확인'};
  const confidence={high:'높음',limited:'제한적',insufficient:'판단 보류'};
  const sourceName=code=>({N:'네이버 금융',Y:'Yahoo Finance',D:'다음 금융'})[code]??code;

  function mount(target,{load,analyze,response,fixtures=[],preferences,defaults,settings}){
    const doc=target.ownerDocument;
    const el=(tag,t,cl)=>{
      const item=doc.createElement(tag);
      if(t!=null)item.textContent=t;
      if(cl)item.className=cl;
      return item;
    };
    const list=items=>{
      const ul=el('ul');
      for(const item of items)ul.append(el('li',item));
      return ul;
    };
    const block=(title,...items)=>{
      const section=el('section',null,'macro-section');
      section.append(el('h3',title),...items);
      return section;
    };
    const grid=items=>{const node=el('div',null,'macro-grid');node.append(...items);return node;};
    const table=(headers,rows)=>{
      const wrap=el('div',null,'macro-table'),t=el('table'),head=el('thead'),body=el('tbody');
      const tr=(tag,values)=>{const line=el('tr');line.append(...values.map(x=>el(tag,x)));return line;};
      head.append(tr('th',headers));body.append(...rows.map(x=>tr('td',x)));t.append(head,body);wrap.append(t);return wrap;
    };

    const shell=el('div',null,'work-macro');
    const toolbar=el('div',null,'macro-toolbar');
    const source=el('select');source.setAttribute('aria-label','데이터 모드');
    if(typeof load==='function')source.append(new Option('연결된 시장 데이터','live'));
    for(const fixture of fixtures)source.append(new Option(fixture.label,fixture.id));
    const marketSelect=el('select');marketSelect.setAttribute('aria-label','우선 표시 시장');
    marketSelect.append(new Option('시간 기준 자동','auto'),new Option('한국장 우선','KR'),new Option('미국장 우선','US'));
    const button=el('button','새로고침');button.type='button';
    const status=el('p',null,'macro-note');status.setAttribute('role','status');
    const content=el('div');
    toolbar.append(source,marketSelect,button);
    shell.append(el('h2','글로벌 거시경제·시장환경'),toolbar,status,content);
    target.replaceChildren(shell);
    let revision=0, current=null;
    function render(snap){
      const a=analyze(snap),s=response(a,snap),q=snap.indicators;
      const primary=marketSelect.value==='auto'?a.priority:marketSelect.value;
      const order=[primary,primary==='KR'?'US':'KR'];
      const pref=typeof settings?.layout==='function'?
        settings.layout(typeof preferences==='function'?preferences():preferences,{defaults,now:snap.now}).cards:null;
      const byId=id=>q[id]?.name??id;
      const why=id=>Object.values(a.markets).flatMap(m=>m.signals).filter(x=>x.ids.includes(id)).map(x=>x.description);
      const card=id=>{
        const r=q[id],detail=el('details',null,'macro-card');
        detail.dataset.indicator=id;
        detail.dataset.status=r.status;
        detail.dataset.observedAt=r.observedAt===null?'':String(r.observedAt);
        detail.dataset.source=r.source??'';
        detail.dataset.provenance=r.provenance;
        const summary=el('summary');
        summary.append(el('span',r.name),el('strong',value(r.value,units[r.unit])),el('small',labels[r.status]+' · '+pct(r.changePct)));
        const history=r.history.slice(-5).reverse();
        const t=a.trends[id];
        detail.append(summary,el('p',(sourceName(r.source)??'출처 없음')+' · 관측 '+time(r.observedAt)+' · 수신 '+time(r.receivedAt),'macro-note'));
        if(r.issues.length)detail.append(el('p',r.issues.map(code=>({
          UNCONNECTED:'데이터 미연결',SOURCE_ERROR:'공급자 수신 실패',VALUE_MISSING:'시세 없음',SOURCE_MISSING:'출처 없음',
          OBSERVATION_UNKNOWN:'공급자 시각 없음',TIME_INVALID:'시각 불일치',UNIT_MISMATCH:'단위 불일치',
          CURRENCY_MISMATCH:'통화 불일치',PROVENANCE_MISMATCH:'데이터 종류 불일치',VALUE_INVALID:'비정상 값'
        })[code]||code).join(' · '),'macro-note'));
        if(t)detail.append(el('p','단기 평균 '+value(t.maFast)+' · 중기 평균 '+value(t.maSlow)+' · 최근 수익률 '+pct(t.recentReturn)));
        if(t?.benchmark)detail.append(el('p',byId(t.benchmark)+' 대비 '+value(t.relativePctPoints,'%p')));
        if(why(id).length)detail.append(list([...new Set(why(id))]));
        if(history.length)detail.append(table(['최근 거래일','시세'],history.map(x=>[time(x.at),value(x.value,units[r.unit])])));
        return detail;
      };
      const sectionIds=(market,ids)=>{
        if(!pref)return ids;
        const mapped=pref[market].map(x=>[x,ids.find(id=>q[id].symbol&&q[id].symbol===x.y)||
          (x.id==='k3'?'K200F':x.id==='k4'?'KQ150F':null)]).filter(([,id])=>ids.includes(id));
        const known=new Set(mapped.map(([,id])=>id));
        return [...new Set([...mapped.filter(([x])=>x.vis).map(([,id])=>id),...ids.filter(id=>!known.has(id))])];
      };
      const headline=block('글로벌 시장 종합 판단',
        el('p','미국 시장은 '+a.markets.US.label+', 한국 시장은 '+a.markets.KR.label+'입니다. '+(primary==='KR'?'한국장':'미국장')+'을 우선 표시합니다.','macro-lead'),
        grid(order.map(id=>block(id==='KR'?'한국 시장':'미국 시장',el('strong',a.markets[id].label),
          el('p',sessions[a.sessions[id].status]+' · 판단 근거 충족 '+pct(a.markets[id].coverage*100)+
            ' · 신뢰도 '+confidence[a.markets[id].confidence],'macro-note')))));
      const changes=block('핵심 시장 변화',a.changes.length?
        table(['지표','이전 관측 대비'],a.changes.map(x=>[byId(x.id),pct(x.changePct)])):
        el('p','비교할 수 있는 관측값이 없습니다.'),
        el('h4','미국 시장에서 한국장으로 이어지는 관찰 지표'),
        el('p',a.crossMarket.bias,'macro-lead'),
        el('p',a.crossMarket.factors.map(x=>byId(x.id)+' '+(x.direction>0?'우호':x.direction<0?'부담':'중립')).join(' · '),'macro-note'),
        table(['지표','관찰 이유','변화','자료 상태'],a.bridge.map(x=>[byId(x.id),x.reason,
          x.id==='US10Y'?value(x.changeBp,'bp'):x.id==='KRFLOW'?value(x.value,'원'):pct(x.changePct),labels[x.status]])));
      const market=block('미국·한국 주요 지수 및 선물',...order.map(id=>block(id==='KR'?'한국':'미국',
        grid(sectionIds(id,id==='KR'?['KOSPI','KOSDAQ','K200F','KQ150F']:['SPX','NASDAQ','DOW','RUT','SOX','ES','NQ','YM']).map(card)))));
      const macro=block('금리·환율·변동성 및 원자재',
        el('p','미국 2년물 '+value(a.liquidity.us2yBp,'bp')+' · 미국 10년물 '+value(a.liquidity.us10yBp,'bp')+
          ' · 장단기 금리차 변화 '+value(a.liquidity.curveChangeBp,'bp')+
          (a.liquidity.growthRateRisk===true?' · 성장주의 금리 민감도 점검':''),'macro-note'),
        grid(['US2Y','US10Y','CURVE','KR3Y','KR10Y','CREDIT','DXY','KRW','EURUSD','USDJPY','VIX','WTI','GOLD','COPPER'].map(card)));
      const signals=block('시장 위험 선호와 상충 신호',...order.map(id=>{
        const m=a.markets[id];
        return block(id==='KR'?'한국장 '+risk[m.risk]:'미국장 '+risk[m.risk],
          m.signals.length?table(['신호','근거'],m.signals.map(x=>[x.sign===1?'긍정':x.sign===-1?'경계':'중립',x.description])):
          el('p','종합 판단에 필요한 신호를 수집하지 못했습니다.'),
          list([...m.conflicts,...m.missing.map(x=>'미확인 · '+(x.ids.map(byId).join(', ')||'업종 비교')),
            ...m.invalidators.map(x=>'판단 변경 조건 · '+x)]));
      }),grid(['TICK','USBREADTH','KRBREADTH','USADV','USDECL','KRADV','KRDECL','KRFLOW','KRINST','USTURN','KRTURN'].map(card)),
      el('p',a.tick?'NYSE $TICK · '+a.tick:'NYSE $TICK · 확인된 최근 관측값 없음','macro-note'));
      const sectors=block('산업별 상대강도',el('p','같은 시점의 시장 기준 대비 초과수익을 보여줍니다. 순유입·순유출은 별도 자료가 필요합니다.','macro-note'),
        ...order.map(id=>block(id==='KR'?'한국 업종':'미국 섹터',
          table(['업종','시장 대비 %p','최근 상대강도 %p','거래량 변화','거래대금 변화','상태'],a.sectors.filter(x=>x.market===id)
            .map(x=>[x.name,value(x.relative),value(x.relative5d),pct(x.volumeChange),pct(x.turnoverChange),labels[x.status]])))));
      const events=block('주요 경제 이벤트',
        !a.events.connected?el('p','공식 일정 미연결 · 발표 일정을 표시할 수 없습니다.'):
          table(['시장','이벤트','시각 KST','중요도','결과–예상','출처'],[...a.events.recent,...a.events.upcoming].map(x=>
            [x.market,x.name,time(x.at),({high:'높음',medium:'보통',low:'낮음'})[x.importance]||'미확인',value(x.surprise,x.unit??''),x.source])),
        a.events.highRisk?el('p','24시간 이내 주요 발표 · 발표 전후 변동성에 주의','macro-warning'):el('span'));
      const strategy=block('단타·스윙 투자 대응',grid(order.map(id=>block(id==='KR'?'한국장':'미국장',
        el('p','단타 · '+s[id].day),el('p','스윙 · '+s[id].swing),list(s[id].checks)))));
      const diagnostics=block('데이터 출처·기준시각·진단',el('p','분석 기준 '+time(a.asOf)+' KST · '+
        (a.provenance==='synthetic'?'합성 데이터':'연결 데이터')+' · 판단에 사용 가능 '+Object.values(q).filter(x=>x.usable).length+
        '/'+Object.keys(q).length+'개'),table(['지표','상태','출처','관측 KST','수신 KST'],Object.values(q).map(x=>
        [x.name,labels[x.status],sourceName(x.source)??'—',time(x.observedAt),time(x.receivedAt)])));
      content.replaceChildren(headline,changes,market,macro,signals,sectors,events,strategy,diagnostics);
    }
    marketSelect.addEventListener('change',()=>{if(current)render(current);});
    async function refresh(){
      const run=++revision;
      current=null;
      content.replaceChildren();
      status.textContent='시장 데이터를 준비하고 있습니다.';
      try{
        const mode=source.value;
        const data=mode==='live'?await load():fixtures.find(x=>x.id===mode)?.snapshot();
        if(run!==revision)return;
        if(!data)throw new Error('NO_SNAPSHOT');
        render(data);
        current=data;
        status.textContent=data.provenance==='synthetic'?'합성 시나리오 · 실제 시장 시세와 구분됩니다.':'기존 시장 데이터 연결 · 누락 항목은 미연결로 표시됩니다.';
      }catch{
        if(run!==revision)return;
        content.replaceChildren();status.textContent='시장 자료를 처리할 수 없습니다. 연결 상태를 확인한 뒤 다시 시도하세요.';
      }
    }
    source.addEventListener('change',refresh);button.addEventListener('click',refresh);
    void refresh();
    return {refresh,dispose(){revision++;current=null;target.replaceChildren();}};
  }
  const api=Object.freeze({mount});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.WorkMacroView=api;
})(modules);

;
(function(root){
  'use strict';
  const core=['SPX','NASDAQ','DOW','RUT','SOX','KOSPI','KOSDAQ','ES','NQ','YM','US10Y','DXY','KRW','VIX','WTI','GOLD','COPPER'];
  const extra=['EURUSD','USDJPY','XLK','XLF','XLE','XLY','XLP','XLV','XLI','XLU','XLC','XLB','XLRE'];
  function connect(target,{readText,active,legacy,preferences,defaults,calendar,ids=core}){
    if(typeof readText!=='function'||typeof active!=='function'||typeof legacy!=='function')throw new TypeError('TRANSPORT_REQUIRED');
    let pending=null;
    function load(){
      if(pending)return pending;
      // The host returns a scope identifier that changes on logout or relay change.
      const scope=active();
      if(!scope)return Promise.reject(new Error('AUTH_SCOPE_REQUIRED'));
      const guarded=async url=>{
        if(active()!==scope)throw new Error('AUTH_SCOPE_CHANGED');
        const text=await readText(url);
        if(active()!==scope)throw new Error('AUTH_SCOPE_CHANGED');
        return text;
      };
      const data=root.WorkMacroData;
      pending=data.collect({ids,marketData:root.MarketDataV2.create({readText:guarded}),
        readSeries:data.yahooSeries(guarded),staticRows:data.legacyQuotes(legacy()),calendar})
        .then(result=>{if(active()!==scope)throw new Error('AUTH_SCOPE_CHANGED');return result;})
        .finally(()=>{pending=null;});
      return pending;
    }
    return root.WorkMacroView.mount(target,{load,analyze:root.WorkMacroAnalysis.analyze,response:root.WorkMacroAnalysis.response,
      preferences,defaults,settings:root.WorkMarketSettings});
  }
  root.WorkMacroIntegration=Object.freeze({connect,core:Object.freeze(core),extra:Object.freeze(extra)});
})(modules);

;
(function () {
  'use strict';
  const expected = 'https://kocoro97-corab.github.io';
  const page = /^\/dashboard-v2-dev\/(?:index\.html)?$/;
  if (location.origin !== expected || !page.test(location.pathname) || location.search || (location.hash && !(window.AppRouter && AppRouter.validHash(location.hash)))) {
    console.info('MY INVEST V2 개발 페이지에서 실행하세요.');
    return;
  }
  const app = document.getElementById('appContainer');
  const cards = document.getElementById('cards');
  if (!app || !cards || typeof getTxt !== 'function' || typeof LS !== 'function') {
    console.info('개발 화면이 로드된 뒤 다시 실행하세요.');
    return;
  }
  const previous = document.getElementById('workMacroLivePreview');
  if (previous) {
    previous.querySelector('button')?.focus();
    return;
  }
  const container = document.createElement('section');
  container.id = 'workMacroLivePreview';
  const open = document.createElement('button');
  open.type = 'button';
  open.textContent = '거시경제 분석 · 실제 시세로 열기';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '닫기';
  close.hidden = true;
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const target = document.createElement('div');
  const style = document.createElement('style');
  style.textContent = ".work-macro{color:#e4edf8;max-width:100%;min-width:0}\n.work-macro h2{font-size:clamp(20px,4vw,31px);margin:6px 0 14px}\n.work-macro h3{font-size:16px;margin:0 0 10px}\n.work-macro h4{margin:16px 0 7px}\n.work-macro p{margin:6px 0}.work-macro ul{padding-left:22px;margin:7px 0}\n.macro-toolbar{display:flex;flex-wrap:wrap;gap:8px}\n.macro-toolbar select,.macro-toolbar button{border:1px solid #526b85;border-radius:7px;background:#1b2e44;color:#edf5ff;padding:7px}\n.macro-section{background:#111d2d;border:1px solid #293e58;padding:14px;border-radius:12px;margin:10px 0;min-width:0}\n.macro-section .macro-section{background:#152539}\n.macro-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,195px),1fr));gap:8px;min-width:0}\n.macro-card{border:1px solid #3a5169;background:#17283c;border-radius:9px;padding:9px;min-width:0}\n.macro-card summary{cursor:pointer;list-style-position:inside}\n.macro-card strong,.macro-card small{display:block;margin-top:4px}\n.macro-card strong{font-size:20px;color:#c1f8eb}.macro-card small,.macro-note{color:#adc3dc;font-size:12px}\n.macro-table{overflow:auto;max-width:100%;margin-top:8px}\n.macro-table table{border-collapse:collapse;width:100%;text-align:left}\n.macro-table th,.macro-table td{padding:6px 9px;border-bottom:1px solid #324860;vertical-align:top}\n.macro-table th{color:#b5d9f0}\n.macro-lead{color:#aef4e3;font-size:16px;font-weight:650}\n.macro-warning{color:#ffd59b}\n@media(max-width:520px){.macro-section{padding:9px}.macro-card{padding:6px}.macro-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.macro-table{font-size:11px}.macro-card strong{font-size:16px}}\n";
  container.append(style, open, close, status, target);
  cards.parentElement.after(container);
  let current = null;
  let scopeToken = null;
  let scopeEndpoint = null;
  let scope = null;
  function canOpen() {
    const config = window.MYINVEST_TRANSPORT_CONFIG;
    const token = LS('invest_session_token');
    if (!config?.publicMarket || !config.endpoint || !token || app.style.display !== 'block' ||
        (typeof sessionLeftMs === 'function' && sessionLeftMs() <= 0)) return false;
    return true;
  }
  function getScope() {
    if (!canOpen()) return null;
    return LS('invest_session_token') === scopeToken && window.MYINVEST_TRANSPORT_CONFIG.endpoint === scopeEndpoint ? scope : null;
  }
  function clear() {
    current?.dispose();
    current = null;
    scopeToken = null;
    scopeEndpoint = null;
    scope = null;
    target.replaceChildren();
    open.hidden = false;
    close.hidden = true;
  }
  const observer = new MutationObserver(() => {
    if (current && !getScope()) clear();
    const disabled = !canOpen();
    for (const button of [open, ...target.querySelectorAll('button')]) {
      if (button.disabled !== disabled) button.disabled = disabled;
    }
    if (close.disabled) close.disabled = false;
  });
  observer.observe(app, {attributes: true, attributeFilter: ['style']});
  // DevelopmentInspection disables app buttons on login. Restore only this
  // public-data widget's controls; existing authentication/permissions stay intact.
  observer.observe(container, {subtree: true, attributes: true, attributeFilter: ['disabled']});
  open.disabled = !canOpen();
  close.addEventListener('click', clear);
  container.addEventListener('dashboard:pageleave', clear);
  open.addEventListener('click', () => {
    const config = window.MYINVEST_TRANSPORT_CONFIG;
    scopeToken = LS('invest_session_token');
    scopeEndpoint = config?.endpoint;
    scope = {};
    if (!getScope()) {
      status.textContent = '기존 개발 페이지에서 공개 시장 연결과 로그인을 완료한 후 다시 눌러 주세요.';
      return;
    }
    status.textContent = '';
    open.hidden = true;
    close.hidden = false;
    current = modules.WorkMacroIntegration.connect(target, {
      readText: url => getTxt(url), active: getScope,
      legacy: () => ({quotes: Q, sources: SRC, received: QT, futures: FQ}),
      preferences: () => CFG, defaults: DEF,
      ids: ['SPX', 'NASDAQ', 'SOX', 'KOSPI', 'KRW', 'VIX', 'US10Y']
    });
  });
})();

})();
