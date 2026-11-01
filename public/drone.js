/* =============================================================================
   DRONE AVANÇADO — voo tour livre no estilo DJI Mavic 4 Pro + controle RC 2:
   decola da sua localização, do centro do mapa ou de um ponto marcado no mapa;
   gimbal 360° (gira em volta e inclina de 0° a -90°), câmera tripla
   (1× 28 mm Hasselblad · 2,4× 70 mm · 6× 168 mm), modos Cine / Normal / Sport,
   inércia real, altitude barométrica com desvio do relevo, bateria, voltar
   para casa (RTH), pouso e decolagem automáticos, MasterShots (Órbita,
   Afastar, Foguete), foto e vídeo do mapa, radar com o ponto de casa.
   Teclado: W/↑ frente · S/↓ trás · A/D lateral · ←/→ gira · E/PgUp sobe ·
   Q/PgDn desce · R/F inclina o gimbal · Z/X gira o gimbal · G centraliza ·
   +/- lente · Shift Sport · Espaço freia (paira) · 1/2/3 modo · C câmera ·
   H casa · L pousa/decola · O órbita · P foto · V vídeo · Esc sai.
   Arrastar no mapa: gira a câmera 360° (no gimbal, gira e inclina o gimbal).
   No celular: dois sticks como no RC 2 (esquerdo gira e sobe/desce, direito anda).
   Nas câmeras Aérea e Atrás o drone fica no centro da tela, com anel de mira e ampliado quando ficaria pequeno demais.
   Botão de comandos (K) lista teclado, mouse e celular.
   Usa de drive.js a câmera por geometria (aim/behind), o anel e as camadas 3D.
   ============================================================================= */
(() => {
"use strict";
const $ = id => document.getElementById(id), D2R = Math.PI/180, ico = (n, s=20) => window.Ico?.(n, s) || "";
const fc = f => ({type:"FeatureCollection", features:f});
const store = {get(k,d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } }, set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }};
const toast = t => window.ClimaToast?.(t);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const adiff = (a, b) => ((((a - b) % 360) + 540) % 360) - 180;
const hav = (a, b) => { const R = 6371000, dLa = (b[1]-a[1])*D2R, dLo = (b[0]-a[0])*D2R; return 2*R*Math.asin(Math.sqrt(Math.sin(dLa/2)**2 + Math.cos(a[1]*D2R)*Math.cos(b[1]*D2R)*Math.sin(dLo/2)**2)); };
const brgTo = (a, b) => (Math.atan2((b[0]-a[0])*Math.cos(a[1]*D2R), b[1]-a[1])/D2R + 360) % 360;
const fmtD = m => m < 1000 ? `${Math.round(m)} m` : `${(m/1000).toFixed(1).replace(".", ",")} km`;

// modos de voo: velocidade horizontal (m/s), subida (m/s), giro (°/s) e tempo de resposta (inércia, s) — valores do Mavic 4 Pro
const MODES = {cine:{nome:"Cine", c:"C", v:5, vz:3, yaw:30, tau:1.5}, normal:{nome:"Normal", c:"N", v:12, vz:6, yaw:75, tau:.6}, sport:{nome:"Sport", c:"S", v:25, vz:10, yaw:120, tau:.35}};
const CAMS = ["Gimbal", "Aérea", "Atrás"];
// lentes: campo de visão vertical (16:9) de 28, 70 e 168 mm equivalentes
const LENS = [{n:"1×", mm:"28 mm", fov:40}, {n:"2,4×", mm:"70 mm", fov:17}, {n:"6×", mm:"168 mm", fov:7.2}], FOV0 = 36.87;
const MAXZ = 1500, RTH_Z = 60, BAT_S = 51*60, CLEAR = 3;   // teto acima da decolagem (m), altura de retorno, autonomia (51 min), folga sobre o chão
// altitude barométrica: D.alt é a altitude do mar; D.z = altura sobre o chão logo abaixo

/* ---------- Mavic 4 Pro em escala real (~33 × 39 cm com hélices). Peças em metros: x direita, y frente ---------- */
const box = (x0, x1, y0, y1, b, t, k) => ({p:[[x0,y0],[x1,y0],[x1,y1],[x0,y1]], b, t, k});
const arm = (x0, y0, x1, y1, w, b, t, k) => { const dx = x1-x0, dy = y1-y0, L = Math.hypot(dx, dy), nx = -dy/L*w/2, ny = dx/L*w/2;
  return {p:[[x0+nx,y0+ny],[x1+nx,y1+ny],[x1-nx,y1-ny],[x0-nx,y0-ny]], b, t, k}; };
const disc = (cx, cy, r, b, t, k, n=10) => ({p:[...Array(n)].map((_, i) => [cx + r*Math.cos(i/n*2*Math.PI), cy + r*Math.sin(i/n*2*Math.PI)]), b, t, k});
const MOT = [[-.15,.1],[.15,.1],[-.165,-.125],[.165,-.125]];
const PARTS = [
  box(-.05, .05, -.13, .1, .03, .1, "c"), box(-.042, .042, -.15, -.12, .04, .09, "c"), box(-.035, .035, -.1, .06, .1, .118, "c2"),   // corpo, traseira, tampa
  ...MOT.map(([x, y]) => arm(0, y > 0 ? .05 : -.08, x, y, .022, .07, .09, "a")),                                                   // braços em X
  ...MOT.map(([x, y]) => disc(x, y, .018, .05, .112, "m", 8)),                                                                        // motores
  ...MOT.map(([x, y]) => disc(x, y, .115, .112, .116, "h", 14)),                                                                      // hélices girando
  disc(0, .135, .042, .0, .085, "g", 12), box(-.025, .025, .17, .18, .035, .075, "l"), box(-.018, .018, .175, .182, .015, .03, "l"),   // gimbal Hasselblad e lentes
  ...MOT.slice(0, 2).map(([x, y]) => disc(x, y + .012, .01, .045, .05, "f", 6)), ...MOT.slice(2).map(([x, y]) => disc(x, y - .012, .01, .045, .05, "r", 6))];
