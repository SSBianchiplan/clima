/* =============================================================================
   LABORATÓRIO — análises e gráficos avançados.
   Ensemble ECMWF (51 membros, 15 dias), perfil vertical em níveis de pressão,
   climatologia ERA5 2015–2024, mapa de calor hora × dia, rosa dos ventos e
   balanço hídrico. Carrega só quando o módulo é aberto.
   ============================================================================= */
(() => {
"use strict";
const C = window.ClimaCore;
const {$, css, esc, r0, r1, fmtH, DOW, parseLocal, sum, max, min, mean, getJSON, mk, FONT, dayL, whenL} = C;
const L = {loc:null, ens:null, lv:null, key:null, busy:false, hour:0, heat:"temp"};
const LEVELS = [1000,925,850,700,500,300,200];

const urlEns = l => `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${l.lat}&longitude=${l.lon}&hourly=temperature_2m,precipitation&models=ecmwf_ifs025&forecast_days=15&timezone=auto`;
const urlLv = l => `https://api.open-meteo.com/v1/forecast?latitude=${l.lat}&longitude=${l.lon}&hourly=${LEVELS.flatMap(p=>[`temperature_${p}hPa`,`relative_humidity_${p}hPa`,`geopotential_height_${p}hPa`,`wind_speed_${p}hPa`,`wind_direction_${p}hPa`]).join(",")},freezing_level_height&forecast_days=3&timezone=auto`;

/* ---------- estatística ---------- */
const q = (arr, p) => { const a = arr.filter(v=>v!=null).sort((x,y)=>x-y); if(!a.length) return null; const i = (a.length-1)*p, lo = Math.floor(i); return a[lo] + (a[Math.min(lo+1,a.length-1)]-a[lo])*(i-lo); };
const pctRank = (arr, v) => { const a = arr.filter(x=>x!=null); return a.length ? a.filter(x=>x<=v).length/a.length*100 : null; };
const sd = a => { const m = mean(a), f = a.filter(v=>v!=null); return f.length>1 ? Math.sqrt(sum(f.map(v=>(v-m)**2))/(f.length-1)) : 0; };
const dewFrom = (T,RH) => { const a=17.62, b=243.12, g=Math.log(Math.max(RH,1)/100)+a*T/(b+T); return b*g/(a-g); };
const doy = d => Math.floor((d - new Date(d.getFullYear(),0,0))/864e5);

/* paletas para o mapa de calor */
const RAMPS = {
  temp: ["#3B4CC0","#5D8FE8","#7FC8F0","#9BE0B4","#F4E46A","#F7A541","#E4572E","#A8201A"],
  rain: ["rgba(14,134,184,0)","#BFE3F5","#6FC0E8","#2E8FD0","#1F5FB0","#3B2D8F"],
  wind: ["rgba(31,154,110,.15)","#7AD39A","#F2D64B","#F59A2F","#E4422F","#8E1F5A"],
  hum:  ["#F5D7A1","#D9E8C9","#9FD3C7","#5AA9C9","#2E6FA8"],
  uv:   ["rgba(62,196,109,.15)","#3EC46D","#F5D33B","#F59A2F","#E4422F","#A54BD8"],
  cape: ["rgba(201,138,12,0)","#F7E3A1","#F2BE46","#E8702A","#C0392B","#6B1F7A"]
};
const HEATVARS = {
  temp:{nome:"Temperatura", a:"temperature_2m", u:"°C", dom:null, ramp:"temp", fmt:r0},
  rain:{nome:"Probabilidade de chuva", a:"precipitation_probability", u:"%", dom:[0,100], ramp:"rain", fmt:r0},
  wind:{nome:"Rajada", a:"wind_gusts_10m", u:"km/h", dom:[0,80], ramp:"wind", fmt:r0},
  hum: {nome:"Umidade relativa", a:"relative_humidity_2m", u:"%", dom:[30,100], ramp:"hum", fmt:r0},
  uv:  {nome:"Índice UV", a:"uv_index", u:"", dom:[0,11], ramp:"uv", fmt:r1},
  cape:{nome:"CAPE", a:"cape", u:"J/kg", dom:[0,2500], ramp:"cape", fmt:r0}
};
const parseCol = c => { if(c.startsWith("#")) return [parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16),1]; const m = c.match(/[\d.]+/g).map(Number); return [m[0],m[1],m[2],m[3]??1]; };
function ramp(name, t){
  const st = RAMPS[name].map(parseCol), x = Math.max(0,Math.min(1,t))*(st.length-1), i = Math.min(Math.floor(x), st.length-2), f = x-i;
  const c = st[i].map((v,k)=>v+(st[i+1][k]-v)*f);
  return `rgba(${r0(c[0])},${r0(c[1])},${r0(c[2])},${c[3].toFixed(2)})`;
}

/* ---------- carga (preguiçosa) ---------- */
const active = () => document.body.dataset.view === "lab";
function setLoc(loc){ L.loc = loc; if(active()) ensure(); else L.key = null; }
async function ensure(){
  if(!L.loc || !C.S.fc) return;
  const key = `${L.loc.lat},${L.loc.lon}`;
  if(L.key === key){ render(); return; }
  if(L.busy === key) return;
  L.busy = key;
  $("lab-body").innerHTML = `<div class="xload">Rodando 51 cenários do ensemble e o perfil vertical para ${esc(L.loc.name)}…</div>`;
  const [e, v] = await Promise.allSettled([getJSON(urlEns(L.loc)), getJSON(urlLv(L.loc))]);
  if(L.busy !== key) return;
  L.busy = false; L.key = key;
  L.ens = e.status==="fulfilled" ? e.value.hourly : null;
  L.lv  = v.status==="fulfilled" ? v.value.hourly : null;
  const t0 = C.S.fc.current.time.slice(0,13)+":00";
  L.hour = L.lv ? Math.max(0, L.lv.time.indexOf(t0)) : 0;
  render();
}
addEventListener("hashchange", ()=>{ if(active()) ensure(); });

/* ---------- análises ---------- */
function ensembleStats(){
  const E = L.ens; if(!E) return null;
  const tk = Object.keys(E).filter(k=>k.startsWith("temperature_2m")), pk = Object.keys(E).filter(k=>k.startsWith("precipitation"));
  const today = C.S.fc.current.time.slice(0,10);
  const days = [...new Set(E.time.map(t=>t.slice(0,10)))].filter(d=>d>=today);
  const perDay = days.map(d=>{
    const ix = E.time.map((t,i)=>t.startsWith(d)?i:-1).filter(i=>i>=0);
    const tmax = tk.map(k=>max(ix.map(i=>E[k][i]))).filter(v=>isFinite(v));
    const rain = pk.map(k=>sum(ix.map(i=>E[k][i])));
    return {d, tmax, rain, sdT: sd(tmax), p1: rain.filter(r=>r>=1).length/rain.length*100, p10: rain.filter(r=>r>=10).length/rain.length*100, p25: rain.filter(r=>r>=25).length/rain.length*100, rMed: q(rain,.5), r90: q(rain,.9)};
  });
  const n = pk.length;
  const week = pk.map(k=>sum(E.time.map((t,i)=>t>=today && t<addDays(today,7) ? E[k][i] : 0)));
  const horizon = perDay.findIndex(x=>x.sdT>2.5);
  return {tk, pk, n, perDay, week, horizon, P10w: week.filter(r=>r>=10).length/n*100, P50w: week.filter(r=>r>=50).length/n*100, wMed:q(week,.5), w10:q(week,.1), w90:q(week,.9)};
}
function addDays(d, n){ const x = parseLocal(d+"T00:00"); x.setDate(x.getDate()+n); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`; }

function climStats(){
  const Cl = C.S.clim; if(!Cl || !Cl.daily) return null;
  const d = C.S.fc.daily, start = d.time.indexOf(C.S.fc.current.time.slice(0,10)), D = Cl.daily;
  const cdoy = D.time.map(t=>doy(parseLocal(t)));
  return d.time.slice(start).map((t,k)=>{
    const td = doy(parseLocal(t)), mx=[], mn=[];
    cdoy.forEach((c,i)=>{ let df = Math.abs(c-td); df = Math.min(df, 366-df); if(df<=7){ mx.push(D.temperature_2m_max[i]); mn.push(D.temperature_2m_min[i]); } });
    const fx = d.temperature_2m_max[start+k], fn = d.temperature_2m_min[start+k];
    return {t, mx10:q(mx,.1), mx50:q(mx,.5), mx90:q(mx,.9), mn10:q(mn,.1), mn50:q(mn,.5), mn90:q(mn,.9), fx, fn, pX:pctRank(mx,fx), pN:pctRank(mn,fn), n:mx.length};
  });
}

function profileAt(j){
  const V = L.lv; if(!V || !V.time[j]) return null;
  const elev = C.S.fc.elevation || 0;
  const pts = LEVELS.map(p=>({p, T:V[`temperature_${p}hPa`][j], RH:V[`relative_humidity_${p}hPa`][j], z:V[`geopotential_height_${p}hPa`][j], ws:V[`wind_speed_${p}hPa`][j], wd:V[`wind_direction_${p}hPa`][j]}))
    .filter(x=>x.T!=null && x.z!=null).map(x=>({...x, Td: dewFrom(x.T,x.RH)}));
  const g = p => pts.find(x=>x.p===p) || {};
  const K = (g(850).T-g(500).T) + g(850).Td - (g(700).T-g(700).Td);
  const TT = g(850).T + g(850).Td - 2*g(500).T;
  const lapse = (g(850).T-g(500).T)/((g(500).z-g(850).z)/1000);
  const vec = x => [-x.ws*Math.sin(x.wd*Math.PI/180), -x.ws*Math.cos(x.wd*Math.PI/180)];
  const lo = g(925).ws!=null ? g(925) : g(850), [u1,v1] = vec(lo), [u2,v2] = vec(g(500));
  const shear = Math.hypot(u2-u1, v2-v1)/3.6;
  return {t:V.time[j], pts: pts.filter(x=>x.z>=elev-50), K, TT, lapse, shear, fl:V.freezing_level_height?.[j]};
}
const kCat = k => k<20 ? ["sem trovoada","var(--dew)"] : k<26 ? ["trovoadas isoladas","var(--warn)"] : k<31 ? ["trovoadas esparsas","var(--heat)"] : k<36 ? ["trovoadas frequentes","var(--danger)"] : ["trovoadas generalizadas","var(--storm)"];
const ttCat = t => t<44 ? ["convecção fraca","var(--dew)"] : t<50 ? ["trovoadas prováveis","var(--warn)"] : t<56 ? ["tempestades severas isoladas","var(--danger)"] : ["tempestades severas","var(--storm)"];

/* ---------- renderização ---------- */
function render(){
  const body = $("lab-body"); if(!body || !C.S.fc || !active()) return;
  if(L.key !== `${L.loc?.lat},${L.loc?.lon}`){ ensure(); return; }
  const ES = ensembleStats(), CS = climStats(), PR = profileAt(L.hour);
  const d = C.S.fc.daily, start = d.time.indexOf(C.S.fc.current.time.slice(0,10));

  // síntese automática
  const read = [], kpi = [];
  if(ES){
    const hz = ES.horizon<0 ? `todos os ${ES.perDay.length} dias` : ES.horizon===0 ? "nem hoje" : `até ${dayL(ES.perDay[ES.horizon-1].d+"T00:00")}`;
    read.push(`<b>Confiança.</b> Os ${ES.n} membros do ECMWF mantêm a máxima diária com dispersão abaixo de ±2,5°C ${hz}. ${ES.horizon>=0&&ES.horizon<8?"Depois disso, trate a previsão como tendência, não como número.":"Horizonte longo: padrão atmosférico estável e bem resolvido."}`);
    read.push(`<b>Chuva em 7 dias.</b> Mediana de ${r0(ES.wMed)} mm (P10–P90: ${r0(ES.w10)}–${r0(ES.w90)} mm). ${r0(ES.P10w)}% dos cenários passam de 10 mm e ${r0(ES.P50w)}% passam de 50 mm.`);
    kpi.push(["Horizonte confiável", ES.horizon<0 ? `${ES.perDay.length}+` : ES.horizon, "dias", "σ da máxima ≤ 2,5°C"]);
    kpi.push(["P(chuva ≥ 10 mm, 7 d)", r0(ES.P10w), "%", `${ES.n} cenários`]);
    kpi.push(["Chuva 7 d (mediana)", r0(ES.wMed), "mm", `P90 ${r0(ES.w90)} mm`]);
  }
  if(CS){
    const nx = CS.slice(1,8), ext = nx.reduce((a,b)=>Math.abs(b.pX-50)>Math.abs(a.pX-50)?b:a, nx[0]);
    if(ext) read.push(`<b>Clima.</b> O dia mais fora do normal da semana é ${dayL(ext.t+"T00:00")}: máxima de ${r0(ext.fx)}°C, no <b>percentil ${r0(ext.pX)}</b> da série 2015–2024 para a época${ext.pX>=90?" — calor incomum":ext.pX<=10?" — frio incomum":""}.`);
    kpi.push(["Percentil da máx. amanhã", CS[1] ? r0(CS[1].pX) : "—", "", CS[1] ? `${r0(CS[1].fx)}°C vs mediana ${r0(CS[1].mx50)}°C` : ""]);
  }
  if(PR){
    const [kc] = kCat(PR.K), [tc] = ttCat(PR.TT);
    read.push(`<b>Coluna atmosférica (${whenL(PR.t)}).</b> Índice K ${r0(PR.K)} (${kc}), Total Totals ${r0(PR.TT)} (${tc}), gradiente 850–500 hPa de ${r1(PR.lapse)}°C/km${PR.lapse>=7?" — ar condicionalmente instável":""}, cisalhamento 0–6 km de ${r0(PR.shear)} m/s${PR.shear>=20?" — suficiente para organizar tempestades":""}. Isoterma de 0°C a ${PR.fl!=null?r1(PR.fl/1000)+" km":"—"}.`);
    kpi.push(["Índice K", r0(PR.K), "", kCat(PR.K)[0], kCat(PR.K)[1]]);
    kpi.push(["Total Totals", r0(PR.TT), "", ttCat(PR.TT)[0], ttCat(PR.TT)[1]]);
    kpi.push(["Isoterma 0°C", PR.fl!=null ? r1(PR.fl/1000) : "—", "km", "nível de congelamento"]);
  }
  const rain16 = sum(d.precipitation_sum.slice(start)), et16 = sum(d.et0_fao_evapotranspiration.slice(start));
  read.push(`<b>Água em 16 dias.</b> ${r0(rain16)} mm de chuva contra ${r0(et16)} mm de evapotranspiração: saldo de ${rain16-et16>=0?"+":""}${r0(rain16-et16)} mm.`);
  kpi.push(["Saldo hídrico 16 d", (rain16-et16>=0?"+":"")+r0(rain16-et16), "mm", `chuva ${r0(rain16)} · ET₀ ${r0(et16)}`, rain16-et16<-30?"var(--danger)":null]);

  body.innerHTML = `
    <div class="xhead glass lab-head">
      <div class="xid">
        <div class="ava ava-lab" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M12 4h8M13 4v8L6 25a2.5 2.5 0 0 0 2.2 3.7h15.6A2.5 2.5 0 0 0 26 25l-7-13V4"/><path d="M9.5 20h13"/></svg></div>
        <div><h2>LABORATÓRIO</h2><div class="cargo">Análises avançadas · ${esc(L.loc.name)}</div><p class="bio">Ensemble de 51 cenários, perfil vertical, climatologia de 10 anos. O que um número só não mostra.</p></div>
      </div>
      <div class="kpis lab-kpis">${kpi.map(([l,v,u,s,col])=>`<div class="kpi"><small>${l}</small><b${col?` style="color:${col}"`:""}>${v}${u?`<em>${u}</em>`:""}</b>${s?`<span>${s}</span>`:""}</div>`).join("")}</div>
      <div class="lab-read">${read.map(p=>`<p>${p}</p>`).join("")}</div>
    </div>

    <section class="lab-sec"><div class="sh"><h2>Pluma de ensemble · temperatura</h2><p>Cada linha fina é um cenário do ECMWF. A faixa cobre de P10 a P90; a linha cheia é a mediana; o tracejado é a previsão determinística. Pluma aberta = incerteza.</p></div>
      <div class="card glass"><div class="cv" style="height:300px">${ES?`<canvas id="lPlume"></canvas>`:`<div class="xload">Ensemble indisponível.</div>`}</div></div></section>

    <div class="two">
      <section class="lab-sec"><div class="sh"><h2>Probabilidade de chuva por limiar</h2><p>Fração dos ${ES?ES.n:"—"} cenários que passam de 1, 10 e 25 mm no dia; a linha é a mediana do total.</p></div>
        <div class="card glass"><div class="cv" style="height:260px">${ES?`<canvas id="lRainP"></canvas>`:""}</div></div></section>
      <section class="lab-sec"><div class="sh"><h2>Rosa dos ventos · 7 dias</h2><p>Frequência por direção de origem e faixa de velocidade.</p></div>
        <div class="card glass rose-card">${windRose()}</div></section>
    </div>

    <section class="lab-sec"><div class="sh"><h2>Mapa de calor · hora × dia</h2><p>16 dias de previsão horária num quadro. Toque numa célula para abrir a hora.</p>
      <div class="seg txt" role="group" aria-label="Variável" id="heatSeg">${Object.entries(HEATVARS).map(([k,v])=>`<button data-h="${k}" aria-pressed="${k===L.heat}">${v.nome.split(" ")[0]==="Probabilidade"?"Chuva":v.nome.split(" ")[0]}</button>`).join("")}</div></div>
      <div class="card glass heat-card">${heatmap()}</div></section>

    <section class="lab-sec"><div class="sh"><h2>Previsão contra a climatologia</h2><p>Faixas: P10–P90 de máximas e mínimas observadas (ERA5, 2015–2024, ±7 dias da data). Pontos: previsão. Passe o cursor para ver o percentil.</p></div>
      <div class="card glass"><div class="cv" style="height:300px">${CS?`<canvas id="lClim"></canvas>`:`<div class="xload">Climatologia ainda carregando — volte em instantes.</div>`}</div></div></section>

    <div class="two">
      <section class="lab-sec"><div class="sh"><h2>Perfil vertical</h2><p>Temperatura e ponto de orvalho por altitude. Linhas próximas = ar saturado (nuvem); afastadas = ar seco.</p></div>
        <div class="card glass">${PR?`<div class="prof-ctl"><input type="range" id="profH" min="0" max="${L.lv.time.length-1}" value="${L.hour}" aria-label="Hora do perfil"><b id="profT">${whenL(PR.t)}</b></div>
          <div class="cv" style="height:320px"><canvas id="lProf"></canvas></div>`:`<div class="xload">Perfil indisponível.</div>`}</div></section>
      <section class="lab-sec"><div class="sh"><h2>Índices de instabilidade · 72 h</h2><p>K e Total Totals hora a hora. Acima das linhas de referência, o potencial de trovoada sobe.</p></div>
        <div class="card glass">${PR?`<div class="cv" style="height:220px"><canvas id="lIdx"></canvas></div>
          <table class="idx"><thead><tr><th>Índice</th><th>Valor</th><th>Leitura</th></tr></thead><tbody id="idxTbl"></tbody></table>`:""}</div></section>
    </div>

    <section class="lab-sec"><div class="sh"><h2>Balanço hídrico acumulado · 16 dias</h2><p>Chuva acumulada contra evapotranspiração de referência acumulada. Área verde: sobra água; vermelha: o solo perde mais do que recebe.</p></div>
      <div class="card glass"><div class="cv" style="height:240px"><canvas id="lWater"></canvas></div></div></section>`;

  if(ES) drawPlume(ES), drawRainP(ES);
  if(CS) drawClim(CS);
  if(PR) drawProfile(PR), drawIdx(), fillIdx(PR);
  drawWater(start);

  body.querySelectorAll("#heatSeg button").forEach(b=>b.onclick=()=>{ L.heat = b.dataset.h; body.querySelectorAll("#heatSeg button").forEach(x=>x.setAttribute("aria-pressed", x===b)); body.querySelector(".heat-card").innerHTML = heatmap(); });
  body.querySelector(".heat-card").onclick = e => { const c = e.target.closest("[data-hi]"); if(c) C.openHour(+c.dataset.hi); };
  const rng = $("profH");
  if(rng) rng.oninput = () => { L.hour = +rng.value; const P = profileAt(L.hour); if(!P) return; $("profT").textContent = whenL(P.t); drawProfile(P); fillIdx(P); C.mk("lIdx", idxCfg()); };
}

/* ---------- gráficos ---------- */
function opts(extra={}){
  const grid = css("--grid"), tick = css("--ink-3");
  const o = {responsive:true, maintainAspectRatio:false, animation:false, interaction:{mode:"index",intersect:false},
    plugins:{legend:{display:false}, tooltip:{backgroundColor:css("--glass-strong"),titleColor:css("--ink"),bodyColor:css("--ink-2"),borderColor:css("--line"),borderWidth:1,cornerRadius:10,padding:10,titleFont:{family:FONT,weight:"600"},bodyFont:{family:FONT}}},
    scales:{x:{grid:{color:grid,drawTicks:false},border:{display:false},ticks:{color:tick,font:{family:FONT,size:11},maxRotation:0}},
            y:{grid:{color:grid},border:{display:false},ticks:{color:tick,font:{family:FONT,size:11},maxTicksLimit:6}}}};
  return deepMerge(o, extra);
}
function deepMerge(a,b){ Object.entries(b).forEach(([k,v])=>{ a[k] = v && typeof v==="object" && !Array.isArray(v) && typeof a[k]==="object" && a[k] ? deepMerge(a[k],v) : v; }); return a; }
const legend = {display:true,position:"bottom",labels:{color:css("--ink-2"),usePointStyle:true,pointStyle:"circle",boxWidth:7,boxHeight:7,font:{family:FONT,size:11}}};

function drawPlume(ES){
  const E = L.ens, today = C.S.fc.current.time.slice(0,10);
  const ix = E.time.map((t,i)=>i).filter(i=>E.time[i]>=today+"T00:00" && +E.time[i].slice(11,13)%3===0);
  const T = ix.map(i=>E.time[i]), heat = css("--heat");
  const members = ES.tk.filter(k=>k!=="temperature_2m").map(k=>({data:ix.map(i=>E[k][i]), borderColor:heat+"26", borderWidth:.7, pointRadius:0, tension:.3, member:true}));
  const all = ix.map(i=>ES.tk.map(k=>E[k][i]));
  const p10 = all.map(a=>q(a,.1)), p50 = all.map(a=>q(a,.5)), p90 = all.map(a=>q(a,.9));
  const fc = C.S.fc.hourly, det = T.map(t=>{ const j = fc.time.indexOf(t); return j<0 ? null : fc.temperature_2m[j]; });
  const nowT = C.S.fc.current.time.slice(0,13)+":00", nowI = T.findIndex(t=>t>=nowT);
  mk("lPlume", {type:"line", data:{labels:T, datasets:[...members,
      {label:"P90", data:p90, borderColor:heat+"80", borderWidth:1, pointRadius:0, tension:.3, fill:"+1", backgroundColor:heat+"26"},
      {label:"P10", data:p10, borderColor:heat+"80", borderWidth:1, pointRadius:0, tension:.3},
      {label:"mediana do ensemble", data:p50, borderColor:heat, borderWidth:2.6, pointRadius:0, tension:.3},
      {label:"determinística", data:det, borderColor:css("--ink"), borderWidth:1.4, borderDash:[5,4], pointRadius:0, tension:.3}]},
    options:opts({plugins:{legend:{...legend, labels:{...legend.labels, filter:it=>!/^P\d/.test(it.text) && it.text}}, tooltip:{filter:it=>!it.dataset.member, callbacks:{title:it=>whenL(T[it[0].dataIndex]), label:it=>`${it.dataset.label}: ${r1(it.raw)}°C`}}},
      scales:{x:{ticks:{autoSkip:false, callback:v=>{ const t=T[v]; return t && t.slice(11,13)==="00" ? dayL(t) : null; }}}, y:{ticks:{callback:v=>v+"°"}}}}),
    plugins:[marker(nowI)]});
}
function drawRainP(ES){
  const D = ES.perDay, lab = D.map(x=>dayL(x.d+"T00:00"));
  mk("lRainP", {type:"bar", data:{labels:lab, datasets:[
      {label:"≥ 1 mm", data:D.map(x=>x.p1), backgroundColor:css("--rain")+"55", borderRadius:3, yAxisID:"y"},
      {label:"≥ 10 mm", data:D.map(x=>x.p10), backgroundColor:css("--rain")+"AA", borderRadius:3, yAxisID:"y"},
      {label:"≥ 25 mm", data:D.map(x=>x.p25), backgroundColor:css("--storm"), borderRadius:3, yAxisID:"y"},
      {type:"line", label:"mediana (mm)", data:D.map(x=>x.rMed), borderColor:css("--ink"), borderWidth:1.6, pointRadius:2, tension:.3, yAxisID:"y2"}]},
    options:opts({plugins:{legend, tooltip:{callbacks:{label:it=>it.dataset.yAxisID==="y2" ? `mediana: ${r1(it.raw)} mm (P90 ${r1(D[it.dataIndex].r90)})` : `${it.dataset.label}: ${r0(it.raw)}% dos cenários`}}},
      scales:{x:{ticks:{autoSkip:true,maxTicksLimit:8}}, y:{min:0,max:100,ticks:{callback:v=>v+"%"}}, y2:{position:"right",beginAtZero:true,grid:{display:false},border:{display:false},ticks:{color:css("--ink-3"),font:{family:FONT,size:11},callback:v=>v+" mm"}}}})});
}
function drawClim(CS){
  const lab = CS.map(x=>dayL(x.t+"T00:00")), heat = css("--heat"), cold = css("--cold");
  const pcol = p => p>=90 ? css("--danger") : p>=75 ? heat : p<=10 ? css("--storm") : p<=25 ? cold : css("--ink-2");
  mk("lClim", {type:"line", data:{labels:lab, datasets:[
      {label:"máx P90", data:CS.map(x=>x.mx90), borderWidth:0, pointRadius:0, fill:"+1", backgroundColor:heat+"22", tension:.3},
      {label:"máx P10", data:CS.map(x=>x.mx10), borderWidth:0, pointRadius:0, tension:.3},
      {label:"mín P90", data:CS.map(x=>x.mn90), borderWidth:0, pointRadius:0, fill:"+1", backgroundColor:cold+"22", tension:.3},
      {label:"mín P10", data:CS.map(x=>x.mn10), borderWidth:0, pointRadius:0, tension:.3},
      {label:"mediana histórica máx.", data:CS.map(x=>x.mx50), borderColor:heat+"99", borderDash:[4,4], borderWidth:1.2, pointRadius:0, tension:.3},
      {label:"mediana histórica mín.", data:CS.map(x=>x.mn50), borderColor:cold+"99", borderDash:[4,4], borderWidth:1.2, pointRadius:0, tension:.3},
      {label:"máxima prevista", data:CS.map(x=>x.fx), borderColor:heat, borderWidth:2, pointRadius:5, pointHoverRadius:7, pointBackgroundColor:CS.map(x=>pcol(x.pX)), pointBorderColor:"#fff", pointBorderWidth:1.5, tension:.3},
      {label:"mínima prevista", data:CS.map(x=>x.fn), borderColor:cold, borderWidth:2, pointRadius:5, pointHoverRadius:7, pointBackgroundColor:CS.map(x=>pcol(x.pN)), pointBorderColor:"#fff", pointBorderWidth:1.5, tension:.3}]},
    options:opts({plugins:{legend:{...legend, labels:{...legend.labels, filter:it=>!/P\d0/.test(it.text)}},
      tooltip:{filter:it=>!/P\d0/.test(it.dataset.label), callbacks:{label:it=>{ const x = CS[it.dataIndex];
        if(it.dataset.label==="máxima prevista") return `máxima ${r1(x.fx)}°C · percentil ${r0(x.pX)} (P10–P90 ${r0(x.mx10)}–${r0(x.mx90)}°C)`;
        if(it.dataset.label==="mínima prevista") return `mínima ${r1(x.fn)}°C · percentil ${r0(x.pN)} (P10–P90 ${r0(x.mn10)}–${r0(x.mn90)}°C)`;
        return `${it.dataset.label}: ${r1(it.raw)}°C`; }}}},
      scales:{x:{ticks:{autoSkip:true,maxTicksLimit:9}}, y:{ticks:{callback:v=>v+"°"}}}})});
}
function drawProfile(P){
  const heat = css("--heat"), dew = css("--dew"), top = 12.5;
  const T = P.pts.map(x=>({x:x.T, y:x.z/1000, p:x.p, ws:x.ws, wd:x.wd})), Td = P.pts.map(x=>({x:x.Td, y:x.z/1000, p:x.p}));
  const xs = [...T, ...Td].map(v=>v.x), xmin = Math.floor((Math.min(...xs)-5)/10)*10, xmax = Math.ceil((Math.max(...xs)+5)/10)*10;
  mk("lProf", {type:"scatter", data:{datasets:[
      {label:"temperatura", data:T, showLine:true, borderColor:heat, backgroundColor:heat, borderWidth:2.4, pointRadius:3.5},
      {label:"ponto de orvalho", data:Td, showLine:true, borderColor:dew, backgroundColor:dew, borderWidth:2, pointRadius:3, borderDash:[5,3]},
      {label:"0°C", data:[{x:0,y:0},{x:0,y:top}], showLine:true, borderColor:css("--cold")+"88", borderWidth:1, borderDash:[2,3], pointRadius:0},
      ...(P.fl!=null ? [{label:"isoterma 0°C", data:[{x:xmin,y:P.fl/1000},{x:xmax,y:P.fl/1000}], showLine:true, borderColor:css("--cold"), borderWidth:1, pointRadius:0}] : [])]},
    options:opts({interaction:{mode:"nearest",intersect:false}, plugins:{legend:{...legend, labels:{...legend.labels, filter:it=>it.text!=="0°C"}},
      tooltip:{callbacks:{title:()=>"", label:it=>{ const v = it.raw; return v.p ? `${it.dataset.label} ${r1(v.x)}°C · ${v.p} hPa · ${r1(v.y)} km${v.ws!=null?` · vento ${r0(v.ws)} km/h de ${C.dirName(v.wd)}`:""}` : `${it.dataset.label} ${r1(v.y)} km`; }}}},
      scales:{x:{type:"linear", min:xmin, max:xmax, title:{display:true,text:"°C",color:css("--ink-3")}, ticks:{stepSize:10}}, y:{type:"linear", min:0, max:top, title:{display:true,text:"altitude (km)",color:css("--ink-3")}}}})});
}
function idxCfg(){
  const V = L.lv, lab = V.time, K = [], TT = [];
  lab.forEach((_,j)=>{ const P = profileAt(j); K.push(P?P.K:null); TT.push(P?P.TT:null); });
  return {type:"line", data:{labels:lab, datasets:[
      {label:"Índice K", data:K, borderColor:css("--storm"), backgroundColor:css("--storm"), borderWidth:2, pointRadius:0, tension:.3, yAxisID:"y"},
      {label:"Total Totals", data:TT, borderColor:css("--warn"), backgroundColor:css("--warn"), borderWidth:2, pointRadius:0, tension:.3, yAxisID:"y2"},
      {label:"K = 26", data:lab.map(()=>26), borderColor:css("--storm")+"66", borderDash:[3,3], borderWidth:1, pointRadius:0, yAxisID:"y"},
      {label:"TT = 44", data:lab.map(()=>44), borderColor:css("--warn")+"66", borderDash:[3,3], borderWidth:1, pointRadius:0, yAxisID:"y2"}]},
    options:opts({plugins:{legend:{...legend, labels:{...legend.labels, filter:it=>!it.text.includes("=")}}, tooltip:{filter:it=>!it.dataset.label.includes("="), callbacks:{title:it=>whenL(lab[it[0].dataIndex]), label:it=>`${it.dataset.label}: ${r1(it.raw)}`}}},
      scales:{x:{ticks:{autoSkip:false, callback:v=>{ const t=lab[v], h=+t.slice(11,13); return h%12 ? null : h ? "12h" : dayL(t); }}},
              y:{title:{display:true,text:"K",color:css("--ink-3")}}, y2:{position:"right",grid:{display:false},border:{display:false},ticks:{color:css("--ink-3"),font:{family:FONT,size:11}},title:{display:true,text:"TT",color:css("--ink-3")}}}}),
    plugins:[marker(L.hour)]};
}
function drawIdx(){ mk("lIdx", idxCfg()); }
function fillIdx(P){
  const [kc,kcol] = kCat(P.K), [tc,tcol] = ttCat(P.TT);
  $("idxTbl").innerHTML = [
    ["Índice K", r0(P.K), kc, kcol],
    ["Total Totals", r0(P.TT), tc, tcol],
    ["Gradiente 850–500 hPa", r1(P.lapse)+" °C/km", P.lapse>=7 ? "condicionalmente instável" : P.lapse>=6 ? "moderado" : "estável", P.lapse>=7?"var(--warn)":"var(--dew)"],
    ["Cisalhamento 0–6 km", r0(P.shear)+" m/s", P.shear>=20 ? "organiza tempestades (multicélulas/supercélulas)" : P.shear>=10 ? "moderado" : "fraco: tempestades de vida curta", P.shear>=20?"var(--danger)":P.shear>=10?"var(--warn)":"var(--dew)"],
    ["Isoterma 0°C", P.fl!=null ? r1(P.fl/1000)+" km" : "—", P.fl!=null && P.fl<2500 ? "baixa: granizo chega ao solo com mais facilidade" : "normal", P.fl!=null && P.fl<2500 ? "var(--warn)" : "var(--ink-2)"]
  ].map(([n,v,t,c])=>`<tr><td>${n}</td><td style="color:${c};font-weight:600">${v}</td><td>${t}</td></tr>`).join("");
}
function drawWater(start){
  const d = C.S.fc.daily, lab = d.time.slice(start).map(t=>dayL(t+"T00:00"));
  let a=0, b=0; const R = d.precipitation_sum.slice(start).map(v=>a+=v||0), E = d.et0_fao_evapotranspiration.slice(start).map(v=>b+=v||0);
  mk("lWater", {type:"line", data:{labels:lab, datasets:[
      {label:"chuva acumulada", data:R, borderColor:css("--rain"), borderWidth:2.4, pointRadius:0, tension:.3, fill:{target:1, above:css("--dew")+"33", below:css("--danger")+"2E"}},
      {label:"ET₀ acumulada", data:E, borderColor:css("--warn"), borderWidth:2, borderDash:[5,4], pointRadius:0, tension:.3}]},
    options:opts({plugins:{legend, tooltip:{callbacks:{label:it=>`${it.dataset.label}: ${r0(it.raw)} mm`, afterBody:it=>`saldo: ${R[it[0].dataIndex]-E[it[0].dataIndex]>=0?"+":""}${r0(R[it[0].dataIndex]-E[it[0].dataIndex])} mm`}}},
      scales:{x:{ticks:{autoSkip:true,maxTicksLimit:9}}, y:{beginAtZero:true, ticks:{callback:v=>v+" mm"}}}})});
}
// linha vertical numa posição do eixo x
const marker = idx => ({id:"mk", afterDatasetsDraw(ch){ if(idx==null || idx<0) return; const x = ch.scales.x.getPixelForValue(idx), {top,bottom} = ch.chartArea, c = ch.ctx;
  c.save(); c.strokeStyle = css("--accent"); c.lineWidth = 1.5; c.setLineDash([3,3]); c.beginPath(); c.moveTo(x,top); c.lineTo(x,bottom); c.stroke(); c.restore(); }});

/* ---------- mapa de calor (HTML) ---------- */
function heatmap(){
  const V = HEATVARS[L.heat], h = C.S.fc.hourly, d = C.S.fc.daily, start = d.time.indexOf(C.S.fc.current.time.slice(0,10));
  const days = d.time.slice(start), idx = new Map(h.time.map((t,i)=>[t,i]));
  const vals = days.flatMap(day=>Array.from({length:24},(_,hh)=>h[V.a][idx.get(`${day}T${String(hh).padStart(2,"0")}:00`)])).filter(v=>v!=null);
  const [lo,hi] = V.dom || [Math.floor(min(vals)), Math.ceil(max(vals))];
  const nowT = C.S.fc.current.time.slice(0,13)+":00";
  const head = `<div class="hm-row hm-h"><span></span>${Array.from({length:24},(_,hh)=>`<span>${hh%3?"":hh}</span>`).join("")}</div>`;
  const rows = days.map((day,k)=>`<div class="hm-row"><span class="hm-d">${k?dayL(day+"T00:00"):"Hoje"}</span>${Array.from({length:24},(_,hh)=>{
    const t = `${day}T${String(hh).padStart(2,"0")}:00`, i = idx.get(t), v = i==null ? null : h[V.a][i];
    return v==null ? `<i class="hm-x"></i>` : `<i data-hi="${i}" class="${t===nowT?"hm-now":""}" style="background:${ramp(V.ramp,(v-lo)/((hi-lo)||1))}" title="${dayL(t)} ${fmtH(t)} · ${V.fmt(v)} ${V.u}"></i>`; }).join("")}</div>`).join("");
  const steps = 7, leg = Array.from({length:steps},(_,s)=>`<i style="background:${ramp(V.ramp,s/(steps-1))}"></i>`).join("");
  return `<div class="hm">${head}${rows}</div><div class="hm-leg"><span>${V.fmt(lo)} ${V.u}</span><div>${leg}</div><span>${V.fmt(hi)} ${V.u}</span><small>${V.nome}</small></div>`;
}

/* ---------- rosa dos ventos (SVG) ---------- */
function windRose(){
  const h = C.S.fc.hourly, i0 = C.nowIndex(), n = Math.min(168, h.time.length-i0);
  const BINS = [[0,10],[10,20],[20,30],[30,40],[40,999]], COL = ["#9BE0B4","#5DC48C","#F2BE46","#E8702A","#C0392B"];
  const F = Array.from({length:16},()=>BINS.map(()=>0)); let calm = 0;
  for(let k=i0;k<i0+n;k++){ const s = h.wind_speed_10m[k], dd = h.wind_direction_10m[k]; if(s==null||dd==null) continue; if(s<2){ calm++; continue; }
    F[Math.round(((dd%360)+360)%360/22.5)%16][BINS.findIndex(([a,b])=>s>=a&&s<b)]++; }
  const tot = n, sectors = F.map(b=>sum(b)), mx = Math.max(...sectors)/tot*100 || 1;
  const R = 120, cx = 150, cy = 150, r0f = 14, sc = (R-r0f)/mx;
  const ring = [mx/3, 2*mx/3, mx].map(v=>Math.round(v));
  let svg = ring.map(p=>`<circle cx="${cx}" cy="${cy}" r="${r0f+p*sc}" class="rr"/><text x="${cx+3}" y="${cy-(r0f+p*sc)-3}" class="rt">${p}%</text>`).join("");
  ["N","L","S","O"].forEach((t,k)=>{ const a = k*Math.PI/2; svg += `<text x="${cx+(R+14)*Math.sin(a)}" y="${cy-(R+14)*Math.cos(a)+4}" text-anchor="middle" class="rl">${t}</text>`; });
  const wedge = (dir, a0, a1, rin, rout, col) => { const s = (dir*22.5-a0)*Math.PI/180, e = (dir*22.5+a1)*Math.PI/180, p = (r,a)=>`${cx+r*Math.sin(a)},${cy-r*Math.cos(a)}`;
    return `<path d="M${p(rin,s)} L${p(rout,s)} A${rout},${rout} 0 0 1 ${p(rout,e)} L${p(rin,e)} A${rin},${rin} 0 0 0 ${p(rin,s)} Z" fill="${col}"><title>${C.dirName(dir*22.5)}: ${r1(sectors[dir]/tot*100)}% do tempo</title></path>`; };
  F.forEach((b,dir)=>{ let acc = r0f; b.forEach((c,j)=>{ if(!c) return; const w = c/tot*100*sc; svg += wedge(dir, 9.5, 9.5, acc, acc+w, COL[j]); acc += w; }); });
  svg += `<circle cx="${cx}" cy="${cy}" r="${r0f}" class="rc"/><text x="${cx}" y="${cy+4}" text-anchor="middle" class="rcal">${r0(calm/tot*100)}%</text>`;
  const dom = sectors.indexOf(Math.max(...sectors));
  return `<svg viewBox="0 0 300 300" class="rose" role="img" aria-label="Rosa dos ventos">${svg}</svg>
    <div class="rose-leg">${BINS.map(([a,b],j)=>`<span><i style="background:${COL[j]}"></i>${b>500?`≥ ${a}`:`${a}–${b}`}</span>`).join("")}<span class="u">km/h</span></div>
    <p class="rose-note">Predomínio de <b>${C.dirName(dom*22.5)}</b> (${r0(sectors[dom]/tot*100)}% das horas). Calmaria no centro: ${r0(calm/tot*100)}%.</p>`;
}

window.Lab = {setLoc, render: () => { if(active() && L.key) render(); }};
})();
