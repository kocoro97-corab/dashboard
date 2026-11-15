(function(){
  'use strict';
  DashboardPages.register('market',()=>DashboardPages.legacy({ids:['marketSection','tickSection','workMacroLivePreview'],
    intro:'기존 지수·금리·환율·변동성·원자재 및 거시경제 분석을 연결합니다. 미지원 선물·$TICK 위젯·신규 Work 분석은 미연결 상태를 유지합니다.',
    refresh:async(ctx,force)=>{await ctx.market(force);if(!ctx.development())await ctx.once('tick-widget',()=>{const ti=LS('invest_tick');if(ti){$('tin').value=ti;setTick()}TS.w='wait';tickStatus();embed($('tickq'),'single-quote',{symbol:'USI:TICK',width:'100%',colorTheme:'dark',isTransparent:true,locale:'kr'},ok=>{TS.w=ok?'ok':'fail';TS.wAt=new Date();tickStatus()})})}}));
})();
