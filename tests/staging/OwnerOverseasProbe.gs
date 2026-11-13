// Optional owner-editor-only probe. Not in any deployment bundle or sourceDigest.
// Install/remove only through nh_v2_owner_probe.py; run once in the fresh test editor.
function ownerProbeOverseasQuote(){
  const report={mode:'OWNER_SERVER_OVERSEAS_QUOTE_SHAPE',status:'FAIL',storageWrites:false,orderCalls:0,nhQuoteRequested:false,rawFinancialDataIncluded:false};
  let store=null,user=null,before=null;
  try{
    if(typeof stagingProjectGuard_!=='function'||typeof stagingSheet_!=='function')throw Error('OWNER_PROBE_CONTEXT_REQUIRED');
    stagingProjectGuard_();
    const p=PropertiesService.getScriptProperties();
    if(p.getProperty('APP_ENV')!=='nh-staging'||p.getProperty('NH_V2_FRESH_TEST')!=='true'||ScriptApp.getScriptId()===NH_SNAPSHOT_OLD_SCRIPT||p.getProperty('STAGING_SHEET_ID')===NH_SNAPSHOT_OLD_SHEET)throw Error('OWNER_PROBE_CONTEXT_REQUIRED');
    const ss=stagingSheet_(),users=ss.getSheetByName('Users'),journal=ss.getSheetByName('NhReadSnapshotsV2');
    if(!users||!journal||users.getLastRow()<2)throw Error('OWNER_PROBE_STORE_REQUIRED');
    user=p.getProperty('STAGING_TEST_USER');
    const ids=users.getRange(2,1,users.getLastRow()-1,1).getValues();
    const index=ids.findIndex(r=>String(r[0]).trim()===user);
    if(index<0)throw Error('OWNER_PROBE_ADMIN_REQUIRED');
    // Read only status/admin columns; never read the password hash column.
    const role=users.getRange(index+2,3,1,2).getValues()[0];
    if(String(role[0])!=='approved'||String(role[1])!=='true')throw Error('OWNER_PROBE_ADMIN_REQUIRED');
    store=createAccountStoreV2_({
      sheet:(_name,columns)=>{
        if(JSON.stringify(journal.getRange(1,1,1,columns.length).getValues()[0])!==JSON.stringify(columns))throw Error('OWNER_PROBE_STORE_REQUIRED');
        return {getDataRange:()=>({getValues:()=>journal.getDataRange().getValues()})};
      },
      legacy:()=>[],validate:nhSnapshotValidateV2_,lock:securityWithLock_,
      hash:text=>Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text).map(b=>('0'+(b&255).toString(16)).slice(-2)).join(''),
      uuid:()=>{throw Error('OWNER_PROBE_READ_ONLY')},now:()=>{throw Error('OWNER_PROBE_READ_ONLY')},flush:()=>{throw Error('OWNER_PROBE_READ_ONLY')}
    });
    before=store.read(user);
    const rows=before.holdings.flatMap(a=>(a.overseas&&a.overseas.holdings)||[]);
    const selected=rows.find(h=>typeof h.code==='string'&&/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(h.code));
    if(!selected)throw Error('OWNER_PROBE_NO_SYMBOL');
    report.candidateHasPositiveQuantity=typeof selected.quantity==='number'&&Number.isFinite(selected.quantity)&&selected.quantity>0;
    report.nhQuoteRequested=true;
    const r=nhCall_('/gbstock/quote/v1/current',{iem_cd:selected.code});
    if(Number.isInteger(r.http)&&r.http>=100&&r.http<=599)report.http=r.http;
    nhAssertResponse_(r);
    const block=r.body.Output_0;
    const exact=Array.isArray(block)?block.find(x=>x&&x.iem_cd===selected.code):block;
    const trimmed=Array.isArray(block)?block.find(x=>x&&typeof x.iem_cd==='string'&&x.iem_cd.trim()===selected.code):block;
    const o=exact||trimmed||Array.isArray(block)&&block[0]||{};
    const number=nhAccountServiceV2_().number(o.trdprc);
    const currency=typeof o.currency_unit==='string'?o.currency_unit:'';
    report.outputBlockPresent=!!block;
    report.outputBlockIsArray=Array.isArray(block);
    report.exactSelectedBlockPresent=!!exact;
    report.symbolPresent=typeof o.iem_cd==='string'&&!!o.iem_cd;
    report.symbolMatches=!!o.iem_cd&&o.iem_cd===selected.code;
    report.symbolMatchesAfterTrim=typeof o.iem_cd==='string'&&o.iem_cd.trim()===selected.code;
    report.priceFieldPresent=Object.prototype.hasOwnProperty.call(o,'trdprc');
    report.priceNumeric=number!==null;
    report.pricePositive=number!==null&&number>0;
    report.currencyFieldPresent=Object.prototype.hasOwnProperty.call(o,'currency_unit');
    report.currencyValid=/^[A-Z]{3}$/.test(currency);
    report.currencyValidAfterTrim=/^[A-Z]{3}$/.test(currency.trim());
    report.currencyValidAfterTrimUppercase=/^[A-Z]{3}$/.test(currency.trim().toUpperCase());
    report.currencyMatchesBalance=currency===selected.currency;
    report.currencyMatchesBalanceAfterTrimUppercase=typeof selected.currency==='string'&&currency.trim().toUpperCase()===selected.currency;
    report.knownRegularClosePositive=nhAccountServiceV2_().number(o.normal_trdprc)>0;
    report.knownPreviousClosePositive=nhAccountServiceV2_().number(o.hst_trdprc)>0;
    report.quoteAcceptedByCurrentRules=!!exact&&(!exact.iem_cd||exact.iem_cd===selected.code)&&report.pricePositive&&report.currencyValid;
    // PASS here means diagnostic completed, not that the quote or whole flow passed.
    report.status='PASS';
  }catch(e){
    const own=['OWNER_PROBE_CONTEXT_REQUIRED','OWNER_PROBE_STORE_REQUIRED','OWNER_PROBE_ADMIN_REQUIRED','OWNER_PROBE_READ_ONLY','OWNER_PROBE_NO_SYMBOL'];
    report.code=own.includes(e&&e.message)?e.message:nhSafeDiagnostic_(e).code;
  }finally{
    if(store&&before){
      try{const after=store.read(user);report.storedSnapshotUnchanged=after.revision===before.revision&&JSON.stringify(after.holdings)===JSON.stringify(before.holdings);if(!report.storedSnapshotUnchanged){report.status='FAIL';report.code='OWNER_PROBE_CONCURRENT_CHANGE'}}
      catch(e){report.status='FAIL';report.code='OWNER_PROBE_READBACK_FAILED'}
    }
    Logger.log(JSON.stringify(report));
  }
}
