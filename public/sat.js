/* =============================================================================
   SATÉLITE (globo 3D em MapLibre GL — open source, BSD-3) — fundo em tempo real e página de satélite (#sat).
   Imagem: GOES-19 (GOES-East) via NASA GIBS, a cada 10 min, sobre o Blue Marble.
   Radar: RainViewer. Rótulos: CARTO/OSM.
   Starlink: órbitas (TLE do CelesTrak, baixadas pelo servidor a cada 2 h)
   propagadas no navegador com SGP4 — posição de cada satélite agora.
   ============================================================================= */
(() => {
"use strict";
const C = window.ClimaCore;
const {$, esc, r0, r1, dirName} = C;
const store = {
  get(k,d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
// Prédios: Overture Maps (OSM + contornos detectados por IA nas fotos aéreas), lido por partes do PMTiles.
const OVERTURE_FALLBACK = "2026-09-23.0";
// cache em memória dos tiles de prédios: o que a pré-carga buscou em volta da tela é entregue na hora ao navegar
const PMC = new Map(), pmP = window.pmtiles ? new pmtiles.Protocol() : null;
(function pmProtocol(){ if(pmP && window.maplibregl && !maplibregl.__pm){ maplibregl.__pm = true;
  maplibregl.addProtocol("pmtiles", async (params, abort) => {
    const hit = params.type !== "json" && PMC.get(params.url);
    if(hit){ try{ const r = await hit; if(r) return {data:r.data.slice(0), cacheControl:r.cacheControl, expires:r.expires}; }catch(e){} }
    return pmP.tile(params, abort);
  }); } })();
function pmPre(url){
  if(!pmP || PMC.has(url)) return null;
  const p = pmP.tile({url, type:"arrayBuffer"}, new AbortController()).catch(() => { PMC.delete(url); return null; });
  PMC.set(url, p); if(PMC.size > 800) PMC.delete(PMC.keys().next().value);
  return p;
}
async function overtureRelease(){
  try{ const c = await (await fetch("https://stac.overturemaps.org/catalog.json")).json();
    const h = (c.links||[]).find(l=>l.rel==="child"); const v = h && h.href.match(/\/(\d{4}-\d{2}-\d{2}\.\d+)\//); if(v) return v[1]; }catch(e){}
  return OVERTURE_FALLBACK;
}
const TERRARIUM_SRC = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";
// O relevo aberto (Mapzen/SRTM) tem cinco tipos de defeito que viram paredões, buracos e "montanhas" no 3D.
// O protocolo "dem0://" baixa cada tile e corrige tudo antes do MapLibre ver (demClean, abaixo).
const TERRARIUM = "dem0://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";
// Camada opcional "Relevo fino" (desligada por padrão): Mapterhorn — Copernicus GLO-30 no mundo todo e lidar nacionais
// onde há, sem chave. Tiles de 512 px: o quadrante de um tile z−1 tem exatamente os pixels do tile de 256 px do zoom z,
// então o MapLibre e o demClean veem a mesma grade da AWS. 404 no Mapterhorn é mar (0 m); outra falha volta para a AWS.
const MT_SRC = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
const TERRARIUM_MT = "dem0://mt/{z}/{x}/{y}.png";
async function demFetch(url, z, x, y, mt, signal){
  if(mt && z >= 1){
    try{
      const r = await fetch(MT_SRC.replace("{z}", z-1).replace("{x}", x >> 1).replace("{y}", y >> 1), {signal});
      if(r.ok || r.status === 404){
        const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement("canvas"), {width:256, height:256}), g = c.getContext("2d");
        if(r.ok) g.drawImage(await createImageBitmap(await r.blob()), (x & 1)*256, (y & 1)*256, 256, 256, 0, 0, 256, 256);   // recorte 1:1, sem reamostrar
        else { g.fillStyle = "rgb(128,0,0)"; g.fillRect(0, 0, 256, 256); }   // terrarium de 0 m
        return c;
      }
    }catch(e){ if(signal?.aborted) throw e; }
  }
  const r = await fetch(url, {signal}); if(!r.ok) throw new Error("HTTP " + r.status);
  return await createImageBitmap(await r.blob());
}
// 1) Piso por região. No mar o piso é 0 m (some a batimetria colada à praia). Terra que fica de verdade abaixo
// do nível do mar mantém a altura real, e lagos que vieram com o fundo medido ficam na superfície da água.
// Caixa [oeste, sul, leste, norte] ou círculo {c:[lon,lat], km}; a primeira que contém o ponto vale.
const DEM_FLOORS = [
  {b:[51.35,43.25,51.95,43.75], f:-132},   // Karagiye (Cazaquistão)
  {b:[46.5,36.5,55.2,47.5], f:-29},        // mar Cáspio e a depressão em volta
  {b:[57.0,39.8,59.2,41.2], f:-81},        // Akdzhakaya (Turcomenistão)
  {b:[35.2,30.4,35.9,32.95], f:-435},      // mar Morto, vale do Jordão e mar da Galileia
  {b:[-117.6,35.5,-116.3,37.0], f:-86},    // Death Valley
  {b:[-116.4,32.5,-115.2,33.8], f:-72},    // Salton Sea e Imperial Valley
  {b:[25.0,28.5,30.0,30.7], f:-133},       // depressão de Qattara
  {b:[39.6,13.0,40.6,14.5], f:-125},       // Danakil (Dallol)
  {c:[42.42,11.63], km:7, f:-155},         // lago Assal
  {b:[88.5,42.4,90.2,43.0], f:-154},       // Turpan
  {b:[5.5,33.6,7.2,34.6], f:-40},          // Chott Melrhir
  {b:[136.4,-29.9,138.6,-27.4], f:-16},    // lago Eyre
  {c:[-71.6,18.48], km:15, f:-46},         // lago Enriquillo
  {c:[-68.35,-49.58], km:25, f:-105},      // Gran Bajo de San Julián
  {b:[3.3,51.3,7.2,53.6], f:-7},           // pôlderes da Holanda
  {c:[-122.108,42.942], km:4.6, f:1882},   // Crater Lake (fundo medido)
  {c:[98.66,2.82], km:12, f:904}, {c:[98.86,2.62], km:13, f:904}, {c:[99.0,2.5], km:9, f:904},   // lago Toba
  {c:[-69.35,-15.85], km:28, f:3809}       // Titicaca
];
function demFloor(z, x, y, W, H){
  const n = 2 ** z, lon = c => (x + (c+.5)/W)/n*360 - 180, lat = r => Math.atan(Math.sinh(Math.PI*(1 - 2*(y + (r+.5)/H)/n)))*180/Math.PI;
  const w0 = lon(-.5), e0 = lon(W-.5), n0 = lat(-.5), s0 = lat(H-.5);
  const hit = DEM_FLOORS.filter(R => { const [a,b,c,d] = R.b || [R.c[0]-R.km/80, R.c[1]-R.km/111*1.01, R.c[0]+R.km/80, R.c[1]+R.km/111*1.01]; return a < e0 && c > w0 && b < n0 && d > s0; });
  if(!hit.length) return null;
  const F = new Float32Array(W*H), LA = Array.from({length:H}, (_,r) => lat(r)), LO = Array.from({length:W}, (_,c) => lon(c));
  for(let r=0;r<H;r++) for(let c=0;c<W;c++){ let f = 0;
    for(const R of hit){ if(R.b){ if(LO[c] >= R.b[0] && LO[c] <= R.b[2] && LA[r] >= R.b[1] && LA[r] <= R.b[3]){ f = R.f; break; } }
      else { const dx = (LO[c]-R.c[0])*111.32*Math.cos(R.c[1]*Math.PI/180), dy = (LA[r]-R.c[1])*110.57; if(dx*dx + dy*dy <= R.km*R.km){ f = R.f; break; } } }
    F[r*W+c] = f; }
  return F;
}
// mínimo/máximo numa janela quadrada (2r+1)² — separável, para a abertura/fechamento morfológico
function demWin(src, W, H, r, isMax){
  const T = new Float32Array(src.length), D = new Float32Array(src.length), pick = isMax ? (a,b) => a > b ? a : b : (a,b) => a < b ? a : b;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){ let m = src[y*W+x]; for(let k=Math.max(0,x-r);k<=Math.min(W-1,x+r);k++) m = pick(m, src[y*W+k]); T[y*W+x] = m; }
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){ let m = T[y*W+x]; for(let k=Math.max(0,y-r);k<=Math.min(H-1,y+r);k++) m = pick(m, T[k*W+x]); D[y*W+x] = m; }
  return D;
}
// regiões conexas (8 vizinhos) de uma máscara; chama fn(lista de índices)
function demBlobs(B, W, H, fn){
  const seen = new Uint8Array(B.length), st = [];
  for(let p0=0;p0<B.length;p0++){ if(!B[p0] || seen[p0]) continue;
    const L = []; st.push(p0); seen[p0] = 1;
    while(st.length){ const p = st.pop(); L.push(p); const x = p % W, y = (p - x) / W;
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){ const u = x+dx, v = y+dy; if(u<0||v<0||u>=W||v>=H) continue; const q = v*W+u; if(B[q] && !seen[q]){ seen[q] = 1; st.push(q); } } }
    fn(L); }
}
// E: altitudes em metros (W×H); bm: máscara de pegadas de prédios (Overture) do mesmo tile, ou null;
// om: dados do OpenFreeMap no tile — {peaks: [{x, y (pixels), lat, ele}], aero: [máscara de cada aeródromo]}
function demClean(E, W, H, z, x, y, bm, om){
  const peaks = om?.peaks;
  // 0) mar: o Terrarium traz o fundo do mar (batimetria) — abaixo de 0 m vira relevo "embaixo d'água" e
  // ondulações perto da costa. Tudo abaixo do nível do mar vai a 0, exceto terras reais abaixo do mar.
  { const BELOW = [[34.9,30.5,35.8,32.9],[46,36,55.5,47.5],[-117.3,35.8,-116.5,36.7],[-116.3,32.9,-115.4,33.6],[25.5,28.8,29.5,30.6],[40,11.5,42.5,14.7],[3.3,51.2,7.2,53.6],[88.8,42.3,90,43.1]];
    const n = 2 ** z, w0 = x/n*360 - 180, e0 = (x+1)/n*360 - 180, la = t => Math.atan(Math.sinh(Math.PI*(1 - 2*t/n)))*180/Math.PI, n0 = la(y), s0 = la(y+1);
    if(!BELOW.some(([a,b,c,d]) => a < e0 && c > w0 && b < n0 && d > s0)) for(let p=0;p<E.length;p++) if(E[p] < 0) E[p] = 0; }
  // 0b) espelhos d'água planos (contorno real da água, z10–13): mar = 0 m; lago/represa = um nível só;
  // rio só se for quase plano no trecho (rio descendo a serra continua descendo)
  if(om?.water && W === 256){ const Wm = om.water, sea = new Uint8Array(E.length), lake = new Uint8Array(E.length);
    for(let p=0;p<E.length;p++){ if(Wm[p] === 1) sea[p] = 1; else if(Wm[p] === 2) lake[p] = 1; }
    demBlobs(sea, W, H, L => { for(const p of L) if(E[p] > 0 && E[p] < 40) E[p] = 0; });
    demBlobs(lake, W, H, L => { if(L.length < 6) return; const v = L.map(p => E[p]).sort((a,b) => a-b), lo = v[Math.floor(v.length*.15)], hi = v[Math.floor(v.length*.85)];
      if(hi - lo > 25) return; const lv = Math.max(0, lo); for(const p of L) E[p] = lv; }); }
  const F = demFloor(z, x, y, W, H);
  for(let p=0;p<E.length;p++){ const f = F ? F[p] : 0; if(E[p] < f) E[p] = f; }
  // 2) buracos falsos (−425 m no lago Tahoe, −740 m no Te Anau, poços no rio Hudson): regiões pequenas
  // (≤ 40 px) mais de 25 m abaixo do fechamento 5×5 e cercadas por superfície plana (lago, rio, mar, várzea)
  // voltam ao nível em volta. Vales e cânions têm bordas em declive e ficam como estão.
  const CL = demWin(demWin(E, W, H, 2, true), W, H, 2, false), pit = new Uint8Array(E.length);
  for(let p=0;p<E.length;p++) if(CL[p] - E[p] > 25) pit[p] = 1;
  demBlobs(pit, W, H, L => { if(L.length > 40) return;
    // anel em volta do buraco: tem que ser plano (água) — em encosta de montanha ele varia muito
    let lo = 1e9, hi = -1e9;
    for(const p of L){ const px = p % W, py = (p - px) / W;
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){ const u = px+dx, v = py+dy; if(u<0||v<0||u>=W||v>=H) continue; const q = v*W+u; if(pit[q]) continue; if(E[q] < lo) lo = E[q]; if(E[q] > hi) hi = E[q]; } }
    if(hi - lo <= 8) for(const p of L) E[p] = (lo + hi) / 2; });
  // 3) picos isolados (pontes, torres, ruído sobre água): ponto > 20 m acima de TODOS os 8 vizinhos vira a mediana deles
  // (só com pixel ≤ 76 m, z ≥ 11: em zoom menor um cume real fica acima de todos os vizinhos)
  const nb = new Float32Array(8);
  if(z >= 11) for(let pass=0; pass<2; pass++) for(let yy=1;yy<H-1;yy++) for(let xx=1;xx<W-1;xx++){
    const p = yy*W+xx; let k = 0, mx = -1e9;
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){ if(!dx && !dy) continue; const v = E[p+dy*W+dx]; nb[k++] = v; if(v > mx) mx = v; }
    if(E[p] - mx > 20){ nb.sort(); E[p] = (nb[3] + nb[4]) / 2; }
  }
  // 4) "falsas montanhas" na costa: o radar registrou topos de prédios, pontes e navios como terreno (Miami
  // 201 m, Dubai 195 m). Abertura 7×7: o que é mais estreito que ~270 m e sobe > 15 m a partir de base baixa
  // (< 12 m acima do piso) volta ao nível da base. A janela tem ~270 m no chão em qualquer zoom (7×7 no z12,
  // 3×3 no z10–11); abaixo do z10 o pixel já é largo demais e a etapa não roda (cortaria cumes do litoral).
  const r4 = z >= 12 ? 3 * 2 ** (z - 12) : 1;
  const MN = demWin(E, W, H, r4, false), OP = demWin(MN, W, H, r4, true);
  if(z >= 10) for(let p=0;p<E.length;p++){ const f = F ? F[p] : 0; if(f <= 0 && E[p] - OP[p] > 15 && MN[p] - f < 12) E[p] = OP[p]; }   // lago de montanha não conta: a borda da cratera é real
  // 5) prédios no relevo das cidades altas (São Paulo, Bogotá, Cidade do México, Seul…): a mesma abertura,
  // mas só nas "lombadas" em que ≥ 40% da área cai sobre pegadas de prédios do Overture. Morro com um
  // forte ou uma antena em cima não passa (Leme, Urca); montanhas sem cidade nunca são tocadas.
  if(bm){
    const MN2 = demWin(E, W, H, r4, false), OP2 = demWin(MN2, W, H, r4, true);
    const near = demWin(bm, W, H, 1, true), bump = new Uint8Array(E.length);
    for(let p=0;p<E.length;p++) if(E[p] - OP2[p] > 15) bump[p] = 1;
    demBlobs(bump, W, H, L => { let k = 0; for(const p of L) if(near[p] > 0) k++; if(k >= .4 * L.length) for(const p of L) E[p] = OP2[p]; });
  }
  // 6) aeroportos: o radar deixa pista e pátio ondulados (Congonhas: 767 → 810 m com ondas de ±5 m numa pista
  // plana). Em cada área de aeródromo ajusta-se um plano (mínimos quadrados, descartando o que foge > 2σ) e o
  // relevo vira esse plano — pista lisa, com a inclinação real —, com transição suave de ~110 m na borda.
  // Morros dentro da cerca (Guarulhos, Confins) ficam: o plano só vale onde o terreno já está a ≤ 12 m dele.
  const ring = Math.max(1, Math.round(3 * 2 ** (z - 12)));
  for(const A of (om?.aero || [])){
    let idx = []; for(let p=0;p<A.length;p++) if(A[p]) idx.push(p);
    if(idx.length < 12) continue;
    let pl = null;
    for(let it=0; it<5; it++){
      let n = 0, sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
      for(const p of idx){ const px = p % W, py = (p - px) / W, v = E[p]; n++; sx += px; sy += py; sz += v; sxx += px*px; syy += py*py; sxy += px*py; sxz += px*v; syz += py*v; }
      const mx = sx/n, my = sy/n, mz = sz/n, cxx = sxx/n - mx*mx, cyy = syy/n - my*my, cxy = sxy/n - mx*my, cxz = sxz/n - mx*mz, cyz = syz/n - my*mz, det = cxx*cyy - cxy*cxy;
      const b = det > 1e-9 ? (cxz*cyy - cyz*cxy) / det : 0, c = det > 1e-9 ? (cyz*cxx - cxz*cxy) / det : 0;
      pl = p => { const px = p % W, py = (p - px) / W; return mz + b*(px - mx) + c*(py - my); };
      let s2 = 0; for(const p of idx) s2 += (E[p] - pl(p)) ** 2; const sd = Math.sqrt(s2 / idx.length);
      const lim = Math.max(6, 2 * sd), keep = idx.filter(p => Math.abs(E[p] - pl(p)) <= lim);
      if(keep.length < 12) break; idx = keep;
    }
    let all = 0, near = 0; for(let p=0;p<A.length;p++) if(A[p]){ all++; if(Math.abs(E[p] - pl(p)) <= 10) near++; }
    if(near < .3 * all) continue;
    // anéis de distância para a transição (1 = dentro; cai até 0 a "ring" pixels da borda)
    let cur = Uint8Array.from(A); const wgt = new Float32Array(A.length);
    for(let p=0;p<A.length;p++) if(A[p]) wgt[p] = 1;
    for(let k=1; k<=ring; k++){ const nx = Uint8Array.from(cur);
      for(let p=0;p<A.length;p++){ if(cur[p]) continue; const px = p % W, py = (p - px) / W;
        if((px>0 && cur[p-1]) || (px<W-1 && cur[p+1]) || (py>0 && cur[p-W]) || (py<H-1 && cur[p+W])){ nx[p] = 1; wgt[p] = 1 - k/(ring+1); } }
      cur = nx; }
    for(let p=0;p<A.length;p++) if(wgt[p] > 0){ const d = Math.abs(E[p] - pl(p)), wr = d <= 6 ? 1 : d >= 12 ? 0 : (12 - d) / 6; E[p] = E[p] + (pl(p) - E[p]) * wgt[p] * wr; }
  }
  // 7) ruído em terreno plano: o radar tem ±3–8 m de "granulado", que no 3D vira ondas em várzeas, cidades e
  // campos. Suavização 5×5 (1-4-6-4-1) só onde a variação local (5×5) é menor que 15 m — morros e encostas não mudam.
  if(z >= 11){
    const RG = demWin(E, W, H, 2, true), RL = demWin(E, W, H, 2, false), k5 = [1,4,6,4,1], T = new Float32Array(E.length), G = new Float32Array(E.length);
    for(let yy=0;yy<H;yy++) for(let xx=0;xx<W;xx++){ let s = 0; for(let k=-2;k<=2;k++) s += k5[k+2] * E[yy*W + Math.min(W-1, Math.max(0, xx+k))]; T[yy*W+xx] = s/16; }
    for(let yy=0;yy<H;yy++) for(let xx=0;xx<W;xx++){ let s = 0; for(let k=-2;k<=2;k++) s += k5[k+2] * T[Math.min(H-1, Math.max(0, yy+k))*W + xx]; G[yy*W+xx] = s/16; }
    for(let p=0;p<E.length;p++){ const r = RG[p] - RL[p]; if(r < 15) E[p] = r < 10 ? G[p] : E[p] + (G[p] - E[p]) * (15 - r) / 5; }
  }
  // 8) cumes estreitos: o radar de 30 m "arredonda" picos (Corcovado sai 572 m em vez de 710, Pão de Açúcar
  // 309 em vez de 396, Matterhorn 4.352 em vez de 4.478). Para cada cume do OpenStreetMap com altitude oficial
  // dentro do tile, o relevo ganha uma elevação suave somada ao morro (zero na borda, raio ~1,5× o que falta, mín. 90 m).
  // Só sobe (nunca rebaixa) e ignora diferenças > 350 m (erro de cadastro).
  if(peaks && peaks.length){
    const n = 2 ** z, mpp = lat => 40075016 * Math.cos(lat*Math.PI/180) / (W * n);
    for(const pk of peaks){
      const cx = pk.x, cy = pk.y, ix = Math.round(cx - .5), iy = Math.round(cy - .5);
      if(ix < -4 || iy < -4 || ix > W+3 || iy > H+3) continue;
      let top = -1e9; for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++){ const u = ix+dx, v = iy+dy; if(u>=0 && v>=0 && u<W && v<H && E[v*W+u] > top) top = E[v*W+u]; }
      if(top < -1e8 || pk.ele - top < 8) continue;
      const c0 = E[Math.min(H-1, Math.max(0, iy))*W + Math.min(W-1, Math.max(0, ix))], miss = pk.ele - c0;   // o pixel do cume chega exatamente à altitude oficial
      if(miss > 350) continue;
      const m = mpp(pk.lat), R = Math.max(90, miss * 1.5) / m, Ri = Math.ceil(R);
      for(let dy=-Ri;dy<=Ri;dy++) for(let dx=-Ri;dx<=Ri;dx++){ const u = ix+dx, v = iy+dy; if(u<0 || v<0 || u>=W || v>=H) continue;
        const d = Math.hypot(u + .5 - cx, v + .5 - cy) / R; if(d >= 1) continue;
        const q = v*W+u; E[q] = Math.max(E[q], Math.min(pk.ele, E[q] + miss * .5 * (1 + Math.cos(Math.PI * d)))); } } }   // soma suave: o morro mantém a forma
  return E;
}
// decodificador mínimo de vector tile (MVT): só as camadas pedidas, com geometria e propriedades
function mvtLayers(buf, want){
  const b = new Uint8Array(buf), out = {}, td = new TextDecoder(); let p = 0;
  const vr = () => { let r = 0, s = 0, c; do { c = b[p++]; r += (c & 127) * 2 ** s; s += 7; } while(c & 128); return r; };
  const end = () => { const l = vr(); return p + l; };   // fim do bloco (lê o tamanho antes de somar)
  const skip = w => { if(w===0) vr(); else if(w===1) p += 8; else if(w===2){ const l = vr(); p += l; } else if(w===5) p += 4; };
  while(p < b.length){ const t = vr(); if(t>>3 !== 3 || (t&7) !== 2){ skip(t&7); continue; }
    const e = end(); let name = "", ext = 4096; const feats = [], keys = [], vals = [];
    while(p < e){ const t2 = vr(), f = t2>>3, w = t2&7;
      if(f===1 && w===2){ const l = vr(); name = td.decode(b.subarray(p, p+l)); p += l; }
      else if(f===3 && w===2){ const l = vr(); keys.push(td.decode(b.subarray(p, p+l))); p += l; }
      else if(f===4 && w===2){ const e2 = end(); let v = null;
        while(p < e2){ const t3 = vr(), f3 = t3>>3;
          if(f3===1){ const l = vr(); v = td.decode(b.subarray(p, p+l)); p += l; }
          else if(f3===2){ v = new DataView(b.buffer, b.byteOffset + p, 4).getFloat32(0, true); p += 4; }
          else if(f3===3){ v = new DataView(b.buffer, b.byteOffset + p, 8).getFloat64(0, true); p += 8; }
          else if(f3===6){ const u = vr(); v = u % 2 ? -(u+1)/2 : u/2; }
          else if(f3===4 || f3===5 || f3===7) v = vr(); else skip(t3&7); }
        vals.push(v); }
      else if(f===2 && w===2){ const e2 = end(), ft = {type:0, geom:[], tags:[]};
        while(p < e2){ const t3 = vr(), f3 = t3>>3;
          if(f3===4 || f3===2){ const e3 = end(), A = f3===4 ? ft.geom : ft.tags; while(p < e3) A.push(vr()); }
          else if(f3===3) ft.type = vr(); else skip(t3&7); }
        feats.push(ft); }
      else if(f===5 && w===0) ext = vr();
      else skip(w); }
    p = e;
    if(want.includes(name)){ for(const ft of feats){ ft.props = {}; for(let i=0;i+1<ft.tags.length;i+=2) ft.props[keys[ft.tags[i]]] = vals[ft.tags[i+1]]; } out[name] = {ext, feats}; } }
  return out;
}
// polígonos MVT → máscara N×N (regra par-ímpar, varredura por linha); fill(M, f) pinta uma feição
function mvtFill(M, N, ext, f){
  const s = N / ext, R = []; let x = 0, y = 0, i = 0, cur = null; const g = f.geom;
  while(i < g.length){ const c = g[i++], id = c & 7, n = c >> 3;
    if(id === 7){ if(cur) R.push(cur); cur = null; continue; }
    for(let k=0;k<n;k++){ const dx = g[i++], dy = g[i++]; x += (dx>>>1) ^ -(dx&1); y += (dy>>>1) ^ -(dy&1);
      if(id === 1){ if(cur) R.push(cur); cur = [[x*s, y*s]]; } else cur.push([x*s, y*s]); } }
  if(cur) R.push(cur);
  for(let row=0; row<N; row++){ const yc = row + .5, xs = [];
    for(const r of R) for(let k=0, j=r.length-1; k<r.length; j=k++){ const [x1,y1] = r[j], [x2,y2] = r[k]; if((y1 > yc) !== (y2 > yc)) xs.push(x1 + (yc - y1) * (x2 - x1) / (y2 - y1)); }
    xs.sort((a,b)=>a-b);
    for(let k=0; k+1<xs.length; k+=2){ const a = Math.max(0, Math.ceil(xs[k]-.5)), e = Math.min(N-1, Math.floor(xs[k+1]-.5)); for(let c=a;c<=e;c++) M[row*N+c] = 1; } }
  return M;
}
function mvtMask(L, N){
  const M = new Float32Array(N*N); if(!L) return M;
  for(const f of L.feats) if(f.type === 3) mvtFill(M, N, L.ext, f);
  return M;
}
let OV_REL = OVERTURE_FALLBACK, ovPM = null;
// pegadas de prédios do Overture no mesmo tile (z12–13); sem rede ou demorando, o relevo segue sem a etapa 5
async function demBuildings(z, x, y, N){
  if(z < 12 || z > 13 || !window.pmtiles) return null;
  try{
    const url = `https://tiles.overturemaps.org/${OV_REL}/buildings.pmtiles`;
    if(!ovPM || ovPM.source.getKey() !== url) ovPM = new pmtiles.PMTiles(url);
    const r = await Promise.race([ovPM.getZxy(z, x, y), new Promise(res => setTimeout(() => res("tarde"), 5000))]);
    if(!r || r === "tarde") return null;
    return mvtMask(mvtLayers(r.data, ["building"]).building, N);
  }catch(e){ return null; }
}
// do mesmo tile do OpenFreeMap (z10–13): cumes com altitude (camada mountain_peak, a dos rótulos "▲ Corcovado
// 710 m") e as áreas dos aeródromos (aeroway), uma máscara por aeroporto
let omtTiles = null;
async function demOmt(z, x, y, N){
  if(z < 10 || z > 13) return null;
  try{
    omtTiles = omtTiles || fetch("https://tiles.openfreemap.org/planet").then(r => r.json()).then(j => j.tiles[0]);
    const u = (await omtTiles).replace("{z}", z).replace("{x}", x).replace("{y}", y);
    const r = await Promise.race([fetch(u), new Promise(res => setTimeout(() => res(null), 5000))]);
    if(!r || !r.ok) return null;
    const T = mvtLayers(await r.arrayBuffer(), ["mountain_peak","aeroway","water"]), n = 2 ** z, peaks = [], aero = [];
    // água (OpenMapTiles): 1 = mar/oceano, 2 = lago, represa, rio, lagoa
    let water = null;
    if(T.water?.feats?.length){ water = new Uint8Array(N*N); const sea = new Uint8Array(N*N), lake = new Uint8Array(N*N);
      for(const f of T.water.feats){ if(f.type !== 3) continue; mvtFill(/^(ocean|sea|bay)$/.test(f.props.class || "") ? sea : lake, N, T.water.ext, f); }
      for(let p=0;p<N*N;p++) water[p] = sea[p] ? 1 : lake[p] ? 2 : 0; }
    const L = T.mountain_peak;
    for(const f of (L?.feats || [])){ const pr = f.props, ele = +pr.ele; if(f.type !== 1 || !(ele > 0) || !["peak","volcano"].includes(pr.class)) continue;
      const g = f.geom, dx = g[1], dy = g[2], px = ((dx>>>1) ^ -(dx&1)) / L.ext * N, py = ((dy>>>1) ^ -(dy&1)) / L.ext * N;
      peaks.push({x:px, y:py, ele, lat: Math.atan(Math.sinh(Math.PI*(1 - 2*(y + py/N)/n)))*180/Math.PI}); }
    for(const f of (T.aeroway?.feats || [])) if(f.type === 3 && f.props.class === "aerodrome") aero.push(mvtFill(new Uint8Array(N*N), N, T.aeroway.ext, f));
    return {peaks, aero, water};
  }catch(e){ return null; }
}
(function demProtocol(){
  if(!window.maplibregl || maplibregl.__dem0) return; maplibregl.__dem0 = true;
  /* O tratamento do relevo (piso, buracos, picos, prédios, aeroportos, cumes) é pesado: roda em Web Workers,
     fora da thread principal, e o tile pronto fica guardado no Cache Storage (próximas visitas: instantâneo). */
  const VER = "dem4";
  const src = `self.window = self; importScripts(${JSON.stringify(location.origin + "/vendor/pmtiles.js")});
const OVERTURE_FALLBACK = ${JSON.stringify(OVERTURE_FALLBACK)}; const DEM_FLOORS = ${JSON.stringify(DEM_FLOORS)}; const MT_SRC = ${JSON.stringify(MT_SRC)};
let OV_REL = OVERTURE_FALLBACK, ovPM = null, omtTiles = null, cv = null;
${[demFloor, demWin, demBlobs, demClean, mvtLayers, mvtFill, mvtMask, demBuildings, demOmt, demFetch].map(String).join("\n")}
async function work(url, z, x, y, mt){
  const key = "https://dem0.local/${VER}" + (mt ? "mt" : "") + "/" + z + "/" + x + "/" + y; let cache = null;
  try{ cache = await caches.open("clima-dem0-${VER}"); const hit = await cache.match(key); if(hit) return await hit.arrayBuffer(); }catch(e){}
  const bmP = demBuildings(z, x, y, 256), omP = demOmt(z, x, y, 256);
  const bmp = await demFetch(url, z, x, y, mt);
  cv = cv || new OffscreenCanvas(256, 256); if(cv.width !== bmp.width){ cv.width = bmp.width; cv.height = bmp.height; }
  const g = cv.getContext("2d", {willReadFrequently:true}); g.drawImage(bmp, 0, 0);
  const im = g.getImageData(0, 0, cv.width, cv.height), d = im.data, W = cv.width, H = cv.height, E = new Float32Array(W*H);
  for(let i=0,p=0;p<E.length;i+=4,p++) E[p] = d[i]*256 + d[i+1] + d[i+2]/256 - 32768;
  let bm = await bmP; if(bm && W !== 256) bm = null; const om = await omP;
  demClean(E, W, H, z, x, y, bm, W === 256 ? om : null);
  for(let i=0,p=0;p<E.length;i+=4,p++){ const v = Math.round((E[p] + 32768)*256); d[i] = v >> 16 & 255; d[i+1] = v >> 8 & 255; d[i+2] = v & 255; }
  g.putImageData(im, 0, 0);
  const blob = await cv.convertToBlob({type:"image/png"});
  try{ if(cache) await cache.put(key, new Response(blob, {headers:{"Content-Type":"image/png"}})); }catch(e){}
  return await blob.arrayBuffer();
}
onmessage = async e => { const q = e.data; if(q.rel) OV_REL = q.rel;
  try{ const buf = await work(q.url, q.z, q.x, q.y, q.mt); postMessage({id:q.id, buf}, [buf]); }catch(err){ postMessage({id:q.id, err:String(err && err.message || err)}); } };`;
  let pool = [];
  try{ const u = URL.createObjectURL(new Blob([src], {type:"text/javascript"}));
    const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));
    for(let i=0;i<n;i++) pool.push(new Worker(u)); }catch(e){ pool = []; }
  const waiting = new Map(); let seq = 0, rr = 0;
  pool.forEach(w => w.onmessage = e => { const cb = waiting.get(e.data.id); if(!cb) return; waiting.delete(e.data.id); e.data.err ? cb.rej(new Error(e.data.err)) : cb.res(e.data.buf); });
  let cv = null;
  maplibregl.addProtocol("dem0", async (params, abort) => {
    const [z, x, y] = params.url.match(/(\d+)\/(\d+)\/(\d+)\.png/).slice(1).map(Number), mt = params.url.startsWith("dem0://mt/");
    const url = mt ? TERRARIUM_SRC.replace("{z}", z).replace("{x}", x).replace("{y}", y) : "https://" + params.url.slice(7);   // no Mapterhorn, a AWS fica de reserva
    if(pool.length){
      const id = ++seq, w = pool[rr++ % pool.length];
      const buf = await new Promise((res, rej) => { waiting.set(id, {res, rej}); w.postMessage({id, url, z, x, y, mt, rel:OV_REL}); });
      return {data: buf};
    }
    // sem Worker (navegador antigo): mesmo tratamento na thread principal
    const bmP = demBuildings(z, x, y, 256), omP = demOmt(z, x, y, 256);
    const bmp = await demFetch(url, z, x, y, mt, abort?.signal);
    cv = cv || (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement("canvas"), {width:256, height:256}));
    if(cv.width !== bmp.width){ cv.width = bmp.width; cv.height = bmp.height; }
    const g = cv.getContext("2d", {willReadFrequently:true}); g.drawImage(bmp, 0, 0);
    const im = g.getImageData(0, 0, cv.width, cv.height), d = im.data;
    const W = cv.width, Hh = cv.height, E = new Float32Array(W*Hh);
    for(let i=0,p=0;p<E.length;i+=4,p++) E[p] = d[i]*256 + d[i+1] + d[i+2]/256 - 32768;
    let bm = await bmP; if(bm && W !== 256) bm = null;
    const om = await omP;
    demClean(E, W, Hh, z, x, y, bm, W === 256 ? om : null);
    for(let i=0,p=0;p<E.length;i+=4,p++){ const v = Math.round((E[p] + 32768)*256); d[i] = v >> 16 & 255; d[i+1] = v >> 8 & 255; d[i+2] = v & 255; }
    g.putImageData(im, 0, 0);
    const blob = cv.convertToBlob ? await cv.convertToBlob({type:"image/png"}) : await new Promise(res=>cv.toBlob(res, "image/png"));
    return {data: await blob.arrayBuffer()};
  });
})();
// Imagem sem nuvens (Esri World Imagery) até o z19. A Esri tem z18–19 nas cidades e em boa parte do litoral, mas
// fora delas devolve uma figura "Map data not yet available" (cinza claro com texto, 2–3 KB). O protocolo "esri0://" detecta
// essa figura e, no lugar dela, recorta e amplia o zoom mais próximo que tem foto — nítido onde existe, sem placa
// cinza onde não existe. Zooms já sabidos sem foto não são pedidos de novo.
const ESRI_IMG = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/";
(function esriProtocol(){
  if(!window.maplibregl || maplibregl.__esri0) return; maplibregl.__esri0 = true;
  const semFoto = new Set(), mk = n => typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(n, n) : Object.assign(document.createElement("canvas"), {width:n, height:n});
  const cv = mk(256), cp = mk(16), gp = cp.getContext("2d", {willReadFrequently:true});
  // a figura de "sem dados" é pequena e quase toda cinza-claro/branca e sem cor; foto real (mar, mata, cidade) não
  const vazio = async b => {
    if(b.size > 4500) return false;
    const bmp = await createImageBitmap(b); gp.drawImage(bmp, 0, 0, 16, 16); const d = gp.getImageData(0, 0, 16, 16).data; let n = 0;
    for(let i=0;i<d.length;i+=4){ const r = d[i], g = d[i+1], bl = d[i+2]; if(Math.max(r,g,bl) - Math.min(r,g,bl) < 8 && r > 185) n++; }
    return n >= .85 * 256;
  };
  const pega = async (z, y, x, signal) => {
    if(semFoto.has(`${z-1}/${y>>1}/${x>>1}`) || semFoto.has(`${z}/${y}/${x}`)){ semFoto.add(`${z}/${y}/${x}`); return null; }   // pai sem foto → filhos também
    const r = await fetch(`${ESRI_IMG}${z}/${y}/${x}`, {signal});
    if(!r.ok){ if(r.status === 404) semFoto.add(`${z}/${y}/${x}`); return null; }
    const b = await r.blob(); if(await vazio(b)){ semFoto.add(`${z}/${y}/${x}`); return null; }
    return b;
  };
  maplibregl.addProtocol("esri0", async (params, abort) => {
    const [z, y, x] = params.url.slice(8).split("/").map(Number), signal = abort?.signal;
    const b = await pega(z, y, x, signal);
    if(b) return {data: await b.arrayBuffer()};
    for(let up=1; z-up >= 0; up++){   // sobe até achar foto (o zoom baixo sempre tem): nunca deixa buraco
      const k = 2 ** up, pb = await pega(z-up, Math.floor(y/k), Math.floor(x/k), signal); if(!pb) continue;
      const bmp = await createImageBitmap(pb), s = bmp.width / k, g = cv.getContext("2d");
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
      g.drawImage(bmp, (x % k)*s, (y % k)*s, s, s, 0, 0, 256, 256);
      const out = cv.convertToBlob ? await cv.convertToBlob({type:"image/jpeg", quality:.92}) : await new Promise(res=>cv.toBlob(res, "image/jpeg", .92));
      return {data: await out.arrayBuffer()};
    }
    throw new Error("sem imagem");
  });
})();
// Cobertura global: três geoestacionários empilhados (Himawari embaixo, GOES-West, GOES-East no topo)
// e, na cor real, o mosaico diário do VIIRS por baixo, que cobre Europa, África e Índico (fora do GIBS).
const SATS = [
  {k:"hima", bounds:[60,-81,180,81], nome:"Himawari-9", geocolor:["Himawari_AHI_Band3_Red_Visible_1km",7], ir:["Himawari_AHI_Band13_Clean_Infrared",6], airmass:["Himawari_AHI_Air_Mass",6]},
  {k:"west", bounds:[-180,-81,-56,81], nome:"GOES-18",    geocolor:["GOES-West_ABI_GeoColor",7],              ir:["GOES-West_ABI_Band13_Clean_Infrared",6], airmass:["GOES-West_ABI_Air_Mass",6]},
  {k:"east", bounds:[-156,-81,6,81], nome:"GOES-19",    geocolor:["GOES-East_ABI_GeoColor",7],              ir:["GOES-East_ABI_Band13_Clean_Infrared",6], airmass:["GOES-East_ABI_Air_Mass",6]}
];
const setOf = z => `GoogleMapsCompatible_Level${z}`;
const PRODUCTS = {
  geocolor:{nome:"Cor real", layer:"GOES-East_ABI_GeoColor", set:"GoogleMapsCompatible_Level7", z:7},
  ir:      {nome:"Infravermelho", layer:"GOES-East_ABI_Band13_Clean_Infrared", set:"GoogleMapsCompatible_Level6", z:6},
  airmass: {nome:"Massas de ar", layer:"GOES-East_ABI_Air_Mass", set:"GoogleMapsCompatible_Level6", z:6},
  earth:   {nome:"Planeta Água", clear:true}
};
const isClear = () => !!PRODUCTS[P.prod].clear;
const P = {
  map:null, goes:null, radar:null, labels:null, here:null, loc:null,
  prod: store.get("sat-prod","geocolor"), showRadar: store.get("sat-radar",false), showStar: store.get("sat-star",true), bg: store.get("sat-bg",true),
  hgt: store.get("sat-hgt", false), fold: store.get("sat-fold", true), base: store.get("sat-base", "sat"), ovRail: store.get("sat-ov-rail", false), ovBike: store.get("sat-ov-bike", false), proj: store.get("sat-proj", "globe"), air: store.get("sat-air", false), planes: new Map(), spc: store.get("sat-spc", false), nameCls: new Set(store.get("sat-namecls", ["country","state","city","town","village","suburb","quarter","neighbourhood","roads","water","peaks","borders"])), alt: store.get("sat-alt", false), mt: store.get("sat-mt", false), names: store.get("sat-names", true), bld: store.get("sat-bld", true), measure:null,
  time:null, frames:[], anim:null, sats:[], starAt:0, overhead:{n:0, list:[]}, canvas:null, timer:null, radarHost:null, radarPath:null
};
const inSat = () => document.body.classList.contains("mapview");

