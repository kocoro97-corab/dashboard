// NH V2 domain service. Verified NH field mapping; missing values remain null.
function createNhAccountServiceV2_(call) {
  function number(value){if(value==null||String(value).trim()==='')return null;const t=String(value).replace(/[,\s]/g,'');if(!/^[+-]?\d+(?:\.\d+)?$/.test(t))return null;const n=Number(t);return Number.isFinite(n)?n:null}
  function sum(rows,key){const values=rows.map(x=>number(x[key]));return values.some(x=>x===null)?null:values.reduce((a,b)=>a+b,0)}
  function total(summary,key,rows,rowKey){const n=number(summary[key]);return n===null?sum(rows,rowKey):n}
  function page(path,input,max){
    const rows=[],seen=new Set();let summary={},cts='',last=null,partial=false,pages=0,notice='';
    const limit=Math.min(20,Math.max(1,max||10));
    for(let p=0;p<limit;p++){
      last=call(path,input,cts?{cts:cts,cts_flag:'Y'}:null);pages++;nhAssertResponse_(last);
      const b=last.body,code=String(b.rsp_cd||'');
      if(b.Output_0&&!Array.isArray(b.Output_0))summary=Object.assign({},summary,b.Output_0);
      const block=Array.isArray(b.Output_1)?b.Output_1:Array.isArray(b.Output_0)?b.Output_0:[];
      block.forEach(x=>{if(!x||typeof x!=='object')throw nhFailure_('NH_JSON');const id=JSON.stringify(x);if(!seen.has(id)){seen.add(id);rows.push(x)}});
      const next=String(last.cts||b.cts||''),flag=String(last.cts_flag||b.cts_flag||'').toUpperCase();
      if(next&&next!==cts&&(flag==='Y'||code==='00218')){cts=next;if(p+1===limit){partial=true;notice='연속조회 제한'}continue}
      if(code==='00218'){partial=true;notice='연속조회 필요'}break;
    }
    return {summary:summary,rows:rows,pages:pages,partial:partial,notice:notice};
  }
  function balance(no){
    const result={domestic:null,overseas:null,errors:[]};
    for(const market of ['domestic','overseas']){
      try{
        const domestic=market==='domestic';
        const data=page(domestic?'/krstock/inquiry/v1/balance':'/gbstock/inquiry/v1/balance',domestic?{act_no:no,bnc_bse_cd:'5',ltg_aot_dit_cd:'1',aet_bse:'1',qut_dit_cd:'UNT',aly_qut_cd:'2'}:{act_no:no,qut_iqr_dit_cd:'9',fc_sec_trd_nat_cd:'000',cur_cd:'KRW',xns_dit_cd:'1'},10);
        const s=data.summary,rows=data.rows;
        const summary=domestic?{
          deposit:number(s.dca),netAsset:number(s.nas_amt),totalAsset:number(s.tot_aet_amt),buyAmount:number(s.tot_byn_amt),
          evalAmount:total(s,'tot_eal_amt',rows,'eal_amt'),profit:total(s,'tot_eal_pls',rows,'eal_pls_amt'),returnRate:number(s.pft_rt)
        }:{deposit:number(s.krw_dca),totalAsset:number(s.tot_aet_amt),evalAmount:total(s,'eal_amt_sum',rows,'krw_eal_amt'),profit:total(s,'eal_pls_sum_amt',rows,'krw_eal_pls_amt'),returnRate:number(s.krw_pft_rt)};
        result[market]={summary:summary,partial:data.partial,holdings:rows.map(x=>({
          name:String(x.iem_nm||''),code:String(x.iem_cd||''),country:domestic?'':String(x.fc_sec_trd_nat_nm||''),
          quantity:number(domestic?x.itg_bnc_qty:x.cns_bse_bnc_qty),avgPrice:number(domestic?x.phs_pr:x.fc_avg_phs_pr!=null?x.fc_avg_phs_pr:x.fc_phs_uit_pr),
          currentPrice:(number(domestic?x.now_pr:x.fc_sec_end_pr)>0?number(domestic?x.now_pr:x.fc_sec_end_pr):null),evalAmount:number(domestic?x.eal_amt:x.krw_eal_amt),
          profit:number(domestic?x.eal_pls_amt:x.krw_eal_pls_amt),returnRate:number(domestic?x.pft_rt:x.eal_pft_rt),
          currency:domestic?'KRW':/^[A-Z]{3}$/.test(String(x.cur_cd))?String(x.cur_cd):null
        }))};
        if(data.partial)result.errors.push((domestic?'국내주식: ':'해외주식: ')+'NH_INCOMPLETE');
      }catch(e){result.errors.push((market==='domestic'?'국내주식: ':'해외주식: ')+nhSafeErrorText_(e))}
    }
    return result;
  }
  return {number:number,page:page,balance:balance};
}
function nhAccountServiceV2_(){return createNhAccountServiceV2_((path,input,opt)=>nhCall_(path,input,opt))}
function nhAccountCapabilitiesV2_(){return {
  GENERAL:{status:'SUPPORTED',method:'NH_INQUIRY'},
  ISA:{status:'NOT_RUN',method:'OCR_OR_MANUAL'},
  PENSION:{status:'NOT_RUN',method:'OCR_OR_MANUAL'},
  IRP:{status:'NOT_RUN',method:'OCR_OR_MANUAL'}
}}
function handleNhStockQuotesV2(token,items){
  if(!sessionUser_(token))return jsonResponse({success:false,code:'AUTH_REQUIRED'});
  if(!Array.isArray(items)||!items.length||items.length>40)return jsonResponse({success:false,code:'INVALID_CODES'});
  const prices={},diagnostics={};
  items.forEach((item,index)=>{
    const market=item&&item.market,code=item&&item.code;
    if(typeof code!=='string'||!(market==='DOMESTIC'?/^[A-Z0-9]{6}$/:market==='OVERSEAS'?/^[A-Z0-9][A-Z0-9.-]{0,14}$/:/$a/).test(code)){
      diagnostics['invalid_'+(index+1)]={layer:'gas',code:'INVALID_SYMBOL'};return;
    }
    const key=market+':'+code;if(prices[key]||diagnostics[key])return;
    try{
      const r=nhCall_(market==='DOMESTIC'?'/krstock/quote/v1/currentPrice':'/gbstock/quote/v1/current',market==='DOMESTIC'?{market_cd:'UNT',iem_cd:code}:{iem_cd:code});nhAssertResponse_(r);
      const block=r.body.Output_0,o=Array.isArray(block)?block.find(x=>x&&x.iem_cd===code):block;
      if(!o||o.iem_cd&&o.iem_cd!==code)throw nhFailure_('NH_NO_PRICE');
      const price=market==='DOMESTIC'?nhExternalPrice_(o):nhAccountServiceV2_().number(o.trdprc);
      const currency=market==='DOMESTIC'?'KRW':/^[A-Z]{3}$/.test(String(o.currency_unit))?String(o.currency_unit):null;
      if(price==null||price<=0||!currency)throw nhFailure_('NH_NO_PRICE');
      prices[key]={price:price,currency:currency};
    }catch(e){const d=nhSafeDiagnostic_(e);diagnostics[key]={layer:'nh',code:d.code,http:d.http}}
  });
  return jsonResponse({success:true,prices:prices,diagnostics:diagnostics,gatewayVersion:2});
}
