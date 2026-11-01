/* =============================================================================
   DIREÇÃO LIVRE — carro, moto, caminhão, ônibus e viatura da polícia em 3D,
   dirigindo pelo mapa todo (estilo arcade). Ponto de partida: rodoviária das
   cidades com 3D (data-rodoviarias.json). Câmera atrás do veículo; sobre pontes
   e viadutos o veículo roda na altura do tabuleiro (bridges3d.js).
   Teclado: ↑/W acelera · ↓/S freia/ré · ←→/A D esterça · Espaço freio de mão ·
   H buzina/sirene · C câmera · Esc sai. No celular: pedais e volante na tela.
   O drone avançado (voo tour livre) fica em drone.js e usa a mesma câmera (aim) e o mesmo anel.
   ============================================================================= */
(() => {
"use strict";
const C = window.ClimaCore, $ = id => document.getElementById(id), D2R = Math.PI/180;
const store = {get(k,d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } }, set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }};
const ico = (n, s=20) => window.Ico?.(n, s) || "";
let on = store.get("drive-on", true);

/* ---------- veículos: peças [trás, frente, meia-largura ou [x0,x1], base, topo, tipo] em metros ----------
   tipos: c cor, g vidro, d pneu/escuro, l farol, r lanterna, w branco, k preto, s sirene (pisca vermelho/azul) */
const V = {
  carro:{nome:"Carro", vmax:50, acc:8.5, freio:12, giro:1.0, cor:"#1F6FEB", p:[[-2.3,2.3,.9,.28,.95,"c"],[-1.25,.95,.8,.95,1.4,"g"],[-1.05,.65,.76,1.4,1.47,"c"],
    [2.2,2.32,[-.85,-.45],.6,.78,"l"],[2.2,2.32,[.45,.85],.6,.78,"l"],[-2.34,-2.25,[-.85,-.45],.62,.8,"r"],[-2.34,-2.25,[.45,.85],.62,.8,"r"],
    [1.05,1.75,[-.98,-.78],0,.62,"d"],[1.05,1.75,[.78,.98],0,.62,"d"],[-1.75,-1.05,[-.98,-.78],0,.62,"d"],[-1.75,-1.05,[.78,.98],0,.62,"d"]]},
  moto:{nome:"Moto", vmax:58, acc:11, freio:12, giro:1.35, cor:"#D7263D", p:[[-1.05,1.05,.18,.3,.75,"c"],[-.55,.35,.24,.75,.95,"k"],[.55,.95,.3,.75,1.05,"c"],
    [-.35,.25,.22,.95,1.75,"k"],[-.2,.15,.16,1.75,2.0,"w"],[.95,1.08,.08,.75,.9,"l"],[-1.12,-1.02,.08,.65,.78,"r"],
    [.7,1.15,.07,0,.62,"d"],[-1.15,-.7,.07,0,.62,"d"]]},
  caminhao:{nome:"Caminhão", vmax:32, acc:4, freio:8, giro:.75, cor:"#F5C518", p:[[2.6,5.2,1.25,.6,2.9,"c"],[4.4,5.15,1.15,1.9,2.7,"g"],[-5.2,2.4,1.28,.95,3.9,"w"],
    [5.15,5.25,[-1.1,-.7],.9,1.2,"l"],[5.15,5.25,[.7,1.1],.9,1.2,"l"],[-5.28,-5.2,[-1.15,-.8],.9,1.2,"r"],[-5.28,-5.2,[.8,1.15],.9,1.2,"r"],
    [3.6,4.6,[-1.32,-1.05],0,1.05,"d"],[3.6,4.6,[1.05,1.32],0,1.05,"d"],[-4.6,-3.6,[-1.32,-1.05],0,1.05,"d"],[-4.6,-3.6,[1.05,1.32],0,1.05,"d"],[-3.4,-2.4,[-1.32,-1.05],0,1.05,"d"],[-3.4,-2.4,[1.05,1.32],0,1.05,"d"]]},
  onibus:{nome:"Ônibus", vmax:30, acc:3.8, freio:8, giro:.7, cor:"#2E9E5B", p:[[-6,6,1.27,.45,1.6,"c"],[-6,6,1.29,1.6,2.75,"g"],[-6,6,1.27,2.75,3.25,"w"],[5.5,6.02,1.15,1.6,2.75,"g"],
    [5.98,6.06,[-1.1,-.75],.7,1.0,"l"],[5.98,6.06,[.75,1.1],.7,1.0,"l"],[-6.06,-5.98,[-1.1,-.75],.8,1.1,"r"],[-6.06,-5.98,[.75,1.1],.8,1.1,"r"],
    [3.8,4.9,[-1.3,-1.05],0,1.0,"d"],[3.8,4.9,[1.05,1.3],0,1.0,"d"],[-4.4,-3.3,[-1.3,-1.05],0,1.0,"d"],[-4.4,-3.3,[1.05,1.3],0,1.0,"d"]]},
  // pessoa: 1,75 m (pernas, tronco, braços, cabeça); anda 2,2 m/s, corre 7 m/s (Shift), pula (Espaço)
  pessoa:{nome:"Pessoa", pessoa:true, vmax:2.2, run:7, acc:14, freio:16, giro:2.8, cor:"#FF9500", p:[[-.1,.1,[-.2,-.04],0,.85,"leg1"],[-.1,.1,[.04,.2],0,.85,"leg2"],
    [-.13,.13,.24,.85,1.45,"c"],[-.09,.09,[-.32,-.24],.95,1.42,"arm2"],[-.09,.09,[.24,.32],.95,1.42,"arm1"],[-.11,.11,.11,1.48,1.72,"skin"],[-.12,.12,.12,1.72,1.77,"k"]]},
  policia:{nome:"Polícia", vmax:56, acc:9.5, freio:13, giro:1.05, cor:"#F2F4F7", sirene:true, p:[[-2.3,2.3,.9,.28,.95,"k"],[-2.25,2.25,.92,.55,.85,"w"],[-1.25,.95,.8,.95,1.4,"g"],[-1.05,.65,.76,1.4,1.47,"w"],
    [-.25,.25,[-.7,0],1.47,1.68,"s"],[-.25,.25,[0,.7],1.47,1.68,"s2"],
    [2.2,2.32,[-.85,-.45],.6,.78,"l"],[2.2,2.32,[.45,.85],.6,.78,"l"],[-2.34,-2.25,[-.85,-.45],.62,.8,"r"],[-2.34,-2.25,[.45,.85],.62,.8,"r"],
    [1.05,1.75,[-.98,-.78],0,.62,"d"],[1.05,1.75,[.78,.98],0,.62,"d"],[-1.75,-1.05,[-.98,-.78],0,.62,"d"],[-1.75,-1.05,[.78,.98],0,.62,"d"]]}
};
const PC = {g:"#1C2633", d:"#121417", l:"#FFF4B8", r:"#E5242B", w:"#F2F4F7", k:"#16181C", skin:"#E0AC85", leg1:"#2B3A55", leg2:"#2B3A55", arm1:"#E0AC85", arm2:"#E0AC85"};
let S = null, raf = 0, keys = new Set(), audio = null, DJ = {};
const fc = f => ({type:"FeatureCollection", features:f});

