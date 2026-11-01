/* =============================================================================
   Menu de contexto (clique direito; toque longo no mapa).
   Contextual: ponto do mapa/satélite, widget, cartão, hora, dia, local salvo;
   depois, as funções gerais do sistema. Shift + clique direito = menu nativo.
   ============================================================================= */
(() => {
"use strict";
const C = window.ClimaCore;
const {esc, r0} = C;
const box = document.createElement("div");
box.className = "ctx"; box.hidden = true; box.setAttribute("role","menu"); box.tabIndex = -1;
document.body.appendChild(box);
let acts = [];

const view = () => document.body.dataset.view;
const go = h => { location.hash = h; };
const satOn = () => document.documentElement.dataset.mode === "sat" || document.body.classList.contains("sat-bg") || document.body.classList.contains("mapview");

function open(x, y, list){
  acts = [];
  box.innerHTML = list.map(it=>{
    if(it === "-") return `<hr>`;
    if(it.h) return `<div class="ctx-h"><b>${it.h}</b>${it.sub!=null?`<small id="${it.id||""}">${it.sub}</small>`:""}${it.sub2!=null?`<small id="${it.id2||""}">${it.sub2}</small>`:""}</div>`;
    acts.push(it);
    return `<button role="menuitem" data-a="${acts.length-1}"${it.dis?" disabled":""}><span class="ci">${it.ic||""}</span><span class="ct">${it.t}</span>${it.on?`<span class="ck">✓</span>`:""}${it.k?`<kbd>${it.k}</kbd>`:""}</button>`;
  }).join("");
  box.hidden = false;
  const w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + "px";
  box.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + "px";
  box.focus({preventScroll:true});
}
function close(){ box.hidden = true; }
box.addEventListener("click", e=>{ const b = e.target.closest("[data-a]"); if(!b) return; close(); acts[+b.dataset.a].fn(); });
box.addEventListener("keydown", e=>{
  const bs = [...box.querySelectorAll("button:not([disabled])")], i = bs.indexOf(document.activeElement);
  if(e.key==="ArrowDown"){ e.preventDefault(); (bs[i+1]||bs[0]).focus(); }
  else if(e.key==="ArrowUp"){ e.preventDefault(); (bs[i-1]||bs[bs.length-1]).focus(); }
  else if(e.key==="Escape"){ close(); }
});
["pointerdown"].forEach(ev=>document.addEventListener(ev, e=>{ if(!box.hidden && !box.contains(e.target)) close(); }, true));
// fecha ao rolar/redimensionar/trocar de tela ou quando a JANELA perde o foco.
// (antes o "blur" em captura pegava o blur do próprio botão ⋯ quando o menu recebia o foco — e fechava na hora)
["resize","hashchange"].forEach(ev=>addEventListener(ev, close));
addEventListener("scroll", e=>{ if(!box.contains(e.target)) close(); }, true);
addEventListener("blur", e=>{ if(e.target === window) close(); });

/* ---------- itens do ponto no mapa ---------- */
function mapItems(ll){
  const S2 = window.Sat, m = S2?.map();
  const lat = ll.lat, lon = ((ll.lng+540)%360)-180, coords = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  S2?.elevAt(lon, lat).then(v=>{ const el = document.getElementById("ctxAlt"); if(el) el.textContent = `Altitude: ${S2.fmtAlt(v)} acima do nível do mar`; }).catch(()=>{});
  // endereço do ponto (OpenStreetMap / Nominatim — só no clique, respeitando o limite de uso)
  let addr = "";
  fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=pt&lat=${lat}&lon=${lon}`).then(r=>r.json()).then(j=>{
    const a = j.address || {}, rua = [a.road || a.pedestrian || a.footway || a.path, a.house_number].filter(Boolean).join(", ");
    addr = [rua, a.suburb || a.neighbourhood || a.village, a.city || a.town || a.municipality, a.state].filter(Boolean).join(" · ") || j.display_name || "";
    const el = document.getElementById("ctxAddr"); if(el) el.textContent = addr ? "🏠 " + addr : "Sem endereço neste ponto";
  }).catch(()=>{ const el = document.getElementById("ctxAddr"); if(el) el.textContent = ""; });
  const here = async () => { const n = await C.placeName(+lat.toFixed(4), +lon.toFixed(4)); return {...n, lat:+lat.toFixed(4), lon:+lon.toFixed(4)}; };
  const toSat = (fn) => { if(view()!=="sat"){ go("#sat"); setTimeout(fn, 350); } else fn(); };
  return [
    {h:`📍 ${coords}`, sub:"Altitude: calculando…", id:"ctxAlt", sub2:"🏠 buscando endereço…", id2:"ctxAddr"},
    {ic:"☀︎", t:"Previsão deste ponto", fn: async()=>{ C.load(await here()); go("#s-now"); }},
    {ic:"🌾", t:"Ceres (agro) neste ponto", fn: async()=>{ C.load(await here()); go("#agro"); }},
    {ic:"🛡", t:"Vigia (operações) neste ponto", fn: async()=>{ C.load(await here()); go("#ops"); }},
    {ic:"🧭", t:"Rota até aqui", fn: async()=>{ const l = await here(); toSat(()=>window.Rotas?.to({name:l.name || coords, lat, lon})); }},
    {ic:"🚩", t:"Rota partindo daqui", fn: async()=>{ const l = await here(); toSat(()=>window.Rotas?.from({name:l.name || coords, lat, lon})); }},
    {ic:"✈", t:"Planejar viagem para cá", fn: async()=>{ const l = await here(); window.Travel?.setDest(l); }},
    {ic:"★", t:"Salvar como local", fn: async()=>{ const l = await here(); C.load(l); setTimeout(()=>document.getElementById("fav")?.click(), 400); }},
    "-",
    {ic:"🔍", t:"Aproximar ao máximo aqui", fn:()=>toSat(()=>m.flyTo({center:[lon,lat], zoom:m.getMaxZoom(), duration:2000}))},
    {ic:"⛰", t:"Vista 3D do relevo aqui", fn:()=>toSat(()=>{ if(!S2.isClear()) S2.setProd("earth"); setTimeout(()=>m.flyTo({center:[lon,lat], zoom:13, pitch:68, bearing:-25, duration:2200}), 300); })},
    {ic:"📏", t:"Medir distância e perfil daqui", fn:()=>toSat(()=>S2.measureStart({lng:lon, lat}))},
    {ic:"▤", t: S2?.isAlt() ? "Ocultar camada de altitude" : "Mostrar camada de altitude", on:S2?.isAlt(), fn:()=>S2.setAlt(!S2.isAlt())},
    {ic:"🏙", t:"Prédios 3D", on:S2?.isBld(), fn:()=>S2.setBld(!S2.isBld())},
    {ic:"🏟", t:"Tour 3D: lugares com 3D detalhado", fn:()=>window.Places?.tour3d()},
    {ic:"🌋", t:"Vulcões", on:window.Geo?.isOn("volc"), fn:()=>window.Geo?.set("volc", !window.Geo.isOn("volc"))},
    {ic:"🏛", t:"Templos antigos", on:window.Geo?.isOn("temp"), fn:()=>window.Geo?.set("temp", !window.Geo.isOn("temp"))},
    {ic:"🎥", t:"Câmeras ao vivo", on:window.Cams?.isOn(), fn:()=>window.Cams?.setOn(!window.Cams.isOn())},
    {ic:"🛫", t:"Aeroportos e simulador de voo", on:window.Sim?.isOn(), fn:()=>window.Sim?.setOn(!window.Sim.isOn())},
    {ic:"📍", t:"Lugares: pontos turísticos, templos…", on:window.Places?.isOn(), fn:()=>window.Places?.setOn(!window.Places.isOn())},
    {ic:"⚙", t:"Escolher tipos de lugar", fn:()=>window.Places?.openFilter()},
    {ic:"🏷", t:"Escolher nomes: cidades, bairros, ruas…", fn:()=>window.Sat?.nameTypes()},
    {ic:"Aa", t:"Nomes e ruas", on:S2?.isNames(), fn:()=>S2.setNames(!S2.isNames())},
    "-",
    {ic:"⧉", t:"Copiar coordenadas", fn:()=>navigator.clipboard?.writeText(coords)},
    {ic:"⧉", t:"Copiar endereço", fn:()=>navigator.clipboard?.writeText(addr || coords)},
    {ic:"🗺", t:"Abrir endereço no Google Maps", fn:()=>window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`, "_blank", "noopener")},
    {ic:"🚶", t:"Street View aqui (Google)", fn:()=>window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`, "_blank", "noopener")},
    {ic:"🌍", t:"Navegar em 3D (Google Earth)", fn:()=>window.open(window.Nav3D(lat, lon)[0][1], "_blank", "noopener")},
    {ic:"🏙", t:"Navegar em 3D (F4map)", fn:()=>window.open(window.Nav3D(lat, lon)[1][1], "_blank", "noopener")},
    {ic:"↗", t:"Abrir no OpenStreetMap", fn:()=>window.open(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`, "_blank", "noopener")},
    {ic:"↗", t:"Abrir no Google Maps", fn:()=>window.open(`https://www.google.com/maps/@${lat},${lon},1500m/data=!3m1!1e3`, "_blank", "noopener")}
  ];
}

