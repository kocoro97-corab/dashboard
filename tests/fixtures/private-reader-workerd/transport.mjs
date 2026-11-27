const calls=[];
export default {async fetch(request){
 const u=new URL(request.url);if(u.hostname==='probe.invalid')return Response.json(calls);
 const scenario=request.headers.get('X-Synthetic-Case'),stage=u.hostname==='oauth2.googleapis.com'?'TOKEN':u.search==='?alt=media'?'MEDIA':'LIST';
 calls.push({scenario,stage,host:u.hostname});
 if(!['oauth2.googleapis.com','www.googleapis.com'].includes(u.hostname))return new Response(null,{status:500});
 if(scenario===stage)return new Response(null,{status:302,headers:{Location:'https://forbidden.invalid/never-follow'}});
 if(stage==='TOKEN')return Response.json({access_token:'synthetic-token-000001',token_type:'Bearer',expires_in:300});
 const text='SYNTHETIC 원문\r\n';
 if(stage==='LIST')return Response.json({files:[{id:'syntheticOriginal00000001',name:'2026-11-27.txt',mimeType:'text/plain',size:String(new TextEncoder().encode(text).length),modifiedTime:new Date(Date.now()-1000).toISOString(),parents:['syntheticFolder000000001']}]});
 return new Response(text);
}};
