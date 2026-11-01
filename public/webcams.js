/* =============================================================================
   CÂMERAS AO VIVO — transmissões 24 h no YouTube (incorporação permitida,
   verificada pelo oEmbed). Clique no ícone → modal com o vídeo ao vivo do local.
   Se a transmissão foi reiniciada (o vídeo muda de ID), o player do canal
   ("live_stream?channel=") mostra a transmissão atual.
   ============================================================================= */
(() => {
"use strict";
const C = window.ClimaCore;
const {esc} = C;
const store = {
  get(k,d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
let on = store.get("cams-on", true);
function icon(m){
  if(m.hasImage("cam")) return;
  const s = 64, cv = document.createElement("canvas"); cv.width = cv.height = s; const g = cv.getContext("2d");
  g.beginPath(); g.arc(s/2, s/2, s/2-4, 0, 7); g.fillStyle = "#FF3B30"; g.fill(); g.lineWidth = 4; g.strokeStyle = "#fff"; g.stroke();
  g.fillStyle = "#fff"; g.beginPath(); g.roundRect ? g.roundRect(15, 23, 24, 18, 4) : g.rect(15, 23, 24, 18); g.fill();
  g.beginPath(); g.moveTo(40, 28); g.lineTo(50, 22); g.lineTo(50, 42); g.lineTo(40, 36); g.closePath(); g.fill();
  m.addImage("cam", g.getImageData(0,0,s,s), {pixelRatio:2});
}
function install(){
  const m = window.Sat?.map(); if(!m) return false;
  if(m.getLayer("cams")) return true;
  if(!m.isStyleLoaded()){ m.once("idle", install); return true; }
  icon(m);
  m.addSource("cams", {type:"geojson", data:"data-webcams.json"});
  m.addLayer({id:"cams", type:"symbol", source:"cams", layout:{visibility: on ? "visible" : "none", "icon-image":"cam", "icon-size":["interpolate",["linear"],["zoom"],1,.5,8,.8],
      "icon-allow-overlap":true, "text-field":["step",["zoom"],"",5,["get","n"]], "text-font":["Noto Sans Bold"], "text-size":11.5, "text-offset":[0,1.4], "text-anchor":"top", "text-optional":true},
    paint:{"text-color":"#FFD3CF", "text-halo-color":"rgba(0,0,0,.85)", "text-halo-width":1.4}}, "measure-line");
  m.on("click", "cams", e=>{ const f = e.features?.[0]; if(f) open(f); });
  m.on("mouseenter", "cams", ()=>{ m.getCanvas().style.cursor = "pointer"; });
  m.on("mouseleave", "cams", ()=>{ m.getCanvas().style.cursor = ""; });
  return true;
}
const iv = setInterval(()=>{ if(install()) clearInterval(iv); }, 800);
function setOn(v){ on = v; store.set("cams-on", on); const m = window.Sat?.map(); if(!m || !install()) return; m.setLayoutProperty("cams", "visibility", on ? "visible" : "none"); }
/* player do YouTube igual ao do hub.gplansis.com: API oficial (iframe_api), host youtube-nocookie,
   mudo no início (o navegador só permite autoplay sem som), mensagens de erro e plano B pelo canal */
let ytApi = null, player = null;
function loadYT(){
  if(ytApi) return ytApi;
  ytApi = new Promise((res, rej) => {
    if(window.YT && window.YT.Player) return res(window.YT);
    const to = setTimeout(() => rej(new Error("timeout")), 8000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(to); res(window.YT); };
    const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; s.async = true;
    s.onerror = () => { clearTimeout(to); rej(new Error("blocked")); };
    document.head.appendChild(s);
  });
  ytApi.catch(() => { ytApi = null; });
  return ytApi;
}
const msg = (t, cls) => { const m = document.getElementById("camMsg"); if(m){ m.className = "cam-msg" + (cls ? " " + cls : ""); m.innerHTML = t; } };
async function play(p, byChannel){
  const box = document.getElementById("camBox"); if(!box) return;
  try{ player && player.destroy(); }catch(e){} player = null;
  box.innerHTML = '<div id="camFrame"></div>';
  msg("Carregando o player do YouTube…");
  let YT; try{ YT = await loadYT(); }catch(e){ msg(`O YouTube não carregou (conexão ou bloqueio do navegador). <a href="https://www.youtube.com/watch?v=${esc(p.v)}" target="_blank" rel="noopener">Abrir no YouTube</a>`, "err"); return; }
  if(!document.getElementById("camFrame")) return;
  const pv = {playsinline:1, rel:0, modestbranding:1, autoplay:1, mute:1};
  const op = {host:"https://www.youtube-nocookie.com", width:"100%", height:"100%", playerVars:pv,
    events:{
      onReady: e => { e.target.mute(); e.target.playVideo(); msg("Ao vivo · começa sem som — use o botão de volume do player."); },
      onStateChange: e => { if(e.data === 1) msg(`Ao vivo · ${esc(p.ch || "YouTube")}`); },
      onError: e => {
        const c = e.data;
        if(!byChannel && p.c){ msg("Esta transmissão foi reiniciada; buscando a transmissão atual do canal…", "warn"); setTimeout(()=>play(p, true), 800); return; }
        const why = c === 101 || c === 150 ? "O dono desta câmera não permite tocar fora do YouTube." : c === 100 ? "Transmissão encerrada ou privada." : "O YouTube não conseguiu tocar esta câmera.";
        msg(`${why} <a href="https://www.youtube.com/watch?v=${esc(p.v)}" target="_blank" rel="noopener">Abrir no YouTube</a>`, "err");
      }}};
  if(byChannel){ pv.listType = "user_uploads"; op.videoId = undefined; op.playerVars = {...pv, channel:p.c}; }
  else op.videoId = p.v;
  // canal: o embed de "transmissão ao vivo atual" usa o endereço live_stream
  if(byChannel){ box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/live_stream?channel=${encodeURIComponent(p.c)}&autoplay=1&mute=1&playsinline=1" title="${esc(p.n)} ao vivo" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`; msg(`Transmissão atual do canal ${esc(p.ch||"")}.`); return; }
  player = new YT.Player("camFrame", op);
}
// câmera ao vivo num cartão flutuante médio (widget): não cobre o mapa, arrasta e recolhe (layout.js), fecha no ✕
function fechar(){ try{ player && player.destroy(); }catch(e){} player = null; document.getElementById("camCard")?.remove(); }
function open(f){
  const p = f.properties, [lon, lat] = f.geometry.coordinates, ic = (n, s=18) => window.Ico?.(n, s) || "";
  fechar(); C.closeModal?.();
  const el = document.createElement("section"); el.id = "camCard"; el.className = "cam-card glass"; el.setAttribute("aria-label", "Câmera ao vivo");
  el.innerHTML = `<header><span class="cc-ic">${ic("video", 18)}</span><div><b>${esc(p.n)}</b><small>${esc(p.w)} · <i class="cc-live">ao vivo</i></small></div>
      <button class="cc-x" aria-label="Fechar">${ic("x", 16)}</button></header>
    <div class="cam-v" id="camBox"><div id="camFrame"></div></div><p class="cam-msg" id="camMsg"></p>
    <div class="cc-bar"><button data-cc="play" title="Pausar / tocar">${ic("playpause", 18)}</button><button data-cc="mute" title="Som liga/desliga">${ic("mute", 18)}</button>
      <input type="range" min="0" max="100" value="60" data-cc="vol" aria-label="Volume"><button data-cc="fs" title="Tela cheia">${ic("full", 18)}</button></div>
    <div class="cc-act"><button data-ca="fc" class="pri">${ic("sun", 16)}<span>Previsão</span></button><button data-ca="map">${ic("pin", 16)}<span>No mapa</span></button>
      <button data-ca="live">${ic("refresh", 16)}<span>Ao vivo</span></button><button data-ca="yt">${ic("link", 16)}<span>YouTube</span></button></div>
    <small class="cam-src">${esc(p.ch || "YouTube")} · “${esc(p.t)}”</small>`;
  document.body.appendChild(el);
  el.querySelector(".cc-x").onclick = fechar;
  const A = {fc:() => C.load({name:p.n, admin:"", country:"", lat:+lat.toFixed(4), lon:+lon.toFixed(4)}),
    map:() => window.Sat.map().flyTo({center:[lon, lat], zoom:15, pitch:55, duration:1800}),
    live:() => play(p, true), yt:() => window.open(`https://www.youtube.com/watch?v=${p.v}`, "_blank", "noopener")};
  el.querySelectorAll("[data-ca]").forEach(b => b.onclick = () => A[b.dataset.ca]());
  play(p, false);
  // controles próprios (iguais para qualquer câmera): tocar/pausar, som, volume e tela cheia
  el.querySelectorAll("[data-cc]").forEach(b=>{ const k = b.dataset.cc;
    const act = () => { if(!player || !player.getPlayerState){ if(k==="fs") document.getElementById("camBox")?.requestFullscreen?.(); return; }
      if(k==="play"){ player.getPlayerState() === 1 ? player.pauseVideo() : player.playVideo(); }
      if(k==="mute"){ if(player.isMuted()){ player.unMute(); player.setVolume(+el.querySelector('[data-cc="vol"]').value); b.innerHTML = ic("vol", 18); } else { player.mute(); b.innerHTML = ic("mute", 18); } }
      if(k==="fs") document.getElementById("camBox")?.requestFullscreen?.(); };
    if(k==="vol") b.oninput = () => { if(player && player.setVolume){ player.setVolume(+b.value); if(+b.value > 0){ player.unMute(); el.querySelector('[data-cc="mute"]').innerHTML = ic("vol", 18); } } };
    else b.onclick = act; });
}
addEventListener("hashchange", () => { if(document.body.dataset.view !== "sat") fechar(); });
window.Cams = {setOn, isOn: () => on, open, fechar};
})();
