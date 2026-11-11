const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const core=require('../js/external_core.js');
const document=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/krx-instruments.json')));
const index=core.master(document);
for(const account of ['isa','pension','irp'])test(account+' synthetic OCR keeps values on the same physical row, removes cash/menu noise and duplicate captures',()=>{
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures',account+'-ocr.json')));
  const result=core.parse(fixture.data,fixture.accountType,index);
  assert.equal(result.holdings.length,fixture.expected.length);
  result.holdings.forEach((row,i)=>{assert.equal(row.accountType,fixture.accountType);for(const key of ['name','code','quantity','avgPrice'])assert.equal(row[key],fixture.expected[i][key],key)});
  assert.ok(result.rejected.length>0);assert.ok(result.holdings.every(x=>x.name!=='현금'));
});
test('cash-like listed ETF is verified by its full master name rather than excluded by substring',()=>{
  const row=index.byCode.get('455890');const found=core.match({name:row.name,code:row.code},index);
  assert.equal(found.status,'matched');assert.equal(found.type,'ETF');
  assert.equal(core.match({name:'현금',code:''},index).status,'invalid');
  assert.equal(core.match({name:'SYNTHETIC 현금성 상품',code:''},index).status,'unmatched');
});
test('unknown OCR aliases are never guessed and preferred-share names remain distinct',()=>{
  for(const name of ['KCC2atA','YHA','카카오우','카카O'])assert.equal(core.match({name,code:''},index).code,null);
  assert.equal(core.match({name:' KCC 글라스 ',code:''},index).proposedCode,'344820');
  assert.equal(core.match({name:'씨앤투스',code:'130120'},index).status,'conflict');
  assert.equal(core.match({name:'카카오',code:'35720'},index).status,'conflict');
});
test('missing master, ambiguous names, and partial names are review-only',()=>{
  assert.equal(core.match({name:'카카오'},null).status,'unavailable');
  const ambiguous=core.master({schema:1,source:{},instruments:[{code:'000001',name:'fixture',type:'STOCK'},{code:'000002',name:'fixture',type:'ETF'}]});
  assert.equal(core.match({name:'fixture'},ambiguous).status,'ambiguous');
  assert.equal(core.match({name:'KCC글'},index).status,'unmatched');
});
test('OCR does not steal numbers from adjacent cash or quantity-only rows',()=>{
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/isa-ocr.json')));
  const y=fixture.data.words.find(x=>x.text==='카카오').bbox.y0;
  fixture.data.words=fixture.data.words.filter(x=>!(x.bbox.y0===y&&x.bbox.x0>=600));
  // Remove duplicate complete capture so it cannot fill in an incomplete row.
  fixture.data.words=fixture.data.words.filter(x=>x.bbox.y0!==845);
  const row=core.parse(fixture.data,'ISA',index).holdings.find(x=>x.name==='카카오');
  assert.equal(row.quantity,null);assert.equal(row.avgPrice,null);assert.equal(row.needsReview,true);
});
test('missing headers or missing word coordinates do not trigger positional guessing',()=>{
  assert.equal(core.parse({text:'카카오 10 100'},'ISA',index).holdings.length,0);
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/irp-ocr.json')));
  fixture.data.words=fixture.data.words.filter(x=>x.bbox.y0!==180);
  assert.match(core.parse(fixture.data,'IRP',index).warnings[0],/머리글/);
});
test('merge previews conflicts without mutating stored rows; same symbol in different account types is distinct',()=>{
  const saved=[{accountType:'ISA',code:'035720',name:'카카오',quantity:101,avgPrice:20100}];
  const incoming=[{...saved[0],quantity:202},{...saved[0],accountType:'IRP'}];
  const plan=core.merge(saved,incoming);
  assert.equal(saved[0].quantity,101);assert.equal(plan.conflicts.length,1);assert.equal(plan.rows.length,2);
  assert.equal(core.merge(saved,saved).duplicates.length,1);
});
test('master provenance and six-character stock/ETF coverage are explicit',()=>{
  assert.ok(document.instruments.length>2500);
  assert.ok(document.instruments.some(x=>x.type==='ETF'));assert.ok(document.instruments.some(x=>x.market==='KOSDAQ'));
  assert.ok(document.instruments.every(x=>/^[A-Z0-9]{6}$/.test(x.code)));
  assert.match(document.source.upstream,/not a direct KRX/);
  assert.ok(document.source.archives.every(x=>/^[a-f0-9]{64}$/.test(x.sha256)));
});
test('the word 현금 inside a fully verified ETF name is not stripped as a purchase label',()=>{
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/irp-ocr.json')));
  fixture.data.words=fixture.data.words.filter(w=>!(w.bbox.y0===250&&w.bbox.x0===50));
  const word=(text,x)=>({text,bbox:{x0:x,x1:x+40,y0:250,y1:270}});
  fixture.data.words.push(word('TEST',50),word('현금',110),word('ETF',170));
  const cashMaster=core.master({schema:1,source:{},instruments:[{code:'000001',name:'TEST 현금 ETF',type:'ETF'}]});
  const product=core.parse(fixture.data,'IRP',cashMaster).holdings.find(x=>x.code==='000001');
  assert.equal(product.name,'TEST 현금 ETF');assert.equal(product.quantity,101);
});
test('an explicit code column is separated from the name and contradictory OCR codes are not silently replaced',()=>{
  const w=(text,x,width,y)=>({text,bbox:{x0:x,x1:x+width,y0:y,y1:y+20}});
  const data={words:[w('종목코드',10,90,100),w('종목명',150,100,100),w('수량',610,110,100),w('평균매입가',800,140,100),w('999999',10,80,200),w('카카오',150,100,200),w('101',650,40,200),w('20,100',840,90,200)]};
  const result=core.parse(data,'ISA',index);assert.equal(result.holdings.length,1);assert.equal(result.holdings[0].name,'카카오');assert.equal(result.holdings[0].code,'');assert.match(result.warnings[0],/불일치/);
  data.words.find(x=>x.text==='999999').text='035720';assert.equal(core.parse(data,'ISA',index).holdings[0].code,'035720');
});
