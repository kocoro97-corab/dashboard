'use strict';
/* No network, file writes, account reads, or orders.
 * Read caller-supplied adapter OUTPUT from standard input, not raw secrets.
 * Never reproduce the raw input, parser exception or original error string.
 */
const evidence=require('../js/investment-evidence-explanation-v1.js');
const MAX_BYTES=131072;
const error=code=>({status:'blocked',code,tradeApproved:false,canPlaceOrder:false});
function inspect(raw,format='json'){
 if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>MAX_BYTES)
  return {ok:false,result:error('INPUT_TOO_LARGE')};
 if(!['json','markdown'].includes(format))
  return {ok:false,result:error('INVALID_FORMAT')};
 let parsed;try{parsed=JSON.parse(raw)}catch{
  return {ok:false,result:error('INVALID_JSON')};
 }
 const report=evidence.explain(parsed);
 if(report.status==='blocked')return {ok:false,result:format==='markdown'?
  report.markdown:report};
 return {ok:true,result:format==='markdown'?report.markdown:report};
}
if(require.main===module){
 const args=process.argv.slice(2);
 const correct=args.length===3&&args[0]==='--stdin'&&
  args[1]==='--ack-manual-review'&&['--json','--markdown'].includes(args[2]);
 if(!correct){
  process.stdout.write(JSON.stringify(error('MANUAL_REVIEW_ACK_REQUIRED'))+'\n');
  process.exitCode=2;
 }else{
  let input='',length=0,tooLarge=false;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data',chunk=>{
   length+=Buffer.byteLength(chunk,'utf8');
   if(length>MAX_BYTES){tooLarge=true;input='';return;}
   if(!tooLarge)input+=chunk;
  });
  process.stdin.on('end',()=>{
   const response=tooLarge?{ok:false,result:error('INPUT_TOO_LARGE')}:
    inspect(input,args[2]==='--markdown'?'markdown':'json');
   process.stdout.write(typeof response.result==='string'?
    response.result+'\n':JSON.stringify(response.result,null,2)+'\n');
   if(!response.ok)process.exitCode=2;
  });
  process.stdin.on('error',()=>{
   process.stdout.write(JSON.stringify(error('STDIN_READ_FAILURE'))+'\n');
   process.exitCode=2;
  });
 }
}
module.exports={inspect};