const PC = {c:"#5C6168", c2:"#4D5157", a:"#4A4E54", m:"#2E3136", h:"#9AA0A8", g:"#26292D", l:"#0B1622", f:"#FFFFFF", r:"#34C759"};

let D = null, raf = 0, keys = new Set(), J = {l:{x:0, y:0}, r:{x:0, y:0}}, PK = null, homeMk = null;

function model(){
  const h = D.hdg*D2R, ch = Math.cos(h), sh = Math.sin(h), mx = 1/(111320*Math.cos(D.lat*D2R)), my = 1/110574, blink = Math.floor(performance.now()/600) % 2;
  // vs: escala de destaque — nas câmeras afastadas o drone (40 cm) é ampliado para nunca virar um ponto
  const s = D.vs || 1, P = ([x, y]) => [D.lon + (x*ch + y*sh)*s*mx, D.lat + (-x*sh + y*ch)*s*my];
  return fc(PARTS.map(q => { const col = q.k === "r" ? (blink && !D.landed ? PC.r : "#1E3A26") : q.k === "h" && D.landed ? "#3A3E44" : PC[q.k];
    return {type:"Feature", properties:{b:q.b*s + D.z, t:q.t*s + D.z, col}, geometry:{type:"Polygon", coordinates:[[...q.p.map(P), P(q.p[0])]]}}; }));
}

/* ---------- escolher o ponto de decolagem (como marcar um ponto nas Rotas) ---------- */
function pick(){
  const m = window.Sat?.map(); if(!m) return; if(D) stop(); unpick();
  const el = document.createElement("section"); el.id = "dnPick"; el.className = "dn-pick glass";
  el.innerHTML = `<div class="dn-pk-h"><span class="dn-hp">H</span><div><b>Drone · ponto de decolagem</b><small>Toque no mapa para marcar o ponto (dá para arrastar o H), ou:</small></div></div>
    <div class="dn-pk-b"><button class="xbtn" id="dnPkMe">${ico("pin", 18)} Minha localização</button><button class="xbtn" id="dnPkC">${ico("target", 18)} Centro do mapa</button></div>
    <div class="dn-pk-go"><button class="mbtn" id="dnPkX">Cancelar</button><button class="xbtn dn-go" id="dnPkGo" disabled>${ico("takeoff", 18)} Decolar daqui</button></div>`;
  document.body.appendChild(el);
  const pad = document.createElement("div"); pad.className = "dn-hpad"; pad.textContent = "H";
  PK = {el, mk:new maplibregl.Marker({element:pad, draggable:true}), pt:null};
  const set = (lon, lat, fly) => { PK.pt = [lon, lat]; PK.mk.setLngLat(PK.pt).addTo(m); $("dnPkGo").disabled = false;
    if(fly) m.flyTo({center:PK.pt, zoom:Math.max(m.getZoom(), 16.5), duration:1200}); };
  PK.mk.on("dragend", () => { const p = PK.mk.getLngLat(); PK.pt = [p.lng, p.lat]; });
  PK.click = e => set(e.lngLat.lng, e.lngLat.lat); m.on("click", PK.click);
  $("dnPkC").onclick = () => { const c = m.getCenter(); set(c.lng, c.lat); };
  $("dnPkMe").onclick = () => { if(!navigator.geolocation){ toast("Este aparelho não informa a localização."); return; }
    $("dnPkMe").disabled = true; navigator.geolocation.getCurrentPosition(p => { $("dnPkMe") && ($("dnPkMe").disabled = false); if(PK) set(p.coords.longitude, p.coords.latitude, true); },
      () => { $("dnPkMe") && ($("dnPkMe").disabled = false); toast("Não foi possível obter sua localização (permissão negada ou sem sinal)."); }, {enableHighAccuracy:true, timeout:12000, maximumAge:30000}); };
  $("dnPkX").onclick = unpick;
  $("dnPkGo").onclick = () => { const p = PK.pt; unpick(); if(p) start({lon:p[0], lat:p[1]}); };
}
function unpick(){ if(!PK) return; const m = window.Sat?.map(); m?.off("click", PK.click); PK.mk.remove(); PK.el.remove(); PK = null; }

/* ---------- início e fim ---------- */
async function start(p){
  const Dv = window.Drive; if(!Dv || !window.Sat) return;
  if(!p) return pick();
  unpick(); Dv.stop?.(); stop();
  const m = window.Sat.map(); Dv.layers(m);
  if(!window.Sat.isClear()){ window.Sat.setProd("earth"); await new Promise(r => { m.once("idle", r); setTimeout(r, 4000); }); }
  const g0 = Dv.ground(m, p.lon, p.lat);
  D = {lon:p.lon, lat:p.lat, home:[p.lon, p.lat], homeAlt:g0, alt:g0, g:g0, z:0, hdg:m.getBearing(), vx:0, vy:0, vz:0, yr:0, landed:true,
    mode:store.get("drone-modo", "normal"), cam:store.get("drone-cam2", 0), lens:0, tilt:-15, gy:0, oy:0, el:null, zoomK:1,
    shoot:"foto", bat:100, km:0, t:performance.now(), auto:null, warned:0};
  document.body.classList.add("drv", "drn");
  for(const h of ["dragPan","dragRotate","keyboard","touchZoomRotate","doubleClickZoom","scrollZoom"]) m[h]?.disable();
  m.setMaxZoom(24); try{ m.setMaxPitch(85); }catch(e){}
  const pad = document.createElement("div"); pad.className = "dn-hpad"; pad.textContent = "H";
  homeMk = new maplibregl.Marker({element:pad}).setLngLat(D.home).addTo(m);
  hud(); input(m); setCam(D.cam);
  // decola só depois que o relevo do lugar carregou (até lá a altitude do chão ainda não é confiável)
  const me = D; m.once("idle", () => setTimeout(() => { if(D === me && D.landed && !D.auto) auto("takeoff"); }, 300));
  setTimeout(() => { if(D === me && D.landed && !D.auto) auto("takeoff"); }, 6000);
  cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
}
function stop(){
  unpick(); if(!D) return; if(D.rec) recToggle(); D = null; cancelAnimationFrame(raf); keys.clear(); J = {l:{x:0, y:0}, r:{x:0, y:0}};
  homeMk?.remove(); homeMk = null;
  const m = window.Sat?.map(); if(m){ window.Drive?.labels(m, null); m.getSource("drv")?.setData(fc([])); window.Drive?.ring(m); m.setVerticalFieldOfView?.(FOV0); m.setMaxZoom(19.5);
    for(const h of ["dragPan","dragRotate","keyboard","touchZoomRotate","doubleClickZoom","scrollZoom"]) m[h]?.enable(); m.easeTo({pitch:50, zoom:16, duration:900}); }
  document.body.classList.remove("drv", "drn", "dn-gimbal"); $("dnHud")?.remove(); $("dvLayers")?.remove();
}

