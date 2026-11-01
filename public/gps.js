/* =============================================================================
   LOCALIZAÇÃO AO VIVO — um único ponto azul, como no Apple Maps / Google Maps:
   · watchPosition com GPS de alta precisão (maximumAge 0): cada leitura nova chega na hora;
   · filtro de Kalman simples (posição + velocidade) pesado pela precisão de cada leitura:
     tira o "pula-pula" do GPS sem atrasar o ponto;
   · entre uma leitura e outra (1 s ou mais) o ponto segue andando na velocidade e rumo medidos
     (até 2 s), a 60 quadros por segundo — movimento contínuo, sem saltos;
   · círculo de precisão em metros e cone de direção (bússola do aparelho ou rumo do GPS);
   · seguir: depois de tocar em "Minha localização" o mapa acompanha você até você arrastar o mapa;
   · pausa com a aba escondida (bateria) e volta sozinho; some na navegação/direção/drone,
     que têm o próprio marcador.
   ============================================================================= */
(() => {
"use strict";
const D2R = Math.PI/180, toast = t => window.ClimaToast?.(t);
const G = {watch:null, k:null, mk:null, el:null, follow:false, last:null, raf:0, hdg:null, compass:null, granted:false, cb:new Set()};

/* ---------- filtro (metros locais em volta do primeiro ponto) ---------- */
function kalman(fix){
  const {lon, lat, acc, t} = fix;
  if(!G.k){ G.k = {lon0:lon, lat0:lat, x:0, y:0, vx:0, vy:0, P:acc*acc, t}; return; }
  const k = G.k, kx = 111320*Math.cos(k.lat0*D2R), ky = 110574, mx = (lon - k.lon0)*kx, my = (lat - k.lat0)*ky;
  const dt = Math.max(.05, (t - k.t)/1000); k.t = t;
  // previsão: anda com a velocidade estimada; a incerteza cresce com o tempo (pessoa a pé/carro: ~3 m/s²)
  k.x += k.vx*dt; k.y += k.vy*dt; k.P += (3*dt)**2 + 1;
  // salto absurdo (túnel, troca GPS↔rede): recomeça no ponto novo
  if(Math.hypot(mx - k.x, my - k.y) > Math.max(250, 4*acc) && acc < 60){ k.x = mx; k.y = my; k.vx = k.vy = 0; k.P = acc*acc; return; }
  const K = k.P/(k.P + acc*acc), ox = k.x, oy = k.y;
  k.x += K*(mx - k.x); k.y += K*(my - k.y); k.P *= (1 - K);
  // velocidade: a do GPS quando existe, senão a da diferença filtrada
  if(fix.spd != null && fix.hdg != null && fix.spd >= 0){ const sp = fix.spd, h = fix.hdg*D2R; k.vx = .6*k.vx + .4*sp*Math.sin(h); k.vy = .6*k.vy + .4*sp*Math.cos(h); }
  else { k.vx = .7*k.vx + .3*(k.x - ox)/dt; k.vy = .7*k.vy + .3*(k.y - oy)/dt; }
  if(Math.hypot(k.vx, k.vy) < .4){ k.vx *= .5; k.vy *= .5; }   // parado: não "escorrega"
}
function agora(){
  const k = G.k; if(!k) return null;
  const dt = Math.min(2, (performance.now() - k.tp)/1000), kx = 111320*Math.cos(k.lat0*D2R);
  return [k.lon0 + (k.x + k.vx*dt)/kx, k.lat0 + (k.y + k.vy*dt)/110574];
}

/* ---------- desenho ---------- */
function circulo(lon, lat, r){
  const n = 48, kx = 111320*Math.cos(lat*D2R), c = [];
  for(let i = 0; i <= n; i++){ const a = i/n*2*Math.PI; c.push([lon + Math.cos(a)*r/kx, lat + Math.sin(a)*r/110574]); }
  return {type:"Feature", geometry:{type:"Polygon", coordinates:[c]}};
}
function camadas(m){
  if(m.getSource("gps-acc")) return;
  m.addSource("gps-acc", {type:"geojson", data:{type:"FeatureCollection", features:[]}});
  m.addLayer({id:"gps-acc", type:"fill", source:"gps-acc", paint:{"fill-color":"#0A84FF", "fill-opacity":.13}});
  m.addLayer({id:"gps-acc-l", type:"line", source:"gps-acc", paint:{"line-color":"#0A84FF", "line-opacity":.45, "line-width":1.2}});
}
function marcador(m, p){
  if(!G.el){ G.el = document.createElement("div"); G.el.className = "gps-dot"; G.el.innerHTML = "<s></s><i></i>";
    G.mk = new maplibregl.Marker({element:G.el, rotationAlignment:"map", pitchAlignment:"map"}).setLngLat(p).addTo(m); }
  G.mk.setLngLat(p);
}
const escondido = () => document.body.classList.contains("rt-nav") || document.body.classList.contains("drv") || !!window.Drone?.active?.();
function quadro(){
  G.raf = requestAnimationFrame(quadro);
  const m = window.Sat?.map(), alvo = agora(); if(!m || !alvo) return;
  // o ponto desliza até a posição filtrada (~0,3 s): cada leitura nova corrige sem "pulinho"
  const now = performance.now(), dt = Math.min(.1, (now - (G.tq || now))/1000); G.tq = now;
  if(!G.disp || Math.hypot((alvo[0] - G.disp[0])*111320*Math.cos(alvo[1]*D2R), (alvo[1] - G.disp[1])*110574) > 150) G.disp = alvo.slice();
  else { const f = 1 - Math.exp(-dt/.3); G.disp[0] += (alvo[0] - G.disp[0])*f; G.disp[1] += (alvo[1] - G.disp[1])*f; }
  const p = G.disp;
  const off = escondido(); if(G.el) G.el.style.display = off ? "none" : "";
  if(off){ m.getSource("gps-acc")?.setData({type:"FeatureCollection", features:[]}); return; }
  camadas(m); marcador(m, p);
  // círculo de precisão: só redesenha quando muda de verdade (é caro)
  const acc = G.last?.acc || 0, key = `${p[0].toFixed(6)},${p[1].toFixed(6)},${Math.round(acc)}`;
  if(key !== G.ak && acc > 8){ G.ak = key; m.getSource("gps-acc").setData({type:"FeatureCollection", features:[circulo(p[0], p[1], acc)]}); }
  else if(acc <= 8 && G.ak){ G.ak = null; m.getSource("gps-acc").setData({type:"FeatureCollection", features:[]}); }
  // cone de direção: bússola (parado) ou rumo do GPS (andando > 1 m/s)
  const sp = G.k ? Math.hypot(G.k.vx, G.k.vy) : 0, h = sp > 1 ? (Math.atan2(G.k.vx, G.k.vy)/D2R + 360) % 360 : G.compass;
  const cone = G.el.querySelector("s");
  if(h == null){ cone.style.display = "none"; } else { cone.style.display = ""; G.hdg = G.hdg == null ? h : (G.hdg + ((((h - G.hdg + 540) % 360) - 180))*.2 + 360) % 360; cone.style.transform = `rotate(${G.hdg}deg)`; }
  G.el.classList.toggle("gps-old", !!G.last && Date.now() - G.last.t0 > 30000);
  if(G.follow && !m.isMoving()) m.jumpTo({center:p});
}

/* ---------- leitura do GPS ---------- */
function leitura(pos){
  const c = pos.coords, fix = {lon:c.longitude, lat:c.latitude, acc:Math.max(3, c.accuracy || 50), spd:c.speed, hdg:c.heading, t:performance.now(), t0:Date.now()};
  // leitura muito pior que a atual e recente: ignora (o GPS às vezes manda uma da rede no meio)
  if(G.last && fix.acc > Math.max(120, 3*G.last.acc) && fix.t0 - G.last.t0 < 15000) return;
  kalman(fix); G.k.tp = performance.now(); G.last = fix;
  G.cb.forEach(f => { try{ f(agora(), fix); }catch(e){} });
  if(!G.raf) G.raf = requestAnimationFrame(quadro);
}
function erro(e){
  if(e.code === 1){ parar(); toast("Localização negada — libere nas configurações do navegador para ver o ponto azul ao vivo."); }
}
function iniciar(){
  if(G.watch != null || !navigator.geolocation) return;
  G.watch = navigator.geolocation.watchPosition(leitura, erro, {enableHighAccuracy:true, maximumAge:0, timeout:20000});
  bussola();
}
function parar(){ if(G.watch != null) navigator.geolocation.clearWatch(G.watch); G.watch = null; }
// bússola do aparelho (no iPhone precisa de permissão, pedida no toque do botão)
function bussola(){
  if(G.compassOn) return; G.compassOn = true;
  const on = e => { const h = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? (360 - e.alpha) % 360 : null); if(h != null) G.compass = h; };
  addEventListener("deviceorientationabsolute", on, true); addEventListener("deviceorientation", on, true);
}
async function pedirBussola(){ try{ if(typeof DeviceOrientationEvent?.requestPermission === "function") await DeviceOrientationEvent.requestPermission(); }catch(e){} }

/* ---------- botão "Minha localização" ---------- */
async function centrar(){
  pedirBussola(); iniciar();
  const m = window.Sat?.map(); if(!m) return;
  const ir = () => { const p = agora(); if(!p) return false; const acc = G.last.acc;
    G.follow = true; m.stop(); m.flyTo({center:p, zoom:Math.max(m.getZoom() < 14 ? 0 : m.getZoom(), Math.min(m.getMaxZoom(), acc > 800 ? 13 : 17)), duration:1200, essential:true});
    document.getElementById("satCenter")?.classList.add("on"); return true; };
  if(!ir()){ document.getElementById("satCenter")?.classList.add("busy");
    const f = () => { G.cb.delete(f); document.getElementById("satCenter")?.classList.remove("busy"); ir(); }; G.cb.add(f);
    setTimeout(() => { if(G.cb.has(f)){ G.cb.delete(f); document.getElementById("satCenter")?.classList.remove("busy"); toast("Sem sinal de GPS ainda — tente ao ar livre."); } }, 20000); }
}
const iv = setInterval(() => { const m = window.Sat?.map(); if(!m || !m.getStyle()) return; clearInterval(iv);
  // arrastar ou girar com o dedo para de seguir (o ponto continua ao vivo)
  for(const ev of ["dragstart", "touchstart", "wheel"]) m.on(ev, () => { if(G.follow){ G.follow = false; document.getElementById("satCenter")?.classList.remove("on"); } });
  // permissão já dada antes: liga o ponto ao vivo sozinho
  navigator.permissions?.query({name:"geolocation"}).then(s => { if(s.state === "granted") iniciar(); s.onchange = () => { if(s.state === "granted") iniciar(); }; }).catch(() => {});
}, 800);
// aba escondida: para o GPS (bateria); ao voltar, retoma
document.addEventListener("visibilitychange", () => { if(document.hidden){ if(G.watch != null){ G.resume = true; parar(); } } else if(G.resume){ G.resume = false; iniciar(); } });

window.Gps = {centrar, iniciar, parar, pos:() => G.disp ? G.disp.slice() : agora(), fix:() => G.last, on:f => G.cb.add(f), off:f => G.cb.delete(f), ativo:() => G.watch != null};
})();
