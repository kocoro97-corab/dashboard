(function(root){
  'use strict';
  function create(){
    let scope=null,revision=0;const jobs=new Map(),listeners=new Set();
    const emit=()=>listeners.forEach(fn=>{try{fn()}catch{}});
    function synchronize(){const next=LS('invest_session_token');if(scope!==next){scope=next;revision++;jobs.clear()}return scope}
    async function once(key,fn,force=false){
      const token=synchronize();if(!token)throw Error('AUTH_REQUIRED');
      const prior=jobs.get(key);if(prior&&(!force||prior.busy))return prior.promise;
      const epoch=revision,job={busy:true};
      job.promise=Promise.resolve().then(fn).then(value=>{if(epoch!==revision||token!==LS('invest_session_token'))return;return value})
        .finally(()=>{job.busy=false;if(epoch===revision)emit()});jobs.set(key,job);return job.promise;
    }
    const development=()=>window.MYINVEST_TRANSPORT_CONFIG?.devSession===true;
    const publicConnected=()=>!development()||window.MYINVEST_TRANSPORT_CONFIG.publicMarket===true;
    function snapshot(){
      const token=LS('invest_session_token');
      return AccountOverview.build({accounts:NH_ACCOUNT_SESSION===token?NH_ACCOUNTS:[],external:EXT_ASSETS,prices:EXT_PRICES,
        nhLoaded:!!token&&NH_ACCOUNT_SESSION===token&&NH_ACCOUNT_FETCHED_AT>0,externalLoaded:!!EXT_SAVED_REV,
        nhPartial:document.getElementById('nhAccountStatus')?.textContent.includes('조회 실패')===true,
        draft:JSON.stringify(extRows(EXT_ASSETS))!==JSON.stringify(EXT_SAVED_ROWS),analyze:WorkPortfolio.analyze});
    }
    return {once,emit,snapshot,development,publicConnected,authenticated:()=>!!synchronize(),
      settings:()=>({indicators:JSON.parse(JSON.stringify(CFG)),market:sess()}),
      data:Object.freeze({publicRead:url=>publicConnected()?getTxt(url):Promise.resolve(null),accounts:snapshot}),
      error:()=>({status:'error',message:'모듈 처리 실패 · 연결 상태를 확인하세요.'}),
      subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},
      clear(){scope=null;revision++;jobs.clear();emit()},
      market(force=false){return publicConnected()?once('market',()=>refreshMarket(),force):Promise.resolve()},
      chart(force=false){return publicConnected()?once('chart',()=>{if(force&&QX)return loadQ(qrg);if(!QX)return showQ('^KS11','코스피','',1)},force):Promise.resolve()},
      news(force=false){return publicConnected()?once('news',()=>loadNews(),force):Promise.resolve()},
      sectors(force=false){return publicConnected()?once('sectors',()=>{if(force)THM_AT=0;return fetchTopThemes()},force):Promise.resolve()},
      accounts(force=false){if(development())return Promise.resolve();return once('accounts',async()=>{await loadProtectedHoldings();await loadNHAccounts();await loadExternalAssets()},force)},
      state(){return {authenticated:!!LS('invest_session_token'),publicConnected:publicConnected(),privateReads:!development(),running:[...jobs.values()].filter(j=>j.busy).length}}
    };
  }
  root.AppContext=Object.freeze({create});
})(globalThis);