/* ---------- voos automáticos ---------- */
const AUTO = {takeoff:"Decolando…", land:"Pousando…", rth:"Voltando para casa…", orbit:"MasterShot: Órbita", dronie:"MasterShot: Afastar", rocket:"MasterShot: Foguete"};
function auto(t, o){
  if(!D) return; D.auto = t ? {t, t0:performance.now(), ...o} : null;
  if(t === "orbit"){ const m = window.Sat.map(), c = m.getCenter(); let poi = [c.lng, c.lat];
    if(hav([D.lon, D.lat], poi) < 15) poi = [D.lon + Math.sin(D.hdg*D2R)*80/(111320*Math.cos(D.lat*D2R)), D.lat + Math.cos(D.hdg*D2R)*80/110574];
    D.auto.poi = poi; D.auto.r = clamp(hav([D.lon, D.lat], poi), 30, 1200); D.auto.dir = o?.dir || 1; D.gy = 0; D.landed = false; }
  if(t === "dronie" || t === "rocket"){ D.landed = false; D.auto.hdg = D.hdg; D.gy = 0; }
  if($("dnSt")) $("dnSt").textContent = status();
}
const status = () => D.auto ? AUTO[D.auto.t] : D.landed ? "Pousado · pronto para decolar" : "Em voo (GNSS)";
// velocidade desejada (m/s no mundo: leste, norte, sobe) e giro desejado (°/s) do voo automático
function autoStep(){
  const A = D.auto, el = (performance.now() - A.t0)/1000, here = [D.lon, D.lat];
  if(A.t === "takeoff"){ if(D.landed){ D.alt = D.g; D.homeAlt = D.g; D.landed = false; } if(D.z >= 30){ auto(null); return null; } return {vx:0, vy:0, vz:4, yr:0}; }
  if(A.t === "land"){ if(D.z <= .03){ D.landed = true; auto(null);
      if(hav(here, D.home) < 20 && D.bat < 100){ D.bat = 100; D.warned = 0; toast("Pousou em casa: bateria trocada (100%)."); } return null; }
    return {vx:0, vy:0, vz:-clamp(D.z*.35, .7, 5), yr:0}; }
  if(A.t === "rth"){
    const d = hav(here, D.home), b = brgTo(here, D.home);
    if(D.alt < D.homeAlt + RTH_Z - 1 && !A.cruise) return {vx:0, vy:0, vz:MODES.normal.vz, yr:0};
    A.cruise = true; if(d < 3){ auto("land"); return null; }
    const v = Math.min(15, d*.4), ok = Math.abs(adiff(b, D.hdg)) < 30 ? 1 : .2;
    return {vx:Math.sin(b*D2R)*v*ok, vy:Math.cos(b*D2R)*v*ok, vz:0, yr:clamp(adiff(b, D.hdg)*2, -90, 90)}; }
  if(A.t === "orbit"){
    const kx = 111320*Math.cos(D.lat*D2R), ex = (D.lon - A.poi[0])*kx, ny = (D.lat - A.poi[1])*110574, r = Math.hypot(ex, ny) || 1;
    const sp = Math.min(10, A.r*.25), corr = (A.r - r)*.6;
    D.tilt += (-Math.atan2(D.z, r)/D2R - D.tilt)*.05;
    return {vx:-ny/r*A.dir*sp + ex/r*corr, vy:ex/r*A.dir*sp + ny/r*corr, vz:0, yr:clamp(adiff(brgTo(here, A.poi), D.hdg)*2.5, -90, 90)}; }
  if(A.t === "dronie"){ if(el > 12){ auto(null); return null; } const b = A.hdg*D2R; return {vx:-Math.sin(b)*6, vy:-Math.cos(b)*6, vz:3, yr:0}; }
  if(A.t === "rocket"){ if(el > 10 || D.alt - D.homeAlt > MAXZ - 20){ auto(null); return null; } D.tilt += (-90 - D.tilt)*.05; return {vx:0, vy:0, vz:8, yr:0}; }
  return null;
}

