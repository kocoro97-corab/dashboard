'use strict';
/* Offline, explicit-time inspector for QA of KR/US home session labels.
 * No network, credentials, account, local storage, or deployment.
 */
const session=require('../js/market-session-context-v1.js');
const pattern=/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
function inspect(text){
 if(typeof text!=='string'||!pattern.test(text))return {ok:false,code:'ABSOLUTE_ISO_TIME_REQUIRED'};
 const stamp=Date.parse(text);
 if(!Number.isSafeInteger(stamp)||stamp<=0)return {ok:false,code:'INVALID_TIME'};
 const result=session.context({now:stamp});
 if(result.status!=='ok')return {ok:false,code:result.code};
 return {ok:true,
  atKst:result.kstDate+' '+String(result.kstHour).padStart(2,'0')+'시',
  homeFocus:result.focus,homeDisplayOrder:result.displayOrder,
  marketWindows:Object.fromEntries(['KR','US'].map(market=>{
   const p=result.regions[market];
   return [market,{
    date:p.localDate,timezone:p.zone,
    localClock:p.localClock,window:p.window,
    calendarBasis:p.calendarBasis,
    summerWinterOpenKst:p.referenceKst.opening?.kstTime||null,
    coreCloseKst:p.referenceKst.closing?.kstTime||null,
    exchangeOpenVerified:false,holidayVerified:false
   }];
  })),
  marketOpenVerified:false,liveQuoteVerified:false,investmentAdvice:false};
}
if(require.main===module){
 const args=process.argv.slice(2),result=args.length===2&&args[0]==='--at'?
  inspect(args[1]):{ok:false,code:'USE_NODE_SCRIPT_WITH_EXPLICIT_AT'};
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
 if(!result.ok)process.exitCode=2;
}
module.exports={inspect};
