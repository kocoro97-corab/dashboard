/* ===== chart.js: 차트 (라인/캔들) ===== */
// 일·주·월·년 = 캔들 한 개의 단위. [버튼, Yahoo interval, Yahoo range, 표시 설명, 최대 캔들 수(0=전체)]
const QR=[['일','1d','1y','최근 120일',120],['주','1wk','2y','최근 104주',104],['월','1mo','10y','최근 120개월',120],['년','1mo','max','연봉',0]];
// 일봉 목록을 주·월·연 단위 캔들로 묶는다 (i=1 주, 2 월, 3 년)
const qKey=(t,i)=>{const d=new Date(t);if(i===3)return d.getFullYear();if(i===2)return d.getFullYear()*100+d.getMonth();const m=new Date(d.getFullYear(),d.getMonth(),d.getDate()-((d.getDay()+6)%7));return m.getTime()};
function qAgg(rows,i){const out=[];let ck=null;rows.forEach(d=>{const k=qKey(d.t,i),o=d.o==null?d.c:d.o,h=d.h==null?d.c:d.h,l=d.l==null?d.c:d.l;
  if(k!==ck){out.push({t:d.t,o:o,h:h,l:l,c:d.c});ck=k}else{const x=out[out.length-1];x.h=Math.max(x.h,h);x.l=Math.min(x.l,l);x.c=d.c}});return out}
let QX=null,qrg=0,qmd='c',QD=[],qhi=-1,qseq=0;
const ysym=c=>isKR(c)?[...new Set([KY[c]||c+'.KS',c+'.KS',c+'.KQ'])]:[c];

function showQ(y,name,t,ns){QX={y,name,t};$('qn').textContent=name;$('qy').href='https://finance.yahoo.com/quote/'+encodeURIComponent(ysym(y)[0]);
document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('active',b.dataset.y===y));
$('qr').innerHTML=QR.map((r,i)=>`<button onclick="loadQ(${i})">${r[0]}</button>`).join('');loadQ(qrg);if(!ns)$('chartsec').scrollIntoView({behavior:'smooth',block:'start'})}
function openQ(id){const x=[...CFG.KR,...CFG.US].find(v=>v.id===id);if(x&&x.y)showQ(x.y,x.name,x.t)}
function showH(i){const r=H[i];if(r&&r[7])showQ(r[7],r[1],'')}
function qMode(m){qmd=m;$('qm1').classList.toggle('active',m==='l');$('qm2').classList.toggle('active',m==='c');drawQ()}

// 등락 비교 기준 = 선택한 단위의 "직전 캔들 종가": 일=전일 대비, 주=전주 대비, 월=전월 대비, 년=전년 대비
const QCMP=['전일','전주','전월','전년'];
function finishQ(i,b0,src){
  const n=QD.length,last=QD[n-1].c,u=QX.t==='yld'?'%':'';
  const base=n>1?QD[n-2].c:(QD[0].o!=null?QD[0].o:QD[0].c),df=last-base,pc=base?df/base*100:0;   // 캔들이 1개뿐이면 그 캔들 시가 기준
  $('qp').textContent=nf(last)+u;$('qc').textContent=(df>=0?'+':'')+nf(df)+' ('+(pc>=0?'+':'')+nf(pc)+'%) · '+QCMP[i]+' 대비';$('qc').className='change '+(df>=0?'up':'down');
  $('qi').textContent=QR[i][3]+' · 고가 '+nf(Math.max(...QD.map(d=>d.h!=null?d.h:d.c)))+' · 저가 '+nf(Math.min(...QD.map(d=>d.l!=null?d.l:d.c)))+' · '+src;drawQ();
}

async function nvChart(y,n,pg){
  const code=y==='^KS11'?'KOSPI':y==='^KQ11'?'KOSDAQ':isKR(y)?y:null;if(!code)return null;
  const kind=isKR(y)?'stock':'index';
  const rs=await Promise.all(Array.from({length:pg},(_,p)=>getJSON('https://m.stock.naver.com/api/'+kind+'/'+code+'/price?pageSize=60&page='+(p+1))));
  const rows=[].concat(...rs.map(r=>Array.isArray(r)?r:[])).map(d=>{const c=nnum(d.closePrice);return{t:Date.parse(d.localTradedAt)||0,o:nnum(d.openPrice)??c,h:nnum(d.highPrice)??c,l:nnum(d.lowPrice)??c,c:c}}).filter(d=>d.c!=null&&d.t).sort((a,b)=>a.t-b.t);return rows
}