/* ---------- física (passos de 1/60 s: mesma velocidade com qualquer taxa de quadros) ---------- */
const k = n => keys.has(n) ? 1 : 0;
function physics(dt){
  const Md = MODES[keys.has("sport") ? "sport" : D.mode];
  const fw = clamp(k("fw") - k("bk") + J.r.y, -1, 1), st = clamp(k("sr") - k("sl") + J.r.x, -1, 1), yw = clamp(k("yr") - k("yl") + J.l.x, -1, 1), th = clamp(k("up") - k("dn") + J.l.y, -1, 1);
  if(Math.abs(fw) + Math.abs(st) + Math.abs(yw) + Math.abs(th) > .08 && D.auto && D.auto.t !== "takeoff") auto(null);
  let tg = D.auto ? autoStep() : null;
  if(!tg){ const h = D.hdg*D2R;
    if(D.landed && th <= .1) tg = {vx:0, vy:0, vz:0, yr:0};
    else { if(D.landed){ D.landed = false; if($("dnSt")) $("dnSt").textContent = status(); }
      tg = {vx:(fw*Math.sin(h) + st*Math.cos(h))*Md.v, vy:(fw*Math.cos(h) - st*Math.sin(h))*Md.v, vz:th*Md.vz, yr:yw*Md.yaw}; }
    if(keys.has("brk")) tg.vx = tg.vy = tg.vz = 0; }
  const a = Math.min(1, dt/Md.tau);
  D.vx += (tg.vx - D.vx)*a; D.vy += (tg.vy - D.vy)*a; D.vz += (tg.vz - D.vz)*Math.min(1, dt/.45); D.yr += (tg.yr - D.yr)*Math.min(1, dt/.3);
  D.hdg = (D.hdg + D.yr*dt + 360) % 360;
  // desvio de obstáculos (como o APAS do Mavic): prédio à frente mais alto que o drone → freia e para antes da parede
  { const m = window.Sat.map(), nlon = D.lon + D.vx*dt/(111320*Math.cos(D.lat*D2R)), nlat = D.lat + D.vy*dt/110574;
    const top = window.Drive.obstAt?.(m, nlon, nlat, D.z) || 0;
    if(top && D.z < top + .8 && !(window.Drive.obstAt?.(m, D.lon, D.lat, D.z) > D.z)){ D.vx = D.vy = 0; if(performance.now() - (D.apas || 0) > 2500){ D.apas = performance.now(); toast("Obstáculo à frente: o drone parou (suba para passar por cima)."); } }
    else { D.lon = nlon; D.lat = nlat; }
    D.roof = window.Drive.obstAt?.(m, D.lon, D.lat, D.z) || 0; }
  // altitude barométrica; nunca atravessa o chão e, voando, mantém a folga mínima (sobe a encosta sozinho)
  D.alt = Math.min(D.alt + D.vz*dt, D.homeAlt + MAXZ);
  // em cima de um prédio o "chão" é o telhado (pousa no topo em vez de entrar no prédio)
  const piso = D.g + (D.roof && D.z >= D.roof - .5 ? D.roof : 0);
  const floor = piso + (D.landed || D.auto?.t === "land" || D.auto?.t === "takeoff" ? 0 : CLEAR);
  if(D.alt < floor){ D.alt = floor; if(D.vz < 0) D.vz = 0; }
  // pousado: o drone fica no chão de verdade e, em casa, recalibra o barômetro (altura 0 = ponto de decolagem)
  if(D.landed && !D.auto){ D.alt = D.g; if(hav([D.lon, D.lat], D.home) < 20) D.homeAlt = D.g; }
  D.z = D.alt - D.g;
  if(D.z <= .02 && D.vz <= 0 && !D.landed && !D.auto && Math.hypot(D.vx, D.vy) < 1 && th <= .1){ D.landed = true; if($("dnSt")) $("dnSt").textContent = status(); }
  // gimbal: inclina (R/F) de 0° a -90° e gira 360° (Z/X)
  D.tilt = clamp(D.tilt + (k("tu") - k("td"))*40*dt, -90, 0);
  D.gy = (D.gy + (k("gr") - k("gl"))*60*dt + 540) % 360 - 180;
  const hs = Math.hypot(D.vx, D.vy); D.km += hs*dt/1000;
  if(!D.landed) D.bat = Math.max(0, D.bat - dt*100/BAT_S*(1 + hs/Md.v*.35 + Math.max(0, D.vz)/10*.4)*(Md === MODES.sport ? 1.25 : 1));
  if(D.bat < 20 && D.warned < 1){ D.warned = 1; toast("Bateria em 20%: hora de voltar (H)."); }
  if(D.bat < 8 && D.warned < 2){ D.warned = 2; toast("Bateria crítica: voltando para casa automaticamente."); auto("rth"); }
  if(D.bat <= 0 && !D.landed && D.auto?.t !== "land") auto("land");
}

/* ---------- câmeras: gimbal (a câmera do drone), aérea e atrás — todas giram 360° arrastando ---------- */
function camera(m, dt){
  const Dv = window.Drive, z = D.z;
  if(D.cam === 0){
    // gimbal: logo abaixo do corpo, estabilizado; rumo = drone + giro do gimbal, inclinação 0° (horizonte) a -90° (para baixo)
    const b = (D.hdg + D.gy + 360) % 360;
    D.cb = D.cb == null ? b : (D.cb + adiff(b, D.cb)*Math.min(1, dt*10) + 360) % 360;
    D.vs = 1; target(0);
    Dv.aim(m, D.lon, D.lat, D.alt - .03, D.cb, 90 + D.tilt);
  } else {
    // aérea e atrás: em volta do drone (giro livre 360° e ângulo de altura ajustáveis arrastando), seguindo com atraso suave
    const aer = D.cam === 1, el = clamp(D.el ?? (aer ? 34 : 14), 3, 88), R = (aer ? 14 + Math.min(z, 400)*.22 : 2.4 + Math.min(z, 200)*.03)*D.zoomK;
    // o drone fica exatamente no centro da tela (a câmera mira através dele): tamanho na tela → escala de destaque e anel
    const px = .42/R*(m.transform?.cameraToCenterDistance || innerHeight*1.5), vs = clamp(64/px, 1, 40);
    D.vs = (D.vs || vs) + (vs - (D.vs || vs))*Math.min(1, dt*4); target(px*D.vs);
    const want = (D.hdg + D.oy + 360) % 360;
    D.cb = D.cb == null ? want : (D.cb + adiff(want, D.cb)*Math.min(1, dt*(aer ? 2.5 : 4)) + 360) % 360;
    Dv.behind(m, D.lon, D.lat, D.cb, R*Math.cos(el*D2R), R*Math.sin(el*D2R), z + .08);
  }
}
// anel de mira no centro da tela (onde o drone está nas câmeras Aérea e Atrás)
function target(px){ const t = $("dnTgt"); if(!t) return; const s = px && px < 140 ? Math.round(clamp(px*1.7, 84, 220)) : 0;   // drone já grande na tela: sem anel
  if(s !== D.tgs){ D.tgs = s; t.hidden = !s; if(s){ t.style.width = t.style.height = `${s}px`; } } }
