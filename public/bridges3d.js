/* =============================================================================
   ESTRADAS 3D — pontes, viadutos, elevados e alças de trevos como UMA malha contínua.
   Camada WebGL própria (custom layer do MapLibre): cada ponto da via tem a sua altura,
   então rampas ficam inclinadas de verdade, curvas ficam lisas e não há degraus.
   · Dados: vias brunnel=bridge do OpenStreetMap (OpenFreeMap), com o nível "layer".
   · Perfil em altitude absoluta: reta entre as cabeceiras + nível (≈ 6,2 m por nível);
     cabeceira real (encontra via no chão) desce em rampa; vias de ponte ligadas entre si
     continuam no alto (sem rampa falsa no meio do viaduto).
   · Malha: pista (cor da via, faixa central tracejada), laterais e fundo em concreto,
     guarda-corpos e pilares até o chão. Rota e trânsito desenhados colados na pista.
   window.Bridges.setOverlay(nome, [{coords, color, w, off}]) — faixas sobre os tabuleiros.
   ============================================================================= */
(() => {
"use strict";
const D2R = Math.PI/180, LEVEL = 6.2, DECK = 1.0, RAMP = 70, PIER = 35, ZMIN = 15, RAIL = 1.0, STEP = 4;
const WIDTH = {motorway:20, trunk:17, primary:14, secondary:12, tertiary:10, minor:8, service:6, track:4, path:3.5, rail:7, transit:7};
const LANE = new Set(["motorway","trunk","primary","secondary"]);
// padrão: ligado; em aparelho fraco começa desligado (o usuário liga no botão de ponte)
let on = (() => { try{ const v = localStorage.getItem("br3d-on"); if(v != null) return v !== "0"; }catch(e){}
  return !((navigator.deviceMemory && navigator.deviceMemory <= 4) || (matchMedia("(pointer: coarse)").matches && (navigator.hardwareConcurrency || 4) <= 6)); })();
let roadCol = [.62,.65,.70], grid = new Map(), overlays = {}, mesh = null, dirty = false, ver = 0, origin = [0, 0], geo = [];
const cache = new Map();   // via já calculada → geometria (reaproveitada ao mover o mapa)
const hex = h => { const v = parseInt(h.slice(1), 16); return [(v >> 16 & 255)/255, (v >> 8 & 255)/255, (v & 255)/255]; };
const CONC = [.66,.68,.71], CONC_D = [.52,.54,.58], RAILC = [.88,.89,.91], LINE = [.95,.95,.92];
const key = (lon, lat) => `${Math.round(lon*2000)}:${Math.round(lat*2000)}`;
// Web Mercator em double (o MapLibre desenha em [0,1]); altura em metros → unidades de Mercator
const mx = lon => (lon + 180)/360, my = lat => (1 - Math.log(Math.tan(Math.PI/4 + lat*D2R/2))/Math.PI)/2;
const mz = (m, lat) => m / (40075016.686 * Math.cos(lat*D2R));

/* ---------- geração de malha ---------- */
// V: números; cada vértice = x, y (Mercator absoluto), z (Mercator), nx, ny, nz, r, g, b
function tri(V, a, b, c, n, col){ for(const p of [a, b, c]) V.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2]); }
function quad(V, a, b, c, d, n, col){ tri(V, a, b, c, n, col); tri(V, a, c, d, n, col); }
// direção lateral (perpendicular) em cada ponto, média dos dois segmentos vizinhos: juntas lisas nas curvas
function sides(pts){ const n = pts.length, S = [];
  for(let i=0;i<n;i++){ const a = pts[Math.max(0, i-1)], b = pts[Math.min(n-1, i+1)], kx = 111320*Math.cos(pts[i][1]*D2R);
    const dx = (b[0]-a[0])*kx, dy = (b[1]-a[1])*110574, L = Math.hypot(dx, dy) || 1; S.push([-dy/L, dx/L, kx]); }
  return S; }
