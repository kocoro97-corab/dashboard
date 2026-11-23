'use strict';
const fs=require('node:fs');
globalThis.MYInvestBlsSchedule=require('../js/economic-bls-parser.js');
globalThis.MYInvestBeaSchedule=require('../js/economic-bea-parser.js');
globalThis.MYInvestBokStatsParser=require('../js/economic-bok-stats-parser.js');
const READERS={BLS:require('../js/economic-calendar.js'),BEA:require('../js/economic-bea-calendar.js'),BOK:require('../js/economic-bok-stats-calendar.js'),VERIFIED_EARNINGS:require('../js/earnings-calendar.js')};
const FIELDS=new Set('id date title category publisher type priority observedAt sourceUrl source verified startsAt localDate localTime sourceTimeZone sourceTitle uid releaseStatus eventId market symbol name period eventType dateStatus evidence earningsRelated'.split(' '));
function validate(data,now=Date.now()){
 if(!data||data.schemaVersion!==1||!READERS[data.source]||Object.keys(data).some(k=>!['schemaVersion','source','sourceUrl','retrievedAt','events'].includes(k)))throw Error('CALENDAR_PUBLIC_SCHEMA_INVALID');
 if(!Array.isArray(data.events)||data.events.some(e=>!e||Object.keys(e).some(k=>!FIELDS.has(k))))throw Error('CALENDAR_PRIVATE_OR_UNKNOWN_FIELD');
 const checked=READERS[data.source].normalize(data,now);
 if(!checked.events.length||checked.events.length!==data.events.length)throw Error('CALENDAR_PARTIAL_VALIDATION');
 return {source:data.source,events:checked.events.length,retrievedAt:data.retrievedAt};
}
if(require.main===module){try{console.log(JSON.stringify(validate(JSON.parse(fs.readFileSync(process.argv[2],'utf8')))))}catch{console.error('CALENDAR_SNAPSHOT_NOT_PUBLISHABLE');process.exitCode=2}}
module.exports={validate};
