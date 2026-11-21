const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){const c=vm.createContext({window:{},Date});vm.runInContext(fs.readFileSync('js/industry-data.js','utf8'),c);return c.window.IndustryData}
const groups={groups:[{no:285,name:'방송과엔터테인먼트',changeRate:'2.3',totalCount:10,riseCount:6,fallCount:3,steadyCount:1}]};
test('source counts produce breadth without invented scores or money flows',()=>{const api=fixture(),row=api.groups(groups)[0];assert.equal(row.breadth,60);assert.equal(row.rate,2.3);assert.equal(api.groups({groups:[{...groups.groups[0],riseCount:30}]})[0].breadth,null)});
test('industry identity and Raw currency amounts are validated independently',()=>{const api=fixture(),doc={groupInfo:{no:285},stocks:[{itemCode:'041510',stockName:'에스엠',stockExchangeType:{nameEng:'KOSDAQ'},closePrice:'1,000',localTradedAt:new Date().toISOString(),accumulatedTradingValue:'15,505',accumulatedTradingValueRaw:'15505000000',fluctuationsRatio:'2'}]};assert.equal(api.members(doc,285)[0].val,15505000000);assert.throws(()=>api.members(doc,332),/IDENTITY/);assert.equal(api.members({...doc,stocks:[{...doc.stocks[0],itemCode:'bad'}]},285).length,0)});
test('duplicate pending reads share one authenticated public read, rejected IDs never request',async()=>{const api=fixture();let calls=0,release;const ctx={data:{publicRead:async()=>{calls++;return new Promise(r=>release=r)}}},a=api.read(ctx),b=api.read(ctx);release(JSON.stringify(groups));await a;await b;assert.equal(calls,1);await api.read(ctx);assert.equal(calls,1);await assert.rejects(api.read(ctx,'../private'));assert.equal(calls,1)});

test('industry constituents de-duplicate listing IDs and never use negative raw turnover or volume',()=>{
 const api=fixture(),today=new Date().toISOString();
 const member={itemCode:'005930',stockName:'삼성전자',stockExchangeType:{nameEng:'KOSPI'},closePriceRaw:'100,000',localTradedAt:today,fluctuationsRatio:'-2.15',accumulatedTradingValueRaw:'-500000',accumulatedTradingVolumeRaw:'-400'};
 const rows=api.members({groupInfo:{no:285},stocks:[member,{...member,stockName:'삼성전자 중복'}, {...member,itemCode:'000660',closePriceRaw:'-1',accumulatedTradingValueRaw:'1200',accumulatedTradingVolumeRaw:'300'}]},285);
 assert.equal(rows.length,2);
 assert.equal(rows[0].code,'005930');assert.equal(rows[0].rate,-2.15);
 assert.equal(rows[0].val,null);assert.equal(rows[0].vol,null);assert.equal(rows[0].price,100000);
 assert.equal(rows[1].price,null);assert.equal(rows[1].val,1200);assert.equal(rows[1].vol,300);
});