async function loadQ(i){
  qrg=i;const my=++qseq;document.querySelectorAll('#qr button').forEach((b,k)=>b.classList.toggle('active',k===i));QD=[];qhi=-1;$('qp').textContent='';$('qc').textContent='';$('qi').textContent='로딩중...';drawQ();
  let rows=null;if(i===0){try{rows=await nvChart(QX.y,0,2)}catch(e){}if(my!==qseq)return;
  if(rows&&rows.length>1){QD=rows.slice(-QR[0][4]);finishQ(i,null,'네이버증권');return}}
  const r=QR[i];let res=null;
  for(const sy of ysym(QX.y)){const j=await getJSON('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(sy)+'?interval='+r[1]+'&range='+r[2]);if(my!==qseq)return;
  const v=j&&j.chart&&j.chart.result&&j.chart.result[0];if(v&&v.timestamp&&v.indicators.quote[0]){res=v;if(isKR(QX.y)){KY[QX.y]=sy;$('qy').href='https://finance.yahoo.com/quote/'+sy}break}}
  if(!res&&i>0){let dr=null;try{dr=await nvChart(QX.y,0,12)}catch(e){}if(my!==qseq)return;
  if(dr&&dr.length>1){QD=qAgg(dr,i);if(QR[i][4])QD=QD.slice(-QR[i][4]);finishQ(i,null,'네이버증권(일봉 합산)');return}}
  if(!res){$('qi').textContent='차트 수신 실패';return}
  const q=res.indicators.quote[0];QD=res.timestamp.map((t,k)=>({t:t*1000,o:q.open[k],h:q.high[k],l:q.low[k],c:q.close[k]})).filter(d=>d.c!=null);
  if(i===3)QD=qAgg(QD,3);else if(QR[i][4])QD=QD.slice(-QR[i][4]);
  if(!QD.length){$('qi').textContent='데이터 없음';return}
  finishQ(i,null,'Yahoo')
}

function drawQ(){
  const cv=$('qcv'),dp=window.devicePixelRatio||1,W=cv.clientWidth,Hh=300;if(!W)return;cv.width=W*dp;cv.height=Hh*dp;const g=cv.getContext('2d');g.scale(dp,dp);g.clearRect(0,0,W,Hh);
  if(!QD.length)return;const L=8,R=58,T=10,B=22,pw=W-L-R,ph=Hh-T-B,c=qmd==='c';
  let mx=Math.max(...QD.map(d=>c&&d.h!=null?d.h:d.c)),mn=Math.min(...QD.map(d=>c&&d.l!=null?d.l:d.c));if(mx===mn){mx+=1;mn-=1}const pd=(mx-mn)*.06;mx+=pd;mn-=pd;
  const X=k=>L+(k+.5)/QD.length*pw,Y=v=>T+(mx-v)/(mx-mn)*ph;
  g.font='10px system-ui';g.textBaseline='middle';
  for(let k=0;k<=4;k++){const v=mn+(mx-mn)*k/4,y=Y(v);g.strokeStyle='#26364d';g.lineWidth=1;g.beginPath();g.moveTo(L,y);g.lineTo(L+pw,y);g.stroke();g.fillStyle='#91a2ba';g.textAlign='left';g.fillText(nf(v),L+pw+4,y)}
  const fd=t=>{const d=new Date(t),y=d.getFullYear();return qrg===3?String(y):qrg===2?String(y).slice(2)+'.'+(d.getMonth()+1):(d.getMonth()+1)+'.'+d.getDate()};
  g.textAlign='center';g.textBaseline='top';g.fillStyle='#91a2ba';for(let k=0;k<4;k++){const i=Math.round((QD.length-1)*k/3);g.fillText(fd(QD[i].t),Math.min(Math.max(X(i),L+16),L+pw-16),Hh-B+6)}
  const col=QD[QD.length-1].c>=QD[0].c?'#ff4d4d':'#4d94ff';
  if(!c){g.beginPath();QD.forEach((d,k)=>k?g.lineTo(X(k),Y(d.c)):g.moveTo(X(k),Y(d.c)));g.strokeStyle=col;g.lineWidth=1.8;g.stroke();g.lineTo(X(QD.length-1),T+ph);g.lineTo(X(0),T+ph);g.closePath();const gr=g.createLinearGradient(0,T,0,T+ph);gr.addColorStop(0,col+'55');gr.addColorStop(1,col+'00');g.fillStyle=gr;g.fill()}
  else{const w=Math.max(1,Math.min(10,pw/QD.length*.7));QD.forEach((d,k)=>{const o=d.o==null?d.c:d.o,h=d.h==null?d.c:d.h,l=d.l==null?d.c:d.l,cc=d.c>=o?'#ff4d4d':'#4d94ff';g.strokeStyle=cc;g.fillStyle=cc;g.lineWidth=1;g.beginPath();g.moveTo(X(k),Y(h));g.lineTo(X(k),Y(l));g.stroke();const y1=Y(Math.max(o,d.c)),y2=Y(Math.min(o,d.c));g.fillRect(X(k)-w/2,y1,w,Math.max(1,y2-y1))})}
  if(qhi>=0&&QD[qhi]){const d=QD[qhi];g.strokeStyle='#91a2ba';g.lineWidth=1;g.setLineDash([3,3]);g.beginPath();g.moveTo(X(qhi),T);g.lineTo(X(qhi),T+ph);g.moveTo(L,Y(d.c));g.lineTo(L+pw,Y(d.c));g.stroke();g.setLineDash([])}
}
$('qcv').addEventListener('pointermove',e=>{if(!QD.length)return;const r=e.target.getBoundingClientRect(),pw=r.width-66,k=Math.max(0,Math.min(QD.length-1,Math.floor((e.clientX-r.left-8)/pw*QD.length)));
if(k===qhi)return;qhi=k;drawQ();const d=QD[k];const dt=new Date(d.t),ds=qrg===3?dt.getFullYear()+'년':qrg===2?dt.getFullYear()+'.'+(dt.getMonth()+1):dt.toLocaleDateString('ko-KR');$('qi').textContent=ds+(qmd==='c'&&d.o!=null?' · 시 '+nf(d.o)+' 고 '+nf(d.h)+' 저 '+nf(d.l)+' 종 '+nf(d.c):' · '+nf(d.c))});
$('qcv').addEventListener('pointerleave',()=>{qhi=-1;drawQ()});
window.addEventListener('resize',drawQ);