function lens(i){
  if(!D) return; D.lens = i; const m = window.Sat.map();
  m.setVerticalFieldOfView?.(D.cam === 0 ? LENS[i].fov : FOV0);
  document.querySelectorAll("#dnHud [data-ln]").forEach(b => b.setAttribute("aria-pressed", +b.dataset.ln === i));
}
function setCam(c){ D.cam = c; store.set("drone-cam2", c); D.cb = null; D.el = null; D.oy = 0; lens(D.lens);
  document.body.classList.toggle("dn-gimbal", c === 0); if($("dnCamN")) $("dnCamN").textContent = CAMS[c]; }
function center(){ D.gy = 0; D.oy = 0; D.el = null; if(D.cam === 0) D.tilt = -15; toast("Câmera centralizada"); }
function loop(now){
  if(!D) return; raf = requestAnimationFrame(loop);
  let dt = Math.min(.25, (now - D.t)/1000); D.t = now; const dc = dt, m = window.Sat.map();
  for(let n = 0; dt > 1e-4 && n < 15; n++){ const h = Math.min(1/60, dt); if(n % 4 === 0) D.g = window.Drive.ground(m, D.lon, D.lat); physics(h); dt -= h; }
  window.Drive.labels(m, D.cam === 1 ? "ruas" : "off"); m.getSource("drv")?.setData(model());
  window.Drive.ring(m, D.lon, D.lat, .45, D.bat < 20 ? "#FF3B30" : "#FFD60A");
  camera(m, Math.min(.1, dc)); tele(now);
}

