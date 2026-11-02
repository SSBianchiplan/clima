/* =============================================================================
   ROTAS E TRÂNSITO — no estilo dos apps de navegação, só com serviços gratuitos.
   · Carro: TomTom (trânsito ao vivo, rotas alternativas, atraso em minutos). A chave
     fica no servidor: o site chama /tt/… e o Caddy repassa à TomTom com a chave.
   · Bicicleta e a pé (e carro, se a cota diária da TomTom acabar): Valhalla da
     FOSSGIS (OpenStreetMap), sem chave.
   · Navegação: GPS do aparelho, próxima manobra com distância, voz em português,
     recálculo ao sair da rota e tela sempre acesa. Sem GPS, "Simular" percorre a rota.
   · Camada de trânsito: fluxo e incidentes da TomTom, atualizados a cada 2 min.
   ============================================================================= */
(() => {
"use strict";
const C = window.ClimaCore;
const {esc} = C;
const $ = id => document.getElementById(id);
const store = {
  get(k,d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const VALHALLA = "https://valhalla1.openstreetmap.de/route";
const TT = location.origin + "/tt";
const D2R = Math.PI/180;
const hav = (a, b) => { const R = 6371000, dLa = (b[1]-a[1])*D2R, dLo = (b[0]-a[0])*D2R;
  return 2*R*Math.asin(Math.sqrt(Math.sin(dLa/2)**2 + Math.cos(a[1]*D2R)*Math.cos(b[1]*D2R)*Math.sin(dLo/2)**2)); };
const brg = (a, b) => { const y = Math.sin((b[0]-a[0])*D2R)*Math.cos(b[1]*D2R), x = Math.cos(a[1]*D2R)*Math.sin(b[1]*D2R) - Math.sin(a[1]*D2R)*Math.cos(b[1]*D2R)*Math.cos((b[0]-a[0])*D2R);
  return (Math.atan2(y, x)/D2R + 360) % 360; };
const fmtD = m => m < 1000 ? `${Math.round(m/10)*10} m` : `${(m/1000).toLocaleString("pt-BR", {maximumFractionDigits: m < 10000 ? 1 : 0})} km`;
const fmtT = s => { const m = Math.round(s/60); return m < 60 ? `${Math.max(1, m)} min` : `${Math.floor(m/60)} h ${String(m%60).padStart(2,"0")}`; };
const hora = t => new Date(t).toLocaleTimeString("pt-BR", {hour:"2-digit", minute:"2-digit"});
const MODES = {car:{ic:"🚗", nome:"Carro", v:"auto"}, bike:{ic:"🚲", nome:"Bicicleta", v:"bicycle"}, walk:{ic:"🚶", nome:"A pé", v:"pedestrian"}};

const R = {mode: store.get("rt-mode", "car"), a:null, b:null, stops:[], routes:[], sel:0, nav:null, voice: store.get("rt-voice", true), traffic: store.get("rt-traffic", false)};

/* ---------- serviços ---------- */
// polilinha do Valhalla (precisão 6) → [[lon,lat]…]
function decode6(s){
  const out = []; let i = 0, lat = 0, lon = 0;
  while(i < s.length){
    for(const k of [0,1]){ let r = 0, sh = 0, b; do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while(b >= 32);
      const d = r & 1 ? ~(r >> 1) : r >> 1; if(k === 0) lat += d; else lon += d; }
    out.push([lon/1e6, lat/1e6]); }
  return out;
}
// tipo de manobra normalizado (TomTom e Valhalla) → ícone e faixas
const TT_MAN = {TURN_LEFT:"left", TURN_RIGHT:"right", BEAR_LEFT:"sleft", BEAR_RIGHT:"sright", SHARP_LEFT:"hleft", SHARP_RIGHT:"hright", KEEP_LEFT:"kleft", KEEP_RIGHT:"kright",
  MAKE_UTURN:"uturn", TRY_MAKE_UTURN:"uturn", ROUNDABOUT_LEFT:"round", ROUNDABOUT_RIGHT:"round", ROUNDABOUT_CROSS:"round", ROUNDABOUT_BACK:"round", ARRIVE:"arrive", ARRIVE_LEFT:"arrive", ARRIVE_RIGHT:"arrive",
  WAYPOINT_REACHED:"arrive", WAYPOINT_LEFT:"arrive", WAYPOINT_RIGHT:"arrive", DEPART:"straight", STRAIGHT:"straight", ENTER_MOTORWAY:"kright", ENTER_FREEWAY:"kright", ENTER_HIGHWAY:"kright", TAKE_EXIT:"kright", MOTORWAY_EXIT_LEFT:"kleft", MOTORWAY_EXIT_RIGHT:"kright", SWITCH_MOTORWAY_LEFT:"kleft", SWITCH_MOTORWAY_RIGHT:"kright", FOLLOW:"straight"};
const VH_MAN = {1:"straight",2:"straight",3:"straight",4:"arrive",5:"arrive",6:"arrive",7:"straight",8:"straight",9:"sright",10:"right",11:"hright",12:"uturn",13:"uturn",14:"hleft",15:"left",16:"sleft",17:"straight",18:"kright",19:"kleft",20:"kright",21:"kleft",22:"straight",23:"kright",24:"kleft",25:"straight",26:"round",27:"round"};
const ll = p => `${p.lat},${p.lon}`;
async function viaTomTom(pts){
  const q = new URLSearchParams({traffic:"true", maxAlternatives: pts.length > 2 ? "0" : "2", instructionsType:"text", language:"pt-BR", routeRepresentation:"polyline", computeTravelTimeFor:"all"});
  for(const st of ["traffic","lanes","speedLimit"]) q.append("sectionType", st);
  const r = await fetch(`${TT}/routing/1/calculateRoute/${pts.map(ll).join(":")}/json?${q}`);
  if(!r.ok) throw new Error(`TomTom ${r.status}`);
  const j = await r.json();
  return (j.routes || []).map(rt => {
    const coords = rt.legs.flatMap(l => l.points.map(p => [p.longitude, p.latitude])), s = rt.summary, sec = rt.sections || [];
    const steps = (rt.guidance?.instructions || []).map(g => ({txt:g.message, at:g.pointIndex ?? 0, man:TT_MAN[g.maneuver] || "straight", street:g.street || "", num:(g.roadNumbers || [])[0] || ""}));
    const jams = sec.filter(x => x.sectionType === "TRAFFIC").map(x => ({from:x.startPointIndex, to:x.endPointIndex, mag:x.magnitudeOfDelay ?? 1, cat:x.simpleCategory}));
    const lanes = sec.filter(x => x.sectionType === "LANES").map(x => ({from:x.startPointIndex, to:x.endPointIndex, lanes:x.lanes || []}));
    const limits = sec.filter(x => x.sectionType === "SPEED_LIMIT").map(x => ({from:x.startPointIndex, to:x.endPointIndex, kmh:x.maxSpeedLimitInKmh}));
    return {coords, dist:s.lengthInMeters, time:s.travelTimeInSeconds, delay:s.trafficDelayInSeconds || 0, free:s.noTrafficTravelTimeInSeconds, steps, jams, lanes, limits, src:"TomTom · trânsito ao vivo"};
  });
}
async function viaValhalla(pts, costing){
  const body = {locations:pts.map(p => ({lat:p.lat, lon:p.lon})), costing, alternates: pts.length > 2 ? 0 : 2, language:"pt-BR", directions_options:{language:"pt-BR", units:"kilometers"}};
  const r = await fetch(VALHALLA, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
  const j = await r.json(); if(!r.ok || !j.trip) throw new Error(j.error || `Valhalla ${r.status}`);
  return [j, ...(j.alternates || [])].map(x => { let coords = [], steps = [];
    for(const leg of x.trip.legs){ const off = coords.length, sh = decode6(leg.shape); coords = coords.concat(sh);
      for(const m of leg.maneuvers) steps.push({txt:m.instruction, at:off + m.begin_shape_index, man:VH_MAN[m.type] || "straight", street:(m.street_names || [])[0] || "", num:""}); }
    return {coords, dist:x.trip.summary.length*1000, time:x.trip.summary.time, delay:0, steps, jams:[], lanes:[], limits:[], src:"Valhalla · OpenStreetMap"}; });
}
const pts = (from = R.a) => [from, ...(R.stops || []), R.b];
async function calc(){
  if(!R.a || !R.b){ return; }
  const out = $("rtRes"); if(out) out.innerHTML = `<p class="rt-wait">Calculando rotas…</p>`;
  let rs = [], err = "";
  try{
    if(R.mode === "car"){ try{ rs = await viaTomTom(pts()); }catch(e){ err = "TomTom indisponível (cota ou rede) — rota sem trânsito. "; } }
    if(!rs.length) rs = await viaValhalla(pts(), MODES[R.mode].v);
  }catch(e){ if(out) out.innerHTML = `<p class="rt-err">Não foi possível calcular a rota: ${esc(e.message)}</p>`; return; }
  rs.forEach(prep);
  R.routes = rs; R.sel = 0; R.note = err;
  draw(); fit(); list();
}
function prep(r){ let acc = 0; r.cum = r.coords.map((c, i) => i ? (acc += hav(r.coords[i-1], c)) : 0); }

/* ---------- mapa ---------- */
const fc = f => ({type:"FeatureCollection", features:f});
const line = (coords, props) => ({type:"Feature", properties:props, geometry:{type:"LineString", coordinates:coords}});
/* ---------- carrinho 3D: volumes extrudados (carroceria, cabine, vidros, rodas, faróis), girando com o rumo ----------
   Cada peça: [trás, frente, meia-largura (ou [x0,x1] para peças laterais), base, topo, tipo] em metros, eixo y para a frente.
   Tipos: c = cor escolhida, g = vidro, d = pneu/plástico escuro, l = farol, r = lanterna. */
const CAR_MODELS = {
  sedan:{nome:"Sedã", p:[[-2.3,2.3,.9,.28,.95,"c"],[-1.25,.95,.8,.95,1.4,"g"],[-1.05,.65,.76,1.4,1.47,"c"],[2.2,2.32,[-.85,-.45],.6,.78,"l"],[2.2,2.32,[.45,.85],.6,.78,"l"],[-2.34,-2.25,[-.85,-.45],.62,.8,"r"],[-2.34,-2.25,[.45,.85],.62,.8,"r"],
    [1.05,1.75,[-.98,-.78],0,.62,"d"],[1.05,1.75,[.78,.98],0,.62,"d"],[-1.75,-1.05,[-.98,-.78],0,.62,"d"],[-1.75,-1.05,[.78,.98],0,.62,"d"]]},
  suv:{nome:"SUV", p:[[-2.4,2.4,.97,.35,1.15,"c"],[-2.15,1.05,.88,1.15,1.75,"g"],[-2.0,.8,.85,1.75,1.85,"c"],[2.3,2.42,[-.9,-.5],.75,.95,"l"],[2.3,2.42,[.5,.9],.75,.95,"l"],[-2.44,-2.35,[-.92,-.55],.8,1.05,"r"],[-2.44,-2.35,[.55,.92],.8,1.05,"r"],
    [1.1,1.9,[-1.06,-.84],0,.75,"d"],[1.1,1.9,[.84,1.06],0,.75,"d"],[-1.9,-1.1,[-1.06,-.84],0,.75,"d"],[-1.9,-1.1,[.84,1.06],0,.75,"d"]]},
  sport:{nome:"Esportivo", p:[[-2.25,.6,.97,.22,.82,"c"],[.6,2.25,.95,.22,.66,"c"],[-1.15,.55,.78,.82,1.18,"g"],[-.95,.3,.72,1.18,1.22,"c"],[-2.3,-2.05,.92,.95,1.05,"c"],[2.15,2.27,[-.9,-.5],.45,.58,"l"],[2.15,2.27,[.5,.9],.45,.58,"l"],[-2.3,-2.22,[-.92,-.45],.55,.72,"r"],[-2.3,-2.22,[.45,.92],.55,.72,"r"],
    [1.05,1.75,[-1.05,-.82],0,.6,"d"],[1.05,1.75,[.82,1.05],0,.6,"d"],[-1.8,-1.05,[-1.07,-.82],0,.62,"d"],[-1.8,-1.05,[.82,1.07],0,.62,"d"]]},
  pickup:{nome:"Picape", p:[[-2.65,2.65,.98,.4,1.05,"c"],[.05,1.55,.9,1.05,1.75,"g"],[.2,1.35,.86,1.75,1.85,"c"],[-2.6,-.05,[-.98,-.86],1.05,1.4,"c"],[-2.6,-.05,[.86,.98],1.05,1.4,"c"],[-2.7,-2.58,.98,1.05,1.4,"c"],
    [2.55,2.67,[-.9,-.5],.7,.9,"l"],[2.55,2.67,[.5,.9],.7,.9,"l"],[-2.74,-2.66,[-.95,-.6],.7,1.0,"r"],[-2.74,-2.66,[.6,.95],.7,1.0,"r"],
    [1.3,2.1,[-1.07,-.85],0,.78,"d"],[1.3,2.1,[.85,1.07],0,.78,"d"],[-2.0,-1.2,[-1.07,-.85],0,.78,"d"],[-2.0,-1.2,[.85,1.07],0,.78,"d"]]}
};
const CAR_COLORS = [["Branco","#F2F4F7"],["Prata","#A9B1BC"],["Preto","#22262D"],["Vermelho","#D7263D"],["Azul","#1F6FEB"],["Amarelo","#F5C518"],["Verde","#2E9E5B"]];
R.carModel = store.get("rt-car-model", "sedan"); R.carColor = store.get("rt-car-color", "#F2F4F7");
const PART_COLOR = {g:"#1C2633", d:"#121417", l:"#FFF4B8", r:"#E5242B"};
function car3d(pos, hdg, zoom){
  const M = CAR_MODELS[R.carModel] || CAR_MODELS.sedan, s = Math.max(1.6, Math.min(60, 8 * 2 ** (17 - zoom)));   // escala exagerada para ser visível
  const h = hdg * D2R, ch = Math.cos(h), sh = Math.sin(h), mx = 1 / (111320 * Math.cos(pos[1] * D2R)), my = 1 / 110574;
  // em ponte/viaduto/elevado o carro roda em cima da pista 3D (altura do tabuleiro naquele ponto)
  const lift = window.Bridges?.isOn() ? window.Bridges.topAt(pos[0], pos[1]) + .1 : 0;
  const P = (x, y) => [pos[0] + (x * ch + y * sh) * s * mx, pos[1] + (-x * sh + y * ch) * s * my];
  return fc(M.p.map(([y0, y1, w, b, t, k]) => { const [x0, x1] = Array.isArray(w) ? w : [-w, w];
    return {type:"Feature", properties:{b:b * s + lift, t:t * s + lift, col:k === "c" ? R.carColor : PART_COLOR[k]}, geometry:{type:"Polygon", coordinates:[[P(x0,y0), P(x1,y0), P(x1,y1), P(x0,y1), P(x0,y0)]]}}; }));
}
// trechos da rota sobre pontes/viadutos: fita 3D na altura do tabuleiro (a linha plana ficaria escondida embaixo)
let ribKey = "";
// rota sobre pontes/viadutos: desenhada colada na pista 3D (malha contínua de bridges3d.js)
function ribbon(m, r){
  if(!window.Bridges) return;
  const k = r ? `${r.coords.length}|${r.dist}|${snapKey}` : ""; if(k === ribKey) return; ribKey = k;
  window.Bridges.setOverlay("route", r ? [{coords:r.disp || r.coords, color:"#4FC3F7", w:2.3, off:0}] : []);
}
const use3d = () => !!R.nav && R.mode === "car";
function drawCar(){
  const m = window.Sat?.map(), src = m?.getSource("rt-car3d"); if(!src) return;
  if(use3d() && R.nav.pos) src.setData(car3d(R.nav.dpos || R.nav.pos, R.nav.hdg || 0, m.getZoom())); else src.setData(fc([]));
  if(m.getLayer("rt-car")) m.setLayoutProperty("rt-car", "visibility", use3d() ? "none" : "visible");
}
// silhueta do modelo vista de cima (botões de escolha)
const carSvg = (k, col) => { const M = CAR_MODELS[k]; const sx = 9, sy = 6.5;
  return `<svg viewBox="-16 -20 32 40" width="26" height="32" aria-hidden="true">${M.p.filter(p => p[5] !== "l" && p[5] !== "r").map(([y0,y1,w,,,t]) => { const [x0,x1] = Array.isArray(w) ? w : [-w,w];
    return `<rect x="${x0*sx}" y="${-y1*sy}" width="${(x1-x0)*sx}" height="${(y1-y0)*sy}" rx="2" fill="${t === "c" ? col : PART_COLOR[t]}" stroke="rgba(0,0,0,.25)" stroke-width=".6"/>`; }).join("")}</svg>`; };
const carRow = () => `<div class="rt-car"><div class="rt-car-m" role="group" aria-label="Modelo do carro">${Object.keys(CAR_MODELS).map(k => `<button data-cm="${k}" aria-pressed="${k === R.carModel}" title="${CAR_MODELS[k].nome}">${carSvg(k, R.carColor)}<span>${CAR_MODELS[k].nome}</span></button>`).join("")}</div>
  <div class="rt-car-c" role="group" aria-label="Cor do carro">${CAR_COLORS.map(([n, c]) => `<button data-cc2="${c}" aria-pressed="${c.toLowerCase() === R.carColor.toLowerCase()}" title="${n}" style="--c:${c}"></button>`).join("")}<label class="rt-car-x" title="Outra cor"><input type="color" data-cc3 value="${R.carColor}"><span>+</span></label></div></div>`;
function bindCar(root){
  const upd = () => { root.querySelectorAll(".rt-car").forEach(el => el.outerHTML = carRow()); bindCar(root); drawCar(); const cb = $("rtCar"); if(cb) cb.innerHTML = carSvg(R.carModel, R.carColor); };
  root.querySelectorAll("[data-cm]").forEach(b => b.onclick = () => { R.carModel = b.dataset.cm; store.set("rt-car-model", R.carModel); upd(); });
  root.querySelectorAll("[data-cc2]").forEach(b => b.onclick = () => { R.carColor = b.dataset.cc2; store.set("rt-car-color", R.carColor); upd(); });
  root.querySelectorAll("[data-cc3]").forEach(i => i.onchange = () => { R.carColor = i.value; store.set("rt-car-color", R.carColor); upd(); });
}
// carro (visto de cima, apontando para cima), pino de destino e ponta da seta de manobra
function navIcons(m){
  const mk = (id, w, h, fn) => { if(m.hasImage(id)) return; const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const g = cv.getContext("2d"); fn(g); m.addImage(id, g.getImageData(0, 0, w, h), {pixelRatio:2}); };
  mk("nv-car", 96, 140, g => {
    const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };
    g.fillStyle = "rgba(90,200,250,.35)"; g.beginPath(); g.ellipse(48, 74, 44, 62, 0, 0, 7); g.fill();          // brilho no chão
    g.fillStyle = "rgba(0,0,0,.35)"; rr(22, 22, 52, 104, 22); g.fill();                                           // sombra
    const body = g.createLinearGradient(20, 0, 76, 0); body.addColorStop(0, "#DDE3EA"); body.addColorStop(.5, "#FFFFFF"); body.addColorStop(1, "#D4DAE2");
    g.fillStyle = body; rr(20, 16, 56, 106, 22); g.fill(); g.strokeStyle = "rgba(0,0,0,.18)"; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = "#26364A"; rr(27, 40, 42, 20, 7); g.fill();                                                      // para-brisa
    g.fillStyle = "#33465E"; rr(28, 66, 40, 34, 8); g.fill();                                                      // teto
    g.fillStyle = "#26364A"; rr(29, 102, 38, 10, 4); g.fill();                                                     // vidro traseiro
    g.fillStyle = "#FFF6C2"; rr(25, 18, 12, 6, 3); g.fill(); rr(59, 18, 12, 6, 3); g.fill();                       // faróis
    g.fillStyle = "#FF3B30"; rr(25, 116, 12, 5, 2); g.fill(); rr(59, 116, 12, 5, 2); g.fill();                     // lanternas
  });
  mk("nv-pin", 72, 96, g => {
    g.fillStyle = "rgba(0,0,0,.3)"; g.beginPath(); g.ellipse(36, 90, 12, 4, 0, 0, 7); g.fill();
    g.fillStyle = "#EA4335"; g.beginPath(); g.moveTo(36, 88); g.bezierCurveTo(20, 66, 8, 52, 8, 34); g.arc(36, 34, 28, Math.PI, 0); g.bezierCurveTo(64, 52, 52, 66, 36, 88); g.fill();
    g.strokeStyle = "rgba(0,0,0,.2)"; g.lineWidth = 2; g.stroke();
    g.fillStyle = "#7A1712"; g.beginPath(); g.arc(36, 34, 10, 0, 7); g.fill();
  });
  mk("nv-head", 64, 64, g => {
    g.fillStyle = "rgba(10,30,60,.55)"; g.beginPath(); g.moveTo(32, 2); g.lineTo(62, 50); g.lineTo(2, 50); g.closePath(); g.fill();
    g.fillStyle = "#fff"; g.beginPath(); g.moveTo(32, 9); g.lineTo(55, 46); g.lineTo(9, 46); g.closePath(); g.fill();
  });
}
function ensure(){
  const m = window.Sat?.map(); if(!m || !m.isStyleLoaded()) return null;
  if(m.getSource("rt")) return m;
  m.addSource("rt", {type:"geojson", data:fc([])}); m.addSource("rt-pt", {type:"geojson", data:fc([])});
  navIcons(m);
  m.addLayer({id:"rt-glow", type:"line", source:"rt", filter:["==",["get","k"],"sel"], layout:{"line-cap":"round","line-join":"round", visibility:"none"}, paint:{"line-color":"rgba(90,200,250,.45)", "line-width":26, "line-blur":10}});
  m.addLayer({id:"rt-alt", type:"line", source:"rt", filter:["==",["get","k"],"alt"], layout:{"line-cap":"round","line-join":"round"}, paint:{"line-color":"#8E9BB0", "line-width":7, "line-opacity":.85}});
  m.addLayer({id:"rt-case", type:"line", source:"rt", filter:["==",["get","k"],"sel"], layout:{"line-cap":"round","line-join":"round"}, paint:{"line-color":"#0A3D91", "line-width":11}});
  m.addLayer({id:"rt-sel", type:"line", source:"rt", filter:["==",["get","k"],"sel"], layout:{"line-cap":"round","line-join":"round"}, paint:{"line-color":"#2F80FF", "line-width":7}});
  m.addLayer({id:"rt-jam", type:"line", source:"rt", filter:["==",["get","k"],"jam"], layout:{"line-cap":"round","line-join":"round"},
    paint:{"line-color":["step",["get","mag"],"#FFD60A",2,"#FF9F0A",3,"#FF3B30"], "line-width":7}});
  m.addLayer({id:"rt-done", type:"line", source:"rt", filter:["==",["get","k"],"done"], layout:{"line-cap":"round"}, paint:{"line-color":"#7D8696", "line-width":7}});
  m.addLayer({id:"rt-man-case", type:"line", source:"rt", filter:["==",["get","k"],"man"], layout:{"line-cap":"round","line-join":"round"}, paint:{"line-color":"rgba(10,30,60,.55)", "line-width":13}});
  m.addLayer({id:"rt-man", type:"line", source:"rt", filter:["==",["get","k"],"man"], layout:{"line-cap":"round","line-join":"round"}, paint:{"line-color":"#fff", "line-width":8}});
  m.addLayer({id:"rt-manh", type:"symbol", source:"rt", filter:["==",["get","k"],"manh"], layout:{"icon-image":"nv-head", "icon-size":.62, "icon-rotate":["get","h"], "icon-rotation-alignment":"map", "icon-pitch-alignment":"map", "icon-allow-overlap":true, "icon-ignore-placement":true}});
  m.addLayer({id:"rt-pts", type:"circle", source:"rt-pt", filter:["all",["!=",["get","k"],"me"],["!=",["get","k"],"b"]], paint:{"circle-radius":7, "circle-color":["match",["get","k"],"a","#34C759","s","#FF9F0A","#fff"],
    "circle-stroke-color":"#fff", "circle-stroke-width":3}});
  m.addLayer({id:"rt-pin", type:"symbol", source:"rt-pt", filter:["==",["get","k"],"b"], layout:{"icon-image":"nv-pin", "icon-size":.62, "icon-anchor":"bottom", "icon-allow-overlap":true, "icon-ignore-placement":true}});
  m.addSource("rt-rib", {type:"geojson", data:fc([])});
  m.addLayer({id:"rt-ribbon", type:"fill-extrusion", source:"rt-rib", paint:{"fill-extrusion-base":["get","b"], "fill-extrusion-height":["get","t"], "fill-extrusion-color":"#4FC3F7", "fill-extrusion-opacity":1}});
  m.addSource("rt-car3d", {type:"geojson", data:fc([])});
  m.addLayer({id:"rt-car3d", type:"fill-extrusion", source:"rt-car3d", paint:{"fill-extrusion-height":["get","t"], "fill-extrusion-base":["get","b"], "fill-extrusion-color":["get","col"], "fill-extrusion-opacity":1, "fill-extrusion-vertical-gradient":true}});
  m.on("zoom", () => { if(use3d()) drawCar(); });
  m.addLayer({id:"rt-car", type:"symbol", source:"rt-pt", filter:["==",["get","k"],"me"], layout:{"icon-image":"nv-car", "icon-size":["interpolate",["linear"],["zoom"],13,.45,16,.75,19,1.1], "icon-rotate":["get","h"], "icon-rotation-alignment":"map", "icon-pitch-alignment":"map", "icon-allow-overlap":true, "icon-ignore-placement":true}});
  m.addLayer({id:"rt-lbl", type:"symbol", source:"rt-pt", filter:["has","t"], layout:{"text-field":["get","t"], "text-font":["Noto Sans Bold"], "text-size":12, "text-offset":[0,1.5], "text-anchor":"top"},
    paint:{"text-color":"#fff", "text-halo-color":"rgba(0,0,0,.8)", "text-halo-width":1.5}});
  if(saved) stackTop(m);
  m.on("idle", () => { if(R.routes[R.sel]) { const k0 = snapKey; snapRoute(m, R.routes[R.sel]); if(snapKey !== k0) draw(); } });
  m.on("click", "rt-alt", e => { const i = e.features?.[0]?.properties?.i; if(i != null && !R.nav){ R.sel = +i; draw(); list(); } });
  m.on("mouseenter", "rt-alt", () => { m.getCanvas().style.cursor = "pointer"; });
  m.on("mouseleave", "rt-alt", () => { m.getCanvas().style.cursor = ""; });
  return m;
}
// encaixa a rota (geometria do serviço de rotas) no eixo das vias do OpenStreetMap: cada ponto vai para o
// ponto mais próximo de uma via a até 14 m; sem via perto, fica como está
let snapKey = "";
/* Encaixa a rota no eixo da via certa do mapa. Em avenidas de pista dupla (Paulista, Radial) há duas linhas
   paralelas, uma por sentido: só vale a via que corre NA MESMA DIREÇÃO da rota (mão única no sentido certo),
   e o deslocamento lateral é suavizado ao longo da rota — sem zigue-zague entre as pistas. */
function snapRoute(m, r){
  if(!r || m.getZoom() < 14) return;
  const k = `${r.dist}|${m.getCenter().lng.toFixed(2)}|${m.getCenter().lat.toFixed(2)}`; if(k === snapKey) return; snapKey = k;
  const segs = new Map(), G = 2e3, gk = (x, y) => `${Math.floor(x*G)}:${Math.floor(y*G)}`;
  for(const f of m.querySourceFeatures("omt", {sourceLayer:"transportation", filter:["in",["get","class"],["literal",["motorway","trunk","primary","secondary","tertiary","minor","service"]]]})){
    const ow = +f.properties.oneway || 0, br = f.properties.brunnel === "bridge";
    const ls = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [];
    for(const ln of ls) for(let i=1;i<ln.length;i++){ const a = ln[i-1], b = ln[i], s = [a, b, ow, br];
      for(const c of [a, b, [(a[0]+b[0])/2, (a[1]+b[1])/2]]){ const key = gk(c[0], c[1]); if(!segs.has(key)) segs.set(key, []); segs.get(key).push(s); } } }
  if(!segs.size) return;
  const C = r.coords, n = C.length, kx = 111320*Math.cos(C[0][1]*D2R), ky = 110574, off = new Array(n).fill(null);
  for(let i=0;i<n;i++){
    const p = C[i], q0 = C[Math.max(0, i-1)], q1 = C[Math.min(n-1, i+1)];
    let rdx = (q1[0]-q0[0])*kx, rdy = (q1[1]-q0[1])*ky; const rl = Math.hypot(rdx, rdy) || 1; rdx /= rl; rdy /= rl;
    let best = null, bd = 16; const cx = Math.floor(p[0]*G), cy = Math.floor(p[1]*G);
    for(let a=-1;a<=1;a++) for(let b=-1;b<=1;b++) for(const [A, B, ow] of (segs.get(`${cx+a}:${cy+b}`) || [])){
      const ax = (A[0]-p[0])*kx, ay = (A[1]-p[1])*ky, bx = (B[0]-p[0])*kx, by = (B[1]-p[1])*ky, dx = bx-ax, dy = by-ay, L = Math.hypot(dx, dy); if(!L) continue;
      const dot = (dx*rdx + dy*rdy)/L;
      if(ow === 1 ? dot < .6 : ow === -1 ? dot > -.6 : Math.abs(dot) < .8) continue;   // direção da via ≠ direção da rota
      const t = Math.max(0, Math.min(1, -(ax*dx + ay*dy)/(L*L))), d = Math.hypot(ax + t*dx, ay + t*dy);
      if(d < bd){ bd = d; best = [(ax + t*dx)/kx, (ay + t*dy)/ky]; } }
    off[i] = best;
  }
  // deslocamento suavizado (média de 7 pontos): a linha segue a via sem saltos
  r.disp = C.map((p, i) => { let sx = 0, sy = 0, c = 0; for(let j=Math.max(0, i-3); j<=Math.min(n-1, i+3); j++) if(off[j]){ sx += off[j][0]; sy += off[j][1]; c++; }
    return c ? [p[0] + sx/c, p[1] + sy/c] : p; });
}
function draw(){
  const m = ensure(); if(!m){ setTimeout(draw, 500); return; }
  const f = [];
  R.routes.forEach((r, i) => { if(i !== R.sel && !R.nav) f.push(line(r.coords, {k:"alt", i})); });
  const r = R.routes[R.sel];
  if(r){
    snapRoute(m, r); const D = r.disp || r.coords;
    f.push(line(D, {k:"sel"}));
    for(const j of r.jams) if(j.to > j.from) f.push(line(D.slice(j.from, j.to + 1), {k:"jam", mag:j.mag}));
    if(R.nav && R.nav.idx > 0) f.push(line(D.slice(0, R.nav.idx + 1), {k:"done"}));
    if(R.nav?.man) f.push(line(R.nav.man.coords, {k:"man"}), {type:"Feature", properties:{k:"manh", h:R.nav.man.h}, geometry:{type:"Point", coordinates:R.nav.man.tip}});
  }
  m.getSource("rt").setData(fc(f));
  const p = [];
  if(R.a) p.push({type:"Feature", properties:{k:"a", t:R.nav ? undefined : R.a.name}, geometry:{type:"Point", coordinates:[R.a.lon, R.a.lat]}});
  if(R.b) p.push({type:"Feature", properties:{k:"b", t:R.b.name}, geometry:{type:"Point", coordinates:[R.b.lon, R.b.lat]}});
  for(const s of (R.stops || [])) p.push({type:"Feature", properties:{k:"s", t:R.nav ? undefined : s.name}, geometry:{type:"Point", coordinates:[s.lon, s.lat]}});
  if(R.nav?.pos){ const D = r?.disp, q = D && D[R.nav.idx] && hav(D[R.nav.idx], R.nav.pos) < 25 ? D[R.nav.idx] : null;
    if(q){ const dx = (q[0]-r.coords[R.nav.idx][0]), dy = (q[1]-r.coords[R.nav.idx][1]); R.nav.dpos = [R.nav.pos[0]+dx, R.nav.pos[1]+dy]; } else R.nav.dpos = R.nav.pos;
    p.push({type:"Feature", properties:{k:"me", h:R.nav.hdg || 0}, geometry:{type:"Point", coordinates:R.nav.dpos}}); }
  m.getSource("rt-pt").setData(fc(p));
  ribbon(m, r);
  drawCar();
}
function fit(){
  const m = window.Sat?.map(), r = R.routes[R.sel]; if(!m || !r) return;
  let w = 180, s = 90, e = -180, n = -90; for(const [x, y] of r.coords){ if(x < w) w = x; if(x > e) e = x; if(y < s) s = y; if(y > n) n = y; }
  const wide = innerWidth > 860;
  m.fitBounds([[w, s], [e, n]], {padding:{top:110, bottom:wide ? 190 : Math.round(innerHeight*.5), left:wide ? 470 : 30, right:wide ? 80 : 30}, pitch:0, bearing:0, duration:1400, maxZoom:17});
}
function clearMap(){ const m = window.Sat?.map(); if(m?.getSource("rt")){ m.getSource("rt").setData(fc([])); m.getSource("rt-pt").setData(fc([])); } }

/* ---------- painel ---------- */
let sugT = 0;
function panelHTML(){
  return `<div class="rt-h"><b>🧭 Rotas</b>${R.mode === "car" ? `<button class="rt-cfg" id="rtCar" title="Veículo: modelo e cor" aria-expanded="false">${carSvg(R.carModel, R.carColor)}</button>` : ""}<span class="rt-src" id="rtSrc"></span><button class="ibtn sm" id="rtX" aria-label="Fechar rotas">✕</button></div>
    <div class="seg txt rt-modes">${Object.entries(MODES).map(([k, v]) => `<button data-rm="${k}" aria-pressed="${R.mode===k}">${v.ic} ${v.nome}</button>`).join("")}</div>
    ${baseRow("data-rb", curBase())}
    ${R.mode === "car" ? `<div class="rt-carbox" id="rtCarBox" hidden><b>Seu veículo</b>${carRow()}</div>` : ""}
    <div class="rt-pts">
      <div class="rt-in"><i class="rt-dot a"></i><input id="rtA" placeholder="Origem" autocomplete="off" value="${esc(R.a?.name || "")}"><button class="rt-pick" data-pick="a" title="Escolher no mapa">📍</button></div>
      <button class="rt-sw" id="rtSw" title="Inverter" aria-label="Inverter origem e destino">⇅</button>
      <div class="rt-in"><i class="rt-dot b"></i><input id="rtB" placeholder="Para onde?" autocomplete="off" value="${esc(R.b?.name || "")}"><button class="rt-pick" data-pick="b" title="Escolher no mapa">📍</button></div>
    </div>
    <div class="rt-sug" id="rtSug" hidden></div>
    <div id="rtRes"></div>`;
}
function open(){
  if(document.body.dataset.view !== "sat") location.hash = "#sat";
  let el = $("rtPanel");
  if(!el){ el = document.createElement("section"); el.id = "rtPanel"; el.className = "rt glass"; el.setAttribute("aria-label", "Rotas"); document.body.appendChild(el); }
  el.hidden = false; document.body.classList.add("rt-open");
  el.innerHTML = panelHTML();
  $("rtX").onclick = close;
  el.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { R.mode = b.dataset.rm; store.set("rt-mode", R.mode); open(); calc(); });
  $("rtSw").onclick = () => { [R.a, R.b] = [R.b, R.a]; $("rtA").value = R.a?.name || ""; $("rtB").value = R.b?.name || ""; calc(); };
  for(const k of ["a","b"]){ const inp = $(k === "a" ? "rtA" : "rtB");
    inp.oninput = () => { clearTimeout(sugT); const v = inp.value.trim(); sugT = setTimeout(() => suggest(k, v), 450); };
    inp.onfocus = () => { if(!inp.value.trim()) suggest(k, ""); }; }
  el.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => pickOnMap(b.dataset.pick));
  el.querySelectorAll("[data-rb]").forEach(b => b.onclick = () => pickBase(b.dataset.rb));
  bindCar(el);
  const cb = $("rtCar"); if(cb) cb.onclick = () => { const bx = $("rtCarBox"); bx.hidden = !bx.hidden; cb.setAttribute("aria-expanded", !bx.hidden); };
  if(!R.a) useMyLocation(false);
  if(R.routes.length){ draw(); list(); } else if(!R.b) setTimeout(() => $("rtB")?.focus(), 50);
}
function close(){
  stopNav(); R.routes = []; clearMap(); ribKey = ""; window.Bridges?.setOverlay("route", []);
  const el = $("rtPanel"); if(el) el.hidden = true; document.body.classList.remove("rt-open");
}
async function suggest(k, v){
  const box = $("rtSug"); if(!box) return;
  const items = [];
  if(k === "a" || !v) items.push({name:"📍 Minha localização", me:true});
  if(v.length >= 3){
    const m = window.Sat?.map(), c = m ? m.getCenter() : {lng:C.S.loc?.lon || -47, lat:C.S.loc?.lat || -15};
    try{
      const j = await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=pt&q=${encodeURIComponent(v)}&viewbox=${c.lng-1.5},${c.lat+1.5},${c.lng+1.5},${c.lat-1.5}`)).json();
      for(const x of j) items.push({name:x.name || x.display_name.split(",")[0], sub:x.display_name.split(",").slice(1, 4).join(","), lat:+x.lat, lon:+x.lon});
    }catch(e){}
  }
  if(!items.length){ box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = items.map((x, i) => `<button data-s="${i}"><b>${esc(x.name)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ""}</button>`).join("");
  box.querySelectorAll("[data-s]").forEach(b => b.onclick = () => { const x = items[+b.dataset.s]; box.hidden = true;
    if(x.me){ useMyLocation(true, k); return; }
    set(k, {name:x.name, lat:x.lat, lon:x.lon}); });
}
function set(k, p){
  R[k] = p; const inp = $(k === "a" ? "rtA" : "rtB"); if(inp) inp.value = p?.name || "";
  draw(); if(R.a && R.b) calc();
}
function useMyLocation(force, k="a"){
  const fallback = () => { const L = C.S.loc; if(L && (force || !R[k])) set(k, {name:L.name || "Local", lat:L.lat, lon:L.lon}); };
  if(!navigator.geolocation){ fallback(); return; }
  navigator.geolocation.getCurrentPosition(p => set(k, {name:"Minha localização", lat:p.coords.latitude, lon:p.coords.longitude}), fallback, {enableHighAccuracy:true, timeout:8000, maximumAge:60000});
}
function pickOnMap(k){
  const m = window.Sat?.map(); if(!m) return;
  m.getCanvas().style.cursor = "crosshair";
  const src = $("rtSrc"); if(src) src.textContent = k === "a" ? "toque no mapa: origem" : "toque no mapa: destino";
  m.once("click", async e => { m.getCanvas().style.cursor = ""; if(src) src.textContent = "";
    const ll = e.lngLat; let name = `${ll.lat.toFixed(4)}, ${ll.lng.toFixed(4)}`;
    set(k, {name, lat:ll.lat, lon:ll.lng});
    try{ const n = await C.placeName(+ll.lat.toFixed(4), +ll.lng.toFixed(4)); if(n?.name){ R[k].name = n.name; const inp = $(k === "a" ? "rtA" : "rtB"); if(inp) inp.value = n.name; draw(); } }catch(e){} });
}
function list(){
  const out = $("rtRes"); if(!out) return;
  const src = $("rtSrc"); if(src) src.textContent = R.routes[0]?.src || "";
  if(!R.routes.length){ out.innerHTML = ""; return; }
  const now = Date.now(), best = Math.min(...R.routes.map(r => r.time));
  out.innerHTML = `${R.note ? `<p class="rt-err">${esc(R.note)}</p>` : ""}
    <div class="rt-opts">${R.routes.map((r, i) => `<button class="rt-opt${i === R.sel ? " on" : ""}" data-ro="${i}">
      <b class="${r.delay > 300 ? "rt-late" : ""}">${fmtT(r.time)}</b><span>${fmtD(r.dist)} · chega ${hora(now + r.time*1000)}</span>
      <small>${r.delay > 60 ? `🚦 +${fmtT(r.delay)} de trânsito` : R.mode === "car" && r.src.startsWith("TomTom") ? "🟢 trânsito livre" : ""}${i === 0 && R.routes.length > 1 ? " · mais rápida" : r.time > best + 60 ? ` · +${fmtT(r.time - best)}` : ""}</small></button>`).join("")}</div>
    <div class="rt-act"><button class="xbtn" id="rtGo">▶ Iniciar navegação</button><button class="mbtn" id="rtSim" title="Percorre a rota sem GPS, para ver como é">🎬 Simular</button>
      <button class="mbtn${R.voice ? " on" : ""}" id="rtVoice" title="Instruções faladas">${R.voice ? "🔊" : "🔈"}</button></div>
    <details class="rt-steps"><summary>${R.routes[R.sel].steps.length} instruções</summary><ol>${R.routes[R.sel].steps.map(s => `<li>${esc(s.txt)}<small>${fmtD(Math.max(0, R.routes[R.sel].cum[Math.min(s.at, R.routes[R.sel].cum.length-1)]))}</small></li>`).join("")}</ol></details>`;
  out.querySelectorAll("[data-ro]").forEach(b => b.onclick = () => { R.sel = +b.dataset.ro; draw(); list(); });
  $("rtGo").onclick = () => startNav(false);
  $("rtSim").onclick = () => startNav(true);
  $("rtVoice").onclick = () => { R.voice = !R.voice; store.set("rt-voice", R.voice); list(); };
}

/* ---------- navegação (modo imersivo: mapa vetorial 3D, carro, cartão de manobra, faixas) ---------- */
function say(t){
  if(!R.voice || !window.speechSynthesis) return;
  try{ speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = "pt-BR"; u.rate = 1.02; speechSynthesis.speak(u); }catch(e){}
}
const cc = (x, y, r) => `M${x-r} ${y}a${r} ${r} 0 1 0 ${2*r} 0a${r} ${r} 0 1 0 ${-2*r} 0`;
const TURN = {straight:["M12 21V4.5M6 10.5L12 4.5l6 6"], right:["M7 21v-7.5A4.5 4.5 0 0 1 11.5 9H20M15 4l5 5-5 5"], left:["M17 21v-7.5A4.5 4.5 0 0 0 12.5 9H4M9 4L4 9l5 5"],
  sright:["M8 21v-6.5c0-1.5.6-2.9 1.6-3.9L17 3.5M10.5 3.5H17V10"], sleft:["M16 21v-6.5c0-1.5-.6-2.9-1.6-3.9L7 3.5M13.5 3.5H7V10"],
  hright:["M7 3v10.5a4 4 0 0 0 6.8 2.8L19 11M19 17.5V11h-6.5"], hleft:["M17 3v10.5a4 4 0 0 1-6.8 2.8L5 11M5 17.5V11h6.5"],
  kright:["M8 21v-6l8-7.5V3M12.5 6.5L16 3l3.5 3.5"], kleft:["M16 21v-6L8 7.5V3M11.5 6.5L8 3 4.5 6.5"],
  uturn:["M16 21V9.5a4.5 4.5 0 0 0-9 0V17M3.5 13.5L7 17l3.5-3.5"], round:["M12 21v-6.5", cc(12,10,4.5), "M16.5 10H21M18.5 7.5L21 10l-2.5 2.5"],
  arrive:["M12 21.5s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z", cc(12,10.5,2.5)]};
const LANE = {STRAIGHT:"straight", LEFT:"left", RIGHT:"right", SLIGHT_LEFT:"sleft", SLIGHT_RIGHT:"sright", SHARP_LEFT:"hleft", SHARP_RIGHT:"hright", LEFT_U_TURN:"uturn", RIGHT_U_TURN:"uturn"};
const turnSvg = (k, s=40, w=2.6) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(TURN[k] || TURN.straight).map(d => `<path d="${d}"/>`).join("")}</svg>`;
const ico = (n, s=20) => window.Ico?.(n, s) || "";
// ponto mais próximo da rota, procurando perto do último índice (e na rota toda se perdeu)
function snap(r, p, from){
  let best = 1e12, bi = from;
  const scan = (a, b) => { for(let i=Math.max(0, a); i<Math.min(r.coords.length-1, b); i++){
    const A = r.coords[i], B = r.coords[i+1], kx = Math.cos(p[1]*D2R)*111320, ky = 110574;
    const ax = (A[0]-p[0])*kx, ay = (A[1]-p[1])*ky, bx = (B[0]-p[0])*kx, by = (B[1]-p[1])*ky, dx = bx-ax, dy = by-ay, L = dx*dx + dy*dy;
    const t = L ? Math.max(0, Math.min(1, -(ax*dx + ay*dy)/L)) : 0, d = Math.hypot(ax + t*dx, ay + t*dy);
    if(d < best){ best = d; bi = i + (t > .5 ? 1 : 0); } } };
  scan(from - 5, from + 400); if(best > 80) scan(0, r.coords.length);
  return {i:bi, d:best};
}
// ponto da rota a uma distância (m) do início
function along(r, d){
  const cum = r.cum; d = Math.max(0, Math.min(cum[cum.length-1], d));
  let i = cum.findIndex(c => c >= d); if(i <= 0) return r.coords[Math.max(0, i)];
  const t = (d - cum[i-1]) / ((cum[i] - cum[i-1]) || 1), A = r.coords[i-1], B = r.coords[i];
  return [A[0] + (B[0]-A[0])*t, A[1] + (B[1]-A[1])*t];
}
/* mapa de navegação: vetorial e limpo (como os apps de trânsito), nas cores do tema do sistema */
const dark = () => (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
const PAL = {
  dark:{bg:"#262A43", park:"#2C4A45", parkE:"#3E6B61", water:"#2A4778", waterE:"#4C77B8", rcase:"#171A2B", road:"#4C5180", major:"#676DAA", lane:"rgba(255,255,255,.35)", bld:["#4B4F80","#6A70AC","#8C92D2"], roof:"#A3A9E6", txt:"#E8EAF8", halo:"#1C1F35",
    sky:"#1B2240", horizon:"#4A5A9A", fog:"#2A3256"},
  light:{bg:"#ECEAF5", park:"#C6E4CF", parkE:"#A3D1B2", water:"#A5C6F0", waterE:"#7FA9E3", rcase:"#BEBAD6", road:"#FFFFFF", major:"#FFFFFF", lane:"rgba(120,120,160,.45)", bld:["#D4D1E8","#BEBADD","#A9A4D2"], roof:"#EEECF8", txt:"#34374F", halo:"#FFFFFF",
    sky:"#8EC5FF", horizon:"#E9F1FF", fog:"#E6E9F5"}};
let saved = null;
function navLook(on){
  const m = window.Sat?.map(); if(!m || !m.getStyle()) return;
  if(on){
    if(R.prevMaxZ == null) R.prevMaxZ = m.getMaxZoom(); m.setMaxZoom(20);
    // prédios: os mesmos do Planeta Água (cores reais de fachada e telhado, partes do prédio) ficam ligados
    if(!saved){ saved = {}; for(const L of m.getStyle().layers){ if(/^(nv-|rt-|tt-)/.test(L.id) || L.id === "n-place") continue; saved[L.id] = m.getLayoutProperty(L.id, "visibility") || "visible";
      // camadas de pontos ligadas pelo usuário (rodoviárias, aeroportos, câmeras, lugares, vulcões, templos, aviões) continuam como estavam
      if(OVERLAYS.test(L.id)){ delete saved[L.id]; continue; }
      m.setLayoutProperty(L.id, "visibility", REAL_BLD.includes(L.id) || /^(hx-|ghb)/.test(L.id) ? "visible" : "none"); } }
    // fundo do estilo Rota (água, parques, ruas) logo acima do fundo do mapa — ABAIXO de qualquer outra camada
    const c = PAL[dark() ? "dark" : "light"], first = m.getStyle().layers[0]?.id,
      before = m.getStyle().layers.find(l => l.type !== "background" && !/^nv-/.test(l.id))?.id;
    const H = ["coalesce",["get","height"],["*",["get","num_floors"],3.2],8];
    const RW = (k) => ["interpolate",["exponential",1.6],["zoom"],12,["match",["get","class"],["motorway","trunk"],2.2*k,["primary","secondary"],1.4*k,.5*k],16,["match",["get","class"],["motorway","trunk"],14*k,["primary","secondary"],10*k,5.5*k],19,["match",["get","class"],["motorway","trunk"],38*k,["primary","secondary"],26*k,15*k]];
    // de perto a ponte vira volume 3D (bridges3d.js): a linha plana dela some; túnel fica esmaecido
    const BT = ["get","brunnel"], BR_OP = ["step",["zoom"],["case",["==",BT,"tunnel"],.35,1],14,["case",["==",BT,"bridge"],0,["==",BT,"tunnel"],.35,1]];
    const roads = ["in",["get","class"],["literal",["motorway","trunk","primary","secondary","tertiary","minor","service"]]];
    const L = [
      [{id:"nv-bg", type:"background", paint:{"background-color":c.bg}}, first],
      [{id:"nv-park", type:"fill", source:"omt", "source-layer":"park", paint:{"fill-color":c.park}}, before],
      [{id:"nv-green", type:"fill", source:"omt", "source-layer":"landcover", filter:["in",["get","class"],["literal",["grass","wood","forest"]]], paint:{"fill-color":c.park, "fill-opacity":.8}}, before],
      [{id:"nv-water", type:"fill", source:"omt", "source-layer":"water", paint:{"fill-color":c.water}}, before],
      [{id:"nv-water-e", type:"line", source:"omt", "source-layer":"water", minzoom:11, paint:{"line-color":c.waterE, "line-width":["interpolate",["linear"],["zoom"],11,.5,17,2], "line-opacity":.7}}, before],
      [{id:"nv-park-e", type:"line", source:"omt", "source-layer":"park", minzoom:12, paint:{"line-color":c.parkE, "line-width":1, "line-opacity":.7}}, before],
      [{id:"nv-rcase", type:"line", source:"omt", "source-layer":"transportation", filter:roads, layout:{"line-cap":"round","line-join":"round"}, paint:{"line-color":c.rcase, "line-width":RW(1.18), "line-opacity":BR_OP}}, before],
      [{id:"nv-road", type:"line", source:"omt", "source-layer":"transportation", filter:roads, layout:{"line-cap":"round","line-join":"round"},
        paint:{"line-color":["match",["get","class"],["motorway","trunk","primary"],c.major,c.road], "line-width":RW(1), "line-opacity":BR_OP}}, before],
      [{id:"nv-lane", type:"line", source:"omt", "source-layer":"transportation", minzoom:15, filter:["in",["get","class"],["literal",["motorway","trunk","primary","secondary"]]],
        paint:{"line-color":c.lane, "line-width":["interpolate",["linear"],["zoom"],15,.6,19,2], "line-dasharray":[3,4]}}, before],
      [{id:"nv-bld", type:"fill-extrusion", source:"ovb", "source-layer":"building", minzoom:12, filter:["all",["!=",["get","is_underground"],true],[">",H,0]],
        paint:{"fill-extrusion-height":H, "fill-extrusion-base":["min",["coalesce",["get","min_height"],0],["-",H,1]], "fill-extrusion-color":["interpolate",["linear"],H,0,c.bld[0],40,c.bld[1],150,c.bld[2]], "fill-extrusion-opacity":.97, "fill-extrusion-vertical-gradient":true}}, before],
      // fachadas com janelas (textura gerada no tema) nos prédios com mais de 3 andares, de perto
      [{id:"nv-win", type:"fill-extrusion", source:"ovb", "source-layer":"building", minzoom:15.5, filter:["all",["!=",["get","is_underground"],true],[">",H,9]],
        paint:{"fill-extrusion-height":["-",H,.8], "fill-extrusion-base":["min",["coalesce",["get","min_height"],0],["-",H,1.8]], "fill-extrusion-pattern":winTex(m, c), "fill-extrusion-opacity":.97}}, before],
      // laje do telhado mais clara: marca o contorno de cada prédio (efeito de "aresta iluminada")
      [{id:"nv-roof", type:"fill-extrusion", source:"ovb", "source-layer":"building", minzoom:14, filter:["all",["!=",["get","is_underground"],true],[">",H,1.5]],
        paint:{"fill-extrusion-height":H, "fill-extrusion-base":["-",H,.7], "fill-extrusion-color":c.roof, "fill-extrusion-opacity":.97}}, before],
      [{id:"nv-name", type:"symbol", source:"omt", "source-layer":"transportation_name", minzoom:13, filter:["any",["<",["zoom"],15],["!=",["get","brunnel"],"bridge"]], layout:{"symbol-placement":"line", "text-field":["coalesce",["get","name"],["get","name:pt"],["get","name:latin"]], "text-font":["Noto Sans Bold"], "text-size":["interpolate",["linear"],["zoom"],13,11,18,14], "text-max-angle":25, "text-letter-spacing":.02,
          "text-pitch-alignment":"viewport", "text-rotation-alignment":"map", "symbol-spacing":900, "text-padding":40, "text-keep-upright":true},
        paint:{"text-color":c.txt, "text-halo-color":c.halo, "text-halo-width":2, "text-halo-blur":.5}}, before]];
    for(const [l, b] of L){ if(["nv-bld","nv-win","nv-roof"].includes(l.id)) continue; if(m.getLayer(l.id)) m.removeLayer(l.id); try{ m.addLayer(l, b); }catch(e){} }
    // nomes por cima de ruas, prédios e rota; carro, destino e seta da manobra acima de tudo
    window.Bridges?.setColor(R.nb === "rota" || !R.nav ? c.major : "#A3A9B2");
    stackTop(m);
    for(const id of REAL_BLD) if(m.getLayer(id)) m.setPaintProperty(id, "fill-extrusion-opacity", R.nav ? .72 : id.endsWith("-tx") || id.endsWith("-roof") ? 1 : .96);
    // luz direcional (faces iluminadas e sombreadas) e céu com névoa no horizonte, nas cores do tema
    try{ if(R.prevLight === undefined){ R.prevLight = m.getLight?.() || null; R.prevSky = m.getSky?.() || null; }
      m.setLight({anchor:"viewport", color:"#ffffff", intensity:dark() ? .42 : .32, position:[1.3, 215, 35]});
      m.setSky?.({"sky-color":c.sky, "horizon-color":c.horizon, "fog-color":c.fog, "sky-horizon-blend":.6, "horizon-fog-blend":.5, "fog-ground-blend":.35, "atmosphere-blend":["interpolate",["linear"],["zoom"],0,1,10,1,12,0]}); }catch(e){}
    applyNavBase();
    if(m.getLayer("rt-glow")){ const W = k => ["interpolate",["exponential",1.5],["zoom"],12,5*k,16,11*k,19,24*k];
      m.setLayoutProperty("rt-glow", "visibility", "visible"); m.setPaintProperty("rt-glow", "line-width", W(1.9)); m.setPaintProperty("rt-glow", "line-blur", 6); m.setPaintProperty("rt-glow", "line-color", "rgba(90,200,250,.28)");
      m.setPaintProperty("rt-sel", "line-color", "#4FC3F7"); m.setPaintProperty("rt-case", "line-color", "#0A3A73");
      m.setPaintProperty("rt-sel", "line-width", W(1)); m.setPaintProperty("rt-case", "line-width", W(1.35));
      m.setPaintProperty("rt-jam", "line-width", W(.78)); m.setPaintProperty("rt-jam", "line-opacity", 1); m.setPaintProperty("rt-done", "line-width", W(.8)); m.setPaintProperty("rt-done", "line-opacity", .45); }
  } else {
    for(const id of ["nv-bg","nv-park","nv-green","nv-water","nv-water-e","nv-park-e","nv-rcase","nv-road","nv-lane","nv-bld","nv-win","nv-roof","nv-name"]) if(m.getLayer(id)) m.removeLayer(id);
    window.Bridges?.setColor("#A3A9B2");
    try{ if(R.prevLight !== undefined){ if(R.prevLight) m.setLight(R.prevLight); if(R.prevSky) m.setSky?.(R.prevSky); R.prevLight = undefined; } }catch(e){}
    if(saved) for(const [id, v] of Object.entries(saved)) if(m.getLayer(id)) m.setLayoutProperty(id, "visibility", v);
    saved = null; document.body.classList.remove("nv-flat");
    if(R.prevMaxZ != null){ m.setMaxZoom(R.prevMaxZ); R.prevMaxZ = null; }
    setTimeout(() => window.Sat?.applyMode?.(), 0);
    if(m.getLayer("rt-glow")){ m.setLayoutProperty("rt-glow", "visibility", "none"); m.setPaintProperty("rt-sel", "line-color", "#2F80FF"); m.setPaintProperty("rt-case", "line-color", "#0A3D91"); m.setPaintProperty("rt-sel", "line-width", 7); m.setPaintProperty("rt-case", "line-width", 11); for(const id of ["rt-done","rt-jam"]) m.setPaintProperty(id, "line-width", 7); }
  }
}
// mapa base no modo rota: Rota (vetorial) · Satélite (Esri) · Mapa · Relevo — no painel e durante a navegação
R.nb = store.get("rt-navbase2", "sat");   // navegação começa no Planeta Água (satélite) com os prédios 3D reais
const BASES = [["rota","Rota"],["sat","Satélite"],["map","Mapa"],["topo","Relevo"]];
const NV_FLAT = ["nv-bg","nv-park","nv-green","nv-water","nv-water-e","nv-park-e","nv-rcase","nv-road","nv-lane"];
const RASTER = {sat:"earth", map:"base-map", topo:"base-topo"};
// miniatura do estilo Rota desenhada nas cores reais dele (tema claro/escuro): água, parque, ruas, prédios e a linha da rota
function rotaThumb(){
  const c = PAL[dark() ? "dark" : "light"];
  return `<svg class="rb-rota" viewBox="0 0 64 40" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="64" height="40" fill="${c.bg}"/>
    <path d="M0 27c8-2 13 3 21 1s9-6 15-5v17H0z" fill="${c.water}"/><path d="M0 27c8-2 13 3 21 1s9-6 15-5" fill="none" stroke="${c.waterE}" stroke-width=".8"/>
    <rect x="41" y="3" width="15" height="11" rx="2" fill="${c.park}"/>
    <g fill="${c.bld[1]}"><rect x="27" y="4" width="5" height="5" rx=".6"/><rect x="33" y="4" width="4" height="7" rx=".6"/><rect x="45" y="20" width="6" height="5" rx=".6"/><rect x="53" y="18" width="5" height="8" rx=".6"/><rect x="8" y="8" width="6" height="5" rx=".6"/></g>
    <g fill="none" stroke-linecap="round"><path d="M-2 18 66 12M24 -2l4 44M39 -2l-2 44M58 -2l-6 44" stroke="${c.rcase}" stroke-width="3.6"/><path d="M-2 18 66 12M24 -2l4 44M39 -2l-2 44M58 -2l-6 44" stroke="${c.road}" stroke-width="2.4"/>
    <path d="M6 40 26 16l12-1 9 13 19-3" stroke="#0A3A73" stroke-width="4.2"/><path d="M6 40 26 16l12-1 9 13 19-3" stroke="#4FC3F7" stroke-width="2.6"/></g></svg>`;
}
const bThumb = k => k === "rota" ? rotaThumb() : `<img src="${window.Sat?.thumb?.(k) || ""}" alt="" loading="lazy">`;
const baseRow = (attr, cur) => `<div class="rt-bases" role="group" aria-label="Mapa base">${BASES.map(([k, n]) => `<button class="lb" ${attr}="${k}" aria-pressed="${k === cur}" title="${n}" aria-label="${n}">${bThumb(k)}<span>${n}</span></button>`).join("")}</div>`;
function applyNavBase(){
  const m = window.Sat?.map(); if(!m || !saved) return;
  const k = R.nav ? R.nb : "rota";
  // estilo Rota: mapa plano (como nos apps de navegação) — ruas e áreas sempre alinhadas, sem "paredes" do relevo;
  // nas bases Satélite / Mapa / Relevo o relevo 3D continua
  // estilo Rota com o relevo real do mapa (morros, serras): as ruas e a rota acompanham o terreno
  document.body.classList.remove("nv-flat");
  try{ if(!m.getTerrain()) m.setTerrain({source:"dem", exaggeration:1}); }catch(e){}
  for(const id of NV_FLAT) if(m.getLayer(id)) m.setLayoutProperty(id, "visibility", k === "rota" ? "visible" : "none");
  window.Bridges?.setColor(k === "rota" ? PAL[dark() ? "dark" : "light"].major : "#A3A9B2");
  for(const [b, id] of Object.entries(RASTER)) if(m.getLayer(id)) m.setLayoutProperty(id, "visibility", k === b ? "visible" : "none");
}
const curBase = () => R.look ? "rota" : (window.Sat?.base?.() || "sat");
function pickBase(k){
  if(k === "rota"){ setLook(true); }
  else { if(R.look) setLook(false); window.Sat?.setBase?.(k); if(k === "sat" && !window.Sat?.isClear?.()) window.Sat?.setProd?.("earth"); }
  R.nb = k; store.set("rt-navbase2", k);
  document.querySelectorAll("[data-rb]").forEach(b => b.setAttribute("aria-pressed", b.dataset.rb === k));
  window.Sat?.panelRefresh?.();
}
// ordem fixa por cima do mapa: trânsito → rota → nomes → pinos e carro (independe de quem foi criado primeiro)
// linhas planas (trânsito, rota) ANTES dos prédios 3D: assim o prédio as cobre quando está na frente;
// depois vêm o carro 3D e, por fim, nomes e pinos (sempre legíveis)
const STACK = ["tt-flow","tt-inc-line","rt-alt","rt-glow","rt-case","rt-sel","rt-jam","rt-done","rt-man-case","rt-man","br3d-gl","bld","bld-far","bld-tx","bld-roof","bld-parts","bld-parts-far","bld-parts-tx","bld-parts-roof","rt-car3d",
  "rt-manh","nv-name","n-place","tt-inc-clu","tt-inc-clu-n","tt-inc-ico","rt-lbl","rt-pts","rt-pin","rt-car"];
function stackTop(m){ if(!m) return;
  for(const id of STACK){ if(m.getLayer(id)) try{ m.moveLayer(id); }catch(e){}
    if(id === "bld-parts-roof") for(const L of m.getStyle().layers) if(/^(hx-|ghb)/.test(L.id)) try{ m.moveLayer(L.id); }catch(e){} }
  // ícones e nomes das outras camadas (aeroportos, aviões, câmeras, lugares, vulcões…) sempre por cima de ruas, rota e prédios
  for(const L of m.getStyle().layers) if((L.type === "symbol" || L.type === "circle") && !/^(nv-|rt-|tt-)/.test(L.id)) try{ m.moveLayer(L.id); }catch(e){}
  for(const id of ["nv-name","n-place","tt-inc-clu","tt-inc-clu-n","tt-inc-ico","rt-lbl","rt-pts","rt-pin","rt-car"]) if(m.getLayer(id)) try{ m.moveLayer(id); }catch(e){}
}
// textura de fachada: parede na cor do tema com grade de janelas (algumas acesas no tema escuro)
function winTex(m, c){
  const id = `nv-win-${dark() ? "d" : "l"}`; if(m.hasImage(id)) return id;
  const s = 64, cv = document.createElement("canvas"); cv.width = cv.height = s; const g = cv.getContext("2d");
  g.fillStyle = c.bld[1]; g.fillRect(0, 0, s, s);
  g.fillStyle = "rgba(0,0,0,.18)"; for(let y=0; y<s; y+=16) g.fillRect(0, y + 14, s, 2);              // laje entre andares
  let k = 7;
  for(let y=0; y<s; y+=16) for(let x=0; x<s; x+=16){ k = (k * 1103515245 + 12345) & 0x7fffffff;
    g.fillStyle = dark() ? (k % 7 === 0 ? "#FFD889" : k % 3 === 0 ? "#8FA2E6" : "#2A2F55") : (k % 5 === 0 ? "#FFFFFF" : "#8E9BC9");
    g.fillRect(x + 3, y + 3, 10, 9); }
  m.addImage(id, g.getImageData(0, 0, s, s), {pixelRatio:2});
  return id;
}
const OVERLAYS = /^(rodov|airports|airports-lbl|cams|places|volc|temp|planes|drv)/;
const REAL_BLD = ["bld","bld-tx","bld-far","bld-roof","bld-parts","bld-parts-tx","bld-parts-far","bld-parts-roof","rf3d"];
const land = () => innerWidth > innerHeight && innerWidth >= 640;
function hudHTML(){
  return `<div class="nv-man glass" id="nvMan"><div class="nv-m1"><span class="nv-turn" id="nvTurn"></span><b id="nvDist"></b></div>
      <div class="nv-m2"><span class="nv-num" id="nvNum" hidden></span><span id="nvStreet"></span></div><div class="nv-lanes" id="nvLanes" hidden></div></div>
    <div class="nv-then glass" id="nvThen" hidden></div>
    <div class="nv-top2"><button class="nv-pill glass" id="nvAdd">${ico("pin", 18)}<span>Parada</span></button></div>
    <div class="nv-side"><button class="nv-exit glass" id="nvExit">Sair</button>
      <button class="nv-btn glass" id="nvCmp" title="Norte para cima / rumo para cima"><span id="nvN">N</span></button>
      <div class="nv-spd" id="nvSpd" hidden><div class="nv-lim" id="nvLim" hidden></div><div class="nv-cur glass" id="nvCurW"><b id="nvCur"></b><small>km/h</small></div></div></div>
    <div class="nv-tools"><div class="nv-zoom glass"><button id="nvZin" aria-label="Aproximar">${ico("plus", 20) || "+"}</button><button id="nvZout" aria-label="Afastar">${ico("minus", 20) || "−"}</button></div><button class="nv-btn glass" id="nvTraffic" title="Trânsito ao vivo" aria-pressed="true">${ico("traffic", 20)}</button><button class="nv-btn glass" id="nvLayers" title="Mapa base" aria-haspopup="true">${ico("layers", 20)}</button><button class="nv-btn glass" id="nvVoice" title="Voz">${ico(R.voice ? "vol" : "mute", 20)}</button><button class="nv-btn glass" id="nvOver" title="Ver a rota toda">${ico("map", 20)}</button></div>
    <button class="nv-pill nv-re glass" id="nvRe" hidden>${ico("send", 16)}<span>Recentralizar</span></button>
    <div class="nv-road glass" id="nvRoad" hidden></div>
    <div class="nv-trip glass"><div><b id="nvEta"></b><small>chegada</small></div><div><b id="nvMin" class="nv-g"></b><small id="nvMinU">min</small></div><div><b id="nvKm"></b><small id="nvKmU">km</small></div></div>
    <div class="nv-bases glass" id="nvBases" hidden><b>Mapa base</b>${baseRow("data-nb", R.nb)}${R.mode === "car" ? `<b>Seu carro</b>${carRow()}` : ""}</div>
    <div class="nv-add glass" id="nvAddBox" hidden><div class="nv-add-h"><b>Adicionar parada</b><button class="nv-x" id="nvAddX" aria-label="Fechar">${ico("x", 16)}</button></div>
      <input id="nvAddQ" placeholder="Buscar posto, mercado, endereço…" autocomplete="off"><div id="nvAddRes" class="nv-add-r"></div>
      <button class="nv-pill" id="nvAddMap">${ico("pin", 16)}<span>Escolher no mapa</span></button></div>`;
}
function startNav(sim){
  const r = R.routes[R.sel]; if(!r) return;
  stopNav();
  R.nav = {sim, idx:0, off:0, said:{}, t0:Date.now(), lastRe:0, hdg:0};
  document.body.classList.add("rt-nav");
  let hud = $("rtNav"); if(!hud){ hud = document.createElement("section"); hud.id = "rtNav"; hud.className = "nv"; hud.setAttribute("aria-label", "Navegação"); document.body.appendChild(hud); }
  hud.hidden = false; hud.innerHTML = hudHTML();
  $("nvExit").onclick = () => { stopNav(); draw(); fit(); };
  $("nvVoice").onclick = () => { R.voice = !R.voice; store.set("rt-voice", R.voice); $("nvVoice").innerHTML = ico(R.voice ? "vol" : "mute", 20); };
  $("nvOver").onclick = () => { const N = R.nav; if(!N) return; N.over = !N.over; $("nvRe").hidden = !N.over; if(N.over) fit(); };
  $("nvRe").onclick = () => { const N = R.nav; if(!N) return; N.over = false; N.free = false; N.zoff = 0; N.snapCam = true; $("nvRe").hidden = true; if(N.pos) fix(N.pos, null, N.spd); };
  const zoomBy = d => { const N = R.nav; if(!N) return; N.zoff = Math.max(-5, Math.min(3, (N.zoff || 0) + d)); if(N.free || N.over){ window.Sat?.map()?.easeTo({zoom:window.Sat.map().getZoom() + d, duration:300}); } else if(N.pos) fix(N.pos, null, N.spd); };
  $("nvZin").onclick = () => zoomBy(1); $("nvZout").onclick = () => zoomBy(-1);
  $("nvCmp").onclick = () => { const N = R.nav; if(!N) return; N.north = !N.north; if(N.pos) fix(N.pos, null, N.spd); };
  R.trafficBefore = R.traffic; if(R.mode === "car") setTraffic(true);
  const tb = () => $("nvTraffic")?.setAttribute("aria-pressed", R.traffic);
  $("nvTraffic").onclick = () => { setTraffic(!R.traffic); tb(); }; tb();
  $("nvLayers").onclick = () => { const b = $("nvBases"); b.hidden = !b.hidden; };
  bindCar($("nvBases"));
  hud.querySelectorAll("[data-nb]").forEach(b => b.onclick = () => { R.nb = b.dataset.nb; store.set("rt-navbase2", R.nb);
    hud.querySelectorAll("[data-nb]").forEach(x => x.setAttribute("aria-pressed", x.dataset.nb === R.nb)); applyNavBase(); $("nvBases").hidden = true; });
  $("nvAdd").onclick = () => { $("nvAddBox").hidden = false; $("nvAddQ").focus(); };
  $("nvAddX").onclick = () => { $("nvAddBox").hidden = true; };
  let qT = 0; $("nvAddQ").oninput = () => { clearTimeout(qT); qT = setTimeout(stopSearch, 450); };
  $("nvAddMap").onclick = () => { $("nvAddBox").hidden = true; const m = window.Sat?.map(); if(!m) return; R.nav.free = true; $("nvRe").hidden = false;
    m.getCanvas().style.cursor = "crosshair"; m.once("click", e => { m.getCanvas().style.cursor = ""; addStop({name:"Parada", lat:e.lngLat.lat, lon:e.lngLat.lng}); }); };
  const m = window.Sat?.map();
  if(m && !m.__nvDrag){ m.__nvDrag = true; m.on("dragstart", () => { if(R.nav){ R.nav.free = true; const b = $("nvRe"); if(b) b.hidden = false; } }); }
  navLook(true);
  try{ navigator.wakeLock?.request("screen").then(w => { if(R.nav) R.nav.lock = w; else w.release(); }).catch(()=>{}); }catch(e){}
  say(`Iniciando. ${r.steps[1]?.txt || r.steps[0]?.txt || ""}. Chegada em ${fmtT(r.time)}.`);
  if(sim){
    const speed = R.mode === "car" ? 13 : R.mode === "bike" ? 5 : 1.5;   // m/s; a simulação anda 3× mais rápido
    let s = 0;
    R.nav.timer = setInterval(() => { const rr = R.routes[R.sel]; if(!rr) return; s += speed * 3 * .4; const p = along(rr, s), q = along(rr, s + 8);
      fix(p, brg(p, q), speed); }, 400);
  } else if(navigator.geolocation){
    R.nav.watch = navigator.geolocation.watchPosition(p => fix([p.coords.longitude, p.coords.latitude], p.coords.heading, p.coords.speed),
      e => { $("nvStreet").textContent = e.code === 1 ? "Permita a localização para navegar (ou use Simular)." : "Procurando sinal de GPS…"; },
      {enableHighAccuracy:true, maximumAge:1000, timeout:15000});
  }
  addEventListener("resize", onResize);
}
const onResize = () => { const N = R.nav; if(N?.pos) fix(N.pos, null, N.spd); };
// "Estilo rota" no mapa todo, fora da navegação (botão no cabeçalho)
R.look = store.get("rt-look", false);
function setLook(on){
  R.look = on; store.set("rt-look", on); document.body.classList.toggle("nv-look", on);
  const m = window.Sat?.map(); if(!m || !m.getStyle() || !m.getSource("ovb")){ setTimeout(() => setLook(R.look), 800); return; }
  ensure(); if(R.nav) return;
  navLook(on);
}
if(R.look) setTimeout(() => setLook(true), 2500);
function stopNav(){
  const N = R.nav; if(!N) return;
  if(N.timer) clearInterval(N.timer);
  if(N.watch != null) navigator.geolocation.clearWatch(N.watch);
  try{ N.lock?.release(); }catch(e){}
  try{ speechSynthesis.cancel(); }catch(e){}
  removeEventListener("resize", onResize);
  if(R.trafficBefore === false && R.traffic) setTraffic(false); R.trafficBefore = undefined;
  R.nav = null; document.body.classList.remove("rt-nav");
  if(!R.look) navLook(false); else { const m = window.Sat?.map(); if(m?.getLayer("rt-glow")){ m.setLayoutProperty("rt-glow", "visibility", "none"); } }
  const h = $("rtNav"); if(h) h.hidden = true;
}
async function stopSearch(){
  const v = $("nvAddQ")?.value.trim(), box = $("nvAddRes"); if(!box || !v || v.length < 3){ if(box) box.innerHTML = ""; return; }
  const c = R.nav?.pos || [R.a.lon, R.a.lat];
  try{
    const j = await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=pt&q=${encodeURIComponent(v)}&viewbox=${c[0]-.3},${c[1]+.3},${c[0]+.3},${c[1]-.3}`)).json();
    box.innerHTML = j.map((x, i) => `<button data-i="${i}"><b>${esc(x.name || x.display_name.split(",")[0])}</b><small>${esc(x.display_name.split(",").slice(1, 3).join(","))}</small></button>`).join("") || `<small>Nada encontrado.</small>`;
    box.querySelectorAll("[data-i]").forEach(b => b.onclick = () => { const x = j[+b.dataset.i]; $("nvAddBox").hidden = true; addStop({name:x.name || x.display_name.split(",")[0], lat:+x.lat, lon:+x.lon}); });
  }catch(e){}
}
async function addStop(p){
  R.stops = [...(R.stops || []), p]; say(`Parada adicionada: ${p.name}.`);
  const N = R.nav; if(N){ N.lastRe = 0; await reroute(N.pos || [R.a.lon, R.a.lat], true); }
}
async function reroute(p, force){
  const N = R.nav; if(!N || (!force && Date.now() - N.lastRe < 12000)) return; N.lastRe = Date.now();
  if(!force) say("Recalculando a rota.");
  const a = {name:"Minha localização", lat:p[1], lon:p[0]};
  try{
    const rs = R.mode === "car" ? await viaTomTom(pts(a)).catch(() => viaValhalla(pts(a), "auto")) : await viaValhalla(pts(a), MODES[R.mode].v);
    if(!rs.length || !R.nav) return;
    rs.forEach(prep);
    R.routes = [rs[0]]; R.sel = 0; N.idx = 0; N.off = 0; N.said = {};
    if(N.sim){ clearInterval(N.timer); let s = 0; const speed = R.mode === "car" ? 13 : R.mode === "bike" ? 5 : 1.5;
      N.timer = setInterval(() => { const rr = R.routes[R.sel]; s += speed * 3 * .4; const q0 = along(rr, s), q1 = along(rr, s + 8); fix(q0, brg(q0, q1), speed); }, 400); }
    draw();
  }catch(e){}
}
const nf = (n, d=0) => n.toLocaleString("pt-BR", {maximumFractionDigits:d, minimumFractionDigits:d});
function fix(p, heading, speed){
  const N = R.nav, r = R.routes[R.sel]; if(!N || !r) return;
  N.pos = p; N.spd = speed;
  const s = snap(r, p, N.idx);
  if(s.d > 50){ if(++N.off >= 3 && !N.sim) reroute(p); } else { N.off = 0; N.idx = Math.max(N.idx, s.i); }
  // paradas já alcançadas saem da lista
  if(R.stops?.length && hav(p, [R.stops[0].lon, R.stops[0].lat]) < 40){ say(`Você chegou à parada ${R.stops[0].name}.`); R.stops = R.stops.slice(1); }
  const done = r.cum[N.idx] || 0, left = Math.max(0, r.dist - done), restT = r.time * left / Math.max(1, r.dist);
  const ni = r.steps.findIndex(x => x.at > N.idx), next = r.steps[ni >= 0 ? ni : r.steps.length - 1], after = ni >= 0 ? r.steps[ni + 1] : null;
  const atD = st => r.cum[Math.min(st.at, r.cum.length-1)] || 0;
  const toNext = next ? Math.max(0, atD(next) - done) : left;
  // rumo suavizado (o carro não "treme" nas curvas)
  const ahead = along(r, done + 12), want = heading != null && !isNaN(heading) && speed > 2 ? heading : brg(p, ahead);
  N.hdg = (N.hdg + ((((want - N.hdg + 540) % 360) - 180)) * (N.sim ? .5 : .6) + 360) % 360;
  // cartão da manobra
  const kind = next?.man || "straight";
  $("nvTurn").innerHTML = turnSvg(kind, 44, 2.6);
  $("nvDist").textContent = toNext >= 1000 ? `${nf(toNext/1000, toNext < 10000 ? 1 : 0)} km` : `${Math.max(0, Math.round(toNext/10)*10)} m`;
  $("nvStreet").textContent = next?.street || next?.txt || "Siga em frente";
  const num = $("nvNum"); num.hidden = !next?.num; num.textContent = next?.num || "";
  // faixas: trecho de faixas que termina perto da próxima manobra
  const ln = (r.lanes || []).find(x => x.from <= next?.at && x.to >= (next?.at ?? 0) - 1 && x.to >= N.idx) || (r.lanes || []).find(x => x.from > N.idx && x.from <= (next?.at ?? 0) && atD({at:x.from}) - done < 400);
  const lb = $("nvLanes");
  if(ln && ln.lanes.length > 1 && toNext < 800){ lb.hidden = false;
    lb.innerHTML = ln.lanes.map(L => { const d = L.follow || L.directions?.[0] || "STRAIGHT"; return `<span class="${L.follow ? "on" : ""}">${turnSvg(LANE[d] || "straight", 22, 2.4)}</span>`; }).join(""); }
  else lb.hidden = true;
  // "depois": manobra seguinte bem próxima
  const th = $("nvThen");
  if(after && atD(after) - atD(next) < 350 && after.man !== "arrive"){ th.hidden = false; th.innerHTML = `<small>Depois</small>${turnSvg(after.man, 20, 2.6)}`; } else th.hidden = true;
  // rua atual (pílula sob o carro)
  const cur = [...r.steps].reverse().find(x => x.at <= N.idx), rd = $("nvRoad");
  if(cur?.street && cur.man !== "arrive"){ rd.hidden = false; rd.textContent = cur.num ? `${cur.num} · ${cur.street}` : cur.street; } else rd.hidden = true;
  // velocidade e limite
  const kmh = speed != null && !isNaN(speed) ? speed * 3.6 : null, lim = (r.limits || []).find(x => x.from <= N.idx && x.to >= N.idx)?.kmh;
  $("nvSpd").hidden = kmh == null && !lim;
  $("nvLim").hidden = !lim; $("nvLim").textContent = lim || "";
  $("nvCur").textContent = kmh != null ? Math.round(kmh) : "–";
  $("nvCurW").classList.toggle("over", !!(lim && kmh > lim + 3));
  // viagem
  $("nvEta").textContent = hora(Date.now() + restT*1000);
  const mins = Math.max(0, Math.round(restT/60));
  $("nvMin").textContent = mins >= 60 ? `${Math.floor(mins/60)}:${String(mins%60).padStart(2,"0")}` : mins; $("nvMinU").textContent = mins >= 60 ? "h" : "min";
  $("nvKm").textContent = left >= 1000 ? nf(left/1000, left < 10000 ? 1 : 0) : Math.round(left/10)*10; $("nvKmU").textContent = left >= 1000 ? "km" : "m";
  // voz: aviso antecipado e na hora da manobra
  if(next){ const key = next.at, far = R.mode === "car" ? 500 : 150, near = R.mode === "car" ? 120 : 40, said = N.said[key] || 0;
    if(toNext <= far && toNext > near && said < 1){ N.said[key] = 1; say(`Em ${fmtD(Math.round(toNext/50)*50)}, ${next.txt}`); }
    else if(toNext <= near && said < 2){ N.said[key] = 2; say(next.txt); } }
  // seta branca da próxima manobra, desenhada sobre a rota
  N.man = null;
  if(next && toNext < 700 && !["straight","arrive"].includes(next.man)){
    const d0 = atD(next) - 30, d1 = atD(next) + 22, cs = [];
    for(let x = d0; x <= d1; x += 4) cs.push(along(r, x));
    const tip = cs[cs.length-1]; N.man = {coords:cs, tip, h:brg(cs[cs.length-2], tip)};
  }
  if(left < 25 || hav(p, [R.b.lon, R.b.lat]) < 25){ say("Você chegou ao destino."); $("nvStreet").textContent = `Você chegou: ${R.b.name}`; $("nvDist").textContent = ""; $("nvTurn").innerHTML = turnSvg("arrive", 44, 2.6);
    if(N.timer) clearInterval(N.timer); N.timer = null; }
  draw();
  const m = window.Sat?.map(); if(!m) return;
  const bear = N.north ? 0 : N.hdg; $("nvN").style.transform = `rotate(${-bear}deg)`;
  const cardB = $("nvMan")?.getBoundingClientRect().bottom; if(cardB) $("rtNav").style.setProperty("--nv-card", `${Math.round(cardB)}px`);
  if(!N.over && !N.free){
    const L = land(), card = $("nvMan")?.getBoundingClientRect();
    // carro no terço de baixo da tela: a vista mostra o caminho à frente e as laterais, não o que ficou para trás
    // veículo centralizado na largura da tela (sobre a sua faixa) e um pouco abaixo do meio
    const pad = L ? {top:Math.round(innerHeight*.30), bottom:40, left:Math.round((card?.right || 360) + 10), right:70}
                  : {top:Math.round(innerHeight*.34), bottom:Math.round(innerHeight*.12), left:0, right:0};
    const z = R.mode === "car" ? Math.max(18.2, 19.4 - Math.max(0, (kmh || 0) - 40) / 60) : 19.2;   // perto do veículo
    const cam = {center:N.dpos || p, bearing:bear, pitch:N.north ? 0 : 60, zoom:Math.max(3, Math.min(20, z + (N.zoff || 0))), padding:pad};
    if(N.snapCam){ N.snapCam = false; m.jumpTo(cam); } else m.easeTo({...cam, duration:N.sim ? 380 : 900, easing:x => x});
  }
}

/* ---------- camada de trânsito (TomTom) ---------- */
const FLOW = () => `${TT}/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?tileSize=256&v=${Math.floor(Date.now()/120000)}`;
const ttV = () => Math.floor(Date.now()/((typeof TC === "object" && TC.sync || 60)*1000));
const FLOWV = () => `${TT}/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.pbf?v=${ttV()}`;
// incidentes em dados vetoriais (desenhados no estilo do sistema, em vez das setas prontas da TomTom)
const INC = () => `${TT}/traffic/map/4/tile/incidents/{z}/{x}/{y}.pbf?v=${ttV()}`;
// categorias TomTom → ícone, cor e nome
const INC_CAT = {0:["alert","#8E8E93","Ocorrência"],1:["burst","#FF3B30","Acidente"],2:["drop","#8E8E93","Neblina"],3:["alert","#FF9500","Condição perigosa"],4:["rain","#5AC8FA","Chuva"],
  5:["thermo","#5AC8FA","Gelo"],6:["car","#FF9500","Trânsito"],7:["road","#FF9500","Faixa fechada"],8:["x","#D70015","Via fechada"],9:["settings","#FF9500","Obras"],10:["wind","#8E8E93","Vento forte"],
  11:["waves","#0A84FF","Alagamento"],14:["car","#FF9500","Veículo parado"]};
const INC_PT = {"Stationary traffic":"Trânsito parado","Queuing traffic":"Fila","Slow traffic":"Trânsito lento","Heavy traffic":"Trânsito intenso","Closed":"Via fechada","Road closed":"Via fechada",
  "Roadworks":"Obras","Road works":"Obras","Accident":"Acidente","Lane closed":"Faixa fechada","Lanes closed":"Faixas fechadas","Broken down vehicle":"Veículo quebrado","Flooding":"Alagamento","Cluster":"Vários incidentes"};
const ROAD_PT = {"Motorway":"rodovia","International road":"via principal","Major road":"via principal","Secondary road":"via secundária","Connecting road":"via de ligação","Major local road":"avenida","Local road":"rua local","Minor local road":"rua"};
const MAG = ["#8E8E93","#FFCC00","#FF9500","#FF3B30","#B3001B"];
let tTimer = null;
function incIcons(m){
  for(const [k, [ico, col]] of Object.entries(INC_CAT)){ const id = "inc-" + k; if(m.hasImage(id)) continue;
    const s = 44, cv = document.createElement("canvas"); cv.width = cv.height = s; const g = cv.getContext("2d");
    g.fillStyle = "rgba(0,0,0,.28)"; g.beginPath(); g.arc(s/2, s/2 + 1.5, s/2 - 3, 0, 7); g.fill();
    g.fillStyle = col; g.beginPath(); g.arc(s/2, s/2, s/2 - 4, 0, 7); g.fill(); g.lineWidth = 3; g.strokeStyle = "#fff"; g.stroke();
    window.IcoPaint?.(g, ico, s/2, s/2, 20, "#fff", 2.4);
    m.addImage(id, g.getImageData(0, 0, s, s), {pixelRatio:2}); }
}
function trafficLayers(){
  const m = window.Sat?.map(); if(!m || !m.getStyle() || !m.getSource("omt")) return null;   // isStyleLoaded() fica falso enquanto há tiles carregando
  if(!m.getSource("tt-flowv")){
    m.addSource("tt-incv", {type:"vector", tiles:[INC()], minzoom:3, maxzoom:18});
    incIcons(m);
    const before = m.getLayer("rt-alt") ? "rt-alt" : m.getLayer("measure-line") ? "measure-line" : undefined;
    const cat = ["to-string",["coalesce",["get","icon_category_0"],["get","icon_category"],0]];
    // fluxo em linhas vetoriais: uma por sentido, deslocada para o lado da mão de direção, cor pela velocidade relativa
    m.addSource("tt-flowv", {type:"vector", tiles:[FLOWV()], minzoom:6, maxzoom:18});
    const LV = ["coalesce",["get","traffic_level"],1];
    m.addLayer({id:"tt-flow", type:"line", source:"tt-flowv", "source-layer":"Traffic flow", minzoom:9, layout:{visibility:"none", "line-cap":"round", "line-join":"round"},
      paint:{"line-color":["step",LV,"#9B0D1E",.15,"#E5352B",.4,"#FF9F0A",.7,"#34C759"],
        "line-width":["interpolate",["exponential",1.4],["zoom"],9,.6,13,1.1,16,2,19,3.6],
        "line-offset":["interpolate",["exponential",1.4],["zoom"],9,.5,13,1,16,2.4,19,5.5],
        "line-opacity":["step",LV,.95,.7,.6]}}, before);
    m.addLayer({id:"tt-flow-anim", type:"line", source:"tt-flowv", "source-layer":"Traffic flow", minzoom:12, filter:["<",LV,.7], layout:{visibility:"none", "line-cap":"butt", "line-join":"round"},
      paint:{"line-color":"rgba(255,255,255,.8)", "line-width":["interpolate",["exponential",1.4],["zoom"],12,.7,16,1.4,19,2.4],
        "line-offset":["interpolate",["exponential",1.4],["zoom"],9,.5,13,1,16,2.4,19,5.5], "line-dasharray":[0,4,3]}}, before);
    m.addLayer({id:"tt-inc-line", type:"line", source:"tt-incv", "source-layer":"Traffic incident flow", minzoom:10, layout:{visibility:"none", "line-cap":"round", "line-join":"round"},
      paint:{"line-color":["case",["==",cat,"8"],"#D70015",["match",["to-number",["coalesce",["get","magnitude"],1]],0,MAG[0],1,MAG[1],2,MAG[2],3,MAG[3],MAG[4]]], "line-width":["interpolate",["linear"],["zoom"],10,2,16,4.5,19,8],
        "line-opacity":.9}}, before);
    m.addLayer({id:"tt-inc-clu", type:"circle", source:"tt-incv", "source-layer":"Traffic incident POI", filter:["has","cluster_size"], layout:{visibility:"none"},
      paint:{"circle-radius":["interpolate",["linear"],["get","cluster_size"],2,9,20,15], "circle-color":"#FF9500", "circle-stroke-color":"#fff", "circle-stroke-width":2}}, before);
    m.addLayer({id:"tt-inc-clu-n", type:"symbol", source:"tt-incv", "source-layer":"Traffic incident POI", filter:["has","cluster_size"], layout:{visibility:"none", "text-field":["to-string",["get","cluster_size"]], "text-font":["Noto Sans Bold"], "text-size":11, "text-allow-overlap":true},
      paint:{"text-color":"#fff"}}, before);
    m.addLayer({id:"tt-inc-ico", type:"symbol", source:"tt-incv", "source-layer":"Traffic incident POI", filter:["!",["has","cluster_size"]], layout:{visibility:"none",
      "icon-image":["concat","inc-",["match",cat,["1","2","3","4","5","6","7","8","9","10","11","14"],cat,"0"]], "icon-size":["interpolate",["linear"],["zoom"],10,.42,16,.6], "icon-allow-overlap":false, "icon-padding":4}}, before);
    m.on("click", "tt-inc-ico", e => { const p = e.features?.[0]?.properties; if(!p) return;
      const c = INC_CAT[p.icon_category_0] || INC_CAT[0], d = INC_PT[p.description_0] || p.description_0 || c[2], atraso = +p.delay > 30 ? ` · atraso de ${fmtT(+p.delay)}` : "", via = ROAD_PT[p.road_type] ? ` · ${ROAD_PT[p.road_type]}` : "";
      new maplibregl.Popup({closeButton:false, className:"inc-pop", offset:14}).setLngLat(e.lngLat).setHTML(`<b>${esc(d)}</b><small>${esc(c[2])}${atraso}${via}</small>`).addTo(m); });
    m.on("mouseenter", "tt-inc-ico", () => { m.getCanvas().style.cursor = "pointer"; }); m.on("mouseleave", "tt-inc-ico", () => { m.getCanvas().style.cursor = ""; });
    // trânsito em cima de pontes e viadutos: faixa 3D na altura do tabuleiro, do lado da mão de direção
    m.addSource("tt-rib", {type:"geojson", data:fc([])});
    m.addLayer({id:"tt-rib", type:"fill-extrusion", source:"tt-rib", minzoom:15, layout:{visibility:"none"},
      paint:{"fill-extrusion-base":["get","b"], "fill-extrusion-height":["get","t"], "fill-extrusion-color":["get","c"], "fill-extrusion-opacity":1}});
    m.on("idle", () => { if(R.traffic) trafficRibbon(); });
    if(saved) stackTop(m);
  }
  return m;
}
let tribKey = "";
function trafficRibbon(){
  const m = window.Sat?.map(); if(!m || !window.Bridges) return;
  if(m.getZoom() < 15 || !window.Bridges.isOn() || !R.traffic){ if(tribKey){ window.Bridges.setOverlay("traffic", []); tribKey = ""; } return; }
  const k = `${m.getZoom().toFixed(1)}|${m.getCenter().lng.toFixed(3)}|${m.getCenter().lat.toFixed(3)}|${window.Bridges.ver}`; if(k === tribKey) return; tribKey = k;
  const col = lv => lv < .15 ? "#9B0D1E" : lv < .4 ? "#E5352B" : lv < .7 ? "#FF9F0A" : "#34C759", list = [];
  // só os trechos de trânsito que passam por um tabuleiro (o resto continua desenhado no chão)
  for(const f of m.querySourceFeatures("tt-flowv", {sourceLayer:"Traffic flow"})){
    const lines = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [];
    for(const ln of lines) if(ln.some(q => window.Bridges.absAt(q[0], q[1]) != null) || (ln.length > 1 && window.Bridges.absAt((ln[0][0]+ln[1][0])/2, (ln[0][1]+ln[1][1])/2) != null))
      list.push({coords:ln, color:col(+(f.properties.traffic_level ?? 1)), w:.55, off:-2.2});
  }
  window.Bridges.setOverlay("traffic", list);
}
addEventListener("bridges3d", () => { tribKey = ""; trafficRibbon(); });
const TT_LAYERS = ["tt-rib","tt-flow","tt-flow-anim","tt-inc-line","tt-inc-clu","tt-inc-clu-n","tt-inc-ico"];
/* ---------- configuração do trânsito (widget ao tocar em "Trânsito") ---------- */
// categorias TomTom: 1 acidente, 2 neblina, 3 perigo, 4 chuva, 5 gelo, 6 congestionamento, 7 faixa fechada,
// 8 via bloqueada, 9 obras, 10 vento, 11 alagamento, 14 veículo quebrado
const TT_GRP = {acid:["1","14"], obras:["7","9"], bloq:["8"], cong:["6"], clima:["2","3","4","5","10","11"], outros:["0"]};
const TT_GRP_N = {acid:"Acidentes", obras:"Obras e faixas", bloq:"Vias bloqueadas", cong:"Congestionamentos", clima:"Clima e perigos", outros:"Outros"};
const TT_DEF = {flow:true, free:true, lw:1, op:.95, pal:"padrao", inc:true, incl:true, ico:1, rib:true, sync:60, anim:true, grp:{acid:true, obras:true, bloq:true, cong:true, clima:true, outros:true}};
let TC = {...TT_DEF, ...store.get("tt-cfg", {})}; TC.grp = {...TT_DEF.grp, ...(TC.grp || {})};
const TT_PAL = {padrao:["#9B0D1E","#E5352B","#FF9F0A","#34C759"], contraste:["#6A0010","#FF1E1E","#FFD60A","#00C7BE"], mono:["#5B0A12","#C21F2B","#E8743B","#9AA3AD"]};
function trafficApply(){
  const m = window.Sat?.map(); if(!m || !m.getLayer("tt-flow")) return;
  const on = R.traffic, vis = (id, v) => m.getLayer(id) && m.setLayoutProperty(id, "visibility", on && v ? "visible" : "none");
  const LV = ["coalesce",["get","traffic_level"],1], P = TT_PAL[TC.pal] || TT_PAL.padrao, k = TC.lw;
  vis("tt-flow", TC.flow); vis("tt-flow-anim", TC.flow && TC.anim); vis("tt-inc-line", TC.incl); vis("tt-rib", TC.rib); ttAnim();
  ["tt-inc-clu","tt-inc-clu-n","tt-inc-ico"].forEach(id => vis(id, TC.inc));
  m.setFilter("tt-flow", TC.free ? null : ["<", LV, .7]);
  m.setPaintProperty("tt-flow", "line-color", ["step",LV,P[0],.15,P[1],.4,P[2],.7,P[3]]);
  m.setPaintProperty("tt-flow", "line-width", ["interpolate",["exponential",1.4],["zoom"],9,.6*k,13,1.1*k,16,2*k,19,3.6*k]);
  m.setPaintProperty("tt-flow", "line-opacity", ["step",LV,TC.op,.7,TC.op*.63]);
  const cat = ["to-string",["coalesce",["get","icon_category_0"],["get","icon_category"],0]];
  const ok = Object.entries(TC.grp).filter(([, v]) => v).flatMap(([g]) => TT_GRP[g]);
  m.setFilter("tt-inc-ico", ["all", ["!",["has","cluster_size"]], ["in", cat, ["literal", ok.length ? ok : ["-"]]]]);
  m.setLayoutProperty("tt-inc-ico", "icon-size", ["interpolate",["linear"],["zoom"],10,.42*TC.ico,16,.6*TC.ico]);
}
/* ---------- tempo real ---------- */
const TTA = [[0,4,3],[.5,4,2.5],[1,4,2],[1.5,4,1.5],[2,4,1],[2.5,4,.5],[3,4,0],[0,.5,3,3.5],[0,1,3,3],[0,1.5,3,2.5],[0,2,3,2],[0,2.5,3,1.5],[0,3,3,1],[0,3.5,3,.5]];
let ttAt = 0, ttTick = 0, ttAnimT = 0, ttStep = 0;
function ttAnim(){
  clearInterval(ttAnimT); const m = window.Sat?.map();
  if(!m || !R.traffic || !TC.flow || !TC.anim) return;
  ttAnimT = setInterval(() => { if(document.hidden || !m.getLayer("tt-flow-anim") || m.getZoom() < 12) return; ttStep = (ttStep + 1) % TTA.length; m.setPaintProperty("tt-flow-anim", "line-dasharray", TTA[ttStep]); }, 90);
}
// recarrega os tiles de fluxo e ocorrências (os antigos ficam na tela até os novos chegarem — sem piscar)
function trafficSync(force){
  const m = window.Sat?.map(); if(!m || !R.traffic || !m.getSource("tt-flowv")) return;
  if(!force && document.hidden) return;
  try{ m.getSource("tt-flowv").setTiles([FLOWV() + (force ? "&f=" + Date.now() : "")]); m.getSource("tt-incv").setTiles([INC() + (force ? "&f=" + Date.now() : "")]); }catch(e){}
  ttAt = Date.now(); m.once("idle", () => { tribKey = ""; trafficRibbon(); ttResumo(); });
}
function ttTimer(){ clearInterval(tTimer); if(R.traffic) tTimer = setInterval(() => trafficSync(false), (TC.sync || 60)*1000); }
document.addEventListener("visibilitychange", () => { if(!document.hidden && R.traffic && Date.now() - ttAt > (TC.sync || 60)*1000) trafficSync(true); });
// o que está acontecendo na área visível: lentidão por trecho e ocorrências por tipo
function ttResumo(){
  const el = $("ttRes"), m = window.Sat?.map(); if(!el || !m || !R.traffic) return;
  if(m.getZoom() < 9){ el.innerHTML = `<small class="tc-hint">Aproxime o mapa (cidade) para ver o resumo do trânsito.</small>`; return; }
  const fl = m.getLayer("tt-flow") ? m.queryRenderedFeatures({layers:["tt-flow"]}) : [];
  const b = [0, 0, 0, 0]; for(const f of fl){ const v = +f.properties.traffic_level; b[v < .15 ? 0 : v < .4 ? 1 : v < .7 ? 2 : 3]++; }
  const tot = b.reduce((a, c) => a + c, 0) || 1, P = TT_PAL[TC.pal] || TT_PAL.padrao, lento = Math.round((b[0] + b[1] + b[2])/tot*100);
  const ic = m.getLayer("tt-inc-ico") ? m.queryRenderedFeatures({layers:["tt-inc-ico"]}) : [], vistos = new Set(), lista = [];
  for(const f of ic){ const p = f.properties, k = p.id || `${f.geometry.coordinates}`; if(vistos.has(k)) continue; vistos.add(k); lista.push(f); }
  const cnt = {}; for(const f of lista){ const c = String(f.properties.icon_category_0 ?? f.properties.icon_category ?? 0), g = Object.keys(TT_GRP).find(k => TT_GRP[k].includes(c)) || "outros"; cnt[g] = (cnt[g] || 0) + 1; }
  const c0 = m.getCenter(), dist = f => { const q = f.geometry.coordinates; return Math.hypot((q[0] - c0.lng)*Math.cos(c0.lat*Math.PI/180), q[1] - c0.lat); };
  lista.sort((a, c) => (+c.properties.magnitude || 0) - (+a.properties.magnitude || 0) || dist(a) - dist(c));
  el.innerHTML = `<div class="tc-bar">${b.map((n, i) => n ? `<i style="flex:${n};background:${P[i]}"></i>` : "").join("")}</div>
    <div class="tc-sum"><b>${fl.length ? lento + "%" : "—"}</b><span>${fl.length ? "dos trechos com lentidão na tela" : "sem dados de fluxo nesta área"}</span></div>
    ${lista.length ? `<div class="tc-cnt">${Object.entries(cnt).map(([g, n]) => `<span>${n} ${TT_GRP_N[g].toLowerCase()}</span>`).join("")}</div>
      <div class="tc-list">${lista.slice(0, 6).map((f, i) => { const p = f.properties, c = INC_CAT[p.icon_category_0] || INC_CAT[0], d = INC_PT[p.description_0] || p.description_0 || c[2];
        const at = +p.delay > 30 ? ` · +${fmtT(+p.delay)}` : "", via = p.road_numbers || p.from || "";
        return `<button data-ti="${i}"><u style="background:${c[1]}">${window.Ico?.(c[0], 14) || ""}</u><span><b>${esc(d)}</b><small>${esc(c[2])}${at}${via ? " · " + esc(String(via).replace(/[\[\]"]/g, "")) : ""}</small></span></button>`; }).join("")}</div>` : `<small class="tc-hint">Nenhuma ocorrência na tela.</small>`}`;
  el.querySelectorAll("[data-ti]").forEach(bt => bt.onclick = () => { const f = lista[+bt.dataset.ti]; m.flyTo({center:f.geometry.coordinates, zoom:Math.max(15, m.getZoom()), duration:1200}); });
}
function trafficCfg(){
  let el = $("ttCfg"); if(el){ el.remove(); return; }
  el = document.createElement("section"); el.id = "ttCfg"; el.className = "tt-cfg glass"; el.setAttribute("aria-label", "Configurar trânsito"); document.body.appendChild(el);
  const ic = (n, s=18) => window.Ico?.(n, s) || "", sw = (k, n, sub) => `<label class="tc-sw"><span><b>${n}</b>${sub ? `<small>${sub}</small>` : ""}</span><input type="checkbox" data-tc="${k}" ${TC[k] ? "checked" : ""}><i></i></label>`;
  const seg = (k, opts) => `<div class="tc-seg">${opts.map(([v, n]) => `<button data-ts="${k}" data-v="${v}" aria-pressed="${String(TC[k]) === String(v)}">${n}</button>`).join("")}</div>`;
  const draw = () => { el.innerHTML = `<header><b>${ic("traffic")} Trânsito ao vivo</b><button class="tc-x" aria-label="Fechar">${ic("x", 16)}</button></header>
    <label class="tc-sw tc-main"><span><b>Mostrar trânsito</b><small>TomTom · atualiza a cada 2 min</small></span><input type="checkbox" data-tm ${R.traffic ? "checked" : ""}><i></i></label>
    <div class="tc-body"${R.traffic ? "" : " hidden"}>
    <div class="tc-live"><i></i><span id="ttAge">ao vivo</span><button class="tc-now" id="ttNow">${ic("refresh", 15)} Atualizar</button></div>
    <div class="tc-row"><span>Sincronizar a cada</span>${seg("sync", [[30, "30 s"], [60, "1 min"], [120, "2 min"]])}</div>
    <h4>Nesta tela</h4><div id="ttRes" class="tc-res"></div>
    <h4>Linhas</h4>${sw("flow", "Fluxo nas vias", "cor pela velocidade")}${sw("anim", "Animar o fluxo", "traços andando nos trechos lentos")}${sw("free", "Mostrar trânsito livre", "verde; desligado = só lentidão")}
    <div class="tc-row"><span>Espessura</span>${seg("lw", [[.6, "Fina"], [1, "Normal"], [1.6, "Grossa"], [2.3, "Extra"]])}</div>
    <div class="tc-row"><span>Opacidade</span><input type="range" min=".3" max="1" step=".05" value="${TC.op}" data-tr="op"></div>
    <div class="tc-row"><span>Cores</span>${seg("pal", [["padrao", "Padrão"], ["contraste", "Contraste"], ["mono", "Discreto"]])}</div>
    <div class="tc-pal">${(TT_PAL[TC.pal] || TT_PAL.padrao).map((c, i) => `<span><u style="background:${c}"></u>${["Parado","Lento","Moderado","Livre"][i]}</span>`).join("")}</div>
    ${sw("rib", "Trânsito sobre viadutos e pontes", "faixa 3D na altura da pista")}
    <h4>Marcações</h4>${sw("inc", "Ícones de ocorrências", "toque no ícone para ver o detalhe")}${sw("incl", "Trechos afetados", "linha sobre a via da ocorrência")}
    <div class="tc-chips">${Object.keys(TT_GRP).map(g => `<button data-tg="${g}" aria-pressed="${!!TC.grp[g]}">${TT_GRP_N[g]}</button>`).join("")}</div>
    <div class="tc-row"><span>Tamanho dos ícones</span>${seg("ico", [[.75, "P"], [1, "M"], [1.35, "G"]])}</div>
    <button class="tc-reset">Restaurar padrão</button></div>`;
    el.querySelector(".tc-x").onclick = () => el.remove();
    el.querySelector("[data-tm]").onchange = e => { setTraffic(e.target.checked); draw(); };
    el.querySelectorAll("[data-tc]").forEach(i => i.onchange = () => { TC[i.dataset.tc] = i.checked; salvar(); });
    el.querySelectorAll("[data-ts]").forEach(b => b.onclick = () => { const v = b.dataset.v; TC[b.dataset.ts] = isNaN(+v) ? v : +v; salvar(); draw(); });
    el.querySelectorAll("[data-tr]").forEach(i => i.oninput = () => { TC[i.dataset.tr] = +i.value; salvar(); });
    el.querySelectorAll("[data-tg]").forEach(b => b.onclick = () => { TC.grp[b.dataset.tg] = !TC.grp[b.dataset.tg]; b.setAttribute("aria-pressed", TC.grp[b.dataset.tg]); salvar(); });
    el.querySelector(".tc-reset").onclick = () => { TC = JSON.parse(JSON.stringify(TT_DEF)); salvar(); draw(); };
    const nb = $("ttNow"); if(nb) nb.onclick = () => { trafficSync(true); nb.classList.add("on"); setTimeout(() => nb.classList.remove("on"), 900); };
    ttResumo(); window.Sat?.map()?.once("idle", ttResumo);
  };
  const salvar = () => { store.set("tt-cfg", TC); trafficApply(); ttTimer(); };
  draw();
  // relógio "atualizado há…" e resumo ao mexer no mapa, enquanto o widget estiver aberto
  const m = window.Sat?.map(), mv = () => ttResumo();
  m?.on("moveend", mv);
  const relog = setInterval(() => { if(!el.isConnected){ clearInterval(relog); m?.off("moveend", mv); return; }
    const a = $("ttAge"); if(a) a.textContent = ttAt ? `atualizado há ${Math.round((Date.now() - ttAt)/1000)} s · próxima em ${Math.max(0, Math.round(((TC.sync || 60)*1000 - (Date.now() - ttAt))/1000))} s` : "ao vivo"; }, 1000);
}
function setTraffic(on){
  R.traffic = on; store.set("rt-traffic", on);
  const m = trafficLayers(); if(!m){ setTimeout(() => setTraffic(R.traffic), 800); return; }
  for(const id of TT_LAYERS) if(m.getLayer(id)) m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  trafficApply();
  tribKey = ""; trafficRibbon();
  ttAt = Date.now(); ttTimer(); if(!on) clearInterval(ttAnimT);
}
if(R.traffic) setTimeout(() => setTraffic(true), 2500);

window.Rotas = {trafficCfg, open, close, to: p => { open(); set("b", p); }, from: p => { open(); set("a", p); }, setTraffic, isTraffic: () => R.traffic, setLook, isLook: () => R.look, bases: () => BASES, baseThumb: bThumb, pickBase, curBase, isOpen: () => !!$("rtPanel") && !$("rtPanel").hidden};
})();
