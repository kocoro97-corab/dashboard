'use strict';
/* Read-only, stdin-only historical evidence inspector.
 * Expects previously computed adapter outputs, never account data or quotes.
 * No disk write, data retrieval, broker credentials or order functionality.
 */
const timeline=require('../js/investment-evidence-timeline-v1.js');
const MAX_BYTES=4*1024*1024;
const refusal=code=>({status:'invalid',code,archiveReady:false,
 orderApproved:false,accountAccessed:false,providerCalls:0});
function summary(result){
 const counts={};
 for(const pair of result.comparisons)
  for(const change of pair.candidateChanges)
   counts[change.event]=(counts[change.event]||0)+1;
 return {
  status:result.status,market:result.market,mode:result.mode,
  firstDate:result.firstDate,lastDate:result.lastDate,
  coverage:result.coverage,
  observations:result.snapshots.map(s=>({
   asOf:s.asOf,quality:s.status,marketPosture:s.marketPosture,
   candidateCount:s.candidates.length
  })),
  comparablePairs:result.comparisons.filter(p=>p.status==='adjacent-observations-only').length,
  withheldPairs:result.comparisons.filter(p=>p.status==='not-comparable')
   .map(p=>({from:p.from,to:p.to,limitations:p.limitations})),
  classificationChangeCounts:counts,
  sourcesAuthenticated:false,calendarVerified:false,
  pricePerformanceComputed:false,archiveReady:true,stored:false,
  orderApproved:false,accountAccessed:false,providerCalls:0
 };
}
function inspect(raw,format='summary'){
 if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>MAX_BYTES)
  return {ok:false,result:refusal('INPUT_TOO_LARGE')};
 if(!['summary','json'].includes(format))
  return {ok:false,result:refusal('INVALID_FORMAT')};
 let input;
 try{input=JSON.parse(raw)}catch{
  return {ok:false,result:refusal('INVALID_JSON')};
 }
 const result=timeline.compile(input);
 if(result.status==='invalid')
  return {ok:false,result};
 return {ok:true,result:format==='summary'?summary(result):result};
}
if(require.main===module){
 const args=process.argv.slice(2);
 const expected=args.length===3&&args[0]==='--stdin'&&
  args[1]==='--ack-historical-observations'&&
  ['--summary','--json'].includes(args[2]);
 if(!expected){
  process.stdout.write(JSON.stringify(refusal('ACK_REQUIRED'))+'\n');
  process.exitCode=2;
 }else{
  let raw='',bytes=0,oversize=false,finished=false;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data',part=>{
   bytes+=Buffer.byteLength(part,'utf8');
   if(bytes>MAX_BYTES){oversize=true;raw='';return;}
   if(!oversize)raw+=part;
  });
  process.stdin.on('end',()=>{
   if(finished)return;
   finished=true;
   const out=oversize?{ok:false,result:refusal('INPUT_TOO_LARGE')}:
    inspect(raw,args[2]==='--json'?'json':'summary');
   process.stdout.write(JSON.stringify(out.result,null,2)+'\n');
   if(!out.ok)process.exitCode=2;
  });
  process.stdin.on('error',()=>{
   if(finished)return;
   finished=true;
   process.stdout.write(JSON.stringify(refusal('INPUT_READ_ERROR'))+'\n');
   process.exitCode=2;
  });
 }
}
module.exports={inspect,summary};