// faixa ao longo de pontos com altura própria em cada ponto (metros), meia-largura w, deslocamento lateral off
function ribbon(V, pts, zAt, w, off, col, lift = 0){
  const n = pts.length; if(n < 2) return; const S = sides(pts);
  const P = (i, s) => { const [nx, ny, kx] = S[i], lon = pts[i][0] + nx*(off + s)/kx, lat = pts[i][1] + ny*(off + s)/110574; return [mx(lon), my(lat), mz(zAt(i) + lift, lat)]; };
  for(let i=1;i<n;i++) quad(V, P(i-1, -w), P(i, -w), P(i, w), P(i-1, w), [0,0,1], col);
}
function buildLine(p, pts, top, w, ground, dupe){
  const V = [], G = [], n = pts.length, cum = [0];
  for(let i=1;i<n;i++) cum.push(cum[i-1] + Math.hypot((pts[i][0]-pts[i-1][0])*111320*Math.cos(pts[i][1]*D2R), (pts[i][1]-pts[i-1][1])*110574));
  const L = cum[n-1], e0 = ground[0], e1 = ground[n-1];
  const Z = cum.map((d, i) => Math.max(e0 + (e1 - e0)*d/(L || 1) + top*Math.min(1, p.r0 ? d/RAMP : 1, p.r1 ? (L-d)/RAMP : 1), ground[i] + .4));
  // trechos já desenhados por outra cópia (tiles vizinhos repetem a borda) ficam de fora
  const keep = []; for(let i=1;i<n;i++){ const k = `${p.class}|${Math.round((pts[i][0]+pts[i-1][0])*5e4)}|${Math.round((pts[i][1]+pts[i-1][1])*5e4)}`; keep.push(!dupe.has(k)); if(keep[i-1]) dupe.add(k); }
  const runs = []; let s = null; for(let i=1;i<n;i++){ if(keep[i-1]){ if(s === null) s = i-1; } else if(s !== null){ runs.push([s, i-1]); s = null; } } if(s !== null) runs.push([s, n-1]);
  for(const [a, b] of runs){
    const P = pts.slice(a, b+1), z = i => Z[a+i], zb = i => Z[a+i] - DECK, S = sides(P);
    ribbon(V, P, z, w, 0, roadCol);                                                    // pista
    const E = (i, sg, zz) => { const [nx, ny, kx] = S[i], lon = P[i][0] + nx*sg*w/kx, lat = P[i][1] + ny*sg*w/110574; return [mx(lon), my(lat), mz(zz, lat)]; };
    for(let i=1;i<P.length;i++) for(const sg of [-1, 1]){ const nn = [S[i][0]*sg, -S[i][1]*sg, 0];
      quad(V, E(i-1, sg, zb(i-1)), E(i, sg, zb(i)), E(i, sg, z(i)), E(i-1, sg, z(i-1)), nn, CONC);       // lateral
      if(Z[a+i] - ground[a+i] > 1.6) quad(V, E(i-1, sg, z(i-1)), E(i, sg, z(i)), E(i, sg, z(i) + RAIL), E(i-1, sg, z(i-1) + RAIL), nn, RAILC); }   // guarda-corpo
    ribbon(V, P, zb, w, 0, CONC_D);                                                    // fundo
    if(LANE.has(p.class)) for(let i=1;i<P.length;i+=3) ribbon(V, P.slice(i-1, Math.min(P.length, i+1)), j => Z[a+i-1+j], .12, 0, LINE, .03);   // faixa tracejada
  }
  // pilares a cada ~35 m onde a pista está alta
  let next = PIER/2;
  for(let i=0;i<n;i++){ if(cum[i] < next) continue; next += PIER; if(Z[i] - DECK - ground[i] < 2.5) continue;
    const c = pts[i], s2 = Math.min(1.1, w*.18), kx = 111320*Math.cos(c[1]*D2R), dx = s2/kx, dy = s2/110574, zb = Z[i] - DECK, zg = ground[i];
    const B = (ox, oy, zz) => [mx(c[0] + ox*dx), my(c[1] + oy*dy), mz(zz, c[1])];
    for(const [ax, ay, bx, by, nn] of [[-1,-1,1,-1,[0,1,0]],[1,-1,1,1,[1,0,0]],[1,1,-1,1,[0,-1,0]],[-1,1,-1,-1,[-1,0,0]]]) quad(V, B(ax,ay,zg), B(bx,by,zg), B(bx,by,zb), B(ax,ay,zb), nn, CONC_D); }
  for(let i=0;i<n;i++) G.push([pts[i][0], pts[i][1], Z[i], ground[i], w]);
  return {V, G};
}

