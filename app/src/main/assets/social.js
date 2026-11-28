/* Mahjuris · nickname, ranking (geral e por grupo) e grupos de amigos.
   Usa a mesma conta do Supabase (sync.js). Os pontos de cada dia saem do diário do jogo (mahjuris.daily.v1)
   e são calculados no servidor: 10 por par certo, -5 por erro (o dia não fica negativo), +20 por fase concluída.
   As funções do servidor estão em supabase/ranking-grupos.sql. */
(function(){
"use strict";
const CFG=window.MJ_CONFIG||{};
const PLANS=Object.assign({plus:{nome:"Premium Plus",preco:"R$ 39,90 por ano",grupos:5,pessoas:10},turma:{nome:"Plano Turma",preco:"R$ 99,90 por ano",grupos:20,pessoas:40}},CFG.planosGrupo||{});
const NICK_RE=/^[A-Za-z0-9_.À-ÿ-]{3,20}$/;
const LKEY="mjrank.nick"; // fora do prefixo mahjuris.: não sincroniza, é só um lembrete local
const S={me:null,groups:[],scope:"",period:"semana",order:"pontos",open:null,people:{},editNick:false,box:null,busy:false,arm:null};
let pushT=null, lastPush="";

const cl=()=>window.MJSync&&MJSync.client;
const usr=()=>window.MJSync&&MJSync.user;
const logged=()=>!!(cl()&&usr()&&usr().id&&usr().email!=="(sem internet)");
function el(tag,cls,text){ const e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; }
function btn(label,cls,fn){ const b=el("button",cls,label); b.type="button"; b.addEventListener("click",fn); return b; }
function dur(ms){ const m=Math.floor((ms||0)/60000),h=Math.floor(m/60); return h?h+"h "+String(m%60).padStart(2,"0")+"min":m+" min"; }
function toast(t){ try{ const o=document.getElementById("mj-toast"); if(o) o.remove(); const e=el("div",null,t); e.id="mj-toast"; e.setAttribute("role","status"); document.body.appendChild(e); setTimeout(()=>e.remove(),3500); }catch(e){} }
function copy(t){ try{ if(window.MJAndroid&&MJAndroid.copyText){ MJAndroid.copyText(t); return Promise.resolve(true); } }catch(e){}
  if(navigator.clipboard&&window.isSecureContext) return navigator.clipboard.writeText(t).then(()=>true,()=>false); return Promise.resolve(false); }

const MSG={sem_nickname:"Escolha um nickname antes.",nickname_invalido:"Use de 3 a 20 letras, números, ponto, hífen ou sublinhado, sem espaços.",nickname_em_uso:"Esse nickname já é de outra pessoa. Tente outro.",
  plano_sem_grupos:"O seu plano não cria grupos.",limite_grupos:"Você já criou o máximo de grupos do seu plano.",nome_invalido:"O nome do grupo precisa ter de 2 a 40 letras.",
  codigo_invalido:"Não achei nenhum grupo com esse código. Confira as letras e números.",grupo_cheio:"Esse grupo já está cheio.",muitos_grupos:"Você já está em 30 grupos, o máximo.",
  dono_nao_sai:"Quem criou o grupo não pode sair dele. Se quiser, exclua o grupo.",so_o_dono:"Só quem criou o grupo pode fazer isso.",fora_do_grupo:"Você não está mais nesse grupo.",tente_de_novo:"Não deu certo agora. Tente de novo."};
function errMsg(e){ const m=(e&&(e.message||e.details||e.hint))||String(e||"");
  for(const k of Object.keys(MSG)) if(m.indexOf(k)>=0) return MSG[k];
  if(/Could not find the function|PGRST202|does not exist/i.test(m)) return "O ranking ainda não foi ativado no servidor.";
  if(/Failed to fetch|NetworkError|network|timeout/i.test(m)) return "Sem conexão com a internet agora.";
  return "Não deu certo: "+m; }
async function rpc(name,args){ const r=await Promise.race([cl().rpc(name,args||{}),new Promise((_,x)=>setTimeout(()=>x(new Error("timeout")),20000))]); if(r.error) throw r.error; return r.data; }

/* ---------- envio dos pontos do diário ---------- */
function daysPayload(){
  let D={}; try{ D=(JSON.parse(localStorage.getItem("mahjuris.daily.v1")||"{}")||{}).days||{}; }catch(e){}
  const lim=new Date(); lim.setDate(lim.getDate()-35); const z=n=>String(n).padStart(2,"0"); const min=lim.getFullYear()+"-"+z(lim.getMonth()+1)+"-"+z(lim.getDate());
  return Object.keys(D).filter(k=>k>=min&&/^\d{4}-\d{2}-\d{2}$/.test(k)).sort().map(k=>{ const y=D[k]||{}; return {day:k,ms:Math.round(y.ms||0),study_ms:Math.round(y.st||0),ok:y.ok||0,err:y.err||0,phases:y.fases||0}; })
    .filter(x=>x.ms||x.study_ms||x.ok||x.err||x.phases);
}
async function pushDays(){
  if(!logged()||!localStorage.getItem(LKEY)) return;
  const p=daysPayload(); if(!p.length) return; const sig=JSON.stringify(p); if(sig===lastPush) return;
  try{ await rpc("post_days",{p_days:p}); lastPush=sig; }catch(e){}
}
function changed(){ clearTimeout(pushT); pushT=setTimeout(pushDays,8000); }
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="hidden") pushDays(); });

