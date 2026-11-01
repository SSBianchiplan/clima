/* =============================================================================
   MINHA TELA — widgets sobre o satélite, organizados pelo usuário.
   Adicionar, remover, redimensionar (P/M/G) e arrastar para reordenar
   (mouse ou toque). O layout fica salvo neste aparelho.
   ============================================================================= */
(() => {
"use strict";
const C = window.ClimaCore;
const {$, esc, icon, wmo, r0, r1, fmtH, DOW, parseLocal, sum, max, min, dirName} = C;
const store = {
  get(k,d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const DEFAULT = [
  {id:"wind3d",size:"l"},{id:"timeline",size:"m"},{id:"now",size:"m"},{id:"ceres",size:"m"},{id:"vigia",size:"m"},{id:"starlink",size:"s"},{id:"wind",size:"s"},
  {id:"hours",size:"m"},{id:"alerts",size:"m"},{id:"days",size:"m"},{id:"rain7",size:"m"},{id:"uv",size:"s"},{id:"air",size:"s"}
];
let layout = store.get("clima-home", null) || DEFAULT;
if(!store.get("clima-home-kbr", false)){ if(!layout.some(w=>w.id==="kitebr")) layout.splice(4, 0, {id:"kitebr", size:"m"}); store.set("clima-home-kbr", true); }
if(!store.get("clima-home-sbr", false)){ if(!layout.some(w=>w.id==="surfbr")) layout.splice(3, 0, {id:"surfbr", size:"m"}); store.set("clima-home-sbr", true); }
if(!store.get("clima-home-sp", false)){ ["marsp","ventosp"].forEach((id,j)=>{ if(!layout.some(w=>w.id===id)) layout.splice(3+j, 0, {id, size:"m"}); }); store.set("clima-home-sp", true); }
if(!store.get("clima-home-al", false)){ if(!layout.some(w=>w.id==="alarms")) layout.splice(2, 0, {id:"alarms", size:"m"}); store.set("clima-home-al", true); }
if(!store.get("clima-home-tl", false)){ if(!layout.some(w=>w.id==="timeline")) layout.splice(1, 0, {id:"timeline", size:"m"}); store.set("clima-home-tl", true); }
if(!store.get("clima-home-w3d", false)){ if(!layout.some(w=>w.id==="wind3d")) layout.unshift({id:"wind3d",size:"l"}); store.set("clima-home-w3d", true); }
let editing = false;
const save = () => store.set("clima-home", layout);
const S = () => C.S;
const ready = () => !!(S().fc);

/* ---------- modo da tela: Widgets | Mapa | Editar (mesmo controle na Minha tela e no satélite) ---------- */
const ICO = {
  widgets:`<svg viewBox="0 0 20 20"><rect x="3" y="3" width="6" height="6" rx="1.6"/><rect x="11" y="3" width="6" height="6" rx="1.6"/><rect x="3" y="11" width="6" height="6" rx="1.6"/><rect x="11" y="11" width="6" height="6" rx="1.6"/></svg>`,
  map:`<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c2.2 2.3 2.2 12.7 0 15M10 2.5c-2.2 2.3-2.2 12.7 0 15"/></svg>`,
  edit:`<svg viewBox="0 0 20 20"><path d="M13.5 3.5l3 3L7 16H4v-3z"/><path d="M11.5 5.5l3 3"/></svg>`};
function modeSeg(active){
  const b = (k, t) => `<button type="button" data-vm="${k}" aria-pressed="${active===k}">${ICO[k]}<span>${t}</span></button>`;
  return `<div class="vseg" role="group" aria-label="Modo da tela">${b("widgets","Widgets")}${b("map","Mapa")}${b("edit", active==="edit" ? "Concluir" : "Editar")}</div>`;
}
window.modeSeg = modeSeg;
document.addEventListener("click", e=>{
  const b = e.target.closest("[data-vm]"); if(!b) return;
  e.preventDefault();
  const m = b.dataset.vm, v = document.body.dataset.view;
  if(m==="map"){ editing = false; location.hash = "#sat"; }
  else if(m==="widgets"){ if(v==="home"){ if(editing){ editing = false; render(); } } else { editing = false; location.hash = "#home"; } }
  else if(m==="edit"){ if(v==="home"){ editing = !editing; render(); } else { editing = true; location.hash = "#home"; } }
});

/* ---------- catálogo ---------- */
const W = {
  now:{nome:"Agora", desc:"Temperatura, condição e extremos do dia", sizes:["s","m","l"], go:"#s-now", render(sz){
    const c = S().fc.current, d = S().fc.daily, ti = d.time.indexOf(c.time.slice(0,10)), [nm,k] = wmo(c.weather_code);
    return `<div class="w-now"><div><div class="w-place">${esc(S().loc.name)}</div><div class="w-big">${r0(c.temperature_2m)}°</div></div>${icon(k, sz==="s"?36:52, !c.is_day)}</div>
      <div class="w-line">${esc(nm)}</div><div class="w-sub">máx ${r0(d.temperature_2m_max[ti])}° · mín ${r0(d.temperature_2m_min[ti])}° · sensação ${r0(c.apparent_temperature)}°</div>
      ${sz==="l" ? `<div class="w-read">${$("reading").innerHTML}</div>` : ""}`; }},
  hours:{nome:"Próximas horas", desc:"Faixa horária com chuva", sizes:["m","l"], go:"#s-now", render(sz){
    const h = S().fc.hourly, i = C.nowIndex(), n = sz==="l" ? 12 : 6, step = sz==="l" ? 2 : 2;
    let o = ""; for(let k=i;k<i+n*step;k+=step){ const pr = h.precipitation_probability[k];
      o += `<div class="w-hr"><small>${k===i?"Agora":fmtH(h.time[k]).slice(0,2)+"h"}</small>${icon(wmo(h.weather_code[k])[1],24,!h.is_day[k])}<b>${r0(h.temperature_2m[k])}°</b><em>${pr>=20?r0(pr)+"%":""}</em></div>`; }
    return `<div class="w-hours${sz==="l"?" two-rows":""}">${o}</div>`; }},
  days:{nome:"Próximos dias", desc:"Mínima, máxima e chuva", sizes:["m","l"], go:"#s-days", render(sz){
    const d = S().fc.daily, st = d.time.indexOf(S().fc.current.time.slice(0,10)), n = sz==="l" ? 7 : 4;
    const lo = min(d.temperature_2m_min.slice(st,st+n)), hi = max(d.temperature_2m_max.slice(st,st+n)), sp = Math.max(1,hi-lo);
    return d.time.slice(st,st+n).map((t,j)=>{ const k = st+j, dt = parseLocal(t);
      return `<div class="w-day"><span>${j?DOW[dt.getDay()]:"Hoje"}</span>${icon(wmo(d.weather_code[k])[1],20)}<small>${r0(d.temperature_2m_min[k])}°</small><i><b style="left:${(d.temperature_2m_min[k]-lo)/sp*100}%;right:${100-(d.temperature_2m_max[k]-lo)/sp*100}%"></b></i><small>${r0(d.temperature_2m_max[k])}°</small><em>${d.precipitation_sum[k]>=1?r0(d.precipitation_sum[k])+" mm":""}</em></div>`; }).join(""); }},
  alerts:{nome:"Avisos", desc:"Condições adversas em 48 h", sizes:["m","l"], go:"#s-alerts", render(sz){
    const a = [...document.querySelectorAll("#alerts .alert")].slice(0, sz==="l"?5:2);
    return a.map(el=>`<div class="w-al ${[...el.classList].find(c=>/^l\d/.test(c))}"><i></i><div><b>${esc(el.querySelector("b").textContent)}</b><small>${esc(el.querySelector("span").textContent)}</small></div></div>`).join("") || `<div class="w-sub">Sem avisos.</div>`; }},
  ceres:{nome:"Ceres · agro", desc:"Veredito do agrometeorologista", sizes:["s","m","l"], go:"#agro", render(sz){ return expert("agro", sz); }},
  vigia:{nome:"Vigia · operações", desc:"Veredito de segurança operacional", sizes:["s","m","l"], go:"#ops", render(sz){ return expert("ops", sz); }},
  starlink:{nome:"Starlink sobre você", desc:"Satélites acima de 25° agora", sizes:["s","m"], go:"#sat", render(sz){
    const S2 = window.Sat; if(!S2 || !S2.enabled()) return `<div class="w-sub">Constelação desligada.</div><button class="mbtn w-btn" data-star-on>Ativar Starlink</button>`;
    const o = S2.overhead(), n = S2.count();
    return `<div class="w-big">${n ? o.n : "…"}</div><div class="w-sub">${n ? `de ${n.toLocaleString("pt-BR")} em órbita` : "carregando órbitas"}</div>
      ${sz==="m" && o.list[0] ? `<div class="w-line">Mais alto: ${esc(o.list[0].name)} · ${r0(o.list[0].el)}°</div>` : ""}`; }},
  satellite:{nome:"Satélite", desc:"Imagem GOES-19 mais recente", sizes:["s","m"], go:"#sat", render(){
    const t = window.Sat?.time(), d = t && t!=="default" ? new Date(t) : null;
    return `<div class="w-sat"><svg viewBox="0 0 24 24"><path d="M5 14l5 5M8 11l5 5M3 21l4-4M14 3l7 7-4 4-7-7z"/><path d="M15 15a4 4 0 0 0 4 4"/></svg></div><div class="w-line">${d ? `Imagem de ${d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}` : "GOES-19"}</div><div class="w-sub">Toque para abrir em tela cheia</div>`; }},
  wind3d:{nome:"Rosa dos ventos 3D", desc:"Vento ao vivo no local, rosa de 7 dias em 3D — arraste para girar", sizes:["m","l"], go:null, clear:true, render(){
    return `<div class="w3d"><canvas aria-label="Rosa dos ventos 3D animada"></canvas><div class="w3d-info" data-w3d-info></div></div>`; }},
  timeline:{nome:"Linha do tempo", desc:"6 h de histórico e 24 h de previsão — abre a linha do tempo do satélite", sizes:["m","l"], go:"#sat", render(sz){
    const h = S().fc.hourly, i0 = C.nowIndex(), a = Math.max(0, i0-6), b = Math.min(h.time.length, i0+25), Wd = 300, Hd = sz==="l" ? 150 : 72;
    const T = h.temperature_2m.slice(a,b), P = h.precipitation.slice(a,b), n = T.length, lo = min(T), hi = max(T);
    const X = k => k/(n-1)*Wd, Y = v => 8 + (1-(v-lo)/Math.max(1,hi-lo))*(Hd-26);
    const line = T.map((v,k)=>`${X(k).toFixed(1)},${Y(v).toFixed(1)}`).join(" "), nx = X(i0-a);
    const bars = P.map((p,k)=>p>0.05?`<rect x="${(X(k)-2).toFixed(1)}" y="${(Hd-12-Math.min(Hd-30,p*8)).toFixed(1)}" width="4" height="${Math.min(Hd-30,p*8).toFixed(1)}" rx="1"/>`:"").join("");
    const lbl = h.time.slice(a,b).map((t,k)=>+t.slice(11,13)%6===0?`<text x="${X(k).toFixed(1)}" y="${Hd-1}" text-anchor="middle">${+t.slice(11,13)}h</text>`:"").join("");
    return `<svg class="w-tl" viewBox="0 0 ${Wd} ${Hd}" preserveAspectRatio="none"><rect x="0" y="0" width="${nx}" height="${Hd-10}" class="p"/>${bars}<polyline points="${line}"/>
      <line x1="${nx}" x2="${nx}" y1="0" y2="${Hd-10}" class="n"/>${lbl}</svg><div class="w-sub">mín ${r0(lo)}° · máx ${r0(hi)}° · chuva ${r1(sum(P.slice(i0-a)))} mm nas próximas 24 h</div>`; }},
  alarms:{nome:"Alarmes 7 dias", desc:"Alarmes preditivos da semana com nível e confiança", sizes:["m","l"], go:"#pred", render(sz){
    const R = window.Pred?.result(); if(!R) return `<div class="w-sub">Rodando a análise preditiva…</div>`;
    const P = window.Pred, list = R.A.slice(0, sz==="l" ? 6 : 2);
    if(!list.length) return `<div class="w-line">Semana sem alarmes relevantes.</div><div class="w-sub">Nenhuma condição adversa nos próximos 7 dias.</div>`;
    const fw = a => { const d = parseLocal(a.start); return `${DOW[d.getDay()]} ${fmtH(a.start)}`; };
    return list.map(a=>`<div class="w-al" style="--c:${P.LCOL[a.lvl]}"><i style="background:${P.LCOL[a.lvl]}"></i><div><b>${P.LVL[a.lvl]} · ${esc(a.title)}</b><small>${fw(a)}${a.conf!=null?` · ${r0(a.conf)}% dos cenários`:""}</small></div></div>`).join(""); }},
  marsp:{nome:"Esportes no mar", desc:"Surf, SUP, mergulho, pesca… nota agora e melhor janela", sizes:["m","l"], go:"#mar", render(sz){ return sportsW("mar", sz); }},
  ventosp:{nome:"Esportes de vento", desc:"Kite, windsurf, vela, parapente, drone… nota agora e melhor janela", sizes:["m","l"], go:"#vento", render(sz){ return sportsW("vento", sz); }},
  kitebr:{nome:"Kite no Brasil hoje", desc:"Ranking ao vivo dos melhores picos de kite e windsurf", sizes:["m","l"], go:"#vento", render(sz){
    const Sp = window.Sports, R = Sp?.wrank(); if(!R){ Sp?.loadWRank(); return `<div class="w-sub">Calculando o ranking…</div>`; }
    return R.slice(0, sz==="l" ? 8 : 3).map((r,i)=>{ const b = r.best || r.now, [lb, s] = Sp.wLabel(b.q);
      return `<div class="w-spt"><span>${i+1}</span><b>${esc(r.name)} <small style="display:inline;color:var(--ink-3)">${r0(b.w)} kt</small></b><i style="background:${Sp.SCOL[s]}">${r1(b.q)} · ${lb}</i></div>`; }).join(""); }},
  surfbr:{nome:"Surf no Brasil hoje", desc:"Ranking ao vivo dos melhores picos do Brasil", sizes:["m","l"], go:"#mar", render(sz){
    const Sp = window.Sports, R = Sp?.rank(); if(!R){ Sp?.loadRank(); return `<div class="w-sub">Calculando o ranking…</div>`; }
    return R.slice(0, sz==="l" ? 8 : 3).map((r,i)=>{ const b = r.best || r.now, [lb, s] = Sp.qLabel(b.q);
      return `<div class="w-spt"><span>${i+1}</span><b>${esc(r.name)} <small style="display:inline;color:var(--ink-3)">${esc(r.where.split(" · ").pop())}</small></b><i style="background:${Sp.SCOL[s]}">${r1(b.q)} · ${lb}</i></div>`; }).join(""); }},
  wind:{nome:"Vento", desc:"Velocidade, rajada e direção", sizes:["s","m"], go:"#s-now", render(sz){
    const c = S().fc.current, d = c.wind_direction_10m;
    return `<div class="w-wind"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="27"/><g transform="rotate(${d+180} 30 30)"><path d="M30 8 35 24 30 21 25 24Z"/><line x1="30" y1="21" x2="30" y2="50"/></g></svg><div><div class="w-big sm">${r0(c.wind_speed_10m)}<em>km/h</em></div><div class="w-sub">de ${dirName(d)} · rajada ${r0(c.wind_gusts_10m)}</div></div></div>
      ${sz==="m" ? `<div class="w-line">${esc(C.beaufort(c.wind_speed_10m))}</div>` : ""}`; }},
  uv:{nome:"Índice UV", desc:"Agora e pico do dia", sizes:["s"], go:"#s-now", render(){
    const h = S().fc.hourly, d = S().fc.daily, i = C.nowIndex(), ti = d.time.indexOf(S().fc.current.time.slice(0,10)), u = h.uv_index[i];
    return `<div class="w-big">${r1(u)}</div><div class="uvbar"><i style="left:${Math.min(100,(u||0)/11*100)}%"></i></div><div class="w-sub">máx. ${r1(d.uv_index_max[ti])} · ${C.uvCat(d.uv_index_max[ti])}</div>`; }},
  air:{nome:"Qualidade do ar", desc:"US AQI e PM2,5", sizes:["s","m"], go:"#s-env", render(){
    const a = S().air?.current; if(!a) return `<div class="w-sub">Carregando…</div>`;
    const [cat,col] = C.aqiCat(a.us_aqi);
    return `<div class="w-big" style="color:${col}">${r0(a.us_aqi)}</div><div class="w-line">${cat}</div><div class="w-sub">PM2,5 ${r1(a.pm2_5)} µg/m³</div>`; }},
  sea:{nome:"Mar", desc:"Ondas no ponto de mar mais próximo", sizes:["s","m"], go:"#s-env", render(){
    const m = S().mar?.current; if(!m || m.wave_height==null) return `<div class="w-sub">Sem dados de mar para este local.</div>`;
    return `<div class="w-big">${r1(m.wave_height)}<em>m</em></div><div class="w-sub">período ${r1(m.wave_period)} s · de ${dirName(m.wave_direction)}</div><div class="w-sub">água ${m.sea_surface_temperature==null?"—":r1(m.sea_surface_temperature)+"°"}</div>`; }},
  rain7:{nome:"Chuva em 7 dias", desc:"Total e distribuição diária", sizes:["m","l"], go:"#s-days", render(){
    const d = S().fc.daily, st = d.time.indexOf(S().fc.current.time.slice(0,10)), R = d.precipitation_sum.slice(st,st+7), P = d.precipitation_probability_max.slice(st,st+7), mx = Math.max(5, ...R);
    return `<div class="w-big sm">${r0(sum(R))}<em>mm</em></div><div class="w-bars">${R.map((v,j)=>`<div><i style="height:${Math.max(3,v/mx*100)}%;opacity:${.35+P[j]/100*.65}"></i><small>${j?DOW[parseLocal(d.time[st+j]).getDay()][0].toUpperCase():"H"}</small></div>`).join("")}</div>`; }},
  places:{nome:"Meus locais", desc:"Cidades salvas com temperatura", sizes:["m","l"], go:null, render(sz){
    const pl = C.places, t = C.placeTemps;
    return pl.slice(0, sz==="l"?6:3).map((p,k)=>{ const c = t[`${p.lat},${p.lon}`]; return `<button class="w-pl" data-pl="${k}"><span>${esc(p.name)}</span>${c?icon(wmo(c.weather_code)[1],20,!c.is_day):""}<b>${c?r0(c.temperature_2m)+"°":""}</b></button>`; }).join("") || `<div class="w-sub">Salve cidades com a estrela na barra lateral.</div>`; }}
};
function sportsW(mod, sz){
  const Sp = window.Sports, L = Sp?.summary(mod); if(!L) return `<div class="w-sub">Analisando…</div>`;
  if(L.none) return `<div class="w-sub">Sem dados de mar para este local.</div>`;
  const list = [...L].sort((a,b)=>b.s-a.s).slice(0, sz==="l" ? 8 : 3);
  return list.map(x=>`<div class="w-spt"><span>${x.ic}</span><b>${esc(x.nome)}</b><i style="background:${Sp.SCOL[x.s]}">${Sp.SC[x.s]}</i>${sz==="l"&&x.best?`<small>${x.best}</small>`:""}</div>`).join("");
}
function expert(k, sz){
  const s = window.Experts?.summary(k); if(!s) return `<div class="w-sub">Lendo a atmosfera…</div>`;
  return `<div class="w-x"><div class="w-ring" style="--p:${s.risk};--c:${s.riskCol}"><b>${s.risk}</b></div><div class="w-verdict${sz==="s"?" sm":""}">${esc(s.verdict)}</div></div>
    ${sz!=="s" ? `<div class="w-sub">${s.alerts ? `${s.alerts} ${s.alerts>1?"restrições":"restrição"} em 48 h` : "sem restrição relevante"} · confiança ${s.conf??"—"}%</div>` : ""}`;
}

/* ---------- renderização ---------- */
function render(){
  const root = $("home-body"); if(!root) return;
  if(!ready()){ root.innerHTML = `<div class="xload">Carregando a sua tela…</div>`; return; }
  layout = layout.filter(w=>W[w.id]);
  const c = S().fc.current, hr = +c.time.slice(11,13), hi = hr<5 ? "Boa noite" : hr<12 ? "Bom dia" : hr<18 ? "Boa tarde" : "Boa noite";
  root.innerHTML = `
    <div class="home-h">
      <div><h2>${hi}</h2><p>${esc(S().loc.name)} · ${new Date().toLocaleDateString("pt-BR",{weekday:"long", day:"numeric", month:"long"})}</p></div>
      <div class="home-act">
        ${editing ? `<button class="mbtn glassbtn" id="hAdd">＋ Widget</button><button class="mbtn glassbtn" id="hReset">Restaurar</button>` : ""}
        ${modeSeg(editing ? "edit" : "widgets")}
      </div>
    </div>
    <div class="home-grid${editing?" editing":""}" id="hGrid">${layout.map((w,k)=>tile(w,k)).join("")}</div>
    ${editing ? `<p class="home-hint">Arraste para reordenar · P/M/G muda o tamanho · × remove.</p>` : ""}`;
  mount3d();
  if(editing){ $("hAdd").onclick = addDialog; $("hReset").onclick = ()=>{ layout = DEFAULT.map(x=>({...x})); save(); render(); }; }
  wire();
}
function tile(w, k){
  const def = W[w.id]; let body;
  try{ body = def.render(w.size); }catch(e){ body = `<div class="w-sub">Aguardando dados…</div>`; }
  return `<article class="w ${def.clear?"w-clear":"glass"} w-${w.size}${w.c?" w-c":""}" data-w="${k}" data-id="${w.id}" ${!editing && def.go ? `role="link" tabindex="0"` : ""}>
    <header><span>${esc(def.nome)}</span><div class="w-tools">
      ${editing ? `<button data-del="${k}" class="w-del" title="Remover" aria-label="Remover ${esc(def.nome)}">×</button>` : ""}
      <button data-wm="${k}" class="w-more" title="Opções do widget" aria-label="Opções de ${esc(def.nome)}" aria-haspopup="menu">⋯</button></div></header>
    <div class="w-body">${body}</div></article>`;
}
function refresh(id){
  if(id==="sports"){ refresh("marsp"); refresh("ventosp"); return; }
  if(document.body.dataset.view !== "home") return;
  if(editing && drag) return;
  if(!id) return render();
  document.querySelectorAll(`.w[data-id="${id}"]`).forEach(el=>{ const k = +el.dataset.w; try{ el.querySelector(".w-body").innerHTML = W[id].render(layout[k].size); }catch(e){} });
}

// monta a rosa 3D em cada widget presente (o motor se desliga sozinho quando o canvas sai da tela)
function mount3d(){
  if(!window.Wind3D || !ready()) return;
  document.querySelectorAll(".w3d canvas").forEach(cv=>{
    if(cv._w3d) return;
    const info = cv.parentElement.querySelector("[data-w3d-info]");
    cv._w3d = Wind3D.mount(cv, {hourly:S().fc.hourly, i0:C.nowIndex(), css:C.css, onInfo:w0=>{
      // valores "agora" da previsão corrente (dados de 15 min do Open-Meteo); a rosa de 7 dias continua da série horária
      const c = S().fc.current || {}, w = c.wind_speed_10m != null ? {speed:c.wind_speed_10m, dir:c.wind_direction_10m ?? w0.dir, gust:c.wind_gusts_10m ?? w0.gust} : w0;
      const at = S().fetchedAt ? new Date(S().fetchedAt).toLocaleTimeString("pt-BR", {hour:"2-digit", minute:"2-digit"}) : "";
      info.innerHTML = `<b>${r0(w.speed)}<em>km/h</em></b><span class="w3d-dir">${Wind3D.NOMINAL[dirName(w.dir)] || dirName(w.dir)}</span><span>vento de ${dirName(w.dir)} · ${r0(w.dir)}°</span><span>rajada ${r0(w.gust)} km/h</span><small>${esc(C.beaufort(w.speed))}</small>${at ? `<small class="w3d-at">● ao vivo · atualizado ${at}</small>` : ""}`; }});
  });
}

/* ---------- interação ---------- */
let drag = null;
function wire(){
  const g = $("hGrid");
  g.onclick = e => {
    const sz = e.target.closest("[data-size]"), del = e.target.closest("[data-del]"), pl = e.target.closest("[data-pl]");
    const wm = e.target.closest("[data-wm]");
    if(wm){ e.stopPropagation(); widgetMenu(+wm.dataset.wm, wm); return; }
    const cl = e.target.closest("[data-coll]");
    if(cl){ e.stopPropagation(); const w = layout[+cl.dataset.coll]; w.c = !w.c; save(); render(); return; }
    if(e.target.closest("[data-star-on]")){ e.stopPropagation(); window.Sat?.setStar(true); setTimeout(()=>refresh("starlink"), 300); return; }
    if(sz){ e.stopPropagation(); const w = layout[+sz.dataset.size], s = W[w.id].sizes; w.size = s[(s.indexOf(w.size)+1)%s.length]; save(); render(); return; }
    if(del){ layout.splice(+del.dataset.del,1); save(); render(); return; }
    if(pl && !editing){ e.stopPropagation(); C.load(C.places[+pl.dataset.pl]); return; }
    const t = e.target.closest(".w"); if(t && !editing){ const go = W[t.dataset.id].go; if(go) location.hash = go; }
  };
  g.onkeydown = e => { if(e.key==="Enter"){ const t = e.target.closest(".w"); const go = t && W[t.dataset.id].go; if(go && !editing) location.hash = go; } };
  if(!editing) return;
  // arrastar: o cartão segue o dedo/cursor e a grade se reorganiza ao passar sobre outro
  g.onpointerdown = e => {
    const t = e.target.closest(".w"); if(!t || e.target.closest("button")) return;
    e.preventDefault();
    const r = t.getBoundingClientRect();
    drag = {el:t, dx:e.clientX-r.left, dy:e.clientY-r.top, id:e.pointerId, w:r.width, h:r.height};
    t.setPointerCapture(e.pointerId); t.classList.add("dragging");
    t.style.width = r.width+"px"; t.style.height = r.height+"px";
    const ph = document.createElement("div"); ph.className = `w-ph w-${layout[+t.dataset.w].size}`; t.after(ph); drag.ph = ph;
    move(e);
  };
  g.onpointermove = e => { if(drag && e.pointerId===drag.id) move(e); };
  g.onpointerup = g.onpointercancel = e => {
    if(!drag) return;
    const {el, ph} = drag; drag = null;
    ph.replaceWith(el); el.classList.remove("dragging"); el.style.cssText = "";
    const order = [...$("hGrid").querySelectorAll(".w")].map(x=>+x.dataset.w);
    layout = order.map(k=>layout[k]); save(); render();
  };
}
function move(e){
  const {el, ph} = drag;
  el.style.left = (e.clientX-drag.dx)+"px"; el.style.top = (e.clientY-drag.dy)+"px";
  el.style.visibility = "hidden"; const under = document.elementFromPoint(e.clientX, e.clientY); el.style.visibility = "";
  const t = under && under.closest(".w:not(.dragging)");
  if(t && t.parentElement===ph.parentElement){
    const r = t.getBoundingClientRect(), after = e.clientX > r.left + r.width/2;
    after ? t.after(ph) : t.before(ph);
  }
}
// menu ⋯ do widget: abrir, tamanho, recolher, mover, remover
function widgetMenu(k, btn){
  const w = layout[k], def = W[w.id]; if(!def || !window.Menu) return;
  const r = btn.getBoundingClientRect(), lbl = s => ({s:"Pequeno",m:"Médio",l:"Grande"})[s];
  const move = d => { const j = k + d; if(j<0 || j>=layout.length) return; [layout[k], layout[j]] = [layout[j], layout[k]]; save(); render(); };
  window.Menu.open(r.right - 250, r.bottom + 6, [
    {h: esc(def.nome), sub: esc(def.desc)},
    ...(def.go ? [{ic:"↗", t:"Abrir módulo", fn:()=>{ location.hash = def.go; }}] : []),
    ...(def.sizes.length>1 ? ["-", ...def.sizes.map(s=>({ic:s==="s"?"▪":s==="m"?"▬":"■", t:`Tamanho ${lbl(s)}`, on:w.size===s, fn:()=>{ w.size = s; save(); render(); }}))] : []),
    "-",
    {ic: w.c ? "▾" : "▴", t: w.c ? "Expandir" : "Recolher", fn:()=>{ w.c = !w.c; save(); render(); }},
    {ic:"↑", t:"Mover para cima", dis:k===0, fn:()=>move(-1)},
    {ic:"↓", t:"Mover para baixo", dis:k===layout.length-1, fn:()=>move(1)},
    {ic:"✎", t:"Editar a tela", fn:()=>{ editing = true; render(); }},
    "-",
    {ic:"✕", t:"Remover widget", fn:()=>{ layout.splice(k,1); save(); render(); }}
  ]);
}
function addDialog(){
  const on = new Set(layout.map(w=>w.id));
  const opts = Object.entries(W).filter(([k])=>!on.has(k));
  C.openModal({title:"Adicionar widget", sub: opts.length ? "Toque para colocar na sua tela." : "Todos os widgets já estão na tela.",
    html:`<div class="w-gal">${opts.map(([k,w])=>`<button data-add="${k}"><b>${esc(w.nome)}</b><small>${esc(w.desc)}</small><em>${w.sizes.map(s=>s.toUpperCase().replace("S","P").replace("L","G")).join(" · ")}</em></button>`).join("")}</div>`});
  document.querySelectorAll("#modal [data-add]").forEach(b=>b.onclick=()=>{ const k = b.dataset.add; layout.push({id:k, size:W[k].sizes.includes("m")?"m":W[k].sizes[0]}); save(); C.closeModal(); render(); });
}
addEventListener("hashchange", ()=>{ if(document.body.dataset.view==="home") render(); else editing = false; });

window.Home = {refresh, edit: () => { editing = true; render(); }, remove: id => { layout = layout.filter(w=>w.id!==id); save(); render(); }};
})();