/* ---------- itens do sistema ---------- */
function sysItems(){
  const th = (()=>{ try{ return JSON.parse(localStorage.getItem("clima-theme")) || "sat"; }catch(e){ return "sat"; } })();
  const theme = t => document.querySelector(`#themeSeg [data-t="${t}"]`)?.click();
  const v = view();
  return [
    {h:`Clima · ${esc(C.S.loc?.name || "—")}`},
    {ic:"↻", t:"Atualizar dados", fn:()=>document.getElementById("reload")?.click()},
    {ic:"⌕", t:"Buscar cidade", k:"⌘K", fn:()=>document.getElementById("q")?.focus()},
    {ic:"➤", t:"Usar minha localização", fn:()=>document.getElementById("geo")?.click()},
    {ic:"★", t:"Salvar / remover local atual", fn:()=>document.getElementById("fav")?.click()},
    "-",
    {ic:"▦", t:"Minha tela", on:v==="home", fn:()=>go("#home")},
    {ic:"☀︎", t:"Painel do tempo", on:v==="painel", fn:()=>go("#s-now")},
    {ic:"🌾", t:"Ceres · agro", on:v==="agro", fn:()=>go("#agro")},
    {ic:"🛡", t:"Vigia · operações", on:v==="ops", fn:()=>go("#ops")},
    {ic:"⚗", t:"Laboratório", on:v==="lab", fn:()=>go("#lab")},
    {ic:"🌐", t:"Satélite e globo", on:v==="sat", fn:()=>go("#sat")},
    "-",
    {ic:"◐", t:"Aparência: Satélite", on:th==="sat", fn:()=>theme("sat")},
    {ic:"☾", t:"Aparência: Escuro", on:th==="dark", fn:()=>theme("dark")},
    {ic:"☼", t:"Aparência: Claro", on:th==="light", fn:()=>theme("light")},
    "-",
    ...(v==="home" ? [{ic:"✎", t:"Editar Minha tela", fn:()=>window.Home?.edit()}] : []),
    {ic:"🔗", t:"Copiar link desta tela", fn:()=>navigator.clipboard?.writeText(location.href)},
    ...(matchMedia("(display-mode: standalone)").matches ? [] : [{ic:"⬇", t:"Instalar o app no aparelho", fn:()=>{ if(!window.ClimaInstall?.()) window.ClimaToast?.("No iPhone: toque em Compartilhar → Adicionar à Tela de Início. No Android/Chrome: menu ⋮ → Instalar app."); }}])
  ];
}