/* ---------- tela no estilo DJI Fly (RC 2) ---------- */
function tele(now){
  if(!$("dnHud") || now - (D.tt || 0) < 100) return; D.tt = now;
  const hs = Math.hypot(D.vx, D.vy), dist = hav([D.lon, D.lat], D.home), rem = Math.round(D.bat/100*BAT_S);
  const set = (id, v) => { const e = $(id); if(e && e.textContent !== v) e.textContent = v; };
  set("dnD", fmtD(dist)); set("dnH", `${Math.round(D.alt - D.homeAlt)} m`); set("dnHs", `${(hs*3.6).toFixed(0)} km/h`); set("dnVs", `${D.vz.toFixed(1).replace(".", ",")} m/s`);
  set("dnAgl", `${Math.round(D.z)} m`); set("dnTilt", `${Math.round(D.tilt)}°`); set("dnGy", `${Math.round(D.gy)}°`);
  set("dnBat", `${Math.round(D.bat)}%`); set("dnRem", `${Math.floor(rem/60)}:${String(rem%60).padStart(2, "0")}`);
  const b = $("dnBatI"); if(b){ b.style.width = `${D.bat}%`; b.style.background = D.bat < 20 ? "#FF3B30" : D.bat < 40 ? "#FF9F0A" : "#34C759"; }
  const lb = $("dnLand"); if(lb){ const t = D.landed ? "Decolar (L)" : "Pousar (L)"; if(lb.title !== t){ lb.title = t; lb.innerHTML = ico(D.landed ? "takeoff" : "landing", 22); } }
  const gt = $("dnTiltBar"); if(gt) gt.style.top = `${-D.tilt/90*100}%`;
  if(D.rec) set("dnRecT", (s => `${Math.floor(s/60)}:${String(s%60).padStart(2, "0")}`)(Math.round((now - D.rec.t0)/1000)));
  radar(dist);
}
// radar (indicador de atitude do DJI Fly): drone no centro, norte, ponto de casa e o cone da câmera
function radar(dist){
  const cv = $("dnRadar"); if(!cv) return; const g = cv.getContext("2d"), S = cv.width, c = S/2, u = S/132, r = c - 6*u, mb = window.Sat.map().getBearing();
  const font = (w, s) => `${w} ${s*u}px -apple-system,system-ui,sans-serif`, rot = a => (a - mb)*D2R - Math.PI/2;
  g.clearRect(0, 0, S, S); g.save(); g.translate(c, c);
  g.fillStyle = "rgba(10,14,20,.55)"; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
  g.strokeStyle = "rgba(255,255,255,.25)"; g.lineWidth = u; [1, .5].forEach(f => { g.beginPath(); g.arc(0, 0, r*f, 0, 7); g.stroke(); });
  // cone de visão do gimbal (largura da lente)
  const cb = rot(D.hdg + D.gy), half = Math.atan(Math.tan(LENS[D.lens].fov/2*D2R)*16/9);
  g.fillStyle = "rgba(255,214,10,.22)"; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r*.95, cb - half, cb + half); g.closePath(); g.fill();
  const n = rot(0); g.fillStyle = "#FF453A"; g.font = font(700, 11); g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("N", Math.cos(n)*(r - 9*u), Math.sin(n)*(r - 9*u));
  // casa (escala automática)
  const range = Math.max(100, dist*1.25), hb = rot(brgTo([D.lon, D.lat], D.home)), hr = Math.min(1, dist/range)*r*.9;
  g.fillStyle = "#FFD60A"; g.beginPath(); g.arc(Math.cos(hb)*hr, Math.sin(hb)*hr, 7*u, 0, 7); g.fill();
  g.fillStyle = "#111"; g.font = font(800, 9); g.fillText("H", Math.cos(hb)*hr, Math.sin(hb)*hr + .5);
  // drone (seta no rumo)
  g.rotate(rot(D.hdg) + Math.PI/2); g.fillStyle = "#fff"; g.beginPath();
  g.moveTo(0, -11*u); g.lineTo(8*u, 8*u); g.lineTo(0, 4*u); g.lineTo(-8*u, 8*u); g.closePath(); g.fill(); g.restore();
  g.fillStyle = "rgba(255,255,255,.8)"; g.font = font(600, 9); g.textAlign = "center"; g.fillText(fmtD(range), c, S - 9*u);
}
function hud(){
  $("dnHud")?.remove(); const h = document.createElement("section"); h.id = "dnHud"; h.className = "dv dn";
  const RS = Math.round(132*Math.min(2, devicePixelRatio || 1));
  h.innerHTML = `<header class="dn-bar">
      <button class="dn-ib" id="dnX" title="Sair (Esc)">${ico("x", 20)}</button>
      <div class="dn-st"><b>Mavic 4 Pro</b><small id="dnSt">${status()}</small></div>
      <button class="dn-ib dn-hlpb" id="dnLy" title="Camadas do mapa (M)">${ico("layers", 18)}</button>
      <button class="dn-ib dn-hlpb" id="dnHelp" title="Comandos: teclado, mouse e celular (K)">${ico("gamepad", 18)}</button>
      <div class="dn-modes" role="group" aria-label="Modo de voo">${Object.entries(MODES).map(([k, v]) => `<button data-dm="${k}" aria-pressed="${k === D.mode}" title="${v.nome}: até ${Math.round(v.v*3.6)} km/h">${v.c}</button>`).join("")}</div>
      <span class="dn-sig" title="Sinal GNSS e transmissão">${ico("satellite", 16)}<small>GNSS</small><i class="dn-bars"><u></u><u></u><u></u><u></u></i></span>
      <span class="dn-bat" title="Bateria e tempo de voo restante"><i><u id="dnBatI"></u></i><b id="dnBat">100%</b><small id="dnRem">51:00</small></span></header>
    <div class="dn-left">
      <button class="dn-rb" id="dnLand" title="Decolar (L)">${ico("takeoff", 22)}</button>
      <button class="dn-rb" id="dnHome" title="Voltar para casa (H)">${ico("home", 22)}</button>
      <button class="dn-rb" id="dnQs" title="MasterShots">${ico("sparkle", 22)}</button>
      <div class="dn-qs glass" id="dnQsM" hidden><button data-qs="orbit">${ico("refresh", 18)} Órbita (O)</button><button data-qs="orbitl">${ico("refresh", 18)} Órbita ao contrário</button><button data-qs="dronie">${ico("down", 18)} Afastar</button><button data-qs="rocket">${ico("rocket", 18)} Foguete</button></div></div>
    <div class="dn-gim" title="Gimbal: inclinação (R/F) e giro 360° (Z/X)">
      <button data-k="tu" aria-label="Gimbal para cima (R)">${ico("chevu", 18)}</button>
      <div class="dn-gscale"><i id="dnTiltBar"></i></div><b id="dnTilt">-15°</b><small>giro <span id="dnGy">0°</span></small>
      <button data-k="td" aria-label="Gimbal para baixo (F)">${ico("chevd", 18)}</button>
      <button id="dnCtr" title="Centralizar câmera (G)">${ico("target", 16)}</button></div>
    <div class="dn-right">
      <button class="dn-view" id="dnCam" title="Trocar câmera (C)">${ico("video", 16)}<small id="dnCamN">${CAMS[D.cam]}</small></button>
      <div class="dn-lens" role="group" aria-label="Lente">${LENS.map((l, i) => `<button data-ln="${i}" aria-pressed="${i === 0}" title="${l.mm}">${l.n}</button>`).join("")}</div>
      <div class="dn-pv" role="group" aria-label="Foto ou vídeo"><button data-sh="foto" aria-pressed="true" title="Foto">${ico("camera", 16)}</button><button data-sh="video" aria-pressed="false" title="Vídeo">${ico("video", 16)}</button></div>
      <button class="dn-shut" id="dnShut" title="Disparar (P foto · V vídeo)"><i></i></button><small class="dn-rect" id="dnRecT"></small></div>
    <div class="dn-tele"><canvas id="dnRadar" width="${RS}" height="${RS}"></canvas>
      <div class="dn-tv"><span><small>D</small><b id="dnD">0 m</b></span><span><small>H</small><b id="dnH">0 m</b></span><span><small>H.S.</small><b id="dnHs">0 km/h</b></span>
        <span><small>V.S.</small><b id="dnVs">0,0 m/s</b></span><span><small>Solo</small><b id="dnAgl">0 m</b></span></div></div>
    <div class="dn-joy dn-joyl" data-j="l" aria-label="Stick esquerdo: gira e sobe/desce"><i></i></div>
    <div class="dn-joy dn-joyr" data-j="r" aria-label="Stick direito: anda"><i></i></div>
    <div class="dn-tgt" id="dnTgt" hidden><i></i></div>
    <div class="dn-help glass" id="dnHelpP" hidden>
      <header><b>${ico("gamepad", 20)} Comandos do drone</b><button class="dn-ib" id="dnHelpX" aria-label="Fechar">${ico("x", 18)}</button></header>
      <div class="dn-hcols">
        <section><h4>Teclado</h4><dl>
          <dt>W S / ↑ ↓</dt><dd>frente / trás</dd><dt>A D</dt><dd>lateral esquerda / direita</dd><dt>← →</dt><dd>girar o drone</dd>
          <dt>E Q / PgUp PgDn</dt><dd>subir / descer</dd><dt>Espaço</dt><dd>frear e pairar</dd><dt>Shift (segurar)</dt><dd>modo Sport</dd>
          <dt>1 2 3</dt><dd>modo Cine / Normal / Sport</dd><dt>R F</dt><dd>gimbal para cima / baixo</dd><dt>Z X</dt><dd>girar o gimbal 360°</dd>
          <dt>G</dt><dd>centralizar câmera</dd><dt>+ −</dt><dd>lente 1× · 2,4× · 6×</dd><dt>C</dt><dd>trocar câmera (Gimbal, Aérea, Atrás)</dd>
          <dt>P / V</dt><dd>foto / gravar vídeo</dd><dt>L</dt><dd>decolar / pousar</dd><dt>H</dt><dd>voltar para casa</dd><dt>O</dt><dd>órbita</dd><dt>M</dt><dd>camadas do mapa</dd><dt>K</dt><dd>esta ajuda</dd><dt>Esc</dt><dd>sair</dd></dl></section>
        <section><h4>Mouse / trackpad</h4><dl>
          <dt>Arrastar (Gimbal)</dt><dd>girar 360° e inclinar o gimbal</dd><dt>Arrastar (Aérea/Atrás)</dt><dd>girar em volta do drone e mudar a altura do ângulo</dd>
          <dt>Rodinha (Gimbal)</dt><dd>trocar a lente</dd><dt>Rodinha (Aérea/Atrás)</dt><dd>aproximar / afastar</dd>
          <dt>Botões da tela</dt><dd>decolar/pousar, casa, MasterShots, gimbal, lentes, foto/vídeo e disparador</dd></dl></section>
        <section><h4>Celular / tablet</h4><dl>
          <dt>Stick esquerdo</dt><dd>↑↓ sobe/desce · ←→ gira o drone</dd><dt>Stick direito</dt><dd>↑↓ frente/trás · ←→ lateral</dd>
          <dt>Arrastar no mapa</dt><dd>câmera 360° (gimbal ou em volta do drone)</dd><dt>Botões ⌃ ⌄ do gimbal</dt><dd>inclinar a câmera; ◎ centraliza</dd>
          <dt>C · N · S</dt><dd>modo de voo no topo</dd><dt>Disparador</dt><dd>foto ou vídeo (escolha acima dele)</dd></dl></section></div></div>
    <div class="dn-flash" id="dnFlash"></div>`;
  document.body.appendChild(h);
  $("dnX").onclick = stop; $("dnHelp").onclick = help; $("dnLy").onclick = () => window.Drive.layersUI(); $("dnHelpX").onclick = help; $("dnCam").onclick = () => setCam((D.cam + 1) % 3); $("dnCtr").onclick = center;
  $("dnHome").onclick = () => auto("rth"); $("dnLand").onclick = landToggle;
  $("dnQs").onclick = () => { $("dnQsM").hidden = !$("dnQsM").hidden; };
  $("dnShut").onclick = () => D.shoot === "video" ? recToggle() : shot();
  h.querySelectorAll("[data-qs]").forEach(b => b.onclick = () => { $("dnQsM").hidden = true; const q = b.dataset.qs; auto(q === "orbitl" ? "orbit" : q, q === "orbitl" ? {dir:-1} : null); });
  h.querySelectorAll("[data-dm]").forEach(b => b.onclick = () => setMode(b.dataset.dm));
  h.querySelectorAll("[data-ln]").forEach(b => b.onclick = () => { if(D.cam !== 0) setCam(0); lens(+b.dataset.ln); });
  h.querySelectorAll("[data-sh]").forEach(b => b.onclick = () => { if(D.rec) recToggle(); D.shoot = b.dataset.sh; h.querySelectorAll("[data-sh]").forEach(x => x.setAttribute("aria-pressed", x === b)); $("dnShut").classList.toggle("vid", D.shoot === "video"); });
  h.querySelectorAll("[data-k]").forEach(b => { const kk = b.dataset.k;
    // o gimbal mexe na câmera do drone: se estiver em outra câmera, passa para ela
    const dn = e => { e.preventDefault(); if(D.cam !== 0){ setCam(0); toast("Câmera do gimbal"); } keys.add(kk); b.classList.add("on"); }, up = () => { keys.delete(kk); b.classList.remove("on"); };
    b.addEventListener("pointerdown", dn); ["pointerup","pointerleave","pointercancel"].forEach(ev => b.addEventListener(ev, up)); });
  h.querySelectorAll("[data-j]").forEach(joy);
}
// stick virtual (como o do RC 2): arrasta dentro do círculo e volta ao centro ao soltar
function joy(el){
  const s = el.dataset.j, knob = el.querySelector("i"); let id = null;
  const mv = e => { if(e.pointerId !== id) return; const r = el.getBoundingClientRect(), R = r.width/2 - 20;
    let x = e.clientX - r.left - r.width/2, y = e.clientY - r.top - r.height/2; const d = Math.hypot(x, y); if(d > R){ x *= R/d; y *= R/d; }
    knob.style.transform = `translate(${x}px, ${y}px)`; const dz = v => Math.abs(v) < .1 ? 0 : v; J[s] = {x:dz(x/R), y:dz(-y/R)}; };
  const end = e => { if(e.pointerId !== id) return; id = null; knob.style.transform = ""; J[s] = {x:0, y:0}; el.classList.remove("on"); };
  el.addEventListener("pointerdown", e => { e.preventDefault(); id = e.pointerId; el.setPointerCapture(id); el.classList.add("on"); mv(e); });
  el.addEventListener("pointermove", mv); el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
}
function setMode(md){ if(!D || !MODES[md]) return; D.mode = md; store.set("drone-modo", md); document.querySelectorAll("#dnHud [data-dm]").forEach(b => b.setAttribute("aria-pressed", b.dataset.dm === md)); toast(`Modo ${MODES[md].nome}: até ${Math.round(MODES[md].v*3.6)} km/h`); }
function help(){ const p = $("dnHelpP"); if(p) p.hidden = !p.hidden; }
function landToggle(){ if(D.landed) auto("takeoff"); else auto("land"); }

