(function(root){
  'use strict';
  function build({accounts=[],external=[],prices={},nhLoaded=false,nhPartial=false,externalLoaded=false,draft=false,analyze}){
    let partial=!nhLoaded||nhPartial||!externalLoaded||draft;const rows=[],details=[];
    accounts.forEach((account,i)=>{
      if(account.errors?.length)partial=true;
      for(const market of ['domestic','overseas']){
        const data=account[market];if(!data){partial=true;continue}
        if(data.partial||data.stale)partial=true;
        for(const h of data.holdings||[]){
          const row={...h,accountKey:'nh-'+i,market,source:'NH',draft:false};rows.push(row);
          details.push({...row,accountLabel:'NH 계좌 '+(i+1),valuationCurrency:'KRW'});
        }
      }
    });
    external.forEach(h=>{
      const matched=h.match?.status==='matched',quote=matched?prices[h.code]:null;
      const currentPrice=Number.isFinite(quote?.price)&&quote.price>0?quote.price:null;
      const row={...h,code:matched?h.code:null,accountKey:'external-'+h.accountType,market:'domestic',currency:'KRW',currentPrice,
        evalAmount:null,profit:null,source:({ocr:'OCR',drive:'Drive',manual:'수동'})[h.source]||'저장자료 · 입력방식 미확인',draft,
        quoteSource:quote?.source||null,observedAt:quote?.updatedAt||quote?.t||null};
      rows.push(row);details.push({...row,accountLabel:({ISA:'ISA',PENSION:'연금저축',IRP:'IRP'})[h.accountType]||'외부계좌',valuationCurrency:'KRW'});
    });
    const result=analyze({holdings:rows,partial});
    const known=result.rows.filter(r=>r.valueKrw!==null);
    const sum=known.length?known.reduce((sum,r)=>sum+r.valueKrw,0):null;
    const subtotal=Number.isFinite(sum)?sum:null;
    const incomplete=partial||known.length!==rows.length;
    return {result,details,knownSubtotal:subtotal,complete:!incomplete&&rows.length>0,
      status:rows.length?(incomplete?'partial':result.status):'unqueried',nhLoaded,externalLoaded,draft};
  }
  const api=Object.freeze({build});if(typeof module==='object'&&module.exports)module.exports=api;else root.AccountOverview=api;
})(globalThis);