/* ---------- itens do elemento clicado ---------- */
function ctxItems(t){
  const w = t.closest(".w[data-id]"), inst = t.closest(".inst[data-m]"), hr = t.closest(".hr[data-i]"), day = t.closest(".day[data-k]"), pl = t.closest(".pl[data-k]");
  if(w) return [{h:esc(w.querySelector("header span")?.textContent || "Widget")},
    {ic:"↗", t:"Abrir", fn:()=>w.click()}, {ic:"✎", t:"Editar Minha tela", fn:()=>window.Home?.edit()}, {ic:"✕", t:"Remover este widget", fn:()=>window.Home?.remove(w.dataset.id)}, "-"];
  if(inst) return [{ic:"ⓘ", t:"Ver detalhes e KPIs", fn:()=>inst.click()}, "-"];
  if(hr) return [{ic:"ⓘ", t:"Detalhes desta hora", fn:()=>hr.click()}, "-"];
  if(day) return [{ic:"ⓘ", t:"Detalhes deste dia", fn:()=>day.click()}, "-"];
  if(pl) return [{ic:"↗", t:"Abrir este local", fn:()=>pl.click()}, {ic:"✕", t:"Remover dos locais", fn:()=>pl.querySelector(".x")?.click()}, "-"];
  return [];
}

