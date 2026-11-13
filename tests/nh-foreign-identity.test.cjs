const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const f=require('./nh-foreign-fixtures.cjs'),read=name=>fs.readFileSync(path.join(__dirname,'../gas/'+name+'.gs'),'utf8');
function context(){const c=vm.createContext({sessionUser_:()=> 'synthetic',jsonResponse:x=>x});vm.runInContext(read('NhForeignIdentityV2'),c);vm.runInContext(read('NhAccountsV2'),c);vm.runInContext(read('Nhplug'),c);return c}
function reference(c,rows,codes=['SYNTH',f.row.gic,f.row.isin]){return c.createNhForeignReferenceV2_(Buffer.concat(rows.map(f.record)),codes,f.proof)}
test('official header contract requires all byte fields and CP949/164 declarations',()=>{
 const c=context();assert.equal(c.nhForeignHeaderValidV2_(f.header),true);for(const change of [f.header.replace('sGIC[15]','sGIC[14]'),f.header.replace('cp949','UTF8'),f.header.replace('@record 164','@record 165')])assert.equal(c.nhForeignHeaderValidV2_(change),false);
});
test('same official record binds ticker, GIC and ISIN without name guessing',()=>{
 const c=context(),r=reference(c,[f.row]);for(const alias of [f.row.symbol,f.row.gic,f.row.isin]){const identity=r.resolve(alias,'USD');assert.equal(identity.row.symbol,'SYNTH');for(const response of [f.row.symbol,f.row.gic,f.row.isin+' '])assert.equal(r.matches(identity,response),true);assert.equal(r.matches(identity,'DIFFERENT'),false)}
});
test('byte slicing ignores multibyte names and only strips documented right padding',()=>{
 const c=context(),r=reference(c,[f.row]);assert.equal(r.resolve('SYNTH','USD').row.gic,f.row.gic);assert.equal(r.matches(r.resolve('SYNTH','USD'),' SYNTH'),false);assert.equal(r.matches(r.resolve('SYNTH','USD'),'synth'),false);
});
test('duplicate ticker listings remain ambiguous unless exact currency makes one unique',()=>{
 const c=context(),r=reference(c,[f.row,{...f.row,gic:'GBRSYNTHETIC002',country:'GBR',exchange:'LSE',currency:'GBP'}]);assert.throws(()=>r.resolve('SYNTH'),e=>e.safeCode==='NH_IDENTITY_AMBIGUOUS');assert.equal(r.resolve('SYNTH','GBP').row.exchange,'LSE');
});
test('same currency in different listings cannot be resolved by guessing an exchange',()=>{
 const c=context(),r=reference(c,[f.row,{...f.row,gic:'USASYNTHETIC002',exchange:'NYS'}]);assert.throws(()=>r.resolve('SYNTH','USD'),e=>e.safeCode==='NH_IDENTITY_AMBIGUOUS');
});
test('unlisted identifiers and currency mismatch are rejected',()=>{
 const c=context(),r=reference(c,[f.row],['SYNTH','UNKNOWN']);assert.throws(()=>r.resolve('UNKNOWN'),e=>e.safeCode==='NH_IDENTITY_UNVERIFIED');assert.throws(()=>r.resolve('SYNTH','EUR'),e=>e.safeCode==='NH_IDENTITY_UNVERIFIED');assert.throws(()=>r.resolve('SYNTH','usd'),e=>e.safeCode==='NH_CURRENCY_MISMATCH');
});
test('partial records, altered LF and control bytes fail closed',()=>{
 const c=context();for(const b of [Buffer.alloc(0),f.record().subarray(0,163),Buffer.from(f.record())]){if(b.length===164)b[163]=13;assert.throws(()=>c.createNhForeignReferenceV2_(b,['SYNTH'],f.proof),e=>e.safeCode==='NH_REFERENCE_INVALID')}
 const bad=f.record();bad[0]=0;assert.throws(()=>c.createNhForeignReferenceV2_(bad,['SYNTH'],f.proof),e=>e.safeCode==='NH_REFERENCE_INVALID');
});
function quoted({responseCode=f.row.gic,currency='USD',price=22.5,rows=[f.row]}={}){
 const c=context(),calls=[];f.install(c,rows);c.nhCall_=(p,input)=>{calls.push({p,input});return {http:200,body:{rsp_cd:'00000',Output_0:{iem_cd:responseCode,trdprc:price,currency_unit:currency}}}};
 return {c,calls,run:(code=f.row.isin)=>c.handleNhStockQuotesV2('synthetic',[{market:'OVERSEAS',code,currency:'USD'}])};
}
test('quote requests official ticker and accepts only the bound response GIC/ISIN',()=>{
 const q=quoted(),r=q.run();assert.equal(q.calls[0].input.iem_cd,'SYNTH');assert.equal(r.prices['OVERSEAS:'+f.row.isin].price,22.5);assert.equal(r.prices['OVERSEAS:'+f.row.isin].identity.verified,true);assert.equal(r.prices['OVERSEAS:'+f.row.isin].identity.sourceSha256,'a'.repeat(64));
});
test('another security with a valid price and same currency is still rejected',()=>{
 const q=quoted({responseCode:'OTHER'}),r=q.run();assert.equal(Object.keys(r.prices).length,0);assert.equal(r.diagnostics['OVERSEAS:'+f.row.isin].code,'NH_SYMBOL_MISMATCH');
});
test('verified identifier does not excuse absent price or wrong settlement currency',()=>{
 for(const options of [{price:0},{currency:'GBP'}]){const r=quoted(options).run();assert.equal(Object.keys(r.prices).length,0);assert.equal(r.diagnostics['OVERSEAS:'+f.row.isin].code,options.price===0?'NH_NO_PRICE':'NH_CURRENCY_MISMATCH')}
});
test('ambiguity fails before any authenticated NH quote request',()=>{
 const q=quoted({rows:[f.row,{...f.row,gic:'USASYNTHETIC002',exchange:'NYS'}]}),r=q.run();assert.equal(q.calls.length,0);assert.equal(r.diagnostics['OVERSEAS:'+f.row.isin].code,'NH_IDENTITY_AMBIGUOUS');
});
test('reference load failure occurs once per batch and returns fixed diagnostics',()=>{
 const c=context();let loads=0,quotes=0;c.nhForeignReferenceV2_=()=>{loads++;throw Object.assign(Error('SYNTHETIC_PRIVATE_CANARY'),{safeCode:'NH_REFERENCE_INVALID'})};c.nhCall_=()=>{quotes++};
 const r=c.handleNhStockQuotesV2('synthetic',[{market:'OVERSEAS',code:'SYNTH'},{market:'OVERSEAS',code:'OTHER'}]);assert.equal(loads,1);assert.equal(quotes,0);assert.ok(!JSON.stringify(r).includes('SYNTHETIC_PRIVATE_CANARY'));
});
test('public master requests use exact GET tuples, no credentials, and no redirects',()=>{
 const calls=[],c=vm.createContext({UrlFetchApp:{fetch:(url,options)=>{calls.push({url,options});return {getResponseCode:()=>200}}}});vm.runInContext(read('NhGatewayV2'),c);vm.runInContext(read('Nhplug'),c);
 for(const p of ['/instruments/m_gtsstock.h','/instruments/m_gtsstock.mst']){c.nhRequest_('https://www.nhplug.com',p,'get','reference');assert.throws(()=>c.nhRequest_('https://www.nhplug.com',p+'?symbol=SYNTH','get','reference'),e=>e.safeCode==='NH_PATH');assert.throws(()=>c.nhRequest_('https://www.nhplug.com',p,'get','reference',{token:'SYNTHETIC_TOKEN'}),e=>e.safeCode==='NH_CONFIG')}
 assert.equal(calls.length,2);for(const x of calls){assert.equal(x.options.headers,undefined);assert.equal(x.options.followRedirects,false);assert.equal(x.options.method,'get')}
});
test('reference loader hashes exact public bytes and records download-time-only provenance',()=>{
 const calls=[],bytes=f.record(),c=context();c.Utilities={DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(algorithm,data)=>[...crypto.createHash(algorithm).update(typeof data==='string'?data:Buffer.from(data)).digest()]};
 c.nhRequest_=(origin,p,method,purpose)=>{calls.push({origin,p,method,purpose});return {getResponseCode:()=>200,getContentText:()=>f.header,getBlob:()=>({getBytes:()=>bytes})}};
 const identity=c.nhForeignReferenceV2_(['SYNTH']).resolve('SYNTH','USD');
 assert.equal(calls.length,2);assert.equal(identity.proof.sourceSha256,crypto.createHash('sha256').update(bytes).digest('hex'));assert.equal(identity.proof.headerSha256,crypto.createHash('sha256').update(f.header).digest('hex'));assert.equal(identity.proof.freshness,'DOWNLOAD_TIME_ONLY');assert.ok(Number.isFinite(Date.parse(identity.proof.fetchedAt)));
});
test('invalid official header and redirects stop before downloading or accepting master bytes',()=>{
 for(const http of [200,301,302,303,307,308]){const c=context();let calls=0;c.nhRequest_=()=>{calls++;return {getResponseCode:()=>http,getContentText:()=> 'changed format'}};assert.throws(()=>c.nhForeignReferenceV2_(['SYNTH']),e=>e.safeCode===(http===200?'NH_REFERENCE_INVALID':'NH_REFERENCE_UNAVAILABLE'));assert.equal(calls,1)}
});
