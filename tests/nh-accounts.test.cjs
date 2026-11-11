const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
function backend({overseasFailure=false,paged=false}={}){
  let domesticPages=0;const calls=[];
  const ctx=vm.createContext({sessionUser_:token=>token==='test-token'?'fixture-owner':null,jsonResponse:x=>x,Utilities:{formatDate:()=> 'fixture timestamp'}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../gas/Nhplug.gs'),'utf8'),ctx);
  ctx.nhCall_=(endpoint,input,options)=>{
    calls.push({endpoint,input,options});
    if(endpoint==='/n2/acctinfo')return {http:200,body:{Output_0:[{acct_no:'SYNTHETIC-ACCOUNT-A',acct_type:'01'},{acct_no:'SYNTHETIC-MOCK',acct_type:'03'},{acct_no:'SYNTHETIC-PENSION',acct_type:'04'}]}};
    if(endpoint==='/krstock/inquiry/v1/balance'){
      domesticPages++;
      return {http:200,cts:paged&&domesticPages===1?'NEXT-PAGE':'',cts_flag:paged&&domesticPages===1?'Y':'',body:{rsp_cd:paged&&domesticPages===1?'00218':'00000',Output_0:{tot_eal_amt:paged?402:201,tot_eal_pls:0,dca:0},Output_1:[{iem_nm:'Synthetic domestic',iem_cd:domesticPages===1?'000001':'000002',itg_bnc_qty:3,phs_pr:67,now_pr:67,eal_amt:201,eal_pls_amt:0,pft_rt:0}]}};
    }
    if(endpoint==='/gbstock/inquiry/v1/balance')return overseasFailure?{http:503,body:{rsp_cd:'SERVICE_DOWN'}}:{http:200,body:{rsp_cd:'00000',Output_0:{eal_amt_sum:1000,eal_pls_sum_amt:0,krw_dca:0},Output_1:[{iem_nm:'Synthetic overseas',iem_cd:'TEST',cns_bse_bnc_qty:5,fc_avg_phs_pr:2,fc_sec_end_pr:2,krw_eal_amt:1000,krw_eal_pls_amt:0,eal_pft_rt:0,cur_cd:'USD'}]}};
    throw Error('Unexpected endpoint');
  };
  return {ctx,calls,read:()=>ctx.handleNhAccounts('test-token')};
}
test('NH domestic/overseas holdings, zero profit, and mock/pension exclusion are preserved',()=>{
  const b=backend();const result=b.read();assert.equal(result.success,true);assert.equal(result.accounts.length,1);
  const account=result.accounts[0];assert.equal(account.domestic.holdings[0].currentPrice,67);assert.equal(account.domestic.holdings[0].quantity,3);
  assert.equal(account.overseas.holdings[0].currency,'USD');assert.equal(account.overseas.summary.profit,0);
  assert.equal(account.domestic.summary.profit,0);assert.equal(result.excludedMockCount,1);
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC-ACCOUNT-A'));assert.ok(b.calls.every(x=>!x.endpoint.includes('/order/')));
});
test('NH paged domestic holdings accumulate with continuation headers',()=>{
  const b=backend({paged:true});const result=b.read();assert.equal(result.accounts[0].domestic.holdings.length,2);
  const pages=b.calls.filter(x=>x.endpoint==='/krstock/inquiry/v1/balance');assert.equal(pages.length,2);assert.equal(pages[1].options.cts,'NEXT-PAGE');
});
test('overseas outage preserves domestic holdings and reports a partial failure',()=>{
  const result=backend({overseasFailure:true}).read();assert.equal(result.success,true);
  assert.equal(result.accounts[0].domestic.holdings.length,1);assert.equal(result.accounts[0].overseas,null);assert.match(result.accounts[0].errors[0],/HTTP 503/);
});
test('general accounts reject unauthenticated requests before upstream calls',()=>{
  const b=backend();assert.equal(b.ctx.handleNhAccounts('invalid').success,false);assert.equal(b.calls.length,0);
});
