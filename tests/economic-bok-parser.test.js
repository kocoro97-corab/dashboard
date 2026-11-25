'use strict';
const assert=require('node:assert/strict');
const policy=require('../js/economic-bok-policy.js');
const parser=require('../js/economic-bok-stats-parser.js');
assert.equal(policy.list(2026).length,8);
assert.equal(policy.list(2027).length,0);
assert.deepEqual(policy.list(2026).map(x=>x.date),['2026-01-15','2026-02-26','2026-04-10','2026-05-28','2026-07-16','2026-08-27','2026-10-22','2026-11-26']);
assert.ok(policy.list(2026).every(e=>e.verified&&!e.startsAt&&e.timeStatus==='unconfirmed'));
const fixture='<html><title>월간통계 공표일정</title><table><tbody>'+
 '<tr><td>2026-11-24</td><td>6:00</td><td>2026년 11월 소비자동향조사 결과</td></tr>'+
 '<tr><td>2026-11-25</td><td>6:00</td><td>2026년 11월 기업경기조사 결과 및 경제심리지수(ESI)</td></tr>'+
 '<tr><td>2026-12-08</td><td>8:00</td><td>2026년 10월 국제수지(잠정)</td></tr>'+
 '<tr><td>2026-12-22</td><td>6:00</td><td>2026년 11월 생산자물가지수(잠정)</td></tr>'+
 '<tr><td>2026-12-22</td><td>6:00</td><td>2026년 11월 생산자물가지수(잠정)</td></tr>'+
 '<tr><td>2026-12-40</td><td>6:00</td><td>잘못된 날짜 소비자동향조사</td></tr>'+
 '<tr><td>2026-12-24</td><td>25:00</td><td>잘못된 시각 소비자동향조사</td></tr>'+
 '<tr><td>2026-12-24</td><td>6:00</td><td>무관한 통계</td></tr>'+
 '</tbody></table></html>';
const data=parser.parse(fixture,{retrievedAt:'2026-11-23T00:00:00Z'});
assert.equal(data.events.length,4,'deduped and invalid events omitted');
assert.deepEqual(data.events.map(x=>x.type),['KR_CSI','KR_BSI','KR_BOP','KR_PPI']);
assert.equal(data.events[0].startsAt,'2026-11-23T21:00:00.000Z','06:00 KST is 21:00 UTC previous day');
assert.ok(data.events.every(x=>x.verified&&x.sourceUrl===parser.SOURCE));
assert.throws(()=>parser.parse('<html>No table</html>'),/BOK_HTML_INVALID/);
assert.throws(()=>parser.parse('<html><title>월간통계 공표일정<\/title><table><tr><td>bad</td></tr></table></html>'),/BOK_NO_RECOGNISED_RELEASES/);
console.log('BOK policy and official statistical schedule parser PASS');