function model(){
  // escala real (mesma dos prédios, que usam alturas medidas)
  const M = V[S.tipo], s = 1, h = S.hdg*D2R, ch = Math.cos(h), sh = Math.sin(h), mx = 1/(111320*Math.cos(S.lat*D2R)), my = 1/110574;
  const lift = (window.Bridges?.isOn() ? window.Bridges.topAt(S.lon, S.lat) + .1 : 0) + (S.z || 0), blink = Math.floor(performance.now()/180) % 2;
  // passada: pernas e braços balançam com a distância percorrida
  const sw = M.pessoa ? Math.sin(S.step || 0) * Math.min(1, Math.abs(S.v)/1.4) * .35 : 0;
  const P = (x, y) => [S.lon + (x*ch + y*sh)*s*mx, S.lat + (-x*sh + y*ch)*s*my];
  return fc(M.p.map(([y0, y1, w, b, t, k]) => { const [x0, x1] = Array.isArray(w) ? w : [-w, w];
    const o = k === "leg1" || k === "arm2" ? sw : k === "leg2" || k === "arm1" ? -sw : 0; y0 += o; y1 += o;
    const col = k === "c" ? (S.cor || M.cor) : k === "s" ? (S.sir && blink ? "#FF2D2D" : "#5A1010") : k === "s2" ? (S.sir && !blink ? "#2D6BFF" : "#10205A") : PC[k];
    return {type:"Feature", properties:{b:b*s + lift, t:t*s + lift, col}, geometry:{type:"Polygon", coordinates:[[P(x0,y0), P(x1,y0), P(x1,y1), P(x0,y1), P(x0,y0)]]}}; }));
}
function layers(m){
  if(m.getSource("drv")) return;
  m.addSource("drv", {type:"geojson", data:fc([])});
  // anel no chão em volta do veículo: raio r em metros, mas nunca menor que 11 px (aparece de longe)
  m.addSource("drv-ring", {type:"geojson", data:fc([])});
  const R = k => ["max", 11, ["*", k, ["get","r"]]];
  m.addLayer({id:"drv-ring", type:"circle", source:"drv-ring", paint:{"circle-pitch-alignment":"map", "circle-pitch-scale":"map",
    "circle-radius":["interpolate",["exponential",2],["zoom"],12,R(.42),16,R(6.7),20,R(107),24,R(1714)],
    "circle-color":["get","c"], "circle-opacity":.18, "circle-stroke-color":["get","c"], "circle-stroke-width":["interpolate",["linear"],["zoom"],14,2,20,3.5], "circle-stroke-opacity":.95}});
  m.addLayer({id:"drv3d", type:"fill-extrusion", source:"drv", paint:{"fill-extrusion-height":["get","t"], "fill-extrusion-base":["get","b"], "fill-extrusion-color":["get","col"], "fill-extrusion-opacity":1}});
}

/* ---------- pontos de partida: rodoviárias ---------- */
function icon(m){
  if(m.hasImage("rodov")) return;
  const s = 64, cv = document.createElement("canvas"); cv.width = cv.height = s; const g = cv.getContext("2d");
  g.beginPath(); g.arc(s/2, s/2, s/2-4, 0, 7); g.fillStyle = "#FF9500"; g.fill(); g.lineWidth = 4; g.strokeStyle = "#fff"; g.stroke();
  window.IcoPaint?.(g, "bus", s/2, s/2, 30, "#fff", 2.4);
  m.addImage("rodov", g.getImageData(0,0,s,s), {pixelRatio:2});
}
function install(){
  const m = window.Sat?.map(); if(!m || !m.getStyle()) return false;
  if(m.getLayer("rodov")) return true;
  icon(m); layers(m);
  m.addSource("rodov", {type:"geojson", data:fc([])});
  fetch("data-rodoviarias.json").then(r => r.json()).then(L => m.getSource("rodov").setData(fc(L.map(x => ({type:"Feature", properties:x, geometry:{type:"Point", coordinates:[x.lon, x.lat]}})))));
  m.addLayer({id:"rodov", type:"symbol", source:"rodov", layout:{visibility:on ? "visible" : "none", "icon-image":"rodov", "icon-size":["interpolate",["linear"],["zoom"],3,.45,12,.8], "icon-allow-overlap":true,
    "text-field":["step",["zoom"],"",9,["concat","🚌 ",["get","cidade"]]], "text-font":["Noto Sans Bold"], "text-size":11.5, "text-offset":[0,1.5], "text-anchor":"top", "text-optional":true},
    paint:{"text-color":"#FFE2B8", "text-halo-color":"rgba(0,0,0,.85)", "text-halo-width":1.4}});
  m.on("click", "rodov", e => { const f = e.features?.[0]; if(f && !S) choose(f.properties); });
  m.on("mouseenter", "rodov", () => { m.getCanvas().style.cursor = "pointer"; }); m.on("mouseleave", "rodov", () => { m.getCanvas().style.cursor = ""; });
  return true;
}
const iv = setInterval(() => { if(install()) clearInterval(iv); }, 1000);
function setOn(v){ on = v; store.set("drive-on", v); const m = window.Sat?.map(); if(m?.getLayer("rodov")) m.setLayoutProperty("rodov", "visibility", v ? "visible" : "none"); }

