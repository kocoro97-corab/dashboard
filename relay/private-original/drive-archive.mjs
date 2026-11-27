// Fixed private folder served by a non-delegating service account. No browser credentials.
const FILE_ID = /^[A-Za-z0-9_-]{20,128}$/;
const DATED = /^(20[2-9][0-9]-[0-9]{2}-[0-9]{2})(?:\.(?:txt|md))?$/;
const TEXT = new Set(['text/plain','text/markdown']);
const MAX_ROWS = 180, MAX_BYTES = 280000;
const fail = (code,archiveDiagnostic) => ({success:false,layer:'gas',code:'PRIVATE_BRIEFING_'+code,...(archiveDiagnostic?{archiveDiagnostic}:{})});
function validDate(value){
  if(typeof value!=='string'||!DATED.test(value)||value.length!==10)return false;
  const d=new Date(value+'T00:00:00Z');
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
}
async function bounded(r){
  const input=r.body?.getReader();if(!input)throw new Error('body');
  const chunks=[];let size=0;
  try{for(;;){const {done,value}=await input.read();if(done)break;
    if((size+=value.byteLength)>MAX_BYTES)throw new Error('too large');
    chunks.push(value);
  }}catch(e){await input.cancel().catch(()=>{});throw e;}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return {bytes,text:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)};
}
async function hash(bytes){
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
export function createDedicatedDriveArchiveReader({folderId, getToken, fetcher=fetch, now=()=>Date.now()}={}){
  if(!FILE_ID.test(folderId??'')||typeof getToken!=='function')throw new TypeError('Invalid archive configuration');
  return async function read({mode='latest',date}={}){
    if(!['date','list','latest'].includes(mode)||(mode==='date'?!validDate(date):date!==undefined))return fail('BAD_REQUEST');
    const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date(now()));
    if(mode==='date'&&date>today)return fail('NOT_FOUND');
    let stage='TOKEN',http=null;
    try{
      let token;try{token=await getToken()}catch(error){return fail('ARCHIVE_UNAVAILABLE',safeArchiveDiagnostic(error?.archiveDiagnostic)||{stage,http})}
      if(typeof token!=='string'||!token||/[\r\n]/.test(token))return fail('ARCHIVE_UNAVAILABLE',{stage,http});
      const get = async (url,accept)=>{http=null;const r=await fetcher(url,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+token,Accept:accept},signal:AbortSignal.timeout(12000)});http=r.status;return r};
      const files=new Map();let pageToken=null, inspected=0, remainingPages=4;
      do {
        if(remainingPages--===0)return fail('ARCHIVE_LIMIT');
        const url=new URL('https://www.googleapis.com/drive/v3/files');
        url.search=new URLSearchParams({q:"'"+folderId+"' in parents and trashed = false",fields:'nextPageToken,files(id,name,mimeType,size,modifiedTime,parents)',pageSize:'100'});
        if(pageToken)url.searchParams.set('pageToken',pageToken);
        stage='LIST';const r=await get(url,'application/json');if(!r.ok)return fail('ARCHIVE_UNAVAILABLE',{stage,http});
        const data=JSON.parse((await bounded(r)).text);
        if(!Array.isArray(data.files))return fail('ARCHIVE_UNAVAILABLE');
        for(const item of data.files){
          if(++inspected>MAX_ROWS)return fail('ARCHIVE_LIMIT');
          const day=typeof item.name==='string'&&item.name.match(DATED)?.[1];
          if(!day||!validDate(day)||day>today||!TEXT.has(item.mimeType))continue;
          if(!FILE_ID.test(item.id??'')||!Array.isArray(item.parents)||!item.parents.includes(folderId))return fail('ARCHIVE_UNAVAILABLE');
          if(files.has(day))return fail('DUPLICATE_DATE');
          files.set(day,item);
        }
        pageToken=data.nextPageToken||null;
      }while(pageToken);
      const dates=[...files.keys()].sort().reverse().slice(0,90),latestDate=dates[0]||null;
      const payload={success:true,schemaVersion:1,dates,latestDate,private:true,cacheable:false};
      if(mode==='list')return payload;
      const selected=mode==='date'?date:latestDate,entry=files.get(selected);
      if(!entry)return fail('NOT_FOUND');
      if(!/^\d+$/.test(entry.size??'')||Number(entry.size)>MAX_BYTES)return fail('TOO_LARGE');
      const savedAt=Date.parse(entry.modifiedTime);
      if(!Number.isFinite(savedAt)||savedAt<0||savedAt>now()+30000)return fail('READ_FAILED');
      const endpoint=new URL('https://www.googleapis.com/drive/v3/files/'+entry.id);
      endpoint.searchParams.set('alt','media');
      stage='MEDIA';const body=await get(endpoint,'text/plain, text/markdown');
      if(!body.ok)return fail('READ_FAILED',{stage,http});
      const {bytes,text}=await bounded(body);
      if(!bytes.length||bytes.length!==Number(entry.size))return fail('READ_FAILED');
      return {...payload,report:{date:selected,content:text,contentSha256:await hash(bytes),
        origin:'scheduled-task-archive-unverified',format:'verbatim-text',savedAt}};
    }catch{return fail('ARCHIVE_UNAVAILABLE',{stage,http});}
  };
}