// Cristo Redentor em 3D: estátua não é "prédio" no OpenStreetMap, então não vem no Overture. Volumes nas medidas
// reais (pedestal 8 m, estátua 30 m, braços de 28 m), de frente para a baía (rumo ~120°).
function cristoGeo(){
  const c = [-43.21049, -22.95192], f = 120 * Math.PI/180, mx = 1/(111320*Math.cos(c[1]*Math.PI/180)), my = 1/110574;
  const fx = Math.sin(f), fy = Math.cos(f), ax = Math.sin(f - Math.PI/2), ay = Math.cos(f - Math.PI/2);   // frente e eixo dos braços
  const box = (w, d, base, h, off=0) => { const pts = [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2],[-w/2,-d/2]].map(([u,v]) => [c[0] + (u*ax + (v+off)*fx)*mx, c[1] + (u*ay + (v+off)*fy)*my]);
    return {type:"Feature", properties:{base, h}, geometry:{type:"Polygon", coordinates:[pts]}}; };
  return {type:"FeatureCollection", features:[
    box(15, 15, 0, 8),          // pedestal (com a capela)
    box(8, 6, 8, 20), box(6.5, 5, 20, 30), box(5, 4.2, 30, 34),   // manto, afinando para cima
    box(28, 3, 30.5, 33.8),     // braços abertos
    box(3.2, 3.4, 34, 38, .3)   // cabeça
  ]};
}
/* ---------- prédios 3D com fachada texturizada ----------
   Até 12 m: volume liso na cor real (telhado/fachada do OSM/Overture) ou num tom quente por altura.
   Acima de 12 m: três camadas sem sobreposição — fachada com textura pelo material (vidro, tijolo, concreto,
   metal; sem dado, pela altura), e uma laje de telhado de 0,7 m na cor do telhado. */
// altura: dado real (Overture/OSM) → andares × 3,2 m → média medida do bairro (GHSL, via feature-state) → 6 m
// telhados com forma (pirâmide, cúpula, duas águas…): a parede sobe só até height − roof_height; o telhado é desenhado
// em fatias por roofs3d.js. Prédio que é só telhado (as pirâmides de Gizé) sai das camadas de caixas.
const ROOF_SHAPES = ["pyramidal","dome","spherical","onion","gabled","hipped","half_hipped","mansard","gambrel","skillion","round","saltbox"];
const RH = ["to-number",["get","roof_height"],0], HH = ["to-number",["get","height"],0];
const ROOF_OK = ["all", ["in", ["coalesce",["get","roof_shape"],""], ["literal", ROOF_SHAPES]], [">=", RH, 1.5], [">", HH, 0]];
// só telhado: o telhado tem ≥ 90% da altura, ou é pirâmide sem altura no OSM com "pyramid" no nome (roofs3d.js calcula pela base)
const ROOF_NM = ["downcase", ["to-string", ["coalesce", ["get","names"], ""]]];
const ROOF_WHOLE = ["any", ["all", ROOF_OK, [">=", RH, ["*", HH, .9]]],
  ["all", ["==", ["get","roof_shape"], "pyramidal"], ["!", ["has","height"]], ["any", ["in", "pyram", ROOF_NM], ["in", "piram", ROOF_NM], ["in", "pirâm", ROOF_NM]]]];
const WALL = ["max", 0, ["-", HH, ["min", RH, HH]]];
const BLD_H = ["case", ROOF_OK, WALL, ["coalesce",["get","height"],["*",["get","num_floors"],3.2],["feature-state","gh"],6]],
  BLD_HF = ["case", ROOF_OK, WALL, ["coalesce",["get","height"],["*",["get","num_floors"],3.2],6]], BLD_TX = 12;
// aparelho fraco (celular/tablet com ≤ 6 núcleos, ou ≤ 4 GB): prédios lisos, sem textura de fachada
const LIGHT = (navigator.deviceMemory && navigator.deviceMemory <= 4) || (matchMedia("(pointer: coarse)").matches && (navigator.hardwareConcurrency || 4) <= 6);
window.CLIMA_LIGHT = LIGHT;
// fachadas: 12 tons de cidade real (neutros mais frequentes). "fb" vem do dado quando há cor medida do telhado
// (SIG-SC); senão um tom fixo por prédio, sorteado pela própria altura (estável entre visitas)
const FACADE = ["#EEEBE4","#E8E1D3","#E6D9BE","#DCCAA6","#D2D2CC","#B9BDC1","#E3BFA7","#CC9A80","#C3D3DC","#CBD8C6","#DDBF7E","#C7BCAE"];
const FB = ["coalesce", ["get","fb"], ["at", ["%", ["round", ["*", BLD_HF, 13]], 20], ["literal", [0,0,1,1,2,2,4,4,3,5,11,11,6,8,9,7,10,0,1,2]]]];
const fbMatch = f => ["match", FB, ...FACADE.flatMap((c, k) => k ? [k, f(k, c)] : []), f(0, FACADE[0])];
function bldLayers(id, srcLayer, base, src = "ovb"){
  const low = ["all", base, ["!", ROOF_WHOLE], ["<=", BLD_HF, BLD_TX]], high = ["all", base, ["!", ROOF_WHOLE], [">", BLD_HF, BLD_TX]];
  const mat = ["coalesce",["get","facade_material"],""];
  return [
    {id, type:"fill-extrusion", source:src, ...(srcLayer ? {"source-layer":srcLayer} : {}), minzoom:13, filter:low, layout:{visibility:"none"},
      paint:{"fill-extrusion-height":BLD_H, "fill-extrusion-base":["min",["coalesce",["get","min_height"],0],["-",BLD_H,.5]], "fill-extrusion-opacity":.96, "fill-extrusion-vertical-gradient":true,
        "fill-extrusion-color":["to-color",["coalesce",["get","roof_color"],["get","facade_color"],["step",BLD_H,"#E2D9CB",4,"#DCD3C5",8,"#D3CBBF"]],"#D8D0C4"]}},
    {id:id + "-tx", type:"fill-extrusion", source:src, ...(srcLayer ? {"source-layer":srcLayer} : {}), minzoom:LIGHT ? 24 : 15, filter:high, layout:{visibility:"none"},
      paint:{"fill-extrusion-height":["-",BLD_H,.7], "fill-extrusion-base":["min",["coalesce",["get","min_height"],0],["-",BLD_H,1.4]], "fill-extrusion-opacity":1, "fill-extrusion-vertical-gradient":true,
        // a textura tem tamanho fixo na tela: uma versão por zoom (16–20) mantém 1 andar ≈ 3,3 m em qualquer distância
        "fill-extrusion-pattern":["step",["zoom"], ...[16,17,18,19,20].flatMap((z, i) => { const t = k => `tx-${k}-${z}`;
          const e = ["match",mat,["glass"],t("glass"),["brick"],t("brick"),["metal"],t("metal"),["step",BLD_H,fbMatch(k => t("f" + k)),70,t("glass")]];
          return i ? [z, e] : [e]; })]}},
    // de longe (z12–14) os altos ficam lisos, em tons frios por altura
    {id:id + "-far", type:"fill-extrusion", source:src, ...(srcLayer ? {"source-layer":srcLayer} : {}), minzoom:12, maxzoom:LIGHT ? 24 : 15, filter:high, layout:{visibility:"none"},
      paint:{"fill-extrusion-height":BLD_H, "fill-extrusion-base":["coalesce",["get","min_height"],0], "fill-extrusion-opacity":.96, "fill-extrusion-vertical-gradient":true,
        "fill-extrusion-color":["case",["has","facade_color"],["to-color",["get","facade_color"],"#C8C4BC"],[">=",BLD_H,70],["interpolate",["linear"],BLD_H,70,"#A9B6C4",200,"#8FA3BA"],fbMatch((k, c) => c)]}},
    {id:id + "-roof", type:"fill-extrusion", source:src, ...(srcLayer ? {"source-layer":srcLayer} : {}), minzoom:LIGHT ? 24 : 15, filter:high, layout:{visibility:"none"},
      paint:{"fill-extrusion-height":BLD_H, "fill-extrusion-base":["-",BLD_H,.7], "fill-extrusion-opacity":1,
        "fill-extrusion-color":["to-color",["coalesce",["get","roof_color"],"#BCC0C6"],"#BCC0C6"]}}];
}
const BLD_ALL = ["bld-ao","bld","bld-tx","bld-far","bld-roof","bld-parts","bld-parts-tx","bld-parts-far","bld-parts-roof"];
/* Alturas complementares (Google Open Buildings 2.5D + Wikidata) para cidades em que o Overture não tem altura.
   Arquivo por cidade em data-heights/, carregado só quando ela aparece na tela (zoom ≥ 12). Os prédios
   correspondentes do Overture (que sairiam com 6 m) são escondidos pelo id. Gerado por tools/alturas.py. */
// índice das cidades processadas (data-heights/index.json, gerado por tools/alturas.py): {cidade: {bbox, n}}
let HEIGHT_CITIES = {};
// a lista de cidades com altura cresce enquanto o processamento roda: relê a cada 10 min e ao voltar para a aba,
// assim uma cidade publicada aparece sem precisar recarregar a página
function loadHeights(){ fetch("data-heights/index.json", {cache:"no-cache"}).then(r => r.ok ? r.json() : {}).then(j => {
  let novo = false; for(const [c, v] of Object.entries(j)) if(!HEIGHT_CITIES[c]){ HEIGHT_CITIES[c] = v.bbox; novo = true; }
  if(novo && P.map) heightsFor(P.map); }).catch(()=>{}); }
loadHeights(); setInterval(loadHeights, 10*60e3);
document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible") loadHeights(); });
/* ---------- pré-carga de imagens (o Service Worker guarda cada tile baixado) ----------
   1) Globo até o zoom 5 (1.365 tiles, ~25 MB) em segundo plano — só no Wi-Fi/cabo; refeito a cada 30 dias.
   2) Entorno: ao parar o mapa, baixa em silêncio a borda da área visível e o próximo zoom do centro (até 60 tiles).
   Ambos respeitam o "economia de dados" do aparelho. */
