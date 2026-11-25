(function(root){
  'use strict';
  const finite=value=>Number.isFinite(value)?value:null;
  const sum=values=>values.some(value=>!Number.isFinite(value))?null:finite(values.reduce((total,value)=>total+value,0));
  function time(value){const n=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN,date=new Date(n);return Number.isFinite(date.getTime())&&n>0&&n<=Date.now()+60000?date.toISOString():null}
  function consolidate(details,analysis){
    const grouped=new Map();
    details.forEach((row,i)=>{
      const identity=analysis[i].identity,currency=analysis[i].currency;
      // Unknown overseas exchange/identity must never be inferred from a ticker.
      const key=identity&&currency?JSON.stringify([identity,row.market,currency]):'unknown-'+i;
      if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push({row,calculated:analysis[i]});
    });
    return [...grouped.values()].map(items=>{
      const {row,calculated}=items[0],quantity=sum(items.map(x=>x.row.quantity>=0?x.row.quantity:null)),nativeCost=sum(items.map(x=>Number.isFinite(x.row.quantity)&&x.row.quantity>=0&&Number.isFinite(x.row.avgPrice)&&x.row.avgPrice>=0?finite(x.row.quantity*x.row.avgPrice):null));
      const observed=items.filter(x=>x.row.observedAt&&Number.isFinite(x.row.currentPrice)&&x.row.currentPrice>0).sort((a,b)=>Date.parse(b.row.observedAt)-Date.parse(a.row.observedAt));
      const valueKrw=sum(items.map(x=>x.calculated.valueKrw)),costKrw=sum(items.map(x=>x.calculated.costKrw)),profitKrw=sum(items.map(x=>x.calculated.profitKrw));
      return {identity:calculated.identity,code:row.code,name:row.name,market:row.market,currency:calculated.currency,quantity,
        avgPrice:quantity>0&&nativeCost!==null?finite(nativeCost/quantity):null,
        currentPrice:observed[0]?.row.currentPrice??null,observedAt:observed[0]?.row.observedAt??null,
        valueKrw,costKrw,profitKrw,returnPct:costKrw>0&&profitKrw!==null?finite(profitKrw/costKrw*100):null,
        accountCount:new Set(items.map(x=>x.row.accountKey)).size,verified:!!calculated.identity,partial:items.some(x=>x.calculated.valueKrw===null),draft:items.some(x=>x.row.draft)};
    });
  }
  function build({accounts=[],external=[],prices={},catalog=[],nhLoaded=false,nhPartial=false,nhReceivedAt=null,externalLoaded=false,externalUpdatedAt=null,externalPartial=false,draft=false,analyze}){
    let partial=!nhLoaded||nhPartial||!externalLoaded||externalPartial||draft;const rows=[],details=[],testRows=external.filter(row=>row.source==='synthetic-test');
    accounts.forEach((account,i)=>{
      if(account.errors?.length)partial=true;
      for(const market of ['domestic','overseas']){
        const data=account[market];if(!data){partial=true;continue}
        if(data.partial||data.stale)partial=true;
        for(const h of data.holdings||[]){
          const validCode=typeof h.code==='string'&&(market==='domestic'?/^[A-Z0-9]{6}$/:/^[A-Za-z0-9][A-Za-z0-9._-]{0,14}$/).test(h.code);
          const row={...h,code:validCode?h.code:null,instrumentId:market==='domestic'?null:h.instrumentId,accountKey:'nh-'+i,market,source:'NH',draft:false,receivedAt:time(nhReceivedAt),observedAt:time(h.observedAt)};rows.push(row);
          details.push({...row,broker:'NH나무증권',accountType:'GENERAL',accountLabel:'일반계좌 '+(i+1),valuationCurrency:'KRW'});
        }
      }
    });
    external.filter(row=>row.source!=='synthetic-test').forEach(h=>{
      const account=catalog.find(x=>x.id===(h.accountId||'legacy-'+h.accountType));
      const matched=h.match?.status==='matched'&&/^[A-Z0-9]{6}$/.test(h.code),quote=matched?prices[h.code]:null;
      const currentPrice=Number.isFinite(quote?.price)&&quote.price>0?quote.price:null;
      const row={...h,code:matched?h.code:null,accountKey:h.accountId&&!h.accountId.startsWith('legacy-')?h.accountId:'external-'+h.accountType,market:'domestic',currency:'KRW',currentPrice,
        evalAmount:null,profit:null,source:({ocr:'OCR',drive:'Drive',manual:'수동'})[String(h.source||'').toLowerCase()]||'저장자료 · 입력방식 미확인',draft,storedAt:time(externalUpdatedAt),
        quoteSource:quote?.source||null,receivedAt:time(quote?.updatedAt),observedAt:time(quote?.observedAt)};
      rows.push(row);details.push({...row,broker:account?.broker||'증권사 미지정',accountLabel:account?.accountName||({ISA:'ISA',PENSION:'연금저축',IRP:'IRP',GENERAL:'일반 외부계좌'})[h.accountType]||'외부계좌',valuationCurrency:'KRW'});
    });
    const result=analyze({holdings:rows,partial});
    const known=result.rows.filter(r=>r.valueKrw!==null),confirmedEmpty=!partial&&rows.length===0;
    const subtotal=known.length?sum(known.map(r=>r.valueKrw)):confirmedEmpty?0:null;
    const incomplete=partial||known.length!==rows.length;
    if(!rows.length&&!confirmedEmpty)result.summary={valueKrw:null,costKrw:null,profitKrw:null,returnPct:null};
    const byMarket=['domestic','overseas'].map(market=>{const values=result.rows.filter((r,i)=>details[i].market===market),valueKrw=values.length||confirmedEmpty?sum(values.map(r=>r.valueKrw)):null;return {key:market==='domestic'?'국내':'해외',valueKrw,profitKrw:values.length||confirmedEmpty?sum(values.map(r=>r.profitKrw)):null,weight:!incomplete&&result.summary.valueKrw>0&&valueKrw!==null?valueKrw/result.summary.valueKrw:null}});
    return {result,details,testRows,combined:consolidate(details,result.rows),byMarket,knownSubtotal:subtotal,complete:!incomplete,
      status:rows.length?(incomplete?'partial':result.status):confirmedEmpty?'empty':'unqueried',nhLoaded,externalLoaded,draft};
  }
  const api=Object.freeze({build});if(typeof module==='object'&&module.exports)module.exports=api;else root.AccountOverview=api;
})(globalThis);
