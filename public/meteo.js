/* =============================================================================
   CAMADAS METEOROLÓGICAS NO MAPA (estilo Windy) — previsão de 5 dias do NOAA GFS
   (domínio público) processada no servidor por tools/meteo_gfs.py: vento com
   partículas animadas, chuva e trovoadas, temperatura, ondas (GFS-Wave /
   WaveWatch III) e chuva acumulada. O servidor manda só "imagens de dados" de
   0,5° (/data/meteo/gfs/<rodada>/<hora>{a,b,w}.png); aqui elas viram cores na
   projeção do mapa, partículas e o valor do ponto tocado.
   ============================================================================= */
(() => {
"use strict";
const $ = id => document.getElementById(id), ico = (n, s=18) => window.Ico?.(n, s) || "";
const store = {get(k,d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } }, set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }};
const MODELOS = {gfs:{nome:"GFS · NOAA", curto:"GFS", fonte:"NOAA GFS 0,5° e GFS-Wave (domínio público)"}, ecmwf:{nome:"ECMWF", curto:"ECMWF", fonte:"ECMWF IFS dados abertos (CC BY 4.0) e ondas WAM"}};
let MOD = (s => MODELOS[s] ? s : "gfs")((() => { try{ return JSON.parse(localStorage.getItem("met-model")) || "gfs"; }catch(e){ return "gfs"; } })());
const BASE_ = () => `/data/meteo/${MOD}/`, MLAT = 85.0511;
// paletas (valor → cor) no espírito do Windy; alfa por camada
const PAL = {
  vento: {un:"km/h", stops:[[0,"#3b5bbf"],[10,"#3e8fd1"],[20,"#41b3a3"],[30,"#6fcf5a"],[45,"#d8d24a"],[60,"#e8873a"],[80,"#d63c3c"],[110,"#a32b8c"],[150,"#5e2a8f"]], a:150},
  temp: {un:"°C", stops:[[-40,"#8e5ac2"],[-20,"#4e5fc0"],[-10,"#3b86d6"],[0,"#4fc0e6"],[10,"#66cc8a"],[20,"#e6d24c"],[30,"#ef8a3a"],[40,"#d6303a"],[50,"#7d1239"]], a:150},
  chuva: {un:"mm/h", stops:[[.1,"#9fd8ff"],[1,"#4aa3ff"],[3,"#2f6bd6"],[7,"#7b3fd6"],[15,"#d63fa8"],[30,"#ff4040"]], a:200, min:.1},
  acum: {un:"mm", stops:[[1,"#b8e3ff"],[5,"#6fb7ff"],[15,"#3f7fe0"],[30,"#6b4fd0"],[60,"#b041c0"],[120,"#e0405a"],[250,"#ff8c3a"]], a:190, min:1},
  ondas: {un:"m", stops:[[0,"#3b4cc0"],[1,"#3e8ed6"],[2,"#43c1a6"],[3,"#8bd65a"],[4.5,"#e6d24a"],[6,"#e8873a"],[8,"#d63c3c"],[11,"#8f2fa0"]], a:175}
};
const NOMES = {vento:"Vento", chuva:"Chuva e trovoadas", temp:"Temperatura", ondas:"Ondas", acum:"Chuva acumulada"};
const ICON = {vento:"wind", chuva:"rain", temp:"thermo", ondas:"waves", acum:"drop"};
const M = {meta:null, layer:store.get("met-layer", null), hi:0, data:new Map(), part:store.get("met-part", true), play:0, busy:false};

