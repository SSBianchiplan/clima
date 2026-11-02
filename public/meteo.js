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
const CURTO = {vento:"Vento", chuva:"Chuva", temp:"Temp.", ondas:"Ondas", acum:"Acúmulo"};
// ordem de empilhamento no mapa (de baixo para cima) e camadas que cobrem o mundo todo
const ORDEM = ["temp", "vento", "ondas", "acum", "chuva"], CHEIA = new Set(["temp", "vento", "ondas"]);
const M = {meta:null, layers:store.get("met-layers", null) || (store.get("met-layer", null) ? [store.get("met-layer", null)] : []), hi:0, data:new Map(), part:store.get("met-part", true), play:0, busy:false, cvs:{}, urls:{}};
Object.defineProperty(M, "layer", {get(){ return M.layers[M.layers.length - 1] || null; }});

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
// camadas pintadas em cor: somado a outras, o vento vira só partículas (a cor dele cobriria as demais)
const pintadas = () => M.layers.filter(k => !(k === "vento" && M.part && M.layers.length > 1)).sort((a, b) => ORDEM.indexOf(a) - ORDEM.indexOf(b));
// imagem na projeção do mapa (Mercator), que o MapLibre estica do canto ao canto do mundo — uma por camada
async function pintar(m, L, d){
  const N = innerWidth < 700 ? 720 : 1024, cv = M.cvs[L] || (M.cvs[L] = document.createElement("canvas"));
  cv.width = N; cv.height = N; const g = cv.getContext("2d"), im = g.createImageData(N, N), px = im.data, P = PAL[L];
  for(let y = 0; y < N; y++){
    const lat = Math.atan(Math.sinh(Math.PI*(1 - 2*(y + .5)/N)))*180/Math.PI;
    for(let x = 0; x < N; x++){
      const lon = (x + .5)/N*360 - 180, v = valor(L, d, lon, lat), c = isNaN(v) ? null : cor(L, v), o = (y*N + x)*4;
      if(!c) continue;
      let a = P.a;
      if(L === "chuva"){ a = Math.min(230, 90 + v*40);
        // trovoadas: chuva forte com muita energia (CAPE) → tom elétrico
        if(v >= 1 && cape(d, lon, lat) >= 1000){ c[0] = 255; c[1] = 214; c[2] = 10; a = 235; } }
      if(L === "acum") a = Math.min(220, 70 + v*4);
      px[o] = c[0]; px[o+1] = c[1]; px[o+2] = c[2]; px[o+3] = a;
    }
  }
  g.putImageData(im, 0, 0);
  const url = await new Promise(r => cv.toBlob(b => r(URL.createObjectURL(b)), "image/png"));
  const coords = [[-180, MLAT], [180, MLAT], [180, -MLAT], [-180, -MLAT]], id = "met-" + L;
  if(m.getSource(id)){ m.getSource(id).updateImage({url, coordinates:coords}); }
  else {
    m.addSource(id, {type:"image", url, coordinates:coords});
    // por cima da foto, abaixo dos prédios e dos nomes; entre as camadas do tempo, na ORDEM
    const P2 = pintadas(), acima = P2.slice(P2.indexOf(L) + 1).map(k => "met-" + k).find(i => m.getLayer(i));
    const before = acima || ["bld","bld-far","bld-parts"].find(i => m.getLayer(i)) || m.getStyle().layers.find(l => l.type === "symbol")?.id;
    m.addLayer({id, type:"raster", source:id, paint:{"raster-opacity":.85, "raster-resampling":"linear", "raster-fade-duration":0}}, before);
  }
  if(M.urls[L]) setTimeout(((u) => () => URL.revokeObjectURL(u))(M.urls[L]), 2000); M.urls[L] = url;
}
// tira do mapa as camadas que saíram; duas camadas que cobrem o mundo: a de cima fica mais transparente
function arrumarMapa(m){
  const P2 = pintadas();
  for(const k of ORDEM) if(!P2.includes(k)){ if(m.getLayer("met-" + k)) m.removeLayer("met-" + k); if(m.getSource("met-" + k)) m.removeSource("met-" + k); }
  let cheias = 0; for(const k of P2) if(m.getLayer("met-" + k)) m.setPaintProperty("met-" + k, "raster-opacity", CHEIA.has(k) && cheias++ ? .5 : .85);
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
// marcas da legenda sem sobreposição: no mínimo 9% entre elas, e a última sempre aparece
function marcas(S, lo, hi){
  const out = [];
  for(const [v] of S){ const x = (v - lo)/(hi - lo)*100; if(!out.length || x - out[out.length - 1][1] >= 9) out.push([v, x]); }
  const fim = S[S.length - 1][0]; if(out[out.length - 1][0] !== fim){ if(100 - out[out.length - 1][1] < 9) out.pop(); out.push([fim, 100]); }
  return out;
}
function legenda(L){
  const P = PAL[L], S = P.stops, lo = S[0][0], hi = S[S.length - 1][0];
  return `<div class="met-leg"><b class="met-leg-t">${ico(ICON[L], 14)}${NOMES[L]} <em>${P.un}</em></b><i style="background:linear-gradient(90deg,${S.map(([v, c]) => `${c} ${((v - lo)/(hi - lo)*100).toFixed(1)}%`).join(",")})"></i>
    <div>${marcas(S, lo, hi).map(([v, x]) => `<span style="left:${x.toFixed(1)}%">${String(v).replace(".", ",")}</span>`).join("")}</div>
    ${L === "chuva" ? `<small><u style="background:#FFD60A"></u> trovoadas (chuva com CAPE ≥ 1000 J/kg)</small>` : ""}${L === "vento" && M.part && M.layers.length > 1 ? `<small>com outras camadas, o vento aparece só como partículas</small>` : ""}</div>`;
}
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
function painel(){
  let p = $("metPanel");
  if(!p){ p = document.createElement("section"); p.id = "metPanel"; p.className = "met-panel glass"; document.body.appendChild(p); }
  const run = M.meta ? new Date(M.meta.time) : null, on = M.layers.length > 0;
  const runTxt = run ? `${run.toLocaleString("pt-BR", {day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit"})} (${String(run.getUTCHours()).padStart(2, "0")} UTC)` : "";
  p.innerHTML = `<header><b>${ico("wind", 18)} Camadas do tempo</b><button class="met-x" id="metX" aria-label="Fechar">${ico("x", 16)}</button></header>
    <div class="met-lay" role="group" aria-label="Camadas">${Object.keys(NOMES).map(k => `<button data-ml="${k}" aria-pressed="${M.layers.includes(k)}" title="${NOMES[k]}"${k === "ondas" && M.meta && !M.meta.ondas ? " disabled" : ""}>${ico(ICON[k], 18)}<span>${CURTO[k]}</span></button>`).join("")}</div>
    <p class="met-hint">${on ? "Toque no mapa para ver o valor do ponto." : "Escolha uma camada e toque no mapa para ver o valor do ponto."} <span class="met-kbd">${matchMedia("(pointer: coarse)").matches ? "Toque longo numa camada para somar outra." : `${MAC ? "<kbd>Ctrl</kbd> ou <kbd>⌘</kbd>" : "<kbd>Ctrl</kbd>"} + clique soma camadas.`}</span></p>
    ${on ? `<div class="met-time"><button id="metPlay" aria-label="${M.play ? "Pausar" : "Animar"}">${ico(M.play ? "pause" : "play", 16)}</button>
      <input type="range" id="metT" min="0" max="${M.meta.hours.length - 1}" value="${M.hi}" aria-label="Hora da previsão"><b id="metTl">${fmtHora(M.hi)}</b></div>
      <div class="met-legs">${M.layers.slice().sort((a, b) => ORDEM.indexOf(b) - ORDEM.indexOf(a)).map(legenda).join("")}</div>
      <label class="met-chk"><input type="checkbox" id="metPart" ${M.part ? "checked" : ""}> Partículas de vento animadas</label>` : ""}
    <div class="met-mod"><span>Modelo</span><div class="met-seg" role="group" aria-label="Modelo">${Object.entries(MODELOS).map(([k, v]) => `<button data-mm="${k}" aria-pressed="${k === MOD}">${v.nome}</button>`).join("")}</div></div>
    <small class="met-src">${runTxt ? `Rodada ${runTxt} · ` : ""}${MODELOS[MOD].fonte} · 5 dias</small>`;
  $("metX").onclick = fechar;
  p.querySelectorAll("[data-mm]").forEach(b => b.onclick = async () => { if(b.dataset.mm === MOD) return; MOD = b.dataset.mm; try{ localStorage.setItem("met-model", JSON.stringify(MOD)); }catch(e){}
    M.meta = null; M.data.clear(); M.cur = null; try{ await meta(); if(on) await atualizar(); }catch(e){ window.ClimaToast?.(`${MODELOS[MOD].curto}: rodada ainda não disponível.`); } painel(); });
  // clique: só esta camada (de novo: desliga) · Ctrl/⌘/Shift + clique ou toque longo: soma ou tira esta camada
  p.querySelectorAll("[data-ml]").forEach(b => {
    let longo = 0, feito = false;
    b.onpointerdown = e => { if(e.pointerType !== "touch") return; feito = false; longo = setTimeout(() => { feito = true; navigator.vibrate?.(15); toggleLayer(b.dataset.ml); }, 450); };
    b.onpointerup = b.onpointerleave = b.onpointercancel = () => clearTimeout(longo);
    // no Mac, Ctrl + clique chega como menu de contexto (e não como clique): vira "somar camada", sem abrir o menu
    b.oncontextmenu = e => { if(feito){ e.preventDefault(); return; } if(e.ctrlKey){ e.preventDefault(); toggleLayer(b.dataset.ml); } };
    b.onclick = e => { if(feito){ feito = false; return; } const k = b.dataset.ml;
      if(e.ctrlKey || e.metaKey || e.shiftKey) toggleLayer(k); else setLayer(M.layers.length === 1 && M.layer === k ? null : k); };
  });
  if(on){
    $("metT").oninput = e => { M.hi = +e.target.value; $("metTl").textContent = fmtHora(M.hi); clearTimeout(M.tt); M.tt = setTimeout(atualizar, 120); };
    $("metPlay").onclick = () => { if(M.play){ clearInterval(M.play); M.play = 0; } else M.play = setInterval(() => { M.hi = (M.hi + 1) % M.meta.hours.length; const r = $("metT"); if(r){ r.value = M.hi; $("metTl").textContent = fmtHora(M.hi); } atualizar(); }, 900); painel(); };
    $("metPart").onchange = e => { M.part = e.target.checked; store.set("met-part", M.part); atualizar(); painel(); };
  }
}
async function atualizar(){
  const m = window.Sat?.map(); if(!m || !M.layers.length) return;
  if(M.busy){ M.again = true; return; } M.busy = true;
  try{ await meta(); M.cur = await hora(M.hi); arrumarMapa(m); for(const L of pintadas()) await pintar(m, L, M.cur); arrumarMapa(m);
    if(M.part && (!$("metCv")?.isConnected || !M.raf)) particulas(m); }
  catch(e){ window.ClimaToast?.("Camadas do tempo indisponíveis agora (servidor sem a rodada do GFS)."); }
  finally{ M.busy = false; }
  if(M.again){ M.again = false; return atualizar(); }
  // pré-carrega as próximas horas
  for(let k = 1; k <= 2; k++) if(M.hi + k < M.meta.hours.length) hora(M.hi + k);
}
function salvar(){ store.set("met-layers", M.layers); store.set("met-layer", M.layer); }
async function aplicar(){
  const m = window.Sat?.map(); salvar();
  if(!M.layers.length){ if(m) arrumarMapa(m); cancelAnimationFrame(M.raf); M.raf = 0; M.ctx?.clearRect(0, 0, M.ctx.canvas.width, M.ctx.canvas.height); clearInterval(M.play); M.play = 0; }
  else { await meta(); await atualizar(); if(M.part) particulas(m); }
  painel(); window.Sat?.panelRefresh?.();
}
// uma camada só (ou nenhuma)
function setLayer(l){ M.layers = l ? [l] : []; return aplicar(); }
// soma ou tira uma camada das que já estão no mapa
function toggleLayer(l){ M.layers = M.layers.includes(l) ? M.layers.filter(k => k !== l) : [...M.layers, l]; return aplicar(); }
async function abrir(){ try{ await meta(); }catch(e){} painel(); }
function fechar(){ $("metPanel")?.remove(); }
// valor no ponto tocado: uma linha por camada ligada
function texto(L, d, lng, lat){
  const v = valor(L, d, lng, lat), [u, vv] = vento(d, lng, lat), dir = (Math.atan2(-u, -vv)*180/Math.PI + 360) % 360, card = ["N","NE","L","SE","S","SO","O","NO"][Math.round(dir/45) % 8];
  if(isNaN(v)) return L === "ondas" ? "sem dado aqui (terra)" : "sem dado";
  return L === "vento" ? `${Math.round(v)} km/h de ${card}` : L === "temp" ? `${v.toFixed(1).replace(".", ",")} °C`
    : L === "chuva" ? `${v < .1 ? "sem chuva" : v.toFixed(1).replace(".", ",") + " mm/h"}${cape(d, lng, lat) >= 1000 && v >= 1 ? " · risco de trovoada" : ""}` : L === "acum" ? `${v.toFixed(1).replace(".", ",")} mm desde a rodada` : `${v.toFixed(1).replace(".", ",")} m`;
}
function clique(m){
  m.on("click", e => { if(!M.layers.length || !M.cur || document.body.classList.contains("drv")) return;
    const {lng, lat} = e.lngLat, d = M.cur, L = M.layers.slice().sort((a, b) => ORDEM.indexOf(b) - ORDEM.indexOf(a));
    const linhas = L.length === 1 ? `<b>${NOMES[L[0]]}</b><span>${texto(L[0], d, lng, lat)}</span>` : L.map(k => `<p class="met-pl"><em>${CURTO[k]}</em><span>${texto(k, d, lng, lat)}</span></p>`).join("");
    new maplibregl.Popup({closeButton:false, className:"met-pop"}).setLngLat(e.lngLat).setHTML(`${linhas}<small>${fmtHora(M.hi)} · ${MODELOS[MOD].curto}</small>`).addTo(m);
  });
}
const iv = setInterval(() => { const m = window.Sat?.map(); if(!m || !m.getStyle()) return; clearInterval(iv); clique(m);
  if(M.layers.length) m.once("idle", aplicar); }, 1000);
// rodada nova do GFS: a cada 20 min confere; se mudou, troca os dados e repinta a camada aberta
setInterval(async () => { if(document.hidden) return;
  try{ const l = await (await fetch(BASE_() + "latest.json", {cache:"no-cache"})).json(); if(M.meta && l.run !== M.meta.run){ M.meta = null; M.data.clear(); if(M.layers.length){ await meta(); atualizar(); } } }catch(e){} }, 20*60*1000);
window.Meteo = {abrir, fechar, setLayer, toggleLayer, isOn:() => M.layers.length > 0, layer:() => M.layer, layers:() => M.layers.slice()};
})();
