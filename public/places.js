/* =============================================================================
   LUGARES — pontos de interesse do OpenStreetMap (OpenFreeMap) por categoria,
   com ícone próprio, filtro por tipo e modal com dados da Wikipédia
   (resumo, imagem, link) encontrados por proximidade + nome.
   ============================================================================= */
(() => {
"use strict";
const C = window.ClimaCore;
const {$, esc, r0} = C;
const store = {
  get(k,d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
// categoria → [nome, emoji, cor, classes/subclasses OSM]
const CATS = {
  turismo:  ["Pontos turísticos", "📸", "#FF9F0A", ["attraction","zoo","aquarium","theme_park"]],
  templo:   ["Igrejas e templos", "⛪", "#BF5AF2", ["place_of_worship"]],
  museu:    ["Museus e galerias", "🏛", "#5E5CE6", ["museum","art_gallery","gallery"]],
  monum:    ["Monumentos e históricos", "🗿", "#AC8E68", ["castle","monument","memorial","ruins","archaeological_site","fort"]],
  mirante:  ["Mirantes", "🔭", "#30B0C7", ["viewpoint"]],
  parque:   ["Parques e jardins", "🌳", "#34C759", ["park","garden","nature_reserve"]],
  praia:    ["Praias", "🏖", "#64D2FF", ["beach","beach_resort"]],
  cultura:  ["Teatros e cinemas", "🎭", "#FF375F", ["theatre","cinema","music","arts_centre"]],
  restaur:  ["Restaurantes", "🍽", "#FF6B3D", ["restaurant","fast_food","food_court"]],
  cafe:     ["Cafés e bares", "☕", "#A2845E", ["cafe","bar","beer","pub","ice_cream"]],
  hotel:    ["Hotéis e pousadas", "🛏", "#0A84FF", ["lodging","hotel","hostel","guest_house","motel"]],
  saude:    ["Hospitais", "🏥", "#FF453A", ["hospital","clinic"]],
  estadio:  ["Estádios de futebol", "⚽", "#32D74B", ["stadium","pitch"]],
  shopping: ["Shoppings", "🛍", "#FF2D55", ["mall","department_store","shop"]],
  esporte:  ["Esportes (ginásios, golfe…)", "🏟", "#30B0C7", ["sports_centre","golf","swimming"]],
  educ:     ["Universidades e bibliotecas", "🎓", "#FFD60A", ["college","university","library"]]
};
const ORDER = Object.keys(CATS);
let on = store.get("places-on", false), sel = new Set(store.get("places-cats", ["turismo","templo","museu","monum","mirante","parque","praia","cultura","estadio","shopping"]));
if(!store.get("places-v2", false)){ sel.add("estadio"); sel.add("shopping"); store.set("places-cats",[...sel]); store.set("places-v2", true); }

// expressão de categoria a partir de class/subclass
function catExpr(){
  const e = ["case"];
  for(const k of ORDER){ const vals = CATS[k][3];
    e.push(["any", ["in", ["get","class"], ["literal", vals]], ["in", ["coalesce",["get","subclass"],""], ["literal", vals]]], k); }
  e.push("");
  return e;
}
// ícones: círculo colorido com o ícone de linha (icons.js), desenhados em canvas
function addIcons(m){
  for(const k of ORDER){ const id = "poi-"+k; if(m.hasImage(id)) continue;
    const s = 64, cv = document.createElement("canvas"); cv.width = cv.height = s; const g = cv.getContext("2d");
    g.beginPath(); g.arc(s/2, s/2, s/2-4, 0, 7); g.fillStyle = CATS[k][2]; g.fill(); g.lineWidth = 4; g.strokeStyle = "#fff"; g.stroke();
    if(!window.IcoPaint?.(g, CATS[k][1], s/2, s/2, 30, "#fff", 2.4)){ g.font = "30px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(CATS[k][1], s/2, s/2+2); }
    m.addImage(id, g.getImageData(0,0,s,s), {pixelRatio:2}); }
}
const NAME = ["coalesce",["get","name:pt"],["get","name_int"],["get","name"]];
function install(){
  const m = window.Sat?.map(); if(!m || m.getLayer("places")) return !!m;
  if(!m.isStyleLoaded()){ m.once("idle", install); return true; }
  addIcons(m);
  m.addLayer({id:"places", type:"symbol", source:"omt", "source-layer":"poi", minzoom:11,
    filter:["all", ["has","name"], ["in", catExpr(), ["literal", [...sel]]]],
    layout:{visibility: on ? "visible" : "none", "icon-image":["concat","poi-",catExpr()], "icon-size":["interpolate",["linear"],["zoom"],11,.55,16,.8], "icon-allow-overlap":false,
      "text-field":["step",["zoom"],"",14,NAME], "text-font":["Noto Sans Regular"], "text-size":11.5, "text-offset":[0,1.3], "text-anchor":"top", "text-optional":true, "text-max-width":9,
      "symbol-sort-key":["coalesce",["get","rank"],99]},
    paint:{"text-color":"#fff", "text-halo-color":"rgba(0,0,0,.85)", "text-halo-width":1.4}}, "measure-line");
  m.on("click", "places", e=>{ const f = e.features?.[0]; if(f) openPlace(f, e.lngLat); });
  m.on("mouseenter", "places", ()=>{ m.getCanvas().style.cursor = "pointer"; });
  m.on("mouseleave", "places", ()=>{ m.getCanvas().style.cursor = ""; });
  return true;
}
function refresh(){
  const m = window.Sat?.map(); if(!m || !m.getLayer("places")) return;
  m.setLayoutProperty("places", "visibility", on ? "visible" : "none");
  m.setFilter("places", ["all", ["has","name"], ["in", catExpr(), ["literal", [...sel]]]]);
}
function setOn(v){ on = v; store.set("places-on", on); if(!install()) return; refresh(); window.Sat?.panelRefresh?.(); }
function toggleCat(k){ sel.has(k) ? sel.delete(k) : sel.add(k); store.set("places-cats", [...sel]); refresh(); }

/* ---------- Wikipédia: artigo mais próximo cujo título lembra o nome ---------- */
const norm = s => (s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
const sim = (a, b) => { const A = new Set(norm(a).split(" ").filter(w=>w.length>2)), B = new Set(norm(b).split(" ").filter(w=>w.length>2)); if(!A.size || !B.size) return 0; let n = 0; A.forEach(w=>B.has(w)&&n++); return n/Math.min(A.size, B.size); };
async function wiki(name, lat, lon){
  for(const lang of ["pt","en"]){
    try{
      const g = await (await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}%7C${lon}&gsradius=1500&gslimit=25&format=json&origin=*`)).json();
      const best = (g.query?.geosearch || []).map(p=>({p, s:sim(name, p.title)})).filter(x=>x.s >= .5).sort((a,b)=>b.s-a.s || a.p.dist-b.p.dist)[0];
      if(!best) continue;
      const s = await (await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(best.p.title)}`)).json();
      if(s.extract) return {lang, title:s.title, text:s.extract, img:s.thumbnail?.source, url:s.content_urls?.desktop?.page, dist:best.p.dist};
    }catch(e){}
  }
  return null;
}
async function openPlace(f, ll){
  const p = f.properties || {}, name = p["name:pt"] || p.name_int || p.name, cat = ORDER.find(k=>CATS[k][3].includes(p.class) || CATS[k][3].includes(p.subclass)) || "turismo";
  const [lon, lat] = f.geometry.type==="Point" ? f.geometry.coordinates : [ll.lng, ll.lat];
  const sub = (p.subclass && p.subclass !== p.class ? p.subclass : p.class || "").replace(/_/g," ");
  const base = (w) => ({
    icon:`<span class="pl-ic" style="background:${CATS[cat][2]}">${CATS[cat][1]}</span>`, title:esc(name), sub:`${CATS[cat][0]}${sub?` · ${esc(sub)}`:""}`,
    html: `${w === undefined ? `<p class="pl-wk">Buscando na Wikipédia…</p>` : w ? `
        <div class="pl-wiki">${w.img ? `<img src="${esc(w.img)}" alt="" loading="lazy">` : ""}<div><p>${esc(w.text)}</p>
        <small>Wikipédia (${w.lang.toUpperCase()}) · “${esc(w.title)}” · artigo a ${r0(w.dist)} m</small></div></div>` : `<p class="pl-wk">Sem artigo na Wikipédia para este lugar.</p>`}
      <div class="kpis"><div class="kpi"><small>Coordenadas</small><b style="font-size:14px">${lat.toFixed(5)}, ${lon.toFixed(5)}</b></div>
        <div class="kpi"><small>Fonte do ponto</small><b style="font-size:14px">OpenStreetMap</b></div></div>`,
    actions:[
      {label:"🧭 Como chegar", primary:true, fn:()=>window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`, "_blank", "noopener")},
      ...(w?.url ? [{label:"📖 Wikipédia", fn:()=>window.open(w.url, "_blank", "noopener")}] : []),
      {label:"🔍 Aproximar", fn:()=>{ C.closeModal(); window.Sat.map().flyTo({center:[lon,lat], zoom:17, pitch:55, duration:1600}); }},
      {label:"☀ Previsão daqui", fn:()=>{ C.closeModal(); C.load({name, admin:"", country:"", lat:+lat.toFixed(4), lon:+lon.toFixed(4)}); }},
      {label:"✈ Viajar para cá", fn:()=>{ C.closeModal(); window.Travel?.setDest({name, lat, lon}); }}]
  });
  C.openModal(base(undefined));
  const w = await wiki(name, lat, lon);
  if(document.getElementById("modal")?.open) C.openModal(base(w));
}

/* ---------- seletor de categorias (no ⓘ do painel de camadas e no ☰) ---------- */
function catsHTML(){
  return `<div class="pl-cats">${ORDER.map(k=>`<button type="button" class="pl-cat" data-pc="${k}" aria-pressed="${sel.has(k)}"><span style="background:${CATS[k][2]}">${CATS[k][1]}</span>${CATS[k][0]}</button>`).join("")}</div>`;
}
document.addEventListener("click", e=>{ const b = e.target.closest("[data-pc]"); if(!b) return; toggleCat(b.dataset.pc); b.setAttribute("aria-pressed", sel.has(b.dataset.pc)); });
function openFilter(){
  C.openModal({title:"Lugares no mapa", sub:"Escolha os tipos de lugar que aparecem (a partir do zoom de cidade).", html:catsHTML(),
    actions:[{label: on ? "Ocultar lugares" : "Mostrar lugares", primary:true, fn:()=>{ setOn(!on); C.closeModal(); }}, {label:"Todos", fn:()=>{ ORDER.forEach(k=>sel.add(k)); store.set("places-cats",[...sel]); refresh(); openFilter(); }}, {label:"Nenhum", fn:()=>{ sel.clear(); store.set("places-cats",[]); refresh(); openFilter(); }}]});
}
// instala quando o mapa existir
const iv = setInterval(()=>{ if(install()) clearInterval(iv); }, 800);
/* ---------- Tour 3D: lugares com modelo detalhado (partes de prédio na Overture) ---------- */
const TOUR = [["Barcelona – Camp Nou e Eixample", 41.3809, 2.1228, 330],["Times Square – Nova York", 40.758, -73.9855, 200],["Torre Eiffel – Paris", 48.8584, 2.2945, 320],
  ["Burj Khalifa – Dubai", 25.1972, 55.2744, 300],["Allianz Arena – Munique", 48.2188, 11.6247, 40],["Santiago Bernabéu – Madri", 40.4531, -3.6883, 200],
  ["Copacabana – Rio de Janeiro", -22.9711, -43.1822, 20],["Wembley – Londres", 51.556, -0.2796, 160],["Allianz Parque – São Paulo", -23.5275, -46.6783, 250],
  ["Maracanã – Rio de Janeiro", -22.9122, -43.2302, 60],["Balneário Camboriú", -26.99, -48.632, 290]];
function tour3d(){
  C.openModal({title:"Tour 3D", sub:"Lugares com modelos 3D detalhados (arquibancadas, coberturas, torres). Toque para voar até lá.",
    html:`<div class="sim-res">${TOUR.map(([n,la,lo],i)=>`<button type="button" class="sim-d" data-tour="${i}"><b>🏟</b><span>${esc(n)}</span><em>${la.toFixed(2)}, ${lo.toFixed(2)}</em></button>`).join("")}</div>
      <p class="sim-help">O nível de detalhe depende do que a comunidade modelou no OpenStreetMap (via Overture). Interiores não existem em bases abertas — a navegação é por fora, com a câmera livre ou o simulador de voo.</p>`});
  document.querySelectorAll("#modal [data-tour]").forEach(b=>b.onclick=()=>{ const [n,la,lo,brg] = TOUR[+b.dataset.tour]; C.closeModal();
    if(document.body.dataset.view !== "sat") location.hash = "#sat";
    setTimeout(()=>{ const S = window.Sat; if(!S.isClear()) S.setProd("earth"); if(!S.isBld()) S.setBld(true);
      S.map().flyTo({center:[lo,la], zoom:16.4, pitch:68, bearing:brg, duration:3000, essential:true}); }, 350); });
}
window.Places = {tour3d, setOn, isOn: () => on, openFilter, CATS};
})();
