'use strict';
/* Explicit offline risk scenario evaluation from STDIN (max 64 KiB).
 * No file writes, provider/AI/broker calls, orders, or account connections.
 * Never echoes invalid input or raw errors into stdout or stderr.
 */
const risk=require('../js/strategy-risk-capacity-v1.js');
const MAX_BYTES=65536;
const refusal=code=>({status:'invalid',code,executionAllowed:false,canPlaceOrder:false});
function evaluateText(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>MAX_BYTES)
  return refusal('INPUT_TOO_LARGE');
 let input;try{input=JSON.parse(raw)}catch{return refusal('INVALID_JSON')}
 return risk.evaluate(input);
}
function run(){
 if(process.argv.length!==4||process.argv[2]!=='--stdin'||
  process.argv[3]!=='--ack-hypothetical'){
  process.stdout.write(JSON.stringify(refusal('EXPLICIT_HYPOTHETICAL_CONFIRMATION_REQUIRED'))+'\n');
  process.exitCode=2;return;
 }
 let raw='',bytes=0,oversize=false;
 process.stdin.setEncoding('utf8');
 process.stdin.on('data',piece=>{
  bytes+=Buffer.byteLength(piece,'utf8');
  if(bytes>MAX_BYTES){oversize=true;raw='';return}
  if(!oversize)raw+=piece;
 });
 process.stdin.on('error',()=>{
  process.stdout.write(JSON.stringify(refusal('INPUT_READ_FAILURE'))+'\n');
  process.exitCode=2;
 });
 process.stdin.on('end',()=>{
  const out=oversize?refusal('INPUT_TOO_LARGE'):evaluateText(raw);
  process.stdout.write(JSON.stringify(out,null,2)+'\n');
  if(out.status==='invalid')process.exitCode=2;
 });
}
if(require.main===module)run();
module.exports={evaluateText};