const ESRI_SVC = {sat:"World_Imagery", map:"World_Street_Map", topo:"World_Topo_Map"};
const tileUrl2 = (svc, z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/tile/${z}/${y}/${x}`;
const pf = {q:[], run:0, seen:new Set()};
// só baixa com o mapa parado e com a tela já carregada: nunca disputa conexão com o que você está vendo
const pfIdle = () => !P.map || (!P.map.isMoving() && P.map.areTilesLoaded());
function pfPump(){
  if(!pfIdle()){ clearTimeout(pf.t); pf.t = setTimeout(pfPump, 1500); return; }
  while(pf.run < 2 && pf.q.length){ const u = pf.q.shift(); if(pf.seen.has(u)) continue; pf.seen.add(u); pf.run++;
    fetch(u, {mode:"cors", credentials:"omit", priority:"low"}).catch(()=>{}).finally(() => { pf.run--; (window.requestIdleCallback || setTimeout)(pfPump); }); }
}
const saveData = () => !!navigator.connection?.saveData;
function onWifi(){
  const c = navigator.connection;
  if(c?.saveData) return false;
  if(c?.type) return c.type === "wifi" || c.type === "ethernet";
  // navegador sem essa informação (Safari, Chrome de computador): só em computador, nunca no celular
  return !matchMedia("(pointer: coarse)").matches && innerWidth > 860;
}
function preloadGlobe(){
  try{ const t = +localStorage.getItem("globe-pre") || 0; if(Date.now() - t < 30*864e5) return; }catch(e){}
  if(!onWifi()) return;
  for(let z=0; z<=5; z++){ const n = 2**z; for(let y=0; y<n; y++) for(let x=0; x<n; x++) pf.q.push(tileUrl2("World_Imagery", z, x, y)); }
  pfPump();
  const done = setInterval(() => { if(!pf.q.length && !pf.run){ clearInterval(done); try{ localStorage.setItem("globe-pre", String(Date.now())); }catch(e){} } }, 5000);
}
// tiles da tela no zoom z e um anel de "pad" tiles em volta (o que aparece ao arrastar o mapa), do centro para fora
function tileRing(m, z, pad, max){
  const b = m.getBounds(), n = 2**z, tx = lo => Math.floor((lo+180)/360*n), ty = la => Math.floor((1 - Math.asinh(Math.tan(Math.max(-85, Math.min(85, la))*Math.PI/180))/Math.PI)/2*n);
  const x0 = tx(b.getWest()), x1 = tx(b.getEast()), y0 = ty(b.getNorth()), y1 = ty(b.getSouth()), cx = (x0+x1)/2, cy = (y0+y1)/2, out = [];
  if((x1 - x0 + 2*pad) * (y1 - y0 + 2*pad) > 1600) return out;
  for(let x=x0-pad; x<=x1+pad; x++) for(let y=y0-pad; y<=y1+pad; y++) if(y >= 0 && y < n) out.push([z, ((x % n) + n) % n, y, Math.hypot(x - cx, y - cy)]);
  return out.sort((a, b) => a[3] - b[3]).slice(0, max);
}
let omtTpl = null;
function prefetchAround(m){
  if(saveData() || !inSat() || P.pov || window.Sim?.active?.() || m.isMoving()) return;
  const look = document.body.classList.contains("nv-look"), zm = m.getZoom(), list = [];
  // imagem de fundo (Esri) — não no estilo Rota, que não mostra a foto
  const clear = isClear(), svc = look ? null : clear && P.base === "sat" ? "World_Imagery" : P.base !== "sat" ? ESRI_SVC[P.base] : null;
  if(svc){
    const ts = m.getSource(svc === "World_Imagery" ? "earth" : P.base === "map" ? "b-map" : "b-topo")?.tileSize || 256;
    const z = Math.min(19, Math.floor(zm + Math.log2(512/ts)));
    if(z >= 3){ for(const [zz, x, y] of tileRing(m, z, 1, 70)) list.push(tileUrl2(svc, zz, x, y));
      if(z < 19) for(const [zz, x, y] of tileRing(m, z + 1, 0, 24)) list.push(tileUrl2(svc, zz, x, y)); }
  }
  // ruas, nomes e estilo Rota (OpenFreeMap, guardados pelo service worker) e relevo bruto
  omtTpl = omtTpl || fetch("https://tiles.openfreemap.org/planet").then(r => r.json()).then(j => j.tiles[0]).catch(() => null);
  omtTpl.then(tpl => {
    const more = [];
    if(tpl && zm >= 4) for(const [z, x, y] of tileRing(m, Math.min(14, Math.floor(zm)), 1, 60)) more.push(tpl.replace("{z}", z).replace("{x}", x).replace("{y}", y));
    if(m.getTerrain() && zm >= 5) for(const [z, x, y] of tileRing(m, Math.min(12, Math.floor(zm) + 1), 1, 30)) more.push(P.mt ? MT_SRC.replace("{z}", z-1).replace("{x}", x >> 1).replace("{y}", y >> 1) : TERRARIUM_SRC.replace("{z}", z).replace("{x}", x).replace("{y}", y));
    pf.q = list.concat(more, pf.q.filter(u => /\/tile\/[0-5]\//.test(u))); pfPump();
  });
  // prédios 3D (Overture, z12–14): o anel em volta fica na memória, pronto para quando o mapa andar
  const ovb = m.getSource("ovb");
  if(P.bld && zm >= 11.5 && ovb?.url){ const base = ovb.url.replace(/\/$/, ""); let k = 0;
    for(const [z, x, y] of tileRing(m, Math.min(14, Math.max(12, Math.floor(zm))), 1, 48)){
      const u = `${base}/${z}/${x}/${y}`; if(PMC.has(u)) continue;
      setTimeout(() => { if(!m.isMoving()) pmPre(u); }, 120 * k++); } }
}
/* ---------- escala global (GHSL GHS-BUILT-H 2018, CC BY 4.0) ----------
   Imagens z11 em /data/ghsl/11/x/y.png (cinza = altura média dos prédios em metros, 0 = sem prédio), geradas por
   tools/ghsl_tiles.py. Ao parar o mapa (zoom ≥ 12, o mesmo de São Paulo), cada prédio do Overture SEM altura recebe a altura média do
   quadrado (~90 m) onde está, via feature-state. Dado real, quando existe, sempre prevalece. */
const GH = {tiles:new Map(), done:new Set(), feats:new Map(), busy:false};
// camada própria com os prédios na altura do bairro (mesmo visual/texturas dos outros); a versão baixa original
// fica escondida dentro do volume mais alto
function ghLayer(m){
  const data = {type:"FeatureCollection", features:[...GH.feats.values()]};
  if(!m.getSource("ghb")){
    m.addSource("ghb", {type:"geojson", data, maxzoom:14, buffer:64, attribution:"Altura média: GHSL GHS-BUILT-H 2018 (CE/JRC, CC BY 4.0)"});
    const before = m.getLayer("cristo") ? "cristo" : undefined;
    for(const L of bldLayers("ghb", null, ["!=",["get","part"],true], "ghb")){ if(!m.getLayer(L.id)){ m.addLayer(L, before); BLD_ALL.push(L.id); } }
    applyMode();
  } else m.getSource("ghb").setData(data);
}
function ghTile(x, y){
  const k = `${x}/${y}`; if(GH.tiles.has(k)) return GH.tiles.get(k);
  const p = fetch(`/data/ghsl/11/${k}.png`).then(r => r.ok ? r.blob() : null).then(b => b ? createImageBitmap(b) : null).then(bmp => {
    if(!bmp) return null; const cv = new OffscreenCanvas(256, 256), g = cv.getContext("2d", {willReadFrequently:true}); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, 256, 256).data, a = new Uint8Array(65536); for(let i=0;i<65536;i++) a[i] = d[i*4]; return a; }).catch(() => null);
  GH.tiles.set(k, p); if(GH.tiles.size > 400) GH.tiles.delete(GH.tiles.keys().next().value);
  return p;
}
async function ghApply(){
  const m = P.map; if(!m || GH.busy || m.getZoom() < 12 || !P.bld || !inSat()) return; GH.busy = true;
  try{
    const N = 2048, todo = [];
    for(const sl of ["building","building_part"]) for(const f of m.querySourceFeatures("ovb", {sourceLayer:sl})){
      const p = f.properties, id = f.id; if(id == null || p.height != null || p.num_floors != null || GH.done.has(id)) continue;
      const g = f.geometry, c = g.type === "Polygon" ? g.coordinates[0][0] : g.type === "MultiPolygon" ? g.coordinates[0][0][0] : null; if(!c) continue;
      const fx = (c[0] + 180)/360*N, fy = (1 - Math.asinh(Math.tan(c[1]*Math.PI/180))/Math.PI)/2*N;
      todo.push([id, sl, Math.floor(fx), Math.floor(fy), Math.floor((fx % 1)*256), Math.floor((fy % 1)*256), g]); }
    const byTile = new Map(); for(const t of todo){ const k = `${t[2]}/${t[3]}`; if(!byTile.has(k)) byTile.set(k, []); byTile.get(k).push(t); }
    for(const [k, list] of byTile){ const [x, y] = k.split("/").map(Number), a = await ghTile(x, y);
      for(const [id, sl, , , px, py, geom] of list){ GH.done.add(id); const h = a ? a[py*256 + px] : 0;
        if(h >= 4) GH.feats.set(id, {type:"Feature", properties:{height:h, part:sl === "building_part"}, geometry:geom}); } }
    // mantém só o que está perto da tela (memória e desenho leves)
    if(GH.feats.size > 60000){ const b = m.getBounds(), pad = .02;
      for(const [id, f] of GH.feats){ const c = f.geometry.type === "Polygon" ? f.geometry.coordinates[0][0] : f.geometry.coordinates[0][0][0];
        if(c[0] < b.getWest()-pad || c[0] > b.getEast()+pad || c[1] < b.getSouth()-pad || c[1] > b.getNorth()+pad){ GH.feats.delete(id); GH.done.delete(id); } } }
    ghLayer(m);
  } finally { GH.busy = false; }
}
const hxDone = new Set(), hxIds = new Set(), hxOrig = {};
async function heightsFor(m){
  if(m.getZoom() < 10.5) return;
  const b = m.getBounds();
  for(const [city, bb] of Object.entries(HEIGHT_CITIES)){
    if(hxDone.has(city) || bb[0] > b.getEast() || bb[2] < b.getWest() || bb[1] > b.getNorth() || bb[3] < b.getSouth()) continue;
    hxDone.add(city);
    let j; try{ const r = await fetch(`data-heights/${city}.geojson`); if(!r.ok) continue; j = await r.json(); }catch(e){ hxDone.delete(city); continue; }
    // áreas vizinhas se sobrepõem (ex.: Niterói e Icaraí): o mesmo prédio entra uma vez só
    j.features = j.features.filter(f => !hxIds.has(f.properties.id));
    const src = "hx-" + city;
    // maxzoom 14: os polígonos são fatiados só até o z14 (acima disso o mapa amplia o z14) — fatiar até o z18 custava segundos por cidade
    if(!m.getSource(src)) m.addSource(src, {type:"geojson", data:j, maxzoom:14, buffer:64, attribution:"Alturas: Google Open Buildings 2.5D (CC BY 4.0)"});
    const before = m.getLayer("cristo") ? "cristo" : undefined;
    for(const L of bldLayers(src, null, ["!=",["get","part"],true], src)){ L.id = L.id.replace(src, src); if(!m.getLayer(L.id)){ m.addLayer(L, before); BLD_ALL.push(L.id); } }
    for(const f of j.features) hxIds.add(f.properties.id);
    // os mesmos prédios no Overture ficariam com 6 m por baixo das torres: some com eles
    for(const id of ["bld","bld-parts"]){ if(!m.getLayer(id)) continue; hxOrig[id] = hxOrig[id] || m.getFilter(id);
      m.setFilter(id, ["all", hxOrig[id], ["!",["in",["get","id"],["literal",[...hxIds]]]]]); }
    applyMode();
  }
}
// texturas de fachada desenhadas em canvas (sob demanda, quando o mapa pede a imagem)
function facadeTex(id){
  // id = "tx-<material>-<zoom>": andar de 3,3 m e vão de 3,1 m convertidos para pixels daquele zoom (latitude média ~38°)
  const [, kind, zs] = id.match(/^tx-(\w+)-(\d+)$/) || [, "conc", "18"], z = +zs, mpp = 156543.03*.79/2**z;
  const F = Math.max(3, Math.round(2*3.3/mpp)), B = Math.max(3, Math.round(2*3.1/mpp));   // em pixels da imagem (pixelRatio 2)
  const nx = Math.max(1, Math.ceil(48/B)), ny = Math.max(1, Math.ceil(48/F)), W = B*nx, H = F*ny;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
  const fill = (c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const wall = /^f\d+$/.test(kind) ? FACADE[+kind.slice(1)] || FACADE[0] : {conc:"#DCD5C9", conc2:"#B7BDC6", brick:"#A1563F", metal:"#9AA3AD", glass:"#6F8AA3"}[kind] || "#DCD5C9";
  fill(wall, 0, 0, W, H);
  for(let j=0;j<ny;j++) for(let i=0;i<nx;i++){
    const x = i*B, y = j*F, shade = ((i*7 + j*13) % 5) * 4;   // leve variação entre janelas (reflexo/cortina)
    if(kind === "glass"){ fill(`rgb(${92+shade},${120+shade},${146+shade})`, x, y, B, F); fill("rgba(25,38,52,.6)", x, y, Math.max(1, B*.08), F); fill("rgba(25,38,52,.5)", x, y + F*.82, B, Math.max(1, F*.18)); }
    else if(kind === "metal"){ fill("rgba(40,48,58,.75)", x, y + F*.3, B, F*.4); fill("rgba(255,255,255,.2)", x, y, B, Math.max(1, F*.06)); }
    else { const ww = kind === "conc2" ? .78 : kind === "brick" ? .42 : .5, wh = kind === "brick" ? .55 : .48;
      const wx = x + B*(1-ww)/2, wy = y + F*.22, gw = Math.max(1, B*ww), gh = Math.max(1, F*wh);
      if(F >= 6 && kind !== "conc2") fill("rgba(255,255,255,.35)", wx - 1, wy - 1, gw + 2, gh + 2);   // moldura (só de perto)
      fill(`rgb(${60+shade},${72+shade},${86+shade})`, wx, wy, gw, gh);
      fill("rgba(0,0,0,.10)", x, y + F - Math.max(1, F*.08), B, Math.max(1, F*.08)); }   // linha da laje
  }
  if(kind === "brick" && F >= 8){ g.fillStyle = "rgba(60,25,15,.18)"; for(let y=0; y<H; y+=3) g.fillRect(0, y, W, 1); }
  return g.getImageData(0, 0, W, H);
}
/* ---------- mapa: globo 3D (MapLibre GL, WebGL) ---------- */
const lib = () => window.maplibregl;
function init(){
  if(P.map || !lib()) return;
  document.body.classList.toggle("sat-bg", P.bg);
  const loc = C.S.loc || {lat:-27.6, lon:-48.5};
  // curvas de nível geradas no navegador a partir do mesmo DEM (maplibre-contour, open source)
  let contourTiles = null;
  if(window.mlcontour){
    P.demSrc = new mlcontour.DemSource({url:TERRARIUM_SRC /* o worker das curvas não enxerga o protocolo dem0 */, encoding:"terrarium", maxzoom:13, worker:true});
    P.demSrc.setupMaplibre(maplibregl);
    contourTiles = [P.demSrc.contourProtocolUrl({multiplier:1, overzoom:1, elevationKey:"ele", levelKey:"level", contourLayer:"contours",
      thresholds:{8:[200,1000], 9:[100,500], 10:[50,250], 11:[50,250], 12:[20,100], 13:[10,50], 14:[5,25], 15:[5,25]}})];
  }
  // sem WebGL (aparelho antigo ou aceleração desligada) o MapLibre lança erro: o resto do sistema segue
  try{
  P.map = new maplibregl.Map({
    pixelRatio: Math.min(devicePixelRatio || 1, 2), fadeDuration: 150, maxTileCacheSize: 400,
    container: $("satbg"), attributionControl:false, interactive:true, maxZoom:10, minZoom:0.6,
    center:[loc.lon, loc.lat], zoom:zoomFor(), renderWorldCopies:false, fadeDuration:150,
    // não cancelar downloads ao mudar o zoom: no POV o zoom muda a cada quadro e nada chegaria
    cancelPendingTileRequestsWhileZooming:false, maxTileCacheSize:1500, refreshExpiredTiles:false, pixelRatio:1, maxPitch:80,
    style:{
      version:8, projection:{type: store.get("sat-proj","globe")==="2d" ? "mercator" : "globe"}, glyphs:"https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
      sky:{"sky-color":"#0B1B3A","horizon-color":"#7FB2F0","fog-color":"#0B1B3A","sky-horizon-blend":.6,"horizon-fog-blend":.5,"fog-ground-blend":.6,
           "atmosphere-blend":["interpolate",["linear"],["zoom"],0,1,5,1,7,0]},
      sources:{
        bm:{type:"raster", tileSize:256, maxzoom:8, attribution:"NASA GIBS · Blue Marble", tiles:[`${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`]},
        viirs:{type:"raster", tileSize:256, maxzoom:9, attribution:"NOAA-20 VIIRS via NASA GIBS", tiles:[`${GIBS}/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${yday()}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`]},
        // tela retina (2× pixels): tiles de 128 px lógicos → o mapa pede um zoom acima e cada pixel da foto cai num pixel da tela
        earth:{type:"raster", tileSize:256, maxzoom:19, attribution:"Imagens © Esri, Maxar, Earthstar Geographics", tiles:["esri0://{z}/{y}/{x}"]},
        "b-map":{type:"raster", tileSize:256, maxzoom:19, attribution:"Mapa © Esri, HERE, Garmin, OpenStreetMap", tiles:["https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"]},
        "b-topo":{type:"raster", tileSize:256, maxzoom:19, attribution:"Relevo © Esri, USGS, OpenStreetMap", tiles:["https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"]},
        "o-rail":{type:"raster", tileSize:256, maxzoom:18, attribution:"Transporte © OpenRailwayMap (CC-BY-SA)", tiles:["https://a.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png","https://b.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png"]},
        "o-bike":{type:"raster", tileSize:256, maxzoom:18, attribution:"Ciclovias © CyclOSM / OpenStreetMap", tiles:["https://a.tile-cyclosm.openstreetmap.fr/cyclosm-lite/{z}/{x}/{y}.png","https://b.tile-cyclosm.openstreetmap.fr/cyclosm-lite/{z}/{x}/{y}.png"]},
        dem:{type:"raster-dem", tileSize:256, maxzoom:12, encoding:"terrarium", attribution:"Relevo: AWS Terrain Tiles (Mapzen)", tiles:[P.mt ? TERRARIUM_MT : TERRARIUM]},
        dem2:{type:"raster-dem", tileSize:256, maxzoom:13, encoding:"terrarium", tiles:[P.mt ? TERRARIUM_MT : TERRARIUM]},
        ...(contourTiles ? {contours:{type:"vector", tiles:contourTiles, maxzoom:15}} : {}),
        omt:{type:"vector", url:"https://tiles.openfreemap.org/planet", attribution:"Nomes © OpenStreetMap · OpenFreeMap"},
        cristo:{type:"geojson", data:cristoGeo()},
        ovb:{type:"vector", promoteId:"id", url:`pmtiles://https://tiles.overturemaps.org/${OVERTURE_FALLBACK}/buildings.pmtiles`, minzoom:12, maxzoom:14, attribution:"Prédios © Overture Maps (OSM, Microsoft, Google, Esri)"},
        labels:{type:"raster", tileSize:256, maxzoom:12, attribution:"Rótulos © Esri", tiles:["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"]},
        star:{type:"geojson", maxzoom:7, buffer:0, data:{type:"FeatureCollection", features:[]}},
        measure:{type:"geojson", data:{type:"FeatureCollection", features:[]}},
        landmarks:{type:"geojson", data:"data-landmarks.json"},
        planes:{type:"geojson", data:{type:"FeatureCollection", features:[]}},
        route:{type:"geojson", data:{type:"FeatureCollection", features:[]}},
        region:{type:"geojson", data:{type:"FeatureCollection", features:[]}}
      },
      layers:[
        {id:"bg", type:"background", paint:{"background-color":"#0E2240"}},
        {id:"bm", type:"raster", source:"bm"},
        {id:"viirs", type:"raster", source:"viirs", paint:{"raster-opacity":.95, "raster-fade-duration":200}},
        {id:"earth", type:"raster", source:"earth", layout:{visibility:"none"}, paint:{"raster-fade-duration":300}},
        {id:"base-map", type:"raster", source:"b-map", layout:{visibility:"none"}, paint:{"raster-fade-duration":200}},
        {id:"base-topo", type:"raster", source:"b-topo", layout:{visibility:"none"}, paint:{"raster-fade-duration":200}},
        {id:"ov-rail", type:"raster", source:"o-rail", layout:{visibility:"none"}, paint:{"raster-opacity":.95}},
        {id:"ov-bike", type:"raster", source:"o-bike", layout:{visibility:"none"}, paint:{"raster-opacity":.95}},
        {id:"relief", type:"color-relief", source:"dem2", layout:{visibility:"none"}, paint:{"color-relief-opacity":.62, "color-relief-color":["interpolate",["linear"],["elevation"],
          -1,"rgba(0,0,0,0)", 0,"#1B7F4B", 100,"#3FA34D", 300,"#9BC53D", 600,"#E3D26F", 900,"#F2A541", 1300,"#D9622B", 1800,"#A63D2B", 2600,"#8C6E63", 3500,"#E8E6E3", 5000,"#FFFFFF"]}},
        {id:"hill", type:"hillshade", source:"dem2", layout:{visibility:"none"}, paint:{"hillshade-exaggeration":.55, "hillshade-shadow-color":"rgba(0,0,0,.55)", "hillshade-highlight-color":"rgba(255,255,255,.35)"}},
        {id:"labels", type:"raster", source:"labels", paint:{"raster-opacity":.9}},
        ...(contourTiles ? [
          {id:"contour-line", type:"line", source:"contours", "source-layer":"contours", minzoom:8, filter:[">",["get","ele"],0], layout:{visibility:"none"},
            paint:{"line-color":["case",[">",["get","level"],0],"rgba(255,255,255,.85)","rgba(255,255,255,.42)"], "line-width":["case",[">",["get","level"],0],1.3,.6]}},
          {id:"contour-label", type:"symbol", source:"contours", "source-layer":"contours", minzoom:9, filter:[">",["get","level"],0], layout:{visibility:"none",
            "symbol-placement":"line", "text-field":["concat",["number-format",["get","ele"],{}]," m"], "text-font":["Noto Sans Regular"], "text-size":11, "text-padding":8},
            paint:{"text-color":"#fff", "text-halo-color":"rgba(0,0,0,.75)", "text-halo-width":1.4}}] : []),
        // nomes e ruas vetoriais (OpenStreetMap via OpenFreeMap): nítidos e sempre de frente para a câmera,
        // ao contrário dos rótulos em imagem, que ficam borrados quando "colados" no relevo 3D
        {id:"n-road", type:"line", source:"omt", "source-layer":"transportation", minzoom:9, layout:{visibility:"none", "line-join":"round", "line-cap":"round"},
          filter:["in",["get","class"],["literal",["motorway","trunk","primary","secondary","tertiary","minor","service"]]],
          paint:{"line-color":["match",["get","class"],["motorway","trunk"],"rgba(255,206,84,.8)","primary","rgba(255,236,170,.7)","rgba(255,255,255,.5)"],
            "line-width":["interpolate",["exponential",1.6],["zoom"],9,.4,13,1.1,16,3,18,7]}},
        {id:"n-bnd", type:"line", source:"omt", "source-layer":"boundary", layout:{visibility:"none"}, filter:["all",["<=",["coalesce",["get","admin_level"],99],4],["!=",["coalesce",["get","maritime"],0],1]],
          paint:{"line-color":"rgba(255,255,255,.65)", "line-width":["match",["get","admin_level"],2,1.4,.8], "line-dasharray":[3,2]}},
        {id:"bld-ao", type:"line", source:"ovb", "source-layer":"building", minzoom:14.5, filter:["!=",["get","is_underground"],true], layout:{visibility:"none", "line-join":"round"},
          paint:{"line-color":"#0B0F14", "line-opacity":["interpolate",["linear"],["zoom"],14.5,0,16,.32], "line-width":["interpolate",["exponential",2],["zoom"],15,2.5,18,14,20,48],
            "line-blur":["interpolate",["exponential",2],["zoom"],15,2.5,18,14,20,48]}},
        ...bldLayers("bld", "building", ["all",["!=",["get","is_underground"],true],["!=",["get","has_parts"],true]]),
        // camada "Altura das construções": mesma geometria, cor por altura (verde baixo → vermelho arranha-céu)
        // 3D detalhado: partes de prédio (Overture building_part) com altura e base próprias
        ...bldLayers("bld-parts", "building_part", ["!=",["get","is_underground"],true]),
        {id:"cristo", type:"fill-extrusion", source:"cristo", minzoom:13, layout:{visibility:"none"},
          paint:{"fill-extrusion-height":["get","h"], "fill-extrusion-base":["get","base"], "fill-extrusion-color":"#ECE8DF", "fill-extrusion-opacity":1}},
        {id:"bld-parts-h", type:"fill-extrusion", source:"ovb", "source-layer":"building_part", minzoom:14, filter:["!=",["get","is_underground"],true], layout:{visibility:"none"},
          paint:{"fill-extrusion-height":["coalesce",["get","height"],["*",["get","num_floors"],3.2],6], "fill-extrusion-base":["coalesce",["get","min_height"],0], "fill-extrusion-opacity":.95,
            "fill-extrusion-color":["interpolate",["linear"],["coalesce",["get","height"],["*",["get","num_floors"],3.2],6], 0,"#3EC46D", 15,"#9BD94F", 40,"#F5D33B", 80,"#F59A2F", 150,"#E4422F", 250,"#A52A8C"]}},
        // altura medida/andares: cor por altura; sem dado de altura: cinza (altura padrão de 6 m)
        {id:"bld-h", type:"fill-extrusion", source:"ovb", "source-layer":"building", minzoom:14, filter:["all",["!=",["get","is_underground"],true],["!=",["get","has_parts"],true]], layout:{visibility:"none"},
          paint:{"fill-extrusion-height":["coalesce",["get","height"],["*",["get","num_floors"],3.2],6], "fill-extrusion-base":["coalesce",["get","min_height"],0], "fill-extrusion-opacity":.95,
            "fill-extrusion-color":["case",["any",["has","height"],["has","num_floors"]],["interpolate",["linear"],["coalesce",["get","height"],["*",["get","num_floors"],3.2],6], 0,"#3EC46D", 15,"#9BD94F", 40,"#F5D33B", 80,"#F59A2F", 150,"#E4422F", 250,"#A52A8C"],"#8E8E93"]}},
        {id:"bld-h-lbl", type:"symbol", source:"ovb", "source-layer":"building", minzoom:15.5, filter:[">=",["coalesce",["get","height"],["*",["get","num_floors"],3.2],6],30], layout:{visibility:"none",
          "text-field":["concat",["to-string",["round",["coalesce",["get","height"],["*",["get","num_floors"],3.2],6]]]," m"], "text-font":["Noto Sans Bold"], "text-size":11, "symbol-placement":"point"},
          paint:{"text-color":"#fff", "text-halo-color":"rgba(0,0,0,.85)", "text-halo-width":1.4}},
        {id:"landmarks", type:"symbol", source:"landmarks", minzoom:9, layout:{visibility:"none", "symbol-sort-key":["-",0,["get","h"]],
          "text-field":["concat","▲ ",["get","name"],"\n",["to-string",["get","h"]]," m",["case",["has","floors"],["concat"," · ",["to-string",["get","floors"]]," andares"],""]],
          "text-font":["Noto Sans Bold"], "text-size":12, "text-anchor":"bottom", "text-offset":[0,-.6], "text-allow-overlap":false},
          paint:{"text-color":"#FFD60A", "text-halo-color":"rgba(0,0,0,.9)", "text-halo-width":1.6}},
        // região demarcada ao clicar num nome
        {id:"region-fill", type:"fill", source:"region", filter:["!=",["get","role"],"parent"], paint:{"fill-color":"#0A84FF", "fill-opacity":.16}},
        {id:"region-glow", type:"line", source:"region", filter:["!=",["get","role"],"parent"], paint:{"line-color":"#4FC3FF", "line-width":9, "line-blur":6, "line-opacity":.55}},
        {id:"region-line", type:"line", source:"region", paint:{"line-color":["case",["==",["get","role"],"parent"],"rgba(255,255,255,.75)","#7FD6FF"],
          "line-width":["case",["==",["get","role"],"parent"],1.6,2.6], "line-dasharray":["case",["==",["get","role"],"parent"],["literal",[3,2]],["literal",[1,0]]]}},
        {id:"n-house", type:"symbol", source:"omt", "source-layer":"housenumber", minzoom:17, layout:{visibility:"none", "text-field":["get","housenumber"], "text-font":["Noto Sans Regular"], "text-size":10.5},
          paint:{"text-color":"rgba(255,255,255,.9)", "text-halo-color":"rgba(0,0,0,.8)", "text-halo-width":1.2}},
        {id:"n-roadname", type:"symbol", source:"omt", "source-layer":"transportation_name", minzoom:13, layout:{visibility:"none", "symbol-placement":"line", "text-field":["coalesce",["get","name:pt"],["get","name_int"],["get","name"]],
          "text-font":["Noto Sans Regular"], "text-size":["interpolate",["linear"],["zoom"],13,10,17,13.5], "text-max-angle":30, "text-padding":2},
          paint:{"text-color":"#fff", "text-halo-color":"rgba(0,0,0,.85)", "text-halo-width":1.5}},
        {id:"n-poi", type:"symbol", source:"omt", "source-layer":"poi", minzoom:15, filter:["<=",["coalesce",["get","rank"],99],25], layout:{visibility:"none", "text-field":["coalesce",["get","name:pt"],["get","name_int"],["get","name"]], "text-font":["Noto Sans Regular"], "text-size":11, "text-max-width":8, "text-padding":3},
          paint:{"text-color":"#FFDDB0", "text-halo-color":"rgba(0,0,0,.85)", "text-halo-width":1.4}},
        {id:"n-water", type:"symbol", source:"omt", "source-layer":"water_name", filter:["==",["geometry-type"],"Point"], layout:{visibility:"none", "text-field":["coalesce",["get","name:pt"],["get","name_int"],["get","name"]], "text-font":["Noto Sans Italic"], "text-size":12.5, "text-max-width":8},
          paint:{"text-color":"#A9DCFF", "text-halo-color":"rgba(0,20,40,.85)", "text-halo-width":1.4}},
        {id:"n-river", type:"symbol", source:"omt", "source-layer":"waterway", minzoom:11, filter:["has","name"], layout:{visibility:"none", "symbol-placement":"line", "text-field":["coalesce",["get","name:pt"],["get","name_int"],["get","name"]], "text-font":["Noto Sans Italic"], "text-size":11.5},
          paint:{"text-color":"#A9DCFF", "text-halo-color":"rgba(0,20,40,.85)", "text-halo-width":1.4}},
        {id:"n-peak", type:"symbol", source:"omt", "source-layer":"mountain_peak", minzoom:9, layout:{visibility:"none",
          "text-field":["case",["has","ele"],["concat","▲ ",["coalesce",["coalesce",["get","name:pt"],["get","name_int"],["get","name"]],""],"\n",["to-string",["get","ele"]]," m"],["concat","▲ ",["coalesce",["get","name:pt"],["get","name_int"],["get","name"]]]], "text-font":["Noto Sans Regular"], "text-size":11, "text-max-width":10},
          paint:{"text-color":"#FFE7A8", "text-halo-color":"rgba(0,0,0,.85)", "text-halo-width":1.4}},
        {id:"n-air", type:"symbol", source:"omt", "source-layer":"aerodrome_label", minzoom:9, layout:{visibility:"none", "text-field":["concat","✈ ",["coalesce",["get","name:pt"],["get","name_int"],["get","name"]]], "text-font":["Noto Sans Regular"], "text-size":11.5},
          paint:{"text-color":"#fff", "text-halo-color":"rgba(0,0,0,.85)", "text-halo-width":1.4}},
        {id:"n-place", type:"symbol", source:"omt", "source-layer":"place", layout:{visibility:"none", "text-field":["coalesce",["get","name:pt"],["get","name_int"],["get","name"]],
          "text-font":["match",["get","class"],["country","state","city"],["literal",["Noto Sans Bold"]],["literal",["Noto Sans Regular"]]],
          "text-size":["match",["get","class"],"country",15,"state",12.5,"city",16,"town",14,"village",12.5,"suburb",12.5,"neighbourhood",11.5,11],
          "text-transform":["match",["get","class"],["state","suburb"],"uppercase","none"], "text-letter-spacing":["match",["get","class"],["state","suburb"],.08,0],
          "text-max-width":8, "text-padding":4},
          paint:{"text-color":["match",["get","class"],["country","state"],"rgba(255,255,255,.85)","#fff"], "text-halo-color":"rgba(0,0,0,.85)", "text-halo-width":1.7}},
        {id:"measure-line", type:"line", source:"measure", filter:["==",["geometry-type"],"LineString"], paint:{"line-color":"#FFD60A", "line-width":3, "line-dasharray":[2,1]}},
        {id:"measure-pt", type:"circle", source:"measure", filter:["==",["geometry-type"],"Point"], paint:{"circle-radius":5, "circle-color":"#FFD60A", "circle-stroke-color":"#000", "circle-stroke-width":1.5}},
        // aeronaves (ADS-B): ícone girado pelo rumo, cor pela altitude, prefixo e nível de voo
        {id:"trail-line", type:"line", source:"route", filter:["==",["get","part"],"trail"], layout:{"line-cap":"round","line-join":"round"},
          paint:{"line-color":"#5FD3FF", "line-width":3, "line-opacity":.9}},
        {id:"route-before", type:"line", source:"route", filter:["==",["get","part"],"antes"], layout:{"line-cap":"round"},
          paint:{"line-color":"rgba(220,228,240,.75)", "line-width":2, "line-dasharray":[0.2,2.2]}},
        {id:"route-line", type:"line", source:"route", filter:["all",["!=",["get","part"],"trail"],["!=",["get","part"],"antes"]], paint:{"line-color":"#FFD60A", "line-width":2.2, "line-dasharray":["case",["==",["get","part"],"todo"],["literal",[2,2]],["literal",[1,0]]], "line-opacity":.9}},
        {id:"route-pt", type:"circle", source:"route", filter:["==",["geometry-type"],"Point"], paint:{"circle-radius":5, "circle-color":"#FFD60A", "circle-stroke-color":"#000", "circle-stroke-width":1.5}},
        {id:"route-lbl", type:"symbol", source:"route", filter:["==",["geometry-type"],"Point"], layout:{"text-field":["get","label"], "text-font":["Noto Sans Bold"], "text-size":12, "text-offset":[0,1.2], "text-anchor":"top"},
          paint:{"text-color":"#FFD60A", "text-halo-color":"rgba(0,0,0,.85)", "text-halo-width":1.5}},
        {id:"planes", type:"symbol", source:"planes", layout:{visibility:"none", "icon-image":"plane", "icon-rotate":["get","track"], "icon-rotation-alignment":"map", "icon-allow-overlap":true, "icon-ignore-placement":true,
          "icon-size":["interpolate",["linear"],["zoom"],2,.45,6,.7,10,1],
          "text-field":["step",["zoom"],["case",["get","sel"],["concat",["get","cs"],"\n",["get","eta"]],""],6,["case",["get","sel"],["concat",["get","cs"],"\n",["get","eta"]],["concat",["get","cs"],"\n",["get","fl"]]]], "text-font":["Noto Sans Bold"], "text-size":["case",["get","sel"],13,10.5],
          "text-offset":["case",["get","sel"],["literal",[1.6,0]],["literal",[0,1.6]]], "text-anchor":["case",["get","sel"],"left","top"], "text-justify":"left", "text-optional":true},
          paint:{"icon-color":["case",["get","gnd"],"#9AA3AE",["interpolate",["linear"],["get","alt"],0,"#3EE08F",10000,"#E8E24A",25000,"#FFA53D",35000,"#5FD3FF"]],
            "icon-halo-color":"rgba(0,0,0,.75)", "icon-halo-width":1.2, "text-color":["case",["get","sel"],"#FFD60A","#fff"], "text-halo-color":"rgba(0,0,0,.85)", "text-halo-width":1.5}},
        {id:"star-glow", type:"circle", source:"star", paint:{"circle-radius":["interpolate",["linear"],["zoom"],1,["case",["get","up"],5,2.6],6,["case",["get","up"],9,4.5]],
          "circle-color":["case",["get","up"],"rgba(255,170,60,.35)","rgba(120,200,255,.22)"],"circle-blur":1}},
        {id:"star", type:"circle", source:"star", paint:{"circle-radius":["interpolate",["linear"],["zoom"],1,["case",["get","up"],1.8,.8],6,["case",["get","up"],3.2,1.6]],
          "circle-color":["case",["get","up"],"#FFBE5A","#BFE6FF"],"circle-opacity":.95}}
      ]
    }
  });
  }catch(err){ P.map = null; P.noGL = true; document.body.classList.remove("sat-bg"); document.documentElement.classList.add("no-gl"); return; }
  P.map.addControl(new maplibregl.AttributionControl({compact:true}), "bottom-right");
  // compacto de verdade: o MapLibre abre o crédito em telas largas na primeira carga
  P.map.on("load", ()=>document.querySelectorAll(".satbg .maplibregl-ctrl-attrib").forEach(e=>{ e.classList.add("maplibregl-compact"); e.classList.remove("maplibregl-compact-show"); e.removeAttribute("open"); }));
  // o crédito compacto abre sozinho na 1ª carga; começa recolhido no "ⓘ" (as fontes também estão no rodapé)
  P.map.once("idle", ()=>document.querySelectorAll(".satbg .maplibregl-compact-show").forEach(e=>e.classList.remove("maplibregl-compact-show")));
  P.map.on("mousemove", hover);
  P.map.on("zoomend", terrainFit);
  overtureRelease().then(v=>{ OV_REL = v; if(v !== OVERTURE_FALLBACK){ const s = P.map.getSource("ovb"); if(s && s.setUrl) s.setUrl(`pmtiles://https://tiles.overturemaps.org/${v}/buildings.pmtiles`); } });
  // ícone do avião (SDF: a cor vem da camada)
  { const s = 64, cv = document.createElement("canvas"); cv.width = cv.height = s; const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.translate(s/2, s/2);
    g.beginPath(); g.moveTo(0,-28); g.lineTo(4,-18); g.lineTo(4,-6); g.lineTo(26,6); g.lineTo(26,11); g.lineTo(4,4); g.lineTo(3,18); g.lineTo(10,24); g.lineTo(10,28);
    g.lineTo(0,25); g.lineTo(-10,28); g.lineTo(-10,24); g.lineTo(-3,18); g.lineTo(-4,4); g.lineTo(-26,11); g.lineTo(-26,6); g.lineTo(-4,-6); g.lineTo(-4,-18); g.closePath(); g.fill();
    P.map.on("styleimagemissing", e=>{ if(/^tx-/.test(e.id) && !P.map.hasImage(e.id)) P.map.addImage(e.id, facadeTex(e.id), {pixelRatio:2}); });
    P.map.on("styleimagemissing", e=>{ if(e.id==="plane" && !P.map.hasImage("plane")) P.map.addImage("plane", g.getImageData(0,0,s,s), {sdf:true, pixelRatio:2}); });
    P.map.once("style.load", ()=>{ if(!P.map.hasImage("plane")) P.map.addImage("plane", g.getImageData(0,0,s,s), {sdf:true, pixelRatio:2}); }); }
  // clique em área vazia do mapa (fora de aviões, nomes e marcadores) fecha a barra do avião selecionado
  P.map.on("click", e=>{
    if(!P.sel || P.follow || P.pov || P.measure) return;
    const hit = P.map.queryRenderedFeatures(e.point, {layers:["planes","landmarks"].filter(id=>P.map.getLayer(id))});
    if(!hit.length) clearRoute();
  });
  addEventListener("keydown", e=>{ if(e.key==="Escape" && P.sel && !P.pov && !document.querySelector("dialog[open]")) clearRoute(); });
  P.map.on("click", "landmarks", e=>{ const f = e.features && e.features[0]; if(f) landmarkCard(f); });
  P.map.on("mouseenter", "landmarks", ()=>{ P.map.getCanvas().style.cursor = "pointer"; });
  P.map.on("mouseleave", "landmarks", ()=>{ P.map.getCanvas().style.cursor = ""; });
  // indicador de carregamento no centro do mapa (estilo macOS, vidro líquido): aparece só se demorar > 450 ms
  (() => { const sp = document.createElement("div"); sp.className = "map-spin glass"; sp.setAttribute("role", "status"); sp.setAttribute("aria-label", "Carregando o mapa"); sp.hidden = true;
    sp.innerHTML = `<i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>`; document.body.appendChild(sp);
    let t = 0; const m = P.map;
    const hide = () => { clearTimeout(t); t = 0; sp.hidden = true; };
    // só o que se vê de verdade conta: foto, relevo, ruas e prédios (Starlink, aviões, camadas extras não seguram o indicador)
    const CORE = ["earth","dem","omt","ovb"], pronto = () => CORE.every(id => { const tm = m.style?.tileManagers?.[id] || m.style?.sourceCaches?.[id]; return !tm || !m.getSource(id) || tm.loaded(); });
    let chk = 0;
    m.on("dataloading", () => { if(t || !sp.hidden) return; t = setTimeout(() => { t = 0; if(inSat() && !pronto()){ sp.hidden = false; clearInterval(chk); chk = setInterval(() => { if(pronto()){ clearInterval(chk); hide(); } }, 150); } }, 450); });
    m.on("idle", () => { clearInterval(chk); hide(); }); addEventListener("hashchange", () => { if(!inSat()) hide(); }); })();
  P.map.on("moveend", ()=>heightsFor(P.map)); P.map.on("zoomend", ()=>heightsFor(P.map)); P.map.once("idle", ()=>heightsFor(P.map));
  { let ghT = 0; const go = ()=>{ clearTimeout(ghT); ghT = setTimeout(ghApply, 250); };
    P.map.on("idle", go); P.map.on("sourcedata", e => { if(e.sourceId === "ovb" && e.isSourceLoaded !== undefined && e.tile) go(); }); }
  // salto direto para um lugar alto (Teotihuacan 2.300 m, La Paz, Quito…): o relevo chega depois e o MapLibre não refaz a
  // altitude do centro — a câmera fica "dentro" da montanha e o mapa aparece vazio. Ao parar num lugar novo, um
  // reposicionamento no mesmo ponto recalcula a altitude (uma vez por lugar, sem mexer na vista).
  { let lastK = ""; P.map.on("idle", () => { const m = P.map;
    if(!m.getTerrain() || m.isMoving() || P.pov || window.Sim?.active?.() || window.Drive?.active?.() || window.Drone?.active?.()) return;
    const c = m.getCenter(), k = `${c.lng.toFixed(4)},${c.lat.toFixed(4)},${m.getZoom().toFixed(1)}`; if(k === lastK) return; lastK = k;
    try{ m.jumpTo({center:c}); }catch(e){} }); }
  { let pfT = 0; P.map.on("idle", ()=>{ clearTimeout(pfT); pfT = setTimeout(()=>prefetchAround(P.map), 700); });
    // ao mover o mapa, a pré-carga do entorno anterior é cancelada (o globo continua na fila)
    P.map.on("movestart", ()=>{ clearTimeout(pfT); pf.q = pf.q.filter(u => /\/tile\/[0-5]\//.test(u)); }); }
  P.map.once("idle", ()=>setTimeout(preloadGlobe, 4000));
  P.map.on("click", "planes", e=>{ if(P.measure) return; const f = e.features && e.features[0]; if(f) selectPlane(f.properties.hex); });
  P.map.on("mouseenter", "planes", ()=>{ P.map.getCanvas().style.cursor = "pointer"; });
  P.map.on("mouseleave", "planes", ()=>{ P.map.getCanvas().style.cursor = ""; });
  // nomes clicáveis: aproxima e demarca a região
  CLICKABLE.forEach(id=>{
    P.map.on("click", id, e=>{ if(P.measure || !inSat() || document.getElementById("dnPick") || document.body.classList.contains("drv")) return; const f = e.features && e.features[0]; if(f) regionGo(f, e.lngLat); });
    P.map.on("mouseenter", id, ()=>{ if(inSat() && !P.measure) P.map.getCanvas().style.cursor = "pointer"; });
    P.map.on("mouseleave", id, ()=>{ if(!P.measure) P.map.getCanvas().style.cursor = ""; });
  });
  // clique em área livre do mapa: marca o ponto (estilo apps de mapa). Não interfere com nomes, aviões, marcadores,
  // medição, camadas do tempo (que mostram o valor do ponto), direção, drone e navegação
  P.map.on("click", e=>{
    if(!inSat() || P.measure || P.pov || P.sel || window.Meteo?.isOn?.() || window.Drone?.active?.() || window.Drive?.active?.() || document.body.classList.contains("rt-nav")) return;
    // escolhendo o ponto de decolagem do drone ou uma rota: o clique é de quem está escolhendo
    if(document.getElementById("dnPick") || document.querySelector("#rtPanel:not([hidden]) input:focus")) return;
    const ids = [...CLICKABLE, "planes","landmarks","places","rodov","airports","cams","volc","temp","rt-alt","tt-inc-ico","cristo"].filter(id=>P.map.getLayer(id));
    if(P.map.queryRenderedFeatures([[e.point.x-6, e.point.y-6],[e.point.x+6, e.point.y+6]], {layers:ids}).length) return;
    dropPin(e.lngLat);
  });
  P.map.on("pitchend", sync3d); P.map.on("pitch", ()=>{ if(!P.syncT) P.syncT = setTimeout(()=>{ P.syncT = 0; sync3d(); }, 150); });
  P.map.on("mouseout", ()=>{ const t = $("altTip"); if(t) t.hidden = true; });
  setInteractive(false);
  // style.load: o estilo está pronto (não espera todos os tiles, como o "load")
  const onReady = ()=>{ if(P.ready) return; P.ready = true; refreshGoes(true); if(P.showRadar) setRadar(true); setLoc(C.S.loc || loc, true); pushStars(); };
  P.map.once("style.load", onReady); P.map.once("load", onReady);
  addEventListener("resize", ()=>{ P.map.resize(); dock(); });
  setInterval(refreshGoes, 5*60*1000);
  loadStars();
  tick();
}
const zoomFor = () => innerWidth < 700 ? 3.6 : 4.3;
const HANDLERS = ["dragPan","scrollZoom","boxZoom","dragRotate","keyboard","doubleClickZoom","touchZoomRotate"];
function setInteractive(on){
  const m = P.map; if(!m) return;
  HANDLERS.forEach(h=>m[h] && (on ? m[h].enable() : m[h].disable()));
  if(on && !P.nav){ P.nav = new maplibregl.NavigationControl({visualizePitch:true}); m.addControl(P.nav, "bottom-right"); }
  if(!on && P.nav){ m.removeControl(P.nav); P.nav = null; }
}
function setLoc(loc, quiet){
  P.loc = loc; init(); if(!P.map) return;
  P.map.jumpTo({center:[loc.lon, loc.lat], zoom: inSat() ? Math.max(P.map.getZoom(), 9) : 10, pitch:0, bearing:0});
  if(!P.hereEl){ P.hereEl = document.createElement("div"); P.hereEl.className = "here"; P.here = new maplibregl.Marker({element:P.hereEl}).setLngLat([loc.lon, loc.lat]).addTo(P.map); }
  P.hereEl.innerHTML = "<i></i>"; P.hereEl.title = loc.name;
  // o local da previsão é a sua posição: quem mostra é o ponto azul ao vivo (gps.js) — nunca dois pontos.
  // Outra cidade escolhida: marcador de pino, diferente do ponto azul
  P.hereEl.classList.toggle("here-pin", !loc.here); P.hereEl.style.display = loc.here && window.Gps ? "none" : "";
  P.here.setLngLat([loc.lon, loc.lat]);
  cityFrame(loc);
  if(!quiet) pushStars();
}

/* ---------- GOES: imagem mais recente e quadros para animação ---------- */
const iso = d => d.toISOString().slice(0,19)+"Z";
async function latestTime(layer, z){
  const now = new Date(), from = new Date(now - 6*36e5);
  const txt = await (await fetch(`${GIBS}/1.0.0/${layer}/default/${setOf(z)}/all/${iso(from)}--${iso(now)}.xml`)).text();
  const dom = (txt.match(/<Domain>([^<]+)<\/Domain>/)||[])[1]; if(!dom) return null;
  const segs = dom.split(","), last = segs[segs.length-1].split("/");
  // a imagem mais nova entra no índice antes de todos os tiles existirem (404 por alguns minutos):
  // usa a anterior, 10 min mais velha, quando ela cabe no mesmo intervalo
  const end = new Date(last[1] || last[0]), prev = new Date(end - 10*6e4), st = new Date(last[0]);
  return iso(last[1] && prev >= st ? prev : end);
}
function yday(){ return new Date(Date.now()-864e5).toISOString().slice(0,10); }
function tileUrl(prod, t, sat){ const [layer, z] = (sat || SATS[2])[prod]; return `${GIBS}/${layer}/default/${t}/${setOf(z)}/{z}/{y}/{x}.png`; }
const geoId = sat => "geo-"+sat.k;
function dropGeo(){ const m = P.map; SATS.forEach(sat=>{ const id = geoId(sat); if(m.getLayer(id)) m.removeLayer(id); if(m.getSource(id)) m.removeSource(id); }); P.geoProd = null; }
// Relevo em escala real (1:1, sem exagero) em todos os zooms, inclusive no nível de rua, para que prédios,
// aviões no POV e marcos fiquem na altura verdadeira sobre o chão. O protocolo dem0 já tira batimetria e picos falsos.
function terrainFit(){
  const m = P.map; if(!m || !P.ready) return;
  if(document.body.classList.contains("nv-flat")){ try{ if(m.getTerrain()) m.setTerrain(null); }catch(e){} return; }   // estilo Rota: mapa plano
  const want = inSat() && P.proj !== "2d";
  const cur = m.getTerrain && m.getTerrain();
  try{
    if(!want){ if(cur) m.setTerrain(null); }
    else if(!cur || cur.exaggeration !== 1){ m.setTerrain({source:"dem", exaggeration:1}); safeDem(m); }
  }catch(e){}
}
// liga/desliga o Planeta Água; relevo 3D só na página de satélite (no fundo pesaria à toa)
const N_IDS = ["n-road","n-bnd","n-house","n-roadname","n-poi","n-water","n-river","n-peak","n-air","n-place"];
function setBase(b){ P.base = b; store.set("sat-base", b); applyMode(); panel(); footer(); }
// mapa base: a mesma lista, as mesmas miniaturas e a mesma escolha em todo o sistema (Rota · Satélite · Mapa · Relevo, de routes.js)
const BASES = () => window.Rotas?.bases?.() || [["sat","Satélite"],["map","Mapa"],["topo","Relevo"]];
const curBase = () => window.Rotas?.curBase?.() || P.base;
const pickBase = k => window.Rotas?.pickBase ? window.Rotas.pickBase(k) : setBase(k);
const baseThumb = k => window.Rotas?.baseThumb?.(k) || `<img src="${thumb(k)}" alt="" loading="lazy">`;
// ícones da barra rápida de camadas (conjunto de icons.js)
const LQ_ICO = {satNames:"type", satAlt:"altbands", satMt:"finerelief", fire:"fire", satBld:"box3d", br3d:"bridge", ovRail:"train", ovBike:"bike", satAir:"plane", satRadar:"rain", satStar:"sparkle", names2:"tag", places:"pin", hgt:"city", apt:"takeoff", cams:"video", volc:"volcano", temp:"landmark", traffic:"traffic", routes:"compass", drive:"car", tour:"drone", met:"wind"};
function setOv(k, on){ P[k] = on; store.set(k==="ovRail" ? "sat-ov-rail" : "sat-ov-bike", on); applyMode(); panel(); }
// miniatura do mapa do lugar atual (um tile real da camada)
function thumb(kind){
  const l = C.S.loc || {lat:-27.6, lon:-48.5}, z = 11, n = 2**z, x = Math.floor((l.lon+180)/360*n), lr = l.lat*Math.PI/180, y = Math.floor((1 - Math.log(Math.tan(lr)+1/Math.cos(lr))/Math.PI)/2*n);
  const svc = {sat:"World_Imagery", map:"World_Street_Map", topo:"World_Topo_Map"}[kind];
  return `https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/tile/${z}/${y}/${x}`;
}
const NAME_TYPES = [["country","🌍","Países"],["state","🗺","Estados e províncias"],["city","🏙","Cidades"],["town","🏘","Cidades menores"],["village","🏡","Vilas e distritos"],
  ["suburb","📍","Bairros grandes"],["quarter","📌","Bairros"],["neighbourhood","🔸","Vizinhanças e loteamentos"],["roads","🛣","Ruas e números"],["water","💧","Rios, lagos e mares"],["peaks","▲","Picos e montanhas"],["borders","┄","Fronteiras"]];
function nameTypes(){
  const saveNT = () => { store.set("sat-namecls", [...P.nameCls]); if(!P.names) setNames(true); else applyMode(); };
  const draw = () => { C.openModal({title:"Nomes no mapa", sub:"Escolha quais nomes aparecem sobre a imagem de satélite.",
    html:`<div class="pl-cats">${NAME_TYPES.map(([k,ic,n])=>`<button type="button" class="pl-cat" data-nt="${k}" aria-pressed="${P.nameCls.has(k)}"><span style="background:var(--fill-2)">${ic}</span>${n}</button>`).join("")}</div>`,
    actions:[{label:"Pronto", primary:true, fn:()=>C.closeModal()},
      {label:"Todos", fn:()=>{ NAME_TYPES.forEach(([k])=>P.nameCls.add(k)); saveNT(); draw(); }},
      {label:"Só cidades e bairros", fn:()=>{ P.nameCls = new Set(["city","town","suburb","quarter","neighbourhood"]); saveNT(); draw(); }}]});
    document.querySelectorAll("#modal [data-nt]").forEach(b=>b.onclick=()=>{ const k = b.dataset.nt;
      P.nameCls.has(k) ? P.nameCls.delete(k) : P.nameCls.add(k); b.setAttribute("aria-pressed", P.nameCls.has(k)); saveNT(); }); };
  draw();
}
// MapLibre 5: em zoom alto (direção, drone, POV) um marcador fora da tela pede o relevo de um tile sem DEM
// e a conta dá coordenada infinita — o erro escapa e mata o desenho do mapa. Sem relevo ali, vale 0.
function safeDem(m){ const pr = m.terrain && Object.getPrototypeOf(m.terrain); if(!pr || pr.__safe) return;
  const f = pr.getDEMElevation; pr.getDEMElevation = function(...a){ try{ return f.apply(this, a); }catch(e){ return 0; } }; pr.__safe = true; }
function setNames(on){ P.names = on; store.set("sat-names", on); applyMode(); panel(); }
function applyMode(){
  const m = P.map; if(!m || !P.ready) return;
  if(document.body.classList.contains("rt-nav") || document.body.classList.contains("nv-look")){
    // navegação/estilo rota cuidam das camadas e do zoom — mas as camadas de prédios criadas depois (alturas medidas
    // da cidade, escala global, telhados) precisam aparecer também, senão o bairro fica só com os telhados
    for(const L of m.getStyle().layers) if(/^(hx-|ghb|rf3d)/.test(L.id) && !/-h(-lbl)?$/.test(L.id)){ const v = P.bld ? "visible" : "none"; if((m.getLayoutProperty(L.id, "visibility") || "visible") !== v) m.setLayoutProperty(L.id, "visibility", v); }
    return; }
  const clear = isClear();
  // foto Esri só quando ela é o fundo (com Mapa/Relevo por cima ela baixava tiles escondidos à toa)
  m.setLayoutProperty("earth", "visibility", clear && P.base === "sat" ? "visible" : "none");
  // no voo do simulador e no POV a câmera chega perto do chão: o limite de zoom não pode ser reaplicado
  if(!(P.pov || window.Sim?.active?.() || window.Drive?.active?.() || window.Drone?.active?.())) m.setMaxZoom(clear ? 19.5 : 10);
  terrainFit();
  if(!clear && m.getPitch()>0 && !inSat()) m.jumpTo({pitch:0});
  const vis = (ids, on) => ids.forEach(id=>m.getLayer(id) && m.setLayoutProperty(id, "visibility", on ? "visible" : "none"));
  // no fundo das telas o mapa é só imagem (nomes e camadas técnicas brigariam com os widgets);
  // nomes, ruas, altitude e prédios aparecem no modo Mapa
  const full = inSat();
  vis(["relief","hill","contour-line","contour-label"], P.alt && full);
  // Mapa e Relevo já trazem nomes e ruas próprios: os rótulos vetoriais só valem sobre a imagem de satélite
  const satBase = P.base === "sat";
  vis(N_IDS, P.names && full && satBase); vis(["labels"], !P.names && full && satBase);
  // tipos de nome escolhidos pelo usuário
  if(P.names && full && satBase){
    const c = P.nameCls, place = ["country","state","city","town","village","hamlet","suburb","quarter","neighbourhood","island"].filter(k=>c.has(k==="hamlet"?"village":k==="island"?"town":k));
    if(m.getLayer("n-place")) m.setFilter("n-place", ["in", ["get","class"], ["literal", place]]);
    vis(["n-road","n-roadname","n-house"], c.has("roads")); vis(["n-water","n-river"], c.has("water")); vis(["n-peak"], c.has("peaks")); vis(["n-bnd"], c.has("borders"));
  }
  vis(["base-map"], P.base === "map"); vis(["base-topo"], P.base === "topo");
  vis(["ov-rail"], P.ovRail && full); vis(["ov-bike"], P.ovBike && full);
  if(!satBase && !(P.pov || window.Sim?.active?.() || window.Drive?.active?.() || window.Drone?.active?.())) m.setMaxZoom(19);
  vis(BLD_ALL, P.bld && inSat()); vis(["cristo"], (P.bld || P.hgt) && inSat());
  vis(["planes"], P.air && inSat());
  vis(["bld-h","bld-parts-h","bld-h-lbl","landmarks"], P.hgt && inSat()); if(P.hgt) vis(BLD_ALL, false);
  const lg = $("altLegend"); if(lg) lg.hidden = !P.alt;
  if(P.pov){ POV_OFF.filter(id=>!(P.povOn||new Set()).has(id)).forEach(id=>m.getLayer(id) && m.setLayoutProperty(id,"visibility","none")); }
}
async function refreshGoes(force){
  if(!P.ready) return;
  applyMode();
  const m = P.map;
  m.setLayoutProperty("viirs", "visibility", !isClear() && P.prod==="geocolor" ? "visible" : "none");
  if(isClear()){ dropGeo(); P.time = null; P.times = null; stamp(); footer(); return; }
  const prod = P.prod;
  const times = await Promise.all(SATS.map(sat=>latestTime(sat[prod][0], sat[prod][1]).catch(()=>null)));
  if(prod !== P.prod || isClear()) return;   // o usuário trocou de camada enquanto a busca corria
  if(P.geoProd !== prod){
    // troca de produto: recria as três camadas (o zoom nativo muda entre produtos)
    dropGeo();
    SATS.forEach((sat,i)=>{ const id = geoId(sat);
      // bounds: só pede tiles dentro do disco que o satélite enxerga (fora dele o servidor responde erro)
      // retina: tiles de 128 px lógicos → pede um nível acima (até o máximo do GIBS). Na cor real, ao aproximar
      // além do z6 o geoestacionário (~1 km) fica translúcido sobre o mosaico VIIRS de 375 m: chão nítido, nuvens atuais
      const op = prod === "geocolor" ? ["interpolate",["linear"],["zoom"],6,sat.k==="hima" ? .85 : 1,9,.5] : (sat.k==="hima" && prod==="geocolor" ? .85 : 1);
      m.addSource(id, {type:"raster", tileSize:256, bounds:sat.bounds, maxzoom:sat[prod][1], attribution:`${sat.nome} via NASA GIBS`, tiles:[tileUrl(prod, times[i] || "default", sat)]});
      m.addLayer({id, type:"raster", source:id, paint:{"raster-fade-duration":250, "raster-opacity":op, "raster-resampling":"linear"}}, "earth"); });
    P.geoProd = prod;
  } else if(force || String(times) !== String(P.times)){
    // só a hora mudou: troca as URLs dos tiles, sem recriar camadas
    SATS.forEach((sat,i)=>{ const src = m.getSource(geoId(sat)); if(src && times[i]) src.setTiles([tileUrl(prod, times[i], sat)]); });
  }
  P.times = times; P.time = times[2] || "default";
  stamp(); footer();
}
function stamp(){
  const el = $("satTime"); if(!el) return;
  if(isClear()){ el.textContent = "Planeta Água · imagem sem nuvens (Esri) · relevo 3D"; return; }
  if(!P.times){ el.textContent = "Satélites geoestacionários · carregando"; return; }
  const hm = t => t ? new Date(t).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) : "—";
  const ago = P.time && P.time!=="default" ? Math.round((Date.now()-new Date(P.time))/6e4) : null;
  el.textContent = `GOES-19 ${hm(P.times[2])} · GOES-18 ${hm(P.times[1])} · Himawari ${hm(P.times[0])}${ago!=null?` · há ${ago} min`:""}${P.prod==="geocolor"?" · base VIIRS de ontem":""}`;
}
function setProd(p){ P.prod = p; store.set("sat-prod", p); stopAnim(); refreshGoes(true); panel(); }

// animação: 7 quadros, de 2 h atrás até agora, alternando a opacidade das camadas
function playAnim(){
  if(P.anim){ stopAnim(); panel(); return; }
  if(isClear() || !P.geoProd) return;
  const m = P.map, end = P.time && P.time!=="default" ? new Date(P.time) : new Date(Date.now()-40*6e4);
  end.setUTCMinutes(Math.floor(end.getUTCMinutes()/10)*10, 0, 0);
  const times = Array.from({length:7},(_,k)=>iso(new Date(end - (6-k)*20*6e4)));
  const ids = times.map((t,k)=>{ const id = "anim"+k;
    m.addSource(id, {type:"raster", tileSize:256, bounds:SATS[2].bounds, maxzoom:SATS[2][P.prod][1], tiles:[tileUrl(P.prod,t)]});
    m.addLayer({id, type:"raster", source:id, paint:{"raster-opacity":0, "raster-opacity-transition":{duration:0}, "raster-fade-duration":0}}, "earth"); return id; });
  let k = 0, wait = 0;
  P.anim = {ids, iv: setInterval(()=>{
    // pré-carga: só começa a girar quando todos os quadros visíveis chegaram (ou após ~8 s)
    if(!P.anim.go){ const n = ids.filter(id=>m.isSourceLoaded(id)).length; const el = $("satTime"); if(el) el.textContent = `Carregando quadros ${n}/${ids.length}…`;
      if(n < ids.length && ++wait < 12) return; P.anim.go = true; if(m.getLayer("geo-east")) m.setPaintProperty("geo-east", "raster-opacity", 0); }
    ids.forEach((id,j)=>m.setPaintProperty(id, "raster-opacity", j===k?1:0));
    const el = $("satTime"); if(el) el.textContent = `GOES-19 · ${new Date(times[k]).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})} · animação`;
    k = (k+1) % ids.length;
  }, 700)};
  panel();
}
function stopAnim(){
  if(!P.anim) return;
  const m = P.map; clearInterval(P.anim.iv);
  P.anim.ids.forEach(id=>{ if(m.getLayer(id)) m.removeLayer(id); if(m.getSource(id)) m.removeSource(id); });
  P.anim = null; if(m.getLayer("geo-east")) m.setPaintProperty("geo-east", "raster-opacity", 1); stamp();
}

/* ---------- radar ---------- */
// radar de chuva: o RainViewer publica um quadro a cada 10 min — recarrega o último quadro a cada 10 min
setInterval(()=>{ if(P.showRadar && P.map && !document.hidden && !P.frameAt) setRadar(true); }, 10*60*1000);
async function setRadar(on){
  P.showRadar = on; store.set("sat-radar", on);
  const m = P.map; if(!m || !P.ready) return panel();
  if(m.getLayer("radar")) m.removeLayer("radar");
  if(m.getSource("radar")) m.removeSource("radar");
  if(on){
    try{
      const j = await (await fetch("https://api.rainviewer.com/public/weather-maps.json")).json();
      const last = j.radar.past[j.radar.past.length-1];
      P.rv = {host:j.host, frames:[...j.radar.past, ...(j.radar.nowcast||[])]};
      m.addSource("radar", {type:"raster", tileSize:256, maxzoom:7, attribution:"Radar © RainViewer", tiles:[`${j.host}${last.path}/256/{z}/{x}/{y}/2/1_1.png`]});
      m.addLayer({id:"radar", type:"raster", source:"radar", paint:{"raster-opacity":.75}}, "relief");
    }catch(e){}
  }
  panel(); footer();
}

/* ---------- Starlink (propagação num Web Worker) ---------- */
let W = null;
async function loadStars(){
  if(!P.showStar || P.count || P.loadingStars) return;
  P.loadingStars = true;
  try{
    const r = await fetch("/data/starlink.tle"); if(!r.ok) throw 0;
    const text = await r.text();
    P.tleAt = r.headers.get("last-modified") ? new Date(r.headers.get("last-modified")) : null; footer();
    W = W || new Worker("starlink-worker.js");
    W.onmessage = ({data:m}) => {
      if(m.type === "ready"){ P.count = m.n; P.starAt = Date.now(); tick(); }
      if(m.type === "pos"){
        P.busy = false;
        P.overhead = {n:m.nOver, list:m.over};
        const f = [];
        for(let i=0;i<m.lon.length;i++){ if(!isNaN(m.lon[i])) f.push({type:"Feature", properties:{up:!!m.up[i]}, geometry:{type:"Point", coordinates:[m.lon[i], m.lat[i]]}}); }
        P.feats = f; pushStars();
        if(inSat()) panel(true);
        window.Home?.refresh("starlink");
      }
    };
    W.postMessage({type:"tle", text});
  }catch(e){ P.count = 0; }
  P.loadingStars = false;
}
function pushStars(){
  const src = P.ready && P.map.getSource("star"); if(!src) return;
  // de perto (cidade) os satélites não aparecem: não reenvia a cada segundo — senão o mapa nunca fica "pronto"
  // (a atualização constante segurava o indicador de carregamento e os prédios na tela)
  const perto = P.map.getZoom() >= 8 || P.pov || window.Drive?.active?.() || window.Drone?.active?.();
  if(perto){ if(P.starEmpty) return; P.starEmpty = true; src.setData({type:"FeatureCollection", features:[]}); return; }
  P.starEmpty = false;
  src.setData({type:"FeatureCollection", features: P.showStar && P.feats ? P.feats : []});
}
// ritmo: 1 s na página de satélite, 8 s no fundo; nada com a aba oculta ou com cálculo em andamento
function tick(){
  clearTimeout(P.timer);
  const loc = C.S.loc || P.loc;
  if(W && P.count && P.showStar && !document.hidden && !P.busy){ P.busy = true; W.postMessage({type:"tick", obs: loc ? {lat:loc.lat, lon:loc.lon} : null}); }
  if(P.count && Date.now()-P.starAt > 2*36e5){ P.count = 0; loadStars(); }
  P.timer = setTimeout(tick, inSat() ? 1000 : 8000);
}
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) tick(); });
function setStar(on){ P.showStar = on; store.set("sat-star", on); if(on) loadStars(); pushStars(); panel(); }
function setBg(on){ P.bg = on; store.set("sat-bg", on); document.body.classList.toggle("sat-bg", on); P.map?.resize(); panel(); }
// Topo/3D: decide pela inclinação real da câmera no momento do clique e cancela animação anterior
function toggle3d(){
  const m = P.map; m.stop();
  const up = m.getPitch() > 5;
  m.easeTo(up ? {pitch:0, bearing:0, duration:900} : {pitch:65, bearing:m.getBearing()-20, zoom:Math.max(m.getZoom(), 12), duration:1300});
}
// o rótulo acompanha a câmera, inclusive quando ela é inclinada com o botão direito / dois dedos
function sync3d(){ const b = $("sat3d"); if(!b) return; const up = P.map.getPitch() > 5; b.textContent = up ? "⬇" : "⛰"; b.title = up ? "Vista de cima" : "Inclinar em 3D"; }
// modo do mapa: globo 3D ou mapa plano 2D (Mercator, sem relevo, sem inclinação nem rotação)
function setProj(mode){
  P.proj = mode; store.set("sat-proj", mode);
  const m = P.map; if(!m) return;
  try{ m.setProjection({type: mode==="2d" ? "mercator" : "globe"}); }catch(e){}
  if(mode==="2d"){ m.easeTo({pitch:0, bearing:0, duration:500}); m.dragRotate.disable(); m.touchZoomRotate.disableRotation(); m.setMaxPitch(0); }
  else { m.setMaxPitch(80); if(inSat()){ m.dragRotate.enable(); m.touchZoomRotate.enableRotation(); } }
  terrainFit(); panel();
}
// "Minha localização": posição real do aparelho (GPS/rede), com ponto azul e círculo de precisão.
// Sem permissão, cai no local selecionado. Zoom 16 (nível de bairro/rua), sem passar do máximo da camada.
function myLocation(){
  // ponto azul ao vivo (gps.js): GPS contínuo, filtrado e seguindo o usuário
  if(window.Gps){ window.Gps.centrar(); return; }
  const b = $("satCenter"); b?.classList.add("busy");
  const go = (lon, lat, acc) => {
    b?.classList.remove("busy"); P.follow = null;
    const z = Math.min(P.map.getMaxZoom(), acc && acc > 800 ? 13 : 16);
    P.map.stop(); P.map.flyTo({center:[lon, lat], zoom:z, pitch:0, bearing:0, duration:2000, essential:true});
    if(!P.meEl){ P.meEl = document.createElement("div"); P.meEl.className = "me-dot"; P.me = new maplibregl.Marker({element:P.meEl}).setLngLat([lon, lat]).addTo(P.map); }
    P.me.setLngLat([lon, lat]); P.meEl.title = acc ? `Precisão ~${Math.round(acc)} m` : "Local selecionado";
  };
  if(!navigator.geolocation){ const l = C.S.loc; if(l) go(l.lon, l.lat); return; }
  navigator.geolocation.getCurrentPosition(p=>go(p.coords.longitude, p.coords.latitude, p.coords.accuracy),
    ()=>{ const l = C.S.loc; if(l) go(l.lon, l.lat); }, {enableHighAccuracy:true, timeout:10000, maximumAge:30000});
}
function globe(){
  if(P.proj==="2d"){ P.map.flyTo({center:P.map.getCenter(), zoom:1.6, duration:1400}); return; } P.map.flyTo({center:P.map.getCenter(), zoom:1.4, pitch:0, bearing:0, duration:1600}); }