// o clique caiu no mapa? (na página de satélite, ou num vão do fundo com o satélite visível)
const PANELS = ".glass,.w,.toolbar,.sidebar,.card,.satpanel,.modal,.ctx,.measure,.xf,.orders,.verdict,.home-h,.sh,.foot,.tl,button,a";
function mapPoint(e){
  const m = window.Sat?.map(); if(!m || !satOn()) return null;
  if(view()!=="sat" && e.target.closest(PANELS)) return null;
  if(document.body.classList.contains("mapview") && !e.target.closest("#satbg")) return null;
  const r = m.getContainer().getBoundingClientRect();
  try{ return m.unproject([e.clientX - r.left, e.clientY - r.top]); }catch(err){ return null; }
}

// botão direito também inclina/gira o mapa: se ele foi arrastado ou segurado, é navegação — sem menu
let rdown = null;
document.addEventListener("mousedown", e=>{ if(e.button===2) rdown = {x:e.clientX, y:e.clientY, t:Date.now()}; }, true);
document.addEventListener("contextmenu", e=>{
  if(rdown && (Math.hypot(e.clientX-rdown.x, e.clientY-rdown.y) > 5 || Date.now()-rdown.t > 450)){ rdown = null; e.preventDefault(); return; }
  rdown = null;
  if(e.shiftKey || e.target.closest("input,textarea,select,[contenteditable]") || String(getSelection()).trim()) return;
  e.preventDefault();
  if(e.target.closest("#satbg")) return;   // no mapa o botão direito é só navegação; as funções ficam no ☰
  const ll = mapPoint(e), list = [...ctxItems(e.target), ...(ll ? [...mapItems(ll), "-"] : []), ...sysItems()];
  open(e.clientX, e.clientY, list);
});

// toque longo no mapa (iOS não dispara contextmenu)
let lp = null;
document.addEventListener("pointerdown", e=>{
  return;   // toque longo no mapa desativado (funções no ☰)
  if(e.pointerType !== "touch" || !e.target.closest("#satbg") || view()!=="sat") return;
  const x = e.clientX, y = e.clientY;
  lp = {x, y, t: setTimeout(()=>{ const ll = mapPoint({clientX:x, clientY:y, target:e.target}); if(ll) open(x, y, [...mapItems(ll), "-", ...sysItems()]); lp = null; }, 600)};
}, true);
["pointerup","pointercancel"].forEach(ev=>document.addEventListener(ev, ()=>{ if(lp){ clearTimeout(lp.t); lp = null; } }, true));
document.addEventListener("pointermove", e=>{ if(lp && Math.hypot(e.clientX-lp.x, e.clientY-lp.y) > 10){ clearTimeout(lp.t); lp = null; } }, true);

// ☰ do mapa: funções para um ponto (centro do mapa) + funções do sistema
function mapAt(ll, x, y){ open(Math.max(8, x), Math.max(8, y - 10), [...mapItems(ll), "-", ...sysItems()]); }
window.Menu = {open, close, mapAt};
})();