/* ---------- foto e vídeo (só a imagem da câmera, sem os botões) ---------- */
function save(blob, name){ const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
function shot(){
  const m = window.Sat.map(); window.Drive.beep(1400, 60);
  const f = $("dnFlash"); f?.classList.remove("go"); void f?.offsetWidth; f?.classList.add("go");
  // o quadro só pode ser lido logo depois de desenhado (o WebGL descarta o buffer em seguida)
  m.once("render", () => { try{ m.getCanvas().toBlob(b => b ? save(b, `drone-${stamp()}.jpg`) : toast("Não foi possível salvar a foto."), "image/jpeg", .92); }catch(e){ toast("Não foi possível salvar a foto."); } });
  m.triggerRepaint();
}
function recToggle(){
  if(!D) return; const b = $("dnShut");
  if(D.rec){ try{ D.rec.r.stop(); }catch(e){} D.rec = null; b?.classList.remove("rec"); if($("dnRecT")) $("dnRecT").textContent = ""; return; }
  try{ const cv = window.Sat.map().getCanvas(), st = cv.captureStream(30), ch = [];
    const mt = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm"].find(t => window.MediaRecorder?.isTypeSupported?.(t));
    const r = new MediaRecorder(st, mt ? {mimeType:mt, videoBitsPerSecond:8e6} : {}); r.ondataavailable = e => e.data.size && ch.push(e.data);
    r.onstop = () => save(new Blob(ch, {type:r.mimeType}), `drone-${stamp()}.${r.mimeType.includes("mp4") ? "mp4" : "webm"}`);
    r.start(1000); D.rec = {r, t0:performance.now()}; b?.classList.add("rec"); toast("Gravando… toque de novo no disparador para salvar.");
  }catch(e){ toast("Gravação de vídeo não suportada neste navegador."); }
}

/* ---------- entradas ---------- */
const KM = {ArrowUp:"fw", w:"fw", W:"fw", ArrowDown:"bk", s:"bk", S:"bk", a:"sl", A:"sl", d:"sr", D:"sr", ArrowLeft:"yl", ArrowRight:"yr",
  e:"up", E:"up", PageUp:"up", q:"dn", Q:"dn", PageDown:"dn", r:"tu", R:"tu", f:"td", F:"td", z:"gl", Z:"gl", x:"gr", X:"gr", " ":"brk", Shift:"sport"};
addEventListener("keydown", e => { if(!D || e.target?.closest?.("input,textarea")) return;
  if(e.key === "Escape"){ stop(); return; }
  const c = e.key.toLowerCase();
  const one = {k:help, "?":help, m:() => window.Drive.layersUI(), c:() => setCam((D.cam + 1) % 3), h:() => auto("rth"), l:landToggle, o:() => auto("orbit"), p:shot, v:recToggle, g:center,
    "+":() => lens(Math.min(2, D.lens + 1)), "=":() => lens(Math.min(2, D.lens + 1)), "-":() => lens(Math.max(0, D.lens - 1)),
    1:() => setMode("cine"), 2:() => setMode("normal"), 3:() => setMode("sport")}[c];
  if(one){ e.preventDefault(); if(!e.repeat) one(); return; }
  const kk = KM[e.key]; if(kk){ e.preventDefault(); e.stopPropagation(); if(["tu","td","gl","gr"].includes(kk) && D.cam !== 0) setCam(0); keys.add(kk); } }, true);
addEventListener("keyup", e => { const kk = KM[e.key]; if(kk) keys.delete(kk); }, true);
addEventListener("blur", () => keys.clear());
addEventListener("hashchange", () => { if((D || PK) && document.body.dataset.view !== "sat") stop(); });
// arrastar no mapa: câmera 360° — no gimbal gira e inclina o gimbal (mais fino com a tele); nas outras, gira e sobe em volta do drone.
// Rodinha: no gimbal troca a lente; nas outras aproxima/afasta
function input(m){
  if(m.__dnIn) return; m.__dnIn = true; const cv = m.getCanvasContainer(); let p0 = null;
  cv.addEventListener("pointerdown", e => { if(!D) return; p0 = [e.clientX, e.clientY]; });
  addEventListener("pointermove", e => { if(!D || !p0) return; const dx = e.clientX - p0[0], dy = e.clientY - p0[1]; p0 = [e.clientX, e.clientY];
    if(D.cam === 0){ const f = LENS[D.lens].fov/40; D.gy = (D.gy - dx*.3*f + 540) % 360 - 180; D.tilt = clamp(D.tilt + dy*.2*f, -90, 0); }
    else { D.oy = (D.oy + dx*.4 + 540) % 360 - 180; D.el = clamp((D.el ?? (D.cam === 1 ? 38 : 14)) + dy*.25, 3, 88); } });
  addEventListener("pointerup", () => { p0 = null; });
  cv.addEventListener("wheel", e => { if(!D) return; e.preventDefault();
    if(D.cam === 0){ lens(clamp(D.lens + (e.deltaY < 0 ? 1 : -1), 0, 2)); return; }
    D.zoomK = clamp(D.zoomK*(e.deltaY > 0 ? 1.12 : .89), .3, 5); }, {passive:false});
}

window.Drone = {start, pick, stop, active:() => !!D, dbg:() => D};
})();
