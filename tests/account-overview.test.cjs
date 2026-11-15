const {test}=require('node:test'),assert=require('node:assert/strict');
const {build}=require('../js/account-overview.js'),{analyze}=require('../js/work-portfolio.js');
const account={accountKey:'a'.repeat(64),domestic:{holdings:[{code:'123456',name:'Synthetic domestic',currency:'KRW',quantity:2,avgPrice:100,currentPrice:110,evalAmount:220,profit:20}]},overseas:{holdings:[{code:'TEST',name:'Synthetic overseas',currency:'USD',quantity:1,avgPrice:4,currentPrice:5,evalAmount:6000,profit:-1000,instrumentId:'US:XNAS:TEST'}]},errors:[]};
const base={accounts:[account],external:[],nhLoaded:true,externalLoaded:true,analyze};
test('NH original KRW values are not converted twice and input is preserved',()=>{
  const before=JSON.stringify(account),out=build(base);assert.equal(out.knownSubtotal,6220);assert.equal(out.result.summary.profitKrw,-980);assert.equal(out.complete,true);assert.equal(JSON.stringify(account),before);assert.equal(out.details[1].currency,'USD');
});
test('missing account side and an unqueried external store force partial scope',()=>{
  for(const change of [{externalLoaded:false},{externalPartial:true},{nhLoaded:false},{nhPartial:true},{accounts:[{...account,overseas:null}]}]){const out=build({...base,...change});assert.equal(out.complete,false);assert.equal(out.result.accounts[0].weight,null)}
});
test('a missing price keeps an explicit known subtotal and never becomes zero',()=>{
  const out=build({...base,external:[{accountType:'ISA',code:'123456',name:'Synthetic external',quantity:1,avgPrice:10,match:{status:'matched'}}]});
  assert.equal(out.complete,false);assert.equal(out.knownSubtotal,6220);assert.equal(out.result.summary.valueKrw,null);
});
test('unverified identity cannot consume a quote by an unverified code',()=>{
  const out=build({...base,external:[{accountType:'IRP',code:'123456',quantity:1,avgPrice:10,match:{status:'proposal'}}],prices:{'123456':{price:100}}});
  assert.equal(out.details.at(-1).currentPrice,null);assert.equal(out.details.at(-1).code,null);
});
test('same instrument retains account detail and aggregate exposure',()=>{
  const out=build({...base,external:[{accountType:'ISA',code:'123456',quantity:1,avgPrice:100,match:{status:'matched'}}],prices:{'123456':{price:110}},draft:true});
  assert.equal(out.details.length,3);assert.equal(out.result.exposures.find(x=>x.key==='KR:123456').valueKrw,330);assert.equal(out.complete,false);
});
test('confirmed same identity yields native quantity-weighted cost and KRW valuation',()=>{
  const out=build({...base,external:[{accountType:'ISA',code:'123456',name:'Synthetic external',quantity:3,avgPrice:200,match:{status:'matched'}}],prices:{'123456':{price:210}}});
  const row=out.combined.find(x=>x.identity==='KR:123456');assert.equal(row.quantity,5);assert.equal(row.avgPrice,160);assert.equal(row.accountCount,2);assert.equal(row.valueKrw,850);assert.equal(row.profitKrw,50);assert.equal(row.currentPrice,null);
});
test('same ticker without a verified foreign identity never merges across accounts',()=>{
  const foreign={...account.overseas.holdings[0],instrumentId:null,country:'미국'};
  const out=build({...base,accounts:[{...account,domestic:{holdings:[]},overseas:{holdings:[foreign]}},{...account,domestic:{holdings:[]},overseas:{holdings:[foreign]}}]});
  assert.equal(out.combined.length,2);assert.ok(out.combined.every(x=>x.verified===false));assert.equal(out.byMarket.find(x=>x.key==='해외').valueKrw,12000);
});
test('same verified identifier with different currencies remains separate',()=>{
  const foreign=account.overseas.holdings[0];const out=build({...base,accounts:[{...account,domestic:{holdings:[]},overseas:{holdings:[foreign,{...foreign,currency:'EUR'}]}}]});
  assert.equal(out.combined.length,2);assert.deepEqual(out.combined.map(x=>x.currency),['USD','EUR']);
});
test('unqueried data is unknown; only a confirmed empty read is zero',()=>{
  const unknown=build({analyze});assert.equal(unknown.knownSubtotal,null);assert.equal(unknown.result.summary.costKrw,null);assert.equal(unknown.result.summary.profitKrw,null);assert.equal(unknown.complete,false);assert.ok(unknown.byMarket.every(x=>x.valueKrw===null));
  const empty=build({nhLoaded:true,externalLoaded:true,analyze});assert.equal(empty.knownSubtotal,0);assert.equal(empty.result.summary.costKrw,0);assert.equal(empty.status,'empty');assert.equal(empty.complete,true);
});
test('receipt timestamps cannot be presented as latest observed market prices',()=>{
  const row={accountType:'IRP',code:'123456',quantity:1,avgPrice:10,match:{status:'matched'}};
  const receipt=build({...base,accounts:[],external:[row],prices:{'123456':{price:20,updatedAt:'2026-11-15T01:00:00Z'}}});assert.equal(receipt.details[0].receivedAt,'2026-11-15T01:00:00.000Z');assert.equal(receipt.combined[0].observedAt,null);assert.equal(receipt.combined[0].currentPrice,null);
  const observed=build({...base,accounts:[],external:[row],prices:{'123456':{price:20,observedAt:'2026-11-15T01:00:00Z'}}});assert.equal(observed.combined[0].currentPrice,20);
  assert.doesNotThrow(()=>build({...base,nhReceivedAt:1e50}));
  const future=build({...base,accounts:[],external:[row],prices:{'123456':{price:20,observedAt:Date.now()+86400000}}});assert.equal(future.combined[0].currentPrice,null);
});
test('a missing quote preserves known KRW acquisition cost and unknown P/L',()=>{
  const out=build({...base,external:[{accountType:'PENSION',code:'123456',quantity:1,avgPrice:10,match:{status:'matched'}}]});
  assert.equal(out.result.summary.costKrw,7210);assert.equal(out.result.summary.profitKrw,null);assert.equal(out.complete,false);
});
test('synthetic store-validation rows never enter real account totals or quantities',()=>{
  const out=build({...base,external:require('../data/account-test-holdings.json')});assert.equal(out.knownSubtotal,6220);assert.equal(out.details.length,2);assert.equal(out.testRows.length,3);assert.equal(out.combined.length,2);
});
