/* =============================================================================
   Linha do tempo (página de satélite): de 3 h atrás a 48 h à frente.
   Passado → troca a imagem dos satélites e do radar para aquele horário.
   Futuro  → mostra a previsão daquela hora no local.
   Arrastar, clicar, setas do teclado, ▶ tocar e "Agora".
   ============================================================================= */
(() => {
"use strict";
const C = window.ClimaCore;
const {$, esc, icon, wmo, r0, r1, fmtH, DOW, dirName} = C;
const PAST = 3*36e5, FUT = 48*36e5;
const box = document.createElement("section");
box.id = "tline"; box.className = "tline"; box.hidden = true; box.setAttribute("aria-label","Linha do tempo");
document.body.appendChild(box);
let T0 = 0, T1 = 0, cur = null, play = null, frameT = null, W = 0;
// recolhida: só a leitura da hora (sem a faixa do gráfico); lembrada por navegador
let mini = (() => { try{ const v = localStorage.getItem("tl-min"); return v == null ? matchMedia("(max-width: 860px)").matches : v === "1"; }catch(e){ return false; } })();   // no celular começa recolhida

const on = () => document.body.classList.contains("mapview") && !!C.S.fc;
// hora local do local (string da previsão) → epoch ms, usando o fuso que a Open-Meteo devolve
const off = () => (C.S.fc.utc_offset_seconds || 0)*1000;
const toMs = s => Date.UTC(+s.slice(0,4), +s.slice(5,7)-1, +s.slice(8,10), +s.slice(11,13), +s.slice(14,16)) - off();
const fmtT = ms => { const d = new Date(ms + off()); return `${DOW[d.getUTCDay()]} ${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}`; };
const x = t => (t - T0)/(T1 - T0)*W;

function build(){
  if(!on()){ box.hidden = true; stop(); return; }
  box.hidden = false;
  box.classList.toggle("tl-min", mini);
  const now = Date.now(); T0 = now - PAST; T1 = now + FUT;
  box.innerHTML = `
    <div class="tl-ctl"><button class="tl-b" id="tlPlay" aria-label="Tocar">▶</button><button class="tl-now" id="tlNow">Agora</button></div>
    <div class="tl-main"><div class="tl-read" id="tlRead"></div>
      <button class="tl-fold" id="tlFold" aria-label="${mini ? "Expandir" : "Recolher"} linha do tempo" title="${mini ? "Expandir" : "Recolher"} linha do tempo" aria-expanded="${!mini}"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${mini ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"}"/></svg></button><div class="tl-track" id="tlTrack" tabindex="0" role="slider" aria-label="Horário" aria-valuemin="-3" aria-valuemax="48"><svg id="tlSvg" preserveAspectRatio="none"></svg><i class="tl-thumb" id="tlThumb"></i></div></div>`;
  W = $("tlTrack").clientWidth;
  draw();
  const tr = $("tlTrack");
  const at = e => { const r = tr.getBoundingClientRect(); return T0 + Math.max(0, Math.min(1, (e.clientX - r.left)/r.width))*(T1 - T0); };
  tr.onpointerdown = e => { stop(); try{ tr.setPointerCapture(e.pointerId); }catch(err){} seek(at(e)); tr.onpointermove = ev => seek(at(ev)); };
  tr.onpointerup = tr.onpointercancel = () => { tr.onpointermove = null; };
  tr.onkeydown = e => { const step = (cur ?? Date.now()) < Date.now() ? 10*6e4 : 36e5;
    if(e.key==="ArrowRight"){ e.preventDefault(); seek((cur ?? Date.now()) + step); }
    if(e.key==="ArrowLeft"){ e.preventDefault(); seek((cur ?? Date.now()) - step); }
    if(e.key==="Home"){ e.preventDefault(); seek(null); } };
  $("tlNow").onclick = () => { stop(); seek(null); };
  $("tlPlay").onclick = () => play ? stop() : start();
  $("tlFold").onclick = () => { mini = !mini; try{ localStorage.setItem("tl-min", mini ? "1" : "0"); }catch(e){} build(); };
  seek(cur, true);
}

// mini-meteograma: chuva em barras, temperatura em linha, passado sombreado, "agora" e trocas de dia
function draw(){
  const svg = $("tlSvg"), H = 46, h = C.S.fc.hourly; if(!svg) return;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const pts = [], bars = [], days = [];
  let tmin = 99, tmax = -99;
  h.time.forEach((s,i)=>{ const t = toMs(s); if(t < T0-36e5 || t > T1+36e5) return; const v = h.temperature_2m[i]; tmin = Math.min(tmin, v); tmax = Math.max(tmax, v); });
  const ty = v => 6 + (1 - (v - tmin)/Math.max(1, tmax - tmin))*(H - 22);
  h.time.forEach((s,i)=>{
    const t = toMs(s); if(t < T0 || t > T1) return;
    const X = x(t);
    pts.push(`${X.toFixed(1)},${ty(h.temperature_2m[i]).toFixed(1)}`);
    const p = h.precipitation[i] || 0; if(p > 0.05) bars.push(`<rect x="${(X-1.6).toFixed(1)}" y="${(H - Math.min(H-8, 4 + p*7)).toFixed(1)}" width="3.2" height="${Math.min(H-8, 4 + p*7).toFixed(1)}" rx="1"/>`);
    if(s.slice(11,13) === "00") days.push(`<line x1="${X}" x2="${X}" y1="0" y2="${H}" class="tl-day"/><text x="${X+4}" y="11" class="tl-dl">${DOW[new Date(t + off()).getUTCDay()]}</text>`);
    else if(+s.slice(11,13) % 6 === 0) days.push(`<text x="${X}" y="${H-2}" class="tl-hl" text-anchor="middle">${+s.slice(11,13)}h</text>`);
  });
  const nx = x(Date.now());
  svg.innerHTML = `<rect x="0" y="0" width="${nx}" height="${H}" class="tl-past"/>
    <g class="tl-rain">${bars.join("")}</g><polyline points="${pts.join(" ")}" class="tl-temp"/>${days.join("")}
    <line x1="${nx}" x2="${nx}" y1="0" y2="${H}" class="tl-nowl"/><text x="${nx+5}" y="${H-4}" class="tl-tag">previsão →</text>`;
}

function seek(t, quiet){
  const now = Date.now();
  if(t != null && Math.abs(t - now) < 5*6e4) t = null;
  if(t != null) t = Math.max(T0, Math.min(T1, t));
  cur = t;
  const tt = t ?? now, th = $("tlThumb"); if(!th) return;
  th.style.left = x(tt) + "px";
  $("tlTrack").setAttribute("aria-valuenow", r1((tt - now)/36e5));
  read(tt);
  // imagem dos satélites: só no passado, com espera curta para não pedir tiles a cada pixel arrastado
  const want = t != null && t < now ? t : null;
  if(quiet || want === frameT) return;
  clearTimeout(seek.d); seek.d = setTimeout(()=>{ frameT = want; window.Sat?.setFrame(want); }, 220);
}

function read(tt){
  const h = C.S.fc.hourly; let k = 0, best = 1e15;
  h.time.forEach((s,i)=>{ const d = Math.abs(toMs(s) - tt); if(d < best){ best = d; k = i; } });
  const past = tt < Date.now() - 5*6e4, fut = tt > Date.now() + 5*6e4, [nm, kind] = wmo(h.weather_code[k]);
  const lat = window.Sat?.latest(), img = past && lat ? Math.min(tt, lat) : null;
  $("tlRead").innerHTML = `${icon(kind, 22, !h.is_day[k])}<b>${fmtT(tt)}</b><span class="tl-k">${past ? "passado" : fut ? "previsão" : "agora"}</span>
    <span>${r0(h.temperature_2m[k])}°</span><span>${esc(nm)}</span><span>chuva ${r1(h.precipitation[k])} mm · ${r0(h.precipitation_probability[k])}%</span>
    <span>vento ${r0(h.wind_speed_10m[k])} km/h ${dirName(h.wind_direction_10m[k])}</span>${img ? `<span class="tl-img">imagem ${fmtT(img)}</span>` : ""}`;
}

function start(){
  const b = $("tlPlay"); if(b) b.textContent = "❚❚";
  if(cur == null || cur >= T1 - 36e5) cur = T0;
  play = setInterval(()=>{
    const step = cur < Date.now() ? 20*6e4 : 36e5, nx = cur + step;
    if(nx > T1){ stop(); return; }
    seek(nx);
  }, 650);
}
function stop(){ clearInterval(play); play = null; const b = $("tlPlay"); if(b) b.textContent = "▶"; }

window.Sat && setTimeout(()=>window.Sat.resize && window.dispatchEvent(new Event("resize")), 0);
addEventListener("hashchange", ()=>{ if(!on()){ stop(); if(cur != null){ cur = null; frameT = null; window.Sat?.setFrame(null); } } setTimeout(build, 60); });
addEventListener("resize", ()=>{ clearTimeout(build.r); build.r = setTimeout(build, 200); });
setInterval(()=>{ if(on() && !play) build(); }, 5*60*1000);   // o "agora" anda
window.Timeline = {build};
})();