/* ---------- seções da barra lateral recolhíveis ---------- */
(() => {
  const KEY = "clima-nav-coll";
  let coll = new Set(); try{ coll = new Set(JSON.parse(localStorage.getItem(KEY)) || []); }catch(e){}
  const save = () => { try{ localStorage.setItem(KEY, JSON.stringify([...coll])); }catch(e){} };
  const apply = h => {
    const name = h.textContent.trim(), off = coll.has(name);
    h.classList.toggle("off", off); h.setAttribute("aria-expanded", !off);
    let n = h.nextElementSibling;
    while(n && n.tagName !== "H4"){ n.classList.toggle("sec-hidden", off); n = n.nextElementSibling; }
  };
  document.querySelectorAll(".nav h4").forEach(h=>{
    h.setAttribute("role","button"); h.tabIndex = 0; h.classList.add("sec-h");
    const tg = () => { const n = h.textContent.trim(); coll.has(n) ? coll.delete(n) : coll.add(n); save(); apply(h); };
    h.addEventListener("click", tg); h.addEventListener("keydown", e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); tg(); } });
    apply(h);
  });
  const ph = document.querySelector(".places .ph h4"), list = document.getElementById("placesList");
  if(ph && list){ ph.classList.add("sec-h"); ph.setAttribute("role","button"); ph.tabIndex = 0;
    const ap = () => { const off = coll.has("Locais"); ph.classList.toggle("off", off); list.classList.toggle("sec-hidden", off); };
    const tg = () => { coll.has("Locais") ? coll.delete("Locais") : coll.add("Locais"); save(); ap(); };
    ph.addEventListener("click", tg); ph.addEventListener("keydown", e=>{ if(e.key==="Enter"){ tg(); } }); ap(); }
})();


/* ---------- altura real do cabeçalho (no celular ele quebra em 2–3 linhas): --tbH posiciona o que fica abaixo dele ---------- */
(() => {
  const tb = document.querySelector(".toolbar"); if(!tb) return;
  const set = () => document.documentElement.style.setProperty("--tbH", `${Math.round(tb.getBoundingClientRect().bottom)}px`);
  set(); try{ new ResizeObserver(set).observe(tb); }catch(e){} addEventListener("resize", set); addEventListener("orientationchange", () => setTimeout(set, 300));
  // altura do dock do mapa (camadas + linha do tempo): os botões de zoom ficam sempre acima dele
  const dk = () => { const d = document.getElementById("mapdock"); if(!d){ setTimeout(dk, 1000); return; }
    const upd = () => document.documentElement.style.setProperty("--dockH", `${Math.round(d.getBoundingClientRect().height)}px`);
    upd(); try{ new ResizeObserver(upd).observe(d); }catch(e){} };
  dk();
})();

/* ---------- celular: botão flutuante de tema (alterna claro → automático → escuro → satélite) ---------- */
(() => {
  const tools = document.querySelector(".toolbar .tools"), seg = document.getElementById("themeSeg"); if(!tools || !seg) return;
  const b = document.createElement("button"); b.type = "button"; b.className = "ibtn fab-theme"; b.id = "themeFab"; b.setAttribute("aria-label", "Aparência");
  const ICO = {light:"sun", auto:"contrast", dark:"moon", sat:"satellite"}, NOME = {light:"Claro", auto:"Automático", dark:"Escuro", sat:"Satélite"};
  const cur = () => seg.querySelector('[aria-checked="true"],[aria-pressed="true"],.on')?.dataset.t || "auto";
  const paint = () => { const k = cur(); b.innerHTML = window.Ico?.(ICO[k], 20) || "◐"; b.title = `Aparência: ${NOME[k]}`; };
  b.onclick = () => { const ks = ["light","auto","dark","sat"], i = ks.indexOf(cur()); seg.querySelector(`[data-t="${ks[(i + 1) % 4]}"]`)?.click(); setTimeout(paint, 50); };
  tools.appendChild(b); setTimeout(paint, 300);
  new MutationObserver(paint).observe(seg, {attributes:true, subtree:true});
})();

