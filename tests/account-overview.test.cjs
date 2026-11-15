const {test}=require('node:test'),assert=require('node:assert/strict');
const {build}=require('../js/account-overview.js'),{analyze}=require('../js/work-portfolio.js');
const account={accountKey:'a'.repeat(64),domestic:{holdings:[{code:'123456',name:'Synthetic domestic',currency:'KRW',quantity:2,avgPrice:100,currentPrice:110,evalAmount:220,profit:20}]},overseas:{holdings:[{code:'TEST',name:'Synthetic overseas',currency:'USD',quantity:1,avgPrice:4,currentPrice:5,evalAmount:6000,profit:-1000,instrumentId:'US:XNAS:TEST'}]},errors:[]};
const base={accounts:[account],external:[],nhLoaded:true,externalLoaded:true,analyze};
test('NH original KRW values are not converted twice and input is preserved',()=>{
  const before=JSON.stringify(account),out=build(base);assert.equal(out.knownSubtotal,6220);assert.equal(out.result.summary.profitKrw,-980);assert.equal(out.complete,true);assert.equal(JSON.stringify(account),before);assert.equal(out.details[1].currency,'USD');
});
test('missing account side and an unqueried external store force partial scope',()=>{
  for(const change of [{externalLoaded:false},{nhLoaded:false},{nhPartial:true},{accounts:[{...account,overseas:null}]}]){const out=build({...base,...change});assert.equal(out.complete,false);assert.equal(out.result.accounts[0].weight,null)}
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
