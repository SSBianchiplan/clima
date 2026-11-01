/* =============================================================================
   VULCÕES (Smithsonian GVP, 1.214 do Holoceno) e TEMPLOS ANTIGOS (Wikidata,
   fundação antes do ano 1000). Clique → modal com dados, resumo/foto e
   navegação 3D externa (Google Earth, F4map, Streets GL, OSM Buildings).
   ============================================================================= */
(() => {
"use strict";
const C = window.ClimaCore;
const {esc, r0} = C;
const store = {
  get(k,d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const st = {volc: store.get("volc-on", false), temp: store.get("temp-on", false)};
const yr = y => y == null ? "—" : y < 0 ? `${(-y).toLocaleString("pt-BR")} a.C.` : `${y}`;

// navegação 3D pública (links prontos para o ponto)
function nav3d(lat, lon, alt=600){
  return [
    ["🌍 Google Earth 3D", `https://earth.google.com/web/@${lat},${lon},${alt}a,1500d,35y,0h,65t,0r`],
    ["🏙 F4map (cidade 3D)", `https://demo.f4map.com/#lat=${lat}&lon=${lon}&zoom=17&camera.theta=65`],
    ["🛰 Streets GL", `https://streets.gl/#${lat.toFixed(5)},${lon.toFixed(5)},45.00,0.00,900.00`],
    ["🏢 OSM Buildings", `https://osmbuildings.org/?lat=${lat}&lon=${lon}&zoom=16&tilt=45`],
    ["🗺 Google Maps 3D", `https://www.google.com/maps/@${lat},${lon},800m/data=!3m1!1e3`]
  ];
}
window.Nav3D = nav3d;
const navHTML = (lat, lon, alt) => `<h4 class="msub">Navegar em 3D (sites públicos)</h4><div class="n3d">${nav3d(lat, lon, alt).map(([n,u])=>`<a class="mbtn" href="${esc(u)}" target="_blank" rel="noopener">${n} ↗</a>`).join("")}</div>`;

function triIcon(m, id, color, glyph){
  if(m.hasImage(id)) return;
  const s = 64, cv = document.createElement("canvas"); cv.width = cv.height = s; const g = cv.getContext("2d");
  g.beginPath(); g.arc(s/2, s/2, s/2-4, 0, 7); g.fillStyle = color; g.fill(); g.lineWidth = 4; g.strokeStyle = "#fff"; g.stroke();
  if(!window.IcoPaint?.(g, glyph, s/2, s/2, 30, "#fff", 2.4)){ g.font = "30px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(glyph, s/2, s/2+2); }
  m.addImage(id, g.getImageData(0,0,s,s), {pixelRatio:2});
}
function install(){
  const m = window.Sat?.map(); if(!m) return false;
  if(m.getLayer("volc")) return true;
  if(!m.isStyleLoaded()){ m.once("idle", install); return true; }
  triIcon(m, "ic-volc", "#E4422F", "🌋"); triIcon(m, "ic-temp", "#AC8E68", "🏛");
  m.addSource("volc", {type:"geojson", data:"data-volcanoes.json"});
  m.addSource("temp", {type:"geojson", data:"data-temples.json"});
  // vulcões com erupção desde 1900 ganham destaque
  m.addLayer({id:"volc", type:"symbol", source:"volc", layout:{visibility: st.volc ? "visible" : "none", "icon-image":"ic-volc",
      "icon-size":["interpolate",["linear"],["zoom"],1,["case",[">=",["coalesce",["get","y"],-1e9],1900],.42,.28],8,.75], "icon-allow-overlap":true,
      "symbol-sort-key":["-",0,["coalesce",["get","y"],-1e9]],
      "text-field":["step",["zoom"],"",5,["concat",["get","n"],"\n",["case",["has","e"],["concat",["to-string",["get","e"]]," m"],""]]],
      "text-font":["Noto Sans Bold"], "text-size":11, "text-offset":[0,1.4], "text-anchor":"top", "text-optional":true},
    paint:{"text-color":"#FFD0C8", "text-halo-color":"rgba(0,0,0,.85)", "text-halo-width":1.4}}, "measure-line");
  m.addLayer({id:"temp", type:"symbol", source:"temp", layout:{visibility: st.temp ? "visible" : "none", "icon-image":"ic-temp",
      "icon-size":["interpolate",["linear"],["zoom"],2,.32,10,.75], "icon-allow-overlap":false,
      "text-field":["step",["zoom"],"",6,["get","n"]], "text-font":["Noto Sans Regular"], "text-size":11, "text-offset":[0,1.4], "text-anchor":"top", "text-optional":true},
    paint:{"text-color":"#F0DFC4", "text-halo-color":"rgba(0,0,0,.85)", "text-halo-width":1.4}}, "measure-line");
  for(const id of ["volc","temp"]){
    m.on("click", id, e=>{ const f = e.features?.[0]; if(f) (id==="volc" ? volcModal : templeModal)(f); });
    m.on("mouseenter", id, ()=>{ m.getCanvas().style.cursor = "pointer"; });
    m.on("mouseleave", id, ()=>{ m.getCanvas().style.cursor = ""; });
  }
  return true;
}
const iv = setInterval(()=>{ if(install()) clearInterval(iv); }, 800);
function set(k, v){ st[k] = v; store.set(k + "-on", v); const m = window.Sat?.map(); if(!m || !install()) return; m.setLayoutProperty(k, "visibility", v ? "visible" : "none"); }

function volcModal(f){
  const p = f.properties, [lon, lat] = f.geometry.coordinates;
  C.openModal({icon:`<span class="pl-ic" style="background:#E4422F">🌋</span>`, title:esc(p.n), sub:esc([p.t, p.r, p.k].filter(Boolean).join(" · ")),
    kpis:[["Altitude", p.e != null ? (+p.e).toLocaleString("pt-BR") : "—", "m"], ["Última erupção", yr(p.y), ""], ["Tipo", esc(p.t || "—"), ""], ["Coordenadas", `${lat.toFixed(3)}, ${lon.toFixed(3)}`, ""]],
    html:`${p.ph ? `<img class="gv-ph" src="${esc(p.ph)}" alt="" loading="lazy" onerror="this.remove()">` : ""}<p class="gv-s">${esc(p.s || "")}</p>
      <p class="cam-src">Fonte: Smithsonian Institution, Global Volcanism Program (Volcanoes of the World).</p>${navHTML(lat, lon, (+p.e||500)+800)}`,
    actions:[{label:"⛰ Ver em 3D aqui", primary:true, fn:()=>{ C.closeModal(); const S = window.Sat; if(!S.isClear()) S.setProd("earth"); S.map().flyTo({center:[lon,lat], zoom:12.5, pitch:68, bearing:30, duration:2600}); }},
      {label:"📖 Página no Smithsonian", fn:()=>window.open(`https://volcano.si.edu/volcano.cfm?vn=${p.id}`, "_blank", "noopener")},
      {label:"☀ Previsão daqui", fn:()=>{ C.closeModal(); C.load({name:p.n, admin:"", country:p.k||"", lat:+lat.toFixed(4), lon:+lon.toFixed(4)}); }}]});
}
async function templeModal(f){
  const p = f.properties, [lon, lat] = f.geometry.coordinates;
  const base = w => ({icon:`<span class="pl-ic" style="background:#AC8E68">🏛</span>`, title:esc(p.n), sub:esc([`fundado em ${yr(p.y)}`, p.k].filter(Boolean).join(" · ")),
    kpis:[["Fundação", yr(p.y), ""], ["País", esc(p.k || "—"), ""], ["Coordenadas", `${lat.toFixed(4)}, ${lon.toFixed(4)}`, ""]],
    html:`${w===undefined ? `<p class="pl-wk">Buscando na Wikipédia…</p>` : w ? `<div class="pl-wiki">${w.img?`<img src="${esc(w.img)}" alt="" loading="lazy">`:""}<div><p>${esc(w.text)}</p><small>Wikipédia</small></div></div>` : ""}${navHTML(lat, lon, 400)}`,
    actions:[{label:"🔍 Ver em 3D aqui", primary:true, fn:()=>{ C.closeModal(); const S = window.Sat; if(!S.isClear()) S.setProd("earth"); S.map().flyTo({center:[lon,lat], zoom:16.5, pitch:65, duration:2400}); }},
      {label:"📖 Wikidata", fn:()=>window.open(`https://www.wikidata.org/wiki/${p.wd}`, "_blank", "noopener")},
      ...(w?.url ? [{label:"📖 Wikipédia", fn:()=>window.open(w.url, "_blank", "noopener")}] : []),
      {label:"✈ Viajar para cá", fn:()=>{ C.closeModal(); window.Travel?.setDest({name:p.n, lat, lon}); }}]});
  C.openModal(base(undefined));
  let w = null;
  try{ const u = p.wp ? p.wp : null;
    const title = u ? decodeURIComponent(u.split("/wiki/")[1]) : null;
    const lang = u ? "pt" : "en";
    const s = await (await fetch(title ? `https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
      : `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${p.wd}&props=sitelinks&format=json&origin=*`)).json();
    if(s.extract) w = {text:s.extract, img:s.thumbnail?.source, url:s.content_urls?.desktop?.page};
    else { const en = s.entities?.[p.wd]?.sitelinks?.enwiki?.title; if(en){ const e = await (await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(en)}`)).json(); if(e.extract) w = {text:e.extract, img:e.thumbnail?.source, url:e.content_urls?.desktop?.page}; } }
  }catch(e){}
  if(document.getElementById("modal")?.open) C.openModal(base(w));
}
window.Geo = {set, isOn: k => st[k], volcModal, templeModal};
})();
