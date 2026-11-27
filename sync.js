/* Mahjuris · login e sincronização na nuvem (Supabase).
   O mesmo arquivo serve o site e o app Android.
   Como funciona:
   - O jogo continua salvando tudo no localStorage, como sempre (chaves "mahjuris.*").
   - Este arquivo percebe cada gravação, marca a hora e envia para a nuvem alguns segundos depois.
   - Ao abrir (e ao voltar para o app), baixa o que mudou em outro aparelho. Vale a gravação mais recente de cada chave.
   - Sem internet o jogo funciona normal; o que ficou pendente sobe quando a conexão voltar.
   - O jogo só começa depois do login (window.MJ_START é chamado por aqui). */
(function(){
"use strict";
const CFG=window.MJ_CONFIG||{};
const PREFIX="mahjuris.", LOCAL_ONLY=new Set(["mahjuris.ui.v1"]);
const META="mjsync.meta", OWNER="mjsync.owner", LASTPULL="mjsync.lastpull", BUILTIN_CACHE="mjsync-builtin-v1";
const IS_ANDROID=!!window.MJAndroid;
const SITE=(CFG.siteUrl||"").replace(/\/+$/,"");
const S=Storage.prototype, _set=S.setItem, _rem=S.removeItem, _get=S.getItem;
let applying=false, client=null, user=null, started=false, pushT=null, pushing=false, pendingRemote=null;
const dirty=new Set();
const ls={get:k=>{try{return _get.call(localStorage,k)}catch(e){return null}},
  set:(k,v)=>{try{_set.call(localStorage,k,v)}catch(e){}}, rem:k=>{try{_rem.call(localStorage,k)}catch(e){}}};
function readJ(k,d){try{const v=JSON.parse(ls.get(k)||"null");return v==null?d:v}catch(e){return d}}
let meta=readJ(META,{});
function saveMeta(){ls.set(META,JSON.stringify(meta))}
const synced=k=>typeof k==="string"&&k.startsWith(PREFIX)&&!LOCAL_ONLY.has(k);

/* ---------- escuta as gravações do jogo ---------- */
let frozen=false; // depois de sair da conta, nada mais é gravado até recarregar
S.setItem=function(k,v){ if(frozen&&this===localStorage&&synced(k)) return; _set.call(this,k,v); if(this===localStorage&&!applying&&synced(k)) touch(k); };
S.removeItem=function(k){ if(frozen&&this===localStorage&&synced(k)) return; _rem.call(this,k); if(this===localStorage&&!applying&&synced(k)) touch(k); };
function touch(k){ meta[k]=Date.now(); saveMeta(); dirty.add(k); schedulePush(); }
function localKeys(){ const out=[]; try{ for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i); if(synced(k)) out.push(k)} }catch(e){} return out; }

/* ---------- mescla na primeira vez que um aparelho entra numa conta que já tem dados ---------- */
function mergeVal(a,b){ // a = local, b = nuvem; em empate vence a nuvem
  if(Array.isArray(a)&&Array.isArray(b)&&[...a,...b].every(x=>x&&typeof x==="object"&&x.id!=null)){
    const m=new Map(); b.forEach(x=>m.set(x.id,x));
    a.forEach(x=>{const y=m.get(x.id); if(!y||(x.updatedAt||0)>(y.updatedAt||0)) m.set(x.id,x)});
    return [...m.values()];
  }
  if(a&&b&&typeof a==="object"&&typeof b==="object"&&!Array.isArray(a)&&!Array.isArray(b)){
    const o={...a};
    for(const k of Object.keys(b)){
      const x=a[k], y=b[k];
      if(x===undefined){o[k]=y; continue}
      if(x&&y&&typeof x==="object"&&typeof y==="object"&&("updatedAt" in x||"updatedAt" in y)) o[k]=(x.updatedAt||0)>(y.updatedAt||0)?x:y;
      else if(x&&y&&typeof x==="object"&&typeof y==="object"&&!Array.isArray(x)) o[k]=mergeVal(x,y);
      else o[k]=y;
    }
    return o;
  }
  return b;
}
function mergeStr(l,r){ try{ return JSON.stringify(mergeVal(JSON.parse(l),JSON.parse(r))) }catch(e){ return r } }