/* ---------- dados ---------- */
async function meta(){
  if(M.meta) return M.meta;
  const l = await (await fetch(BASE_() + "latest.json", {cache:"no-cache"})).json();
  M.meta = await (await fetch(`${BASE_()}${l.run}/meta.json`)).json();
  // hora inicial: a mais próxima de agora
  const t0 = Date.parse(M.meta.time), now = Date.now();
  M.hi = M.meta.hours.reduce((b, h, i) => Math.abs(t0 + h*36e5 - now) < Math.abs(t0 + M.meta.hours[b]*36e5 - now) ? i : b, 0);
  return M.meta;
}
async function img(url){
  const b = await (await fetch(url)).blob(), bm = await createImageBitmap(b);
  const c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext("2d", {willReadFrequently:true}); g.drawImage(bm, 0, 0);
  return g.getImageData(0, 0, bm.width, bm.height).data;
}
async function hora(i){
  const h = M.meta.hours[i], k = `${M.meta.run}/${h}`;
  if(!M.data.has(k)){
    const f = String(h).padStart(3, "0"), base = `${BASE_()}${M.meta.run}/${f}`;
    M.data.set(k, Promise.all([img(base + "a.png"), img(base + "b.png"), M.meta.ondas ? img(base + "w.png") : null]).then(([a, b, w]) => ({a, b, w})));
    if(M.data.size > 24) M.data.delete(M.data.keys().next().value);
  }
  return M.data.get(k);
}
// leitura bilinear da grade 720×361 (lon −180…179,5, lat 90…−90)
function amostra(arr, ch, lon, lat){
  const W = 720, H = 361, x = ((lon + 180)/.5 % W + W) % W, y = Math.max(0, Math.min(H - 1.001, (90 - lat)/.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = (x0 + 1) % W, fx = x - x0, fy = y - y0, i = (yy, xx) => arr[(yy*W + xx)*4 + ch];
  return (i(y0, x0)*(1 - fx) + i(y0, x1)*fx)*(1 - fy) + (i(y0 + 1, x0)*(1 - fx) + i(y0 + 1, x1)*fx)*fy;
}
const vento = (d, lon, lat) => [amostra(d.a, 0, lon, lat)/255*80 - 40, amostra(d.a, 1, lon, lat)/255*80 - 40];
function valor(layer, d, lon, lat){
  if(layer === "vento"){ const [u, v] = vento(d, lon, lat); return Math.hypot(u, v)*3.6; }
  if(layer === "temp") return amostra(d.a, 2, lon, lat)/255*110 - 60;
  if(layer === "chuva") return (amostra(d.b, 0, lon, lat)/255*10)**2;
  if(layer === "acum") return (amostra(d.b, 1, lon, lat)/255*Math.sqrt(600))**2;
  if(layer === "ondas"){ if(!d.w) return NaN; const W = 720, x = Math.round(((lon + 180)/.5 % W + W) % W), y = Math.round(Math.max(0, Math.min(360, (90 - lat)/.5)));
    const r = d.w[(y*W + x)*4]; return r === 255 ? NaN : amostra(d.w, 0, lon, lat)/17; }
  return NaN;
}
const cape = (d, lon, lat) => (amostra(d.b, 2, lon, lat)/255*Math.sqrt(6000))**2;

/* ---------- cores ---------- */
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function cor(layer, v){
  const P = PAL[layer], S = P.stops; if(!(v >= (P.min ?? -Infinity))) return null;
  if(v <= S[0][0]) return hex(S[0][1]); if(v >= S[S.length - 1][0]) return hex(S[S.length - 1][1]);
  for(let i = 1; i < S.length; i++) if(v <= S[i][0]){ const f = (v - S[i-1][0])/(S[i][0] - S[i-1][0]), a = hex(S[i-1][1]), b = hex(S[i][1]); return a.map((c, k) => Math.round(c + (b[k] - c)*f)); }
}
// imagem na projeção do mapa (Mercator), que o MapLibre estica do canto ao canto do mundo
async function pintar(m){
  const d = await hora(M.hi), N = innerWidth < 700 ? 720 : 1024, cv = M.cv || (M.cv = document.createElement("canvas"));
  cv.width = N; cv.height = N; const g = cv.getContext("2d"), im = g.createImageData(N, N), px = im.data, P = PAL[M.layer];
  for(let y = 0; y < N; y++){
    const lat = Math.atan(Math.sinh(Math.PI*(1 - 2*(y + .5)/N)))*180/Math.PI;
    for(let x = 0; x < N; x++){
      const lon = (x + .5)/N*360 - 180, v = valor(M.layer, d, lon, lat), c = isNaN(v) ? null : cor(M.layer, v), o = (y*N + x)*4;
      if(!c) continue;
      let a = P.a;
      if(M.layer === "chuva"){ a = Math.min(230, 90 + v*40);
        // trovoadas: chuva forte com muita energia (CAPE) → tom elétrico
        if(v >= 1 && cape(d, lon, lat) >= 1000){ c[0] = 255; c[1] = 214; c[2] = 10; a = 235; } }
      if(M.layer === "acum") a = Math.min(220, 70 + v*4);
      px[o] = c[0]; px[o+1] = c[1]; px[o+2] = c[2]; px[o+3] = a;
    }
  }
  g.putImageData(im, 0, 0);
  const url = await new Promise(r => cv.toBlob(b => r(URL.createObjectURL(b)), "image/png"));
  const coords = [[-180, MLAT], [180, MLAT], [180, -MLAT], [-180, -MLAT]];
  if(m.getSource("met")){ m.getSource("met").updateImage({url, coordinates:coords}); }
  else {
    m.addSource("met", {type:"image", url, coordinates:coords});
    // por cima da foto, abaixo dos prédios e dos nomes
    const before = ["bld","bld-far","bld-parts"].find(id => m.getLayer(id)) || m.getStyle().layers.find(l => l.type === "symbol")?.id;
    m.addLayer({id:"met", type:"raster", source:"met", paint:{"raster-opacity":.85, "raster-resampling":"linear", "raster-fade-duration":0}}, before);
  }
  if(M.url) setTimeout(((u) => () => URL.revokeObjectURL(u))(M.url), 2000); M.url = url;
}

/* ---------- partículas de vento ---------- */
function particulas(m){
  const box = m.getContainer(); let cv = $("metCv");
  if(!cv){ cv = document.createElement("canvas"); cv.id = "metCv"; cv.className = "met-cv"; box.appendChild(cv);
    m.on("movestart", () => { M.moving = true; }); m.on("moveend", () => { M.moving = false; semear(m); }); addEventListener("resize", () => { tam(); semear(m); }); }
  const dpr = Math.min(2, devicePixelRatio || 1), tam = () => { cv.width = box.clientWidth*dpr; cv.height = box.clientHeight*dpr; };
  tam(); M.ctx = cv.getContext("2d"); M.dpr = dpr; semear(m);
  cancelAnimationFrame(M.raf); M.raf = requestAnimationFrame(t => passo(m, t));
}
function semear(m){
  const n = Math.round(Math.min(4500, Math.max(1200, innerWidth*innerHeight/420)));
  const b = m.getBounds(), w = b.getWest(), e = b.getEast() < w ? b.getEast() + 360 : b.getEast(), s = Math.max(-80, b.getSouth()), nn = Math.min(80, b.getNorth());
  M.pts = Array.from({length:n}, () => ({lon:w + Math.random()*(e - w), lat:s + Math.random()*(nn - s), age:Math.random()*90 | 0}));
  M.box = [w, e, s, nn]; M.ctx?.clearRect(0, 0, M.ctx.canvas.width, M.ctx.canvas.height);
}
async function passo(m, t){
  if(!M.layer || !M.part){ M.ctx?.clearRect(0, 0, M.ctx.canvas.width, M.ctx.canvas.height); M.raf = 0; return; }
  M.raf = requestAnimationFrame(tt => passo(m, tt));
  const g = M.ctx, W = g.canvas.width, H = g.canvas.height, d = M.cur; if(!d) return;
  if(M.moving){ g.clearRect(0, 0, W, H); return; }
  // rastro que some aos poucos
  g.globalCompositeOperation = "destination-in"; g.fillStyle = "rgba(0,0,0,.9)"; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = "source-over"; g.strokeStyle = "rgba(255,255,255,.78)"; g.lineWidth = 1.1*M.dpr; g.beginPath();
  const z = m.getZoom(), K = .16/(512*2**z/360), [w, e, s, n] = M.box;
  for(const p of M.pts){
    const [u, v] = vento(d, p.lon > 180 ? p.lon - 360 : p.lon, p.lat), a = m.project([p.lon, p.lat]);
    p.lon += u*K/Math.max(.2, Math.cos(p.lat*Math.PI/180)); p.lat += v*K; p.age++;
    const b = m.project([p.lon, p.lat]);
    if(p.age > 110 || p.lat < s || p.lat > n || p.lon < w || p.lon > e || Math.hypot(u, v) < .3){ p.lon = w + Math.random()*(e - w); p.lat = s + Math.random()*(n - s); p.age = 0; continue; }
    if(a.x < 0 || a.y < 0 || a.x > W/M.dpr || a.y > H/M.dpr) continue;
    g.moveTo(a.x*M.dpr, a.y*M.dpr); g.lineTo(b.x*M.dpr, b.y*M.dpr);
  }
  g.stroke();
}

/* ---------- painel ---------- */
const fmtHora = i => { const d = new Date(Date.parse(M.meta.time) + M.meta.hours[i]*36e5);
  return d.toLocaleString("pt-BR", {weekday:"short", day:"2-digit", hour:"2-digit", minute:"2-digit"}).replace(",", ""); };
function legenda(){
  const P = PAL[M.layer], S = P.stops, lo = S[0][0], hi = S[S.length - 1][0];
  return `<div class="met-leg"><i style="background:linear-gradient(90deg,${S.map(([v, c]) => `${c} ${((v - lo)/(hi - lo)*100).toFixed(1)}%`).join(",")})"></i>
    <div>${S.filter((_, k) => k % (S.length > 7 ? 2 : 1) === 0 || k === S.length - 1).map(([v]) => `<span style="left:${((v - lo)/(hi - lo)*100).toFixed(1)}%">${String(v).replace(".", ",")}</span>`).join("")}<b>${P.un}</b></div>
    ${M.layer === "chuva" ? `<small><u style="background:#FFD60A"></u> trovoadas (chuva com CAPE ≥ 1000 J/kg)</small>` : ""}</div>`;
}
function painel(){
  let p = $("metPanel");
  if(!p){ p = document.createElement("section"); p.id = "metPanel"; p.className = "met-panel glass"; document.body.appendChild(p); }
  const run = M.meta ? new Date(M.meta.time) : null;
  p.innerHTML = `<header><b>${ico("wind", 18)} Camadas do tempo</b><button class="met-x" id="metX" aria-label="Fechar">${ico("x", 16)}</button></header>
    <div class="met-lay">${Object.keys(NOMES).map(k => `<button data-ml="${k}" aria-pressed="${M.layer === k}"${k === "ondas" && M.meta && !M.meta.ondas ? " disabled" : ""}>${ico(ICON[k], 18)}<span>${NOMES[k]}</span></button>`).join("")}</div>
    ${M.layer ? `<div class="met-time"><button id="metPlay" aria-label="Animar">${ico(M.play ? "pause" : "play", 16)}</button>
      <input type="range" id="metT" min="0" max="${M.meta.hours.length - 1}" value="${M.hi}"><b id="metTl">${fmtHora(M.hi)}</b></div>
      ${legenda()}
      <label class="met-chk"><input type="checkbox" id="metPart" ${M.part ? "checked" : ""}> Partículas de vento animadas</label>` : `<p class="met-hint">Escolha uma camada. Toque no mapa para ver o valor do ponto.</p>`}
    <div class="met-mod"><span>Modelo</span>${Object.entries(MODELOS).map(([k, v]) => `<button data-mm="${k}" aria-pressed="${k === MOD}">${v.nome}</button>`).join("")}<button disabled title="O ICON global (DWD) usa grade icosaédrica: precisa de reprojeção — próxima etapa">ICON</button></div>
    <small class="met-src">${run ? `Rodada ${run.toLocaleString("pt-BR", {day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit"})} · ` : ""}${MODELOS[MOD].fonte} · 5 dias</small>`;
  $("metX").onclick = fechar;
  p.querySelectorAll("[data-mm]").forEach(b => b.onclick = async () => { if(b.dataset.mm === MOD) return; MOD = b.dataset.mm; try{ localStorage.setItem("met-model", JSON.stringify(MOD)); }catch(e){}
    M.meta = null; M.data.clear(); M.cur = null; try{ await meta(); if(M.layer) await atualizar(); }catch(e){ window.ClimaToast?.(`${MODELOS[MOD].curto}: rodada ainda não disponível.`); } painel(); });
  p.querySelectorAll("[data-ml]").forEach(b => b.onclick = () => setLayer(M.layer === b.dataset.ml ? null : b.dataset.ml));
  if(M.layer){
    $("metT").oninput = e => { M.hi = +e.target.value; $("metTl").textContent = fmtHora(M.hi); clearTimeout(M.tt); M.tt = setTimeout(atualizar, 120); };
    $("metPlay").onclick = () => { if(M.play){ clearInterval(M.play); M.play = 0; } else M.play = setInterval(() => { M.hi = (M.hi + 1) % M.meta.hours.length; const r = $("metT"); if(r){ r.value = M.hi; $("metTl").textContent = fmtHora(M.hi); } atualizar(); }, 900); painel(); };
    $("metPart").onchange = e => { M.part = e.target.checked; store.set("met-part", M.part); if(M.part) particulas(window.Sat.map()); };
  }
}
async function atualizar(){
  const m = window.Sat?.map(); if(!m || !M.layer || M.busy) return; M.busy = true;
  try{ await meta(); M.cur = await hora(M.hi); await pintar(m); if(M.part && !$("metCv")?.isConnected) particulas(m); else if(M.part && !M.raf) particulas(m); }
  catch(e){ window.ClimaToast?.("Camadas do tempo indisponíveis agora (servidor sem a rodada do GFS)."); }
  finally{ M.busy = false; }
  // pré-carrega as próximas horas
  for(let k = 1; k <= 2; k++) if(M.hi + k < M.meta.hours.length) hora(M.hi + k);
}
async function setLayer(l){
  const m = window.Sat?.map(); M.layer = l; store.set("met-layer", l);
  if(!l){ if(m?.getLayer("met")) m.removeLayer("met"); if(m?.getSource("met")) m.removeSource("met"); cancelAnimationFrame(M.raf); M.raf = 0; M.ctx?.clearRect(0, 0, M.ctx.canvas.width, M.ctx.canvas.height); clearInterval(M.play); M.play = 0; }
  else { await meta(); await atualizar(); if(M.part) particulas(m); }
  painel(); window.Sat?.panelRefresh?.();
}
async function abrir(){ try{ await meta(); }catch(e){} painel(); }
function fechar(){ $("metPanel")?.remove(); }
// valor no ponto tocado
function clique(m){
  m.on("click", e => { if(!M.layer || !M.cur || document.body.classList.contains("drv")) return;
    const {lng, lat} = e.lngLat, d = M.cur, v = valor(M.layer, d, lng, lat), [u, vv] = vento(d, lng, lat), dir = (Math.atan2(-u, -vv)*180/Math.PI + 360) % 360;
    const card = ["N","NE","L","SE","S","SO","O","NO"][Math.round(dir/45) % 8];
    const txt = isNaN(v) ? "sem dado aqui (terra)" : M.layer === "vento" ? `${Math.round(v)} km/h de ${card}` : M.layer === "temp" ? `${v.toFixed(1).replace(".", ",")} °C`
      : M.layer === "chuva" ? `${v < .1 ? "sem chuva" : v.toFixed(1).replace(".", ",") + " mm/h"}${cape(d, lng, lat) >= 1000 && v >= 1 ? " · risco de trovoada" : ""}` : M.layer === "acum" ? `${v.toFixed(1).replace(".", ",")} mm desde a rodada` : `${v.toFixed(1).replace(".", ",")} m`;
    new maplibregl.Popup({closeButton:false, className:"met-pop"}).setLngLat(e.lngLat).setHTML(`<b>${NOMES[M.layer]}</b><span>${txt}</span><small>${fmtHora(M.hi)} · ${MODELOS[MOD].curto}</small>`).addTo(m);
  });
}
const iv = setInterval(() => { const m = window.Sat?.map(); if(!m || !m.getStyle()) return; clearInterval(iv); clique(m);
  if(M.layer) m.once("idle", () => setLayer(M.layer)); }, 1000);
// rodada nova do GFS: a cada 20 min confere; se mudou, troca os dados e repinta a camada aberta
setInterval(async () => { if(document.hidden) return;
  try{ const l = await (await fetch(BASE_() + "latest.json", {cache:"no-cache"})).json(); if(M.meta && l.run !== M.meta.run){ M.meta = null; M.data.clear(); if(M.layer){ await meta(); atualizar(); } } }catch(e){} }, 20*60*1000);
window.Meteo = {abrir, fechar, setLayer, isOn:() => !!M.layer, layer:() => M.layer};
})();
