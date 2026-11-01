/* =============================================================================
   TELHADOS E MONUMENTOS 3D — formas reais do OpenStreetMap (via Overture):
   pirâmides (Gizé, Louvre…), cúpulas, cebolas (igrejas ortodoxas), telhados de
   duas águas, de quatro águas, mansarda e taludes inclinados (Teotihuacan,
   Chichén Itzá). O Overture traz roof_shape + roof_height de cada prédio; o
   MapLibre só sabe extrudar paredes retas, então cada telhado vira uma pilha de
   fatias finas que encolhem segundo a forma (como as fiadas de pedra das
   pirâmides). As paredes do prédio sobem só até height − roof_height (sat.js).
   ============================================================================= */
(() => {
"use strict";
const SHAPES = ["pyramidal","dome","spherical","onion","gabled","hipped","half_hipped","mansard","gambrel","skillion","round","saltbox"];
const MIN_RH = 1.5, MAX_FEATS = 45000;
const R = {feats:new Map(), busy:false};
const fc = f => ({type:"FeatureCollection", features:f});

// perfil de cada forma: quanto do "meio-vão" sobra na altura relativa t (0 = beiral, 1 = cumeeira)
const PROF = {
  pyramidal: t => 1 - t,
  dome: t => Math.sqrt(Math.max(0, 1 - t*t)), spherical: t => Math.sqrt(Math.max(0, 1 - t*t)),
  onion: t => t < .35 ? 1 + .28*Math.sin(t/.35*Math.PI/2) : 1.28*Math.cos((t - .35)/.65*Math.PI/2),
  gabled: t => 1 - t, hipped: t => 1 - t, half_hipped: t => 1 - t, saltbox: t => 1 - t,
  round: t => Math.sqrt(Math.max(0, 1 - t*t)),
  mansard: t => t < .7 ? 1 - .25*t/.7 : .75*(1 - (t - .7)/.3),
  gambrel: t => t < .55 ? 1 - .45*t/.55 : .55*(1 - (t - .55)/.45)
};
// recorta o polígono pelo semiplano a·p ≤ c (Sutherland–Hodgman)
function clip(P, ax, ay, c){
  const out = [];
  for(let i = 0; i < P.length; i++){ const A = P[i], B = P[(i + 1) % P.length], da = ax*A[0] + ay*A[1] - c, db = ax*B[0] + ay*B[1] - c;
    if(da <= 0) out.push(A);
    if((da < 0) !== (db < 0) && da !== db){ const k = da/(da - db); out.push([A[0] + (B[0] - A[0])*k, A[1] + (B[1] - A[1])*k]); } }
  return out;
}
// eixo principal da planta (comprimento × largura), para cumeeira de duas/quatro águas
function axes(P){
  let sxx = 0, syy = 0, sxy = 0; for(const [x, y] of P){ sxx += x*x; syy += y*y; sxy += x*y; }
  const a = .5*Math.atan2(2*sxy, sxx - syy), ux = Math.cos(a), uy = Math.sin(a);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for(const [x, y] of P){ const u = x*ux + y*uy, v = -x*uy + y*ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  return {ux, uy, uc:(u0 + u1)/2, vc:(v0 + v1)/2, L:(u1 - u0)/2, W:(v1 - v0)/2};
}
const LIMESTONE = "#D9C7A0", PYR = /pyram|piram|pirâm|هرم/i;
// área da planta em m² (anel externo)
function area(g){ const ring = g.type === "Polygon" ? g.coordinates[0] : g.type === "MultiPolygon" ? g.coordinates[0][0] : null; if(!ring) return 0;
  const la = ring[0][1]*Math.PI/180, kx = 111320*Math.cos(la), ky = 110574; let s = 0;
  for(let i = 0; i < ring.length - 1; i++) s += (ring[i][0]*kx)*(ring[i+1][1]*ky) - (ring[i+1][0]*kx)*(ring[i][1]*ky);
  return Math.abs(s)/2; }
function color(p, shape, rh, whole){
  if(shape === "pyramidal" && rh >= 25 && whole) return LIMESTONE;                 // pirâmides de pedra: calcário, não a cor "de etiqueta" do OSM
  if(p.roof_color && /^#?[0-9a-f]{3,8}$/i.test(String(p.roof_color).trim())) return String(p.roof_color).trim().replace(/^(?!#)/, "#");
  if(p.roof_color) return String(p.roof_color);
  return {dome:"#8FA0A0", spherical:"#8FA0A0", onion:"#C9A54A", pyramidal:"#7D7F86", skillion:"#B9A07A"}[shape] || "#80828A";
}
// fatias de um telhado: [{ring:[[lon,lat]...], b, t}]
function slices(f){
  const p = f.properties, shape = p.roof_shape, rh = +p.roof_height, h = +p.height, g = f.geometry;
  const ring = g.type === "Polygon" ? g.coordinates[0] : g.type === "MultiPolygon" ? g.coordinates[0][0] : null;
  if(!ring || ring.length < 4) return [];
  // coordenadas locais em metros em volta do centro
  let lo = 0, la = 0; const n0 = ring.length - 1; for(let i = 0; i < n0; i++){ lo += ring[i][0]; la += ring[i][1]; } lo /= n0; la /= n0;
  const kx = 111320*Math.cos(la*Math.PI/180), ky = 110574, P = ring.slice(0, n0).map(([x, y]) => [(x - lo)*kx, (y - la)*ky]);
  const base = Math.max(0, h - rh), n = Math.max(3, Math.min(36, Math.ceil(rh/Math.max(.5, rh/36)))), out = [];
  const prof = PROF[shape] || PROF.pyramidal, A = (shape === "gabled" || shape === "hipped" || shape === "half_hipped" || shape === "mansard" || shape === "gambrel" || shape === "round" || shape === "saltbox") ? axes(P) : null;
  if(A && p.roof_orientation === "across"){ const t = A.L; A.L = A.W; A.W = t; const ux = A.ux; A.ux = -A.uy; A.uy = ux; const c = A.uc; A.uc = A.vc; A.vc = -c; }
  for(let k = 0; k < n; k++){
    const t = (k + .5)/n; let Q;
    if(shape === "skillion"){
      // talude: a cada fatia some uma faixa do lado baixo (roof_direction = para onde a água escorre)
      let dx, dy; if(p.roof_direction != null && isFinite(+p.roof_direction)){ const d = +p.roof_direction*Math.PI/180; dx = Math.sin(d); dy = Math.cos(d); }
      else { const a = axes(P); dx = -a.uy; dy = a.ux; }
      let s0 = Infinity, s1 = -Infinity; for(const [x, y] of P){ const s = x*dx + y*dy; s0 = Math.min(s0, s); s1 = Math.max(s1, s); }
      Q = clip(P, dx, dy, s1 - t*(s1 - s0));
    } else if(A){
      // duas águas: só a largura encolhe (oitões retos); quatro águas/mansarda: as pontas também recuam
      const f = Math.max(0, prof(t)), hip = shape !== "gabled" && shape !== "gambrel" && shape !== "round" && shape !== "saltbox";
      const Lk = hip ? Math.max(.01, A.L - A.W*(1 - f)) : A.L;
      Q = P.map(([x, y]) => { const u = x*A.ux + y*A.uy - A.uc, v = -x*A.uy + y*A.ux - A.vc;
        const u2 = A.uc + Math.max(-Lk, Math.min(Lk, u)), v2 = A.vc + v*f; return [u2*A.ux - v2*A.uy, u2*A.uy + v2*A.ux]; });
    } else {
      const s = Math.max(0, prof(t)); Q = P.map(([x, y]) => [x*s, y*s]);
    }
    if(Q.length < 3) continue;
    const r = Q.map(([x, y]) => [lo + x/kx, la + y/ky]); r.push(r[0]);
    out.push({ring:r, b:base + rh*k/n, t:base + rh*(k + 1)/n});
  }
  return out;
}
function layer(m){
  const data = fc([...R.feats.values()].flat());
  if(!m.getSource("rf3d")){
    m.addSource("rf3d", {type:"geojson", data, maxzoom:15, buffer:64, attribution:"Telhados e monumentos: OpenStreetMap via Overture Maps"});
    m.addLayer({id:"rf3d", type:"fill-extrusion", source:"rf3d", minzoom:12, paint:{"fill-extrusion-color":["get","c"], "fill-extrusion-height":["get","t"],
      "fill-extrusion-base":["get","b"], "fill-extrusion-opacity":.98, "fill-extrusion-vertical-gradient":false}}, m.getLayer("cristo") ? "cristo" : undefined);
    window.Sat?.BLD_ALL?.includes("rf3d") || window.Sat?.BLD_ALL?.push("rf3d");
    window.Sat?.applyMode?.();
  } else m.getSource("rf3d").setData(data);
}
async function apply(){
  const m = window.Sat?.map(); if(!m || R.busy || m.getZoom() < 12 || !window.Sat.isBld?.() || !m.getSource("ovb")) return;
  R.busy = true;
  try{
    let novo = 0;
    for(const sl of ["building","building_part"]) for(const f of m.querySourceFeatures("ovb", {sourceLayer:sl})){
      let p = f.properties; const id = f.id ?? p.id;
      if(id == null || R.feats.has(id) || p.is_underground === true || (sl === "building" && p.has_parts === true)) continue;
      // pirâmide sem altura no OSM (ex.: as pirâmides das rainhas em Gizé): altura pela base, inclinação clássica de ~52°
      if(p.roof_shape === "pyramidal" && !(+p.height > 0) && PYR.test(String(p.names || p["@name"] || ""))){
        const hh = Math.round(.636*Math.sqrt(area(f.geometry))*10)/10; if(hh > 2) p = {...p, height:hh, roof_height:hh}; }
      if(!SHAPES.includes(p.roof_shape) || !(+p.roof_height >= MIN_RH) || !(+p.height > 0)) continue;
      const rh = Math.min(+p.roof_height, +p.height), whole = rh >= .9*p.height, c = color(p, p.roof_shape, rh, whole);
      R.feats.set(id, slices({properties:{...p, roof_height:rh}, geometry:f.geometry}).map(s => ({type:"Feature", properties:{b:s.b, t:s.t, c}, geometry:{type:"Polygon", coordinates:[s.ring]}})));
      novo++;
    }
    // memória: fica só o que está perto da tela
    if(R.feats.size && [...R.feats.values()].reduce((a, v) => a + v.length, 0) > MAX_FEATS){ const b = m.getBounds(), pad = .02;
      for(const [id, L] of R.feats){ const c = L[0]?.geometry.coordinates[0][0]; if(!c || c[0] < b.getWest()-pad || c[0] > b.getEast()+pad || c[1] < b.getSouth()-pad || c[1] > b.getNorth()+pad) R.feats.delete(id); } }
    if(novo || !m.getSource("rf3d")) layer(m);
  } finally { R.busy = false; }
}
const iv = setInterval(() => { const m = window.Sat?.map(); if(!m || !m.getStyle()) return; clearInterval(iv);
  // telhados aparecem junto com os prédios: aplica quando chegam tiles de prédios (e no idle, para garantir)
  let t = 0; const go = () => { clearTimeout(t); t = setTimeout(apply, 250); };
  m.on("idle", go); m.on("sourcedata", e => { if(e.sourceId === "ovb" && e.tile) go(); }); }, 1000);
window.Roofs = {apply, SHAPES, MIN_RH, stats:() => ({prédios:R.feats.size, fatias:[...R.feats.values()].reduce((a, v) => a + v.length, 0)})};
})();