// janela de partida (como a do simulador de voo): veículo + modo livre ou com destino
let RODS = null;
const rods = () => RODS || (RODS = fetch("data-rodoviarias.json").then(r => r.json()));
const hav = (a, b) => { const R = 6371000, dLa = (b[1]-a[1])*D2R, dLo = (b[0]-a[0])*D2R; return 2*R*Math.asin(Math.sqrt(Math.sin(dLa/2)**2 + Math.cos(a[1]*D2R)*Math.cos(b[1]*D2R)*Math.sin(dLo/2)**2)); };
const fmtD = m => m < 1000 ? `${Math.round(m)} m` : `${(m/1000).toFixed(m < 10000 ? 1 : 0).replace(".", ",")} km`;
async function choose(p){
  const last = store.get("drive-tipo", "carro"), mode = store.get("drive-modo", "livre"), L = await rods();
  // destinos sugeridos: os lugares mais próximos (rodoviárias de outras cidades + marcos da cidade)
  const near = L.filter(x => x.cidade !== p.cidade).map(x => ({...x, d:hav([p.lon, p.lat], [x.lon, x.lat])})).sort((a, b) => a.d - b.d).slice(0, 6);
  const dBtn = x => `<button class="dv-d" data-lon="${x.lon}" data-lat="${x.lat}" data-n="${C.esc(x.nome)}"><b>${C.esc(x.cidade || x.nome)}</b><small>${C.esc(x.nome)} · ${fmtD(x.d)}</small></button>`;
  C.openModal({icon:`<span class="pl-ic" style="background:#FF9500">${ico("bus", 20)}</span>`, title:`Explorar ${p.cidade}`, sub:`Saída: ${p.nome}`,
    html:`<h4 class="msub">Veículo</h4><div class="dv-pick">${Object.entries(V).map(([k, v]) => `<button class="dv-v${k === last ? " on" : ""}" data-dv="${k}"><b>${v.nome}</b><small>até ${Math.round((v.run || v.vmax)*3.6)} km/h</small></button>`).join("")}<button class="dv-v${last === "drone" ? " on" : ""}" data-dv="drone"><b>Drone</b><small>voo tour · até 151 km/h</small></button></div>
      <h4 class="msub">Modo</h4><div class="seg txt dv-modo"><button data-dm="livre" aria-pressed="${mode === "livre"}">Livre</button><button data-dm="destino" aria-pressed="${mode === "destino"}">Com destino</button></div>
      <div class="dv-dest" id="dvDest"${mode === "destino" ? "" : " hidden"}><input id="dvQ" placeholder="Buscar destino (bairro, ponto turístico, endereço)" autocomplete="off"><div class="dv-res" id="dvRes">${near.map(dBtn).join("")}</div></div>
      <p class="dv-help">Computador: ↑/W acelera (anda) · ↓/S freia e dá ré · ←/→ vira · Espaço freio de mão (pessoa: pula) · Shift corre · H buzina/sirene · C câmera (atrás, alta, primeira pessoa) · Esc sai.<br>Celular: botões na tela. Arraste na tela para girar a câmera em volta; rodinha aproxima. Escala real: carro 4,6 m, ônibus 12 m, pessoa 1,75 m. Relevo real: sobe morros e viadutos.</p>`,
    actions:[{label:"🏁 Começar", primary:true, fn:() => {
      const k = document.querySelector(".dv-v.on")?.dataset.dv || "carro", md = document.querySelector("[data-dm][aria-pressed=true]")?.dataset.dm || "livre", d = document.querySelector(".dv-d.on");
      if(md === "destino" && !d){ window.ClimaToast?.("Escolha um destino na lista (ou busque um lugar)."); return; }
      if(k === "drone"){ store.set("drive-tipo", k); C.closeModal(); window.Drone?.start(p); return; }
      store.set("drive-tipo", k); store.set("drive-modo", md); C.closeModal();
      start(k, p, md === "destino" ? {lon:+d.dataset.lon, lat:+d.dataset.lat, nome:d.dataset.n} : null); }}]});
  const md = document.getElementById("modal");
  md.querySelectorAll("[data-dv]").forEach(b => b.onclick = () => md.querySelectorAll("[data-dv]").forEach(x => x.classList.toggle("on", x === b)));
  md.querySelectorAll("[data-dm]").forEach(b => b.onclick = () => { md.querySelectorAll("[data-dm]").forEach(x => x.setAttribute("aria-pressed", x === b)); $("dvDest").hidden = b.dataset.dm !== "destino"; });
  const bind = () => md.querySelectorAll(".dv-d").forEach(b => b.onclick = () => md.querySelectorAll(".dv-d").forEach(x => x.classList.toggle("on", x === b)));
  bind(); let qT = 0;
  $("dvQ").oninput = () => { clearTimeout(qT); qT = setTimeout(async () => { const v = $("dvQ").value.trim(); if(v.length < 3) return;
    try{ const j = await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=pt&q=${encodeURIComponent(v)}&viewbox=${p.lon-.4},${p.lat+.4},${p.lon+.4},${p.lat-.4}`)).json();
      $("dvRes").innerHTML = j.map(x => dBtn({lon:+x.lon, lat:+x.lat, nome:x.display_name.split(",").slice(0, 2).join(","), cidade:x.name || x.display_name.split(",")[0], d:hav([p.lon, p.lat], [+x.lon, +x.lat])})).join("") || "<small>Nada encontrado.</small>"; bind(); }catch(e){} }, 450); };
}
// rota real pelas ruas (Valhalla/OSM): carro/polícia/caminhão/ônibus = auto, moto = motorcycle, pessoa = pedestrian
async function routeTo(dest){
  const costing = S.tipo === "pessoa" ? "pedestrian" : S.tipo === "moto" ? "motorcycle" : S.tipo === "onibus" ? "bus" : S.tipo === "caminhao" ? "truck" : "auto";
  try{ const r = await fetch("https://valhalla1.openstreetmap.de/route", {method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({locations:[{lat:S.lat, lon:S.lon}, {lat:dest.lat, lon:dest.lon}], costing, language:"pt-BR"})});
    const j = await r.json(), s = j.trip.legs[0].shape, out = []; let i = 0, la = 0, lo = 0;
    while(i < s.length){ for(const k of [0, 1]){ let x = 0, sh = 0, c; do { c = s.charCodeAt(i++) - 63; x |= (c & 31) << sh; sh += 5; } while(c >= 32); const d = x & 1 ? ~(x >> 1) : x >> 1; if(k) lo += d; else la += d; } out.push([lo/1e6, la/1e6]); }
    return {coords:out, dist:j.trip.summary.length*1000, time:j.trip.summary.time};
  }catch(e){ return {coords:[[S.lon, S.lat], [dest.lon, dest.lat]], dist:hav([S.lon, S.lat], [dest.lon, dest.lat]), time:0}; }
}
function drawRoute(m){
  if(!m.getSource("drv-rt")){ m.addSource("drv-rt", {type:"geojson", data:fc([])});
    m.addLayer({id:"drv-rt-c", type:"line", source:"drv-rt", layout:{"line-cap":"round","line-join":"round"}, paint:{"line-color":"#0A3A73", "line-width":["interpolate",["linear"],["zoom"],12,5,18,16]}}, "drv3d");
    m.addLayer({id:"drv-rt", type:"line", source:"drv-rt", layout:{"line-cap":"round","line-join":"round"}, paint:{"line-color":"#FF9500", "line-width":["interpolate",["linear"],["zoom"],12,3,18,10]}}, "drv3d");
    m.addLayer({id:"drv-dst", type:"circle", source:"drv-rt", filter:["==",["geometry-type"],"Point"], paint:{"circle-radius":12, "circle-color":"#FF3B30", "circle-stroke-color":"#fff", "circle-stroke-width":3}}); }
  m.getSource("drv-rt").setData(S.rt ? fc([{type:"Feature", geometry:{type:"LineString", coordinates:S.rt.coords}}, {type:"Feature", geometry:{type:"Point", coordinates:[S.dest.lon, S.dest.lat]}}]) : fc([]));
}
function arrive(){
  const secs = (performance.now() - S.t0)/1000, pts = Math.round(Math.max(100, S.rt.dist/2 * Math.min(2, (S.rt.time || secs)/Math.max(30, secs))));
  const best = store.get("drive-best", {}), rec = pts > (best[S.tipo] || 0); if(rec){ best[S.tipo] = pts; store.set("drive-best", best); }
  const e = document.createElement("div"); e.className = "dv-end glass";
  e.innerHTML = `<h3>🏁 Chegou em ${C.esc(S.dest.nome)}!</h3><div class="kpis"><div class="kpi"><small>Pontos</small><b>${pts.toLocaleString("pt-BR")}</b></div><div class="kpi"><small>Tempo</small><b>${Math.floor(secs/60)}:${String(Math.round(secs%60)).padStart(2,"0")}</b></div><div class="kpi"><small>Distância</small><b>${fmtD(S.km*1000)}</b></div></div>${rec ? `<p class="rec">🏆 Novo recorde de ${V[S.tipo].nome}!</p>` : ""}<div class="mact"><button class="xbtn" id="dvGo">Continuar livre</button><button class="mbtn" id="dvOut">Sair</button></div>`;
  $("dvHud").appendChild(e); $("dvGo").onclick = () => { e.remove(); S.dest = null; S.rt = null; drawRoute(window.Sat.map()); $("dvNav").hidden = true; }; $("dvOut").onclick = stop;
}
/* ---------- direção ---------- */
// câmera à prova de relevo ainda carregando (logo após trocar a imagem o MapLibre pode lançar erro de DEM)
function cam(m, o){ try{ m.jumpTo(o); return true; }catch(e){ return false; } }
async function start(tipo, p, dest){
  window.Drone?.stop?.();
  if(document.getElementById("modal")?.open) C.closeModal();
  const m = window.Sat.map(); layers(m);
  if(!window.Sat.isClear()){ window.Sat.setProd("earth"); await new Promise(r => { m.once("idle", r); setTimeout(r, 4000); }); }
  S = {tipo, lon:p.lon, lat:p.lat, hdg:0, z:0, v:0, steer:0, sir:false, cam:0, yaw:0, t:performance.now(), km:0, cidade:p.cidade};
  // sai alinhado com a rua mais próxima (se houver)
  try{ const pt = m.project([p.lon, p.lat]), rs = m.queryRenderedFeatures([[pt.x-60, pt.y-60],[pt.x+60, pt.y+60]]).filter(f => f.sourceLayer === "transportation" && f.geometry.type === "LineString");
    if(rs[0]){ const c = rs[0].geometry.coordinates, a = c[0], b = c[Math.min(1, c.length-1)]; S.hdg = (Math.atan2((b[0]-a[0])*Math.cos(a[1]*D2R), b[1]-a[1])/D2R + 360) % 360; } }catch(e){}
  document.body.classList.add("drv");
  for(const h of ["dragPan","dragRotate","keyboard","touchZoomRotate","doubleClickZoom"]) m[h]?.disable();
  S.maxZ = m.getMaxZoom(); m.setMaxZoom(24); try{ m.setMaxPitch(85); }catch(e){}
  S.dest = dest || null; S.t0 = performance.now();
  hud(); orbitInput(m); cam(m, {center:[p.lon, p.lat], zoom:18.4, pitch:65, bearing:S.hdg});
  if(S.dest){ S.rt = await routeTo(S.dest); if(S) drawRoute(m); }
  cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
}
function stop(){
  if(!S) return; S = null; cancelAnimationFrame(raf); keys.clear();
  const m = window.Sat?.map(); if(m){ labels(m, null); m.getSource("drv")?.setData(fc([])); ring(m); m.getSource("drv-rt")?.setData(fc([])); m.setMaxZoom(19.5); for(const h of ["dragPan","dragRotate","keyboard","touchZoomRotate","doubleClickZoom"]) m[h]?.enable(); m.easeTo({pitch:50, zoom:16, duration:900}); }
  document.body.classList.remove("drv"); $("dvHud")?.remove(); $("dvLayers")?.remove();
}
function beep(freq, ms){ try{ audio = audio || new AudioContext(); const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = freq; o.type = "square"; g.gain.value = .05; o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + ms/1000); }catch(e){} }
/* ---------- obstáculos: prédios perto do veículo (contorno em metros + altura), reconstruído a cada ~80 m ---------- */
const OB = {lon:null, lat:null, list:[], t:0};
const altP = p => +p.height > 0 ? +p.height : +p.num_floors > 0 ? p.num_floors*3.2 : 6;
function obstIdx(m, lon, lat){
  const kx = 111320*Math.cos(lat*D2R), ky = 110574, R = 150, now = performance.now();
  if(OB.lon != null && Math.hypot((lon - OB.lon)*kx, (lat - OB.lat)*ky) < 80 && now - OB.t < 4000) return;
  OB.lon = lon; OB.lat = lat; OB.t = now; const L = [], vistos = new Set();
  const add = (g, h, b, id) => { if(id != null){ if(vistos.has(id)) return; vistos.add(id); }
    const ring = g.type === "Polygon" ? g.coordinates[0] : g.type === "MultiPolygon" ? g.coordinates[0][0] : null; if(!ring) return;
    const P = ring.map(([x, y]) => [(x - lon)*kx, (y - lat)*ky]); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for(const [x, y] of P){ x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if(x1 < -R || x0 > R || y1 < -R || y0 > R) return; L.push({P, x0, x1, y0, y1, h, b:b || 0}); };
  // alturas medidas (arquivos das cidades) primeiro: elas substituem o Overture
  try{ for(const s of Object.keys(m.getStyle().sources)) if(/^(hx-|ghb)/.test(s)) for(const f of m.querySourceFeatures(s)) add(f.geometry, +f.properties.height || 6, 0, f.properties.id ?? f.id); }catch(e){}
  try{ for(const sl of ["building","building_part"]) for(const f of m.querySourceFeatures("ovb", {sourceLayer:sl})){ const p = f.properties; if(p.is_underground) continue;
    add(f.geometry, altP(p), +p.min_height || 0, p.id ?? f.id); } }catch(e){}
  OB.list = L; OB.base = [lon, lat];
}
// topo do prédio no ponto (0 = livre). b = altura da base (passarela, marquise): por baixo dela dá para passar
function obstAt(m, lon, lat, z = 0){
  obstIdx(m, lon, lat); if(!OB.base) return 0;
  const kx = 111320*Math.cos(OB.base[1]*D2R), x = (lon - OB.base[0])*kx, y = (lat - OB.base[1])*110574; let top = 0;
  for(const o of OB.list){ if(x < o.x0 || x > o.x1 || y < o.y0 || y > o.y1 || o.h <= top) continue; if(o.b > z + 2.2) continue;
    let c = false; const P = o.P; for(let i = 0, j = P.length - 1; i < P.length; j = i++){ const [xi, yi] = P[i], [xj, yj] = P[j]; if((yi > y) !== (yj > y) && x < (xj - xi)*(y - yi)/(yj - yi) + xi) c = !c; }
    if(c) top = o.h; }
  return top;
}

// física em passos fixos de 1/60 s: o movimento segue o tempo real mesmo com poucos quadros por segundo
function physics(dt, M){
  // teclado ou sticks (estilo drone): stick esquerdo vira (x); stick direito acelera ↑ e freia/ré ↓ (y), proporcional
  const jl = DJ.l || {x:0, y:0}, jr = DJ.r || {x:0, y:0};
  const up = keys.has("up") || jr.y > .12, dn = keys.has("down") || jr.y < -.12, lf = keys.has("left"), rt = keys.has("right"), hb = keys.has("hand");
  const thr = keys.has("up") || keys.has("down") ? 1 : Math.min(1, Math.abs(jr.y) * 1.15);
  if(up) S.v += (S.v < 0 ? M.freio : M.acc) * dt * thr;
  else if(dn) S.v -= (S.v > 0 ? M.freio : M.acc*.6) * dt * thr;
  else S.v -= Math.sign(S.v) * Math.min(Math.abs(S.v), (M.pessoa ? 8 : 1.6)*dt);
  if(hb && !M.pessoa) S.v -= Math.sign(S.v) * Math.min(Math.abs(S.v), M.freio*1.4*dt);
  const vmax = M.pessoa && (keys.has("run") || jr.y > .9) ? M.run : M.vmax;   // pessoa: stick todo para frente = corre
  if(S.v > vmax) S.v = Math.max(vmax, S.v - M.freio*dt);   // ao soltar o "correr", desacelera em vez de parar
  S.v = Math.max(M.pessoa ? -1.6 : -9, S.v);
  if(M.pessoa){ if(keys.has("hand") && !(S.z > 0)){ S.vz = 4.6; keys.delete("hand"); }   // pulo ~1,1 m
    if(S.z > 0 || S.vz > 0){ S.vz -= 9.8*dt; S.z = Math.max(0, (S.z || 0) + S.vz*dt); if(S.z === 0) S.vz = 0; }
    S.step = (S.step || 0) + Math.abs(S.v)*dt*3.2; }
  const tgt = Math.max(-1, Math.min(1, (rt ? 1 : 0) - (lf ? 1 : 0) + jl.x)); S.steer += (tgt - S.steer) * Math.min(1, dt*(M.pessoa ? 12 : 7));
  const turn = M.pessoa ? S.steer * M.giro * 55 : S.steer * M.giro * 46 * Math.min(1, Math.abs(S.v)/4) / (1 + Math.abs(S.v)/30) * Math.sign(S.v || 1) * (hb ? 1.7 : 1);
  S.hdg = (S.hdg + turn*dt + 360) % 360;
  const d = S.v*dt, nlon = S.lon + Math.sin(S.hdg*D2R)*d/(111320*Math.cos(S.lat*D2R)), nlat = S.lat + Math.cos(S.hdg*D2R)*d/110574;
  // bateu num prédio: para (com um leve recuo) — não atravessa paredes
  const m = window.Sat?.map(), lift = (window.Bridges?.isOn() ? window.Bridges.topAt(nlon, nlat) : 0) + (S.z || 0);
  // só bloqueia ao ENTRAR num prédio: quem já está dentro (saiu de um terminal, garagem, contorno impreciso) pode sair
  if(m && Math.abs(d) > 0 && obstAt(m, nlon, nlat, lift) > lift + .5 && !(obstAt(m, S.lon, S.lat, lift) > lift + .5)){
    if(Math.abs(S.v) > 4 && performance.now() - (S.bate || 0) > 800){ S.bate = performance.now(); beep(140, 120); }
    S.v = -S.v*.15; return; }
  S.lon = nlon; S.lat = nlat; S.km += Math.abs(d)/1000;
}
// câmera por geometria (sem calculateCameraOptions..., que usa a elevação do centro atual e oscilava):
// câmera em (lon, lat) a A metros de altitude absoluta, olhando no rumo brg com inclinação pitch;
// o centro do mapa é onde esse raio toca o chão e o zoom sai da distância câmera→centro
function ground(m, lon, lat){ let g = 0; try{ g = m.queryTerrainElevation(new maplibregl.LngLat(lon, lat)) || 0; }catch(e){} return g; }
function aim(m, lon, lat, A, brg, pitch){
  pitch = Math.max(0, Math.min(85, pitch));
  const kx = 111320*Math.cos(lat*D2R), sb = Math.sin(brg*D2R), cb = Math.cos(brg*D2R), tn = Math.tan(pitch*D2R);
  let dz = Math.max(1, A - ground(m, lon, lat)), f = dz*tn;
  dz = Math.max(1, A - ground(m, lon + sb*f/kx, lat + cb*f/110574)); f = dz*tn;
  const ctc = m.transform?.cameraToCenterDistance || m.getCanvas().clientHeight*1.5;
  const zoom = Math.log2(ctc * 40075016.7*Math.cos(lat*D2R) / (Math.hypot(f, dz)*512));
  return isFinite(zoom) && cam(m, {center:[lon + sb*f/kx, lat + cb*f/110574], zoom:Math.min(24, zoom), bearing:brg, pitch, padding:{top:0, bottom:0, left:0, right:0}});
}
// câmera atrás: a d m do alvo (que está a a m do chão) e h m acima dele, mirando nele; nunca entra no morro
function behind(m, lon, lat, brg, d, h, a){
  // se o morro (ou a encosta) fica entre a câmera e o alvo, a câmera chega mais perto em vez de subir a encosta
  const kx = 111320*Math.cos(lat*D2R), sb = Math.sin(brg*D2R), cb = Math.cos(brg*D2R), T = ground(m, lon, lat) + a;
  let cl, ca, gc;
  for(let i = 0; i < 5; i++){ cl = lon - sb*d/kx; ca = lat - cb*d/110574; gc = ground(m, cl, ca); if(gc + 1.5 <= T + h || i === 4) break; d *= .7; h *= .85; }
  const A = Math.max(T + h, gc + 1.5);
  return aim(m, cl, ca, A, brg, Math.atan2(d, A - T)/D2R);
}
// câmera "estilo GTA": atrás e acima do veículo, seguindo com atraso de mola; afasta com a velocidade;
// arrastar gira em volta (volta para trás sozinha), rodinha aproxima/afasta
const RIG = {pessoa:{d:3.6, h:.55, look:1.45}, moto:{d:5.4, h:1.1, look:1.1}, carro:{d:7, h:1.5, look:1.1}, policia:{d:7, h:1.5, look:1.1}, caminhao:{d:13.5, h:2.6, look:2.4}, onibus:{d:14.5, h:2.6, look:2.4}};
function chase(m, dt){
  const M = V[S.tipo], r = RIG[S.tipo] || RIG.carro, k = S.zoomK || 1;
  S.dd = (S.dd || 0) + (Math.min(1, Math.abs(S.v)/M.vmax) - (S.dd || 0))*Math.min(1, dt*1.5);
  if(!S.drag) S.yaw *= Math.pow(.25, dt);
  const want = S.hdg + (S.yaw || 0);
  S.cb = S.cb == null ? want : (S.cb + ((((want - S.cb + 540) % 360) - 180)) * Math.min(1, dt*4.5) + 360) % 360;
  const lift = (window.Bridges?.isOn() ? window.Bridges.topAt(S.lon, S.lat) : 0) + (S.z || 0);
  behind(m, S.lon, S.lat, S.cb, (r.d + S.dd*r.d*.35)*k, (r.h + S.dd*.4)*k, lift + r.look);
}
// rótulos custam caro com a câmera rente ao chão: cada nome até o horizonte consulta o relevo a cada quadro
// (medido: 6 fps com todos, 35 sem nenhum). Câmeras baixas: sem nomes (como no GTA); câmeras aéreas: só ruas e bairros.
const LBL = ["n-house","n-roadname","n-poi","n-water","n-river","n-peak","n-air","n-place","route-lbl","rodov","nv-name"];
let lblSaved = null, lblMode = null, lblT = 0, lblUser = false;
function labels(m, mode){
  if(lblUser && mode) mode = "user";   // a pessoa ligou "Nomes" no painel de camadas: mostra todos (custa quadros por segundo)
  const now = performance.now(); if(mode === lblMode && now - lblT < 1000) return; lblT = now;
  if(mode && !lblSaved){ lblSaved = {}; LBL.forEach(id => { if(m.getLayer(id)) lblSaved[id] = m.getLayoutProperty(id, "visibility") || "visible"; }); }
  lblMode = mode;
  if(lblSaved) LBL.forEach(id => { if(!(id in lblSaved) && m.getLayer(id)) lblSaved[id] = m.getLayoutProperty(id, "visibility") || "visible"; });   // camadas criadas depois (estilo Rota)
  // no estilo Rota 3D os nomes são os dele (nv-name); os do Planeta Água ficam escondidos
  const look = document.body.classList.contains("nv-look"), own = id => !look || id === "nv-name" || !/^n-/.test(id);
  for(const id in (lblSaved || {})) if(m.getLayer(id)){
    const v = !own(id) ? "none" : !mode ? lblSaved[id] : mode === "user" ? (/^(n-(roadname|place|poi)|nv-name)$/.test(id) ? "visible" : lblSaved[id])
      : mode === "ruas" && /^(n-roadname|n-place|nv-name)$/.test(id) ? lblSaved[id] : "none";
    if((m.getLayoutProperty(id, "visibility") || "visible") !== v) m.setLayoutProperty(id, "visibility", v); }
  if(!mode) lblSaved = null;
}
/* ---------- painel de camadas (direção e drone): mapa base + camadas por cima ---------- */
function layersUI(){
  const old = $("dvLayers"); if(old){ old.remove(); return; }
  const S0 = window.Sat, m = S0?.map(); if(!m) return;
  const base = window.Rotas?.isLook?.() ? "rota" : S0.base?.() || "sat", el = document.createElement("section"); el.id = "dvLayers"; el.className = "dv-lyr glass";
  const B = [["rota","Rota 3D"],["sat","Satélite"],["map","Mapa"],["topo","Relevo"]];
  // o estilo Rota foi feito para a navegação (plano, zoom até 20); aqui o relevo e o zoom da câmera continuam
  const keep3d = () => [60, 1000].forEach(ms => setTimeout(() => { const mm = S0.map(); if(!mm || !(S || window.Drone?.active?.())) return;
    mm.setMaxZoom(24); document.body.classList.remove("nv-flat"); try{ if(!mm.getTerrain()) mm.setTerrain({source:"dem", exaggeration:1}); }catch(e){} lblT = 0; }, ms));
  const T = [["nomes","type","Nomes de ruas e lugares", () => lblUser, v => { lblUser = v; lblT = 0; }],
    ["bld","box3d","Prédios 3D", () => S0.isBld?.(), v => S0.setBld?.(v)],
    ["br","bridge","Viadutos, pontes e vias elevadas 3D", () => window.Bridges?.isOn?.(), v => window.Bridges?.setOn?.(v)],
    ["tt","traffic","Trânsito ao vivo", () => window.Rotas?.isTraffic?.(), v => window.Rotas?.setTraffic?.(v)]];
  el.innerHTML = `<header><b>${ico("layers", 18)} Camadas do mapa</b><button class="dn-ib" id="dvLyX" aria-label="Fechar">${ico("x", 16)}</button></header>
    <h4>Mapa base</h4><div class="dv-lyb">${B.map(([k, n]) => `<button data-lb="${k}" aria-pressed="${k === base}">${k === "rota" ? `<i class="rb-rota"></i>` : `<img src="${S0.thumb?.(k) || ""}" alt="" loading="lazy">`}<span>${n}</span></button>`).join("")}</div>
    <h4>Por cima</h4><div class="dv-lyt">${T.map(([k, ic, n, get]) => `<button data-lt="${k}" aria-pressed="${!!get()}">${ico(ic, 18)}<span>${n}</span><i></i></button>`).join("")}</div>
    <small class="dv-lyh">Nomes com a câmera rente ao chão deixam o mapa mais lento.</small>`;
  document.body.appendChild(el);
  $("dvLyX").onclick = () => el.remove();
  el.querySelectorAll("[data-lb]").forEach(b => b.onclick = () => { const k = b.dataset.lb, R = window.Rotas;
    if(k === "rota"){ if(!S0.isClear?.()) S0.setProd?.("earth"); R?.setLook?.(true); }
    else { if(R?.isLook?.()) R.setLook(false); S0.setBase?.(k); if(k === "sat" && !S0.isClear?.()) S0.setProd?.("earth"); }
    keep3d();
    el.querySelectorAll("[data-lb]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
  el.querySelectorAll("[data-lt]").forEach(b => b.onclick = () => { const r = T.find(x => x[0] === b.dataset.lt), v = !r[3](); r[4](v); b.setAttribute("aria-pressed", v); });
}
function ring(m, lon, lat, r, c){ m.getSource("drv-ring")?.setData(fc(lon == null ? [] : [{type:"Feature", properties:{r, c}, geometry:{type:"Point", coordinates:[lon, lat]}}])); }
function loop(now){
  if(!S) return; raf = requestAnimationFrame(loop);
  let dt = Math.min(.25, (now - S.t)/1000); S.t = now; const M = V[S.tipo];
  for(let n = 0; dt > 1e-4 && n < 15; n++){ const h = Math.min(1/60, dt); physics(h, M); dt -= h; }
  const m = window.Sat.map(); labels(m, S.cam === 1 ? "ruas" : "off"); m.getSource("drv")?.setData(model()); ring(m, S.lon, S.lat, M.pessoa ? 1.4 : {moto:2, caminhao:7, onibus:7.5}[S.tipo] || 3.6, M.sirene && S.sir ? (Math.floor(now/450) % 2 ? "#FF3B30" : "#2D6BFF") : "#FF9500");
  if(S.cam === 2){
    // primeira pessoa: câmera na altura dos olhos (pessoa 1,65 m) ou do motorista, olhando para a frente
    const eye = {pessoa:1.65, moto:1.7, carro:1.25, policia:1.25, caminhao:2.6, onibus:2.4}[S.tipo] || 1.3;
    const lift = (window.Bridges?.isOn() ? window.Bridges.topAt(S.lon, S.lat) : 0) + (S.z || 0), fwd = M.pessoa ? .3 : 1.2;
    const lon = S.lon + Math.sin(S.hdg*D2R)*fwd/(111320*Math.cos(S.lat*D2R)), lat = S.lat + Math.cos(S.hdg*D2R)*fwd/110574;
    if(!S.drag) S.yaw = (S.yaw || 0) * .9;
    aim(m, lon, lat, ground(m, S.lon, S.lat) + lift + eye, (S.hdg + (S.yaw || 0) + 360) % 360, 84);
  } else if(S.cam === 0) chase(m, Math.min(.1, (now - (S.tc || now))/1000 || 1/60));
  else { const b = m.getBearing() + ((((S.hdg - m.getBearing() + 540) % 360) - 180)) * .1;
    cam(m, {center:[S.lon, S.lat], bearing:b, pitch:50, zoom:M.pessoa ? 19 : 17.6, padding:{top:Math.round(innerHeight*.3), bottom:0, left:0, right:0}}); }
  S.tc = now;
  if(S.dest && S.rt && $("dvNav")){ const d = hav([S.lon, S.lat], [S.dest.lon, S.dest.lat]), br = (Math.atan2((S.dest.lon - S.lon)*Math.cos(S.lat*D2R), S.dest.lat - S.lat)/D2R + 360) % 360;
    $("dvNav").hidden = false; $("dvNavD").textContent = fmtD(d); $("dvNavA").style.transform = `rotate(${br - m.getBearing()}deg)`;
    if(d < 30 && !S.done){ S.done = true; arrive(); } }
  const kmh = Math.round(Math.abs(S.v)*3.6), sp = $("dvSpd"); if(sp){ sp.textContent = kmh; $("dvKm").textContent = `${S.km.toFixed(2).replace(".", ",")} km`; $("dvMx").style.width = `${Math.min(100, Math.abs(S.v)/(M.run || M.vmax)*100)}%`; }
  if(S.sir && Math.floor(now/450) !== S.sirT){ S.sirT = Math.floor(now/450); beep(S.sirT % 2 ? 960 : 720, 400); }
}
// arrastar no mapa gira a câmera em volta do veículo; rodinha aproxima/afasta
function orbitInput(m){
  if(m.__dvOrbit) return; m.__dvOrbit = true; const cv = m.getCanvasContainer(); let x0 = null;
  cv.addEventListener("pointerdown", e => { if(!S) return; x0 = e.clientX; S.drag = true; S.yaw = S.yaw || 0; });
  addEventListener("pointermove", e => { if(!S || x0 == null) return; S.yaw = Math.max(-180, Math.min(180, S.yaw + (e.clientX - x0)*.4)); x0 = e.clientX; });
  addEventListener("pointerup", () => { x0 = null; if(S) S.drag = false; });
  cv.addEventListener("wheel", e => { if(!S) return; e.preventDefault(); S.zoomK = Math.max(.5, Math.min(2.5, (S.zoomK || 1) * (e.deltaY > 0 ? 1.1 : .9))); }, {passive:false});
}
function hud(){
  $("dvHud")?.remove(); const M = V[S.tipo], h = document.createElement("section"); h.id = "dvHud"; h.className = "dv";
  h.innerHTML = `<div class="dv-top glass"><b>${M.nome}</b><small>${S.cidade} · ${M.pessoa ? "a pé" : "modo livre"} · C troca a câmera</small><button class="dv-x" id="dvX" aria-label="Sair">${ico("x", 18)}</button></div>
    <div class="dv-nav glass" id="dvNav" hidden><i id="dvNavA">${ico("up", 28)}</i><div><b id="dvNavD"></b><small>${S.dest ? C.esc(S.dest.nome) : ""}</small></div></div>
    <div class="dv-spd glass"><b id="dvSpd">0</b><small>km/h</small><i><u id="dvMx"></u></i><small id="dvKm">0 km</small></div>
    <div class="dv-act"><button class="dv-b glass" id="dvLy" title="Camadas do mapa">${ico("layers", 20)}</button><button class="dv-b glass" id="dvHelp" title="Comandos: teclado, mouse e celular (K)">${ico("gamepad", 20)}</button><button class="dv-b glass" id="dvCam" title="Câmera (C)">${ico("video", 20)}</button><button class="dv-b glass" id="dvHorn" title="${M.sirene ? "Sirene" : "Buzina"} (H)">${ico(M.sirene ? "alert" : "vol", 20)}</button></div>
    <div class="dv-pads dv-sticks"><div class="dv-jl" id="dvJL" aria-label="Stick esquerdo: vira"></div>
      <div class="dv-ped">${M.pessoa ? `<button class="dv-p glass" data-k="hand" aria-label="Pular">${ico("chevu", 24)}</button><button class="dv-p glass" data-k="run" aria-label="Correr">${ico("ff", 20)}</button>`
        : `<button class="dv-p glass dv-brk" data-k="hand" aria-label="Freio de mão">${ico("stop", 20)}</button>`}</div>
      <div class="dv-jr" id="dvJR" aria-label="Stick direito: acelera e freia"></div></div>`;
  const ac = M.pessoa ? ["anda", "para / anda de ré", "pula"] : ["acelera", "freia / ré", "freio de mão"];
  h.insertAdjacentHTML("beforeend", `<div class="dn-help glass" id="dvHelpP" hidden>
    <header><b>${ico("gamepad", 20)} Comandos · ${M.nome}</b><button class="dn-ib" id="dvHelpX" aria-label="Fechar">${ico("x", 18)}</button></header>
    <div class="dn-hcols">
      <section><h4>Teclado</h4><dl><dt>↑ / W</dt><dd>${ac[0]}</dd><dt>↓ / S</dt><dd>${ac[1]}</dd><dt>← → / A D</dt><dd>vira</dd><dt>Espaço</dt><dd>${ac[2]}</dd>
        ${M.pessoa ? "<dt>Shift (segurar)</dt><dd>corre</dd>" : ""}<dt>H</dt><dd>${M.sirene ? "sirene liga/desliga" : "buzina"}</dd><dt>C</dt><dd>câmera: atrás (GTA), alta, primeira pessoa</dd><dt>K</dt><dd>esta ajuda</dd><dt>Esc</dt><dd>sair</dd></dl></section>
      <section><h4>Mouse / trackpad</h4><dl><dt>Arrastar no mapa</dt><dd>gira a câmera em volta (volta para trás sozinha)</dd><dt>Rodinha</dt><dd>aproxima / afasta a câmera</dd><dt>Botões da tela</dt><dd>câmera, ${M.sirene ? "sirene" : "buzina"} e sair</dd></dl></section>
      <section><h4>Celular / tablet</h4><dl><dt>Stick esquerdo</dt><dd>← → vira</dd><dt>Stick direito</dt><dd>↑ ${ac[0]} (quanto mais, mais rápido${M.pessoa ? "; todo para frente corre" : ""}) · ↓ ${ac[1]}</dd>${M.pessoa ? "<dt>⌃ / ⏩</dt><dd>pula / corre</dd>" : "<dt>■ (vermelho)</dt><dd>freio de mão</dd>"}<dt>Arrastar no mapa</dt><dd>gira a câmera</dd></dl></section></div></div>`);
  document.body.appendChild(h);
  DJ = window.Joy ? {l:window.Joy.make($("dvJL"), "vira"), r:window.Joy.make($("dvJR"), M.pessoa ? "anda" : "acelera")} : {};
  $("dvLy").onclick = layersUI;
  $("dvX").onclick = stop; $("dvHelp").onclick = $("dvHelpX").onclick = () => { $("dvHelpP").hidden = !$("dvHelpP").hidden; }; $("dvCam").onclick = () => { S.cam = (S.cam + 1) % 3; };
  $("dvHorn").onclick = () => { if(V[S.tipo].sirene) S.sir = !S.sir; else beep(420, 350); };
  h.querySelectorAll("[data-k]").forEach(b => { const k = b.dataset.k;
    const dn = e => { e.preventDefault(); keys.add(k); b.classList.add("on"); }, up = () => { keys.delete(k); b.classList.remove("on"); };
    b.addEventListener("pointerdown", dn); ["pointerup","pointerleave","pointercancel"].forEach(ev => b.addEventListener(ev, up)); });
}
const KM = {Shift:"run", ArrowUp:"up", w:"up", W:"up", ArrowDown:"down", s:"down", S:"down", ArrowLeft:"left", a:"left", A:"left", ArrowRight:"right", d:"right", D:"right", " ":"hand"};
addEventListener("keydown", e => { if(!S || e.target?.closest?.("input,textarea")) return;
  if(e.key === "Escape"){ stop(); return; } if(e.key === "c" || e.key === "C"){ S.cam = (S.cam + 1) % 3; return; }
  if(e.key === "h" || e.key === "H"){ $("dvHorn")?.click(); return; }
  if(e.key === "k" || e.key === "K" || e.key === "?"){ $("dvHelp")?.click(); return; }
  const k = KM[e.key]; if(k){ e.preventDefault(); keys.add(k); } }, true);
addEventListener("keyup", e => { const k = KM[e.key]; if(k) keys.delete(k); }, true);
addEventListener("hashchange", () => { if(S && document.body.dataset.view !== "sat") stop(); });
window.Drive = {setOn, obstAt, tour: () => window.Drone?.pick(), aim, labels, layersUI, behind, ground, ring, layers, cam, beep, dbg: () => S, isOn: () => on, choose, start: (tipo, cidade, dest) => rods().then(L => { const p = L.find(x => x.cidade === cidade) || L[0]; return start(tipo, p, dest); }), stop, active: () => !!S};
})();
