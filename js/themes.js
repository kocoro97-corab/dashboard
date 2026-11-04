/* ===== themes.js: 주도 테마 & 강도판 (거래대금·거래량·상승률 종합) ===== */
const TH_API='https://stock.naver.com/api/domestic/market/theme/';
const TH_CAND=12,TH_TOP=6;
let THM=[],THM_MSG='',THM_BUSY=false,THM_AT=0;

const sm=a=>a.reduce((s,x)=>s+(x||0),0);
const escA=v=>esc(v).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const dbg=(l,o)=>{NET.log.push(l+' 필드: '+(o?Object.keys(o).join(','):'(없음)'));if(NET.log.length>30)NET.log.shift()};
const fv=(o,names,re)=>{
  if(!o)return null;
  for(const n of names){const v=o[n];if(v!=null&&typeof v!=='object')return v}
  if(re)for(const k in o){const v=o[k];if(re.test(k)&&v!=null&&typeof v!=='object')return v}
  return null;
};
const rowsOf=j=>{
  if(Array.isArray(j))return j;
  if(!j||typeof j!=='object')return [];
  for(const k of ['stocks','stockList','themes','themeList','items','list','datas','data','result','contents']){
    const v=j[k];
    if(Array.isArray(v))return v;
    if(v&&typeof v==='object'){const r=rowsOf(v);if(r.length)return r}
  }
  for(const v of Object.values(j)){if(Array.isArray(v)&&v.length&&typeof v[0]==='object')return v}
  return [];
};
const RATE_RE=/(fluct|change).*(ratio|rate)/i;
function parseTheme(o){return{
  no:fv(o,['no','themeNo','categoryNo','themeId','id'],/(^no$|No$|Id$)/),
  name:String(fv(o,['name','themeName','categoryName','title'],/name/i)||''),
  rate:nsgn(o,nnum(fv(o,['changeRate','fluctuationsRatio','fluctuationRate'],RATE_RE)))}}
function parseStock(o){
  const code=String(fv(o,['itemCode','stockCode','code','symbolCode'],/code$/i)||'');
  return{code:code,
    name:String(fv(o,['stockName','itemName','name'],/name/i)||code),
    rate:nsgn(o,nnum(fv(o,['fluctuationsRatio','changeRate','fluctuationRate'],RATE_RE))),
    val:nnum(fv(o,['accumulatedTradingValue','tradingValue','accumulatedTradingAmount','amount'],/(trading|accum).*(value|amount)/i)),
    vol:nnum(fv(o,['accumulatedTradingVolume','tradingVolume','volume'],/(trading|accum).*volume/i))}}
async function pool(items,n,fn){
  let i=0;
  await Promise.all(Array.from({length:n},async()=>{
    while(i<items.length){const t=items[i++];try{await fn(t)}catch(e){}}
  }));
}
const TH_STOCK_URLS=no=>[
  'https://m.stock.naver.com/api/stocks/theme/'+no+'?page=1&pageSize=100',
  TH_API+no+'/stocklist?marketType=ALL&orderType=priceTop&startIdx=0&pageSize=100'
];
let TH_URL_IDX=0;   // 성공한 주소 번호를 기억해 다음부터 먼저 시도
async function themeStocks(no,logIt){
  const urls=TH_STOCK_URLS(no);
  for(let k=0;k<urls.length;k++){
    const i=(TH_URL_IDX+k)%urls.length;
    const raw=rowsOf(await getJSON(urls[i]));
    const rows=raw.map(parseStock).filter(r=>/^\d{6}$/.test(r.code)&&r.name&&r.rate!=null);
    if(logIt){
      if(raw[0])dbg('테마종목(주소'+(i+1)+')',raw[0]);
      NET.log.push('테마종목 주소'+(i+1)+': 원본 '+raw.length+'행 · 사용 '+rows.length+'행');
      if(NET.log.length>30)NET.log.shift();
    }
    if(rows.length){TH_URL_IDX=i;return rows}
  }
  return [];
}
const prank=(list,f)=>{const v=list.map(f);return v.map(x=>list.length>1?v.filter(y=>y<x).length/(list.length-1):1)};

