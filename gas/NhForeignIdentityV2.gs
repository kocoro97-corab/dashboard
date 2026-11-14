// NH official overseas master identity proof. No names, prices, holdings or credentials in logs.
const NH_FOREIGN_MASTER_FIELDS=[['sGIC',15],['sKorName',40],['sEngName',40],['sNationCode',3],['sSymbol',12],['sStockCode',3],['sStandardCode',12],['gIssue',2],['gIndustryReuter',4],['sIndustryKorea',4],['gLock',2],['gPosTrade',1],['gPayMoney',3],['gListed',1],['gTOPIX100',1],['sOriginNationCode',3],['sOriginSymbol',12],['sOriginCurrency',3],['sDecimalPoint',1],['sTradePoint',1],['dummy',1]];
function nhForeignIdentityFailureV2_(code){const e=new Error(code);e.safeCode=code;throw e}
function nhForeignHeaderValidV2_(text){
  const fields=[];const re=/^\s*char\s+([A-Za-z][A-Za-z0-9_]*)\[(\d+)\]\s*;/gm;let m;
  while((m=re.exec(text)))fields.push([m[1],Number(m[2])]);
  return /@record\s+164\b/.test(text)&&/@encoding\s+cp949\b/i.test(text)&&JSON.stringify(fields)===JSON.stringify(NH_FOREIGN_MASTER_FIELDS);
}
function createNhForeignReferenceV2_(bytes,requestedCodes,proof){
  if(!bytes||!Number.isInteger(bytes.length)||bytes.length===0||bytes.length>8*1024*1024||bytes.length%164!==0)nhForeignIdentityFailureV2_('NH_REFERENCE_INVALID');
  const wanted=new Set(requestedCodes),byCode=new Map();
  function field(base,offset,length){
    let text='';for(let j=0;j<length;j++){const n=bytes[base+offset+j]&255;if(n<32||n>126)nhForeignIdentityFailureV2_('NH_REFERENCE_INVALID');text+=String.fromCharCode(n)}
    // The official header specifies right-space padding; no case/punctuation/prefix guessing.
    return text.replace(/ +$/,'');
  }
  for(let base=0;base<bytes.length;base+=164){
    if((bytes[base+163]&255)!==10)nhForeignIdentityFailureV2_('NH_REFERENCE_INVALID');
    const gic=field(base,0,15),symbol=field(base,98,12),isin=field(base,113,12);
    const aliases=[gic,symbol,isin].filter(Boolean);
    if(!aliases.some(code=>wanted.has(code)))continue;
    const row={gic:gic,symbol:symbol,isin:isin,country:field(base,95,3),exchange:field(base,110,3),currency:field(base,138,3)};
    if(!row.gic||!row.symbol||!row.country||!row.exchange||!/^[A-Z]{3}$/.test(row.currency))nhForeignIdentityFailureV2_('NH_REFERENCE_INVALID');
    for(const code of new Set(aliases))if(wanted.has(code)){if(!byCode.has(code))byCode.set(code,[]);byCode.get(code).push(row)}
  }
  function resolve(code,currency){
    let rows=byCode.get(code)||[];
    if(currency!==undefined){if(typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency))nhForeignIdentityFailureV2_('NH_CURRENCY_MISMATCH');rows=rows.filter(r=>r.currency===currency)}
    const distinct=[...new Map(rows.map(r=>[JSON.stringify(r),r])).values()];
    if(!distinct.length)nhForeignIdentityFailureV2_('NH_IDENTITY_UNVERIFIED');
    if(distinct.length!==1)nhForeignIdentityFailureV2_('NH_IDENTITY_AMBIGUOUS');
    return {row:distinct[0],proof:proof};
  }
  function matches(identity,code){
    if(typeof code!=='string')return false;
    const normalized=code.replace(/ +$/,'');
    return !!normalized&&[identity.row.gic,identity.row.symbol,identity.row.isin].filter(Boolean).includes(normalized);
  }
  return {resolve:resolve,matches:matches};
}
function nhForeignReferenceV2_(requestedCodes){
  const origin='https://www.nhplug.com';
  const header=nhRequest_(origin,'/instruments/m_gtsstock.h','get','reference');
  if(header.getResponseCode()!==200)throw nhFailure_('NH_REFERENCE_UNAVAILABLE',header.getResponseCode());
  const text=header.getContentText();
  if(!nhForeignHeaderValidV2_(text))throw nhFailure_('NH_REFERENCE_INVALID');
  const master=nhRequest_(origin,'/instruments/m_gtsstock.mst','get','reference');
  if(master.getResponseCode()!==200)throw nhFailure_('NH_REFERENCE_UNAVAILABLE',master.getResponseCode());
  const bytes=master.getBlob().getBytes();
  const hex=data=>Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,data).map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');
  return createNhForeignReferenceV2_(bytes,requestedCodes,{
    provider:'NH_OFFICIAL_OVERSEAS_MASTER',schema:'GTSSTOCK_164',sourceSha256:hex(bytes),headerSha256:hex(text),
    fetchedAt:new Date().toISOString(),freshness:'DOWNLOAD_TIME_ONLY'
  });
}