/* ---------- leitura das vias e montagem ---------- */
const onEdge = q => { const n = 2**14, fx = (q[0]+180)/360*n, fy = (1 - Math.asinh(Math.tan(q[1]*D2R))/Math.PI)/2*n; const e = v => Math.abs(v - Math.round(v)) < .0015; return e(fx) || e(fy); };
let last = "";
function build(){
  const m = window.Sat?.map(); if(!m || !m.getStyle() || !install(m)) return;
  if(m.getZoom() < ZMIN || !on){ if(last !== "off"){ mesh = null; geo = []; grid = new Map(); dirty = true; last = "off"; m.triggerRepaint(); dispatchEvent(new Event("bridges3d")); } return; }
  const b = m.getBounds(), view = [b.getWest()-.01, b.getSouth()-.01, b.getEast()+.01, b.getNorth()+.01];
  const raw = m.querySourceFeatures("omt", {sourceLayer:"transportation", filter:["==",["get","brunnel"],"bridge"]});
  const terr = !!m.getTerrain(), el = q => { if(!terr) return 0; try{ return m.queryTerrainElevation({lng:q[0], lat:q[1]}) || 0; }catch(e){ return 0; } };
  // pontas de vias de ponte: as que tocam outra via de ponte continuam no alto (sem rampa no meio do viaduto)
  const lines = [], ends = new Map(), ek = q => `${q[0].toFixed(6)},${q[1].toFixed(6)}`;
  for(const f of raw){ const ls = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [];
    for(const ln of ls) if(ln.length > 1){ lines.push([f.properties, ln]); for(const q of [ln[0], ln[ln.length-1]]) ends.set(ek(q), (ends.get(ek(q)) || 0) + 1); } }
  const parts = [], g = new Map(), dupe = new Set(), seen = new Set();
  for(const [p, ln] of lines){
    const sig = `${p.class}|${p.layer}|${ek(ln[0])}|${ek(ln[ln.length-1])}|${ln.length}|${terr ? 1 : 0}`; if(seen.has(sig)) continue; seen.add(sig);
    if(!ln.some(c => c[0] > view[0] && c[0] < view[2] && c[1] > view[1] && c[1] < view[3])) continue;
    let res = cache.get(sig);
    if(!res){
      const lv = Math.max(1, Math.min(5, +p.layer || 1)), w = (WIDTH[p.class] || 8)/2, top = lv*LEVEL;
      const pts = [ln[0]];
      for(let i=1;i<ln.length;i++){ const a = ln[i-1], c = ln[i], d = Math.hypot((c[0]-a[0])*111320*Math.cos(a[1]*D2R), (c[1]-a[1])*110574), k = Math.max(1, Math.ceil(d/STEP));
        for(let j=1;j<=k;j++) pts.push([a[0]+(c[0]-a[0])*j/k, a[1]+(c[1]-a[1])*j/k]); }
      // chão a cada ~10 m, interpolado
      const ground = new Float64Array(pts.length); for(let i=0;i<pts.length;i+=5) ground[i] = el(pts[i]); ground[pts.length-1] = el(pts[pts.length-1]);
      for(let i=0;i<pts.length;i++) if(i % 5 && i !== pts.length-1){ const a0 = i - i%5, a1 = Math.min(pts.length-1, a0+5); ground[i] = ground[a0] + (ground[a1]-ground[a0])*(i-a0)/(a1-a0); }
      const real = q => !onEdge(q) && (ends.get(ek(q)) || 0) < 2;
      res = buildLine({class:p.class, r0:real(ln[0]), r1:real(ln[ln.length-1])}, pts, top, w, ground, dupe);
      cache.set(sig, res); if(cache.size > 3000) cache.delete(cache.keys().next().value);
    }
    parts.push(res.V); for(const q of res.G){ const gk = key(q[0], q[1]); if(!g.has(gk)) g.set(gk, []); g.get(gk).push(q); }
  }
  grid = g; geo = parts; last = "on"; ver++; assemble(m);
  dispatchEvent(new Event("bridges3d"));
}
// tabuleiros + faixas (rota/trânsito) num só buffer, relativo a uma origem perto da tela (precisão float32)
function assemble(m){
  const c = m.getCenter(); origin = [mx(c.lng), my(c.lat)];
  const extra = []; for(const list of Object.values(overlays)) for(const o of list) overlayGeo(extra, o);
  let n = extra.length; for(const V of geo) n += V.length;
  const out = new Float32Array(n); let k = 0;
  const put = V => { for(let i=0;i<V.length;i+=9){ out[k++] = V[i] - origin[0]; out[k++] = V[i+1] - origin[1]; for(let j=2;j<9;j++) out[k++] = V[i+j]; } };
  for(const V of geo) put(V); put(extra);
  mesh = out; dirty = true; m.triggerRepaint();
}
// faixa colada na pista: só onde há tabuleiro, na altura dele em cada ponto (contínua)
function overlayGeo(V, o){
  const pts = o.coords, w = o.w || 1, off = o.off || 0, col = hex(o.color || "#4FC3F7"), dens = [];
  for(let i=1;i<pts.length;i++){ const a = pts[i-1], b = pts[i], d = Math.hypot((b[0]-a[0])*111320*Math.cos(a[1]*D2R), (b[1]-a[1])*110574), k = Math.max(1, Math.ceil(d/3));
    for(let j=(i === 1 ? 0 : 1);j<=k;j++) dens.push([a[0]+(b[0]-a[0])*j/k, a[1]+(b[1]-a[1])*j/k]); }
  // altura em cada ponto; buracos curtos (≤ 4 pontos ≈ 12 m, juntas e cabeceiras) são preenchidos por interpolação
  const Z = dens.map(q => absAt(q[0], q[1]));
  for(let i=0;i<Z.length;i++){ if(Z[i] != null) continue; let j = i; while(j < Z.length && Z[j] == null) j++;
    if(i > 0 && j < Z.length && j - i <= 4) for(let k=i;k<j;k++) Z[k] = Z[i-1] + (Z[j] - Z[i-1])*(k - i + 1)/(j - i + 1); i = j; }
  // trechos curtos (< 30 m) são vias no chão passando POR BAIXO de um viaduto: não sobem; salto > 1,5 m entre
  // pontos vizinhos = trocou de tabuleiro num cruzamento de níveis: corta ali (sem zigue-zague)
  let run = [], zs = [];
  const flush = () => { if(run.length >= 10) ribbon(V, run, i => zs[i], w, off, col, .35); run = []; zs = []; };
  dens.forEach((q, i) => { if(Z[i] == null || (zs.length && Math.abs(Z[i] - zs[zs.length-1]) > 1.5)){ flush(); if(Z[i] == null) return; } run.push(q); zs.push(Z[i]); });
  flush();
}
// ponto de pista mais próximo (dentro da meia-largura + 2 m) que está de fato elevado
function near(lon, lat){
  let best = null, bd = 1e9; const kx = 111320*Math.cos(lat*D2R);
  for(let a=-1;a<=1;a++) for(let b=-1;b<=1;b++){ const L = grid.get(`${Math.round(lon*2000)+a}:${Math.round(lat*2000)+b}`); if(!L) continue;
    for(const q of L){ const d = Math.hypot((q[0]-lon)*kx, (q[1]-lat)*110574); if(d <= q[4] + 2 && d < bd){ bd = d; best = q; } } }
  return best && best[2] - best[3] > .3 ? best : null;
}
const absAt = (lon, lat) => { const q = near(lon, lat); return q ? q[2] : null; };
const topAt = (lon, lat) => { const q = near(lon, lat); return q ? q[2] - q[3] : 0; };

