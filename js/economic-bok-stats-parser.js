(function(root){'use strict';
/* Strict parser for Bank of Korea official publication calendar TABLE rows.
 * Read public press-release availability time, never ECOS upload time.
 * Source: www.bok.or.kr/portal/stats/statsPublictSchdul/listCldr.do
 * Discard unknown hours, dates, or nonrecognised categories.
 */
const SOURCE='https://www.bok.or.kr/portal/stats/statsPublictSchdul/listCldr.do?menuNo=200775&year=2026';
const CATEGORIES=Object.freeze([
 {type:'KR_GDP',pattern:/실질\s*국내총생산/,priority:'critical',label:'한국 GDP'},
 {type:'KR_BOP',pattern:/국제수지/,priority:'high',label:'한국 국제수지'},
 {type:'KR_PPI',pattern:/생산자물가지수/,priority:'high',label:'한국 생산자물가지수'},
 {type:'KR_CSI',pattern:/소비자동향조사/,priority:'high',label:'한국 소비자심리지수'},
 {type:'KR_BSI',pattern:/기업경기조사.*경제심리지수/,priority:'high',label:'한국 기업경기·경제심리지수'},
 {type:'KR_IMPORT',pattern:/수출입물가지수.*무역지수/,priority:'high',label:'한국 수출입물가·무역지수'},
 {type:'KR_NI',pattern:/국민소득/,priority:'high',label:'한국 국민소득'}
]);
function validDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return false;const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s}
function cleanHTML(s){return String(s).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim()}
function classify(title){for(const item of CATEGORIES)if(item.pattern.test(title||''))return item;return null}
function parse(html,{retrievedAt=new Date().toISOString()}={}){
 if(typeof html!=='string'||html.length>2500000||!html.includes('statsPublictSchdul')&&!html.includes('월간통계 공표일정'))throw Error('BOK_HTML_INVALID');
 if(!Number.isFinite(Date.parse(retrievedAt)))throw Error('BOK_TIMESTAMP_INVALID');
 const trs=[...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
 if(trs.length<1||trs.length>500)throw Error('BOK_TABLE_MISSING');
 const out=new Map();
 for(const match of trs){
  const cells=[...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)].map(m=>cleanHTML(m[1]));
  if(cells.length<3)continue;
  const date=cells[0],clock=cells[1],summary=cells[2],type=classify(summary);
  if(!validDate(date)||!/^\d{1,2}:\d{2}$/.test(clock)||!type)continue;
  const [h,m]=clock.split(':').map(Number);if(h>23||m>59)continue;
  const startsAt=new Date(Date.parse(date+'T00:00:00Z')+(h*60+m-540)*60000).toISOString();
  if(startsAt==='Invalid Date')continue;
  const id='bokstat-'+type.type+'-'+startsAt;
  out.set(id,{id,date,title:type.label+' 발표',category:'macro',publisher:'BOK',type:type.type,
    priority:type.priority,verified:true,source:'한국은행',sourceUrl:SOURCE,
    startsAt,sourceTimeZone:'Asia/Seoul',observedAt:retrievedAt,
    sourceTitle:summary.slice(0,160),releaseStatus:'scheduled'});
 }
 if(!out.size)throw Error('BOK_NO_RECOGNISED_RELEASES');
 return {source:'BOK',sourceUrl:SOURCE,retrievedAt,events:[...out.values()].sort((a,b)=>a.startsAt.localeCompare(b.startsAt))};
}
const api=Object.freeze({SOURCE,CATEGORIES,parse,classify});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestBokStatsParser=api;
})(globalThis);