/* ---------- altitude num ponto (decodifica o tile terrarium) ---------- */
const tileCache = new Map();
async function elevAt(lng, lat){
  const z = 13, n = 2**z, x = (lng+180)/360*n, lr = lat*Math.PI/180, y = (1 - Math.log(Math.tan(lr) + 1/Math.cos(lr))/Math.PI)/2*n;
  const tx = Math.floor(x), ty = Math.floor(y), key = `${z}/${tx}/${ty}`;
  let px = tileCache.get(key);
  if(!px){
    const r = await fetch(TERRARIUM_SRC.replace("{z}",z).replace("{x}",tx).replace("{y}",ty)); if(!r.ok) return null;
    const bmp = await createImageBitmap(await r.blob()), cv = document.createElement("canvas"); cv.width = cv.height = 256;
    const cx = cv.getContext("2d", {willReadFrequently:true}); cx.drawImage(bmp, 0, 0); px = cx.getImageData(0,0,256,256).data;
    tileCache.set(key, px); if(tileCache.size > 80) tileCache.delete(tileCache.keys().next().value);
  }
  const i = (Math.min(255, Math.floor((y-ty)*256))*256 + Math.min(255, Math.floor((x-tx)*256)))*4;
  return (px[i]*256 + px[i+1] + px[i+2]/256) - 32768;
}
const fmtAlt = e => e==null ? "—" : e < 0 ? `mar (${Math.round(e)} m)` : `${Math.round(e).toLocaleString("pt-BR")} m`;
function setAlt(on){ P.alt = on; store.set("sat-alt", on); applyMode(); panel(); }
// Relevo fino (Mapterhorn): troca só a origem dos tiles do relevo 3D, sombreamento e cores de altitude; curvas e altitude do ponto seguem na AWS
function setMt(on){ P.mt = on; store.set("sat-mt", on);
  for(const id of ["dem","dem2"]) try{ P.map?.getSource(id)?.setTiles([on ? TERRARIUM_MT : TERRARIUM]); }catch(e){}
  panel(); footer(); }
