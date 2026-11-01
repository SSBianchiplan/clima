/* =============================================================================
   DISPOSIÇÃO DO MODO MAPA (estilo app de mapas, com o vidro líquido do sistema)
   Computador: trilho à esquerda (menu, salvos, recentes, widgets, tema), busca flutuante no topo
   com atalhos em "chips" ao lado, cartão do lugar à esquerda sob a busca, botão Camadas embaixo.
   Celular: busca no topo como já era, chips roláveis logo abaixo, cartão do lugar como folha.
   Só reorganiza o que já existe: busca, 3D/2D, imagem e Rota voltam para o cabeçalho fora do mapa.
   ============================================================================= */
(() => {
"use strict";
const $ = id => document.getElementById(id), ico = (n, s=20) => window.Ico?.(n, s) || "";
const store = {get(k,d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } }, set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }};
const desk = () => matchMedia("(min-width: 861px)").matches;
const inMap = () => document.body.dataset.view === "sat";
const L = {built:false, home:{}};
const tile = (lon, lat, z) => { const n = 2**z, x = Math.floor((lon+180)/360*n), lr = lat*Math.PI/180, y = Math.floor((1 - Math.log(Math.tan(lr)+1/Math.cos(lr))/Math.PI)/2*n);
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`; };

/* ---------- recentes (lugares abertos no cartão) ---------- */
const recentes = () => store.get("lv-recent", []);
document.addEventListener("clima:place", e => { const o = e.detail; if(o?.lon == null || o.pin) return;
  const r = recentes().filter(x => Math.abs(x.lat - o.lat) > 1e-3 || Math.abs(x.lon - o.lon) > 1e-3);
  r.unshift({name:o.name, lat:+o.lat.toFixed(4), lon:+o.lon.toFixed(4)}); store.set("lv-recent", r.slice(0, 12)); trilhoRecentes(); });
function irPara(p){ const m = window.Sat?.map(); if(!m) return; m.flyTo({center:[p.lon, p.lat], zoom:Math.max(12, m.getZoom()), duration:1600});
  window.ClimaCore?.load({name:p.name, admin:"", country:"", lat:p.lat, lon:p.lon}); }
function trilhoRecentes(){
  const box = $("lvRec"); if(!box) return;
  box.innerHTML = recentes().slice(0, 3).map((p, k) => `<button class="lv-rb lv-recb" data-rk="${k}" title="${p.name}"><img src="${tile(p.lon, p.lat, 12)}" alt="" loading="lazy"><span>${p.name}</span></button>`).join("");
  box.querySelectorAll("[data-rk]").forEach(b => b.onclick = () => irPara(recentes()[+b.dataset.rk]));
}
function popRecentes(btn){
  if(desk() && document.body.classList.contains("lv2")) window.ClimaMenu?.fecharGaveta();
  let p = $("lvPop"); if(p){ p.remove(); if(p.dataset.of === "rec") return; }
  p = document.createElement("section"); p.id = "lvPop"; p.dataset.of = "rec"; p.className = "lv-pop glass";
  const R = recentes();
  p.innerHTML = `<header><b>${ico("clock", 18)} Recentes</b><button class="lv-px" aria-label="Fechar">${ico("x", 16)}</button></header>
    ${R.length ? R.map((x, k) => `<button class="lv-pi" data-pk="${k}"><img src="${tile(x.lon, x.lat, 12)}" alt="" loading="lazy"><span><b>${x.name}</b><small>${x.lat.toFixed(3)}, ${x.lon.toFixed(3)}</small></span></button>`).join("")
      : `<p class="lv-pe">Os lugares que você abrir no mapa aparecem aqui.</p>`}
    ${R.length ? `<button class="lv-pclr">Limpar recentes</button>` : ""}`;
  document.body.appendChild(p);
  p.querySelector(".lv-px").onclick = () => p.remove();
  p.querySelectorAll("[data-pk]").forEach(b => b.onclick = () => { irPara(R[+b.dataset.pk]); p.remove(); });
  const c = p.querySelector(".lv-pclr"); if(c) c.onclick = () => { store.set("lv-recent", []); trilhoRecentes(); p.remove(); };
}

/* ---------- salvos: só os locais salvos, no mesmo estilo de Recentes ---------- */
function popSalvos(){
  if(desk() && document.body.classList.contains("lv2")) window.ClimaMenu?.fecharGaveta();
  let p = $("lvPop"); if(p){ p.remove(); if(p.dataset.of === "sal") return; }
  const C = window.ClimaCore; if(!C) return;
  p = document.createElement("section"); p.id = "lvPop"; p.dataset.of = "sal"; p.className = "lv-pop glass"; document.body.appendChild(p);
  const draw = () => {
    const L = C.places || [], T = C.placeTemps || {}, loc = C.S?.loc, salvo = loc && C.isSaved?.(loc);
    p.innerHTML = `<header><b>${ico("star", 18)} Locais salvos</b><button class="lv-px" aria-label="Fechar">${ico("x", 16)}</button></header>
      ${loc ? `<button class="lv-psave${salvo ? " on" : ""}" data-sv>${ico("star", 16)} ${salvo ? "Remover" : "Salvar"} ${C.esc(loc.name)}</button>` : ""}
      ${L.length ? L.map((x, k) => { const c = T[`${x.lat},${x.lon}`], at = loc && Math.abs(x.lat - loc.lat) < 1e-3 && Math.abs(x.lon - loc.lon) < 1e-3;
        return `<div class="lv-pi lv-ps${at ? " on" : ""}" data-pk="${k}" role="button" tabindex="0"><img src="${tile(x.lon, x.lat, 12)}" alt="" loading="lazy">
          <span><b>${C.esc(x.name)}</b><small>${C.esc([x.admin, x.country].filter(Boolean).join(", ") || `${(+x.lat).toFixed(3)}, ${(+x.lon).toFixed(3)}`)}</small></span>
          ${c ? `<em>${C.icon(C.wmo(c.weather_code)[1], 22, !c.is_day)}${C.r0(c.temperature_2m)}°</em>` : ""}<button class="lv-pdel" data-del="${k}" aria-label="Remover ${C.esc(x.name)}">${ico("x", 14)}</button></div>`; }).join("")
        : `<p class="lv-pe">Nenhum local salvo. Toque na estrela de um lugar (no mapa ou na busca) para salvá-lo aqui.</p>`}`;
    p.querySelector(".lv-px").onclick = () => p.remove();
    const sv = p.querySelector("[data-sv]"); if(sv) sv.onclick = () => { C.savePlace(loc); draw(); };
    p.querySelectorAll("[data-del]").forEach(b => b.onclick = e => { e.stopPropagation(); C.savePlace(L[+b.dataset.del]); draw(); });
    p.querySelectorAll("[data-pk]").forEach(b => b.onclick = () => { const x = L[+b.dataset.pk]; C.load(x); const m = window.Sat?.map(); if(m && inMap()) m.flyTo({center:[x.lon, x.lat], zoom:Math.max(11, m.getZoom()), duration:1400}); p.remove(); });
  };
  draw();
}

/* ---------- tema: alterna claro → automático → escuro → satélite (os botões do cabeçalho) ---------- */
function proxTema(){
  const bs = [...document.querySelectorAll("#themeSeg [data-t]")]; if(!bs.length){ $("themeFab")?.click(); return; }
  const i = bs.findIndex(b => b.getAttribute("aria-checked") === "true" || b.getAttribute("aria-pressed") === "true");
  bs[(i + 1) % bs.length].click();
}

/* ---------- atalhos (chips) ---------- */
const CHIPS = [
  ["tempo", "wind", "Tempo", () => window.Meteo?.abrir(), () => window.Meteo?.isOn?.()],
  ["transito", "traffic", "Trânsito", () => { if(!window.Rotas?.isTraffic()) window.Rotas?.setTraffic(true); window.Rotas?.trafficCfg(); }, () => window.Rotas?.isTraffic?.()],
  ["rotas", "compass", "Rotas", () => window.Rotas?.isOpen() ? window.Rotas.close() : window.Rotas?.open(), () => window.Rotas?.isOpen?.()],
  ["lugares", "pin", "Lugares", () => window.Places?.setOn(!window.Places.isOn()), () => window.Places?.isOn?.()],
  ["avioes", "plane", "Aviões", () => window.Sat?.setAir(!window.Sat.isAir()), () => window.Sat?.isAir?.()],
  // Dirigir: escolhe o veículo e sai do centro do mapa (as rodoviárias continuam como pontos de partida no mapa)
  ["dirigir", "car", "Dirigir", () => { const m = window.Sat?.map(); if(!m) return; const c = m.getCenter(), L = window.ClimaCore?.S?.loc;
    window.Drive?.choose({lon:c.lng, lat:c.lat, cidade:L?.name || "Centro do mapa", nome:"centro do mapa"}); }, () => window.Drive?.active?.()],
  ["drone", "heli", "Drone", () => window.Drive?.tour(), () => window.Drone?.active?.()],
  ["cams", "video", "Câmeras", () => window.Cams?.setOn(!window.Cams.isOn()), () => window.Cams?.isOn?.()]
];
function chipsHtml(){ return CHIPS.map(([k, i, n]) => `<button class="lv-chip glass" data-ch="${k}" aria-pressed="false">${ico(i, 17)}<span>${n}</span></button>`).join(""); }
function chipsBind(box){ box.querySelectorAll("[data-ch]").forEach(b => b.onclick = () => { const c = CHIPS.find(x => x[0] === b.dataset.ch); c[3](); setTimeout(chipsSync, 250); setTimeout(() => window.Sat?.panelRefresh?.(), 300); }); }
function chipsSync(){ document.querySelectorAll("[data-ch]").forEach(b => { const c = CHIPS.find(x => x[0] === b.dataset.ch); b.setAttribute("aria-pressed", !!c?.[4]()); }); }

/* ---------- montagem ---------- */
function montar(){
  if(L.built) return; L.built = true;
  // o trilho já vem no HTML (aparece no primeiro quadro); aqui só ganha os botões
  const rail = $("lvRail") || Object.assign(document.createElement("nav"), {id:"lvRail", className:"lv-rail glass"}); rail.setAttribute("aria-label", "Atalhos do mapa");
  rail.innerHTML = `<button class="lv-logo" id="lvLogo" title="Clima — minha tela"><img src="icon.svg" alt="" width="30" height="30"></button>
    <button class="lv-rb" id="lvMenu" title="Menu: seções, especialistas e locais">${ico("menu", 22)}<span>Menu</span></button>
    <button class="lv-rb" id="lvSalvos" title="Locais salvos">${ico("star", 22)}<span>Salvos</span></button>
    <button class="lv-rb" id="lvRecentes" title="Recentes">${ico("clock", 22)}<span>Recentes</span></button>
    <div class="lv-rec" id="lvRec"></div>
    <div class="lv-sp"></div>
    <button class="lv-rb" id="lvWidgets" title="Minha tela (widgets)">${ico("grid", 22)}<span>Widgets</span></button>
    <button class="lv-rb" id="lvTema" title="Aparência">${ico("contrast", 22)}<span>Tema</span></button>
    <button class="lv-rb" id="lvReload" title="Atualizar dados">${ico("refresh", 22)}<span>Atualizar</span></button>`;
  document.body.appendChild(rail);
  const top = document.createElement("div"); top.id = "lvTop"; top.className = "lv-top";
  top.innerHTML = `<div class="lv-search glass" id="lvSearch"></div><div class="lv-chips" id="lvChips"><div class="lv-view" id="lvView"></div>${chipsHtml()}</div>`;
  document.body.appendChild(top);
  const mob = document.createElement("div"); mob.id = "lvChipsM"; mob.className = "lv-chips lv-chipsm"; mob.innerHTML = chipsHtml(); document.body.appendChild(mob);
  const lay = document.createElement("button"); lay.id = "lvLayers"; lay.className = "lv-layers glass"; lay.title = "Camadas do mapa";
  lay.innerHTML = `<img id="lvLayImg" alt=""><span>${ico("layers", 16)} Camadas</span>`; document.body.appendChild(lay);
  chipsBind(top); chipsBind(mob);
  $("lvLogo").onclick = $("lvWidgets").onclick = () => { location.hash = "#home"; };
  $("lvMenu").onclick = () => { $("lvPop")?.remove(); $("sideTg")?.click(); };
  $("lvSalvos").onclick = () => popSalvos();
  $("lvRecentes").onclick = () => popRecentes();
  $("lvTema").onclick = proxTema; $("lvReload").onclick = () => $("reload")?.click();
  // Camadas: mostra/esconde a barra de camadas (ícones) do mapa; no celular abre a folha de camadas
  lay.onclick = () => { if(!desk()){ $("satFab")?.click(); return; } const off = !document.body.classList.toggle("lv-lyr-off") ? false : true; store.set("lv-lyr-off", off); lay.classList.toggle("on", !off); };
  if(store.get("lv-lyr-off", false)) document.body.classList.add("lv-lyr-off");
  lay.classList.toggle("on", !document.body.classList.contains("lv-lyr-off"));
  trilhoRecentes();
  // miniatura do botão Camadas: a foto aérea do centro do mapa
  const upd = () => { const m = window.Sat?.map(); if(!m) return; const c = m.getCenter(); $("lvLayImg").src = tile(c.lng, c.lat, Math.max(3, Math.min(15, Math.round(m.getZoom()) - 1))); };
  const iv = setInterval(() => { const m = window.Sat?.map(); if(!m) return; clearInterval(iv); m.on("moveend", upd); upd(); }, 800);
  setInterval(chipsSync, 2000);
}
// busca e 3D/2D · imagem · Rota: no mapa ficam na busca flutuante e nos chips; fora do mapa voltam ao cabeçalho
function mover(dentro){
  const s = document.querySelector(".toolbar .search, #lvSearch .search"), v = $("tbView");
  if(dentro){
    if(s && s.parentElement.id !== "lvSearch"){ L.home.s = [s.parentElement, s.nextSibling]; $("lvSearch").appendChild(s); }
    if(v && v.parentElement.id !== "lvView"){ L.home.v = [v.parentElement, v.nextSibling]; $("lvView").appendChild(v); }
  } else {
    if(s && L.home.s && s.parentElement.id === "lvSearch") L.home.s[0].insertBefore(s, L.home.s[1]);
    if(v && L.home.v && v.parentElement.id === "lvView") L.home.v[0].insertBefore(v, L.home.v[1]);
  }
}
function aplicar(){
  montar();
  const on = inMap(), d = desk();
  document.body.classList.toggle("lv2", on);
  document.body.classList.toggle("lv-r", d);
  if(d) document.body.classList.remove("rail");
  mover(on && d);
  if(!on) $("lvPop")?.remove();
  chipsSync();
  setTimeout(() => window.Sat?.resize?.(), 80);
}
addEventListener("hashchange", () => setTimeout(aplicar, 0));
matchMedia("(min-width: 861px)").addEventListener("change", aplicar);
// o modo do corpo (data-view) é definido pelo app ao abrir: espera ele existir
const iv = setInterval(() => { if(!document.body.dataset.view || !window.Sat) return; clearInterval(iv); aplicar(); }, 300);
// Esc fecha o popover; clique fora também
addEventListener("keydown", e => { if(e.key === "Escape") $("lvPop")?.remove(); });
document.addEventListener("pointerdown", e => { const p = $("lvPop"); if(p && !p.contains(e.target) && !e.target.closest("#lvRecentes, #lvSalvos")) p.remove(); }, true);
/* ---------- cartões como widgets: arrastar, recolher e nunca um por cima do outro (computador) ----------
   Cada cartão aberto vai para a primeira vaga livre: coluna da esquerda (sob a busca), depois a da direita.
   Arrastado pelo topo, fica onde foi solto (lembrado) e vira obstáculo para os outros. "–" recolhe ao título. */
// LIVRES: painéis com lugar próprio (barra do voo, ferramentas do POV) — não são reposicionados sozinhos, mas também
// arrastam, recolhem e contam como obstáculo para os cartões
const LIVRES = ["flightBar", "povTools"];
const CARDS = [["region", "Lugar"], ["planeCard", "Avião"], ["camCard", "Câmera"], ["rtPanel", "Rotas"], ["metPanel", "Camadas do tempo"], ["ttCfg", "Trânsito"], ["dnPick", "Drone"], ["dvLayers", "Camadas"]];
const W = {pos:store.get("lv-cardpos", {}), min:store.get("lv-cardmin", {}), drag:null};
const aberto = el => el && !el.hidden && el.isConnected && getComputedStyle(el).display !== "none";
// em todas as telas do computador (mapa, Minha tela e as demais): os cartões nunca ficam sob o trilho, o cabeçalho ou os widgets
function cardsAtivo(){ return desk() && document.body.classList.contains("lv-r") && !document.body.classList.contains("drv") && !document.body.classList.contains("rt-nav"); }
function por(el, x, y){ for(const [k, v] of [["left", x + "px"], ["top", y + "px"], ["right", "auto"], ["bottom", "auto"], ["transform", "none"]]) el.style.setProperty(k, v, "important"); }
function arrumar(){
  const lista = CARDS.map(([id]) => $(id)).filter(aberto), livres = LIVRES.map(id => $(id)).filter(aberto);
  document.querySelectorAll(".lv-cbar").forEach(b => { if(![...lista, ...livres].some(el => el.id === b.dataset.for) || !cardsAtivo()) b.remove(); });
  if(!cardsAtivo()){ [...lista, ...livres].forEach(el => { for(const k of ["left","top","right","bottom","transform"]) el.style.removeProperty(k); el.classList.remove("lv-min"); }); return; }
  const tb = document.querySelector(".toolbar"), tbB = !document.body.classList.contains("lv2") && tb && aberto(tb) ? tb.getBoundingClientRect().bottom : 0;
  const top0 = tbB ? Math.round(tbB) + 10 : 74, base = innerHeight - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dockH")) || 170) - 52;
  const dir = document.querySelector("body.mapview:not(.widgets-off) .content");
  const xR = (dir && aberto(dir) ? dir.getBoundingClientRect().left - 12 : innerWidth - 16);
  const ocup = [], bate = (a, b) => a.x < b.x + b.w + 8 && b.x < a.x + a.w + 8 && a.y < b.y + b.h + 8 && b.y < a.y + a.h + 8;
  // 0) painéis livres: no lugar deles (ou onde você arrastou), e são obstáculos
  for(const el of livres){ el.classList.toggle("lv-min", !!W.min[el.id]); const p = W.pos[el.id];
    if(p){ const w = el.offsetWidth; por(el, Math.max(80, Math.min(innerWidth - w - 8, p.x)), Math.max(8, Math.min(innerHeight - 60, p.y))); }
    const r = el.getBoundingClientRect(); if(r.width) ocup.push({x:r.left, y:r.top, w:r.width, h:r.height}); }
  // 1) os que você arrastou ficam onde estão (dentro da tela)
  for(const el of lista){ const p = W.pos[el.id]; el.classList.toggle("lv-min", !!W.min[el.id]); if(!p) continue;
    const w = el.offsetWidth, h = el.offsetHeight, x = Math.max(80, Math.min(innerWidth - w - 8, p.x)), y = Math.max(8, Math.min(innerHeight - 60, p.y));
    por(el, x, y); ocup.push({x, y, w, h}); }
  // 2) os outros: primeira vaga livre na coluna da esquerda, depois na da direita, de cima para baixo
  // o botão Camadas (canto inferior esquerdo) também é obstáculo para a coluna da esquerda
  const sb = document.querySelector(".sidebar"); let x0 = 88;
  if(sb && !document.body.classList.contains("side-off") && aberto(sb)){ const r = sb.getBoundingClientRect(); if(r.width > 40){ ocup.push({x:r.left, y:0, w:r.width, h:innerHeight}); x0 = Math.max(x0, r.right + 12); } }
  const lb = $("lvLayers"); if(aberto(lb)){ const r = lb.getBoundingClientRect(); if(r.width) ocup.push({x:r.left, y:r.top, w:r.width, h:r.height}); }
  for(const el of lista){ if(W.pos[el.id]) continue; el.style.removeProperty("max-height");
    const w = el.offsetWidth, h = Math.min(el.scrollHeight || el.offsetHeight, base - top0);
    let ok = null;
    // vaga: até o próximo obstáculo abaixo na coluna; o cartão pode ficar mais baixo (rolando) se tiver ao menos 220 px
    for(const x of [x0, xR - w]){
      for(let y = top0; y <= base - 120 && !ok; y += 12){
        const lim = Math.min(base, ...ocup.filter(o => o.x < x + w && x < o.x + o.w && o.y >= y).map(o => o.y - 12)), hh = Math.min(h, lim - y);
        if(hh < Math.min(h, 220)) continue; const r = {x, y, w, h:hh}; if(!ocup.some(o => bate(o, r))) ok = r; }
      if(ok) break; }
    ok = ok || {x:x0, y:top0, w, h:Math.min(h, base - top0)};
    el.style.setProperty("max-height", Math.max(120, ok.h) + "px", "important"); por(el, ok.x, ok.y); ocup.push(ok); }
  setTimeout(barras, 30); setTimeout(barras, 320);
  // barrinha de cada cartão: alça de arrastar + recolher (fica sobre a borda de cima do cartão)
  for(const el of [...lista, ...livres]){ let b = document.querySelector(`.lv-cbar[data-for="${el.id}"]`);
    if(!b){ b = document.createElement("div"); b.className = "lv-cbar"; b.dataset.for = el.id;
      b.innerHTML = `<i class="lv-grip" title="Arrastar"></i><button class="lv-cmin" title="Recolher / expandir">${ico("minus", 14)}</button>`;
      document.body.appendChild(b);
      b.querySelector(".lv-cmin").onclick = () => { W.min[el.id] = !W.min[el.id]; store.set("lv-cardmin", W.min); arrumar(); };
      b.querySelector(".lv-grip").addEventListener("pointerdown", e => arrastar(e, el)); b.querySelector(".lv-grip").ondblclick = () => { delete W.pos[el.id]; store.set("lv-cardpos", W.pos); arrumar(); }; }
    b.querySelector(".lv-cmin").innerHTML = ico(W.min[el.id] ? "plus" : "minus", 14); }
}
function barras(){ document.querySelectorAll(".lv-cbar").forEach(b => { const el = $(b.dataset.for); if(!aberto(el)) return; const r = el.getBoundingClientRect(); b.style.left = `${r.left + r.width/2}px`; b.style.top = `${r.top}px`; }); }
function arrastar(e, el){
  e.preventDefault(); const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
  el.classList.add("lv-drag");
  const mv = ev => { const x = ev.clientX - dx, y = ev.clientY - dy; por(el, x, y); const b = document.querySelector(`.lv-cbar[data-for="${el.id}"]`); if(b){ b.style.left = `${x + r.width/2}px`; b.style.top = `${y}px`; } };
  const up = ev => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); el.classList.remove("lv-drag");
    W.pos[el.id] = {x:ev.clientX - dx, y:ev.clientY - dy}; store.set("lv-cardpos", W.pos);
    // soltou em cima de outro cartão arrastado: os outros reorganizam em volta
    arrumar(); };
  addEventListener("pointermove", mv); addEventListener("pointerup", up);
}
// reorganiza quando um cartão abre, fecha ou muda de tamanho
let arT = 0; const agenda = () => { clearTimeout(arT); arT = setTimeout(arrumar, 60); };
new MutationObserver(ms => { if(ms.some(m => [...m.addedNodes, ...m.removedNodes].some(n => [...CARDS.map(c => c[0]), ...LIVRES].includes(n.id)) || (m.type === "attributes" && [...CARDS.map(c => c[0]), ...LIVRES].includes(m.target.id)))) agenda(); })
  .observe(document.body, {childList:true, subtree:false, attributes:true, attributeFilter:["hidden"], attributeOldValue:false});
const ro = new ResizeObserver(agenda); setInterval(() => [...CARDS.map(c => c[0]), ...LIVRES].forEach(id => { const el = $(id); if(el && !el.__lvro){ el.__lvro = true; ro.observe(el); new MutationObserver(agenda).observe(el, {attributes:true, attributeFilter:["hidden","class"]}); } }), 700);
addEventListener("resize", agenda); addEventListener("hashchange", () => setTimeout(arrumar, 100));
// escolher uma seção na gaveta do mapa: a gaveta fecha (sem gravar preferência — nas outras telas o menu continua)
document.addEventListener("click", e => { const a = e.target.closest(".sidebar .nav a"); if(a && document.body.classList.contains("lv2") && desk()) setTimeout(() => window.ClimaMenu?.fecharGaveta(), 50); });
document.addEventListener("click", e => { if(e.target.closest("#sideTg, #lvMenu")) setTimeout(arrumar, 300); });
/* ---------- celular: 3D · minha localização · globo, na coluna da direita (abaixo dos botões existentes) ---------- */
function botoesMob(){
  let g = $("lvMobBtns");
  if(!g){ g = document.createElement("div"); g.id = "lvMobBtns"; g.className = "lv-mobbtns";
    g.innerHTML = `<button class="lv-mb glass" data-mb="3d" aria-label="Inclinar em 3D / vista de cima">${ico("mountain", 22)}</button>
      <button class="lv-mb glass" data-mb="me" aria-label="Minha localização">${ico("target", 22)}</button>
      <button class="lv-mb glass" data-mb="globo" aria-label="Ver o globo inteiro">${ico("globe", 22)}</button>`;
    document.body.appendChild(g);
    g.querySelector('[data-mb="3d"]').onclick = () => { const m = window.Sat?.map(); if(!m) return; const up = m.getPitch() > 5;
      if(!up && !window.Sat.isClear?.()) window.Sat.setProd?.("earth");
      m.easeTo({pitch:up ? 0 : 62, bearing:up ? 0 : m.getBearing() - 20, zoom:up ? m.getZoom() : Math.max(m.getZoom(), 13), duration:1200}); };
    g.querySelector('[data-mb="me"]').onclick = () => window.Gps ? window.Gps.centrar() : $("satCenter")?.click();
    g.querySelector('[data-mb="globo"]').onclick = () => { const m = window.Sat?.map(); m?.flyTo({center:m.getCenter(), zoom:1.4, pitch:0, bearing:0, duration:1600}); }; }
  // logo abaixo do último botão da coluna da direita (☰ do satélite)
  // mesma coluna, tamanho e vidro dos botões de cima (☰)
  const fab = $("satFab"), r = fab && aberto(fab) ? fab.getBoundingClientRect() : null;
  g.style.top = `${r ? Math.round(r.bottom + 12) : 380}px`;
  if(r){ g.style.right = "auto"; g.style.left = `${Math.round(r.left)}px`; const cs = getComputedStyle(fab);
    g.querySelectorAll(".lv-mb").forEach(b => { b.style.width = b.style.height = `${Math.round(r.width)}px`; b.style.background = cs.backgroundColor; b.style.color = cs.color;
      b.style.boxShadow = cs.boxShadow; b.style.border = cs.border; }); }
}
addEventListener("resize", () => !desk() && botoesMob()); addEventListener("hashchange", () => setTimeout(() => !desk() && botoesMob(), 300));
setTimeout(() => !desk() && botoesMob(), 1500); setInterval(() => { if(!desk() && inMap()) botoesMob(); }, 3000);
// gaveta do menu no mapa: fecha ao clicar fora dela (e com Esc)
document.addEventListener("pointerdown", e => {
  if(!desk() || !document.body.classList.contains("lv2") || document.body.classList.contains("side-off")) return;
  if(e.target.closest(".sidebar, #lvMenu, #sideTg")) return;
  window.ClimaMenu?.fecharGaveta(); setTimeout(arrumar, 300);
}, true);
addEventListener("keydown", e => { if(e.key === "Escape" && desk() && document.body.classList.contains("lv2") && !document.body.classList.contains("side-off")) window.ClimaMenu?.fecharGaveta(); });
/* ---------- telas de conteúdo (Agora, Mar, Avisos…): o mapa fica só de fundo, sem marcadores por trás do texto ---------- */
const MARC = ["cams","rodov","places","airports","airports-lbl","volc","temp","planes","landmarks","region-fill","region-line","drv-ring","tt-inc-ico","tt-inc-clu","tt-inc-clu-n"];
let marcSalvo = null;
function marcadores(){
  const m = window.Sat?.map(); if(!m || !m.getStyle()) return;
  const fundo = !document.body.classList.contains("mapview");
  if(fundo && !marcSalvo){ marcSalvo = {}; for(const id of MARC) if(m.getLayer(id)){ marcSalvo[id] = m.getLayoutProperty(id, "visibility") || "visible"; m.setLayoutProperty(id, "visibility", "none"); } }
  else if(!fundo && marcSalvo){ for(const [id, v] of Object.entries(marcSalvo)) if(m.getLayer(id)) m.setLayoutProperty(id, "visibility", v); marcSalvo = null; }
}
addEventListener("hashchange", () => setTimeout(marcadores, 60)); setTimeout(marcadores, 2500);
/* ---------- celular: cartões como folha que desliza (puxar para baixo recolhe; mais para baixo fecha; para cima abre) ----------
   Alça própria no topo de cada folha (touch-action:none): o gesto não briga com a rolagem do conteúdo do cartão. */
const FOLHAS = ["region", "camCard", "ttCfg", "metPanel", "rtPanel"];
function alca(el){
  if(el.querySelector(":scope > .lv-grab")) return;
  const g = document.createElement("div"); g.className = "lv-grab"; g.setAttribute("aria-label", "Arrastar para recolher ou abrir"); el.prepend(g);
  g.addEventListener("pointerdown", e => {
    if(desk()) return; e.preventDefault(); g.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = el.getBoundingClientRect().height; let dy = 0; el.style.transition = "none";
    const mv = ev => { dy = ev.clientY - y0; el.style.transform = `translateY(${Math.max(-40, dy)}px)`; };
    const fim = () => { g.removeEventListener("pointermove", mv); g.removeEventListener("pointerup", fim); g.removeEventListener("pointercancel", fim);
      el.style.transition = ""; el.style.transform = "";
      if(Math.abs(dy) < 6){ el.classList.toggle("lv-folha-min"); return; }                 // toque: alterna
      if(dy > h0 * .6 && !el.classList.contains("lv-folha-min")){ const x = el.querySelector("#rgX, .cc-x, .tc-x, .met-x, [aria-label=Fechar]"); x ? x.click() : (el.hidden = true); }
      else if(dy > 30) el.classList.add("lv-folha-min");
      else if(dy < -20) el.classList.remove("lv-folha-min"); };
    g.addEventListener("pointermove", mv); g.addEventListener("pointerup", fim); g.addEventListener("pointercancel", fim);
  });
}
setInterval(() => { if(desk()) return; for(const id of FOLHAS){ const el = $(id); if(el && !el.hidden) alca(el); } }, 700);
window.Layout = {aplicar, arrumar};
})();
