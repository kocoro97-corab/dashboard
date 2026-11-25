'use strict';
const assert=require('node:assert/strict');
const {collect}=require('../scripts/collect-bok-calendar.cjs');
const rows=[];
for(let day=1;day<=24;day++)rows.push('<tr><td>2026-11-'+String(day).padStart(2,'0')+'</td><td>6:00</td><td>2026년 11월 소비자동향조사 결과</td></tr>');
const html='<html><title>월간통계 공표일정</title><table>'+rows.join('')+'</table></html>';
async function main(){
 const stamp=new Date('2026-11-23T00:00:00.000Z');
 const valid=await collect({fetchImpl:async()=>({ok:true,text:async()=>html}),now:stamp});
 assert.equal(valid.events.length,24);
 assert.equal(valid.events[0].publisher,'BOK');
 assert.equal(valid.events[0].date,'2026-11-01');
 await assert.rejects(()=>collect({fetchImpl:async()=>({ok:false}),now:stamp}),/BOK_HTTP_FAILED/);
 await assert.rejects(()=>collect({fetchImpl:async()=>({ok:true,text:async()=>'<html>broken</html>'}),now:stamp}),/BOK_HTML_INVALID/);
 await assert.rejects(()=>collect({fetchImpl:async()=>({ok:true,text:async()=>html.replace(/<tr>[\s\S]*?<\/tr>/g,'')}),now:stamp}),/BOK_TABLE_MISSING/);
 console.log('BOK publisher fail-closed tests PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1});