// clique num marco: altura, andares, ano e link para o Wikidata / Wikipédia
function landmarkCard(f){
  const p = f.properties, [lon, lat] = f.geometry.coordinates;
  C.openModal({icon:`<span class="pl-ic" style="background:#A52A8C">🏙</span>`, title:esc(p.name), sub:esc(p.city || "Arranha-céu"),
    kpis:[["Altura", r1(+p.h), "m"], ...(p.floors ? [["Andares", p.floors, ""]] : []), ...(p.year ? [["Concluído", p.year, ""]] : []), ["Coordenadas", `${lat.toFixed(4)}, ${lon.toFixed(4)}`, ""]],
    actions:[{label:"🔍 Ver em 3D", primary:true, fn:()=>{ C.closeModal(); if(!isClear()) setProd("earth"); P.map.flyTo({center:[lon,lat], zoom:16, pitch:65, bearing:P.map.getBearing()-30, duration:2200}); }},
      ...(p.wd ? [{label:"📖 Wikidata", fn:()=>window.open(`https://www.wikidata.org/wiki/${p.wd}`, "_blank", "noopener")}] : []),
      {label:"☀ Previsão daqui", fn:()=>{ C.closeModal(); C.load({name:p.name, admin:"", country:"", lat:+lat.toFixed(4), lon:+lon.toFixed(4)}); }}]});
}
function setHgt(on){ P.hgt = on; store.set("sat-hgt", on); applyMode(); panel(); }
function setBld(on){ P.bld = on; store.set("sat-bld", on); applyMode(); panel(); }

/* ---------- medição de distância com perfil de elevação ---------- */
const hav = (a, b) => { const R = 6371, dLa = (b[1]-a[1])*Math.PI/180, dLo = (b[0]-a[0])*Math.PI/180, la1 = a[1]*Math.PI/180, la2 = b[1]*Math.PI/180;
  return 2*R*Math.asin(Math.sqrt(Math.sin(dLa/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLo/2)**2)); };
function measureStart(lngLat){
  if(!inSat()){ location.hash = "#sat"; }
  P.measure = {pts: lngLat ? [[lngLat.lng, lngLat.lat]] : []};
  P.map.getCanvas().style.cursor = "crosshair";
  if(!P.mClick){
    P.mClick = e => { if(!P.measure) return; P.measure.pts.push([e.lngLat.lng, e.lngLat.lat]); measureDraw(); };
    P.map.on("click", P.mClick);
  }
  measureDraw();
}
function measureEnd(){ P.measure = null; P.map.getCanvas().style.cursor = ""; P.map.getSource("measure")?.setData({type:"FeatureCollection", features:[]}); const el = $("measure"); if(el) el.hidden = true; }
let mSeq = 0;
async function measureDraw(){
  const M = P.measure; if(!M) return;
  const pts = M.pts, feats = pts.map(p=>({type:"Feature", geometry:{type:"Point", coordinates:p}}));
  if(pts.length>1) feats.push({type:"Feature", geometry:{type:"LineString", coordinates:pts}});
  P.map.getSource("measure")?.setData({type:"FeatureCollection", features:feats});
  let km = 0; for(let i=1;i<pts.length;i++) km += hav(pts[i-1], pts[i]);
  const el = $("measure"); el.hidden = false;
  el.innerHTML = `<div class="ms-h"><b>Medição</b><span>${pts.length<2 ? "Clique no mapa para adicionar pontos" : `${km<1 ? r0(km*1000)+" m" : r1(km)+" km"} · ${pts.length} pontos`}</span>
    <div><button class="mbtn" id="msUndo"${pts.length?"":" disabled"}>Desfazer</button><button class="mbtn" id="msEnd">Fechar</button></div></div>
    <div class="ms-k" id="msK"></div><div class="ms-cv"${pts.length<2?" hidden":""}><canvas id="msChart"></canvas></div>`;
  $("msUndo").onclick = ()=>{ M.pts.pop(); measureDraw(); };
  $("msEnd").onclick = measureEnd;
  if(pts.length<2) return;
  // amostra ~80 pontos ao longo do trajeto e lê a altitude de cada um
  const seq = ++mSeq, N = 80, samp = [];
  for(let i=0;i<=N;i++){ let d = km*i/N, j = 1, acc = 0;
    while(j<pts.length && acc + hav(pts[j-1],pts[j]) < d){ acc += hav(pts[j-1],pts[j]); j++; }
    j = Math.min(j, pts.length-1); const seg = hav(pts[j-1],pts[j]) || 1, f = Math.min(1,(d-acc)/seg);
    samp.push({d, p:[pts[j-1][0]+(pts[j][0]-pts[j-1][0])*f, pts[j-1][1]+(pts[j][1]-pts[j-1][1])*f]}); }
  const E = await Promise.all(samp.map(s=>elevAt(s.p[0], s.p[1]).catch(()=>null)));
  if(seq !== mSeq || !P.measure) return;
  let up = 0, down = 0; for(let i=1;i<E.length;i++){ const dd = (E[i]??0)-(E[i-1]??0); if(dd>0) up += dd; else down -= dd; }
  const ok = E.filter(v=>v!=null), mx = Math.max(...ok), mn = Math.min(...ok);
  $("msK").innerHTML = [["Distância", km<1 ? r0(km*1000)+" m" : r1(km)+" km"],["Subida", r0(up)+" m"],["Descida", r0(down)+" m"],["Máxima", fmtAlt(mx)],["Mínima", fmtAlt(mn)],["Inclinação média", r1((up+down)/(km*1000)*100)+" %"]]
    .map(([k,v])=>`<div><small>${k}</small><b>${v}</b></div>`).join("");
  const ac = C.css("--warn");
  C.mk("msChart", {type:"line", data:{labels:samp.map(s=>s.d), datasets:[{data:E, borderColor:ac, backgroundColor:ac+"33", fill:true, pointRadius:0, borderWidth:2, tension:.25}]},
    options:{responsive:true, maintainAspectRatio:false, animation:false, plugins:{legend:{display:false}, tooltip:{callbacks:{title:it=>`${r1(samp[it[0].dataIndex].d)} km`, label:it=>fmtAlt(it.raw)}}},
      interaction:{mode:"index", intersect:false},
      scales:{x:{type:"linear", ticks:{color:C.css("--ink-3"), callback:v=>r1(v)+" km", maxTicksLimit:6}, grid:{color:C.css("--grid")}}, y:{ticks:{color:C.css("--ink-3"), callback:v=>v+" m"}, grid:{color:C.css("--grid")}}}}});
}

/* ---------- leitura de altitude sob o cursor ---------- */
let hoverT = 0;
function hover(e){
  const tip = $("altTip"); if(!tip) return;
  if(!P.alt || !inSat()){ tip.hidden = true; return; }
  const now = Date.now(); if(now - hoverT < 90) return; hoverT = now;
  const {lng, lat} = e.lngLat;
  elevAt(lng, lat).then(v=>{ tip.hidden = false; tip.style.left = e.point.x+16+"px"; tip.style.top = e.point.y+16+"px";
    tip.innerHTML = `<b>${fmtAlt(v)}</b><small>${lat.toFixed(4)}, ${lng.toFixed(4)}</small>`; }).catch(()=>{});
}

/* ---------- clique num nome: busca o contorno no OpenStreetMap, demarca e enquadra ---------- */
const CLICKABLE = ["n-place","n-water","n-river","n-peak","n-poi","n-air"];
const RADIUS = {country:300000, state:120000, city:9000, town:4000, village:1500, suburb:1500, quarter:900, neighbourhood:700, hamlet:500, island:3000, isolated_dwelling:200};
const TYPE_PT = {country:"país", state:"estado", city:"cidade", town:"cidade", village:"vila", suburb:"bairro/distrito", quarter:"bairro", neighbourhood:"bairro", hamlet:"localidade",
  island:"ilha", lake:"lago", lagoon:"lagoa", river:"rio", stream:"córrego", bay:"baía", sea:"mar", ocean:"oceano", peak:"pico", aerodrome:"aeroporto", administrative:"limite administrativo"};
