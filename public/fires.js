/* =============================================================================
   QUEIMADAS — focos de calor das últimas 24 h (NASA FIRMS, VIIRS de 375 m nos
   satélites Suomi NPP, NOAA-20 e NOAA-21). O servidor junta tudo de hora em hora
   em /data/firms.json (deploy/firms.py; a chave da NASA fica só lá).
   Longe: mancha de calor; perto: um ponto por foco, na cor da potência (FRP).
   Clique → modal com hora, satélite, potência e confiança.
   ============================================================================= */
(() => {
"use strict";
const C = window.ClimaCore;
const {esc} = C;
const store = {
  get(k,d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const st = {on: store.get("fire-on", false), meta:null, at:0, timer:null};
const EMPTY = {type:"FeatureCollection", features:[]};
const CONF = ["baixa", "nominal", "alta"];

// formato enxuto do servidor: 7 números por foco (lon, lat ×1e4; FRP ×10; minutos antes de t; satélite; confiança; dia)
async function load(){
  const m = window.Sat?.map(); if(!m?.getSource("fire")) return;
  try{
    const j = await (await fetch("/data/firms.json", {cache:"no-cache"})).json(), p = j.p, feats = new Array(p.length / 7);
    for(let i=0, k=0; i<p.length; i+=7, k++) feats[k] = {type:"Feature", properties:{f:p[i+2]/10, a:p[i+3], s:p[i+4], c:p[i+5], d:p[i+6]}, geometry:{type:"Point", coordinates:[p[i]/1e4, p[i+1]/1e4]}};
    st.meta = {t:j.t*1000, sat:j.sat, n:j.n}; st.at = Date.now();
    m.getSource("fire").setData({type:"FeatureCollection", features:feats});
  }catch(e){ st.meta = null; }
  window.Sat?.footer?.();
}
function install(){
  const m = window.Sat?.map(); if(!m) return false;
  if(m.getLayer("fire-pt")) return true;
  if(!m.isStyleLoaded()){ m.once("idle", install); return true; }
  const vis = st.on ? "visible" : "none";
  m.addSource("fire", {type:"geojson", data:EMPTY, buffer:16, maxzoom:12});
  // mancha de calor até o z8, pesando pela potência; some aos poucos enquanto os pontos aparecem
  m.addLayer({id:"fire-heat", type:"heatmap", source:"fire", maxzoom:9, layout:{visibility:vis},
    paint:{"heatmap-weight":["interpolate",["linear"],["get","f"],0,.15,20,.5,100,1],
      "heatmap-intensity":["interpolate",["linear"],["zoom"],0,.6,8,1.6],
      "heatmap-radius":["interpolate",["linear"],["zoom"],0,2,4,6,8,14],
      "heatmap-opacity":["interpolate",["linear"],["zoom"],6,.85,9,0],
      "heatmap-color":["interpolate",["linear"],["heatmap-density"],0,"rgba(255,200,0,0)",.15,"rgba(255,214,10,.55)",.4,"#FF9F0A",.7,"#FF453A",1,"#B3001B"]}}, "measure-line");
  // ponto por foco: cor pela potência (MW), raio pela potência e pelo zoom; focos antigos (> 12 h) ficam mais apagados
  m.addLayer({id:"fire-pt", type:"circle", source:"fire", minzoom:5, layout:{visibility:vis},
    paint:{"circle-color":["interpolate",["linear"],["get","f"],0,"#FFD60A",10,"#FF9F0A",40,"#FF453A",150,"#B3001B"],
      "circle-radius":["interpolate",["linear"],["zoom"],5,["interpolate",["linear"],["get","f"],0,1.5,100,4],12,["interpolate",["linear"],["get","f"],0,5,100,11]],
      "circle-opacity":["interpolate",["linear"],["zoom"],5,0,7,["case",[">",["get","a"],720],.55,.95]],
      "circle-stroke-color":"rgba(60,0,0,.75)", "circle-stroke-width":["interpolate",["linear"],["zoom"],6,0,10,1],
      "circle-stroke-opacity":["interpolate",["linear"],["zoom"],5,0,7,1]}}, "measure-line");
  m.on("click", "fire-pt", e => { const f = e.features?.[0]; if(f) modal(f); });
  m.on("mouseenter", "fire-pt", () => { m.getCanvas().style.cursor = "pointer"; });
  m.on("mouseleave", "fire-pt", () => { m.getCanvas().style.cursor = ""; });
  if(st.on) start();
  return true;
}
const iv = setInterval(() => { if(install()) clearInterval(iv); }, 800);
// o servidor renova o arquivo de hora em hora; com a camada ligada, relê a cada 30 min
function start(){ load(); clearInterval(st.timer); st.timer = setInterval(load, 30*60e3); }
function setOn(v){
  st.on = v; store.set("fire-on", v);
  const m = window.Sat?.map(); if(!m || !install()) return;
  for(const id of ["fire-heat","fire-pt"]) if(m.getLayer(id)) m.setLayoutProperty(id, "visibility", v ? "visible" : "none");
  if(v){ if(!st.meta || Date.now() - st.at > 30*60e3) start(); else st.timer = st.timer || setInterval(load, 30*60e3); }
  else { clearInterval(st.timer); st.timer = null; }
  window.Sat?.footer?.();
}
const ago = min => min < 60 ? `${Math.round(min)} min` : `${Math.floor(min/60)} h ${String(Math.round(min%60)).padStart(2,"0")}`;
function modal(f){
  const p = f.properties, [lon, lat] = f.geometry.coordinates, meta = st.meta || {t:Date.now(), sat:[]};
  const seen = meta.t - p.a*6e4, min = (Date.now() - seen) / 6e4;
  const hora = new Date(seen).toLocaleString("pt-BR", {day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit"});
  C.openModal({icon:`<span class="pl-ic" style="background:#FF453A">🔥</span>`, title:"Foco de calor", sub:esc(`visto há ${ago(min)} · ${meta.sat[p.s] || "VIIRS"}`),
    kpis:[["Potência", p.f.toLocaleString("pt-BR", {maximumFractionDigits:1}), "MW"], ["Detectado", hora, ""], ["Confiança", CONF[p.c] || "—", ""], ["Passagem", p.d ? "dia" : "noite", ""], ["Coordenadas", `${lat.toFixed(4)}, ${lon.toFixed(4)}`, ""]],
    html:`<p class="gv-s">Anomalia térmica vista pelo satélite: pode ser queimada, incêndio florestal, queima agrícola, vulcão ou chama industrial. O pixel tem 375 m, então a posição tem incerteza de algumas centenas de metros. A potência radiativa (FRP) indica a intensidade do fogo.</p>
      <p class="cam-src">Fonte: NASA FIRMS (Fire Information for Resource Management System), VIIRS 375 m — dados abertos da NASA.</p>`,
    actions:[{label:"☀ Previsão daqui (vento e fumaça)", primary:true, fn:() => { C.closeModal(); C.load({name:"Foco de calor", admin:"", country:"", lat:+lat.toFixed(4), lon:+lon.toFixed(4)}); }},
      {label:"⛰ Ver em 3D aqui", fn:() => { C.closeModal(); const S = window.Sat; if(!S.isClear()) S.setProd("earth"); S.map().flyTo({center:[lon,lat], zoom:13, pitch:60, duration:2400}); }},
      {label:"🛰 Abrir no FIRMS", fn:() => window.open(`https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${lon.toFixed(3)},${lat.toFixed(3)},11.0z`, "_blank", "noopener")}]});
}
window.Fires = {setOn, isOn: () => st.on, meta: () => st.meta};
})();