/* ---------- camada WebGL ---------- */
const VS = `attribute vec3 a_pos; attribute vec3 a_nor; attribute vec3 a_col; uniform mat4 u_m; varying vec3 v_col;
void main(){ vec3 L = normalize(vec3(-.35, .55, .75)); float d = abs(dot(normalize(a_nor), L)); v_col = a_col * (.62 + .45*d); gl_Position = u_m * vec4(a_pos, 1.); }`;
const FS = `precision mediump float; varying vec3 v_col; void main(){ gl_FragColor = vec4(v_col, 1.); }`;
const layer = {id:"br3d-gl", type:"custom", renderingMode:"3d",
  onAdd(map, gl){
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    this.p = gl.createProgram(); gl.attachShader(this.p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(this.p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(this.p);
    this.buf = gl.createBuffer(); this.n = 0; dirty = true;
    this.loc = {pos:gl.getAttribLocation(this.p, "a_pos"), nor:gl.getAttribLocation(this.p, "a_nor"), col:gl.getAttribLocation(this.p, "a_col"), m:gl.getUniformLocation(this.p, "u_m")};
  },
  render(gl, args){
    if(!on || !mesh) return;
    const M = args?.defaultProjectionData?.mainMatrix || args?.modelViewProjectionMatrix || args; if(!M || M.length !== 16) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    if(dirty){ gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.DYNAMIC_DRAW); this.n = mesh.length / 9; dirty = false; }
    if(!this.n) return;
    // matriz × translação da origem (os vértices são relativos a ela)
    const T = new Float32Array(16); for(let i=0;i<16;i++) T[i] = M[i];
    for(let r=0;r<4;r++) T[12+r] = M[r]*origin[0] + M[4+r]*origin[1] + M[12+r];
    gl.useProgram(this.p); gl.uniformMatrix4fv(this.loc.m, false, T);
    gl.enableVertexAttribArray(this.loc.pos); gl.vertexAttribPointer(this.loc.pos, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(this.loc.nor); gl.vertexAttribPointer(this.loc.nor, 3, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(this.loc.col); gl.vertexAttribPointer(this.loc.col, 3, gl.FLOAT, false, 36, 24);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, this.n);
    gl.disableVertexAttribArray(this.loc.pos); gl.disableVertexAttribArray(this.loc.nor); gl.disableVertexAttribArray(this.loc.col);
  }};
function install(m){
  if(m.getLayer("br3d-gl")) return true;
  if(!m.getSource("omt")) return false;
  // camada invisível que garante o carregamento dos tiles de vias perto
  if(!m.getLayer("br-src")) m.addLayer({id:"br-src", type:"line", source:"omt", "source-layer":"transportation", minzoom:ZMIN, filter:["==",["get","brunnel"],"bridge"], paint:{"line-opacity":0, "line-width":1}});
  const before = m.getStyle().layers.find(l => l.type === "symbol")?.id;
  try{ m.addLayer(layer, before); }catch(e){ return false; }
  return true;
}
let t = 0, lastIdle = ""; const later = () => { clearTimeout(t); t = setTimeout(build, 300); };
(function wait(){ const m = window.Sat?.map(); if(!m || !m.getStyle()){ setTimeout(wait, 800); return; }
  m.on("moveend", later);
  m.on("idle", () => { const k = `${m.getZoom().toFixed(1)}|${m.getCenter().lng.toFixed(3)}|${m.getCenter().lat.toFixed(3)}`; if(k !== lastIdle){ lastIdle = k; later(); } });
  later(); })();
window.Bridges = {
  topAt, absAt, rebuild: build, isOn: () => on, get ver(){ return ver; }, stats: () => ({vertices: mesh ? mesh.length/9 : 0, vias: geo.length}),
  setOn(v){ on = v; try{ localStorage.setItem("br3d-on", v ? "1" : "0"); }catch(e){} last = ""; build(); window.Sat?.map()?.triggerRepaint(); dispatchEvent(new Event("bridges3d")); },
  setColor(c){ const n = hex(c); if(n.every((x, i) => Math.abs(x - roadCol[i]) < .01)) return; roadCol = n; cache.clear(); last = ""; build(); },
  setOverlay(name, list){ if(list && list.length) overlays[name] = list; else delete overlays[name]; const m = window.Sat?.map(); if(m && on && last === "on") assemble(m); }
};
})();
