const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
function fixture(){const props=new Map(),rows=new Map();let locked=false;
 const ctx=vm.createContext({});vm.runInContext(fs.readFileSync('gas/ExternalHoldings.gs','utf8'),ctx);
 const catalog=ctx.createExternalAccountCatalog_({properties:{getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v)},hash:value=>crypto.createHash('sha256').update(value).digest('hex'),holdings:user=>{assert.equal(locked,true);return rows.get(user)||[]},lock:fn=>{assert.equal(locked,false);locked=true;try{return fn()}finally{locked=false}},now:()=> '2026-11-16T00:00:00.000Z'});
 const read=(user='alice')=>catalog.read(user),save=(accounts,brokers=['Synthetic Broker'],revision=read().revision,user='alice',confirm=true)=>catalog.save(user,accounts,brokers,revision,confirm);
 return {catalog,props,rows,read,save};}
const a={id:'ext-synthetic-account-a',broker:'Synthetic Broker',accountName:'First',accountType:'GENERAL'};
test('empty reads are side-effect free and catalog writes are user scoped',()=>{
 const f=fixture();assert.equal(f.read().accounts.length,0);assert.equal(f.props.size,0);const saved=f.save([a]);assert.equal(saved.success,true);assert.equal(f.read().accounts[0].accountName,'First');assert.equal(f.read('bob').accounts.length,0);assert.ok(![...f.props.keys()][0].includes('alice'));
});
test('same broker supports multiple distinct accounts with revision and review checks',()=>{
 const f=fixture(),r=f.read().revision;f.save([a,{...a,id:'ext-synthetic-account-b',accountName:'Second'}]);assert.equal(f.read().accounts.length,2);
 assert.throws(()=>f.save([],[],r),/STORE_CONFLICT/);assert.throws(()=>f.save([],[],f.read().revision,'alice',false),/STORE_CONFIRM/);
});
test('legacy holdings remain unclassified rather than assigned to a guessed broker',()=>{
 const f=fixture();f.rows.set('alice',[{accountType:'ISA'}]);const out=f.read();assert.equal(out.accounts[0].id,'legacy-ISA');assert.equal(out.accounts[0].broker,'');assert.equal(f.props.size,0);
});
test('saved holdings prevent account deletion or type changes, names remain editable',()=>{
 const f=fixture();f.save([a]);f.rows.set('alice',[{accountId:a.id,accountType:'GENERAL'}]);assert.throws(()=>f.save([]),/STORE_ACCOUNT_IN_USE/);assert.throws(()=>f.save([{...a,accountType:'IRP'}]),/STORE_ACCOUNT_IN_USE/);f.save([{...a,accountName:'Edited'}]);assert.equal(f.read().accounts[0].accountName,'Edited');
});
test('deleted empty account metadata is retained for subsequent holdings recovery',()=>{
 const f=fixture();f.save([a]);f.save([],[]);assert.equal(f.read().accounts.length,0);f.rows.set('alice',[{accountId:a.id,accountType:'GENERAL'}]);const recovered=f.read().accounts[0];assert.equal(recovered.broker,a.broker);assert.equal(recovered.accountName,a.accountName);assert.equal(recovered.recovered,true);assert.ok(f.read().brokers.includes(a.broker));
});
test('malformed identity, full account numbers, formula text and duplicate brokers are rejected',()=>{
 const f=fixture();for(const row of [{...a,id:'other'},{...a,accountName:'123456789012'},{...a,accountName:'＋FORMULA'},{...a,broker:'Missing'}])assert.throws(()=>f.save([row]),/STORE_INVALID/);
 assert.throws(()=>f.save([a],['Synthetic Broker','synthetic broker']),/STORE_DUPLICATE/);assert.equal(f.props.size,0);
});

test('archived IDs cannot change type and legacy ID must match its type',()=>{
 const f=fixture();f.save([a]);f.save([],[]);assert.throws(()=>f.save([{...a,accountType:'IRP'}]),/STORE_ACCOUNT_IN_USE/);assert.throws(()=>f.save([{...a,id:'legacy-ISA'}]),/STORE_INVALID/);
});
