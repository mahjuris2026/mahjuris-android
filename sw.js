/* Mahjuris · funciona sem internet depois da primeira visita. Gerado por montar.py. */
const VERSAO="mahjuris-ad88b8a1bc", ARQUIVOS=["./", "baralhos.js", "config.js", "criar.html", "fonts.css", "fonts/05d29bfef7.woff2", "fonts/118b756c5f.woff2", "fonts/4efd1a5a63.woff2", "fonts/6441e9c6d5.woff2", "fonts/6cd670448c.woff2", "fonts/98f91742cc.woff2", "fonts/bb4fdf6199.woff2", "fonts/e92930189d.woff2", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "index.html", "lib/fzstd.js", "lib/jszip.min.js", "lib/sql-asm-memory-growth.js", "lib/supabase.js", "manifest.webmanifest", "plan.js", "premium.html", "privacidade.html", "sync.js"];
self.addEventListener("install",e=>{ e.waitUntil(caches.open(VERSAO).then(c=>c.addAll(ARQUIVOS)).then(()=>self.skipWaiting())); });
self.addEventListener("activate",e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith("mahjuris-")&&k!==VERSAO).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=="GET"||u.origin!==location.origin) return; // Supabase e outros: sempre pela rede
  const html=e.request.mode==="navigate"||u.pathname.endsWith(".html")||u.pathname.endsWith("/")||u.pathname.endsWith("config.js");
  if(html){ // página e configuração: rede primeiro, cópia guardada se estiver sem internet
    e.respondWith(fetch(e.request).then(r=>{ const c=r.clone(); caches.open(VERSAO).then(x=>x.put(e.request,c)); return r; })
      .catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match("./index.html"))));
    return;
  }
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request).then(x=>{ const c=x.clone(); caches.open(VERSAO).then(k=>k.put(e.request,c)); return x; })));
});