const TOKEN_URL='https://oauth2.googleapis.com/token';
const READ_SCOPE='https://www.googleapis.com/auth/drive.readonly';
const ARCHIVE_STAGES=new Set(['TOKEN','KEY_IMPORT','TOKEN_SIGN','TOKEN_REQUEST','TOKEN_RESPONSE','LIST','MEDIA']);
export function safeArchiveDiagnostic(value){
 if(!value||!ARCHIVE_STAGES.has(value.stage)||value.http!==null&&(!Number.isInteger(value.http)||value.http<100||value.http>599))return null;
 return {stage:value.stage,http:value.http};
}
const SERVICE_EMAIL=/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/;
const encode=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const encodeJson=value=>encode(new TextEncoder().encode(JSON.stringify(value)));
export function validDedicatedAccount(email,pem,folderId){
 return SERVICE_EMAIL.test(email??'')&&FILE_ID.test(folderId??'')&&typeof pem==='string'&&pem.length<=8192&&
   /^-----BEGIN PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]+\s+-----END PRIVATE KEY-----\s*$/.test(pem);
}
export function createServiceAccountToken({email,pem,fetcher=fetch,now=()=>Date.now()}){
 let active=null,inflight=null,key=null;
 return async function getToken(){
  if(active&&active.expires>now()+60000)return active.token;
  if(inflight)return inflight;
  async function mint(){
   let stage='KEY_IMPORT',http=null;
   try{
   const der=Uint8Array.from(atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'')),c=>c.charCodeAt(0));
   key ||= await crypto.subtle.importKey('pkcs8',der,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
   const iat=Math.floor(now()/1000),header=encodeJson({alg:'RS256',typ:'JWT'});
   const body=encodeJson({iss:email,scope:READ_SCOPE,aud:TOKEN_URL,iat,exp:iat+300});
   const unsigned=header+'.'+body;
   stage='TOKEN_SIGN';const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(unsigned));
   stage='TOKEN_REQUEST';
   const r=await fetcher(TOKEN_URL,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
     headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},
     body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+encode(new Uint8Array(sig))}).toString()});
   stage='TOKEN_RESPONSE';http=r.status;
   if(!r.ok)throw new Error('archive authorization');
   const out=JSON.parse((await bounded(r)).text);
   if(!/^[A-Za-z0-9._~-]{10,4096}$/.test(out.access_token??'')||out.token_type?.toLowerCase()!=='bearer'||
       !Number.isSafeInteger(out.expires_in)||out.expires_in<60||out.expires_in>3600||
       out.scope!==undefined&&out.scope!==READ_SCOPE)throw new Error('archive authorization');
   active={token:out.access_token,expires:now()+out.expires_in*1000};return active.token;
   }catch{throw Object.assign(new Error('archive authorization'),{archiveDiagnostic:{stage,http}})}
  }
  inflight=mint().finally(()=>{inflight=null});return inflight;
 };
}