/* ---------- barra lateral compacta (só ícones) — libera espaço para o mapa ---------- */
(() => {
  const side = document.querySelector(".sidebar"); if(!side) return;
  const KEY = "clima-rail";
  const pref = () => { try{ return JSON.parse(localStorage.getItem(KEY)); }catch(e){ return null; } };
  // padrão: compacta no Mapa e na Minha tela (mapa ao centro); expandida nas demais telas
  const apply = () => {
    const v = document.body.dataset.view, p = pref();
    // com o trilho novo (layout.js, computador) o painel nunca fica compacto: abre inteiro como gaveta/coluna
    const on = document.body.classList.contains("lv-r") ? false : p != null ? p : (v === "sat" || v === "home");
    document.body.classList.toggle("rail", on && matchMedia("(min-width: 861px)").matches);
    btn.setAttribute("aria-label", on ? "Expandir menu" : "Recolher menu"); btn.title = on ? "Expandir menu" : "Recolher menu";
    setTimeout(()=>window.Sat?.resize(), 260);
  };
  const btn = document.createElement("button");
  btn.className = "rail-tg"; btn.type = "button";
  btn.innerHTML = `<svg viewBox="0 0 20 20"><rect x="2.5" y="3.5" width="15" height="13" rx="3"/><path d="M7.5 3.5v13"/></svg>`;
  btn.onclick = () => { const on = !document.body.classList.contains("rail"); try{ localStorage.setItem(KEY, JSON.stringify(on)); }catch(e){} apply(); };
  side.prepend(btn);
  // nos ícones compactos, o nome aparece como dica
  side.querySelectorAll(".nav a").forEach(a=>{ if(!a.title) a.title = (a.querySelector("span")?.childNodes[0]?.textContent || a.textContent).trim(); });
  addEventListener("hashchange", ()=>setTimeout(apply, 0));
  matchMedia("(min-width: 861px)").addEventListener("change", apply);
  apply();
  // menu inteiro recolhível pelo botão do topo: some a barra lateral e o mapa/conteúdo ocupam a largura toda
  // preferência separada: no Mapa/Minha tela o menu é uma gaveta (fecha sozinha, não grava nada); nas telas de
  // conteúdo é a coluna de seções (mostrar/ocultar fica gravado só para elas)
  const KEY2 = "clima-side2", tg = document.getElementById("sideTg");
  try{ if(!localStorage.getItem("clima-side-mig")){ localStorage.removeItem("clima-side"); localStorage.setItem("clima-side-mig", "1"); } }catch(e){}
  const pref2 = () => { try{ return JSON.parse(localStorage.getItem(KEY2)); }catch(e){ return null; } };
  const mapa = () => { const v = document.body.dataset.view; return v === "sat" || v === "home"; };
  let gaveta = false;   // gaveta aberta no mapa (só nesta visita)
  const apply2 = () => {
    const v = document.body.dataset.view, p = pref2(), off = (mapa() ? !gaveta : p != null ? p : false) && matchMedia("(min-width: 861px)").matches;
    document.body.classList.toggle("side-off", off);
    if(tg){ tg.setAttribute("aria-expanded", !off); tg.title = off ? "Mostrar menu" : "Recolher menu"; tg.classList.toggle("on", !off); }
    setTimeout(()=>window.Sat?.resize(), 260);
  };
  if(tg) tg.onclick = () => { const off = !document.body.classList.contains("side-off");
    if(mapa()) gaveta = !off; else { try{ localStorage.setItem(KEY2, JSON.stringify(off)); }catch(e){} }
    apply2(); };
  // ao trocar de tela a gaveta do mapa fecha (sem mexer na preferência das telas de conteúdo)
  addEventListener("hashchange", () => { gaveta = false; });
  window.ClimaMenu = {fecharGaveta: () => { gaveta = false; apply2(); }};
  const rb = document.getElementById("routesBtn"); if(rb) rb.onclick = () => window.Rotas?.isOpen() ? window.Rotas.close() : window.Rotas?.open();
  addEventListener("hashchange", ()=>setTimeout(apply2, 0));
  matchMedia("(min-width: 861px)").addEventListener("change", apply2);
  apply2();
})();
