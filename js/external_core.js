/* Pure OCR/identity/review logic. No network, credentials, DOM, or private fixtures. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ExternalCore=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const TYPES=new Set(['ISA','PENSION','IRP']);
  const PURCHASE=new Set(['현금','신용','미수','대출']);
  const MENU=new Set(['종목명','종목코드','수량','잔고수량','보유수량','평균매입가','평균매수가','매입가','평단가','현재가','평가금액','평가손익','평가손익률','주식잔고손익','수익률','합계','총자산','예수금','조회','일괄매도','자산현황','평생우대','비용포함','국내잔고','주식잔고','매매손익','국내주식','해외주식','ISA','연금저축','IRP','매도','매수','원화','평가','전체','선택','정렬','총매입금액','원','KRW']);
  const norm=v=>String(v==null?'':v).normalize('NFKC').replace(/[\u200b-\u200d\ufeff\s]/g,'').toUpperCase();
  function number(v){if(v==null||String(v).trim()==='')return null;const s=String(v).trim();if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s))return null;const n=Number(s.replace(/,/g,''));return Number.isFinite(n)?n:null}
  function master(document){
    if(!document||document.schema!==1||!document.source||!Array.isArray(document.instruments))throw Error('마스터 형식 오류');
    const byName=new Map(),byCode=new Map();
    document.instruments.forEach(row=>{
      if(!row||!/^[A-Z0-9]{6}$/.test(row.code)||typeof row.name!=='string'||!row.name||!['STOCK','ETF'].includes(row.type))throw Error('마스터 종목 형식 오류');
      if(byCode.has(row.code))throw Error('마스터 코드 중복');
      byCode.set(row.code,row);const name=norm(row.name);if(!byName.has(name))byName.set(name,[]);byName.get(name).push(row);
    });
    return {byName,byCode,source:document.source};
  }
  function match(row,index){
    const supplied=String(row.code||'').trim(),name=norm(row.name);
    if(PURCHASE.has(name))return {status:'invalid',reason:'매수구분 — 종목이 아님',code:null};
    if(!index)return {status:'unavailable',reason:'종목 마스터를 불러오지 못함 — 확인 필요',code:null};
    const candidates=index.byName.get(name)||[];
    if(candidates.length!==1)return {status:candidates.length?'ambiguous':'unmatched',reason:candidates.length?'이름 중복 — 확인 필요':'마스터 이름 불일치 — 확인 필요',code:null};
    const item=candidates[0];
    if(supplied&&supplied!==item.code)return {status:'conflict',reason:'저장 코드와 마스터 불일치 — 확인 필요',code:null,proposedCode:item.code,canonicalName:item.name};
    return {status:supplied?'matched':'proposal',reason:supplied?'KRX 상장 마스터 확인':'정확한 이름 일치 — 코드 적용 확인 필요',code:supplied?item.code:null,proposedCode:item.code,canonicalName:item.name,type:item.type};
  }
  function words(data){
    const out=[],seen=new Set();
    function add(w){if(!w||!w.bbox||!String(w.text||'').trim())return;const b=w.bbox;if(!['x0','x1','y0','y1'].every(k=>Number.isFinite(b[k]))||b.x1<=b.x0||b.y1<=b.y0)return;const key=[w.text,b.x0,b.y0,b.x1,b.y1].join('|');if(!seen.has(key)){seen.add(key);out.push({text:String(w.text).trim(),bbox:b,x:(b.x0+b.x1)/2,y:(b.y0+b.y1)/2,h:b.y1-b.y0})}}
    function visit(node){if(!node||typeof node!=='object')return;if(Array.isArray(node.words))node.words.forEach(add);for(const k of ['blocks','paragraphs','lines'])if(Array.isArray(node[k]))node[k].forEach(visit)}
    visit(data);return out;
  }
  function mixedName(korean,english,index){
    const symbols=data=>(data&&data.words||[]).flatMap(w=>w.symbols||[]).filter(s=>s.bbox&&Number.isFinite(s.confidence));
    const hangul=symbols(korean).filter(s=>/^[가-힣]$/.test(s.text)).sort((a,b)=>a.bbox.x0-b.bbox.x0);
    if(hangul.length<2||hangul.some(s=>s.confidence<80))return null;
    const boundary=hangul[0].bbox.x0;
    const prefix=symbols(english).filter(s=>s.bbox.x1<=boundary).sort((a,b)=>a.bbox.x0-b.bbox.x0);
    if(!prefix.length||prefix.some(s=>!/^[A-Za-z0-9&.-]$/.test(s.text)||s.confidence<90))return null;
    const joined=prefix.concat(hangul),height=Math.max(...joined.map(s=>s.bbox.y1-s.bbox.y0));
    for(let i=1;i<joined.length;i++)if(joined[i].bbox.x0-joined[i-1].bbox.x1>height*.7||Math.min(joined[i].bbox.y1,joined[i-1].bbox.y1)<=Math.max(joined[i].bbox.y0,joined[i-1].bbox.y0))return null;
    const name=joined.map(s=>s.text).join(''),found=match({name,code:''},index);
    return found.status==='proposal'?found.canonicalName:null;
  }
  function replaceName(data,region,name){
    const flat=words(data).filter(w=>!(w.x>=region.x0&&w.x<region.x1&&w.y>=region.y0&&w.y<=region.y1));
    flat.push({text:name,bbox:region.bbox});return {text:data.text||'',words:flat};
  }
  function refinedName(korean,english,index){
    // Full crop readings may fix Korean-only names too. Never use fuzzy aliases
    // or pick between disagreeing exact names from the two language workers.
    const names=new Set();
    for(const reading of [korean,english]){
      const items=reading&&reading.words||[];
      if(!items.length||items.some(w=>!w.bbox||!['x0','x1','y0','y1'].every(k=>Number.isFinite(w.bbox[k]))||w.bbox.x1<=w.bbox.x0||w.bbox.y1<=w.bbox.y0||!Number.isFinite(w.confidence)||w.confidence<90))continue;
      if(Math.min(...items.map(w=>w.bbox.y1))<=Math.max(...items.map(w=>w.bbox.y0)))continue;
      const name=items.slice().sort((a,b)=>a.bbox.x0-b.bbox.x0).map(w=>w.text).join('');
      const found=match({name,code:''},index);if(found.status==='proposal')names.add(found.canonicalName);
    }
    const mixed=mixedName(korean,english,index);if(mixed)names.add(mixed);
    return names.size===1?[...names][0]:null;
  }
  function parse(data,accountType,index){
    if(!TYPES.has(accountType))throw Error('알 수 없는 계좌 구분');
    const all=words(data),rejected=[],warnings=[];
    if(!all.length)return {holdings:[],rejected,warnings:['좌표가 포함된 OCR 결과가 필요합니다. 원문만으로 수량을 추측하지 않습니다.']};
    const heights=all.map(w=>w.h).sort((a,b)=>a-b),height=heights[Math.floor(heights.length/2)],tolerance=Math.max(2,height*.45);
    const headerText=w=>norm(w.text).replace(/[.:·ㆍ;>＊*]/g,'');
    const isName=w=>/^(종목명|상품명|종명)$/.test(headerText(w));
    const isQty=w=>/^(잔고수량|보유수량|수량)$/.test(headerText(w));
    const isAvg=w=>/^(평균매입가|평균매수가|평균매입단가|평단가|매입가)$/.test(headerText(w));
    // Korean labels are often emitted as individual glyphs. Join only spatially
    // adjacent header fragments; never use this to invent a stock name or value.
    const headerWords=all.slice();
    for(const first of all){
      const line=all.filter(w=>Math.abs(w.y-first.y)<=tolerance&&w.bbox.x0>=first.bbox.x0).sort((a,b)=>a.bbox.x0-b.bbox.x0);
      let text='',right=first.bbox.x0;
      for(const w of line.slice(0,8)){
        if(w.bbox.x0-right>height*1.3)break;
        text+=w.text;right=Math.max(right,w.bbox.x1);
        const candidate={text,x:(first.bbox.x0+right)/2,y:first.y,h:height,bbox:{x0:first.bbox.x0,x1:right,y0:first.bbox.y0,y1:first.bbox.y1}};
        if(isName(candidate)||isQty(candidate)||isAvg(candidate)||/^(현재가|평가금액|평가손익|수익률|구분|종목코드)$/.test(headerText(candidate)))headerWords.push(candidate);
      }
    }
    let headers=null;
    for(const n of headerWords.filter(isName)){
      const nearby=headerWords.filter(w=>Math.abs(w.y-n.y)<=height*2.5).sort((a,b)=>(b.bbox.x1-b.bbox.x0)-(a.bbox.x1-a.bbox.x0));
      const q=nearby.find(isQty),a=nearby.find(isAvg);
      if(q&&a&&q.x!==a.x&&n.x<q.x&&n.x<a.x){headers={name:n,quantity:q,avgPrice:a};break}
    }
    if(!headers)return {holdings:[],rejected,warnings:['종목명·수량·평균매입가 머리글을 확인하지 못했습니다. 행을 추측하지 않습니다.']};
    const headerY=Math.max(...Object.values(headers).map(w=>w.y));
    const codeHeader=all.find(w=>norm(w.text)==='종목코드'&&Math.abs(w.y-headerY)<=height*2.5);if(codeHeader)headers.code=codeHeader;
    const knownHeader=w=>isName(w)||isQty(w)||isAvg(w)||/^(종목코드|현재가|평가금액|평가손익|수익률|매수구분|구분)$/.test(headerText(w));
    const candidates=headerWords.filter(w=>knownHeader(w)&&Math.abs(w.y-headerY)<=height*2.5).sort((a,b)=>(b.bbox.x1-b.bbox.x0)-(a.bbox.x1-a.bbox.x0));
    const columns=Object.values(headers).slice();for(const w of candidates)if(!columns.some(c=>Math.abs(c.x-w.x)<height*1.5))columns.push(w);columns.sort((a,b)=>a.x-b.x);
    const centers=[...new Set(columns.map(w=>w.x))];
    const bounds={};Object.entries(headers).forEach(([key,w])=>{const i=centers.indexOf(w.x);bounds[key]=[i?(centers[i-1]+w.x)/2:-Infinity,i<centers.length-1?(w.x+centers[i+1])/2:Infinity]});
    const grouped=[];
    all.filter(w=>w.y>headerY+height*.6).sort((a,b)=>a.y-b.y).forEach(w=>{
      // Mixed scripts often have different box centers on the same printed row.
      // Require actual vertical overlap for the extra allowance; never borrow
      // numbers from a nearby cash/subtotal line based on distance alone.
      const matches=grouped.filter(g=>Math.abs(g.y-w.y)<=tolerance||g.bottom>g.top&&
        Math.min(g.bottom,w.bbox.y1)-Math.max(g.top,w.bbox.y0)>=Math.min(g.bottom-g.top,w.h)*.35);
      let group=matches.length===1?matches[0]:null;
      if(!group){group={y:w.y,top:w.bbox.y0,bottom:w.bbox.y1,parts:[]};grouped.push(group)}
      group.parts.push(w);group.top=Math.max(group.top,w.bbox.y0);group.bottom=Math.min(group.bottom,w.bbox.y1);
    });
    const holdings=[],regions=[];
    for(const group of grouped){
      const cell=key=>group.parts.filter(w=>w.x>=bounds[key][0]&&w.x<bounds[key][1]).sort((a,b)=>a.x-b.x);
      const rawTokens=cell('name'),rawName=rawTokens.map(w=>w.text).join(' ').trim();
      const fullMatch=match({name:rawName,code:''},index);
      // Preserve an actual cash-like product only when its entire name is verified.
      const nameTokens=fullMatch.status==='proposal'?rawTokens:rawTokens.filter(w=>!PURCHASE.has(norm(w.text)));
      const name=nameTokens.map(w=>w.text).join(' ').trim(),n=norm(name);
      if(!name||MENU.has(n)||/^(계좌|고객번호|합계|총자산|예수금)/.test(n)||!/[가-힣A-Z]/.test(n)||/^[-\d,.%]+$/.test(n)){rejected.push({reason:'매수구분·메뉴·숫자 잡음',row:grouped.indexOf(group)});continue}
      const quantity=number(cell('quantity').map(w=>w.text).join(''));
      const avgPrice=number(cell('avgPrice').map(w=>w.text).join(''));
      const observedCode=headers.code?cell('code').map(w=>w.text).join('').trim():'';
      const result=match({name,code:observedCode},index);
      if(quantity===null&&avgPrice===null&&result.status!=='proposal'){rejected.push({reason:'동일 행에 수량·매입가 없음',row:grouped.indexOf(group)});continue}
      const code=['proposal','matched'].includes(result.status)?result.proposedCode:'';
      if(!code&&rawTokens.length&&quantity!==null&&avgPrice!==null&&Number.isFinite(bounds.name[1])){
        const box={x0:Math.min(...rawTokens.map(w=>w.bbox.x0)),x1:Math.max(...rawTokens.map(w=>w.bbox.x1)),y0:Math.min(...rawTokens.map(w=>w.bbox.y0)),y1:Math.max(...rawTokens.map(w=>w.bbox.y1))};
        regions.push({x0:Math.max(0,Number.isFinite(bounds.name[0])?bounds.name[0]:0),x1:bounds.name[1],y0:Math.max(0,Math.floor(box.y0-height*.75)),y1:Math.ceil(box.y1+height*.75),bbox:box});
      }
      if(result.status==='conflict')warnings.push('OCR 종목코드와 종목명 불일치 — 원문과 마스터를 확인하세요.');
      holdings.push({accountType,name:code?result.canonicalName:name,code,quantity,avgPrice,source:'OCR',needsReview:quantity===null||avgPrice===null||!code});
    }
    const plan=merge([],holdings);
    if(plan.conflicts.length){
      warnings.push('같은 종목의 서로 다른 OCR 값이 있습니다. 수량·평균매입가를 직접 확인하세요.');
      plan.conflicts.forEach(conflict=>{const row=plan.rows.find(x=>key(x)===key(conflict.after));if(row){row.quantity=null;row.avgPrice=null;row.needsReview=true}});
    }
    return {holdings:plan.rows,rejected,warnings,conflicts:plan.conflicts,regions};
  }
  const key=row=>row.accountType+'|'+(row.code&&/^[A-Z0-9]{6}$/.test(row.code)?row.code:norm(row.name));
  const comparable=row=>JSON.stringify([row.accountType,norm(row.name),String(row.code||''),number(row.quantity),number(row.avgPrice)]);
  function merge(base,added){
    const rows=base.map(x=>({...x})),changes=[],conflicts=[],duplicates=[];
    for(const item of added){
      const i=rows.findIndex(row=>row.accountType===item.accountType&&(key(row)===key(item)||norm(row.name)===norm(item.name)));
      if(i<0){rows.push({...item});changes.push({kind:'add',after:{...item}});continue}
      if(comparable(rows[i])===comparable(item)){duplicates.push({...item});continue}
      const change={kind:'replace',before:{...rows[i]},after:{...item}};changes.push(change);conflicts.push(change);rows[i]={...rows[i],...item};
    }
    return {rows,changes,conflicts,duplicates};
  }
  function validate(rows){
    const seen=new Set();
    for(const row of rows){
      if(!TYPES.has(row.accountType)||!norm(row.name)||PURCHASE.has(norm(row.name))||String(row.name).length>60||/^\s*[=+@-]/.test(row.name)||row.code&&!/^[A-Z0-9]{6}$/.test(row.code)||number(row.quantity)===null||number(row.avgPrice)===null)throw Error('종목명·코드·수량·평균매입가 확인 필요');
      const k=key(row);if(seen.has(k))throw Error('같은 계좌에 중복 종목이 있습니다.');seen.add(k);
    }
    return rows;
  }
  return {norm,number,master,match,parse,merge,key,comparable,validate,mixedName,refinedName,replaceName};
});
