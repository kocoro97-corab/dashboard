/* Read-only presentation of verified briefing text. No HTML interpreter, eval,
 * embedded documents, remote resources or original mutations. */
(function(root){
'use strict';
const SVG='http://www.w3.org/2000/svg';
const containers=new Set(['grid','grid-item','box','title','row','text','caption','link','svg','line','rect','path','circle','polyline','polygon','g','p','strong','em','ul','ol','li','blockquote','table','thead','tbody','tr','th','td','h1','h2','h3','h4','h5','h6']);
const blocked=new Set(['script','style','iframe','object','embed','form','input','button','textarea','select','img','image','use','foreignobject','animate','set','audio','video','source','meta','base','head']);
const svgTags=new Set(['svg','line','rect','path','circle','polyline','polygon','g','text','title']);
function decode(s){return String(s).replace(/&(?:#(x[\da-f]+|\d+)|([a-z]+));/gi,(raw,n,name)=>{
 if(n){const v=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return v>0&&v<=0x10ffff&&!(v>=0xd800&&v<=0xdfff)?String.fromCodePoint(v):'\ufffd'}
 return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[name.toLowerCase()]??raw;
})}
function attributes(tag){const out={};for(const a of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'|(-?\d+(?:\.\d+)?))\s*\}|([^\s/>]+))/g))out[a[1].toLowerCase()]=decode(a[2]??a[3]??a[4]??a[5]??a[6]??a[7]??'');return out}
function tokens(text){
 const out=[];let i=0;
 while(i<text.length){
  const start=text.indexOf('<',i);if(start<0){out.push(text.slice(i));break}
  if(start>i)out.push(text.slice(i,start));
  if(text.startsWith('<!--',start)){const end=text.indexOf('-->',start+4);if(end<0)break;i=end+3;continue}
  const end=text.indexOf('>',start+1);if(end<0){out.push(text.slice(start));break}
  const tag=text.slice(start,end+1);
  if(/^<\/?[A-Za-z]/.test(tag)){out.push(tag);i=end+1}else{out.push('<');i=start+1}
  if(out.length>12000)throw Error('VIEWER_LIMIT');
 }
 return out;
}
function parse(text){
 if(typeof text!=='string'||text.length>280000)throw Error('VIEWER_SIZE');
 text=text.replace(/<Cite\b[^>]*\/?>/gi,'〔인용〕').replace(/<\/Cite\s*>/gi,'');
 text=text.replace(/<Link\b([^>]*)>([\s\S]*?)<\/Link>/gi,(_,attrs,label)=>{const href=safeUrl(attributes(attrs).url||'');return href?'['+label+']('+href+')':label});
 const tree={tag:'root',children:[]},stack=[tree];let skip=null,count=0;
 for(const token of tokens(text)){
  if(++count>12000)throw Error('VIEWER_LIMIT');
  const m=/^<(\/?)([A-Za-z][\w:-]*)\b/.exec(token),tag=m?.[2].toLowerCase();
  if(skip){if(m?.[1]&&tag===skip)skip=null;continue}
  if(token.startsWith('<!--'))continue;
  if(m){
   if(blocked.has(tag)){if(!m[1]&&!/\/\s*>$/.test(token)&&!['img','image','input','meta','base','source','embed'].includes(tag))skip=tag;continue}
   if(m[1]){for(let i=stack.length-1;i>0;i--)if(stack[i].tag===tag){stack.length=i;break}continue}
   if(tag==='cite'){stack.at(-1).children.push({tag:'citation',children:[]});continue}
   if(['divider','hr','br','icon'].includes(tag)){stack.at(-1).children.push({tag:tag==='br'?'br':tag==='icon'?'icon':'hr',children:[]});continue}
   if(!containers.has(tag))continue;
   const node={tag,attrs:attributes(token),children:[]};stack.at(-1).children.push(node);
   if(!/\/\s*>$/.test(token)&&!['line','rect','path','circle','polyline','polygon'].includes(tag)){
    if(stack.length>=32)throw Error('VIEWER_DEPTH');stack.push(node);
   }
  }else stack.at(-1).children.push(token);
 }
 return tree;
}
function safeUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null}catch{return null}}
function inline(d,host,text,depth=0){
 text=decode(text);if(depth>6||text.length>4096){host.append(d.createTextNode(text));return}
 const pattern=/!\[([^\]]*)\]\([^\n)]*\)|\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|`([^`\n]+)`|\*([^*\n]+)\*/g;let last=0;
 for(const m of text.matchAll(pattern)){
  host.append(d.createTextNode(text.slice(last,m.index)));last=m.index+m[0].length;
  if(m[1]!==undefined){host.append(d.createTextNode(m[1]));continue}
  const link=m[2]!==undefined,href=link?safeUrl(m[3]):null;
  const el=d.createElement(link&&href?'a':m[4]||m[5]?'strong':m[6]?'code':m[7]?'em':'span');
  if(href){el.href=href;el.target='_blank';el.rel='noopener noreferrer'}
  inline(d,el,m[2]??m[4]??m[5]??m[6]??m[7]??'',depth+1);host.append(el);
 }
 host.append(d.createTextNode(text.slice(last)));
}
function markdown(d,host,text){
 const lines=text.replace(/\r\n?/g,'\n').split('\n');let i=0;
 const cells=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim());
 const divider=line=>/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
 while(i<lines.length){
  const s=lines[i];if(!s.trim()){i++;continue}
  if(s.includes('|')&&i+1<lines.length&&divider(lines[i+1])){
   const scroll=d.createElement('div');scroll.className='mipr-table-scroll';const table=d.createElement('table'),head=d.createElement('thead'),tr=d.createElement('tr');
   for(const c of cells(s)){const th=d.createElement('th');inline(d,th,c);tr.append(th)}head.append(tr);table.append(head);i+=2;const body=d.createElement('tbody');
   while(i<lines.length&&lines[i].includes('|')&&lines[i].trim()){const row=d.createElement('tr');for(const c of cells(lines[i++])){const td=d.createElement('td');inline(d,td,c);row.append(td)}body.append(row)}
   table.append(body);scroll.append(table);host.append(scroll);continue;
  }
  const h=/^\s*(#{1,6})\s+(.+)$/.exec(s),list=/^\s*(?:([-*+])|\d+[.)])\s+(.+)$/.exec(s);
  if(h){const el=d.createElement('h'+h[1].length);inline(d,el,h[2]);host.append(el);i++;continue}
  if(/^\s*(?:---+|\*\*\*+)\s*$/.test(s)){host.append(d.createElement('hr'));i++;continue}
  if(list){const el=d.createElement(list[1]?'ul':'ol');while(i<lines.length){const item=/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/.exec(lines[i]);if(!item)break;const li=d.createElement('li');inline(d,li,item[1]);el.append(li);i++}host.append(el);continue}
  const quote=/^\s*>\s?(.*)/.exec(s),el=d.createElement(quote?'blockquote':'p');inline(d,el,quote?quote[1]:s);host.append(el);i++;
 }
}
function svgAttributes(el,attrs){
 const numeric={x:'x',y:'y',x1:'x1',x2:'x2',y1:'y1',y2:'y2',width:'width',height:'height',rx:'rx',ry:'ry',cx:'cx',cy:'cy',r:'r',fontsize:'font-size',strokewidth:'stroke-width'};
 for(const [key,value] of Object.entries(attrs||{})){
  if(numeric[key]&&/^-?\d+(?:\.\d+)?$/.test(value)&&Math.abs(Number(value))<=100000)el.setAttribute(numeric[key],value);
  else if(key==='viewbox'&&/^[-\d. ,]+$/.test(value)&&value.trim().split(/[ ,]+/).length===4&&value.trim().split(/[ ,]+/).every(v=>Number.isFinite(Number(v))&&Math.abs(Number(v))<=100000))el.setAttribute('viewBox',value);
  else if(['fill','stroke'].includes(key)&&/^(?:#[\da-f]{3,8}|none|currentColor|white|black|red|blue|green|orange|gray|grey|transparent)$/i.test(value))el.setAttribute(key,value);
  else if(key==='opacity'&&Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=1)el.setAttribute(key,value);
  else if(key==='textanchor'&&['start','middle','end'].includes(value))el.setAttribute('text-anchor',value);
  else if(key==='fontweight'&&/^(?:[1-9]00|bold|normal)$/.test(value))el.setAttribute('font-weight',value);
  else if(key==='d'&&value.length<=4000&&/^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]+$/.test(value))el.setAttribute('d',value);
  else if(key==='points'&&value.length<=4000&&/^[-\d.eE+,\s]+$/.test(value))el.setAttribute('points',value);
 }
}
function render(d,text){
 const real=d;let remaining=8000;d={};
 for(const method of ['createElement','createElementNS','createTextNode','createDocumentFragment'])d[method]=(...args)=>{if(--remaining<0)throw Error('VIEWER_NODES');return real[method](...args)};
 const fragment=d.createDocumentFragment(),tree=parse(text);let count=0;
 function add(node,parent,inSvg=false){
  if(++count>8000)throw Error('VIEWER_NODES');
  if(typeof node==='string'){if(inSvg)parent.append(d.createTextNode(decode(node)));else markdown(d,parent,node);return}
  const tag=node.tag;
  if(tag==='root'){node.children.forEach(n=>add(n,parent));return}
  if(inSvg&&!svgTags.has(tag))return;
  const svg=inSvg||tag==='svg';let el;
  if(svg){el=d.createElementNS(SVG,tag);svgAttributes(el,node.attrs);if(tag==='svg'){el.classList.add('mipr-svg');el.setAttribute('role','img');el.setAttribute('aria-label','원문 도표')}}
  else{
   const map={'grid':'div','grid-item':'div','box':'section','title':'h3','row':'div','text':'div','caption':'p','link':'a','citation':'span','icon':'span'};
   el=d.createElement(map[tag]||tag);
   const classes={grid:'mipr-grid','grid-item':'mipr-grid-item',box:'mipr-card',row:'mipr-row',caption:'mipr-caption',citation:'mipr-citation'};
   if(classes[tag])el.className=classes[tag];
   if(tag==='grid'&&/^[1-4]$/.test(node.attrs?.columns||''))el.style.setProperty('--mipr-cols',node.attrs.columns);
   if(tag==='link'){const href=safeUrl(node.attrs?.url||'');if(href){el.href=href;el.target='_blank';el.rel='noopener noreferrer'}}
   if(tag==='citation'){el.textContent='〔인용〕';el.title='원문에 포함된 ChatGPT 내부 인용 표기';}
   if(tag==='icon'){el.textContent='•';el.setAttribute('aria-hidden','true')}
  }
  for(const child of node.children){if(!svg&&typeof child==='string'&&['title','caption','link'].includes(tag))inline(d,el,child);else add(child,el,svg)}parent.append(el);
 }
 add(tree,fragment);return fragment;
}
const api=Object.freeze({parse,render,safeUrl});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestPrivateBriefingViewer=api;
})(typeof globalThis!=='undefined'?globalThis:this);