/* ---------- nuvem ---------- */
function online(){ return navigator.onLine!==false }
function withTimeout(p,ms){ return Promise.race([p,new Promise((_,r)=>setTimeout(()=>r(new Error("timeout")),ms))]) }
function schedulePush(ms){ clearTimeout(pushT); pushT=setTimeout(push,ms==null?2500:ms); }
async function push(){
  if(!client||!user||pushing||!dirty.size) return;
  if(!online()){ status(); return }
  pushing=true; const keys=[...dirty]; dirty.clear();
  try{
    const rows=keys.map(k=>({user_id:user.id,key:k,value:ls.get(k),updated_at:meta[k]||Date.now()}));
    const {error}=await withTimeout(client.from("user_data").upsert(rows,{onConflict:"user_id,key"}),30000);
    if(error) throw error;
    ls.set("mjsync.lastpush",String(Date.now()));
  }catch(e){ keys.forEach(k=>dirty.add(k)); schedulePush(30000); }
  pushing=false; saveDirty(); status();
}
function saveDirty(){ ls.set("mjsync.dirty",JSON.stringify([...dirty])) }
readJ("mjsync.dirty",[]).forEach(k=>dirty.add(k));
setInterval(saveDirty,5000);

async function fetchRemote(){ // devolve {key:{value,updated_at}} só do que é mais novo que o local
  const {data,error}=await withTimeout(client.from("user_data").select("key,updated_at").eq("user_id",user.id),20000);
  if(error) throw error;
  const newer=data.filter(r=>(r.updated_at||0)>(meta[r.key]||0)).map(r=>r.key);
  const out={};
  for(let i=0;i<newer.length;i+=20){
    const {data:rows,error:e2}=await withTimeout(client.from("user_data").select("key,value,updated_at").eq("user_id",user.id).in("key",newer.slice(i,i+20)),60000);
    if(e2) throw e2;
    rows.forEach(r=>out[r.key]={value:r.value,updated_at:r.updated_at});
  }
  return {newer:out,remoteKeys:new Set(data.map(r=>r.key))};
}
function applyRemote(newer){ // grava no aparelho; devolve true se mudou algo
  let changed=false; applying=true;
  try{
    for(const [k,r] of Object.entries(newer)){
      if((r.updated_at||0)<=(meta[k]||0)) continue; // mudou aqui depois que baixamos
      if(r.value==null) ls.rem(k); else ls.set(k,r.value);
      meta[k]=r.updated_at; dirty.delete(k); changed=true;
    }
  }finally{applying=false}
  saveMeta(); saveDirty(); ls.set(LASTPULL,String(Date.now()));
  return changed;
}
/* primeira sincronização deste aparelho com esta conta */
async function firstLink(){
  const {newer,remoteKeys}=await fetchRemote();
  applying=true;
  try{
    for(const k of localKeys()){
      if(meta[k]) continue;
      const r=newer[k];
      if(r&&r.value!=null){ ls.set(k,mergeStr(ls.get(k),r.value)); delete newer[k]; }
      meta[k]=Date.now(); dirty.add(k);
    }
  }finally{applying=false}
  saveMeta(); applyRemote(newer); ls.set(OWNER,user.id);
  void remoteKeys; schedulePush(500);
}
async function pull(){
  if(!client||!user||!online()) return;
  try{
    const {newer}=await fetchRemote();
    if(!Object.keys(newer).length){ ls.set(LASTPULL,String(Date.now())); status(); return; }
    if(!started){ applyRemote(newer); return; }
    pendingRemote={...(pendingRemote||{}),...newer}; tryApplyPending();
  }catch(e){}
  status();
}
function idle(){
  if(typeof window.MJ_IDLE==="function") return !!window.MJ_IDLE();
  const play=document.getElementById("view-play"), ov=document.getElementById("overlay"), menu=document.getElementById("view-menu");
  return (!play||play.hidden)&&(!ov||ov.hidden)&&(!menu||!menu.hidden);
}
function tryApplyPending(){
  if(!pendingRemote) return;
  if(!idle()) return;
  const n=pendingRemote; pendingRemote=null;
  if(applyRemote(n)){ ls.set("mjsync.toast","1"); location.reload(); }
}
setInterval(()=>{ tryApplyPending(); },4000);
setInterval(()=>{ if(document.visibilityState==="visible") pull(); },5*60*1000);
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="hidden") push();
  else if(Date.now()-(+ls.get(LASTPULL)||0)>60000) pull();
});
window.addEventListener("online",()=>{ schedulePush(200); pull(); status(); });
window.addEventListener("offline",()=>status());
window.addEventListener("pagehide",()=>{ saveDirty(); push(); });

