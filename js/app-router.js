(function(root){
  'use strict';
  const routes=Object.freeze(['home','market','sectors','stocks','strategy','news','accounts','settings',...(root.MYINVEST_DEV_DIAGNOSTICS===true?['diagnostics']:[])]);
  const accountTabs=Object.freeze(['overview','nh','special','ocr','holdings','analysis']);
  function parse(hash){
    const match=/^#\/([a-z]+)(?:\/([a-z]+))?$/.exec(hash||'');
    if(!match||!routes.includes(match[1])||match[2]&&(match[1]!=='accounts'||!accountTabs.includes(match[2])))return null;
    return {page:match[1],tab:match[1]==='accounts'?match[2]||'overview':null,path:'/'+match[1]+(match[2]?'/'+match[2]:'')};
  }
  function create({location,history,onChange,target}){
    let listening=false;
    const read=()=>parse(location.hash)||{page:'home',tab:null,path:'/home'};
    const change=()=>{if(!parse(location.hash))history.replaceState(null,'',location.pathname+location.search+'#/home');onChange(read())};
    return {read,start(){if(listening)return;listening=true;target.addEventListener('hashchange',change);change()},
      stop(){if(!listening)return;listening=false;target.removeEventListener('hashchange',change)},
      go(path){if(!parse('#'+path))throw Error('INVALID_ROUTE');if(location.hash==='#'+path)return;location.hash='#'+path}};
  }
  const api=Object.freeze({routes,accountTabs,parse,validHash:hash=>!!parse(hash),create});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.AppRouter=api;
})(globalThis);
