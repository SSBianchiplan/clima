/* =============================================================================
   VIAGEM — planeje pelo clima e abra a busca pronta nos sites de viagem.
   Não é comercial: os botões só abrem a busca já preenchida (sem afiliado,
   sem comissão). Reserva e pagamento acontecem no site escolhido.
   Clima: previsão de 16 dias (Open-Meteo) e, para datas mais distantes,
   as mesmas datas nos 3 anos anteriores (ERA5).
   ============================================================================= */
(() => {
"use strict";
const C = window.ClimaCore;
const {$, esc, icon, wmo, r0, r1, DOW, parseLocal, sum, max, min, mean} = C;
const store = {
  get(k,d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
// principais aeroportos (para escolher o mais próximo de cada cidade)
const AIRPORTS = [
  ["GRU","São Paulo (Guarulhos)",-23.432,-46.469],["CGH","São Paulo (Congonhas)",-23.626,-46.656],["VCP","Campinas",-23.007,-47.135],
  ["GIG","Rio de Janeiro (Galeão)",-22.810,-43.251],["SDU","Rio de Janeiro (Santos Dumont)",-22.910,-43.163],["BSB","Brasília",-15.871,-47.918],
  ["CNF","Belo Horizonte (Confins)",-19.624,-43.972],["VIX","Vitória",-20.258,-40.286],["FLN","Florianópolis",-27.670,-48.548],
  ["NVT","Navegantes",-26.880,-48.651],["JOI","Joinville",-26.225,-48.797],["CWB","Curitiba",-25.528,-49.176],["IGU","Foz do Iguaçu",-25.600,-54.487],
  ["POA","Porto Alegre",-29.994,-51.171],["CXJ","Caxias do Sul",-29.197,-51.188],["SSA","Salvador",-12.909,-38.322],["IOS","Ilhéus",-14.816,-39.033],
  ["BPS","Porto Seguro",-16.439,-39.081],["REC","Recife",-8.126,-34.923],["FEN","Fernando de Noronha",-3.855,-32.423],["MCZ","Maceió",-9.511,-35.792],
  ["AJU","Aracaju",-10.984,-37.070],["JPA","João Pessoa",-7.146,-34.950],["NAT","Natal",-5.769,-35.366],["FOR","Fortaleza",-3.776,-38.533],
  ["JJD","Jericoacoara",-2.907,-40.358],["THE","Teresina",-5.060,-42.824],["SLZ","São Luís",-2.585,-44.234],["BEL","Belém",-1.379,-48.476],
  ["MAO","Manaus",-3.039,-60.050],["CGB","Cuiabá",-15.653,-56.117],["CGR","Campo Grande",-20.469,-54.673],["GYN","Goiânia",-16.632,-49.221],
  ["PMW","Palmas",-10.291,-48.357],["UDI","Uberlândia",-18.884,-48.226],["RAO","Ribeirão Preto",-21.136,-47.777],["LDB","Londrina",-23.334,-51.130],
  ["MGF","Maringá",-23.480,-52.012],["CPV","Campina Grande",-7.270,-35.896],["PVH","Porto Velho",-8.709,-63.902],["RBR","Rio Branco",-9.869,-67.898],
  ["MCP","Macapá",0.051,-51.072],["BVB","Boa Vista",2.846,-60.690],["STM","Santarém",-2.425,-54.786],
  ["EZE","Buenos Aires",-34.822,-58.536],["MVD","Montevidéu",-34.838,-56.031],["SCL","Santiago",-33.393,-70.786],["LIM","Lima",-12.022,-77.114],
  ["BOG","Bogotá",4.702,-74.147],["MIA","Miami",25.793,-80.291],["MCO","Orlando",28.429,-81.309],["JFK","Nova York",40.641,-73.778],
  ["LIS","Lisboa",38.774,-9.134],["OPO","Porto",41.248,-8.681],["MAD","Madri",40.472,-3.561],["CDG","Paris",49.010,2.548],["FCO","Roma",41.800,12.239],
  ["LHR","Londres",51.470,-0.454],["CUN","Cancún",21.037,-86.877],["PUJ","Punta Cana",18.567,-68.363]
];
const km = (a,b,c,d) => { const R=6371, x=(c-a)*Math.PI/180, y=(d-b)*Math.PI/180; return 2*R*Math.asin(Math.sqrt(Math.sin(x/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(y/2)**2)); };
const nearest = (lat, lon) => AIRPORTS.map(a=>({code:a[0], name:a[1], d:km(lat,lon,a[2],a[3])})).sort((a,b)=>a.d-b.d)[0];
const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const addD = (s, n) => { const d = parseLocal(s+"T12:00"); d.setDate(d.getDate()+n); return iso(d); };
const fmtD = s => { const d = parseLocal(s+"T12:00"); return `${DOW[d.getDay()]} ${d.getDate()}/${d.getMonth()+1}`; };

const T = Object.assign({dest:null, from:null, go:addD(iso(new Date()),14), back:addD(iso(new Date()),19), ad:2, data:null, busy:false},
  store.get("trip", {}));
const save = () => store.set("trip", {dest:T.dest, go:T.go, back:T.back, ad:T.ad});
const active = () => document.body.dataset.view === "viagem";

/* ---------- links de busca (sem afiliado) ---------- */
function links(){
  const o = T.from, d = T.dest, q = encodeURIComponent, city = d.name, nights = Math.max(1, Math.round((parseLocal(T.back+"T12:00") - parseLocal(T.go+"T12:00"))/864e5));
  const oa = o ? nearest(o.lat, o.lon) : null, da = nearest(d.lat, d.lon), sameAp = oa && oa.code === da.code;
  return {oa, da, nights, groups:[
    {t:"Voos", ic:"✈", note: sameAp ? "Origem e destino usam o mesmo aeroporto — talvez não precise de voo." : `${oa?oa.code:"?"} → ${da.code} · ida ${fmtD(T.go)}, volta ${fmtD(T.back)} · ${T.ad} adulto${T.ad>1?"s":""}`, items: oa && !sameAp ? [
      ["Decolar", `https://www.decolar.com/shop/flights/results/roundtrip/${oa.code}/${da.code}/${T.go}/${T.back}/${T.ad}/0/0`],
      ["Google", `https://www.google.com/travel/flights?hl=pt-BR&q=${q(`voos de ${oa.code} para ${da.code} ida ${T.go} volta ${T.back} ${T.ad} adultos`)}`],
      ["Skyscanner", `https://www.skyscanner.com.br/transporte/passagens-aereas/${oa.code.toLowerCase()}/${da.code.toLowerCase()}/${T.go.slice(2).replace(/-/g,"")}/${T.back.slice(2).replace(/-/g,"")}/?adultsv2=${T.ad}`],
      ["Kayak", `https://www.kayak.com.br/flights/${oa.code}-${da.code}/${T.go}/${T.back}/${T.ad}adults`]] : []},
    {t:"Achar o menor preço", ic:"💲", note: oa && !sameAp ? "Telas de preço dos próprios sites: mês inteiro, datas flexíveis e alerta" : "Escolha uma origem diferente do destino.", items: oa && !sameAp ? [
      ["Mês inteiro", `https://www.skyscanner.com.br/transporte/passagens-aereas/${oa.code.toLowerCase()}/${da.code.toLowerCase()}/?oym=${T.go.slice(2,4)}${T.go.slice(5,7)}&iym=${T.back.slice(2,4)}${T.back.slice(5,7)}&adultsv2=${T.ad}`],
      ["±3 dias", `https://www.kayak.com.br/flights/${oa.code}-${da.code}/${T.go}-flexible-3days/${T.back}-flexible-3days/${T.ad}adults`],
      ["Explorar", `https://www.google.com/travel/explore?hl=pt-BR&q=${q(`voos saindo de ${oa.code}`)}`],
      ["Alerta de preço", `https://www.google.com/travel/flights?hl=pt-BR&q=${q(`voos de ${oa.code} para ${da.code} ida ${T.go} volta ${T.back}`)}`]] : []},
    {t:"Hospedagem", ic:"🏨", note:`${city} · ${nights} noite${nights>1?"s":""} · ${T.ad} hóspede${T.ad>1?"s":""}`, items:[
      ["Booking", `https://www.booking.com/searchresults.pt-br.html?ss=${q(city)}&checkin=${T.go}&checkout=${T.back}&group_adults=${T.ad}&no_rooms=1`],
      ["Airbnb", `https://www.airbnb.com.br/s/${q(city)}/homes?checkin=${T.go}&checkout=${T.back}&adults=${T.ad}`],
      ["Decolar", `https://www.decolar.com/hoteis/?q=${q(city)}`],
      ["Google", `https://www.google.com/travel/hotels/${q(city)}?hl=pt-BR&q=${q(`hotéis em ${city} ${T.go} a ${T.back}`)}`]]},
    {t:"Aluguel de carro", ic:"🚗", note:`Retirada no aeroporto ${da.code} (${da.name})`, items:[
      ["Kayak", `https://www.kayak.com.br/cars/${da.code}/${T.go}/${T.back}`],
      ["Rentcars", `https://www.rentcars.com/pt-br/`],
      ["Localiza", `https://www.localiza.com/brasil/pt-br`],
      ["Locadoras", `https://www.google.com/maps/search/${q(`aluguel de carros perto de ${da.name}`)}`]]},
    {t:"O que fazer", ic:"🧭", note:city, items:[
      ["Passeios", `https://www.google.com/search?q=${q(`o que fazer em ${city}`)}`],
      ["TripAdvisor", `https://www.tripadvisor.com.br/Search?q=${q(city)}`],
      ["Restaurantes", `https://www.google.com/maps/search/${q(`restaurantes em ${city}`)}`]]}
  ]};
}

/* ---------- clima no destino ---------- */
async function loadWx(){
  const d = T.dest; if(!d) return;
  const key = `${d.lat},${d.lon},${T.go},${T.back}`; if(T.data?.key === key || T.busy === key) return;
  T.busy = key; render();
  const today = iso(new Date()), lim = addD(today, 15);
  const out = {key, fc:null, clim:null, best:null};
  try{
    const f = await C.getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${d.lat}&longitude=${d.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,uv_index_max&forecast_days=16&timezone=auto`);
    out.fc = f.daily;
  }catch(e){}
  if(T.back > lim || T.go > lim){
    // datas além da previsão: as mesmas datas nos 3 anos anteriores
    try{
      const yrs = [1,2,3].map(n=>({a:`${+T.go.slice(0,4)-n}${T.go.slice(4)}`, b:`${+T.back.slice(0,4)-n}${T.back.slice(4)}`}));
      const rs = await Promise.all(yrs.map(y=>C.getJSON(`https://archive-api.open-meteo.com/v1/archive?latitude=${d.lat}&longitude=${d.lon}&start_date=${y.a}&end_date=${y.b}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`).catch(()=>null)));
      const D = rs.filter(Boolean).map(r=>r.daily);
      if(D.length){ const all = k => D.flatMap(x=>x[k]).filter(v=>v!=null);
        out.clim = {tmax:mean(all("temperature_2m_max")), tmin:mean(all("temperature_2m_min")), rainDays: all("precipitation_sum").filter(v=>v>=1).length/all("precipitation_sum").length*100,
          rain: mean(D.map(x=>sum(x.precipitation_sum))), n:D.length}; }
    }catch(e){}
  }
  // melhor janela de mesmo tamanho dentro dos 16 dias (menos chuva, temperatura agradável, pouca rajada)
  if(out.fc){
    const F = out.fc, L = Math.max(1, Math.round((parseLocal(T.back+"T12:00") - parseLocal(T.go+"T12:00"))/864e5)) + 1;
    const score = i => { const tx = F.temperature_2m_max[i]; return (F.precipitation_sum[i]||0)*2 + (F.precipitation_probability_max[i]||0)/20 + Math.max(0, 22-tx, tx-31)*1.2 + Math.max(0,(F.wind_gusts_10m_max[i]||0)-45)/5; };
    let best = null;
    for(let s=0; s+L<=F.time.length; s++){ let v = 0; for(let i=s;i<s+L;i++) v += score(i); if(!best || v < best.v) best = {s, v}; }
    if(best && L <= F.time.length) out.best = {go:F.time[best.s], back:F.time[best.s+L-1], v:best.v/L};
  }
  if(T.busy !== key) return;
  T.busy = false; T.data = out; render();
}

/* ---------- tela ---------- */
function render(){
  const body = $("viagem-body"); if(!body || !active()) return;
  T.from = C.S.loc;
  const d = T.dest;
  body.innerHTML = `
    <div class="xhead glass"><div class="xid">
      <div class="ava ava-trip" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M4 18l24-9-6 15-5-6-5 4v-6z"/><path d="M12 16l10-6"/></svg></div>
      <div><h2>VIAGEM</h2><div class="cargo">Planeje pelo clima · busque nos sites de viagem</div>
        <p class="bio">Escolha o destino e as datas: o sistema mostra o clima por lá e abre a busca pronta na Decolar, Booking, Airbnb, Google e locadoras. Não é comercial — a reserva e o pagamento são feitos direto no site escolhido.</p></div>
    </div>
    <form class="tr-form" id="trForm">
      <label><small>Saindo de</small><input value="${esc(T.from?.name || "")}" disabled title="Use a busca do topo para mudar a cidade de origem"></label>
      <label class="tr-dest"><small>Destino</small><input id="trQ" placeholder="Cidade, praia ou pico (ex.: Fernando de Noronha)" value="${esc(d?.name||"")}" autocomplete="off"><div class="results glass" id="trRes"></div></label>
      <label><small>Ida</small><input type="date" id="trGo" value="${T.go}" min="${iso(new Date())}"></label>
      <label><small>Volta</small><input type="date" id="trBack" value="${T.back}" min="${T.go}"></label>
      <label class="tr-n"><small>Pessoas</small><input type="number" id="trAd" min="1" max="9" value="${T.ad}"></label>
    </form></div>
    ${d ? wxSec() + linkSec() : `<div class="xload">Escolha um destino para ver o clima e abrir as buscas.</div>`}
    <p class="rg-n">Links comuns, sem afiliado. Preços, disponibilidade e pagamento ficam nos sites parceiros. Clima: Open-Meteo (previsão e ERA5).</p>`;
  wire();
  if(d) loadWx();
}
function wxSec(){
  const W = T.data, d = T.dest;
  const h = `<div class="sh"><h2>${icon("partly",26)} Clima em ${esc(d.name)} · ${fmtD(T.go)} a ${fmtD(T.back)}</h2></div>`;
  if(!W || T.busy) return h + `<div class="xload">Consultando o clima no destino…</div>`;
  let html = "";
  if(W.fc){
    const days = W.fc.time.map((t,i)=>({t,i})).filter(x=>x.t>=T.go && x.t<=T.back);
    if(days.length){ const F = W.fc;
      html += `<div class="tr-days">${days.map(({t,i})=>`<div class="tr-day glass"><b>${fmtD(t)}</b>${icon(wmo(F.weather_code[i])[1],32)}<span>${r0(F.temperature_2m_min[i])}° / <b>${r0(F.temperature_2m_max[i])}°</b></span><small>☔ ${r1(F.precipitation_sum[i])} mm · ${r0(F.precipitation_probability_max[i])}%</small><small>💨 ${r0(F.wind_gusts_10m_max[i])} km/h · UV ${r1(F.uv_index_max[i])}</small></div>`).join("")}</div>`;
      const rainy = days.filter(({i})=>F.precipitation_sum[i]>=2).length;
      html += `<p class="tr-sum">${rainy ? `Chuva relevante em <b>${rainy} de ${days.length}</b> dias.` : "Sem chuva relevante prevista nas datas."} Máximas de ${r0(min(days.map(x=>F.temperature_2m_max[x.i])))} a ${r0(max(days.map(x=>F.temperature_2m_max[x.i])))}°C.</p>`;
    }
  }
  const lim = addD(iso(new Date()), 15);
  if(T.back > lim && !W.clim) html += `<div class="tr-clim glass"><b>Parte das datas está além da previsão de 16 dias</b><p>A previsão cobre até ${fmtD(lim)}. O histórico dessas datas não pôde ser consultado agora — tente atualizar mais tarde.</p></div>`;
  if(W.clim) html += `<div class="tr-clim glass"><b>Datas além da previsão de 16 dias</b><p>Nas mesmas datas dos últimos ${W.clim.n} anos: máximas médias de <b>${r0(W.clim.tmax)}°C</b>, mínimas de <b>${r0(W.clim.tmin)}°C</b>, chuva em <b>${r0(W.clim.rainDays)}%</b> dos dias (≈ ${r0(W.clim.rain)} mm no período). É histórico, não previsão.</p></div>`;
  if(W.best && (W.best.go !== T.go)) html += `<div class="tr-best glass"><div><b>☀ Melhor janela nos próximos 16 dias</b><p>${fmtD(W.best.go)} a ${fmtD(W.best.back)} — menos chuva e temperatura mais agradável para a mesma duração.</p></div><button class="mbtn" id="trUseBest">Usar estas datas</button></div>`;
  return h + html;
}
function linkSec(){
  const L = links();
  return `<div class="sh"><h2>Buscar nos sites de viagem</h2><p>Abre em nova aba com origem, destino, datas e pessoas já preenchidos.</p></div>
    <div class="tr-groups">${L.groups.map(g=>`<div class="tr-g glass"><div class="tr-gh"><span>${g.ic}</span><b>${g.t}</b></div><small>${esc(g.note)}</small>
      <div class="tr-links">${g.items.length ? g.items.map(([n,u])=>`<a class="mbtn" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(n)} ↗</a>`).join("") : `<span class="rg-n">Escolha uma origem diferente do destino.</span>`}</div></div>`).join("")}</div>`;
}
function wire(){
  const q = $("trQ"), res = $("trRes"); let tm;
  q.oninput = () => { clearTimeout(tm); const v = q.value.trim(); if(v.length < 2){ res.style.display = "none"; return; }
    tm = setTimeout(async ()=>{ try{ const j = await C.getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(v)}&count=7&language=pt&format=json`); const R = j.results || [];
      res.innerHTML = R.map((r,k)=>`<button type="button" data-k="${k}">${esc(r.name)} <small>${esc([r.admin1,r.country].filter(Boolean).join(", "))}</small></button>`).join("") || `<button disabled>Nada encontrado</button>`;
      res.style.display = "block";
      res.querySelectorAll("[data-k]").forEach(b=>b.onclick=()=>{ const r = R[+b.dataset.k]; setDest({name:r.name, admin:r.admin1, country:r.country, lat:r.latitude, lon:r.longitude}); });
    }catch(e){} }, 300); };
  const dt = () => { T.go = $("trGo").value || T.go; T.back = $("trBack").value || T.back; if(T.back < T.go) T.back = T.go; T.ad = Math.max(1, Math.min(9, +$("trAd").value || 2)); T.data = null; save(); render(); };
  $("trGo").onchange = dt; $("trBack").onchange = dt; $("trAd").onchange = dt;
  $("trForm").onsubmit = e => e.preventDefault();
  const ub = $("trUseBest"); if(ub) ub.onclick = () => { T.go = T.data.best.go; T.back = T.data.best.back; T.data = null; save(); render(); };
}
function setDest(loc){ T.dest = loc; T.data = null; save(); if(!active()) location.hash = "#viagem"; else render(); }
addEventListener("hashchange", ()=>{ if(active()) render(); });
window.Travel = {setDest, render};
})();
