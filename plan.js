/* Mahjuris · limites da versão Free e convite para o Premium.
   Os números ficam em config.js (MJ_CONFIG.free) para dar para ajustar sem mexer no jogo. */
(function(){
"use strict";
const CFG=window.MJ_CONFIG||{}, F=Object.assign({jogadasPorDia:5,baralhosProprios:2,cartasPorBaralho:100},CFG.free||{});
const PRICE=CFG.premiumPreco||"";
const KEY="mahjuris.plan.v1"; // contador de jogadas do dia (sincroniza com a conta)
const IS_ANDROID=!!window.MJAndroid;
let PLAY_INFO=null; // preenchido por window.mjPlayTokenReady quando a Play confirma uma assinatura ativa
function playToken(){ if(PLAY_INFO&&PLAY_INFO.purchaseToken) return PLAY_INFO.purchaseToken; try{ return (window.MJAndroid&&MJAndroid.playPremiumToken&&String(MJAndroid.playPremiumToken()||""))||""; }catch(e){ return ""; } }
function premium(){
  if(CFG.limitesAtivos===false) return true; /* sem limites enquanto não há compra no app */
  if(window.MJSync&&MJSync.isPremium&&MJSync.isPremium()) return true;
  return !!playToken(); /* reserva: a Play diz que a assinatura está ativa neste aparelho */
}
function today(){ const d=new Date(); return d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate(); }
function read(){ try{const v=JSON.parse(localStorage.getItem(KEY)||"null"); if(v&&v.day===today()) return v}catch(e){} return {day:today(),plays:0}; }
function write(v){ try{localStorage.setItem(KEY,JSON.stringify(v))}catch(e){} }
function ownDecks(){ try{const v=JSON.parse(localStorage.getItem("mahjuris.decks.v1")||"[]"); return Array.isArray(v)?v:[]}catch(e){return []} }
let freeIds=null;
function freeBuiltin(){ // amostra grátis: o 1º assunto de cada matéria
  if(freeIds) return freeIds; freeIds=new Set(); const seen=new Set();
  (window.MJ_FREE_IDS||[]).forEach(id=>freeIds.add(id));
  (window.MJ_BUILTIN||[]).forEach(d=>{ const g=d.group||""; if(!seen.has(g)){ seen.add(g); freeIds.add(d.id); } });
  return freeIds;
}
function baseId(d){ return d&&(d.statId||d.id); }
function deckOk(d){
  if(premium()||!d) return true;
  const id=baseId(d);
  if(id==="exemplo-direito") return true;
  if((window.MJ_BUILTIN||[]).some(x=>x.id===id)) return freeBuiltin().has(id);
  const own=ownDecks(), i=own.findIndex(x=>x.id===id);
  return i<0||i<F.baralhosProprios;
}
function left(){ return Math.max(0,F.jogadasPorDia-read().plays); }
function allowPlay(d){
  if(premium()) return true;
  if(!deckOk(d)){ upsell("deck"); return false; }
  const v=read(); if(v.plays>=F.jogadasPorDia){ upsell("plays"); return false; }
  v.plays++; write(v); return true;
}
function canAddDecks(n){ return premium()||ownDecks().length+(n||1)<=F.baralhosProprios; }
function maxCards(){ return premium()?Infinity:F.cartasPorBaralho; }
function el(tag,cls,text){ const e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; }
function upsell(reason){
  const old=document.getElementById("mj-up"); if(old) old.remove();
  const o=el("div"); o.id="mj-up"; o.style.cssText="position:fixed;inset:0;z-index:96;background:rgba(10,20,24,.55);display:flex;align-items:center;justify-content:center;padding:16px";
  const b=el("div","box"); b.setAttribute("role","dialog"); b.setAttribute("aria-modal","true");
  b.style.cssText="background:var(--panel,#f6f9f8);color:var(--fg,#15242a);border:1px solid var(--line,#c3cfcf);border-radius:16px;padding:22px;max-width:420px;width:100%;display:flex;flex-direction:column;gap:10px;font-family:var(--f-body,system-ui)";
  const why={plays:"Você usou as "+F.jogadasPorDia+" jogadas grátis de hoje. Amanhã tem mais, ou libere tudo agora.",
    deck:"Este baralho faz parte do Premium. Na versão Free você joga o primeiro assunto de cada matéria e até "+F.baralhosProprios+" baralhos seus.",
    own:"Na versão Free dá para ter até "+F.baralhosProprios+" baralhos seus, com até "+F.cartasPorBaralho+" cartas cada.",
    cards:"Na versão Free cada baralho seu pode ter até "+F.cartasPorBaralho+" cartas."}[reason]||"Libere o Mahjuris completo.";
  const t=el("h2",null,"Mahjuris Premium"); t.style.cssText="margin:0;font-family:var(--f-display,system-ui);font-size:1.35rem";
  b.append(t,el("p",null,why));
  const ul=el("ul"); ul.style.cssText="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px";
  ["Jogadas ilimitadas","Todos os baralhos de fábrica (cerca de 2.700 pares de legislação)","Baralhos e cartas próprias sem limite","Vale no site e no app, na mesma conta, por 1 ano"].forEach(x=>ul.append(el("li",null,x)));
  b.append(ul);
  let price=PRICE; if(IS_ANDROID){ price=""; try{ const pp=window.MJAndroid.premiumPrice&&String(window.MJAndroid.premiumPrice()||""); if(pp) price=pp+" por ano"; }catch(e){} } // no app, só o preço da Play
  if(price) b.append(el("p",null,price));
  const buy=el("button",null,"Quero o Premium"); buy.type="button";
  buy.style.cssText="font:600 1rem var(--f-body,system-ui);border-radius:8px;padding:11px 14px;cursor:pointer;border:1px solid var(--ink,#1d4f7a);background:var(--ink,#1d4f7a);color:var(--panel,#fff)";
  const note=el("p",null,""); note.style.cssText="margin:0;font-size:.86rem;color:var(--muted,#56696e)";
  buy.addEventListener("click",()=>{
    if(IS_ANDROID){ // na Play, só pelo Google Play Billing
      if(window.MJAndroid.buyPremium){ const id=window.MJSync&&MJSync.user&&MJSync.user.id; try{ id?window.MJAndroid.buyPremium(id):window.MJAndroid.buyPremium(); }catch(e){} o.remove(); }
      else note.textContent="A compra pelo app chega na próxima atualização.";
    } else location.href="premium.html";
  });
  const close=el("button",null,reason==="plays"?"Agora não":"Voltar"); close.type="button";
  close.style.cssText="font:600 .95rem var(--f-body,system-ui);border-radius:8px;padding:10px 14px;cursor:pointer;border:1px solid var(--line,#c3cfcf);background:var(--panel,#f6f9f8);color:var(--fg,#15242a)";
  close.addEventListener("click",()=>o.remove());
  o.addEventListener("click",e=>{ if(e.target===o) o.remove(); });
  b.append(buy,close,note); o.append(b); document.body.append(o); buy.focus();
}
/* o app Android avisa aqui quando a compra pela Play terminar */
/* confere a compra da Play no servidor e grava o Premium na conta (vale também no site) */
async function verifyPlay(token){
  const cl=window.MJSync&&MJSync.client; if(!cl||!token||!MJSync.user||!MJSync.user.email) return false;
  try{ const {data,error}=await cl.functions.invoke("play-verify",{body:{purchaseToken:token,productId:"premium"}}); if(error) return false; await MJSync.loadProfile(); return !!(data&&data.premium); }catch(e){ return false; }
}
/* o app Android chama isto quando a compra pela Play termina */
window.mjPremiumChanged=async function(info){ const t=(info&&info.purchaseToken)||playToken(); if(t) await verifyPlay(t); else if(window.MJSync&&MJSync.loadProfile) await MJSync.loadProfile(); location.reload(); };
/* ao abrir: se a Play tem assinatura ativa e a conta ainda não sabe, confere (uma vez por dia) */
function dailyCheck(){ const t=playToken(); if(!t||!window.MJSync||!MJSync.user||(MJSync.isPremium&&MJSync.isPremium())) return;
  const k="mjsync.playcheck", d=new Date().toDateString(); try{ if(localStorage.getItem(k)===d) return; localStorage.setItem(k,d); }catch(e){}
  verifyPlay(t); }
/* o app avisa (sem recarregar) quando a Play confirma uma assinatura ativa, alguns segundos depois de abrir */
window.mjPlayTokenReady=function(info){ if(info&&info.purchaseToken){ PLAY_INFO=info; dailyCheck(); } };
setTimeout(dailyCheck,8000); setTimeout(dailyCheck,30000);
window.MJPlan={deckOk,allowPlay,canAddDecks,maxCards,upsell,left,premium,limits:F};
})();
