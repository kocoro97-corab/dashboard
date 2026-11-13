// Synthetic fixed-width records; offsets follow NH's public GTSSTOCK 164-byte header.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const fields=[['sGIC',15],['sKorName',40],['sEngName',40],['sNationCode',3],['sSymbol',12],['sStockCode',3],['sStandardCode',12],['gIssue',2],['gIndustryReuter',4],['sIndustryKorea',4],['gLock',2],['gPosTrade',1],['gPayMoney',3],['gListed',1],['gTOPIX100',1],['sOriginNationCode',3],['sOriginSymbol',12],['sOriginCurrency',3],['sDecimalPoint',1],['sTradePoint',1],['dummy',1]];
const header='/* @record 164 @encoding cp949 */\n'+fields.map(([name,size])=>'char '+name+'['+size+'];').join('\n');
const row={gic:'USASYNTHETIC001',symbol:'SYNTH',isin:'ZZ0000000001',country:'USA',exchange:'NAS',currency:'USD'};
function record(x={}){const r={...row,...x},b=Buffer.alloc(164,32);for(const [name,offset,size]of [['gic',0,15],['country',95,3],['symbol',98,12],['exchange',110,3],['isin',113,12],['currency',138,3]]){const value=Buffer.from(r[name],'ascii');if(value.length>size)throw Error('bad synthetic field');value.copy(b,offset)}b[15]=0xb0;b[16]=0xa1;b[163]=10;return b}
const proof={provider:'NH_OFFICIAL_OVERSEAS_MASTER',schema:'GTSSTOCK_164',sourceSha256:'a'.repeat(64),headerSha256:'b'.repeat(64),fetchedAt:'synthetic-fetch-time',freshness:'DOWNLOAD_TIME_ONLY'};
function install(ctx,rows=[row]){if(typeof ctx.createNhForeignReferenceV2_!=='function')vm.runInContext(fs.readFileSync(path.join(__dirname,'../gas/NhForeignIdentityV2.gs'),'utf8'),ctx);const bytes=Buffer.concat(rows.map(record));ctx.nhForeignReferenceV2_=codes=>ctx.createNhForeignReferenceV2_(bytes,codes,proof)}
module.exports={record,row,header,proof,install};