/* ---------- baralhos de fábrica no site (só para contas liberadas) ---------- */
async function loadProfile(){ // plano da conta (free/premium), guardado para uso offline
  try{
    const {data:prof,error}=await withTimeout(client.from("profiles").select("premium,premium_until,premium_source").eq("id",user.id).maybeSingle(),10000);
    if(!error){ ls.set("mjsync.plan",JSON.stringify({premium:!!(prof&&prof.premium),until:prof&&prof.premium_until||null,source:prof&&prof.premium_source||null,checked:Date.now()})); }
  }catch(e){}
  return readJ("mjsync.plan",{premium:false});
}
function isPremium(){ const p=readJ("mjsync.plan",{premium:false}); if(!p.premium) return false; if(p.until&&new Date(p.until).getTime()<Date.now()) return false; return true; }
async function loadBuiltin(){
  if(IS_ANDROID) return; // no app os baralhos de fábrica já vêm no pacote
  if(!isPremium()){ try{await caches.delete(BUILTIN_CACHE)}catch(e){} return; } // site free usa o baralhos.js público (só a amostra)
  let txt=null;
  try{
    const {data:blob,error}=await withTimeout(client.storage.from("premium").download("baralhos.json"),60000);
    if(!error&&blob){ txt=await blob.text(); try{const c=await caches.open(BUILTIN_CACHE); await c.put("/baralhos.json",new Response(txt))}catch(e){} }
  }catch(e){}
  if(txt==null){ try{const c=await caches.open(BUILTIN_CACHE); const r=await c.match("/baralhos.json"); if(r) txt=await r.text()}catch(e){} }
  if(txt){ try{ window.MJ_BUILTIN=JSON.parse(txt) }catch(e){} }
}

