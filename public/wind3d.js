/* =============================================================================
   Rosa dos ventos 3D — canvas com projeção inclinada.
   · disco em perspectiva com a rosa de 7 dias em pétalas extrudadas
     (raio = frequência; altura cresce com a faixa de velocidade);
   · camada de ar animada: partículas seguem o vento atual, interpolado
     minuto a minuto entre as horas da previsão, com pulsos de rajada;
   · seta 3D a favor do vento, com sombra no disco; arraste para girar.
   ============================================================================= */
(() => {
"use strict";
const BINS = [[0,10],[10,20],[20,30],[30,40],[40,999]];
const COLS = ["#9BE0B4","#4FC48A","#F2BE46","#E8702A","#D0342C"];
const TILT = .42, HALF = 9.6*Math.PI/180;
const shade = (hex, f) => { const n = parseInt(hex.slice(1),16), c = [n>>16, n>>8&255, n&255].map(v=>Math.round(Math.min(255, v*f))); return `rgb(${c})`; };
const reduce = matchMedia("(prefers-reduced-motion: reduce)");

// frequência por direção (16) × faixa de velocidade, próximas 168 h
function rose(h, i0){
  const F = Array.from({length:16},()=>BINS.map(()=>0)); let n = 0;
  for(let k=i0;k<Math.min(h.time.length,i0+168);k++){
    const s = h.wind_speed_10m[k], d = h.wind_direction_10m[k]; if(s==null||d==null) continue; n++;
    if(s<2) continue;
    F[Math.round(((d%360)+360)%360/22.5)%16][BINS.findIndex(([a,b])=>s>=a&&s<b)]++;
  }
  return F.map(b=>b.map(c=>n?c/n:0));
}
// vento "agora": interpola entre a hora corrente e a seguinte
function windNow(h, i0){
  const f = new Date().getMinutes()/60, a = i0, b = Math.min(i0+1, h.time.length-1);
  const lerp = (x,y) => x + (y-x)*f;
  let d0 = h.wind_direction_10m[a], d1 = h.wind_direction_10m[b], dd = ((d1-d0+540)%360)-180;
  return {speed:lerp(h.wind_speed_10m[a], h.wind_speed_10m[b]), gust:lerp(h.wind_gusts_10m[a], h.wind_gusts_10m[b]), dir:(d0+dd*f+360)%360};
}

function mount(canvas, {hourly, i0, css, onInfo}){
  const ctx = canvas.getContext("2d");
  const F = rose(hourly, i0), maxSec = Math.max(...F.map(b=>b.reduce((x,y)=>x+y,0))) || 1;
  let W = 0, H = 0, R = 0, cx = 0, cy = 0, hs = 1;
  let rot = 0, drag = null, idle = 0, alive = true, raf = 0, last = performance.now(), t = 0;
  let wind = windNow(hourly, i0); onInfo && onInfo(wind);
  const tmr = setInterval(()=>{ wind = windNow(hourly, i0); onInfo && onInfo(wind); }, 60000);
  const P = Array.from({length:150},()=>spawn(true));

  function size(){
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio||1);
    W = r.width; H = r.height; canvas.width = W*dpr; canvas.height = H*dpr; ctx.setTransform(dpr,0,0,dpr,0,0);
    R = Math.min(W*.42, H/(TILT*2+.9)); cx = W/2; cy = H*.56; hs = R/110;
  }
  const ro = new ResizeObserver(size); ro.observe(canvas); size();

  // mundo → tela. θ: azimute (0 = N, horário); r: 0..1; z: altura em px (escalada)
  const pt = (r, th, z=0) => { const a = th + rot; return [cx + r*Math.sin(a)*R, cy - r*Math.cos(a)*R*TILT - z*hs]; };
  const depth = (r, th) => -Math.cos(th+rot)*r;   // maior = mais perto de quem olha

  function spawn(anywhere){
    const down = (wind.dir+180)*Math.PI/180, a = Math.random()*2*Math.PI, rr = Math.sqrt(Math.random());
    if(anywhere) return {x:rr*Math.sin(a), y:-rr*Math.cos(a), age:Math.random()*2, life:1.5+Math.random()*2.5};
    // nasce na borda de onde o vento vem
    const off = (Math.random()-.5)*1.8, ux = Math.sin(down), uy = -Math.cos(down);
    return {x:-ux*.98 + uy*off*.98*-1, y:-uy*.98 + ux*off*.98, age:0, life:1.5+Math.random()*2.5};
  }

  function frame(now){
    if(!alive) return;
    if(!canvas.isConnected){ destroy(); return; }
    const dt = Math.min(.05, (now-last)/1000); last = now; t += dt;
    if(!drag){ idle += dt; rot += (Math.sin(t*.25)*.18 - rot)*Math.min(1, dt*.6); }
    draw(dt);
    if(!reduce.matches && !document.hidden) raf = requestAnimationFrame(frame);
  }

  function draw(dt){
    ctx.clearRect(0,0,W,H);
    const ink = css("--ink"), ink3 = css("--ink-3"), dark = matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme!=="light" || document.documentElement.dataset.theme==="dark";

    // disco
    const g = ctx.createRadialGradient(cx, cy-R*TILT*.3, R*.1, cx, cy, R*1.05);
    g.addColorStop(0, dark ? "rgba(120,150,210,.22)" : "rgba(255,255,255,.55)");
    g.addColorStop(1, dark ? "rgba(40,60,110,.10)" : "rgba(200,220,245,.18)");
    // espessura do disco (borda inferior)
    ctx.beginPath(); ctx.ellipse(cx, cy+6*hs, R, R*TILT, 0, 0, Math.PI); ctx.lineTo(cx-R, cy); ctx.ellipse(cx, cy, R, R*TILT, 0, Math.PI, 0, true); ctx.closePath();
    ctx.fillStyle = dark ? "rgba(90,120,180,.25)" : "rgba(120,150,190,.22)"; ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx, cy, R, R*TILT, 0, 0, 2*Math.PI); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = dark ? "rgba(255,255,255,.35)" : "rgba(255,255,255,.9)"; ctx.lineWidth = 1.2; ctx.stroke();
    // anéis e raios
    ctx.lineWidth = 1; ctx.strokeStyle = dark ? "rgba(200,220,255,.14)" : "rgba(30,50,80,.12)";
    [1/3, 2/3].forEach(f=>{ ctx.beginPath(); ctx.ellipse(cx, cy, R*f, R*f*TILT, 0, 0, 2*Math.PI); ctx.stroke(); });
    for(let k=0;k<8;k++){ const [x0,y0] = pt(.1, k*Math.PI/4), [x1,y1] = pt(1, k*Math.PI/4); ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); ctx.stroke(); }
    // pontos cardeais
    ctx.font = `700 ${Math.max(10, 12*hs)}px -apple-system, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ["N","L","S","O"].forEach((c,k)=>{ const [x,y] = pt(1.13, k*Math.PI/2); ctx.fillStyle = c==="N" ? css("--danger") : ink3; ctx.fillText(c, x, y); });

    // pétalas extrudadas, desenhadas de trás para a frente
    const segs = [];
    F.forEach((bins, s)=>{ let r0 = .1; bins.forEach((f,j)=>{ if(!f) return; const r1 = r0 + f/maxSec*.84; segs.push({s, j, r0, r1, z:4+j*4}); r0 = r1; }); });
    segs.sort((a,b)=>depth((a.r0+a.r1)/2, a.s*Math.PI/8) - depth((b.r0+b.r1)/2, b.s*Math.PI/8));
    for(const g2 of segs){
      const th = g2.s*Math.PI/8, a0 = th-HALF, a1 = th+HALF, n = 6, col = COLS[g2.j];
      const arc = (r, z, from, to) => { const o = []; for(let k=0;k<=n;k++){ o.push(pt(r, from+(to-from)*k/n, z)); } return o; };
      // face externa (visível na metade de perto)
      if(Math.cos(th+rot) < .2){
        const top = arc(g2.r1, g2.z, a0, a1), bot = arc(g2.r1, 0, a1, a0);
        poly([...top, ...bot], shade(col, .72));
      }
      // face interna (visível na metade de longe)
      if(Math.cos(th+rot) > -.2 && g2.r0 > .1){
        const top = arc(g2.r0, g2.z, a0, a1), bot = arc(g2.r0, 0, a1, a0);
        poly([...top, ...bot], shade(col, .82));
      }
      // laterais radiais
      [a0, a1].forEach(a=>{ if(Math.sin(a+rot)*(a===a0?-1:1) > 0) poly([pt(g2.r0,a,0), pt(g2.r1,a,0), pt(g2.r1,a,g2.z), pt(g2.r0,a,g2.z)], shade(col, .62)); });
      // tampa
      poly([...arc(g2.r1, g2.z, a0, a1), ...arc(g2.r0, g2.z, a1, a0)], col, "rgba(255,255,255,.55)");
    }

    // sombra e seta 3D (a favor do vento)
    const down = (wind.dir+180)*Math.PI/180, pulse = wind.speed + Math.max(0, wind.gust-wind.speed)*Math.pow(.5+.5*Math.sin(t*1.3),3);
    const arrow = (z, fill, stroke) => { const L = .62, w = .075;
      const tip = pt(L, down, z), back = pt(-L*.55, down, z), side = (r, s) => { const a = down + s*Math.atan2(w, r); return pt(Math.hypot(r,w), a, z); };
      poly([tip, side(L*.45, 1), side(-L*.55, 1), back, side(-L*.55, -1), side(L*.45, -1)], fill, stroke); };
    arrow(0, dark ? "rgba(0,0,0,.35)" : "rgba(20,40,70,.18)");
    const lift = 78 + Math.sin(t*2)*3;
    const [bx, by] = pt(0,0,0), [tx, ty] = pt(0,0,lift);
    ctx.strokeStyle = dark ? "rgba(255,255,255,.35)" : "rgba(30,50,80,.25)"; ctx.setLineDash([2,3]); ctx.beginPath(); ctx.moveTo(bx,by); ctx.lineTo(tx,ty); ctx.stroke(); ctx.setLineDash([]);
    arrow(lift, css("--accent"), "rgba(255,255,255,.85)");
    // direção nominal escrita na borda do disco, no ponto de onde o vento vem
    { const from = wind.dir*Math.PI/180, [lx, ly] = pt(1.02, from, 10), name = (window.Wind3D?.NOMINAL || {})[["N","NNE","NE","ENE","L","ESE","SE","SSE","S","SSO","SO","OSO","O","ONO","NO","NNO"][Math.round(((wind.dir%360)+360)%360/22.5)%16]] || "";
      ctx.font = `700 ${Math.max(10, 11*hs)}px -apple-system, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const w = ctx.measureText(name).width + 14, hh = 20*Math.max(.8,hs);
      ctx.fillStyle = "rgba(10,132,255,.92)"; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(lx-w/2, ly-hh/2, w, hh, hh/2) : ctx.rect(lx-w/2, ly-hh/2, w, hh); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.fillText(name, lx, ly+.5); }

    // camada de ar: partículas acima do disco
    if(!reduce.matches){
      const v = (.18 + pulse/45) * dt, ux = Math.sin(down), uy = -Math.cos(down);
      ctx.lineCap = "round";
      for(let k=0;k<P.length;k++){
        const p = P[k], ox = p.x, oy = p.y;
        const wob = Math.sin(t*3 + k)*.12*dt;
        p.x += ux*v - uy*wob; p.y += uy*v + ux*wob; p.age += dt;
        if(p.x*p.x + p.y*p.y > 1 || p.age > p.life){ P[k] = spawn(false); continue; }
        const life = Math.sin(Math.PI*Math.min(1, p.age/p.life)), z = 22 + (k%5)*4;
        const toPolar = (x,y) => [Math.hypot(x,y), Math.atan2(x,-y)];
        const [r1, a1] = toPolar(p.x, p.y), [r0, a0] = toPolar(p.x - ux*v*6, p.y - uy*v*6);
        const A = pt(r0, a0-rot, z), B = pt(r1, a1-rot, z);
        ctx.strokeStyle = dark ? `rgba(190,230,255,${.65*life})` : `rgba(10,110,200,${.55*life})`;
        ctx.lineWidth = 1.2 + (k%3)*.5;
        ctx.beginPath(); ctx.moveTo(A[0],A[1]); ctx.lineTo(B[0],B[1]); ctx.stroke();
      }
    }
  }
  function poly(pts, fill, stroke){
    ctx.beginPath(); pts.forEach(([x,y],k)=>k?ctx.lineTo(x,y):ctx.moveTo(x,y)); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); if(stroke){ ctx.strokeStyle = stroke; ctx.lineWidth = .8; ctx.stroke(); }
  }

  // arrastar para girar
  canvas.addEventListener("pointerdown", e=>{ if(canvas.closest(".editing")) return; drag = {x:e.clientX, r:rot}; canvas.setPointerCapture(e.pointerId); e.stopPropagation(); });
  canvas.addEventListener("pointermove", e=>{ if(drag){ rot = drag.r + (e.clientX-drag.x)/R*1.4; if(reduce.matches) draw(0); } });
  canvas.addEventListener("pointerup", ()=>{ drag = null; t = Math.asin(Math.max(-1,Math.min(1,rot/.18)))/.25 || 0; });
  canvas.addEventListener("click", e=>e.stopPropagation());
  const vis = () => { if(!document.hidden && alive){ cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(frame); } };
  document.addEventListener("visibilitychange", vis);

  function destroy(){ alive = false; cancelAnimationFrame(raf); clearInterval(tmr); ro.disconnect(); document.removeEventListener("visibilitychange", vis); }
  draw(0); raf = requestAnimationFrame(frame);
  return {destroy};
}
const NOMINAL = {N:"Norte",NNE:"Norte-nordeste",NE:"Nordeste",ENE:"Lés-nordeste",L:"Leste",ESE:"Lés-sudeste",SE:"Sudeste",SSE:"Sul-sudeste",S:"Sul",SSO:"Sul-sudoeste",SO:"Sudoeste",OSO:"Oés-sudoeste",O:"Oeste",ONO:"Oés-noroeste",NO:"Noroeste",NNO:"Nor-noroeste"};
window.Wind3D = {NOMINAL, mount, windNow, BINS, COLS};
})();
