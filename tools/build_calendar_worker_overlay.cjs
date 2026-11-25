'use strict';
// Local private compilation only. No Cloudflare API or settings access.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
async function build({legacyFile,output,esbuildModule='esbuild'}){
 const source=path.resolve(legacyFile),target=path.resolve(output),root=path.resolve(__dirname,'..');
 if(fs.existsSync(target)||source===target||fs.lstatSync(source).isSymbolicLink())throw Error('NEW_PRIVATE_BUNDLE_REQUIRED');
 const bytes=fs.readFileSync(source);if(bytes.length>2*1024*1024)throw Error('LEGACY_MODULE_TOO_LARGE');
 const esbuild=require(esbuildModule),legacyImport=JSON.stringify(source),overlayImport=JSON.stringify(path.join(root,'server/google-calendar-relay-overlay.cjs'));
 const globals=path.join(__dirname,'calendar-worker-node-globals.mjs');
 const result=await esbuild.build({stdin:{contents:`import * as legacy from ${legacyImport};import overlay from ${overlayImport};const applied=overlay.createCalendarRelayOverlay({legacy});export * from ${legacyImport};const RelayGate=applied.RelayGate;export {RelayGate};export default applied.worker;`,resolveDir:root,sourcefile:'private-calendar-entry.mjs',loader:'js'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',metafile:true,logLevel:'silent',inject:[globals],external:['node:buffer'],plugins:[{name:'calendar-node-crypto',setup(b){b.onResolve({filter:/^node:crypto$/},args=>args.namespace==='calendar-native'?{path:args.path,external:true}:{path:'crypto',namespace:'calendar-native'});b.onLoad({filter:/.*/,namespace:'calendar-native'},()=>({contents:'export * from "node:crypto";',loader:'js'}))}}]});
 const code=result.outputFiles[0].contents;
 if(/\b__require\(["']node:/.test(Buffer.from(code).toString()))throw Error('UNSUPPORTED_NODE_MODULE_WRAPPER');
 if(!fs.readFileSync(source).equals(bytes))throw Error('CONCURRENT_LEGACY_MODULE_CHANGE');
 fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,code,{flag:'wx',mode:0o600});
 return {status:'PASS',phase:'LOCAL_CURRENT_WORKER_OVERLAY_BUILT',legacySha256:crypto.createHash('sha256').update(bytes).digest('hex'),candidateSha256:crypto.createHash('sha256').update(code).digest('hex'),bytes:code.length,requiresNodeCompatibility:true,deploymentAttempted:false,credentialsIncluded:false};
}
module.exports={build};
if(require.main===module){const args=process.argv.slice(2),get=name=>args[args.indexOf(name)+1];build({legacyFile:get('--legacy-file'),output:get('--output'),esbuildModule:args.includes('--esbuild-module')?get('--esbuild-module'):'esbuild'}).then(r=>console.log(JSON.stringify(r))).catch(()=>{console.log(JSON.stringify({status:'NOT_RUN',code:'PRIVATE_WORKER_BUILD_REVIEW_REQUIRED',deploymentAttempted:false,credentialsIncluded:false}));process.exitCode=1})}
