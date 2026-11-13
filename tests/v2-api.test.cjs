const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');const crypto=require('node:crypto');
function app(){
  const sheets=new Map(),calls=[];const props={NHPLUG_TOKEN:'SYNTHETIC_NH_TOKEN',NHPLUG_TOKEN_EXP:String(Date.now()+3600000)};
  function getSheet(name){
    if(!sheets.has(name)){
      const rows=[];sheets.set(name,{rows,getLastRow:()=>rows.length,appendRow:r=>rows.push([...r]),getDataRange:()=>({getValues:()=>rows.map(r=>[...r])}),getRange:(row,col,count=1,width=1)=>({
        getValues:()=>Array.from({length:count},(_,i)=>Array.from({length:width},(_,j)=>rows[row+i-1]?.[col+j-1]??'')),
        setNumberFormat(){return this},setValues(values){values.forEach((r,i)=>{rows[row+i-1]??=[];r.forEach((v,j)=>rows[row+i-1][col+j-1]=v)})}
      })});
    }return sheets.get(name);
  }
  const c=vm.createContext({Date,getSheet,jsonResponse:x=>x,SpreadsheetApp:{flush(){}},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k],setProperty:(k,v)=>props[k]=v})},
    Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()],sleep(){},formatDate:()=> 'synthetic timestamp'},
    UrlFetchApp:{fetch:(url,options)=>{calls.push({url,options});assert.equal(options.followRedirects,false);let body;
      if(url.endsWith('/n2/acctinfo'))body={Output_0:[{acct_no:'SYNTHETIC_ACCOUNT_CANARY',acct_type:'01'}]};
      else if(url.endsWith('/balance'))body={Output_0:{},Output_1:[{iem_cd:'SYNTHETIC_FINANCIAL_CANARY',iem_nm:'Synthetic balance',itg_bnc_qty:9,cns_bse_bnc_qty:8,now_pr:10,fc_sec_end_pr:11,cur_cd:'USD'}]};
      else if(url.endsWith('/currentPrice'))body={Output_0:{iem_cd:'000001',stck_prpr:12}};
      else throw Error('unexpected synthetic endpoint');
      return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({...body,rsp_cd:'00000'}),getHeaders:()=>({})};
    }}});
  for(const file of ['NhGatewayV2','NhForeignIdentityV2','NhAccountsV2','Nhplug','AccountStoreV2','ExternalHoldings','NhSnapshotV2','Security'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../gas/'+file+'.gs'),'utf8'),c);
  c.securitySession_=token=>['alice','bob'].includes(token)?{u:token,p:false}:null;c.sessionUser_=token=>c.securitySession_(token)?.u;c.verifyAdmin=token=>token==='alice';c.securityWithLock_=fn=>fn();
  c.securityLegacyDoPost_=e=>{const b=JSON.parse(e.postData.contents);if(b.action==='nhAccounts')return c.handleNhAccounts(b.token);if(b.action==='nhExternalQuotes')return c.handleNhExternalQuotes(b.token,b.codes);return {success:false}};
  return {c,sheets,calls,props,call:(action,extra={},token='alice')=>c.doPost({postData:{contents:JSON.stringify({action,token,...extra})}})};
}
const row={accountType:'ISA',code:'000001',name:'Synthetic instrument',quantity:2,avgPrice:10,source:'manual'};
test('existing API actions complete store/edit/restore/quotes through actual V2 modules',()=>{
  const a=app(),initial=a.call('externalHoldings');assert.equal(initial.storeEngine,'account-store-v2');
  const saved=a.call('saveExternalHoldings',{holdings:[row],expectedRevision:initial.revision,confirmReplace:true});assert.equal(saved.success,true);
  const quote=a.call('nhExternalQuotes',{codes:['000001']});assert.equal(quote.prices['000001'].price*row.quantity,24);
  const edited=a.call('saveExternalHoldings',{holdings:[{...row,quantity:3}],expectedRevision:saved.revision,confirmReplace:true});assert.equal(edited.success,true);
  const history=a.call('externalHistory');const original=history.history.find(x=>x.holdings[0]?.quantity===2);
  assert.equal(a.call('restoreExternalHoldings',{snapshotId:original.snapshotId,expectedRevision:edited.revision,confirmReplace:true}).success,true);
  assert.equal(a.call('externalHoldings').holdings[0].quantity,2);
  const cleaned=a.call('saveExternalHoldings',{holdings:[],expectedRevision:a.call('externalHoldings').revision,confirmReplace:true});assert.equal(cleaned.success,true);assert.equal(a.call('externalHoldings').holdings.length,0);
});
test('NH balances are displayed through authenticated API but never written to journal',()=>{
  const a=app();a.call('externalHoldings');const r=a.call('nhAccounts');assert.equal(r.success,true);assert.equal(r.accounts[0].domestic.holdings[0].quantity,9);
  assert.ok(!JSON.stringify(r).includes('SYNTHETIC_ACCOUNT_CANARY'));assert.ok(r.accounts[0].accountKey);assert.equal(r.capabilities.IRP.status,'NOT_RUN');
  assert.ok(!JSON.stringify([...a.sheets.values()].map(s=>s.rows)).includes('SYNTHETIC_FINANCIAL_CANARY'));
});
test('entry guards block non-admin NH balances and isolate external holdings',()=>{
  const a=app();assert.equal(a.call('nhAccounts',{},'bob').success,false);assert.equal(a.calls.length,0);
  const r=a.call('externalHoldings');a.call('saveExternalHoldings',{holdings:[row],expectedRevision:r.revision,confirmReplace:true});assert.equal(a.call('externalHoldings',{},'bob').holdings.length,0);
  assert.equal(a.call('externalHoldings',{},'invalid').success,false);
});
test('stale revision and invalid input preserve the committed snapshot through entrypoint',()=>{
  const a=app(),before=a.call('externalHoldings');a.call('saveExternalHoldings',{holdings:[row],expectedRevision:before.revision,confirmReplace:true});
  assert.equal(a.call('saveExternalHoldings',{holdings:[],expectedRevision:before.revision,confirmReplace:true}).code,'STORE_CONFLICT');
  assert.equal(a.call('saveExternalHoldings',{holdings:[{...row,quantity:-1}],expectedRevision:a.call('externalHoldings').revision,confirmReplace:true}).success,false);
  assert.equal(a.call('externalHoldings').holdings.length,1);
});

function freshApp(){
  const a=app();a.c.ScriptApp={getScriptId:()=> 'SYNTHETIC_FRESH_SCRIPT_123456789'};
  a.props.APP_ENV='nh-staging';a.props.NH_V2_FRESH_TEST='true';a.props.STAGING_SHEET_ID='SYNTHETIC_FRESH_SHEET_123456789';
  a.c.stagingProjectGuard_=()=>{};a.c.stagingSheet_=()=>{};return a;
}
test('fresh NH snapshots preserve native markets and reread the captured result exactly',()=>{
  const a=freshApp(),before=a.call('nhSnapshotRead');assert.equal(before.success,true);
  const result=a.call('nhSnapshotCapture',{expectedRevision:before.revision,confirmReplace:true});assert.equal(result.success,true);
  const after=a.call('nhSnapshotRead');assert.equal(JSON.stringify(after.accounts),JSON.stringify(result.accounts));
  assert.equal(after.accounts[0].domestic.holdings[0].quantity,9);assert.equal(after.accounts[0].overseas.holdings[0].currency,'USD');
  assert.ok(JSON.stringify(a.sheets.get('NhReadSnapshotsV2').rows).includes('SYNTHETIC_FINANCIAL_CANARY'));
  assert.equal(a.sheets.has('ExternalHoldings'),false);
});
test('snapshot persistence rejects old test project, old Sheet and production context before storage/NH',()=>{
  for(const mode of ['old-script','old-sheet','no-bridge','not-fresh','non-admin']){
    const a=freshApp();if(mode==='old-script')a.c.ScriptApp.getScriptId=()=> '1Yt2DM0m4wObHnH0ZqgMh0KMzXnK_O3YH7beDGkEcUCN5gOY832AjSzmw';
    if(mode==='old-sheet')a.props.STAGING_SHEET_ID='1oQA2wD_0jtGVOezLclzUyejsYA2Z-3X_kkD7-by0tsY';
    if(mode==='no-bridge')a.c.stagingProjectGuard_=undefined;if(mode==='not-fresh')a.props.NH_V2_FRESH_TEST='false';
    const r=a.call('nhSnapshotRead',{},mode==='non-admin'?'bob':'alice');assert.equal(r.success,false);assert.equal(a.sheets.size,0);assert.equal(a.calls.length,0);
  }
});
test('snapshot capture requires confirmation/current revision before any NH call',()=>{
  const a=freshApp(),initial=a.call('nhSnapshotRead');
  assert.equal(a.call('nhSnapshotCapture',{expectedRevision:'wrong',confirmReplace:true}).code,'STORE_CONFLICT');
  assert.equal(a.call('nhSnapshotCapture',{expectedRevision:initial.revision,confirmReplace:false}).code,'STORE_CONFIRM');assert.equal(a.calls.length,0);
});
test('partial NH inquiry never replaces previously committed native snapshot',()=>{
  const a=freshApp(),initial=a.call('nhSnapshotRead');const saved=a.call('nhSnapshotCapture',{expectedRevision:initial.revision,confirmReplace:true});
  const original=a.c.nhCall_;a.c.nhCall_=(p,input,opt)=>{if(p.includes('/gbstock/'))throw Error('SYNTHETIC_PRIVATE_TOKEN_CANARY');return original(p,input,opt)};
  const result=a.call('nhSnapshotCapture',{expectedRevision:saved.revision,confirmReplace:true});assert.equal(result.code,'NH_INCOMPLETE');
  assert.equal(a.call('nhSnapshotRead').revision,saved.revision);assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_TOKEN_CANARY'));
});
test('native snapshot restore uses AccountStoreV2 revision protection',()=>{
  const a=freshApp(),initial=a.call('nhSnapshotRead');a.call('nhSnapshotCapture',{expectedRevision:initial.revision,confirmReplace:true});
  const saved=a.call('nhSnapshotRead'),id=saved.history[0].snapshotId;
  assert.equal(a.call('nhSnapshotRestore',{snapshotId:id,expectedRevision:saved.revision,confirmReplace:true}).success,true);
  const result=a.call('nhSnapshotRead');assert.equal(result.accounts.length,0);assert.notEqual(result.revision,initial.revision);
});