const nameOf = p => p["name:pt"] || p.name_int || p.name || "";
function ringArea(r){ let a = 0; for(let i=0;i<r.length-1;i++){ const [x1,y1] = r[i], [x2,y2] = r[i+1]; a += (x2-x1)*Math.PI/180 * (2 + Math.sin(y1*Math.PI/180) + Math.sin(y2*Math.PI/180)); } return Math.abs(a*6378137*6378137/2); }
function geoArea(g){ const poly = p => ringArea(p[0]) - p.slice(1).reduce((s,h)=>s+ringArea(h),0);
  return g.type==="Polygon" ? poly(g.coordinates) : g.type==="MultiPolygon" ? g.coordinates.reduce((s,p)=>s+poly(p),0) : 0; }
function circle(lon, lat, m){ const c = []; for(let i=0;i<=64;i++){ const a = i/64*2*Math.PI, dx = m*Math.cos(a)/(111320*Math.cos(lat*Math.PI/180)), dy = m*Math.sin(a)/110540; c.push([lon+dx, lat+dy]); } return {type:"Polygon", coordinates:[c]}; }
function bboxOf(g){ let b = [180,90,-180,-90]; const walk = c => typeof c[0]==="number" ? (b=[Math.min(b[0],c[0]),Math.min(b[1],c[1]),Math.max(b[2],c[0]),Math.max(b[3],c[1])]) : c.forEach(walk); walk(g.coordinates); return b; }
async function nomi(q, lon, lat, d){
  const vb = `${lon-d},${lat+d},${lon+d},${lat-d}`;
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&polygon_threshold=0.0002&extratags=1&addressdetails=1&limit=3&accept-language=pt&bounded=1&viewbox=${vb}&q=${encodeURIComponent(q)}`);
  return r.ok ? r.json() : [];
}
let regSeq = 0;
async function regionGo(f, ll){
  const seq = ++regSeq, p = f.properties || {}, name = nameOf(p), cls = p.class || "";
  const pt = f.geometry.type==="Point" ? f.geometry.coordinates : [ll.lng, ll.lat];
  if(!name) return;
  regionCard({name, sub:"buscando contorno no OpenStreetMap…"});
  const span = {country:25, state:8, city:.6, town:.4}[cls] || .25;
  let res = []; try{ res = await nomi(name, pt[0], pt[1], span); }catch(e){}
  if(seq !== regSeq) return;
  // prefere o resultado com polígono; senão, o primeiro
  const hit = res.find(r=>r.geojson && /Polygon/.test(r.geojson.type)) || res[0];
  const feats = []; let geom = null, approx = false, parent = null;
  if(hit && /Polygon/.test(hit.geojson.type)) geom = hit.geojson;
  else if(hit && hit.geojson && hit.geojson.type==="LineString"){ geom = hit.geojson; }
  else {
    // só ponto: área aproximada pelo tipo e o contorno do distrito/município em volta
    approx = true;
    const lon = hit ? +hit.lon : pt[0], lat = hit ? +hit.lat : pt[1];
    geom = circle(lon, lat, RADIUS[cls] || RADIUS[hit?.addresstype] || 800);
    const a = hit?.address || {}, up = a.suburb || a.city_district || a.city || a.town || a.municipality;
    if(up && up !== name){ try{ const pr = await nomi(up, lon, lat, .5); parent = pr.find(r=>r.geojson && /Polygon/.test(r.geojson.type)); }catch(e){} }
    if(seq !== regSeq) return;
  }
  feats.push({type:"Feature", properties:{role:"main"}, geometry:geom});
  if(parent) feats.push({type:"Feature", properties:{role:"parent"}, geometry:parent.geojson});
  P.map.getSource("region")?.setData({type:"FeatureCollection", features:feats});
  const b = bboxOf(parent && approx ? parent.geojson : geom);
  if(b[2]-b[0] < 1e-6){ P.map.flyTo({center:pt, zoom:15, duration:1600}); }
  else P.map.fitBounds([[b[0],b[1]],[b[2],b[3]]], {padding:{top:120, bottom: innerWidth>860 ? 230 : 160, left: innerWidth>860 ? (document.body.classList.contains("rail") ? 64 : 300) + 48 + 410 : 30,   // barra lateral + cartão à esquerda
    right: innerWidth>860 && !document.body.classList.contains("widgets-off") ? Math.min(500, innerWidth*.36) + 50 : 40}, maxZoom:16.5, duration:1800, pitch:P.map.getPitch()});
  const area = /Polygon/.test(geom.type) && !approx ? geoArea(geom)/1e6 : null;
  const a = hit?.address || {}, where = [a.suburb && a.suburb!==name ? a.suburb : "", a.city || a.town || a.municipality, a.state].filter(x=>x && x!==name).join(" · ");
  const tipo = TYPE_PT[hit?.addresstype] || TYPE_PT[hit?.type] || TYPE_PT[cls] || (hit?.addresstype || cls || "lugar");
  const pop = hit?.extratags?.population, ele = p.ele;
  regionCard({name, sub:[tipo, where].filter(Boolean).join(" · "),
    k:[area!=null ? ["Área", area<1 ? r0(area*100)+" ha" : r1(area)+" km²"] : approx ? ["Área", "aproximada"] : null,
       pop ? ["População", (+pop).toLocaleString("pt-BR")] : null, ele ? ["Altitude", (+ele).toLocaleString("pt-BR")+" m"] : null,
       parent ? ["Dentro de", nameOf(parent.address||{}) || parent.name || parent.display_name.split(",")[0]] : null].filter(Boolean),
    note: approx ? "O OpenStreetMap só tem o ponto deste lugar: o círculo indica a área aproximada; o tracejado é o distrito/município." : "",
    lon: hit ? +hit.lon : pt[0], lat: hit ? +hit.lat : pt[1]});
}
// cartão do lugar (painel à esquerda no computador, folha embaixo no celular): foto aérea do ponto, tempo agora,
// ações e dados da região. Serve para cidade, região clicada e ponto marcado no mapa.
const esriTile = (lon, lat, z) => { const n = 2**z, x = Math.floor((lon+180)/360*n), lr = lat*Math.PI/180, y = Math.floor((1 - Math.log(Math.tan(lr)+1/Math.cos(lr))/Math.PI)/2*n);
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`; };
let rgSeq = 0;
function regionCard(o){
  let el = $("region");
  if(!el){ el = document.createElement("section"); el.id = "region"; el.className = "region"; document.body.appendChild(el); }
  el.hidden = false; const seq = ++rgSeq, ic = (n, s=18) => window.Ico?.(n, s) || "";
  const has = o.lon != null, saved = has && C.isSaved?.({lat:+o.lat.toFixed(4), lon:+o.lon.toFixed(4)});
  const coords = has ? `${Math.abs(o.lat).toFixed(5)}° ${o.lat < 0 ? "S" : "N"}, ${Math.abs(o.lon).toFixed(5)}° ${o.lon < 0 ? "O" : "L"}` : "";
  el.innerHTML = `${has ? `<div class="rg-img" style="background-image:url('${esriTile(o.lon, o.lat, o.pin ? 17 : 14)}')"></div>` : ""}
    <button class="rg-x" id="rgX" aria-label="Fechar">${ic("x", 16)}</button>
    <div class="rg-body">
    <div class="rg-h"><div><b id="rgName">${esc(o.name)}</b><small id="rgSub">${esc(o.sub||"")}</small></div></div>
    ${has ? `<div class="rg-w" id="rgW"><span class="rg-wl">Tempo agora…</span></div>` : ""}
    ${has ? `<div class="rg-act">
      <button data-ra="fc">${ic("sun")}<span>Previsão</span></button>
      <button data-ra="rota">${ic("compass")}<span>Rotas</span></button>
      <button data-ra="save" class="${saved ? "on" : ""}">${ic("star")}<span>${saved ? "Salvo" : "Salvar"}</span></button>
      <button data-ra="3d">${ic("mountain")}<span>Ver em 3D</span></button>
      <button data-ra="trip">${ic("plane")}<span>Viajar</span></button>
      <button data-ra="share">${ic("send")}<span>Enviar</span></button></div>` : ""}
    ${o.k && o.k.length ? `<div class="rg-k">${o.k.map(([k,v])=>`<div><small>${k}</small><b>${esc(String(v))}</b></div>`).join("")}</div>` : ""}
    ${has ? `<div class="rg-co"><span>${ic("pin", 15)} ${coords}</span><span id="rgEle"></span></div>` : ""}
    ${o.note ? `<p class="rg-n">${o.note}</p>` : ""}</div>`;
  $("rgX").onclick = regionClear;
  document.dispatchEvent(new CustomEvent("clima:place", {detail:o}));
  if(!has) return;
  const loc = () => ({name:$("rgName")?.textContent || o.name, admin:"", country:"", lat:+o.lat.toFixed(4), lon:+o.lon.toFixed(4)});
  el.querySelectorAll("[data-ra]").forEach(b => b.onclick = async () => { const a = b.dataset.ra;
    if(a === "fc"){ C.load(loc()); location.hash = "#s-now"; }
    else if(a === "rota") window.Rotas?.to({name:loc().name, lat:o.lat, lon:o.lon});
    else if(a === "save"){ const on = C.savePlace?.(loc()); b.classList.toggle("on", !!on); b.querySelector("span").textContent = on ? "Salvo" : "Salvar"; window.ClimaToast?.(on ? "Salvo nos seus locais" : "Removido dos seus locais"); }
    else if(a === "3d"){ if(!isClear()) setProd("earth"); P.map.easeTo({center:[o.lon, o.lat], zoom:Math.max(P.map.getZoom(), 16), pitch:65, bearing:P.map.getBearing()-20, duration:1400}); }
    else if(a === "trip") window.Travel?.setDest({name:loc().name, lat:o.lat, lon:o.lon});
    else if(a === "share"){ const url = `${location.origin}/#sat@${o.lat.toFixed(5)},${o.lon.toFixed(5)}`, txt = `${loc().name} — ${coords}`;
      try{ if(navigator.share) await navigator.share({title:loc().name, text:txt, url}); else { await navigator.clipboard.writeText(`${txt}\n${url}`); window.ClimaToast?.("Link copiado"); } }catch(e){} }
  });
  // tempo agora no ponto (Open-Meteo) e altitude do terreno
  C.getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${o.lat.toFixed(4)}&longitude=${o.lon.toFixed(4)}&current=temperature_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m,relative_humidity_2m&timezone=auto&wind_speed_unit=kmh`).then(j => {
    const c = j.current, w = $("rgW"); if(seq !== rgSeq || !w || !c) return; const [d, k] = C.wmo(c.weather_code);
    w.innerHTML = `${C.icon(k, 34, !c.is_day)}<b>${C.r0(c.temperature_2m)}°</b><span>${esc(d)}<small>vento ${C.r0(c.wind_speed_10m)} km/h ${C.dirName(c.wind_direction_10m)} · umidade ${C.r0(c.relative_humidity_2m)}%</small></span>`;
  }).catch(() => { const w = $("rgW"); if(w && seq === rgSeq) w.hidden = true; });
  elevAt(o.lon, o.lat).then(h => { const e = $("rgEle"); if(e && seq === rgSeq && h != null && isFinite(h)) e.textContent = `${fmtAlt ? fmtAlt(h) : Math.round(h) + " m"} de altitude`; }).catch(() => {});
}
// clique no mapa (área sem nome, avião ou marcador): marca o ponto e abre o cartão com endereço, tempo e ações
let pinMk = null;
function dropPin(ll){
  const lon = ll.lng, lat = ll.lat;
  if(!pinMk){ const e = document.createElement("div"); e.className = "pin-drop"; e.innerHTML = "<i></i>"; pinMk = new maplibregl.Marker({element:e, anchor:"bottom"}); }
  pinMk.setLngLat([lon, lat]).addTo(P.map);
  P.map.getSource("region")?.setData({type:"FeatureCollection", features:[]});
  regionCard({name:"Local marcado", sub:"Buscando endereço…", lon, lat, pin:true});
  const seq = rgSeq;
  fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=pt&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`).then(r => r.json()).then(j => {
    if(seq !== rgSeq) return; const a = j.address || {};
    const rua = [a.road || a.pedestrian || a.footway || a.path, a.house_number].filter(Boolean).join(", ");
    const nome = j.name && j.name !== a.road ? j.name : rua || a.suburb || a.neighbourhood || a.village || a.town || a.city || "Local marcado";
    const sub = [rua && rua !== nome ? rua : "", a.suburb || a.neighbourhood, a.city || a.town || a.village || a.municipality, a.state].filter((x, k, A) => x && x !== nome && A.indexOf(x) === k).join(" · ");
    const n = $("rgName"), s = $("rgSub"); if(n) n.textContent = nome; if(s) s.textContent = sub || "Ponto no mapa";
  }).catch(() => { const s = $("rgSub"); if(s && seq === rgSeq) s.textContent = "Ponto no mapa"; });
}
// telas sem mapa interativo (Painel, Mar, Vento…): o satélite de fundo fica centrado na cidade do aparelho,
// deslocado para a área visível à direita da barra lateral
function bgCity(){
  const l = C.S.loc; if(!l || !P.map) return;
  const desk = innerWidth > 860, z = P.cityZoom ?? 10.5;
  // deslocamento por offset (o padding fica gravado no mapa e deixava uma faixa sem imagem na borda do globo)
  P.map.easeTo({center:[l.lon, l.lat], zoom: z, pitch:0, bearing:0, padding:{left:0, right:0, top:0, bottom:0}, offset: desk ? [170, 20] : [0, 10], duration:0});
}
// ao abrir (e a cada troca de local): enquadra a cidade do aparelho com o contorno demarcado e o cartão
function cityFrame(loc){
  if(!P.ready || !loc || !loc.name) return;
  const key = `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`; if(P.framed === key) return; P.framed = key;
  const nm = /minha localiza/i.test(loc.name) ? null : loc.name;
  if(!nm){ P.cityZoom = 11; bgCity(); return; }
  regionGo({properties:{name:nm, class:"city"}, geometry:{type:"Point", coordinates:[loc.lon, loc.lat]}}, {lng:loc.lon, lat:loc.lat});
  // guarda o zoom que enquadrou a cidade para usar no fundo das outras telas
  // fora do mapa interativo (ex.: Minha tela no celular) o contorno não fica desenhado no fundo
  P.map.once("moveend", ()=>{ P.cityZoom = Math.min(12, Math.max(8, P.map.getZoom())); if(!inSat()){ regionClear(); bgCity(); } });
}
function regionClear(){ regSeq++; rgSeq++; P.map.getSource("region")?.setData({type:"FeatureCollection", features:[]}); const el = $("region"); if(el) el.hidden = true; pinMk?.remove(); }
addEventListener("hashchange", ()=>{ if(!inSat()) regionClear(); });

/* ---------- quadro por horário (linha do tempo) ---------- */
// t = epoch ms no passado → imagem de cada satélite naquele horário (arredondado a 10 min, nunca além da mais recente);
// t = null → volta à mais recente. O radar usa o quadro mais próximo (inclui previsão de curtíssimo prazo).
function setFrame(t){
  if(!P.map || !P.geoProd || !P.times) return;
  stopAnim();
  SATS.forEach((sat,i)=>{
    const latest = P.times[i], src = P.map.getSource(geoId(sat)); if(!latest || !src) return;
    let tt = latest;
    if(t != null && t < Date.parse(latest)){ const d = new Date(t); d.setUTCMinutes(Math.floor(d.getUTCMinutes()/10)*10, 0, 0); tt = iso(d); }
    src.setTiles([tileUrl(P.prod, tt, sat)]);
  });
  if(P.rv && P.map.getSource("radar")){
    const target = (t ?? Date.now())/1000, f = P.rv.frames.reduce((a,b)=>Math.abs(b.time-target) < Math.abs(a.time-target) ? b : a);
    P.map.getSource("radar").setTiles([`${P.rv.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`]);
  }
  P.frameAt = t;
  const el = $("satTime");
  if(el && t != null) el.textContent = `Imagens de ${new Date(Math.min(t, Date.parse(P.times[2]))).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})} · linha do tempo`;
  else stamp();
}

/* ---------- aeronaves (ADS-B ao vivo via adsb.lol; rotas via adsbdb.com) ---------- */
const NM = 1852;
async function fetchPlanes(){
  if(!P.air || !P.ready || !inSat() || document.hidden) return;
  const c = P.map.getCenter(), b = P.map.getBounds();
  const diag = hav([b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]) * 1000 / NM / 2;   // raio em milhas náuticas
  const r = Math.max(25, Math.min(250, Math.round(diag)));
  try{
    const j = await (await fetch(`/adsb/v2/lat/${c.lat.toFixed(3)}/lon/${(((c.lng+540)%360)-180).toFixed(3)}/dist/${r}`)).json();
    const now = Date.now(), seen = new Set();
    (j.ac || []).forEach(a=>{ if(a.lat==null || a.lon==null) return; seen.add(a.hex);
      const prev = P.planes.get(a.hex), trail = prev?.trail || [];
      if(!trail.length || Math.abs(trail[trail.length-1][0]-a.lon) + Math.abs(trail[trail.length-1][1]-a.lat) > .002){ trail.push([a.lon, a.lat]); if(trail.length > 600) trail.shift(); }
      P.planes.set(a.hex, {trail, hex:a.hex, cs:(a.flight||a.r||a.hex).trim(), r:a.r||"", t:a.t||"", lat:a.lat, lon:a.lon, track:a.track ?? a.true_heading ?? 0,
        // alt_geom = altitude GPS (real); alt_baro é calibrada em 1013 hPa e fica ~600 m abaixo em cruzeiro
        gs:a.gs || 0, alt: a.alt_baro==="ground" ? 0 : (a.alt_geom ?? a.alt_baro ?? 0), baro: a.alt_baro, gnd:a.alt_baro==="ground",
        vr:a.geom_rate ?? a.baro_rate ?? 0, sq:a.squawk||"", at: now - (a.seen_pos||0)*1000}); });
    for(const [k,v] of P.planes) if(!seen.has(k) && now - v.at > 60000) P.planes.delete(k);
    drawPlanes(); footer(); panel(true);
    if(P.sel && P.planes.has(P.sel)) drawTrail(P.sel);
  }catch(e){}
}
// entre as atualizações, cada avião avança pela velocidade e rumo (movimento contínuo)
function drawPlanes(){
  const src = P.ready && P.map.getSource("planes"); if(!src) return;
  const now = Date.now(), f = [];
  for(const p of P.planes.values()){
    const dt = (now - p.at)/1000, d = p.gnd ? 0 : p.gs*NM/3600*dt, tr = p.track*Math.PI/180;
    const lat = p.lat + d*Math.cos(tr)/110540, lon = p.lon + d*Math.sin(tr)/(111320*Math.cos(p.lat*Math.PI/180));
    let eta = "";
    if(P.selRoute && P.selRoute.hex === p.hex){ const r = P.selRoute.rt, dd = hav([lon,lat], [r.destination.longitude, r.destination.latitude]);
      if(p.gs > 50) eta = `⏱ ${etaTxt(dd/(p.gs*1.852)*60)} p/ ${ap(r.destination)}`; }
    f.push({type:"Feature", properties:{eta, sel: p.hex === P.sel, hex:p.hex, cs:p.cs, track:p.track, alt:p.alt, gnd:p.gnd, fl: p.gnd ? "solo" : `FL${String(Math.round(p.alt/100)).padStart(3,"0")}`}, geometry:{type:"Point", coordinates:[lon, lat]}});
  }
  src.setData({type:"FeatureCollection", features:f});
}
setInterval(()=>{ if(P.air && inSat() && !document.hidden) drawPlanes(); }, 1000);
setInterval(fetchPlanes, 10000);
function setAir(on){ P.air = on; store.set("sat-air", on); if(P.map?.getLayer("planes")) P.map.setLayoutProperty("planes", "visibility", on ? "visible" : "none");
  if(on) fetchPlanes(); else { P.planes.clear(); drawPlanes(); clearRoute(); } panel(); footer(); }
