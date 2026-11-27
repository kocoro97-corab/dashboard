import {createServiceAccountToken,createDedicatedDriveArchiveReader} from './drive-archive.mjs';
import pem from './synthetic-key.json';
export default {async fetch(request){
 const scenario=new URL(request.url).searchParams.get('case')||'SUCCESS';
 const fetcher=(url,opts)=>fetch(new Request(url,{...opts,redirect:scenario==='LEGACY'?'error':opts.redirect,headers:{...opts.headers,'X-Synthetic-Case':scenario}}));
 const getToken=createServiceAccountToken({email:'myinvest-reader@synthetic-project.iam.gserviceaccount.com',pem,fetcher});
 const read=createDedicatedDriveArchiveReader({folderId:'syntheticFolder000000001',getToken,fetcher});
 const result=await read({mode:'date',date:'2026-11-27'});
 const audit=await (await fetch('https://probe.invalid/audit')).json();
 return Response.json({success:result.success,code:result.code,diagnostic:result.archiveDiagnostic,hash:result.report?.contentSha256,calls:audit.filter(x=>x.scenario===scenario)});
}};