/* ---------- interface: tela de login e painel da conta ---------- */
const CSS=`
#mj-gate{position:fixed;inset:0;z-index:100;background:var(--bg,#e4ebea);color:var(--fg,#15242a);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;font-family:var(--f-body,system-ui,sans-serif)}
#mj-gate .box,#mj-acc .box{background:var(--panel,#f6f9f8);border:1px solid var(--line,#c3cfcf);border-radius:16px;padding:22px;width:100%;max-width:400px;display:flex;flex-direction:column;gap:12px}
#mj-gate h1{font-family:var(--f-display,system-ui);font-weight:800;font-size:2rem;margin:0;letter-spacing:-.02em}
#mj-gate h1 span{color:var(--ox,#8c2d2a)}
.mjs-f{display:flex;flex-direction:column;gap:4px}
.mjs-f label{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted,#56696e);font-weight:600}
.mjs-f input{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid var(--line,#c3cfcf);background:var(--bg,#fff);color:var(--fg,#15242a)}
.mjs-b{font:600 .95rem var(--f-body,system-ui);border-radius:8px;padding:10px 14px;cursor:pointer;border:1px solid var(--line,#c3cfcf);background:var(--panel,#f6f9f8);color:var(--fg,#15242a)}
.mjs-b.pri{background:var(--ink,#1d4f7a);border-color:var(--ink,#1d4f7a);color:var(--panel,#fff)}
.mjs-b.dan{color:var(--err,#b3261e)}
.mjs-b:disabled{opacity:.55;cursor:default}
.mjs-l{background:none;border:0;color:var(--ink,#1d4f7a);font:inherit;text-decoration:underline;cursor:pointer;padding:0;text-align:left}
.mjs-n{font-size:.86rem;color:var(--muted,#56696e);margin:0}
.mjs-m{font-size:.9rem;margin:0;min-height:1.2em}
.mjs-m.err{color:var(--err,#b3261e)} .mjs-m.ok{color:var(--ok,#2c7a4d)}
.mjs-ck{display:flex;gap:8px;align-items:flex-start;font-size:.88rem}
.mjs-ck input{margin-top:3px}
#mj-acc{position:fixed;inset:0;z-index:90;background:rgba(10,20,24,.55);display:flex;align-items:center;justify-content:center;padding:16px}
#mj-acc h2{margin:0;font-family:var(--f-display,system-ui);font-size:1.3rem}
#mj-accbtn{white-space:nowrap}
#mj-accbtn .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:var(--ok,#2c7a4d);vertical-align:1px}
#mj-accbtn .dot.wait{background:var(--hint,#c98a12)} #mj-accbtn .dot.off{background:var(--muted,#56696e)}
#mj-toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:95;background:var(--fg,#15242a);color:var(--bg,#fff);padding:10px 16px;border-radius:10px;font-size:.9rem;max-width:calc(100% - 32px)}
`;
function h(tag,attrs,...kids){ const e=document.createElement(tag); for(const [k,v] of Object.entries(attrs||{})){ if(k==="on") for(const [ev,fn] of Object.entries(v)) e.addEventListener(ev,fn); else if(k==="text") e.textContent=v; else e.setAttribute(k,v); } kids.flat().forEach(c=>c!=null&&e.append(c)); return e; }
function toast(t,ms){ const o=document.getElementById("mj-toast"); if(o) o.remove(); const e=h("div",{id:"mj-toast",role:"status",text:t}); document.body.appendChild(e); setTimeout(()=>e.remove(),ms||3500); }
const privacyUrl=()=>IS_ANDROID?(SITE?SITE+"/privacidade.html":"privacidade.html"):"privacidade.html";
function errPt(e){
  const m=(e&&(e.message||e.error_description||String(e)))||"";
  if(/Invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
  if(/Email not confirmed/i.test(m)) return "Confirme o seu e-mail antes de entrar. Procure a mensagem do Mahjuris na sua caixa de entrada (e no spam).";
  if(/already registered|already exists/i.test(m)) return "Já existe uma conta com este e-mail. Use Entrar.";
  if(/at least 6|Password should be/i.test(m)) return "A senha precisa ter pelo menos 8 caracteres.";
  if(/expired|invalid.*(otp|token)|Token has expired/i.test(m)) return "Código errado ou vencido. Confira o e-mail mais recente ou peça um novo.";
  if(/not authorized|Email address .* invalid/i.test(m)) return "Não foi possível mandar e-mail para este endereço. Confira se está certo.";
  if(/rate limit|too many/i.test(m)) return "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.";
  if(/timeout|Failed to fetch|NetworkError|network/i.test(m)) return "Sem conexão com a internet. Para entrar pela primeira vez neste aparelho é preciso estar on-line.";
  return "Não deu certo: "+m;
}
function gate(mode,opt){
  opt=opt||{};
  let g=document.getElementById("mj-gate"); if(g) g.remove();
  mode=mode||"login";
  const msg=h("p",{class:"mjs-m","aria-live":"polite"});
  const email=h("input",{type:"email",id:"mjs-email",autocomplete:"email",inputmode:"email",required:""});
  const pass=h("input",{type:"password",id:"mjs-pass",autocomplete:mode==="signup"?"new-password":"current-password",minlength:"8"});
  const consent=h("input",{type:"checkbox",id:"mjs-consent"});
  const box=h("form",{class:"box",novalidate:""});
  const title=h("h1",{},"Mah",h("span",{text:"juris"}));
  const code=h("input",{type:"text",id:"mjs-code",inputmode:"numeric",autocomplete:"one-time-code",maxlength:"10"});
  const sub=h("p",{class:"mjs-n",text:mode==="code"?(opt.type==="recovery"?"Enviamos um código para "+opt.email+". Digite o código e a sua nova senha.":"Enviamos um código para "+opt.email+". Digite o código para confirmar a conta."):mode==="signup"?"Crie a sua conta. Os seus baralhos, o progresso e as estatísticas ficam guardados na nuvem e aparecem no site e no app.":mode==="reset"?"Informe o seu e-mail. Vamos mandar um código para você criar uma senha nova.":mode==="newpass"?"Digite a sua nova senha.":"Entre na sua conta para jogar. Os seus dados ficam salvos na nuvem e funcionam também sem internet."});
  box.append(title,sub);
  if(!client){
    box.append(h("p",{class:"mjs-m err",text:"O login ainda não foi configurado neste site (faltam as chaves no arquivo config.js)."}),
      h("button",{type:"button",class:"mjs-b pri",on:{click:()=>{g.remove(); begin(null)}}},"Testar sem conta"));
  } else {
    if(opt.email) email.value=opt.email;
    if(mode!=="newpass"&&mode!=="code") box.append(h("div",{class:"mjs-f"},h("label",{for:"mjs-email",text:"E-mail"}),email));
    if(mode==="code") box.append(h("div",{class:"mjs-f"},h("label",{for:"mjs-code",text:"Código recebido por e-mail"}),code));
    if(mode!=="reset"&&!(mode==="code"&&opt.type!=="recovery")) box.append(h("div",{class:"mjs-f"},h("label",{for:"mjs-pass",text:mode==="newpass"||mode==="code"?"Nova senha":"Senha"}),pass));
    if(mode==="signup") box.append(h("label",{class:"mjs-ck"},consent,h("span",{},"Li e aceito a ",h("a",{href:privacyUrl(),target:"_blank",rel:"noopener",text:"Política de Privacidade"}),".")));
    const main=h("button",{type:"submit",class:"mjs-b pri",text:{login:"Entrar",signup:"Criar conta",reset:"Enviar código",newpass:"Salvar senha",code:opt.type==="recovery"?"Salvar nova senha":"Confirmar"}[mode]});
    box.append(main,msg);
    const links=h("div",{style:"display:flex;flex-direction:column;gap:8px;align-items:flex-start"});
    if(mode==="login"){ links.append(h("button",{type:"button",class:"mjs-l",text:"Criar uma conta",on:{click:()=>gate("signup")}}),h("button",{type:"button",class:"mjs-l",text:"Esqueci a minha senha",on:{click:()=>gate("reset")}})); }
    else if(mode!=="newpass") links.append(h("button",{type:"button",class:"mjs-l",text:"Já tenho conta: entrar",on:{click:()=>gate("login")}}));
    if(mode==="code") links.prepend(h("button",{type:"button",class:"mjs-l",text:"Não chegou? Enviar de novo",on:{click:async()=>{ try{ const r=opt.type==="recovery"?await client.auth.resetPasswordForEmail(opt.email):await client.auth.resend({type:"signup",email:opt.email}); if(r.error) throw r.error; msg.className="mjs-m ok"; msg.textContent="Enviamos de novo. Veja também a caixa de spam."; }catch(e){ msg.className="mjs-m err"; msg.textContent=errPt(e); } }}}));
    links.append(h("a",{href:privacyUrl(),target:"_blank",rel:"noopener",class:"mjs-n",text:"Política de Privacidade"}));
    box.append(links);
    box.addEventListener("submit",async ev=>{
      ev.preventDefault(); msg.className="mjs-m"; msg.textContent="";
      const em=email.value.trim(), pw=pass.value;
      if(mode!=="newpass"&&!/^\S+@\S+\.\S+$/.test(em)){ msg.className="mjs-m err"; msg.textContent="Digite um e-mail válido."; return; }
      if(mode==="code"&&!/^\d{6,10}$/.test(code.value.trim())){ msg.className="mjs-m err"; msg.textContent="Digite o código de números que chegou no seu e-mail."; return; }
      if(mode!=="reset"&&!(mode==="code"&&opt.type!=="recovery")&&pw.length<8){ msg.className="mjs-m err"; msg.textContent="A senha precisa ter pelo menos 8 caracteres."; return; }
      if(mode==="signup"&&!consent.checked){ msg.className="mjs-m err"; msg.textContent="Para criar a conta, marque que leu e aceita a Política de Privacidade."; return; }
      main.disabled=true; msg.textContent="Aguarde…";
      try{
        if(mode==="login"){
          const {data,error}=await withTimeout(client.auth.signInWithPassword({email:em,password:pw}),20000); if(error) throw error;
          g.remove(); await afterLogin(data.user);
        } else if(mode==="signup"){
          const {data,error}=await withTimeout(client.auth.signUp({email:em,password:pw,options:{emailRedirectTo:(SITE||location.origin)+"/",data:{consent_at:new Date().toISOString(),origem:IS_ANDROID?"android":"web"}}}),20000); if(error) throw error;
          if(data.session){ g.remove(); await afterLogin(data.user); }
          else { gate("code",{email:em,type:"signup"}); return; }
        } else if(mode==="reset"){
          const {error}=await withTimeout(client.auth.resetPasswordForEmail(em,{redirectTo:(SITE||location.origin)+"/"}),20000); if(error) throw error;
          gate("code",{email:em,type:"recovery"}); return;
        } else if(mode==="code"){
          const {data,error}=await withTimeout(client.auth.verifyOtp({email:opt.email,token:code.value.trim(),type:opt.type==="recovery"?"recovery":"signup"}),20000); if(error) throw error;
          if(opt.type==="recovery"){ const r=await withTimeout(client.auth.updateUser({password:pw}),20000); if(r.error) throw r.error; toast("Senha alterada."); }
          g.remove(); await afterLogin(data.user);
        } else {
          const {error}=await withTimeout(client.auth.updateUser({password:pw}),20000); if(error) throw error;
          g.remove(); toast("Senha alterada."); const {data}=await client.auth.getUser(); if(data&&data.user&&!started) await afterLogin(data.user);
        }
      }catch(e){ msg.className="mjs-m err"; msg.textContent=errPt(e); main.disabled=false; }
    });
  }
  g=h("div",{id:"mj-gate",role:"dialog","aria-modal":"true","aria-label":"Entrar no Mahjuris"},box);
  document.body.appendChild(g);
  setTimeout(()=>{const f=g.querySelector("input"); if(f) f.focus()},50);
}
function status(){
  const b=document.getElementById("mj-accbtn"); if(!b) return;
  const dot=b.querySelector(".dot");
  if(!user){ dot.className="dot off"; b.title="Sem conta"; return; }
  if(!online()){ dot.className="dot off"; b.title="Sem internet. As mudanças sobem quando a conexão voltar."; }
  else if(dirty.size||pushing){ dot.className="dot wait"; b.title="Enviando para a nuvem…"; }
  else { dot.className="dot"; b.title="Tudo salvo na nuvem."; }
  const n=document.getElementById("sync-note");
  if(n) n.textContent=!online()?"Sem internet: salvando neste aparelho. Sobe para a sua conta quando a conexão voltar.":dirty.size?"Enviando para a sua conta…":"Salvo na sua conta ("+user.email+") e neste aparelho.";
  const st=document.getElementById("mjs-st"); if(st) st.textContent=b.title;
}
function accountPanel(){
  const old=document.getElementById("mj-acc"); if(old) old.remove();
  const close=()=>o.remove();
  const box=h("div",{class:"box",role:"dialog","aria-modal":"true","aria-labelledby":"mjs-acc-t"});
  const o=h("div",{id:"mj-acc",on:{click:e=>{if(e.target===o) close()}}},box);
  box.append(h("h2",{id:"mjs-acc-t",text:"Sua conta"}));
  if(!user){
    box.append(h("p",{class:"mjs-n",text:"Você está testando sem conta. Os dados ficam só neste aparelho."}),h("button",{class:"mjs-b",type:"button",text:"Fechar",on:{click:close}}));
    document.body.appendChild(o); return;
  }
  const last=+ls.get(LASTPULL)||0;
  box.append(h("p",{class:"mjs-m",text:user.email}),
    h("p",{class:"mjs-n",id:"mjs-st"}),
    h("p",{class:"mjs-n",text:last?"Última conferência com a nuvem: "+new Date(last).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"}):"Ainda não conferiu com a nuvem."}));
  const syncB=h("button",{class:"mjs-b pri",type:"button",text:"Sincronizar agora",on:{click:async()=>{syncB.disabled=true; syncB.textContent="Sincronizando…"; await push(); await pull(); syncB.disabled=false; syncB.textContent="Sincronizar agora"; status(); if(!pendingRemote) toast(online()?"Tudo em dia.":"Sem internet agora.")}}});
  box.append(syncB);
  box.append(h("p",{class:"mjs-n",text:isPremium()?"Plano: Premium"+(readJ("mjsync.plan",{}).until?" até "+new Date(readJ("mjsync.plan",{}).until).toLocaleDateString("pt-BR"):"")+".":"Plano: Free."}));
  if(!isPremium()&&window.MJPlan) box.append(h("button",{class:"mjs-b",type:"button",text:"Conhecer o Premium",on:{click:()=>{close(); MJPlan.upsell()}}}));
  const creator=IS_ANDROID?(SITE?SITE+"/criar.html":null):"criar.html";
  const here=/criar\.html/.test(location.pathname);
  if(here) box.append(h("a",{class:"mjs-b",href:"index.html",style:"text-align:center;text-decoration:none",text:"Voltar ao jogo"}));
  else if(creator) box.append(h("a",{class:"mjs-b",href:creator,target:IS_ANDROID?"_blank":"_self",style:"text-align:center;text-decoration:none",text:"Criar cards no site"}));
  box.append(h("button",{class:"mjs-b",type:"button",text:"Sair da conta",on:{click:()=>logout(false)}}));
  const delWrap=h("details",{},h("summary",{class:"mjs-n",style:"cursor:pointer",text:"Excluir minha conta"}));
  const conf=h("input",{type:"text",id:"mjs-del",placeholder:"EXCLUIR",autocomplete:"off"});
  const delMsg=h("p",{class:"mjs-m err","aria-live":"polite"});
  const delB=h("button",{class:"mjs-b dan",type:"button",text:"Excluir conta e todos os dados",on:{click:async()=>{
    if(conf.value.trim().toUpperCase()!=="EXCLUIR"){ delMsg.textContent="Digite EXCLUIR para confirmar."; return; }
    delB.disabled=true; delMsg.textContent="Excluindo…";
    try{ const {error}=await withTimeout(client.rpc("delete_my_account"),20000); if(error) throw error; dirty.clear(); await logout(true); }
    catch(e){ delB.disabled=false; delMsg.textContent=errPt(e); }
  }}});
  delWrap.append(h("div",{style:"display:flex;flex-direction:column;gap:8px;margin-top:8px"},
    h("p",{class:"mjs-n",text:"Apaga para sempre a sua conta, os baralhos que você criou, o progresso e as estatísticas, na nuvem e neste aparelho. Não dá para desfazer. Digite EXCLUIR para confirmar."}),
    h("div",{class:"mjs-f"},h("label",{for:"mjs-del",text:"Confirmação"}),conf),delB,delMsg));
  box.append(delWrap,
    h("a",{href:privacyUrl(),target:"_blank",rel:"noopener",class:"mjs-n",text:"Política de Privacidade"}),
    h("button",{class:"mjs-b",type:"button",text:"Fechar",on:{click:close}}));
  document.body.appendChild(o); status();
}
function clearLocalData(){
  frozen=true; applying=true;
  try{ for(const k of localKeys()) ls.rem(k); }finally{applying=false}
  ["mjsync.plan","mjsync.meta","mjsync.dirty","mjsync.lastpull","mjsync.lastpush",OWNER].forEach(ls.rem); meta={}; dirty.clear();
  try{caches.delete(BUILTIN_CACHE)}catch(e){}
}
async function logout(deleted){
  if(!deleted&&dirty.size){
    await push();
    if(dirty.size&&!confirmLeave()) return;
  }
  try{ await withTimeout(client.auth.signOut({scope:"local"}),8000) }catch(e){}
  clearLocalData(); location.reload();
}
function confirmLeave(){ // sem window.confirm (bloqueia o WebView): um segundo toque confirma
  const b=document.querySelector("#mj-acc .mjs-b:nth-of-type(3)");
  if(window.__mjLeave){ return true; }
  window.__mjLeave=true; toast("Há mudanças que ainda não subiram (sem internet). Toque em Sair de novo para sair e perdê-las.",6000); void b; return false;
}
function addAccountButton(){
  if(document.getElementById("mj-accbtn")) return;
  const host=document.querySelector("#hdr .tabs")||document.getElementById("mj-acc-host")||document.body;
  const b=h("button",{id:"mj-accbtn",type:"button","aria-label":"Sua conta",on:{click:accountPanel}},h("span",{class:"dot"}),"Conta");
  if(host.id==="mj-acc-host") b.className="btn";
  if(host===document.body){ b.className="mjs-b"; b.style.cssText="position:fixed;top:10px;right:10px;z-index:40"; }
  host.appendChild(b); status();
}

/* ---------- início ---------- */
async function afterLogin(u){
  user=u;
  if(ls.get(OWNER)&&ls.get(OWNER)!==u.id){ clearLocalData(); location.reload(); return; } // outra pessoa usou este aparelho
  const splash=h("div",{id:"mj-gate"},h("div",{class:"box"},h("h1",{},"Mah",h("span",{text:"juris"})),h("p",{class:"mjs-n",text:"Carregando os seus dados…"})));
  if(!started) document.body.appendChild(splash);
  try{
    if(online()){
      if(ls.get(OWNER)!==u.id) await withTimeout(firstLink(),45000);
      else await withTimeout(pull(),15000);
    }
  }catch(e){ if(ls.get(OWNER)!==u.id) ls.set(OWNER,u.id); }
  if(!ls.get(OWNER)) ls.set(OWNER,u.id);
  if(online()) await loadProfile();
  if(!started){ try{ await withTimeout(loadBuiltin(),60000) }catch(e){} }
  splash.remove();
  begin(u);
  schedulePush(1000);
  if(IS_ANDROID&&client){ client.rpc("note_android_login").then(()=>{},()=>{}); }
}
function begin(u){
  if(started) return; started=true; user=u||null;
  if(typeof window.MJ_START==="function") window.MJ_START();
  addAccountButton(); status();
  if(ls.get("mjsync.toast")){ ls.rem("mjsync.toast"); toast("Dados atualizados com o que você fez em outro aparelho."); }
  else { const pl=readJ("mjsync.plan",{}); if(pl.premium&&pl.until){ const d=Math.ceil((new Date(pl.until).getTime()-Date.now())/864e5), day=new Date().toDateString();
    if(d<0&&d>-30&&ls.get("mjsync.avisovenc")!==day){ ls.set("mjsync.avisovenc",day); toast("O seu Premium venceu em "+new Date(pl.until).toLocaleDateString("pt-BR")+". Renove para continuar com tudo liberado.",6000); }
    else if(d>=0&&d<=10&&ls.get("mjsync.avisovenc")!==day){ ls.set("mjsync.avisovenc",day); toast("O seu Premium vence em "+(d<=1?"1 dia":d+" dias")+". Renove pela Conta para não perder o acesso.",6000); } } }
}
async function boot(){
  const st=document.createElement("style"); st.textContent=CSS; document.head.appendChild(st);
  if(CFG.supabaseUrl&&CFG.supabaseAnonKey&&window.supabase){
    client=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:"mjsync.auth",flowType:"implicit"}});
    let recovery=/type=recovery/.test(location.hash);
    client.auth.onAuthStateChange((ev,session)=>{
      if(ev==="PASSWORD_RECOVERY"){ recovery=true; gate("newpass"); }
      if(ev==="SIGNED_OUT"&&started&&user){ /* sessão expirou em outro lugar: segue jogando offline; volta a pedir login na próxima abertura */ }
      void session;
    });
    let session=null;
    try{ const r=await client.auth.getSession(); session=r.data&&r.data.session; }catch(e){}
    if(recovery&&session){ gate("newpass"); return; }
    if(session&&session.user){ await afterLogin(session.user); return; }
    // sem sessão salva: se o aparelho já tem dono e está sem internet, deixa jogar offline com os dados locais
    if(!online()&&ls.get(OWNER)){ begin({id:ls.get(OWNER),email:"(sem internet)"}); return; }
    gate("login");
  } else gate("login");
}
window.MJSync={push,pull,status,isPremium,loadProfile,get client(){return client},get user(){return user},get started(){return started},touch};
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot); else boot();
})();
