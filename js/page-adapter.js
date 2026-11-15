(function(root){
  'use strict';
  const pages=new Map();
  function node(tag,text,className){const el=document.createElement(tag);if(text!=null)el.textContent=text;if(className)el.className=className;return el}
  function note(text){return node('p',text,'page-note')}
  function button(text,fn){const el=node('button',text);el.type='button';el.dataset.shellControl='true';el.addEventListener('click',fn);return el}
  function legacy({ids=[],intro,build,refresh,update}){
    let view=null,unsubscribe=null,status='unmounted',version=0;const owned=new Set(),slots=new Map();
    function attach(id){const el=document.getElementById(id);if(el){owned.add(el);view.append(el)}}
    return {mount(container,ctx){version++;if(!view){view=node('div',null,'page-content');if(intro)view.append(note(intro));ids.forEach(attach);if(build)build(view,ctx,attach)}for(const [el,slot] of slots){slot.replaceWith(el)}slots.clear();container.replaceChildren(view);status='mounted';if(update){update(view,ctx);unsubscribe=ctx.subscribe(()=>update(view,ctx))}},
      async refresh(ctx,force=false){const epoch=version;status='loading';try{if(refresh)await refresh(ctx,force);if(epoch!==version)return;if(update)update(view,ctx);status='ready'}catch(error){if(epoch===version)status='error';throw error}},
      unmount(){version++;unsubscribe?.();unsubscribe=null;for(const el of owned){el.dispatchEvent(new Event('dashboard:pageleave'));const slot=document.createComment('legacy adapter');el.replaceWith(slot);slots.set(el,slot);document.getElementById('legacyParking').append(el)}view?.remove();status='unmounted'},
      getStatus(){return {status}}};
  }
  root.DashboardPages=Object.freeze({register(name,factory,{replace=false}={}){if(typeof factory!=='function'||!AppRouter.routes.includes(name))throw Error('INVALID_PAGE_MODULE');if(pages.has(name)&&!replace)throw Error('PAGE_ALREADY_REGISTERED');pages.set(name,factory)},create(name){const factory=pages.get(name);if(!factory)throw Error('PAGE_NOT_CONNECTED');const page=factory();if(['mount','refresh','unmount','getStatus'].some(key=>typeof page?.[key]!=='function'))throw Error('INVALID_PAGE_MODULE');return page},node,note,button,legacy});
})(globalThis);
