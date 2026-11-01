/* =============================================================================
   AEROPORTOS + SIMULADOR DE VOO (arcade)
   · 4.940 aeroportos do mundo (OurAirports, domínio público) com a pista mais longa.
   · Clique num aeroporto → escolha a aeronave (pequeno, médio, grande, caça
     supersônico) e o modo (até um destino ou voo livre) → decola da cabeceira
     real da pista, sobre o globo 3D com relevo e imagem de satélite.
   · Física simplificada: tração, arrasto, gravidade na subida, estol, curva por
     inclinação, pouso avaliado por razão de descida. Pontos, recordes, tempo ×1/×4/×16.
   ============================================================================= */
(() => {
"use strict";
const C = window.ClimaCore;
const {$, esc, r0, r1} = C;
const store = {
  get(k,d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const D2R = Math.PI/180, R2D = 180/Math.PI, G = 9.81, KT = 1.94384, FT = 3.28084;
let AP = null, on = store.get("air-on", true);

/* ---------- aeronaves ---------- */
const PLANES = {
  pequeno:{nome:"Pequeno", modelo:"Monomotor tipo Cessna 172", ic:"🛩", vmax:64, vr:28, vs:24, acc:2.4, ceil:4200, roll:45, rr:60, pr:14, pmax:18, back:28, up:7, range:1200, score:1},
  medio:  {nome:"Médio", modelo:"Regional tipo Embraer E195", ic:"✈", vmax:240, vr:68, vs:58, acc:3.0, ceil:12500, roll:30, rr:30, pr:6, pmax:20, back:70, up:16, range:4000, score:1.2},
  grande: {nome:"Grande", modelo:"Widebody tipo Boeing 777", ic:"🛫", vmax:258, vr:82, vs:70, acc:2.2, ceil:13100, roll:28, rr:22, pr:4.5, pmax:18, back:105, up:24, range:15000, score:1.4},
  caca:   {nome:"Caça supersônico", modelo:"Mach 2 tipo F-22 / Gripen", ic:"🚀", vmax:680, vr:72, vs:52, acc:22, ceil:18000, roll:85, rr:180, pr:28, pmax:75, back:42, up:9, range:20000, score:1.6}
};

/* ---------- camada de aeroportos ---------- */
function install(){
  const m = window.Sat?.map(); if(!m) return false;
  if(m.getLayer("airports")) return true;
  if(!m.isStyleLoaded()){ m.once("idle", install); return true; }
  m.addSource("airports", {type:"geojson", data:"data-airports.json"});
  m.addLayer({id:"airports", type:"circle", source:"airports", layout:{visibility: on ? "visible" : "none"},
    filter:["any",["==",["get","t"],"L"],[">=",["zoom"],5]],
    paint:{"circle-radius":["interpolate",["linear"],["zoom"],2,["case",["==",["get","t"],"L"],3,1.5],8,["case",["==",["get","t"],"L"],8,5],12,11],
      "circle-color":["case",["==",["get","t"],"L"],"#0A84FF","#5AC8FA"], "circle-stroke-color":"#fff", "circle-stroke-width":1.5}}, "measure-line");
  m.addLayer({id:"airports-lbl", type:"symbol", source:"airports", minzoom:4, layout:{visibility: on ? "visible" : "none",
      "text-field":["step",["zoom"],["coalesce",["get","i"],["get","c"]],8,["concat",["coalesce",["get","i"],["get","c"]],"\n",["get","n"]]],
      "text-font":["Noto Sans Bold"], "text-size":["interpolate",["linear"],["zoom"],4,10,10,12], "text-offset":[0,1.1], "text-anchor":"top", "text-max-width":10, "text-optional":true,
      "symbol-sort-key":["case",["==",["get","t"],"L"],0,1]},
    paint:{"text-color":"#CFE8FF", "text-halo-color":"rgba(0,0,0,.85)", "text-halo-width":1.4}}, "measure-line");
  m.on("click", "airports", e=>{ if(SIM) return; const f = e.features?.[0]; if(f) airportModal(f); });
  m.on("mouseenter", "airports", ()=>{ m.getCanvas().style.cursor = "pointer"; });
  m.on("mouseleave", "airports", ()=>{ m.getCanvas().style.cursor = ""; });
  return true;
}
const iv = setInterval(()=>{ if(install()) clearInterval(iv); }, 800);
async function loadAP(){ if(!AP) AP = (await (await fetch("data-airports.json")).json()).features; return AP; }
function setOn(v){ on = v; store.set("air-on", on); const m = window.Sat?.map(); if(!m || !install()) return;
  ["airports","airports-lbl"].forEach(id=>m.getLayer(id) && m.setLayoutProperty(id, "visibility", on ? "visible" : "none")); }

/* ---------- geodésia ---------- */
const hav = (a, b) => { const R = 6371000, dLa = (b[1]-a[1])*D2R, dLo = (b[0]-a[0])*D2R;
  return 2*R*Math.asin(Math.sqrt(Math.sin(dLa/2)**2 + Math.cos(a[1]*D2R)*Math.cos(b[1]*D2R)*Math.sin(dLo/2)**2)); };
const brg = (a, b) => { const y = Math.sin((b[0]-a[0])*D2R)*Math.cos(b[1]*D2R), x = Math.cos(a[1]*D2R)*Math.sin(b[1]*D2R) - Math.sin(a[1]*D2R)*Math.cos(b[1]*D2R)*Math.cos((b[0]-a[0])*D2R);
  return (Math.atan2(y,x)*R2D + 360) % 360; };
const move = (lon, lat, hdg, d) => [lon + d*Math.sin(hdg*D2R)/(111320*Math.cos(lat*D2R)), lat + d*Math.cos(hdg*D2R)/110540];
const fmtKm = m => m >= 10000 ? `${r0(m/1000)} km` : m >= 1000 ? `${r1(m/1000)} km` : `${r0(m)} m`;

/* ---------- modal do aeroporto + configuração do voo ---------- */
let cfg = {plane: store.get("sim-plane","medio"), mode:"dest", dest:null};
async function airportModal(f){
  const p = f.properties, [lon, lat] = f.geometry.coordinates;
  await loadAP();
  const near = AP.filter(a=>a !== f && a.properties.t==="L").map(a=>({a, d:hav([lon,lat], a.geometry.coordinates)})).filter(x=>x.d > 50000).sort((x,y)=>x.d-y.d).slice(0, 6);
  cfg.dest = cfg.dest && cfg.dest.properties.c !== p.c ? cfg.dest : near[0]?.a || null;
  const best = store.get("sim-best", {});
  const render = () => {
    const pl = PLANES[cfg.plane];
    C.openModal({icon:`<span class="pl-ic" style="background:#0A84FF">🛫</span>`, title:`${esc(p.i || p.c)} · ${esc(p.n)}`, sub:esc([p.m, p.k].filter(Boolean).join(" · ")),
      kpis:[["IATA / ICAO", `${esc(p.i||"—")} / ${esc(p.c||"—")}`, ""], ["Pista principal", esc(p.rn), `${p.rl.toLocaleString("pt-BR")} m`], ["Rumo da pista", `${p.h}°`, ""], ["Altitude", `${p.e.toLocaleString("pt-BR")} m`, `${r0(p.e*FT).toLocaleString("pt-BR")} ft`]],
      html:`<h4 class="msub">🎮 Simulador de voo — escolha a aeronave</h4>
        <div class="sim-planes">${Object.entries(PLANES).map(([k,v])=>`<button type="button" class="sim-pl" data-sp="${k}" aria-pressed="${cfg.plane===k}"><span>${v.ic}</span><b>${v.nome}</b><small>${v.modelo}</small><em>até ${r0(v.vmax*KT)} kt · teto ${r0(v.ceil*FT/1000)} mil ft</em>${best[k]?`<i>🏆 ${best[k].toLocaleString("pt-BR")}</i>`:""}</button>`).join("")}</div>
        <h4 class="msub">Modo</h4>
        <div class="seg txt sim-mode"><button data-sm="dest" aria-pressed="${cfg.mode==="dest"}">🎯 Voo até um destino</button><button data-sm="free" aria-pressed="${cfg.mode==="free"}">🌍 Voo livre</button></div>
        ${cfg.mode==="dest" ? `<div class="sim-dest"><input id="simQ" placeholder="Buscar destino (cidade, nome, IATA)" autocomplete="off"><div id="simRes" class="sim-res">${near.map(x=>destBtn(x.a, x.d)).join("")}</div>
          <p class="sim-sel">Destino: ${cfg.dest ? `<b>${esc(cfg.dest.properties.i||cfg.dest.properties.c)}</b> · ${esc(cfg.dest.properties.n)} · ${fmtKm(hav([lon,lat], cfg.dest.geometry.coordinates))}` : "escolha acima"}</p></div>` : `<p class="sim-sel">Decole e voe para onde quiser. Pontos por distância percorrida e pelo pouso.</p>`}
        <p class="sim-help">Comandos: <kbd>↑</kbd> sobe · <kbd>↓</kbd> desce · <kbd>←</kbd><kbd>→</kbd> curva · <kbd>E</kbd>/<kbd>Q</kbd> (ou <kbd>Shift</kbd>/<kbd>Ctrl</kbd>) potência · <kbd>B</kbd> freio · <kbd>C</kbd> câmera · <kbd>T</kbd> tempo ×1/×4/×16 · <kbd>Esc</kbd> sair. No celular, use os botões na tela.</p>`,
      actions:[{label:"🛫 Decolar", primary:true, fn:()=>{ if(cfg.mode==="dest" && !cfg.dest) cfg.dest = near[0]?.a || null; if(cfg.mode==="dest" && !cfg.dest) cfg.mode = "free"; C.closeModal(); start(f); }},
        {label:"🔍 Aproximar", fn:()=>{ C.closeModal(); window.Sat.map().flyTo({center:[lon,lat], zoom:14, pitch:55, bearing:p.h, duration:1800}); }},
        {label:"☀ Previsão daqui", fn:()=>{ C.closeModal(); C.load({name:p.m || p.n, admin:"", country:p.k, lat:+lat.toFixed(4), lon:+lon.toFixed(4)}); }}]});
    const md = $("modal");
    md.querySelectorAll("[data-sp]").forEach(b=>b.onclick=()=>{ cfg.plane = b.dataset.sp; store.set("sim-plane", cfg.plane); render(); });
    md.querySelectorAll("[data-sm]").forEach(b=>b.onclick=()=>{ cfg.mode = b.dataset.sm; render(); });
    const wire = () => md.querySelectorAll("[data-dest]").forEach(b=>b.onclick=()=>{ cfg.dest = AP.find(a=>a.properties.c===b.dataset.dest); render(); });
    wire();
    const q = $("simQ"); if(q) q.oninput = () => { const v = q.value.trim().toLowerCase(); if(v.length < 2) return;
      const hits = AP.filter(a=>{ const t = a.properties; return (t.i||"").toLowerCase()===v || (t.c||"").toLowerCase()===v || (t.n||"").toLowerCase().includes(v) || (t.m||"").toLowerCase().includes(v); })
        .sort((a,b)=>(a.properties.t==="L"?0:1)-(b.properties.t==="L"?0:1)).slice(0, 8);
      $("simRes").innerHTML = hits.map(a=>destBtn(a, hav([lon,lat], a.geometry.coordinates))).join("") || `<small>Nada encontrado</small>`; wire(); };
  };
  render();
}
const destBtn = (a, d) => `<button type="button" class="sim-d" data-dest="${esc(a.properties.c)}"><b>${esc(a.properties.i||a.properties.c)}</b><span>${esc(a.properties.m||a.properties.n)}</span><em>${fmtKm(d)}</em></button>`;

/* ---------- simulação ---------- */
let SIM = null;
const keys = new Set(); let SJ = {};
const SENS = .6;   // sensibilidade dos comandos (taxas de arfagem e rolagem dos aviões × 0,6)
const HANDLERS = ["dragPan","scrollZoom","boxZoom","dragRotate","keyboard","doubleClickZoom","touchZoomRotate"];
function start(f){
  const m = window.Sat?.map(); if(!m) return;
  window.Sat.povStop?.();
  if(document.body.dataset.view !== "sat") location.hash = "#sat";
  if(!window.Sat.isClear()) window.Sat.setProd("earth");
  if(window.Sat.isBld && !window.Sat.isBld()) window.Sat.setBld(true);   // prédios 3D no voo
  const p = f.properties, pl = PLANES[cfg.plane];
  // propriedades vindas do mapa (MapLibre) chegam serializadas: a cabeceira "[lon,lat]" vira texto
  let rs = p.rs; if(typeof rs === "string"){ try{ rs = JSON.parse(rs); }catch(e){ rs = null; } }
  const [lon0, lat0] = Array.isArray(rs) && rs.length === 2 && isFinite(rs[0]) ? rs : f.geometry.coordinates;
  const g = m.queryTerrainElevation?.([lon0, lat0]); const ground = g != null && g > 0 ? g : Math.max(0, p.e);
  if(cfg.mode === "dest" && !cfg.dest) cfg.mode = "free";
  SIM = {pl, type:cfg.plane, mode:cfg.mode, from:p, dest:cfg.mode==="dest" ? cfg.dest : null,
    lon:lon0, lat:lat0, alt:ground + 2, hdg:p.h, pitch:0, roll:0, v:0, thr:1, ground:true, gnd:ground, t0:performance.now(), last:performance.now(),
    dist:0, maxAlt:0, warp:1, view:"pov", cam:null, over:false, auto:{mode:"takeoff"}, msg:"Decolagem automática… o controle passa para você a 200 m de altura."};
  try{ m.setMaxPitch(85); m.setMaxZoom(22); }catch(e){}
  HANDLERS.forEach(h=>m[h] && m[h].disable());
  document.body.classList.add("sim");
  loadAP(); hud(); requestAnimationFrame(loop);
}
function stop(){
  if(!SIM) return;
  SIM = null; keys.clear();
  const m = window.Sat?.map();
  if(m){ HANDLERS.forEach(h=>m[h] && m[h].enable()); try{ m.setMaxPitch(80); }catch(e){} m.easeTo({pitch:50, zoom:Math.min(m.getZoom(), 12), duration:1200}); }
  document.body.classList.remove("sim", "sim-cockpit");
  const bg = $("satbg"); if(bg) bg.style.transform = "";
  try{ if(mini){ mini.remove(); mini = null; } }catch(e){}
  const h = $("simHud"); if(h) h.remove();
}
// rAF quando disponível; relógio de reserva se o navegador não entregar quadros (aba em segundo plano, iframe)
let lastFrame = 0, wd = 0;
function loop(now){
  const S = SIM; if(!S) return;
  now = typeof now === "number" ? now : performance.now();
  if(now - lastFrame < 8) return; lastFrame = now;
  try{ step(now); }catch(e){ S.loopErr = e.message; console.warn("sim", e); }
  requestAnimationFrame(loop);
  clearTimeout(wd); wd = setTimeout(()=>loop(performance.now()), 50);
}
function step(now){
  const S = SIM; S.frames = (S.frames||0) + 1;
  const m = window.Sat.map(), pl = S.pl;
  let dt = Math.min(.05, (now - S.last)/1000); S.last = now;
  if(S.over){ render(m, dt); updHud(); return; }
  const steps = S.warp; dt = dt * 1;
  for(let s=0; s<steps; s++) physics(S, pl, dt);
  render(m, dt); updHud();
}
// ---------- piloto automático ----------
// decolagem: potência total, rotação na velocidade certa, subida de 10° até 200 m sobre o solo
function autoTakeoff(S, pl){
  keys.clear(); S.thr = 1;
  if(S.ground){ if(S.v >= pl.vr) keys.add("up"); }
  else {
    const agl = S.alt - S.gnd;
    if(S.pitch < 10) keys.add("up"); else if(S.pitch > 12) keys.add("down");
    if(agl >= 200){ S.auto = null; S.thr = .8; S.pitch = Math.min(S.pitch, 5); S.msg = "✅ 200 m — o controle é seu! ↑ ↓ altitude, ← → curvas, E/Q potência."; }
  }
}
// pouso: trajetória em 3 pernas (aproximação → final de 8 km alinhada à pista → cabeceira → rolagem),
// descendo para 300 m na aproximação e em rampa de ~3° na final; tempo comprimido para caber em ~40 s
function landTarget(S){
  const t = S.landAp; if(!t) return null;
  const p = t.properties; let rs = p.rs; if(typeof rs === "string"){ try{ rs = JSON.parse(rs); }catch(e){ rs = null; } }
  const thr = Array.isArray(rs) ? rs : t.geometry.coordinates, h = +p.h;
  const faf = move(thr[0], thr[1], h, -8000), roll = move(thr[0], thr[1], h, 900);
  return {thr, faf, roll, h, elev:Math.max(0, +p.e || 0)};
}
function startLanding(){
  const S = SIM; if(!S || S.ground || !S.near) return;
  S.landAp = S.near; const L = landTarget(S);
  const legs = [[S.lon,S.lat], L.faf, L.thr, L.roll];
  const d = [hav(legs[0],legs[1]), hav(legs[1],legs[2]), hav(legs[2],legs[3])], tot = d[0]+d[1]+d[2];
  S.auto = {mode:"land", legs, d, tot, s:0, alt0:S.alt, ground:L.elev, speed:Math.max(70, tot/40)};
  S.warp = 1; keys.clear();
  S.msg = `🛬 Pouso automático em ${S.near.properties.i || S.near.properties.c} — pista ${S.near.properties.rn}`;
}
function autoLand(S, dt){
  const A = S.auto; A.s = Math.min(A.tot, A.s + A.speed*dt);
  const [d0, d1] = A.d; let k, a, b, f;
  if(A.s <= d0){ k = 0; f = A.s/d0; } else if(A.s <= d0+d1){ k = 1; f = (A.s-d0)/d1; } else { k = 2; f = (A.s-d0-d1)/A.d[2]; }
  a = A.legs[k]; b = A.legs[k+1];
  S.lon = a[0] + (b[0]-a[0])*f; S.lat = a[1] + (b[1]-a[1])*f;
  const want = brg(a, b); S.hdg = (S.hdg + ((((want - S.hdg + 540) % 360) - 180))*Math.min(1, 3*dt) + 360) % 360;
  const gAlt = A.ground + 2;
  const target = k === 0 ? A.alt0 + (Math.max(gAlt + 300, Math.min(A.alt0, gAlt + 1200)) - A.alt0)*f
               : k === 1 ? (gAlt + 420) + (gAlt - (gAlt + 420))*f : gAlt;
  const prevAlt = S.alt; S.alt = target; S.vz = (S.alt - prevAlt)/Math.max(dt, 1e-3);
  S.pitch = k === 2 ? 0 : Math.max(-6, Math.min(6, Math.atan2(S.vz, A.speed)*R2D)); S.roll = k === 0 ? Math.max(-25, Math.min(25, (((want - S.hdg + 540) % 360) - 180))) : 0;
  S.v = k === 2 ? Math.max(0, 70*(1-f)) : Math.max(70, Math.min(S.pl.vmax, 85));
  if(k === 2 && !S.ground){ S.ground = true; S.touch = 1.4; S.msg = "Toque suave na pista. Freando…"; }
  S.dist += A.speed*dt;
  if(A.s >= A.tot){ S.auto = null; S.v = 0;
    if(S.mode === "dest" && S.dest){ const ok = S.landAp.properties.c === S.dest.properties.c; end(ok, ok ? null : `Pousou em ${S.landAp.properties.i || S.landAp.properties.c}, não no destino.`); }
    else end(true, null); }
}
// aeroporto mais próximo (para o botão "Pousar"): até 25 km, a cada 1 s
let nearT = 0;
function findNear(S){
  if(!AP || performance.now() - nearT < 1000) return; nearT = performance.now();
  if(S.ground || S.auto){ S.near = null; return; }
  let best = null, bd = 25000;
  for(const a of AP){ const c = a.geometry.coordinates; if(Math.abs(c[1]-S.lat) > .3 || Math.abs(c[0]-S.lon) > .4) continue;
    const d = hav([S.lon,S.lat], c); if(d < bd && (a.properties.c !== S.from.c || S.dist > 20000)){ bd = d; best = a; } }
  S.near = best; S.nearD = bd;
}
function physics(S, pl, dt){
  if(S.auto && S.auto.mode === "land"){ autoLand(S, dt); return; }
  if(S.auto && S.auto.mode === "takeoff") autoTakeoff(S, pl);
  findNear(S);
  // comandos
  if(keys.has("thr+")) S.thr = Math.min(1, S.thr + .6*dt);
  if(keys.has("thr-")) S.thr = Math.max(0, S.thr - .6*dt);
  // comandos como manche, não como interruptor: a entrada cresce em ~0,35 s, com curva suave nos toques curtos
  // (expo), e corre em tempo real — com o tempo acelerado (×4, ×16) a física roda várias vezes por quadro, mas
  // o manche não pode virar 16× mais sensível
  const dtR = dt / (S.warp || 1), ease = Math.min(1, dtR / .35);
  // teclado ou sticks: esquerdo = manche (↑↓ nariz, ←→ inclina); direito ↑↓ = potência
  const jl = SJ.l || {x:0, y:0}, jr = SJ.r || {x:0, y:0};
  const rawP = Math.max(-1, Math.min(1, (keys.has("up") ? 1 : 0) - (keys.has("down") ? 1 : 0) + jl.y)), rawR = Math.max(-1, Math.min(1, (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0) + jl.x));
  if(jr.y) S.thr = Math.max(0, Math.min(1, S.thr + jr.y * .7 * dtR));
  S.ip = (S.ip || 0) + (rawP - (S.ip || 0)) * ease; S.ir = (S.ir || 0) + (rawR - (S.ir || 0)) * ease;
  const pitchIn = S.ip * Math.abs(S.ip), rollIn = S.ir * Math.abs(S.ir);    // ↑ sobe o nariz, ↓ desce (estilo jogo)
  // velocidade: tração − arrasto − componente da gravidade (+ atrito/freio no chão)
  let a = S.thr*pl.acc - pl.acc*(S.v/pl.vmax)**2 - G*Math.sin(S.pitch*D2R)*.7;
  if(S.ground){ a = a*1.5 - (keys.has("brake") ? 3.5 : .25) * (S.v > 0 ? 1 : 0); }   // corrida de decolagem mais curta (arcade)
  S.v = Math.max(0, S.v + a*dt);
  // acima do teto o motor perde força: nariz desce aos poucos
  const air = !S.ground;
  if(air && S.alt > pl.ceil) S.pitch -= 3*dt;
  // arfagem
  if(S.ground){
    if(S.v >= pl.vr && (pitchIn > 0 || (S.v >= pl.vr*1.15 && S.thr > .5 && !S.touch))) S.pitch = Math.min(12, S.pitch + Math.max(pl.pr, 5)*dt);
    else S.pitch = Math.max(0, S.pitch - 4*dt);
  } else {
    S.pitch += pitchIn * pl.pr * SENS * dtR;
    if(Math.abs(rawP) < .5) S.pitch -= S.pitch * Math.min(1, .25 * dtR);   // soltou o manche: o nariz volta devagar ao nível
    S.pitch = Math.max(-pl.pmax, Math.min(pl.pmax, S.pitch));
    if(S.v < pl.vs){ S.pitch -= 14*dt; S.stall = true; } else S.stall = false;   // estol: nariz cai
  }
  // rolagem e curva
  if(air){
    const target = rollIn * pl.roll * .75, rr = pl.rr * SENS * dtR;
    S.roll += Math.max(-rr, Math.min(rr, target - S.roll));
    S.hdg = (S.hdg + (G*Math.tan(S.roll*D2R)/Math.max(S.v, 30))*R2D*dt + 360) % 360;
  } else { S.roll += -S.roll*Math.min(1, 4*dt); if(S.v > 3) S.hdg = (S.hdg + rollIn*6*dt + 360) % 360; }
  // posição
  const hs = S.v*Math.cos(S.pitch*D2R), vz = S.v*Math.sin(S.pitch*D2R) - (S.stall ? 6 : 0);
  [S.lon, S.lat] = move(S.lon, S.lat, S.hdg, hs*dt); S.dist += hs*dt;
  S.alt += vz*dt; S.vz = vz;
  // chão: relevo real do mapa
  let g = null; try{ g = window.Sat.map().queryTerrainElevation([S.lon, S.lat]); }catch(e){}
  if(g != null){ const gg = Math.max(0, g); S.gnd = S.gnd == null ? gg : S.gnd + (gg - S.gnd)*Math.min(1, dt/.6); }
  if(S.ground){
    S.alt = S.gnd + 2;
    if(S.pitch > 2 && S.v >= pl.vr){ S.ground = false; S.msg = "Decolou! Suba com ↑, faça curvas com ← →. Reduza a potência (Q) em cruzeiro."; }
  } else {
    S.maxAlt = Math.max(S.maxAlt, S.alt - S.gnd);
    if(S.alt <= S.gnd + 2){
      const sink = -vz;
      if(sink < 4 && Math.abs(S.roll) < 15 && S.pitch > -4){ S.ground = true; S.alt = S.gnd + 2; S.pitch = Math.max(0, S.pitch); S.touch = sink; S.msg = `Toque na pista: ${r1(sink)} m/s. Freie (B) e reduza a potência.`; }
      else return end(false, sink > 15 ? "Colisão com o solo." : `Pouso duro: ${r1(sink)} m/s de razão de descida.`);
    }
  }
  if(S.warp > 1 && (S.ground || S.alt - S.gnd < 300)) S.warp = 1;
  // fim de missão / pouso livre
  if(S.ground && S.v < 15 && S.touch != null){
    if(S.mode === "dest" && S.dest){
      const d = hav([S.lon,S.lat], S.dest.geometry.coordinates);
      return end(d < 4000, d < 4000 ? null : `Pousou a ${fmtKm(d)} do destino.`);
    }
    return end(true, null);
  }
}
function end(ok, why){
  const S = SIM; if(!S || S.over) return; S.over = true; S.ok = ok; S.why = why;
  const t = (performance.now() - S.t0)/1000;
  const soft = S.touch != null ? Math.max(0, 500 - S.touch*120) : 0;
  S.score = ok ? Math.round((S.dist/1000*2 + soft + (S.mode==="dest" ? 1000 : 0)) * S.pl.score) : Math.round(S.dist/1000 * S.pl.score);
  if(ok){ const best = store.get("sim-best", {}); if(!best[S.type] || S.score > best[S.type]){ best[S.type] = S.score; store.set("sim-best", best); S.record = true; } }
  S.time = t;
}
// câmera: atrás e acima do avião (perseguição) ou na cabine
function render(m, dt){
  const S = SIM, pl = S.pl;
  const ck = S.view === "cockpit", pov = S.view === "pov";
  // POV (padrão): câmera no avião, olhando à frente e para baixo (~62°), como a vista do POV dos voos reais
  const back = ck ? -2 : pov ? 0 : pl.back, up = ck ? 1.5 : pov ? 0 : pl.up;
  const [cl, ca] = move(S.lon, S.lat, S.hdg, -back*Math.cos(S.pitch*D2R));
  let alt = S.alt + up - back*Math.sin(S.pitch*D2R);
  alt = Math.max(alt, S.gnd + 3);
  const tgt = {lon:cl, lat:ca, alt, brg:S.hdg, pitch: pov ? Math.max(35, Math.min(80, 62 + S.pitch*.5))
    : Math.max(25, Math.min(84, 90 - Math.atan2(up, back)*R2D + (ck ? S.pitch : S.pitch*.6) - (ck ? 6 : 0)))};
  const k = 1 - Math.exp(-dt/.15), c = S.cam || (S.cam = {...tgt});
  for(const key of ["lon","lat","alt","pitch"]) c[key] += (tgt[key] - c[key])*k;
  c.brg = (c.brg + (((tgt.brg - c.brg + 540) % 360) - 180)*k + 360) % 360;
  try{
    const o = m.calculateCameraOptionsFromCameraLngLatAltRotation(new maplibregl.LngLat(c.lon, c.lat), c.alt, c.brg, c.pitch);
    const ko = 1 - Math.exp(-dt/.09), cc = o.center, f = S.out || (S.out = {lng:cc.lng, lat:cc.lat, z:o.zoom});
    if(Math.abs(cc.lng - f.lng) > .5 || Math.abs(cc.lat - f.lat) > .5){ f.lng = cc.lng; f.lat = cc.lat; f.z = o.zoom; }
    else { f.lng += (cc.lng - f.lng)*ko; f.lat += (cc.lat - f.lat)*ko; f.z += (o.zoom - f.z)*ko; }
    m.jumpTo({center:[f.lng, f.lat], zoom:f.z, bearing:o.bearing, pitch:o.pitch});
  }catch(e){ S.camErr = e.message; }
  // na cabine o horizonte inclina com o avião
  const bg = $("satbg"); if(bg) bg.style.transform = ck ? `rotate(${-S.roll}deg) scale(1.45)` : "";
}

/* ---------- HUD ---------- */
const SPRITE = {
  pequeno:`<svg viewBox="0 0 200 80"><rect x="2" y="34" width="196" height="7" rx="3" fill="#F2F2F2"/><ellipse cx="100" cy="45" rx="15" ry="13" fill="#E8E8E8"/><rect x="96" y="12" width="8" height="30" rx="3" fill="#D93B3B"/><rect x="78" y="40" width="44" height="4" rx="2" fill="#D0D0D0"/><circle cx="100" cy="45" r="5" fill="#444"/></svg>`,
  medio:`<svg viewBox="0 0 260 90"><path d="M4 52 L256 52 L250 46 L10 46Z" fill="#EDEDED"/><ellipse cx="130" cy="50" rx="20" ry="19" fill="#F5F5F5"/><path d="M127 8 L133 8 L136 44 L124 44Z" fill="#1F5FD6"/><rect x="96" y="34" width="68" height="4" rx="2" fill="#E0E0E0"/><ellipse cx="88" cy="58" rx="9" ry="8" fill="#BDBDBD"/><ellipse cx="172" cy="58" rx="9" ry="8" fill="#BDBDBD"/><circle cx="88" cy="58" r="4" fill="#555"/><circle cx="172" cy="58" r="4" fill="#555"/></svg>`,
  grande:`<svg viewBox="0 0 320 110"><path d="M2 66 L318 66 L310 58 L10 58Z" fill="#EFEFEF"/><ellipse cx="160" cy="62" rx="27" ry="26" fill="#F7F7F7"/><path d="M156 4 L164 4 L168 52 L152 52Z" fill="#0B3D91"/><rect x="118" y="42" width="84" height="5" rx="2" fill="#E2E2E2"/><ellipse cx="96" cy="76" rx="14" ry="13" fill="#C2C2C2"/><ellipse cx="224" cy="76" rx="14" ry="13" fill="#C2C2C2"/><circle cx="96" cy="76" r="7" fill="#4A4A4A"/><circle cx="224" cy="76" r="7" fill="#4A4A4A"/></svg>`,
  caca:`<svg viewBox="0 0 220 80"><path d="M10 50 L110 36 L210 50 L110 46Z" fill="#7C8794"/><path d="M92 46 L110 30 L128 46 L110 54Z" fill="#8E99A6"/><path d="M96 40 L88 10 L98 12 L104 40Z" fill="#6B7684"/><path d="M124 40 L132 10 L122 12 L116 40Z" fill="#6B7684"/><circle cx="102" cy="50" r="5" fill="#FF8A2B"/><circle cx="118" cy="50" r="5" fill="#FF8A2B"/></svg>`
};
function hud(){
  let h = $("simHud"); if(h) h.remove();
  h = document.createElement("div"); h.id = "simHud"; h.className = "sim-hud";
  h.innerHTML = `<div class="sh-sprite" id="shSprite">${SPRITE[SIM.type]}</div>
    <div class="sh-top glass"><b id="shTitle"></b><span id="shNav"></span><span id="shScore"></span><button class="ibtn sm" id="shX" aria-label="Sair">✕</button></div>
    <div class="sh-l glass"><small>Velocidade</small><b id="shV"></b><small id="shM"></small><div class="sh-thr"><i id="shThr"></i></div><small id="shThrT"></small></div>
    <div class="sh-r glass"><small>Altitude</small><b id="shA"></b><small id="shAgl"></small><small id="shVz"></small></div>
    <div class="sh-hdg glass" id="shHdg"></div>
    <div class="sh-mini glass" id="shMini" aria-label="Minimapa"><div class="sh-mini-map" id="shMiniMap"></div><i class="sh-mini-pl" id="shMiniPl"></i>
      <div class="sh-mini-z"><button data-mz="1" aria-label="Aproximar">+</button><button data-mz="-1" aria-label="Afastar">−</button></div><small class="sh-mini-n">N ↑</small></div>
    <div class="sh-msg" id="shMsg"></div>
    <button class="sh-land" id="shLand" hidden>🛬 Pousar</button>
    <div class="sh-ctl"><div class="sh-jl" id="shJL" aria-label="Manche"></div><div class="sh-jr" id="shJR" aria-label="Potência"></div>
      <div class="sh-btns"><button data-k="thr+">＋ Potência</button><button data-k="thr-">－ Potência</button><button data-k="brake">Freio</button><button data-act="cam">🎥 Câmera</button><button data-act="warp">⏩ Tempo</button></div></div>
    <div class="sh-end glass" id="shEnd" hidden></div>`;
  document.body.appendChild(h);
  SJ = window.Joy ? {l:window.Joy.make($("shJL"), "manche"), r:window.Joy.make($("shJR"), "potência")} : {};
  $("shX").onclick = stop;
  $("shLand").onclick = startLanding;
  h.querySelectorAll("[data-k]").forEach(b=>{ const k = b.dataset.k;
    const dn = e=>{ e.preventDefault(); keys.add(k); b.classList.add("on"); }, up = ()=>{ keys.delete(k); b.classList.remove("on"); };
    b.addEventListener("pointerdown", dn); ["pointerup","pointerleave","pointercancel"].forEach(ev=>b.addEventListener(ev, up)); });
  h.querySelector('[data-act="cam"]').onclick = toggleCam;
  h.querySelector('[data-act="warp"]').onclick = toggleWarp;
  h.querySelectorAll("[data-mz]").forEach(b => b.onclick = () => { if(!SIM) return; SIM.mz = Math.max(4, Math.min(13, (SIM.mz || miniZoom()) + +b.dataset.mz)); miniUpd(true); });
  miniInit();
}
/* ---------- minimapa 2D (norte para cima): avião no centro, rastro voado e linha até o destino ---------- */
let mini = null, miniT = 0;
const miniZoom = () => SIM?.type === "caca" ? 7 : SIM?.type === "pequeno" ? 10 : 8;
const MINI_STYLE = {version:8, glyphs:"https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources:{omt:{type:"vector", url:"https://tiles.openfreemap.org/planet"}},
  layers:[{id:"bg", type:"background", paint:{"background-color":"#18222F"}},
    {id:"verde", type:"fill", source:"omt", "source-layer":"landcover", filter:["in",["get","class"],["literal",["wood","forest","grass"]]], paint:{"fill-color":"#1D3127", "fill-opacity":.8}},
    {id:"agua", type:"fill", source:"omt", "source-layer":"water", paint:{"fill-color":"#0E3556"}},
    {id:"rio", type:"line", source:"omt", "source-layer":"waterway", minzoom:8, paint:{"line-color":"#14466F", "line-width":1}},
    {id:"urb", type:"fill", source:"omt", "source-layer":"landuse", filter:["in",["get","class"],["literal",["residential","commercial","industrial"]]], paint:{"fill-color":"#2A3340"}},
    {id:"pista", type:"line", source:"omt", "source-layer":"aeroway", filter:["==",["get","class"],"runway"], paint:{"line-color":"#C9D3E0", "line-width":2}},
    {id:"via", type:"line", source:"omt", "source-layer":"transportation", filter:["in",["get","class"],["literal",["motorway","trunk","primary"]]], paint:{"line-color":"#5B6B80", "line-width":["interpolate",["linear"],["zoom"],5,.4,12,1.6]}},
    {id:"div", type:"line", source:"omt", "source-layer":"boundary", filter:["<=",["get","admin_level"],4], paint:{"line-color":"#7A8699", "line-width":.7, "line-dasharray":[3,2]}},
    {id:"rastro", type:"line", source:"trilha", layout:{"line-cap":"round","line-join":"round"}, paint:{"line-color":"#FF9F0A", "line-width":2.4}},
    {id:"rota", type:"line", source:"rota", paint:{"line-color":"#64D2FF", "line-width":1.6, "line-dasharray":[2,2]}},
    {id:"alvo", type:"circle", source:"alvo", paint:{"circle-radius":5, "circle-color":"#64D2FF", "circle-stroke-color":"#fff", "circle-stroke-width":1.5}},
    {id:"cid", type:"symbol", source:"omt", "source-layer":"place", filter:["in",["get","class"],["literal",["city","town"]]],
      layout:{"text-field":["coalesce",["get","name:pt"],["get","name"]], "text-font":["Noto Sans Regular"], "text-size":10, "text-max-width":7},
      paint:{"text-color":"#D7DEE8", "text-halo-color":"#18222F", "text-halo-width":1.2}}]};
const fc = f => ({type:"FeatureCollection", features:f ? [f] : []});
function miniInit(){
  try{ if(mini){ mini.remove(); mini = null; } }catch(e){}
  const el = $("shMiniMap"); if(!el || !window.maplibregl) return;
  const S = SIM;
  const st = JSON.parse(JSON.stringify(MINI_STYLE));
  st.sources.trilha = {type:"geojson", data:fc(null)}; st.sources.rota = {type:"geojson", data:fc(null)}; st.sources.alvo = {type:"geojson", data:fc(null)};
  try{
    mini = new maplibregl.Map({container:el, style:st, center:[S.lon, S.lat], zoom:miniZoom(), interactive:false, attributionControl:false, fadeDuration:0});
    S.trail = [[S.lon, S.lat]];
  }catch(e){ mini = null; $("shMini")?.setAttribute("hidden", ""); }
}
function miniUpd(force){
  const S = SIM; if(!S || !mini) return;
  const now = performance.now(); if(!force && now - miniT < 120) return; miniT = now;
  const pl = $("shMiniPl"); if(pl) pl.style.transform = `translate(-50%,-50%) rotate(${S.hdg}deg)`;
  const last = S.trail[S.trail.length - 1];
  if(hav(last, [S.lon, S.lat]) > Math.max(60, S.v * .8)){ S.trail.push([S.lon, S.lat]); if(S.trail.length > 3000) S.trail.splice(0, S.trail.length - 3000); }
  try{
    mini.jumpTo({center:[S.lon, S.lat], zoom:S.mz || miniZoom()});
    if(!mini.isStyleLoaded()) return;
    mini.getSource("trilha")?.setData(fc({type:"Feature", geometry:{type:"LineString", coordinates:[...S.trail, [S.lon, S.lat]]}}));
    if(S.dest){ const dc = S.dest.geometry.coordinates;
      mini.getSource("rota")?.setData(fc({type:"Feature", geometry:{type:"LineString", coordinates:[[S.lon, S.lat], dc]}}));
      mini.getSource("alvo")?.setData(fc({type:"Feature", geometry:{type:"Point", coordinates:dc}})); }
  }catch(e){}
}
const VIEWS = ["pov","chase","cockpit"], VNAME = {pov:"POV", chase:"perseguição", cockpit:"cabine"};
function toggleCam(){ if(!SIM) return; SIM.view = VIEWS[(VIEWS.indexOf(SIM.view)+1) % VIEWS.length]; document.body.classList.toggle("sim-cockpit", SIM.view === "cockpit"); SIM.msg = `Câmera: ${VNAME[SIM.view]}`; }
function toggleWarp(){ if(!SIM || SIM.ground || SIM.alt - SIM.gnd < 300){ if(SIM) SIM.msg = "Acelerar o tempo só acima de 300 m do solo."; return; } SIM.warp = SIM.warp === 1 ? 4 : SIM.warp === 4 ? 16 : 1; }
function updHud(){
  const S = SIM; if(!S || !$("simHud")) return;
  miniUpd();
  const pl = S.pl, agl = Math.max(0, S.alt - S.gnd), mach = S.v/340;
  $("shTitle").textContent = `${pl.ic} ${pl.nome} · ${S.from.i || S.from.c}${S.dest ? " → " + (S.dest.properties.i || S.dest.properties.c) : " · voo livre"}`;
  $("shV").textContent = `${r0(S.v*KT)} kt`; $("shM").textContent = `${r0(S.v*3.6)} km/h${S.type==="caca" ? ` · Mach ${r1(mach)}` : ""}`;
  $("shThr").style.height = `${S.thr*100}%`; $("shThrT").textContent = `potência ${r0(S.thr*100)}%${S.type==="caca" && S.thr > .9 ? " · pós-combustão" : ""}`;
  $("shA").textContent = `${r0(S.alt*FT).toLocaleString("pt-BR")} ft`; $("shAgl").textContent = `${r0(agl).toLocaleString("pt-BR")} m sobre o solo`;
  $("shVz").textContent = `${S.vz >= 0 ? "↑" : "↓"} ${r0(Math.abs(S.vz||0)*196.85).toLocaleString("pt-BR")} ft/min`;
  // fita de rumo
  const marks = []; for(let d=-60; d<=60; d+=10){ const a = Math.round((S.hdg + d)/10)*10, off = (((a - S.hdg + 540) % 360) - 180); const lbl = ((a%360)+360)%360;
    marks.push(`<span style="left:${50 + off/1.2}%">${lbl % 90 === 0 ? ["N","L","S","O"][lbl/90] : lbl}</span>`); }
  let nav = "";
  if(S.dest){ const dc = S.dest.geometry.coordinates, d = hav([S.lon,S.lat], dc), b = brg([S.lon,S.lat], dc), off = (((b - S.hdg + 540) % 360) - 180);
    marks.push(`<i class="sh-tgt" style="left:${Math.max(2, Math.min(98, 50 + off/1.2))}%">▼</i>`);
    const eta = S.v > 20 ? d/S.v/60 : null;
    nav = `${S.dest.properties.i || S.dest.properties.c}: ${fmtKm(d)} · rumo ${r0(b)}°${eta!=null ? ` · ${eta < 60 ? r0(eta)+" min" : r1(eta/60)+" h"}` : ""}`; }
  else nav = `distância voada ${fmtKm(S.dist)}`;
  $("shHdg").innerHTML = `<div class="sh-tape">${marks.join("")}</div><b>${r0(S.hdg)}°</b>`;
  $("shNav").textContent = nav + (S.warp > 1 ? ` · ⏩ ×${S.warp}` : "");
  $("shScore").textContent = `🏆 ${(store.get("sim-best",{})[S.type] || 0).toLocaleString("pt-BR")}`;
  const sp = $("shSprite"); sp.hidden = S.view !== "chase"; sp.style.transform = `translate(-50%,-50%) rotate(${S.roll}deg)`;
  const warn = S.stall ? "⚠ ESTOL — baixe o nariz e acelere" : (!S.ground && agl < 150 && S.vz < -8) ? "⚠ TERRENO — PUXE" : "";
  $("shMsg").innerHTML = warn ? `<span class="warn">${warn}</span>` : esc(S.msg || "");
  const lb = $("shLand"); if(lb){ const show = !!S.near && !S.auto && !S.over && !S.ground;
    lb.hidden = !show; if(show) lb.textContent = `🛬 Pousar em ${S.near.properties.i || S.near.properties.c} · ${fmtKm(S.nearD)}`; }
  if(S.over){ const e = $("shEnd"); if(e.hidden){ e.hidden = false;
    e.innerHTML = `<h3>${S.ok ? (S.mode==="dest" ? "✅ Missão cumprida!" : "✅ Pouso concluído!") : "💥 Fim de voo"}</h3>
      ${S.why ? `<p>${esc(S.why)}</p>` : ""}
      <div class="kpis"><div class="kpi"><small>Pontos</small><b>${S.score.toLocaleString("pt-BR")}</b></div><div class="kpi"><small>Distância</small><b>${fmtKm(S.dist)}</b></div>
        <div class="kpi"><small>Altitude máx.</small><b>${r0(S.maxAlt*FT).toLocaleString("pt-BR")} ft</b></div><div class="kpi"><small>Toque</small><b>${S.touch!=null ? r1(S.touch)+" m/s" : "—"}</b></div></div>
      ${S.record ? `<p class="rec">🏆 Novo recorde para ${esc(S.pl.nome)}!</p>` : ""}
      <div class="mact"><button class="xbtn" id="shAgain">Voar de novo</button><button class="mbtn" id="shOut">Sair</button></div>`;
    $("shOut").onclick = stop;
    $("shAgain").onclick = ()=>{ const from = AP?.find(a=>a.properties.c===S.from.c); stop(); if(from) setTimeout(()=>airportModal(from), 300); }; } }
}
const KEYMAP = {e:"thr+", E:"thr+", q:"thr-", Q:"thr-", ArrowUp:"up", w:"up", W:"up", ArrowDown:"down", s:"down", S:"down", ArrowLeft:"left", a:"left", A:"left", ArrowRight:"right", d:"right", D:"right", Shift:"thr+", Control:"thr-", b:"brake", B:"brake", "+":"thr+", "=":"thr+", "-":"thr-"};
addEventListener("keydown", e=>{ if(!SIM || e.target?.closest?.("input,textarea,select")) return;
  if(e.key==="Escape"){ stop(); return; }
  if(e.key==="c" || e.key==="C"){ toggleCam(); return; }
  if(e.key==="t" || e.key==="T"){ toggleWarp(); return; }
  const k = KEYMAP[e.key]; if(k){ e.preventDefault(); keys.add(k); } }, true);
addEventListener("keyup", e=>{ const k = KEYMAP[e.key]; if(k) keys.delete(k); }, true);
addEventListener("hashchange", ()=>{ if(SIM && document.body.dataset.view !== "sat") stop(); });

window.Sim = {active: () => !!SIM, state: () => SIM, landAt: code => { if(!SIM || !AP) return; SIM.near = AP.find(a=>a.properties.c===code || a.properties.i===code); SIM.nearD = SIM.near ? hav([SIM.lon,SIM.lat], SIM.near.geometry.coordinates) : 0; startLanding(); }, dbg: () => SIM && {f:SIM.frames, err:SIM.loopErr, cam:SIM.camErr, v:SIM.v, alt:SIM.alt, c:SIM.cam}, setOn, isOn: () => on, start, stop, airportModal, loadAP};
})();