async function fetchTopThemes(){
  if(THM_BUSY||(THM.length&&Date.now()-THM_AT<REFRESH_MS-30000))return;   // 갱신 주기 캐시(수동 갱신 시 THM_AT=0)
  THM_BUSY=true;$('thS').textContent='테마 분석 중...';
  try{
    const raw=rowsOf(await getJSON(TH_API+'list?startIdx=0&pageSize=100&sortType=changeRate'));
    dbg('테마목록',raw[0]);
    const all=raw.map(parseTheme).filter(t=>t.no!=null&&t.name&&t.rate!=null);
    const cand=all.filter(t=>t.rate>0).sort((a,b)=>b.rate-a.rate).slice(0,TH_CAND);
    if(!cand.length){
      if(!THM.length)THM_MSG=all.length?'현재 상승 중인 테마가 없습니다.':'테마 데이터를 받지 못했습니다. (🩺 진단에서 로그 확인)';
      return;
    }
    await pool(cand,4,async t=>{
      const rs=await themeStocks(t.no,t===cand[0]);
      t.rows=rs;t.val=sm(rs.map(r=>r.val));t.vol=sm(rs.map(r=>r.vol));
    });
    const rr=prank(cand,t=>t.rate),rv=prank(cand,t=>t.val||0),rq=prank(cand,t=>t.vol||0),tot=sm(cand.map(t=>t.val));
    cand.forEach((t,i)=>{t.sc=Math.round(100*(.35*rr[i]+.45*rv[i]+.2*rq[i]));t.share=tot?t.val/tot*100:null});
    const top=cand.sort((a,b)=>b.sc-a.sc||b.rate-a.rate).slice(0,TH_TOP);
    top.forEach(t=>{t.top=(t.rows||[]).slice().sort((a,b)=>b.rate-a.rate).slice(0,5)});
    THM=top;THM_MSG='';THM_AT=Date.now();
    $('thS').textContent=(openKR()?'장중':'장마감')+' · 상승률·거래대금·거래량 종합 · '+new Date().toLocaleTimeString('ko-KR');
  }catch(e){
    if(!THM.length)THM_MSG='테마 분석 중 오류가 발생했습니다.';
  }finally{
    THM_BUSY=false;renderThemes();
  }
}

function renderThemes(){
  const box=$('themes');
  if(!THM.length){box.innerHTML='<div class="card mini">'+(THM_MSG||'테마 불러오는 중...')+'</div>';return}
  const my={};H.forEach(r=>{if(isKR(r[7]||'')){const q=Q[r[7]];my[r[7]]=q?(q.p/r[3]-1)*100:r[6]}});
  box.innerHTML=THM.map(t=>{
    const rows=(t.top||[]).map((r,i)=>{
      const m=my[r.code];
      return `<div class="kr" style="cursor:pointer;padding:3px 0" data-code="${escA(r.code)}" data-name="${escA(r.name)}"><span>${i+1}. ${esc(r.name)}${m!=null?`<b style="font-size:9px;color:var(--amber);margin-left:4px">[보유 ${m>=0?'+':''}${m.toFixed(1)}%]</b>`:''}</span><b class="${r.rate>=0?'up':'down'}">${r.rate>=0?'+':''}${r.rate.toFixed(2)}%</b></div>`;
    }).join('');
    return `<div class="card"><div class="cl"><b>${esc(t.name)}</b><span>강도 ${t.sc} · 테마 +${t.rate.toFixed(2)}%</span></div><div class="bar" style="margin-bottom:4px"><i style="width:${t.sc}%"></i></div><div class="mini" style="margin-bottom:4px">${t.share!=null?'거래대금 비중 '+t.share.toFixed(0)+'%':''}</div>${rows||'<div class="mini">종목 불러오기 실패</div>'}</div>`;
  }).join('');
}
$('themes').addEventListener('click',e=>{const d=e.target.closest('[data-code]');if(d)showQ(d.dataset.code,d.dataset.name,'')});