// rastro + rota do avião selecionado (o rastro cresce a cada atualização)
function drawTrail(hex){
  const p = P.planes.get(hex), src = P.map?.getSource("route"); if(!p || !src) return;
  const f = (P.routeFeats || []).slice();
  if((p.real && p.real.length) || (p.trail && p.trail.length > 1)) f.push({type:"Feature", properties:{part:"trail"}, geometry:{type:"LineString", coordinates: p.real ? [...p.real, ...(p.trail||[]).slice(p.trailAt||0), [p.lon,p.lat]] : [...(p.trail||[]), [p.lon,p.lat]]}});
  src.setData({type:"FeatureCollection", features:f});
}
// seguir o avião: a câmera acompanha a posição estimada a cada segundo
// clique no avião: abre só a barra horizontal resumida; o cartão completo vem pelo ⓘ
async function selectPlane(hex){
  const p = P.planes.get(hex); if(!p) return;
  regionClear();   // um cartão de cada vez: o da região sai quando um avião é escolhido
  P.sel = hex; P.cardOpen = false; P.routeFeats = []; P.followInfo = {}; drawTrail(hex);
  const c = $("planeCard"); if(c) c.hidden = true;
  followBar();
  const [rt, ac, real] = await Promise.all([getRoute(p.cs), getAc(hex), realTrack(hex)]);
  if(real && real.length > 1){ p.real = real; p.dep = real.dep; p.trailAt = (p.trail||[]).length; }   // a partir daqui o rastro ao vivo continua o real
  if(P.sel !== hex) return;
  P.followInfo = {rt, ac}; routeFor(hex, rt); followBar();
}
// trajeto real desde a decolagem (OpenSky Network, via servidor; cache de 2 min por avião)
const osCache = new Map();
async function realTrack(hex){
  const c = osCache.get(hex); if(c && Date.now() - c.at < 120000) return c.path;
  let path = null;
  try{ const r = await fetch(`/opensky/tracks/all?icao24=${hex.toLowerCase()}&time=0`); if(r.ok){ const j = await r.json(); const raw = (j.path||[]).filter(x=>x[1]!=null && x[2]!=null); path = raw.map(x=>[x[2], x[1]]);
    const up = raw.find(x=>x[5] === false) || raw[0]; path.dep = up ? up[0]*1000 : (j.startTime ? j.startTime*1000 : null); } }catch(e){}
  osCache.set(hex, {at:Date.now(), path}); return path;
}
// grande círculo entre dois pontos [lon,lat] (como os aviões voam de verdade)
function gc(a, b, n=64){
  const r = Math.PI/180, [l1,f1] = [a[0]*r, a[1]*r], [l2,f2] = [b[0]*r, b[1]*r];
  const d = 2*Math.asin(Math.sqrt(Math.sin((f2-f1)/2)**2 + Math.cos(f1)*Math.cos(f2)*Math.sin((l2-l1)/2)**2));
  if(d < 1e-6) return [a, b];
  const out = [];
  for(let i=0;i<=n;i++){ const f = i/n, A = Math.sin((1-f)*d)/Math.sin(d), B = Math.sin(f*d)/Math.sin(d);
    const x = A*Math.cos(f1)*Math.cos(l1) + B*Math.cos(f2)*Math.cos(l2), y = A*Math.cos(f1)*Math.sin(l1) + B*Math.cos(f2)*Math.sin(l2), z = A*Math.sin(f1) + B*Math.sin(f2);
    out.push([Math.atan2(y,x)/r, Math.atan2(z, Math.hypot(x,y))/r]); }
  return out;
}
const etaTxt = min => min==null ? "" : min < 1 ? "pousando" : min < 60 ? `${Math.round(min)} min` : `${Math.floor(min/60)} h ${String(Math.round(min%60)).padStart(2,"0")}`;
function routeFor(hex, rt){
  const p = P.planes.get(hex); if(!p || !rt) return;
  P.selRoute = {hex, rt};
  const real = p.real && p.real.length > 1 ? p.real : null;
  const o = [rt.origin.longitude, rt.origin.latitude], d = [rt.destination.longitude, rt.destination.latitude];
  const first = real ? real[0] : p.trail && p.trail.length ? p.trail[0] : [p.lon, p.lat];
  const left = hav([p.lon,p.lat], d), eta = p.gs > 50 ? left/(p.gs*1.852)*60 : null;
  P.routeFeats = [
    // só estima o trecho inicial se o trajeto real não começa no aeroporto de origem
    ...(hav(o, first) > 15 ? [{type:"Feature", properties:{part:"antes"}, geometry:{type:"LineString", coordinates:gc(o, first)}}] : []),
    {type:"Feature", properties:{part:"todo"}, geometry:{type:"LineString", coordinates:gc([p.lon,p.lat], d)}},
    {type:"Feature", properties:{label:`${ap(rt.origin)} · decolagem`}, geometry:{type:"Point", coordinates:o}},
    {type:"Feature", properties:{label:`${ap(rt.destination)} · pouso${eta!=null?` em ${etaTxt(eta)}`:""}`}, geometry:{type:"Point", coordinates:d}}];
  drawTrail(hex);
}
// a rota restante e o tempo acompanham o avião
setInterval(()=>{ if(P.selRoute && P.sel === P.selRoute.hex && P.planes.has(P.sel)) routeFor(P.sel, P.selRoute.rt); }, 5000);
// POV (cabine): a câmera fica no avião, na altitude real, olhando à frente no rumo do voo.
// Posição estimada a cada quadro (velocidade, rumo e razão vertical desde o último dado ADS-B).
function povStart(hex){
  const m = P.map, p = P.planes.get(hex); if(!m || !p || typeof m.calculateCameraOptionsFromCameraLngLatAltRotation !== "function") return;
  P.follow = null; P.pov = hex; P.povPrev = {prod:P.prod, proj:P.proj};
  if(!isClear()) setProd("earth");              // imagem sem nuvens com relevo 3D: visão de janela
  if(P.proj === "2d") setProj("globe");
  try{ m.setMaxPitch(85); m.setMaxZoom(22); }catch(e){}
  HANDLERS.forEach(h=>m[h] && m[h].disable());
  document.body.classList.add("pov"); P.look = {yaw:0, pitch:0}; P.povOn = new Set(); povHint(true);
  povLite(true);
  // câmera suavizada: o alvo (posição estimada do avião) é seguido com amortecimento exponencial,
  // então a correção que chega a cada dado novo do ADS-B vira um deslize, não um pulo.
  let cam = null, last = performance.now();
  const ang = (a, b) => ((b - a + 540) % 360) - 180;
  const frame = (now = performance.now()) => {
    if(P.pov !== hex) return;
    const q = P.planes.get(hex); if(!q || !inSat()){ povStop(); return; }
    const dtf = Math.min(.1, (now - last)/1000); last = now;
    const dt = (Date.now() - q.at)/1000, d = q.gnd ? 0 : q.gs*1852/3600*dt, tr = q.track*Math.PI/180;
    const tgt = {lat: q.lat + d*Math.cos(tr)/110540, lon: q.lon + d*Math.sin(tr)/(111320*Math.cos(q.lat*Math.PI/180)),
      alt: (q.alt + (q.vr||0)*Math.min(dt,30)/60) * .3048, brg: q.track};
    // nunca abaixo do terreno (relevo 3D): mínimo de 25 m sobre o chão
    let gnd = 0; try{ gnd = m.queryTerrainElevation ? (m.queryTerrainElevation([tgt.lon, tgt.lat]) || 0) : 0; }catch(e){}
    // o relevo muda de detalhe enquanto carrega: o piso é suavizado (~1 s) para não sacudir a câmera
    P.gndS = P.gndS == null ? gnd : P.gndS + (gnd - P.gndS) * (1 - Math.exp(-dtf/1));
    tgt.alt = Math.max(tgt.alt, P.gndS + 25);
    if(!cam) cam = {...tgt};
    // posição: avança junto com o alvo e corrige a diferença aos poucos (~1,5 s); rumo ~2 s; altitude ~3 s
    const kp = 1 - Math.exp(-dtf/1.5), kb = 1 - Math.exp(-dtf/2), ka = 1 - Math.exp(-dtf/3);
    cam.lat += (tgt.lat - cam.lat) * kp; cam.lon += (tgt.lon - cam.lon) * kp;
    cam.alt += (tgt.alt - cam.alt) * ka; cam.brg = (cam.brg + ang(cam.brg, tgt.brg) * kb + 360) % 360;
    const L = P.look || {yaw:0, pitch:0}, kl = 1 - Math.exp(-dtf/.18);
    cam.yaw = (cam.yaw ?? L.yaw) + (L.yaw - (cam.yaw ?? L.yaw)) * kl;
    cam.lp = (cam.lp ?? L.pitch) + (L.pitch - (cam.lp ?? L.pitch)) * kl;
    const fv = P.fov || 36.87; cam.fov = (cam.fov ?? fv) + (fv - (cam.fov ?? fv)) * kl;
    try{ if(Math.abs(m.getVerticalFieldOfView() - cam.fov) > .05) m.setVerticalFieldOfView(cam.fov); }catch(e){}
    try{
      const c = m.calculateCameraOptionsFromCameraLngLatAltRotation(new maplibregl.LngLat(cam.lon, cam.lat), cam.alt, ((cam.brg + cam.yaw) % 360 + 360) % 360, Math.max(20, Math.min(84, 78 + cam.lp)));
      // saída suavizada: o ponto de mira (calculado sobre o relevo) e o zoom variam um pouco a cada quadro;
      // com a lente fechada isso vira tremor. Filtro curto (~90 ms) tira o ruído sem atrasar o olhar.
      const ko = 1 - Math.exp(-dtf/.09), cc = c.center, o = cam.out || (cam.out = {lng:cc.lng, lat:cc.lat, z:c.zoom});
      if(Math.abs(cc.lng - o.lng) > .5 || Math.abs(cc.lat - o.lat) > .5){ o.lng = cc.lng; o.lat = cc.lat; o.z = c.zoom; }
      else { o.lng += (cc.lng - o.lng) * ko; o.lat += (cc.lat - o.lat) * ko; o.z += (c.zoom - o.z) * ko; }
      m.jumpTo({center:[o.lng, o.lat], zoom:o.z, bearing:c.bearing, pitch:c.pitch});
    }catch(e){}
    P.povRaf = requestAnimationFrame(frame);
  };
  frame(); followBar(); povTools();
}
// olhar em volta: arrastar com o mouse/dedo, setas ou WASD; R (ou duplo clique) volta à frente
function povHint(on){
  let h = $("povHint");
  if(!on){ if(h) h.hidden = true; return; }
  if(!h){ h = document.createElement("div"); h.id = "povHint"; h.className = "pov-hint"; document.body.appendChild(h); }
  h.hidden = false; h.innerHTML = `Arraste ou use <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> para olhar em 360° · rolagem ou <kbd>+</kbd><kbd>−</kbd> dá zoom · <kbd>R</kbd> reinicia`;
}
(function povLook(){
  let drag = null;
  const el = () => document.getElementById("satbg");
  document.addEventListener("pointerdown", e=>{ if(!P.pov || !e.target.closest("#satbg")) return; drag = {x:e.clientX, y:e.clientY, yaw:P.look.yaw, pitch:P.look.pitch}; e.preventDefault(); }, true);
  document.addEventListener("pointermove", e=>{ if(!drag || !P.pov) return; e.preventDefault();
    P.look.yaw = drag.yaw - (e.clientX - drag.x) * .25;
    P.look.pitch = Math.max(-58, Math.min(7, drag.pitch + (e.clientY - drag.y) * .2)); }, true);
  ["pointerup","pointercancel"].forEach(ev=>document.addEventListener(ev, ()=>{ drag = null; }, true));
  document.addEventListener("dblclick", e=>{ if(P.pov && e.target.closest("#satbg")){ P.look = {yaw:0, pitch:0}; P.fov = 36.87; } }, true);
  // rolagem do mouse (ou pinça no trackpad) = zoom da lente: campo de visão de 8° (teleobjetiva) a 80° (grande-angular)
  document.addEventListener("wheel", e=>{ if(!P.pov || !e.target.closest("#satbg")) return; e.preventDefault();
    P.fov = Math.max(8, Math.min(80, (P.fov || 36.87) * Math.exp(e.deltaY * .0015))); }, {capture:true, passive:false});
  const keys = new Set(); let loop = null;
  const step = () => { if(!P.pov || !keys.size){ loop = null; return; }
    if(keys.has("left")) P.look.yaw -= 2.5; if(keys.has("right")) P.look.yaw += 2.5;
    if(keys.has("up")) P.look.pitch = Math.min(7, P.look.pitch + 1.5); if(keys.has("down")) P.look.pitch = Math.max(-58, P.look.pitch - 1.5);
    loop = setTimeout(step, 30); };
  const map = {ArrowLeft:"left", a:"left", A:"left", ArrowRight:"right", d:"right", D:"right", ArrowUp:"up", w:"up", W:"up", ArrowDown:"down", s:"down", S:"down"};
  document.addEventListener("keydown", e=>{ if(!P.pov || e.target.closest("input,textarea,select")) return;
    if(e.key==="r" || e.key==="R"){ P.look = {yaw:0, pitch:0}; P.fov = 36.87; return; }
    if(e.key==="+" || e.key==="="){ P.fov = Math.max(8, (P.fov||36.87) / 1.15); return; }
    if(e.key==="-" || e.key==="_"){ P.fov = Math.min(80, (P.fov||36.87) * 1.15); return; }
    if(e.key==="Escape"){ povStop(); return; }
    const k = map[e.key]; if(!k) return; e.preventDefault(); keys.add(k); if(!loop) step(); });
  document.addEventListener("keyup", e=>{ const k = map[e.key]; if(k) keys.delete(k); });
})();
// POV em alta qualidade: imagem completa e resolução da tela; desliga só o que não se vê da cabine.
const POV_OFF = ["contour-line","contour-label","n-house","n-poi","star","star-glow","relief","hill","ov-rail","ov-bike"];
function povLite(on){
  const m = P.map; if(!m) return;
  if(on){
    m.setPaintProperty("earth", "raster-fade-duration", 0);
    P.povVis = POV_OFF.filter(id=>m.getLayer(id) && m.getLayoutProperty(id,"visibility")!=="none");
    P.povVis.forEach(id=>m.setLayoutProperty(id,"visibility","none"));
    try{ m.setPixelRatio(Math.min(2, devicePixelRatio||1)); }catch(e){}
  } else {
    m.setPaintProperty("earth", "raster-fade-duration", 300);
    (P.povVis||[]).forEach(id=>m.getLayer(id) && m.setLayoutProperty(id,"visibility","visible")); P.povVis = null;
    try{ m.setPixelRatio(Math.min(2, devicePixelRatio||1)); }catch(e){}
    applyMode();
  }
}
/* ---------- ferramentas do POV (widget lateral) ---------- */
const POV_LAYERS = {names:["n-place","n-water","n-river","n-peak","n-air","n-road","n-bnd","n-roadname"], alt:["relief","hill","contour-line","contour-label"], star:["star","star-glow"], rail:["ov-rail"], bike:["ov-bike"]};
function povTools(){
  let el = $("povTools");
  if(!P.pov){ if(el) el.hidden = true; return; }
  if(!el){ el = document.createElement("aside"); el.id = "povTools"; el.className = "pov-tools"; el.setAttribute("aria-label","Ferramentas do POV"); document.body.appendChild(el);
    el.addEventListener("click", e=>{ const b = e.target.closest("[data-pt]"); if(!b) return; const k = b.dataset.pt, on = P.povOn || (P.povOn = new Set());
      const tog = ids => { const want = !ids.every(id=>on.has(id)); ids.forEach(id=>want ? on.add(id) : on.delete(id)); };
      if(k==="names"){ setNames(!P.names); tog(POV_LAYERS.names); }
      if(k==="alt"){ setAlt(!P.alt); tog(POV_LAYERS.alt); }
      if(k==="star"){ setStar(!P.showStar); tog(POV_LAYERS.star); }
      if(k==="rail"){ setOv("ovRail", !P.ovRail); tog(POV_LAYERS.rail); }
      if(k==="bike"){ setOv("ovBike", !P.ovBike); tog(POV_LAYERS.bike); }
      if(k==="bld") setBld(!P.bld);
      if(k==="places") window.Places?.setOn(!window.Places.isOn());
      if(k==="radar") setRadar(!P.showRadar);
      if(k==="air") setAir(!P.air);
      if(k.startsWith("base-")) pickBase(k.slice(5));
      if(k==="zin") P.fov = Math.max(8, (P.fov||36.87)/1.3);
      if(k==="zout") P.fov = Math.min(80, (P.fov||36.87)*1.3);
      if(k==="front"){ P.look = {yaw:0, pitch:0}; P.fov = 36.87; }
      if(k==="left") P.look.yaw -= 90; if(k==="right") P.look.yaw += 90; if(k==="back") P.look.yaw += 180;
      if(k==="down") P.look.pitch = -55;
      applyMode(); povTools(); }); }
  el.hidden = false;
  const b = (k, ic, title, on) => `<button type="button" data-pt="${k}" title="${title}" aria-label="${title}"${on!=null?` aria-pressed="${!!on}"`:""}>${ic}</button>`;
  const vis = id => P.map.getLayer(id) && P.map.getLayoutProperty(id,"visibility") !== "none";
  el.innerHTML = `
    <div class="pt-g"><small>Camadas</small>
      ${b("names","Aa","Nomes e ruas", vis("n-place"))}${b("bld","▦","Prédios 3D", vis("bld"))}${b("alt","▲","Altitude / relevo", vis("relief"))}
      ${b("radar","☔","Radar de chuva", P.showRadar)}${b("air","✈","Outras aeronaves", P.air)}${b("star","✦","Starlink", vis("star"))}
      ${b("rail","🚇","Transporte público", vis("ov-rail"))}${b("bike","🚲","Ciclovias", vis("ov-bike"))}${b("places","📍","Lugares", window.Places?.isOn())}</div>
    <div class="pt-g"><small>Mapa base</small>
      ${BASES().map(([k,n])=>b("base-"+k, {rota:"🧭", sat:"🛰", map:"🗺", topo:"⛰"}[k], n, curBase()===k)).join("")}</div>
    <div class="pt-g"><small>Lente</small>
      ${b("zout","－","Afastar")}${b("zin","＋","Aproximar (zoom)")}<span class="pt-fov">campo ${Math.round(P.fov||36.87)}°</span></div>
    <div class="pt-g"><small>Olhar</small>
      ${b("front","⬆","Para a frente")}${b("left","⬅","Esquerda")}${b("right","➡","Direita")}${b("back","⬇","Para trás")}${b("down","◎","Para baixo")}</div>`;
}
setInterval(()=>{ if(P.pov){ const f = document.querySelector("#povTools .pt-fov"); if(f) f.textContent = "campo "+Math.round(P.fov||36.87)+"°"; } }, 300);
function povStop(){
  if(!P.pov) return;
  cancelAnimationFrame(P.povRaf); P.pov = null; P.gndS = null; P.povOn = null; setTimeout(povTools, 0); povHint(false); povLite(false);
  try{ P.map.setVerticalFieldOfView(36.87); }catch(e){} P.fov = 36.87; document.body.classList.remove("pov");
  const m = P.map; HANDLERS.forEach(h=>m[h] && m[h].enable()); try{ m.setMaxPitch(80); }catch(e){}
  if(P.povPrev && P.povPrev.prod !== P.prod) setProd(P.povPrev.prod);
  m.easeTo({pitch:45, zoom:Math.min(m.getZoom(), 9), duration:1200});
  followBar();
}
// hora em Brasília (America/Sao_Paulo) e em UTC
const hhmm = (ms, tz) => new Date(ms).toLocaleTimeString("pt-BR", {hour:"2-digit", minute:"2-digit", timeZone:tz});
const twoTz = ms => ms ? `<b>${hhmm(ms,"America/Sao_Paulo")}</b><span>${hhmm(ms,"UTC")} UTC</span>` : `<b>—</b><span>&nbsp;</span>`;
// barra horizontal do avião selecionado (seguindo ou não)
function followBar(){
  const hx = P.pov || P.follow || P.sel, card = $("planeCard"), on = !!(hx && P.planes.has(hx) && inSat() && !P.cardOpen);
  if(card && on) card.hidden = true;
  let bar = $("flightBar");
  document.body.classList.toggle("has-fbar", on);
  if(!on){ if(bar) bar.hidden = true; return; }
  if(!bar){ bar = document.createElement("section"); bar.id = "flightBar"; bar.className = "fbar"; bar.setAttribute("aria-label","Voo seguido"); document.body.appendChild(bar);
    bar.addEventListener("click", e=>{ const b = e.target.closest("[data-fb]"); if(!b) return;
      if(b.dataset.fb==="open"){ povStop(); const h = P.follow || P.sel; P.follow = null; P.cardOpen = true; followBar(); planeCard(h); }
      if(b.dataset.fb==="stop"){ povStop(); const h = P.follow || P.sel; P.follow = P.follow ? null : h; followBar(); }
      if(b.dataset.fb==="pov"){ const h = P.pov || P.follow || P.sel; if(P.pov) povStop(); else povStart(h); }
      if(b.dataset.fb==="close"){ povStop(); clearRoute(); } }); }
  bar.hidden = false;
  if(bar.matches(":active")) return;   // botão apertado: redesenhar agora trocaria o botão e o clique se perderia
  const p = P.planes.get(hx), rt = P.followInfo?.rt, ac = P.followInfo?.ac, fol = P.follow === hx;
  const o = rt ? [rt.origin.longitude, rt.origin.latitude] : null, d = rt ? [rt.destination.longitude, rt.destination.latitude] : null;
  const tot = rt ? hav(o,d) : 0, done = rt ? hav(o,[p.lon,p.lat]) : 0, pct = rt ? Math.max(0, Math.min(100, done/Math.max(1,tot)*100)) : 0;
  const left = Math.max(0, tot - done), eta = rt && p.gs > 50 ? left/(p.gs*1.852)*60 : null;
  bar.innerHTML = `<span class="fb-ic">✈</span>
    <div class="fb-id"><b>${esc(p.cs)}</b><small>${esc(rt?.airline?.name || ac?.registered_owner || p.t || "")}</small></div>
    ${rt ? `<div class="fb-rt"><span class="fb-ap"><b>${esc(rt.origin.iata_code||rt.origin.icao_code)}</b><small>${esc(rt.origin.municipality||rt.origin.name||"")}</small></span><div class="pc-line"><i style="width:${pct}%"></i><span style="left:${pct}%">✈</span></div><span class="fb-ap r"><b>${esc(rt.destination.iata_code||rt.destination.icao_code)}</b><small>${esc(rt.destination.municipality||rt.destination.name||"")}</small></span></div>` : ""}
    <div class="fb-k fb-alt"><small>Altitude</small><b>${p.gnd ? "solo" : `${Math.round(p.alt).toLocaleString("pt-BR")} ft`}</b></div>
    <div class="fb-k fb-spd"><small>Velocidade</small><b>${r0(p.gs*1.852)} km/h</b></div>
    <div class="fb-k fb-hdg"><small>Rumo</small><b>${r0(p.track)}° ${dirName(p.track)}</b></div>
    ${rt && p.dep ? `<div class="fb-k fb-t fb-dep" title="Horário de Brasília (BRT) e UTC"><small>Partida</small>${twoTz(p.dep)}</div>` : ""}
    ${eta!=null ? `<div class="fb-k fb-t" title="Previsão pela distância restante e velocidade atual"><small>Chegada prev. · ${eta<60 ? r0(eta)+" min" : r1(eta/60)+" h"}</small>${twoTz(Date.now() + eta*6e4)}</div>` : ""}
    <div class="fb-leg" title="Trajeto no mapa"><span><i class="lg-b4"></i>estimado</span><span><i class="lg-fl"></i>voado (real)</span><span><i class="lg-td"></i>restante</span></div>
    <div class="fb-a"><button class="lyr-b" data-fb="open" title="Ver detalhes do voo" aria-label="Ver detalhes">ⓘ</button>
      <button class="mbtn${P.pov?" on":""}" data-fb="pov" title="Câmera na cabine do avião">${P.pov ? "Sair do POV" : "POV cabine"}</button>
      <button class="mbtn${fol?" on":""}" data-fb="stop"${P.pov?" hidden":""}>${fol ? "Parar de seguir" : "Seguir avião"}</button>
      <button class="lyr-b" data-fb="close" title="Fechar" aria-label="Fechar">✕</button></div>`;
}
setInterval(()=>{ if(P.pov || P.follow || P.sel) followBar(); }, 2000);
addEventListener("hashchange", followBar);
setInterval(()=>{ if(!P.follow || !P.planes.has(P.follow) || !inSat()) return; const p = P.planes.get(P.follow), dt = (Date.now()-p.at)/1000, d = p.gnd ? 0 : p.gs*1852/3600*dt, tr = p.track*Math.PI/180;
  P.map.easeTo({center:[p.lon + d*Math.sin(tr)/(111320*Math.cos(p.lat*Math.PI/180)), p.lat + d*Math.cos(tr)/110540], duration:900, easing:x=>x}); }, 1000);
P.map?.on?.("dragstart", ()=>{ P.follow = null; });
// buscar voo por indicativo (ex.: GLO1670, TAM3302, AZU4558) em todo o mundo
async function findFlight(cs){
  cs = cs.trim().toUpperCase().replace(/\s+/g,""); if(!cs) return false;
  try{ const j = await (await fetch(`/adsb/v2/callsign/${encodeURIComponent(cs)}`)).json(); const a = (j.ac||[]).find(x=>x.lat!=null); if(!a) return false;
    if(!P.air) setAir(true);
    P.planes.set(a.hex, {trail:[[a.lon,a.lat]], hex:a.hex, cs:(a.flight||cs).trim(), r:a.r||"", t:a.t||"", lat:a.lat, lon:a.lon, track:a.track ?? 0, gs:a.gs||0,
      alt: a.alt_baro==="ground" ? 0 : (a.alt_baro ?? 0), gnd:a.alt_baro==="ground", vr:a.baro_rate ?? 0, sq:a.squawk||"", at:Date.now()});
    drawPlanes(); P.map.flyTo({center:[a.lon, a.lat], zoom:8, duration:2000}); planeCard(a.hex); return true;
  }catch(e){ return false; }
}
function clearRoute(){ P.selRoute = null; P.sel = null; P.follow = null; P.cardOpen = false; followBar(); P.routeFeats = []; P.map?.getSource("route")?.setData({type:"FeatureCollection", features:[]}); const el = $("planeCard"); if(el) el.hidden = true; }
const routeCache = new Map(), acCache = new Map();
const flag = iso => iso && /^[A-Z]{2}$/.test(iso) ? String.fromCodePoint(...[...iso].map(c=>0x1F1E6 + c.charCodeAt(0) - 65)) : "";
const cachedJSON = async (cache, key, url, pick) => { if(cache.has(key)) return cache.get(key);
  let v = null; try{ const r = await fetch(url); if(r.ok){ const j = await r.json(); v = pick(j) || null; } }catch(e){} cache.set(key, v); return v; };