/* ---------- tela ---------- */
function head(box){ box.appendChild(el("h3",null,"Ranking")); }
let TOK=0;
async function render(target){
  S.box=target||S.box; const real=S.box; if(!real) return;
  const tok=++TOK, box=el("div");
  if(!real.childNodes.length||S.me==null){ real.innerHTML=""; head(real); real.appendChild(el("p","note","Carregando…")); }
  await build(box);
  if(tok===TOK) real.replaceChildren(...box.childNodes);
}
async function build(box){
  head(box);
  if(!logged()){ box.appendChild(el("p","note",cl()?"Para entrar no ranking é preciso estar na sua conta e com internet. Abra a Conta e entre.":"O ranking precisa de uma conta. Ele funciona quando o login estiver ativo neste aparelho.")); return; }
  if(!S.me){
    try{ S.me=await rpc("rank_me"); }catch(e){ box.appendChild(el("p","note",errMsg(e))); box.appendChild(btn("Tentar de novo","btn small",()=>{S.me=null; render()})); return; }
    if(S.me&&S.me.nickname){ try{localStorage.setItem(LKEY,S.me.nickname)}catch(e){} } else { try{localStorage.removeItem(LKEY)}catch(e){} } }
  if(!S.me.nickname||S.editNick){ nickForm(box); return; }
  pushDays();
  const who=el("div","st-acts"); who.style.alignItems="center";
  const me=el("p",null); me.style.margin="0"; me.append("Você joga como ",el("strong",null,S.me.nickname),S.me.global?"":" (fora do ranking geral)");
  who.append(me,btn("Trocar nickname","btn small",()=>{S.editNick=true; render()})); box.appendChild(who);
  await boardSection(box);
  await groupsSection(box);
  box.appendChild(el("p","note","Pontos: 10 por par certo, menos 5 por erro (um dia nunca fica negativo) e mais 20 por fase concluída. Só conta o que você joga nos baralhos; o cronômetro de estudo fica no seu diário e não entra no ranking. Para outras pessoas aparece só o seu nickname."));
}
function nickForm(box){
  const f=el("form","editform");
  f.appendChild(el("p",null,S.me.nickname?"Troque o seu nickname ou escolha se aparece no ranking geral.":"Escolha um nickname para entrar no ranking. É o único dado seu que outras pessoas veem: o seu e-mail nunca aparece."));
  const fd=el("div","field"); const lb=el("label",null,"Nickname"); lb.htmlFor="rk-nick"; const inp=el("input"); inp.type="text"; inp.id="rk-nick"; inp.maxLength=20; inp.autocomplete="off"; inp.value=S.me.nickname||""; inp.placeholder="Ex.: concurseira_rs";
  fd.append(lb,inp);
  const ck=el("label","impdeck"); const cb=el("input"); cb.type="checkbox"; cb.checked=S.me.global!==false; ck.append(cb,el("span",null,"Aparecer no ranking geral, com todos os jogadores (nos seus grupos você sempre aparece)"));
  const msg=el("p","msg"); msg.style.color="var(--err)";
  const row=el("div","row"); const sb=el("button","btn primary",S.me.nickname?"Salvar":"Entrar no ranking"); sb.type="submit"; row.appendChild(sb);
  if(S.me.nickname) row.appendChild(btn("Cancelar","btn",()=>{S.editNick=false; render()}));
  f.append(fd,ck,el("p","note","De 3 a 20 caracteres: letras, números, ponto, hífen ou sublinhado. Evite usar o seu nome completo."),row,msg);
  f.addEventListener("submit",async ev=>{ ev.preventDefault(); const n=inp.value.trim();
    if(!NICK_RE.test(n)){ msg.textContent=MSG.nickname_invalido; return; }
    sb.disabled=true; msg.textContent="";
    try{ S.me=await rpc("set_player",{p_nickname:n,p_global:cb.checked}); try{localStorage.setItem(LKEY,S.me.nickname)}catch(e){} lastPush=""; S.editNick=false; render(); }
    catch(e){ msg.textContent=errMsg(e); sb.disabled=false; } });
  box.appendChild(f); setTimeout(()=>inp.focus(),30);
}
async function boardSection(box){
  const wrap=el("div"); wrap.style.cssText="display:flex;flex-direction:column;gap:10px"; box.appendChild(wrap);
  try{ S.groups=await rpc("my_groups")||[]; }catch(e){ S.groups=[]; }
  if(S.scope&&!S.groups.some(g=>g.id===S.scope)) S.scope="";
  const ctr=el("div","controls");
  const mk=(id,label,opts,val,on)=>{ const f=el("div","field"); const l=el("label",null,label); l.htmlFor=id; const s=el("select"); s.id=id; opts.forEach(([v,t])=>{const o=el("option",null,t); o.value=v; s.appendChild(o)}); s.value=val; s.addEventListener("change",()=>on(s.value)); f.append(l,s); return f; };
  ctr.append(mk("rk-scope","Quem",[["","Todos os jogadores"],...S.groups.map(g=>[g.id,"Grupo: "+g.name])],S.scope,v=>{S.scope=v; render()}),
    mk("rk-period","Período",[["hoje","Hoje"],["semana","Últimos 7 dias"],["mes","Últimos 30 dias"],["sempre","Desde o começo"]],S.period,v=>{S.period=v; render()}),
    mk("rk-order","Ordenar por",[["pontos","Pontos"],["tempo","Tempo jogando"]],S.order,v=>{S.order=v; render()}));
  wrap.appendChild(ctr);
  const list=el("ol","statlist"); list.style.listStyle="none";
  try{
    const rows=await rpc("ranking",{p_period:S.period,p_group:S.scope||null,p_order:S.order,p_limit:100})||[];
    if(!rows.length) wrap.appendChild(el("p","note","Ninguém pontuou neste período ainda. Jogue uma fase para aparecer aqui."));
    rows.forEach(r=>{ const li=el("li"); const top=el("div","st-top");
      const n=el("strong",null,r.pos+"º  "+r.nickname+(r.me?" (você)":"")); if(r.me) n.style.color="var(--ink)";
      const v=el("span","st-pct",S.order==="tempo"?dur(r.ms):String(r.points)); v.title=S.order==="tempo"?"Tempo jogando":"Pontos";
      top.append(n,v); li.append(top,el("div","st-sub",(S.order==="tempo"?r.points+" pontos":dur(r.ms)+" jogando")+" · "+r.dias+(r.dias===1?" dia":" dias")));
      if(r.me){ li.style.cssText="border-left:3px solid var(--ink);padding-left:10px"; } list.appendChild(li); });
    wrap.appendChild(list);
  }catch(e){ wrap.appendChild(el("p","note",errMsg(e))); }
}
async function groupsSection(box){
  const sec=el("div"); sec.style.cssText="display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--line);padding-top:12px"; box.appendChild(sec);
  sec.appendChild(el("h3",null,"Grupos"));
  sec.appendChild(el("p","note","Num grupo você compara o seu desempenho só com as pessoas que entraram com o código de convite. Qualquer pessoa com conta pode entrar, inclusive no plano Free (os limites do Free continuam valendo)."));
  const armed=(key,label,conf,fn)=>S.arm===key?[btn(conf,"btn small danger",async()=>{S.arm=null; await fn()}),btn("Cancelar","btn small",()=>{S.arm=null; render()})]:[btn(label,"btn small"+(/Excluir|Remover/.test(label)?" danger":""),()=>{S.arm=key; render()})];
  const act=async(fn,ok)=>{ try{ await fn(); if(ok) toast(ok); }catch(e){ toast(errMsg(e)); } S.me=null; render(); };
  S.groups.forEach(g=>{
    const card=el("div","dy-stw");
    const top=el("div"); top.style.cssText="display:flex;justify-content:space-between;align-items:baseline;gap:4px 10px;flex-wrap:wrap"; top.append(el("strong",null,g.name),el("span","st-sub",g.members+" de "+g.max_members+" pessoas")); card.appendChild(top);
    const code=el("p",null); code.style.margin="0"; code.append("Código de convite: ",el("strong",null,g.code)); card.appendChild(code);
    const row=el("div","st-acts");
    row.append(btn("Copiar convite","btn small primary",()=>copy("Entre no meu grupo “"+g.name+"” no Mahjuris: abra a aba Ranking e use o código "+g.code).then(k=>toast(k?"Convite copiado.":"Anote o código: "+g.code))),
      btn(S.open===g.id?"Esconder pessoas":"Ver pessoas","btn small",async()=>{ S.open=S.open===g.id?null:g.id; if(S.open){ try{ S.people[g.id]=await rpc("group_people",{p_group:g.id}); }catch(e){ S.people[g.id]=[]; } } render(); }),
      btn("Ranking do grupo","btn small",()=>{S.scope=g.id; render(); window.scrollTo(0,0)}));
    if(g.owner){ row.append(btn("Trocar o código","btn small",()=>act(()=>rpc("new_group_code",{p_group:g.id}),"Código novo criado. O antigo deixa de funcionar.")),
      ...armed("del:"+g.id,"Excluir grupo","Confirmar: excluir "+g.name,()=>act(()=>rpc("delete_group",{p_group:g.id}),"Grupo excluído."))); }
    else row.append(...armed("leave:"+g.id,"Sair do grupo","Confirmar: sair",()=>act(()=>rpc("leave_group",{p_group:g.id}),"Você saiu do grupo.")));
    card.appendChild(row);
    if(S.open===g.id){ const ul=el("ul","st-sublist"); (S.people[g.id]||[]).forEach(p=>{ const li=el("li"); li.append(el("span",null,(p.nickname||"(sem nickname)")+(p.owner?" · criou o grupo":"")+(p.me?" · você":"")));
        if(g.owner&&!p.me&&p.nickname) li.append(...armed("rm:"+g.id+":"+p.nickname,"Remover","Confirmar",()=>act(async()=>{ await rpc("remove_member",{p_group:g.id,p_nickname:p.nickname}); S.people[g.id]=await rpc("group_people",{p_group:g.id}); },p.nickname+" saiu do grupo.")));
        ul.appendChild(li); }); card.appendChild(ul); }
    sec.appendChild(card);
  });
  // entrar
  const jf=el("form","dy-row"); const jd=el("div","field"); const jl=el("label",null,"Entrar num grupo"); jl.htmlFor="rk-code"; const ji=el("input"); ji.type="text"; ji.id="rk-code"; ji.maxLength=8; ji.placeholder="Código"; ji.autocomplete="off"; ji.style.textTransform="uppercase";
  jd.append(jl,ji); const jb=el("button","btn","Entrar"); jb.type="submit"; jf.append(jd,jb);
  jf.addEventListener("submit",ev=>{ ev.preventDefault(); const c=ji.value.trim().toUpperCase(); if(!c) return; act(async()=>{ const r=await rpc("join_group",{p_code:c}); S.scope=r&&r.id||""; },"Você entrou no grupo."); });
  sec.appendChild(jf);
  // criar
  const max=+(S.me.grupos_max||0), mine=+(S.me.grupos_meus||0);
  if(max>0){
    const cf=el("form","dy-row"); const cd=el("div","field"); const cl2=el("label",null,"Criar um grupo ("+mine+" de "+max+" criados, até "+S.me.pessoas_max+" pessoas cada)"); cl2.htmlFor="rk-gname";
    const ci=el("input"); ci.type="text"; ci.id="rk-gname"; ci.maxLength=40; ci.placeholder="Nome do grupo"; cd.append(cl2,ci); const cb=el("button","btn primary","Criar grupo"); cb.type="submit"; cb.disabled=mine>=max; cf.append(cd,cb);
    cf.addEventListener("submit",ev=>{ ev.preventDefault(); const n=ci.value.trim(); if(n.length<2){ toast(MSG.nome_invalido); return; } act(()=>rpc("create_group",{p_name:n}),"Grupo criado. Copie o convite e mande para as pessoas."); });
    sec.appendChild(cf);
  } else {
    const info=el("div","dy-stw"); info.appendChild(el("strong",null,"Quer criar o seu próprio grupo?"));
    const ul=el("ul"); ul.style.cssText="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px;font-size:.9rem";
    [PLANS.plus,PLANS.turma].forEach(p=>ul.appendChild(el("li",null,p.nome+" ("+p.preco+"): tudo do Premium e mais até "+p.grupos+" grupos de até "+p.pessoas+" pessoas"+(p===PLANS.turma?". Feito para professores e cursinhos.":"."))));
    info.append(ul,el("p","note","A compra desses planos chega numa próxima atualização. Enquanto isso, entre num grupo com o código que alguém te passar."));
    sec.appendChild(info);
  }
}
window.MJSocial={render:b=>{ S.me=null; S.arm=null; return render(b); },changed,push:pushDays};
})();
