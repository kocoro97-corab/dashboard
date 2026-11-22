/* Synthetic, native-shaped return values for validation of existing dashboard
 * HomeMarketPolicy.quote + IndustryData.groups/members + chart output contract.
 * No provider, account or market calls. This is NOT a live data source.
 */
(function(root){
'use strict';
const dayMs=86400000;
function fixture(market='US',scenario='default'){
 if(!['KR','US'].includes(market))return null;
 const now=Date.now();
 const id=market==='US'?'^GSPC':'^KS11',at=now-3600000;
 const homeQuote=root.HomeMarketPolicy?.quote?.(
  id,{[id]:{p:market==='US'?6000:3100,prev:market==='US'?5950:3090,observedAt:at}},
  {[id]:'Y'},{[id]:now-5000},now)||null;
 const times=Array.from({length:60},(_,i)=>Math.floor((now-(59-i)*dayMs-3600000)/1000));
 const bars=times.map((_,i)=>100+i);
 const benchmarkSeries={times,bars,volume:times.map((_,i)=>100+i),
  last:times.at(-1)*1000,currency:market==='KR'?'KRW':'USD',
  exchange:market==='KR'?'KSC':'PCX',instrumentType:'INDEX'};
 const sectorPage={market,category:'industry',
  benchmarkSymbol:market==='KR'?'^KS11':'SPY',
  benchmarkSeries,rows:[],benchmark:1.2,received:now-20000,
  period:'20d',failures:[],themes:[],asof:benchmarkSeries.last};
 let industryRead=null;
 if(market==='KR'){
  const base='https://m.stock.naver.com/api/stocks/industry';
  const e=new Date(at).toISOString();
  industryRead={
   groups:{rows:root.IndustryData.groups({groups:[{no:10,name:'기술',
    totalCount:3,riseCount:2,fallCount:1,steadyCount:0,changeRate:'1.1'}]}),
    total:1,receivedAt:now-12000,source:base+'?page=1&pageSize=100'},
   members:{rows:root.IndustryData.members({groupInfo:{no:10},stocks:[
    {itemCode:'005930',stockName:'삼성전자',stockExchangeType:{nameEng:'KOSPI'},
     localTradedAt:e,closePriceRaw:'10000',fluctuationsRatio:'1.2'},
    {itemCode:'000660',stockName:'SK하이닉스',stockExchangeType:{nameEng:'KOSPI'},
     localTradedAt:e,closePriceRaw:'20000',fluctuationsRatio:'-0.2'}
   ]},'10'),total:3,receivedAt:now-12000,
    source:base+'/10?page=1&pageSize=100'}
  };
 }
 const barTimes=times.map(t=>t*1000);
 const stockBars=barTimes.map((t,i)=>({t,o:100+i,h:102+i,l:99+i,c:101+i,v:100+i}));
 const stockAnalysis={symbol:market==='US'?'SERV':'005930',
  provider:market==='US'?'SERV':'005930.KS',
  currency:market==='US'?'USD':'KRW',
  exchange:market==='US'?'NMS':'KSC',bars:stockBars,
  metrics:{last:stockBars.at(-1).c,change:1.0,ma20:150,
   ma5:155,ma60:130,rsi:60,high20:159,low20:136,
   volumeRatio:1.2,trend:'상승 추세 관찰'},
  source:market==='US'?'Yahoo Finance (SERV)':'Yahoo Finance (005930.KS)',
  observedAt:barTimes.at(-1),receivedAt:now-12000};
 if(scenario==='missing')sectorPage.benchmarkSeries=null;
 return {market,mode:'swing',now,homeQuote,sectorPage,industryRead,stockAnalysis};
}
root.MYInvestNativeContractSyntheticFixtureV1=Object.freeze({fixture});
})(window);