const getRoute = cs => cachedJSON(routeCache, cs, `/adsbdb/v0/callsign/${encodeURIComponent(cs)}`, j => typeof j?.response === "object" ? j.response.flightroute : null);
const getAc = hex => cachedJSON(acCache, hex, `/adsbdb/v0/aircraft/${hex}`, j => typeof j?.response === "object" ? j.response.aircraft : null);
const ap = a => a ? `${a.iata_code || a.icao_code}` : "—";
const apCity = a => a ? (a.municipality || a.name) : "";
const ago = s => { const m = Math.round((Date.now()/1000 - s)/60); return m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m/60)} h` : `há ${Math.round(m/1440)} d`; };
async function planeCard(hex){
  const p = P.planes.get(hex); if(!p) return;
  let el = $("planeCard"); if(!el){ el = document.createElement("section"); el.id = "planeCard"; el.className = "region plane"; document.body.appendChild(el); }
  el.hidden = false; el.dataset.hex = hex; P.sel = hex; P.cardOpen = true; const fb = $("flightBar"); if(fb) fb.hidden = true; P.routeFeats = []; drawTrail(hex);
  const st = {rt:undefined, ac:undefined, hist:undefined, hr:{}, ph:undefined};
  const draw = () => {
    if(el.dataset.hex !== hex || el.hidden) return;
    const rt = st.rt, ac = st.ac, kmh = r0(p.gs*1.852), m = Math.round(p.alt*.3048);
    const airline = rt?.airline?.name || ac?.registered_owner || "";
    const ctry = rt?.airline?.country_iso || ac?.registered_owner_country_iso_name || "";
    const ctryName = rt?.airline?.country || ac?.registered_owner_country_name || "";
    const phase = p.gnd ? "No solo" : p.vr > 300 ? "Subindo" : p.vr < -300 ? "Descendo" : "Em cruzeiro";
    let prog = null;
    if(rt){ const o = [rt.origin.longitude, rt.origin.latitude], d = [rt.destination.longitude, rt.destination.latitude], tot = hav(o,d), done = hav(o,[p.lon,p.lat]);
      prog = {pct: Math.max(0, Math.min(100, done/Math.max(1,tot)*100)), left: Math.max(0, tot - done), eta: p.gs > 50 ? Math.max(0, tot - done)/(p.gs*1.852)*60 : null}; }
    el.innerHTML = `
      <div class="pc-h"><div class="pc-ic">✈</div><div class="pc-t"><b>${esc(p.cs)}</b><small>${airline ? esc(airline) : "Operador não identificado"}${ctryName?` · ${flag(ctry)} ${esc(ctryName)}`:""}</small></div>
        <span class="pc-ph">${phase}</span><button class="ibtn sm" id="pcX" aria-label="Fechar">✕</button></div>
      ${rt ? `<div class="pc-rt"><div><b>${esc(ap(rt.origin))}</b><small>${esc(apCity(rt.origin))}</small><em>${flag(rt.origin.country_iso_name)} ${esc(rt.origin.country_name||"")}</em></div>
          <div class="pc-line"><i style="width:${prog.pct}%"></i><span style="left:${prog.pct}%">✈</span></div>
          <div><b>${esc(ap(rt.destination))}</b><small>${esc(apCity(rt.destination))}</small><em>${flag(rt.destination.country_iso_name)} ${esc(rt.destination.country_name||"")}</em></div></div>
          <div class="pc-sub">${r0(prog.left).toLocaleString("pt-BR")} km restantes${prog.eta!=null?` · chegada em ~${prog.eta<60?r0(prog.eta)+" min":r1(prog.eta/60)+" h"}`:""}</div>`
        : `<p class="pc-note">${st.rt===undefined ? "Buscando origem e destino…" : "Rota não cadastrada para este indicativo (comum em voos privados, executivos e militares)."}</p>`}
      <div class="pc-k">
        <div><small>Altitude</small><b>${p.gnd ? "solo" : `${Math.round(p.alt).toLocaleString("pt-BR")} ft`}</b><span>${p.gnd ? "" : `${m.toLocaleString("pt-BR")} m · FL${String(Math.round(p.alt/100)).padStart(3,"0")}`}</span></div>
        <div><small>Velocidade</small><b>${r0(p.gs)} kt</b><span>${kmh} km/h</span></div>
        <div><small>Rumo</small><b>${r0(p.track)}°</b><span>${dirName(p.track)}</span></div>
        <div><small>Vertical</small><b>${p.vr>100?"↑":p.vr<-100?"↓":"→"} ${Math.abs(r0(p.vr)).toLocaleString("pt-BR")}</b><span>ft/min</span></div>
      </div>
      <div class="pc-ac">
        <div><small>Aeronave</small><b>${esc([ac?.manufacturer, ac?.type].filter(Boolean).join(" ") || p.t || "—")}</b></div>
        <div><small>Matrícula</small><b>${esc(ac?.registration || p.r || "—")} ${flag(ac?.registered_owner_country_iso_name)}</b></div>
        <div><small>Código ICAO</small><b>${esc(ac?.icao_type || p.t || "—")}</b></div>
        <div><small>Transponder</small><b>${esc(p.sq || "—")} · ${hex.toUpperCase()}</b></div>
      </div>
      <div class="pc-btns"><button class="mbtn${P.follow===hex?" on":""}" id="pcFollow"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="5.5"/><circle cx="10" cy="10" r="1.8" fill="currentColor" stroke="none"/><path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3"/></svg>${P.follow===hex ? "Seguindo" : "Seguir avião"}</button><button class="mbtn" id="pcZoom"><svg viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4 4M8.5 6v5M6 8.5h5"/></svg>Aproximar</button></div>
      <div class="pc-hist"><small>Últimas rotas desta aeronave</small>${
        st.hist === undefined ? `<p class="pc-note">Carregando histórico…</p>`
        : !st.hist || !st.hist.length ? `<p class="pc-note">Ainda sem histórico: o coletor do servidor registra os voos no espaço aéreo brasileiro a partir de agora.</p>`
        : st.hist.slice(0,5).map(l=>{ const r = st.hr[l.cs]; return `<div class="pc-leg"><b>${esc(l.cs)}</b><span>${r ? `${esc(ap(r.origin))} → ${esc(ap(r.destination))}` : r===null ? "rota não cadastrada" : "…"}</span><em>${ago(l.last)}</em></div>`; }).join("")}</div>
      <p class="pc-src">ADS-B ao vivo: adsb.lol (ODbL) · aeronave e rotas: adsbdb.com · histórico: coletor GPlanSiS</p>`;
    $("pcX").onclick = clearRoute;
    $("pcFollow").onclick = ()=>{ P.follow = hex; P.followInfo = {rt:st.rt, ac:st.ac}; P.cardOpen = false; el.hidden = true; followBar(); };
    $("pcZoom").onclick = ()=>{ const q = P.planes.get(hex); if(q) P.map.flyTo({center:[q.lon,q.lat], zoom:10, duration:1500}); };
  };
  draw();
  getAc(hex).then(v=>{ st.ac = v; draw(); });
  fetch(`/data/air/${hex}.json`).then(r=>r.ok ? r.json() : null).catch(()=>null).then(async j=>{
    st.hist = j?.legs || []; draw();
    for(const l of st.hist.slice(0,5)){ st.hr[l.cs] = await getRoute(l.cs); draw(); }
  });
  const rt = await getRoute(p.cs); st.rt = rt; draw();
  if(rt && el.dataset.hex === hex){
    const o = [rt.origin.longitude, rt.origin.latitude], d = [rt.destination.longitude, rt.destination.latitude], c = [p.lon, p.lat];
    P.routeFeats = [
      {type:"Feature", properties:{part:"todo"}, geometry:{type:"LineString", coordinates:[c, d]}},
      {type:"Feature", properties:{label:ap(rt.origin)}, geometry:{type:"Point", coordinates:o}},
      {type:"Feature", properties:{label:ap(rt.destination)}, geometry:{type:"Point", coordinates:d}}];
    drawTrail(hex);
  }
}

/* ---------- rodapé: hora de cada imagem e a fonte ---------- */
function footer(){
  const el = $("statusbar"); if(!el) return;
  const hm = t => t ? new Date(t).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) : "—";
  const parts = [];
  if(P.base==="map") parts.push(`<b>Mapa</b> Esri World Street Map`);
  if(P.base==="topo") parts.push(`<b>Relevo</b> Esri World Topographic Map`);
  if(P.ovRail) parts.push(`<b>Transporte</b> <span>OpenRailwayMap</span>`);
  if(P.ovBike) parts.push(`<b>Ciclovias</b> <span>CyclOSM</span>`);
  if(isClear()) parts.push(`<b>Planeta Água</b> imagem Esri World Imagery (mosaico sem nuvens) · relevo ${P.mt ? "Mapterhorn (Copernicus GLO-30)" : "AWS Terrain Tiles"}`);
  else if(P.times) parts.push(`<b>Satélites</b> GOES-19 ${hm(P.times[2])} · GOES-18 ${hm(P.times[1])} · Himawari-9 ${hm(P.times[0])} <span>NOAA · JMA via NASA GIBS</span>`);
  else parts.push(`<b>Satélites</b> carregando…`);
  if(!isClear() && P.prod==="geocolor") parts.push(`<b>Base global</b> VIIRS NOAA-20 ${new Date(Date.now()-864e5).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})} <span>NASA GIBS</span>`);
  if(P.showRadar) parts.push(`<b>Radar</b> <span>RainViewer</span>`);
  const fm = window.Fires?.isOn() && window.Fires.meta(); if(fm) parts.push(`<b>Queimadas</b> ${fm.n.toLocaleString("pt-BR")} focos em 24 h, até ${hm(fm.t)} <span>NASA FIRMS (VIIRS)</span>`);
  if(P.air) parts.push(`<b>Aeronaves</b> ${P.planes.size} no raio <span>adsb.lol (ODbL) · adsbdb · trajetos OpenSky Network</span>`);
  if(P.tleAt) parts.push(`<b>Starlink</b> órbitas de ${hm(P.tleAt)} <span>CelesTrak</span>`);
  const f = C.S.fetchedAt; if(f) parts.push(`<b>Previsão</b> ${hm(f)} <span>Open-Meteo</span>`);
  el.innerHTML = parts.map(p=>`<span class="sb-i">${p}</span>`).join("");
  el.scrollLeft = 0;
}
setInterval(footer, 60000);

/* ---------- página de satélite ---------- */
/* ---------- celular: painel recolhido atrás de um botão ☰ (folha inferior) ---------- */
const mobile = () => matchMedia("(max-width: 860px)").matches;
function sheet(open){
  document.body.classList.toggle("sp-open", !!open);
  const b = $("satFab"); if(b) b.setAttribute("aria-expanded", !!open);
}
(function fab(){
  const b = document.createElement("button");
  b.id = "satFab"; b.className = "satfab"; b.setAttribute("aria-label","Menu do satélite"); b.setAttribute("aria-controls","satpanel"); b.setAttribute("aria-expanded","false");
  b.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13"/></svg>`;
  b.onclick = ()=>sheet(!document.body.classList.contains("sp-open"));
  document.body.appendChild(b);
  // tocar no mapa recolhe a folha
  document.addEventListener("pointerdown", e=>{ if(mobile() && document.body.classList.contains("sp-open") && e.target.closest("#satbg")) sheet(false); }, true);
  addEventListener("hashchange", ()=>sheet(false));
})();
function noGLPanel(){
  const el = $("satpanel"); if(!el) return;
  el.innerHTML = `${window.modeSeg ? window.modeSeg("map") : ""}<div class="sp-h"><div><h3>Satélite indisponível</h3><p>Este navegador não liberou o WebGL (aceleração gráfica), que o globo 3D precisa.</p></div><button class="ibtn" id="satClose" aria-label="Fechar"><svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5 5 15"/></svg></button></div>
    <p class="sp-tip">Ative a aceleração por hardware nas configurações do navegador ou abra em outro aparelho. O restante do sistema (previsão, especialistas, laboratório) continua funcionando normalmente.</p>`;
  $("satClose").onclick = ()=>{ location.hash = "#home"; };
}
function panel(quick){
  if(P.noGL) return noGLPanel();
  const el = $("satpanel"); if(!el || !inSat()) return;
  const ov = P.overhead;
  if(quick){ const an = $("airN"); if(an) an.textContent = P.air ? P.planes.size : ""; const n = $("starN"); if(n) n.textContent = ov.n; const tt = $("starT"); if(tt) tt.textContent = (P.count||0).toLocaleString("pt-BR"); const l = $("starList"); if(l) l.innerHTML = starList(); return; }
  // barra de camadas: sempre visível sobre o mapa, acima da linha do tempo; detalhes no ⋯
  const chip = (id, label, on, extra="") => `<button type="button" class="chip" id="${id}" aria-pressed="${!!on}">${label}${extra}</button>`;
  const ib = (id, ic, title, extra="") => `<button type="button" class="lyr-b" id="${id}" title="${title}" aria-label="${title}"${extra}>${ic}</button>`;
  const seg = (attr, items, cur) => items.map(([k,n])=>`<button ${attr}="${k}" aria-pressed="${k===cur}">${n}</button>`).join("");
  const grp = (label, body, cls="") => `<div class="lg-g ${cls}"><span class="lg-l">${label}</span><div class="lg-b">${body}</div></div>`;
  el.innerHTML = `
    <div class="lyr-head">
      ${window.modeSeg ? window.modeSeg("map") : ""}
      <div class="lyr-title"><b>Camadas</b><small id="satTime"></small></div>
      ${P.fold ? `<div class="lyr-quick">${[["satNames","Aa","Nomes e ruas",P.names],["satAlt","▲","Altitude",P.alt],["satMt","⛰","Relevo fino (Mapterhorn: Copernicus GLO-30 e lidar)",P.mt],["satBld","▦","Prédios 3D",P.bld],["br3d","▤","Vias elevadas, viadutos e pontes 3D",window.Bridges?.isOn()],["ovRail","🚇","Transporte público",P.ovRail],["ovBike","🚲","Ciclovias",P.ovBike],["satAir","✈","Aeronaves",P.air],["satRadar","☔","Radar de chuva",P.showRadar],["fire","🔥","Queimadas: focos de calor das últimas 24 h (NASA FIRMS)",window.Fires?.isOn()],["satStar","✦","Starlink",P.showStar],["names2","🏷","Escolher nomes: cidades, bairros, ruas…",false],["places","📍","Lugares (pontos turísticos, templos…)",window.Places?.isOn()],["hgt","🏙","Altura das construções",P.hgt],["apt","🛫","Aeroportos (clique para o simulador de voo)",window.Sim?.isOn()],["cams","🎥","Câmeras ao vivo",window.Cams?.isOn()],["volc","🌋","Vulcões",window.Geo?.isOn("volc")],["temp","🏛","Templos antigos",window.Geo?.isOn("temp")],["traffic","🚦","Trânsito ao vivo (TomTom)",window.Rotas?.isTraffic()],["routes","🧭","Rotas e navegação",window.Rotas?.isOpen()],["drive","🚌","Dirigir / andar a pé: saídas nas rodoviárias",window.Drive?.isOn()],["tour","🚁","Drone (voo tour livre): decolar da sua localização ou de um ponto no mapa",false],["met","💨","Camadas do tempo: vento, chuva e trovoadas, temperatura, ondas, chuva acumulada (GFS)",window.Meteo?.isOn()]].map(([id,ic,t,on])=>`<button type="button" class="lq" data-q="${id}" aria-pressed="${!!on}" title="${t}" aria-label="${t}">${window.Ico?.(LQ_ICO[id], 20) || ic}</button>`).join("")}</div>` : ""}
      <div class="lyr-act">
        ${isClear() && P.proj!=="2d" ? ib("sat3d", P.map && P.map.getPitch()>5 ? "⬇" : "⛰", P.map && P.map.getPitch()>5 ? "Vista de cima" : "Inclinar em 3D") : ""}
        ${isClear() ? "" : ib("satAnim", P.anim ? "■" : "▶", P.anim ? "Parar animação" : "Animar últimas 2 h")}
        ${ib("satCenter", `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10" cy="10" r="5.5"/><circle cx="10" cy="10" r="1.8" fill="currentColor" stroke="none"/><path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3"/></svg>`, "Minha localização")}${ib("satGlobe", `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c2.2 2.3 2.2 12.7 0 15M10 2.5c-2.2 2.3-2.2 12.7 0 15"/></svg>`, "Ver o globo inteiro")}
        ${ib("mapMenu", "☰", "Funções do mapa (previsão do ponto, medir, endereço…)", ` aria-haspopup="menu"`)}
        ${ib("spMore", "ⓘ", "Fontes, Starlink e ajuda", ` aria-expanded="${!!P.more}"`)}
        ${ib("lyrFold", P.fold ? "▴" : "▾", P.fold ? "Mostrar camadas" : "Recolher camadas", ` aria-expanded="${!P.fold}"`)}
        <button class="ibtn sm lyr-x" id="satClose" aria-label="Fechar"><svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5 5 15"/></svg></button>
      </div>
    </div>
    <div class="lyr-body"${P.fold?" hidden":""}>
      <div class="lyr-row lyr-view">
        ${grp("Visualização", `<div class="seg txt">${seg("data-proj", [["globe","Globo 3D"],["2d","Mapa 2D"]], P.proj==="2d"?"2d":"globe")}</div>`)}
        ${grp("Imagem de satélite", `<div class="seg txt">${seg("data-p", Object.entries(PRODUCTS).map(([k,v])=>[k,v.nome]), P.prod)}</div>`, "lg-grow")}
      </div>
      <div class="lyr-row">
        ${grp("Mapa base", BASES().map(([k,n])=>`<button class="lb" data-base="${k}" aria-pressed="${curBase()===k}" title="${n}" aria-label="${n}">${baseThumb(k)}<span>${n}</span></button>`).join(""))}
        ${grp("Sobreposições", `${chip("satNames","Nomes e ruas",P.names)}${chip("satAlt","Altitude",P.alt)}${chip("satMt",`${window.Ico ? `<span class="ico-w ico-t">${window.Ico("finerelief", 18)}</span>` : ""}Relevo fino`,P.mt)}${chip("satBld","Prédios 3D",P.bld)}${chip("satBr","Vias elevadas 3D",window.Bridges?.isOn())}
          <button type="button" class="chip" id="nameT" title="Escolher quais nomes aparecem">🏷 Nomes: tipos…</button>${chip("satHgt","🏙 Altura das construções",P.hgt)}${chip("satPlaces","📍 Lugares",window.Places?.isOn())}<button type="button" class="chip" id="placesF" title="Escolher tipos de lugar">Tipos…</button>
          ${chip("ovRail","Transporte público",P.ovRail)}${chip("ovBike","Ciclovias",P.ovBike)}${chip("satTraffic","🚦 Trânsito ao vivo",window.Rotas?.isTraffic())}<button type="button" class="chip" id="satRoutes">🧭 Rotas</button>`, "lg-grow")}
        ${grp("Ao vivo", `${chip("satAir","Aeronaves",P.air,` <em class="sp-n" id="airN">${P.air?P.planes.size:""}</em>`)}${chip("satRadar","Radar de chuva",P.showRadar)}${chip("satFire","🔥 Queimadas",window.Fires?.isOn())}${chip("satStar","Starlink",P.showStar)}${chip("satBg","Fundo do site",P.bg)}`)}
      </div>
      ${P.air ? `<form class="fl-find" id="flFind"><input id="flQ" placeholder="Buscar voo em todo o mundo — ex.: GLO1670, TAM3302, AZU4558" autocomplete="off" aria-label="Buscar voo"><button class="mbtn">✈ Buscar</button><span id="flMsg"></span></form>` : ""}
      <div class="alt-leg" id="altLegend"${P.alt?"":" hidden"}><i></i><div><span>0</span><span>300</span><span>900</span><span>1.800</span><span>3.500 m</span></div></div>
    </div>
    <div class="lyr-more"${P.more?"":" hidden"}>
      <p class="sp-tip">Arraste para mover, role ou pince para aproximar; botão direito arrasta para inclinar e girar. Funções do ponto (previsão, medir, endereço, Street View) ficam no ☰. Clique nos nomes para demarcar a região e nos aviões para ver o voo.</p>
      ${P.showStar ? `<div class="sp-star"><div class="sp-k"><b id="starT">${(P.count||0).toLocaleString("pt-BR")}</b><small>Starlink em órbita</small></div><div class="sp-k"><b id="starN">${ov.n}</b><small>acima de 25° sobre ${esc((C.S.loc||{}).name||"você")}</small></div></div><div id="starList" class="sp-list">${starList()}</div>` : ""}
      <p class="sp-cred">Imagens NOAA GOES-19/18 e JMA Himawari-9 via NASA GIBS · mapa e relevo Esri · nomes OpenStreetMap/OpenFreeMap · transporte OpenRailwayMap · ciclovias CyclOSM · radar RainViewer · focos de calor NASA FIRMS (VIIRS 375 m) · relevo 3D AWS Terrain Tiles${P.mt ? " e Mapterhorn (Copernicus GLO-30 © DLR e.V. 2010–2014 e © Airbus Defence and Space GmbH 2014–2018, fornecido sob o COPERNICUS pela União Europeia e ESA; lidar nacionais)" : ""} · aeronaves adsb.lol (ODbL), adsbdb, trajetos OpenSky Network · órbitas CelesTrak · arranha-céus Wikidata (CC0) · globo MapLibre GL.</p>
    </div>`;
  stamp();
  $("satClose").onclick = ()=>{ if(mobile()) sheet(false); else location.hash = "#home"; };
  $("spMore").onclick = ()=>{ P.more = !P.more; el.querySelector(".lyr-more").hidden = !P.more; $("spMore").setAttribute("aria-expanded", P.more); };
  el.querySelectorAll("[data-p]").forEach(b=>b.onclick=()=>setProd(b.dataset.p));
  const ff = $("flFind"); if(ff) ff.onsubmit = async e=>{ e.preventDefault(); const m = $("flMsg"); m.textContent = "buscando…"; const ok = await findFlight($("flQ").value); m.textContent = ok ? "" : "voo não encontrado no ar agora"; };
  el.querySelectorAll("[data-base]").forEach(b=>b.onclick=()=>pickBase(b.dataset.base));
  el.querySelectorAll("[data-q]").forEach(b=>b.onclick=()=>{ const id = b.dataset.q;
    ({satNames:()=>setNames(!P.names), satAlt:()=>setAlt(!P.alt), satMt:()=>setMt(!P.mt), fire:()=>window.Fires?.setOn(!window.Fires.isOn()), satBld:()=>setBld(!P.bld), br3d:()=>window.Bridges?.setOn(!window.Bridges.isOn()), ovRail:()=>setOv("ovRail",!P.ovRail), ovBike:()=>setOv("ovBike",!P.ovBike),
      satAir:()=>setAir(!P.air), satRadar:()=>setRadar(!P.showRadar), satStar:()=>setStar(!P.showStar), places:()=>window.Places?.setOn(!window.Places.isOn()), names2:()=>nameTypes(), hgt:()=>setHgt(!P.hgt), apt:()=>window.Sim?.setOn(!window.Sim.isOn()), cams:()=>window.Cams?.setOn(!window.Cams.isOn()), volc:()=>window.Geo?.set("volc", !window.Geo.isOn("volc")), temp:()=>window.Geo?.set("temp", !window.Geo.isOn("temp")), traffic:()=>window.Rotas?.setTraffic(!window.Rotas.isTraffic()), routes:()=>window.Rotas?.isOpen() ? window.Rotas.close() : window.Rotas?.open(), drive:()=>window.Drive?.setOn(!window.Drive.isOn()), tour:()=>window.Drive?.tour(), met:()=>window.Meteo?.abrir()})[id](); panel(); });
  const _r = $("ovRail"); if(_r) $("ovRail").onclick = ()=>setOv("ovRail", !P.ovRail);
  if($("nameT")) $("nameT").onclick = nameTypes;
  if($("satHgt")) $("satHgt").onclick = ()=>setHgt(!P.hgt);
  if($("satBr")) $("satBr").onclick = ()=>{ window.Bridges?.setOn(!window.Bridges.isOn()); panel(); };
  if($("satTraffic")) $("satTraffic").onclick = ()=>{ window.Rotas?.setTraffic(!window.Rotas.isTraffic()); panel(); };
  if($("satRoutes")) $("satRoutes").onclick = ()=>window.Rotas?.open();
  if($("satPlaces")) $("satPlaces").onclick = ()=>{ window.Places?.setOn(!window.Places.isOn()); panel(); };
  if($("placesF")) $("placesF").onclick = ()=>window.Places?.openFilter();
  if($("ovBike")) $("ovBike").onclick = ()=>setOv("ovBike", !P.ovBike);
  $("lyrFold").onclick = ()=>{ P.fold = !P.fold; store.set("sat-fold", P.fold); panel(); };
  $("mapMenu").onclick = e=>{ const r = e.currentTarget.getBoundingClientRect(), c = P.map.getCenter(); window.Menu?.mapAt({lng:c.lng, lat:c.lat}, r.right - 300, r.top); };
  el.querySelectorAll("[data-proj]").forEach(b=>b.onclick=()=>setProj(b.dataset.proj));
  // mesmos controles no cabeçalho (computador): visualização e imagem de satélite ao lado de Rotas
  const hv = $("tbView");
  if(hv){
    // rótulo longo e curto: o cabeçalho mostra o curto quando falta espaço (a dica mostra o nome completo)
    const L2 = (l, s) => `<span class="tb-l">${l}</span><span class="tb-s">${s}</span>`;
    const SHORT = {geocolor:["Cor real","Real"], ir:["Infravermelho","IR"], airmass:["Massas de ar","Ar"], earth:["Planeta Água","Água"]};
    const sg = (attr, items, cur) => items.map(([k,l,s])=>`<button ${attr}="${k}" aria-pressed="${k===cur}" title="${l}">${L2(l, s)}</button>`).join("");
    hv.innerHTML = `<div class="tb-seg" role="group" aria-label="Visualização">${sg("data-proj", [["globe","Globo 3D","3D"],["2d","Mapa 2D","2D"]], P.proj==="2d"?"2d":"globe")}</div>
      <div class="tb-seg" role="group" aria-label="Imagem de satélite">${sg("data-p", Object.keys(PRODUCTS).map(k=>[k, ...(SHORT[k] || [PRODUCTS[k].nome, PRODUCTS[k].nome])]), window.Rotas?.isLook() ? "" : P.prod)}</div>`;
    hv.querySelectorAll("[data-proj]").forEach(b=>b.onclick=()=>{ if(!inSat()) location.hash = "#sat"; setProj(b.dataset.proj); });
    hv.querySelectorAll("[data-p]").forEach(b=>b.onclick=()=>{ if(window.Rotas?.isLook()) window.Rotas.setLook(false); setProd(b.dataset.p); });
    hv.insertAdjacentHTML("beforeend", `<button type="button" class="tb-tg" id="tbLook" aria-pressed="${!!window.Rotas?.isLook()}" title="Mapa vetorial 3D no estilo da navegação, no mundo todo">${window.Ico?.("map", 16) || ""}<span class="tb-l">Estilo rota</span><span class="tb-s">Rota</span></button>`);
    $("tbLook").onclick = ()=>{ if(!inSat()) location.hash = "#sat"; window.Rotas?.setLook(!window.Rotas.isLook()); panel(); };
  }
  const an = $("satAnim"); if(an) an.onclick = playAnim;
  const b3 = $("sat3d"); if(b3) b3.onclick = toggle3d;
  // "Local": voa até o local no zoom máximo da camada atual (18 no Planeta Água, 10 nas camadas de satélite)
  $("satCenter").onclick = myLocation;
  $("satGlobe").onclick = globe;
  if($("satNames")) $("satNames").onclick = ()=>setNames(!P.names);
  if($("satAlt")) $("satAlt").onclick = ()=>setAlt(!P.alt);
  if($("satMt")){ $("satMt").title = "Relevo 3D mais detalhado: Copernicus GLO-30 e lidar nacionais (Mapterhorn)"; $("satMt").onclick = ()=>setMt(!P.mt); }
  if($("satBld")) $("satBld").onclick = ()=>setBld(!P.bld);
  if($("satAir")) $("satAir").onclick = ()=>setAir(!P.air);
  if($("satRadar")) $("satRadar").onclick = ()=>setRadar(!P.showRadar);
  if($("satFire")){ $("satFire").title = "Focos de calor das últimas 24 h (NASA FIRMS, VIIRS 375 m)"; $("satFire").onclick = ()=>{ window.Fires?.setOn(!window.Fires.isOn()); panel(); }; }
  if($("satStar")) $("satStar").onclick = ()=>setStar(!P.showStar);
  if($("satBg")) $("satBg").onclick = ()=>setBg(!P.bg);
}
const card = a => ["N","NE","L","SE","S","SO","O","NO"][Math.round(((a%360)+360)%360/45)%8];
const starList = () => P.overhead.list.length ? P.overhead.list.map(s=>`<div><b>${esc(s.name)}</b><span>${r0(s.el)}° de elevação · ${card(s.az)} · ${r0(s.h)} km</span></div>`).join("") : `<small>Nenhum acima de 25° neste instante.</small>`;

// o globo da barra alterna Widgets ⇄ Mapa e mostra o estado
document.getElementById("satBtn")?.addEventListener("click", e=>{ e.preventDefault(); location.hash = inSat() ? "#home" : "#sat"; });
// desktop: o painel do satélite mora na coluna esquerda, abaixo da navegação; celular: folha inferior
// desktop: painel de camadas e linha do tempo empilhados numa coluna só, presa à base do mapa
function dock(){
  const el = $("satpanel"), tl = $("tline"); if(!el) return;
  let dk = $("mapdock"); if(!dk){ dk = document.createElement("div"); dk.id = "mapdock"; document.body.appendChild(dk); }
  if(!mobile()){ if(el.parentElement !== dk) dk.appendChild(el); if(tl && tl.parentElement !== dk) dk.appendChild(tl); }
  else { if(el.parentElement !== document.body) document.body.appendChild(el); if(tl && tl.parentElement !== document.body) document.body.appendChild(tl); }
}
function route(){
  dock();
  document.getElementById("satBtn")?.setAttribute("aria-pressed", document.body.dataset.view === "sat");
  if(!P.map) init();
  if(!P.map){ if(inSat()) noGLPanel(); return; }
  const on = inSat();
  setInteractive(on);
  try{ P.map.setPixelRatio(on ? Math.min(2, devicePixelRatio||1) : 1); }catch(e){}
  P.map.resize(); applyMode();
  if(P.proj==="2d"){ P.map.dragRotate.disable(); P.map.touchZoomRotate.disableRotation(); P.map.setMaxPitch(0); }
  if(on){ panel(); if(!P.visited){ P.visited = true; setTimeout(globe, 300); } }
  else { stopAnim(); bgCity(); }
  tick();
}
addEventListener("hashchange", route);
// a página carrega antes da previsão: o mapa nasce já, e recentra quando chega o local
if(document.readyState !== "loading") init(); else addEventListener("DOMContentLoaded", init);
setTimeout(route, 0);

window.Sat = {BLD_ALL, applyMode: () => applyMode(), setBase, base: () => P.base, thumb: k => thumb(k), nameTypes, panelRefresh: () => panel(), povStart, povStop, selectPlane, findFlight, setProj, planeCard, _planes: () => P.planes, setAir, isAir: () => P.air, setStar, setFrame, latest: () => P.times && Date.parse(P.times[2]), setNames, isNames: () => P.names, footer, map: () => P.map, resize: () => P.map?.resize(), elevAt, fmtAlt, setAlt, isAlt: () => P.alt, setMt, isMt: () => P.mt, setBld, isBld: () => P.bld, measureStart, measureEnd, setProd, isClear, setLoc, overhead: () => P.overhead, count: () => P.count||0, time: () => P.time, enabled: () => P.showStar};
})();
