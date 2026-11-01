(() => {
"use strict";
const DEFAULT = {name:"Florianópolis", admin:"Santa Catarina", country:"Brasil", lat:-27.5954, lon:-48.548};
const $ = id => document.getElementById(id);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const charts = {};
let S = {loc:null, fc:null, models:null, air:null, mar:null, clim:null, range:48};

/* ---------- armazenamento local (tolerante a falha) ---------- */
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};

/* ---------- utilidades ---------- */
const WMO = {
  0:["Céu limpo","sun"],1:["Predomínio de sol","sun"],2:["Parcialmente nublado","partly"],3:["Nublado","cloud"],
  45:["Nevoeiro","fog"],48:["Nevoeiro com geada","fog"],51:["Garoa fraca","drizzle"],53:["Garoa","drizzle"],55:["Garoa forte","drizzle"],
  56:["Garoa congelante","drizzle"],57:["Garoa congelante forte","drizzle"],61:["Chuva fraca","rain"],63:["Chuva moderada","rain"],65:["Chuva forte","rain"],
  66:["Chuva congelante","rain"],67:["Chuva congelante forte","rain"],71:["Neve fraca","snow"],73:["Neve","snow"],75:["Neve forte","snow"],77:["Grãos de neve","snow"],
  80:["Pancadas fracas","rain"],81:["Pancadas de chuva","rain"],82:["Pancadas fortes","rain"],85:["Pancadas de neve","snow"],86:["Pancadas de neve fortes","snow"],
  95:["Trovoadas","storm"],96:["Trovoadas com granizo","storm"],99:["Trovoadas com granizo forte","storm"]
};
const wmo = c => WMO[c] || ["—","cloud"];
function icon(kind, size=28, night=false){
  const s = size;
  const sun = night
    ? `<path d="M19 6a8 8 0 1 0 9 11a7 7 0 0 1-9-11z" fill="#F5D76E" stroke="none"/>`
    : `<circle cx="16" cy="13" r="5.5" fill="#FFC531"/><g stroke="#FFB020" stroke-width="2" stroke-linecap="round"><path d="M16 3v2M16 21v2M6 13h2M24 13h2M9 6l1.4 1.4M21.6 18.6 23 20M9 20l1.4-1.4M21.6 7.4 23 6"/></g>`;
  const cloud = (y=0,c="#C9D3DE") => `<path d="M9 ${24+y}h14a5 5 0 0 0 0-10a7 7 0 0 0-13.4 1.6A4.3 4.3 0 0 0 9 ${24+y}z" fill="${c}" stroke="rgba(255,255,255,.7)" stroke-width="1"/>`;
  const drops = c => `<g stroke="${c}" stroke-width="2" stroke-linecap="round"><path d="M11 27l-1 3M17 27l-1 3M23 27l-1 3"/></g>`;
  let body = "";
  switch(kind){
    case "sun": body = sun; break;
    case "partly": body = `<g transform="translate(-3,-3) scale(.8)">${sun}</g>` + cloud(1,"#E3E9F0"); break;
    case "cloud": body = cloud(-1,"#B9C5D2"); break;
    case "fog": body = `<g stroke="#9AA8B8" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h22M8 17h19M5 22h22M9 27h14"/></g>`; break;
    case "drizzle": body = cloud(-4) + `<g stroke="#3FA9DE" stroke-width="2" stroke-linecap="round"><path d="M12 25v1M18 25v1M24 25v1"/></g>`; break;
    case "rain": body = cloud(-4,"#AFBCCB") + drops("#2E9BE0"); break;
    case "snow": body = cloud(-4) + `<g fill="#8FB8FF"><circle cx="11" cy="28" r="1.6"/><circle cx="17" cy="28" r="1.6"/><circle cx="23" cy="28" r="1.6"/></g>`; break;
    case "storm": body = cloud(-4,"#8E93AE") + `<path d="M17 21l-4 6h4l-2 5 6-8h-4l2-3z" fill="#FFC531"/>`; break;
  }
  return `<svg width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true">${body}</svg>`;
}
const DIRS = ["N","NNE","NE","ENE","L","ESE","SE","SSE","S","SSO","SO","OSO","O","ONO","NO","NNO"];
const dirName = d => DIRS[Math.round(((d%360)+360)%360/22.5)%16];
const r0 = v => v==null||isNaN(v) ? "—" : Math.round(v);
const r1 = v => v==null||isNaN(v) ? "—" : (Math.round(v*10)/10).toLocaleString("pt-BR");
const fmtH = iso => iso.slice(11,16);
const DOW = ["dom","seg","ter","qua","qui","sex","sáb"];
const parseLocal = iso => { const [d,t="00:00"] = iso.split("T"); const [y,m,da]=d.split("-").map(Number); const [h,mi]=t.split(":").map(Number); return new Date(y,m-1,da,h,mi); };
const sum = a => a.reduce((x,y)=>x+(y||0),0);
const max = a => Math.max(...a.filter(v=>v!=null));
const min = a => Math.min(...a.filter(v=>v!=null));
const mean = a => { const f=a.filter(v=>v!=null); return f.length? sum(f)/f.length : null; };
const std = a => { const m=mean(a); const f=a.filter(v=>v!=null); return f.length>1? Math.sqrt(sum(f.map(v=>(v-m)**2))/(f.length-1)) : 0; };
const esc = s => String(s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const sl = (a,s,e) => a.slice(Math.max(0,s), e);

// dados que quase não mudam ficam guardados no aparelho: histórico (2015–2024) por 30 dias e ensemble por 3 h.
// Evita o "excesso de pedidos" (HTTP 429) do Open-Meteo e acelera a abertura; sem rede ou com 429, usa a cópia guardada
const API_TTL = u => /archive-api\.open-meteo/.test(u) ? 30*864e5 : /ensemble-api\.open-meteo/.test(u) ? 3*36e5 : 0;
async function getJSON(url){
  const ttl = API_TTL(url); let cache = null, hit = null;
  if(ttl && window.caches){ try{ cache = await caches.open("clima-api"); hit = await cache.match(url);
    if(hit && Date.now() - (+hit.headers.get("x-at") || 0) < ttl) return await hit.json(); }catch(e){} }
  try{
    const r = await fetch(url);
    if(!r.ok){ let m = r.status; try{ const j = await r.json(); m = j.reason || m; }catch(e){} throw new Error(m); }
    const j = await r.json();
    if(cache){ try{ await cache.put(url, new Response(JSON.stringify(j), {headers:{"Content-Type":"application/json", "x-at":String(Date.now())}})); }catch(e){} }
    return j;
  }catch(e){ if(hit){ try{ return await hit.json(); }catch(e2){} } throw e; }
}

/* ---------- APIs ---------- */
const HOURLY = "temperature_2m,apparent_temperature,dew_point_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,pressure_msl,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cape,lifted_index,uv_index,is_day";
const DAILY = "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,sunrise,sunset,daylight_duration,uv_index_max,precipitation_sum,precipitation_probability_max,precipitation_hours,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,et0_fao_evapotranspiration";
const CURRENT = "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,dew_point_2m";
const MODELS = [["ecmwf_ifs025","ECMWF"],["gfs_seamless","GFS"],["icon_seamless","ICON"],["gem_seamless","GEM"],["jma_seamless","JMA"]];

const urlFc = l => `https://api.open-meteo.com/v1/forecast?latitude=${l.lat}&longitude=${l.lon}&current=${CURRENT}&hourly=${HOURLY}&daily=${DAILY}&timezone=auto&past_days=1&forecast_days=16&wind_speed_unit=kmh`;
const urlModels = l => `https://api.open-meteo.com/v1/forecast?latitude=${l.lat}&longitude=${l.lon}&hourly=temperature_2m,precipitation&models=${MODELS.map(m=>m[0]).join(",")}&timezone=auto&forecast_days=7`;
const urlAir = l => `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${l.lat}&longitude=${l.lon}&current=us_aqi,pm10,pm2_5,ozone,nitrogen_dioxide,carbon_monoxide,sulphur_dioxide&hourly=pm2_5,pm10,us_aqi&timezone=auto&forecast_days=3`;
const urlMar = l => `https://marine-api.open-meteo.com/v1/marine?latitude=${l.lat}&longitude=${l.lon}&current=wave_height,wave_direction,wave_period,swell_wave_height,sea_surface_temperature&hourly=wave_height,swell_wave_height,wave_period&daily=wave_height_max&timezone=auto&forecast_days=3&cell_selection=sea`;
const urlClim = l => `https://archive-api.open-meteo.com/v1/archive?latitude=${l.lat}&longitude=${l.lon}&start_date=2015-01-01&end_date=2024-12-31&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;

/* ---------- carregamento ---------- */
let loadSeq = 0;
async function load(loc){
  const seq = ++loadSeq;          // descarta respostas de uma carga anterior que cheguem depois
  S.loc = loc;
  store.set("clima-loc", loc);
  renderPlaces();
  $("status").textContent = `Carregando dados para ${loc.name}…`;
  $("status").classList.remove("hidden");
  try{
    const fc = await getJSON(urlFc(loc));
    if(seq!==loadSeq) return;
    S.fc = fc; S.fetchedAt = new Date();
  }catch(e){
    if(seq!==loadSeq) return;
    $("status").innerHTML = `<span class="err">Não foi possível obter a previsão (${esc(e.message)}). Verifique a conexão e use “Atualizar”.</span>`;
    return;
  }
  $("status").classList.add("hidden");
  $("app").classList.remove("hidden");
  setSky();
  renderHero(); renderMeteogram(); renderDays(); renderAlerts();
  // cada módulo isolado: se um falhar (ex.: mapa sem WebGL), os outros continuam recebendo o local
  const safe = fn => { try{ fn(); }catch(e){ console.warn(e); } };
  safe(()=>window.Experts?.load(loc));
  safe(()=>window.Sat?.footer());
  safe(()=>window.Timeline?.build());
  safe(()=>window.Lab?.setLoc(loc));
  safe(()=>window.Pred?.setLoc(loc));
  safe(()=>window.Sports?.setLoc(loc));
  safe(()=>window.Travel?.render());
  safe(()=>window.Sat?.setLoc(loc));
  window.Home?.refresh();
  $("updated").textContent = ` Atualizado às ${new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}.`;

  const [m,a,mr,c] = await Promise.allSettled([getJSON(urlModels(loc)), getJSON(urlAir(loc)), getJSON(urlMar(loc)), getJSON(urlClim(loc))]);
  if(seq!==loadSeq) return;
  S.models = m.status==="fulfilled"? m.value : null;
  S.air = a.status==="fulfilled"? a.value : null;
  S.mar = mr.status==="fulfilled"? mr.value : null;
  S.clim = c.status==="fulfilled"? c.value : null;
  renderModels(); renderAir(); renderMarine(); renderDays(); renderAlerts();
  window.Experts?.refresh();
  window.Lab?.render();
  window.Home?.refresh();
}

function nowIndex(){
  const t = S.fc.current.time.slice(0,13) + ":00";
  const i = S.fc.hourly.time.indexOf(t);
  return i < 0 ? 24 : i;
}

/* céu de fundo conforme condição e hora do dia */
function setSky(){
  const c = S.fc.current, code = c.weather_code;
  let sky = "clear-day";
  if(!c.is_day) sky = "night";
  else if(code>=95) sky = "storm-day";
  else if((code>=51 && code<=67) || (code>=80 && code<=82)) sky = "rain-day";
  else if(code===3 || code===45 || code===48 || c.cloud_cover>=75) sky = "cloud-day";
  document.body.dataset.sky = sky;
}

/* ---------- hero ---------- */
function renderHero(){
  const c = S.fc.current, h = S.fc.hourly, d = S.fc.daily, L = S.loc, i = nowIndex();
  $("place").innerHTML = `${esc(L.name)}<span>${esc([L.admin,L.country].filter(Boolean).join(", "))} · ${r1(L.lat)}°, ${r1(L.lon)}° · ${r0(S.fc.elevation)} m</span>`;
  $("temp").innerHTML = `${r0(c.temperature_2m)}<sup>°C</sup>`;
  const [nm, kind] = wmo(c.weather_code);
  $("condIcon").innerHTML = icon(kind, 48, !c.is_day);
  $("condName").textContent = nm;
  const ti = d.time.indexOf(S.fc.current.time.slice(0,10));
  $("feels").textContent = `Sensação ${r0(c.apparent_temperature)}° · máx ${r0(d.temperature_2m_max[ti])}° · mín ${r0(d.temperature_2m_min[ti])}°`;

  // vento
  $("wind").innerHTML = `${r0(c.wind_speed_10m)}<small>km/h</small>`;
  $("windS").textContent = `De ${dirName(c.wind_direction_10m)} (${r0(c.wind_direction_10m)}°), rajadas de ${r0(c.wind_gusts_10m)} km/h · ${beaufort(c.wind_speed_10m)}`;
  drawCompass(c.wind_direction_10m);

  // pressão e tendência 3 h
  const p3 = h.pressure_msl[i-3], dp = p3!=null ? c.pressure_msl - p3 : null;
  $("press").innerHTML = `${r0(c.pressure_msl)}<small>hPa</small>`;
  $("pressS").textContent = dp==null ? "" : `${dp>=0?"+":""}${r1(dp)} hPa em 3 h · ${pressTrend(dp)}`;

  // umidade
  const spread = c.temperature_2m - c.dew_point_2m;
  $("hum").innerHTML = `${r0(c.relative_humidity_2m)}<small>%</small>`;
  $("humS").textContent = `Orvalho ${r1(c.dew_point_2m)}° · diferença ${r1(spread)}° · ${dewFeel(c.dew_point_2m)}`;

  // nuvens
  $("cloud").innerHTML = `${r0(c.cloud_cover)}<small>%</small>`;
  const vis = h.visibility[i];
  $("cloudS").textContent = `Baixas ${r0(h.cloud_cover_low[i])}% · médias ${r0(h.cloud_cover_mid[i])}% · altas ${r0(h.cloud_cover_high[i])}% · visib. ${vis==null?"—":vis>=10000? ">10 km" : r1(vis/1000)+" km"}`;

  // UV
  $("uv").innerHTML = `${r1(h.uv_index[i])}<small>agora</small>`;
  $("uvDot").style.left = `${Math.min(100, (h.uv_index[i]||0)/11*100)}%`;
  $("uvS").textContent = `Máximo do dia ${r1(d.uv_index_max[ti])} · ${uvCat(d.uv_index_max[ti])}`;

  // sol
  $("sun").innerHTML = `${fmtH(d.sunrise[ti])}<small>–</small>${fmtH(d.sunset[ti])}`;
  const dl = d.daylight_duration[ti]/3600, dl1 = d.daylight_duration[ti+1]/3600;
  $("sunS").textContent = `${Math.floor(dl)} h ${Math.round((dl%1)*60)} min de luz · ${dl1>dl?"dias crescendo":"dias diminuindo"} (${r0((dl1-dl)*60*60)} s/dia) · ET₀ ${r1(d.et0_fao_evapotranspiration[ti])} mm`;

  // últimas 24 h
  const past = sl(h.temperature_2m, i-24, i+1), pp = sl(h.precipitation, i-23, i+1);
  $("past").textContent = `Últimas 24 h (análise do modelo): máx ${r0(max(past))}°, mín ${r0(min(past))}°, chuva acumulada ${r1(sum(pp))} mm.`;

  $("reading").innerHTML = buildReading().map(p=>`<p>${p}</p>`).join("");

  // faixa das próximas 24 h
  let hrs = "";
  for(let k=i;k<Math.min(h.time.length,i+25);k++){
    const [hn,hk] = wmo(h.weather_code[k]), pr = h.precipitation_probability[k];
    hrs += `<div class="hr${k===i?" cur":""}" title="${esc(hn)}" data-i="${k}" role="button" tabindex="0"><span class="ht">${k===i?"Agora":fmtH(h.time[k]).slice(0,2)+"h"}</span>${icon(hk,26,!h.is_day[k])}<span class="hp">${pr>=20?r0(pr)+"%":""}</span><span class="hv">${r0(h.temperature_2m[k])}°</span></div>`;
  }
  $("hours").innerHTML = hrs;
}
function beaufort(v){ const t=[1,6,12,20,29,39,50,62,75,89,103,118]; const n=["calmaria","aragem","brisa leve","brisa fraca","brisa moderada","brisa forte","vento fresco","vento forte","ventania","ventania forte","tempestade","tempestade violenta","furacão"]; let b=0; while(b<t.length && v>=t[b]) b++; return `${n[b]} (Beaufort ${b})`; }
function pressTrend(dp){ if(dp<=-3) return "queda acentuada"; if(dp<=-1) return "em queda"; if(dp>=3) return "subida acentuada"; if(dp>=1) return "em subida"; return "estável"; }
function dewFeel(td){ if(td<10) return "ar seco"; if(td<16) return "confortável"; if(td<20) return "úmido"; if(td<24) return "abafado"; return "opressivo"; }
function uvCat(u){ if(u<3) return "baixo"; if(u<6) return "moderado"; if(u<8) return "alto"; if(u<11) return "muito alto"; return "extremo"; }
function drawCompass(deg){
  const ink=css("--ink"), ink3=css("--ink-3"), g=css("--line"), h=css("--accent");
  const ticks = Array.from({length:16},(_,k)=>{const a=k*22.5*Math.PI/180, r1=31, r2=k%4?28:25; return `<line x1="${35+r1*Math.sin(a)}" y1="${35-r1*Math.cos(a)}" x2="${35+r2*Math.sin(a)}" y2="${35-r2*Math.cos(a)}" stroke="${k%4?g:ink3}" stroke-width="1.5"/>`}).join("");
  // seta aponta para onde o vento vai (direção de origem + 180)
  $("compass").innerHTML = `<circle cx="35" cy="35" r="32" fill="none" stroke="${g}" stroke-width="1"/>${ticks}
    <text x="35" y="16" text-anchor="middle" font-size="9" font-weight="600" fill="${ink}" font-family="-apple-system,system-ui">N</text>
    <g transform="rotate(${deg+180} 35 35)"><path d="M35 12 L41 30 L35 26 L29 30 Z" fill="${h}"/><line x1="35" y1="26" x2="35" y2="56" stroke="${ink}" stroke-width="2" stroke-linecap="round"/></g>`;
}

/* ---------- leitura automática ---------- */
function buildReading(){
  const h=S.fc.hourly, d=S.fc.daily, c=S.fc.current, i=nowIndex(), out=[];
  const nx24 = (a)=>sl(a,i+1,i+25);
  const rain24 = sum(nx24(h.precipitation)), prob24 = max(nx24(h.precipitation_probability));
  const firstRain = nx24(h.precipitation_probability).findIndex(p=>p>=60);
  if(rain24 >= 1){
    const when = firstRain>=0 ? ` a partir de ${fmtH(h.time[i+1+firstRain])}` : "";
    out.push(`Chuva prevista nas próximas 24 h: cerca de <b>${r1(rain24)} mm</b>, com probabilidade máxima de ${r0(prob24)}%${when}.`);
  } else out.push(`Sem chuva significativa nas próximas 24 h (probabilidade máxima ${r0(prob24)}%).`);

  const dp = c.pressure_msl - (h.pressure_msl[i-3] ?? c.pressure_msl);
  const p12 = h.pressure_msl[i+12];
  if(dp<=-1 || (p12!=null && p12 - c.pressure_msl <= -3)) out.push(`A pressão está caindo (${r1(dp)} hPa em 3 h), sinal de aproximação de sistema frontal ou de baixa pressão.`);
  else if(dp>=1) out.push(`A pressão está subindo (${dp>0?"+":""}${r1(dp)} hPa em 3 h), o que costuma indicar estabilização do tempo.`);

  const t1 = d.temperature_2m_max.slice(d.time.indexOf(c.time.slice(0,10)));
  if(t1.length>3){ const dt = t1[3]-t1[0]; if(Math.abs(dt)>=4) out.push(`Em três dias a máxima ${dt>0?"sobe":"cai"} ${r0(Math.abs(dt))}° (de ${r0(t1[0])}° para ${r0(t1[3])}°).`); }

  const capeMax = max(nx24(h.cape)), liMin = min(nx24(h.lifted_index));
  if(capeMax>=1000 && liMin<=-2) out.push(`A atmosfera fica instável (CAPE até ${r0(capeMax)} J/kg, índice de levantamento ${r1(liMin)}): há energia para trovoadas.`);
  return out;
}

/* ---------- avisos ---------- */
function renderAlerts(){
  const h=S.fc.hourly, d=S.fc.daily, i=nowIndex(), A=[];
  const w = a => sl(a,i,i+48);
  const T = w(h.time);
  const atMax = (a) => { const v=w(a); let k=0; v.forEach((x,j)=>{ if(x!=null && x>v[k]) k=j; }); return {v:v[k], t:T[k]}; };
  const label = iso => { const dt=parseLocal(iso); return `${DOW[dt.getDay()]} ${fmtH(iso)}`; };

  const g = atMax(h.wind_gusts_10m);
  if(g.v>=80) A.push([3,"Vento forte",`Rajadas de até ${r0(g.v)} km/h (${label(g.t)}). Risco de queda de galhos e danos a estruturas leves.`]);
  else if(g.v>=55) A.push([2,"Rajadas de vento",`Até ${r0(g.v)} km/h em ${label(g.t)}.`]);

  for(let k=0;k<48;k+=24){
    const rs = sum(sl(h.precipitation,i+k,i+k+24)), r1h = max(sl(h.precipitation,i+k,i+k+24));
    const per = k===0? "nas próximas 24 h" : "entre 24 h e 48 h";
    if(rs>=50 || r1h>=20) A.push([3,"Chuva intensa",`${r1(rs)} mm ${per}, pico de ${r1(r1h)} mm/h. Atenção a alagamentos.`]);
    else if(rs>=20 || r1h>=8) A.push([2,"Chuva moderada a forte",`${r1(rs)} mm ${per}, pico de ${r1(r1h)} mm/h.`]);
  }

  const cape = atMax(h.cape), li = min(w(h.lifted_index));
  if(cape.v>=2500 && li<=-5) A.push([3,"Potencial de tempestade severa",`CAPE ${r0(cape.v)} J/kg e índice de levantamento ${r1(li)} (${label(cape.t)}). Possibilidade de granizo e rajadas.`]);
  else if(cape.v>=1000 && li<=-2) A.push([2,"Instabilidade convectiva",`CAPE ${r0(cape.v)} J/kg (${label(cape.t)}). Trovoadas isoladas são possíveis.`]);

  const hi = atMax(h.apparent_temperature);
  if(hi.v>=40) A.push([3,"Calor extremo",`Sensação térmica de ${r0(hi.v)}° (${label(hi.t)}).`]);
  else if(hi.v>=33) A.push([2,"Desconforto térmico",`Sensação de até ${r0(hi.v)}° (${label(hi.t)}). Hidrate-se e evite sol forte.`]);
  const lo = min(w(h.apparent_temperature));
  if(lo<=3) A.push([2,"Frio intenso",`Sensação térmica mínima de ${r0(lo)}°.`]);

  const uv = max(sl(d.uv_index_max,1,3));
  if(uv>=8) A.push([2,"UV muito alto",`Índice ${r1(uv)} no pico do dia. Proteção solar entre 10 h e 16 h.`]);

  // nevoeiro: diferença T−Td ≤ 1,5° com vento fraco
  let fog = null;
  for(let k=i;k<i+48 && k<h.time.length;k++){ if(h.temperature_2m[k]-h.dew_point_2m[k]<=1.5 && h.wind_speed_10m[k]<8 && h.relative_humidity_2m[k]>=95){ fog=h.time[k]; break; } }
  if(fog) A.push([1,"Possível nevoeiro",`Ar saturado e vento fraco a partir de ${label(fog)}. Reduza a velocidade na estrada.`]);

  const dp = h.pressure_msl[i+12]!=null ? h.pressure_msl[i+12]-h.pressure_msl[i] : 0;
  if(dp<=-5) A.push([2,"Queda rápida de pressão",`${r1(dp)} hPa em 12 h: mudança de tempo próxima.`]);

  if(S.models){
    const sp = modelSpread().slice(0,3).map(x=>x.sd);
    const m = max(sp);
    if(m>=2) A.push([1,"Previsão incerta",`Os modelos discordam em até ±${r1(m)}° na máxima dos próximos dias. Acompanhe as atualizações.`]);
  }
  if(!A.length) A.push([1,"Sem avisos","Nenhuma condição adversa prevista para as próximas 48 h."]);
  A.sort((a,b)=>b[0]-a[0]);
  const sym = {1:"i",2:"!",3:"!!"};
  $("alerts").innerHTML = A.map(([l,t,s])=>`<div class="alert glass l${l}"><div class="dot" aria-hidden="true">${sym[l]}</div><div><b>${esc(t)}</b><span>${s}</span></div></div>`).join("");
}

/* ---------- gráficos ---------- */
const nowLine = {
  id:"nowLine",
  afterDatasetsDraw(ch, args, o){
    if(o.idx==null) return;
    const x = ch.scales.x.getPixelForValue(o.idx), {top,bottom} = ch.chartArea, c = ch.ctx;
    c.save(); c.strokeStyle = css("--accent"); c.globalAlpha=.8; c.lineWidth=1.5; c.setLineDash([3,3]); c.beginPath(); c.moveTo(x,top); c.lineTo(x,bottom); c.stroke(); c.restore();
  }
};
const FONT = "-apple-system, BlinkMacSystemFont, system-ui, sans-serif";
function baseOpts(idx, labels, extra={}){
  const grid = css("--grid"), tick = css("--ink-3");
  return Object.assign({
    responsive:true, maintainAspectRatio:false, animation:false,
    interaction:{mode:"index",intersect:false},
    layout:{padding:{top:20}},
    plugins:{legend:{display:false}, nowLine:{idx},
      tooltip:{backgroundColor:css("--glass-strong")||"rgba(0,0,0,.7)",titleColor:css("--ink"),bodyColor:css("--ink-2"),borderColor:css("--line"),borderWidth:1,cornerRadius:10,padding:10,boxPadding:4,
        titleFont:{family:FONT,weight:"600"},bodyFont:{family:FONT},
        callbacks:{title:it=>{const t=labels[it[0].dataIndex]; const dt=parseLocal(t); return `${DOW[dt.getDay()]} ${dt.getDate()}/${dt.getMonth()+1} ${fmtH(t)}`;}}}},
    scales:{
      x:{grid:{color:grid,drawTicks:false}, border:{display:false}, ticks:{color:tick,maxRotation:0,autoSkip:false,font:{family:FONT,size:11},
        callback:(v)=>{const t=labels[v]; if(!t) return ""; const hh=+t.slice(11,13); const step = S.range>48? 24 : 6; if(hh%step) return null; const dt=parseLocal(t); return hh===0? `${DOW[dt.getDay()]} ${dt.getDate()}` : `${hh}h`;}}},
      y:{grid:{color:grid}, border:{display:false}, ticks:{color:tick,font:{family:FONT,size:11},maxTicksLimit:5}, afterFit:s=>{s.width=44}}
    }
  }, extra);
}
function mk(id, cfg){ if(charts[id]) charts[id].destroy(); charts[id] = new Chart($(id), cfg); return charts[id]; }

function renderMeteogram(){
  const h=S.fc.hourly, i=nowIndex(), s=Math.max(0,i-6), e=Math.min(h.time.length, i+S.range+1);
  const L = h.time.slice(s,e), idx = i-s, cut = a => a.slice(s,e);
  const C = {heat:css("--heat"),dew:css("--dew"),rain:css("--rain"),storm:css("--storm"),ink:css("--ink"),ink3:css("--ink-3"),danger:css("--danger"),warn:css("--warn")};
  const line = (data,color,o={}) => Object.assign({data,borderColor:color,backgroundColor:color,borderWidth:2,pointRadius:0,tension:.35},o);
  const y2 = (o={}) => Object.assign({position:"right",grid:{display:false},border:{display:false},ticks:{color:css("--ink-3"),font:{family:FONT,size:11},maxTicksLimit:4},afterFit:s=>{s.width=44}},o);
  const B = () => baseOpts(idx,L).scales;

  mk("cTemp",{type:"line",data:{labels:L,datasets:[
    line(cut(h.temperature_2m),C.heat,{fill:{target:"origin",above:C.heat+"18",below:C.cold+"18"},borderWidth:2.4}),
    line(cut(h.apparent_temperature),C.heat,{borderDash:[5,4],borderWidth:1.5,borderColor:C.heat+"99"}),
    line(cut(h.dew_point_2m),C.dew,{borderWidth:1.5})
  ]},options:baseOpts(idx,L,{scales:{...B(), y2:y2({display:true,ticks:{display:false}})}}),plugins:[nowLine]});

  mk("cRain",{type:"bar",data:{labels:L,datasets:[
    {type:"bar",data:cut(h.precipitation),backgroundColor:C.rain,borderRadius:3,barPercentage:1,categoryPercentage:.85,yAxisID:"y"},
    line(cut(h.precipitation_probability),C.storm,{type:"line",borderWidth:1.5,yAxisID:"y2"})
  ]},options:baseOpts(idx,L,{scales:{...B(), y:{...B().y,beginAtZero:true,suggestedMax:2}, y2:y2({min:0,max:100})}}),plugins:[nowLine]});

  mk("cWind",{type:"line",data:{labels:L,datasets:[
    line(cut(h.wind_speed_10m),C.ink),
    line(cut(h.wind_gusts_10m),C.danger,{borderDash:[4,3],borderWidth:1.5})
  ]},options:baseOpts(idx,L,{scales:{...B(), y:{...B().y,beginAtZero:true}, y2:y2({ticks:{display:false}})}}),plugins:[nowLine]});

  mk("cPress",{type:"line",data:{labels:L,datasets:[line(cut(h.pressure_msl),C.ink)]},
    options:baseOpts(idx,L,{scales:{...B(), y2:y2({ticks:{display:false}})}}),plugins:[nowLine]});

  mk("cCloud",{type:"line",data:{labels:L,datasets:[
    line(cut(h.cloud_cover_high),C.storm,{fill:true,backgroundColor:C.storm+"22",borderWidth:1.2}),
    line(cut(h.cloud_cover_mid),C.rain,{fill:true,backgroundColor:C.rain+"22",borderWidth:1.2}),
    line(cut(h.cloud_cover_low),C.ink3,{fill:true,backgroundColor:C.ink3+"33",borderWidth:1.2})
  ]},options:baseOpts(idx,L,{scales:{...B(), y:{...B().y,min:0,max:100}, y2:y2({ticks:{display:false}})}}),plugins:[nowLine]});

  mk("cConv",{type:"bar",data:{labels:L,datasets:[
    {type:"bar",data:cut(h.cape),backgroundColor:C.warn+"BB",borderRadius:3,barPercentage:1,categoryPercentage:.85,yAxisID:"y"},
    line(cut(h.lifted_index),C.storm,{type:"line",borderWidth:1.5,yAxisID:"y2"})
  ]},options:baseOpts(idx,L,{scales:{...B(), y:{...B().y,beginAtZero:true,suggestedMax:500}, y2:y2({reverse:true})}}),plugins:[nowLine]});

  drawArrows(cut(h.wind_direction_10m), cut(h.wind_speed_10m));
}
function drawArrows(dir, spd){
  const box = $("arrows"), W = box.clientWidth, n = dir.length, step = S.range>48? 6 : 3, ink=css("--ink-2");
  let html = "";
  for(let k=0;k<n;k+=step){
    const x = (k+.5)/n*W - 9, rot = dir[k]+180, op = .35 + Math.min(spd[k],50)/50*.65;
    html += `<svg width="18" height="18" viewBox="0 0 18 18" style="left:${x}px;opacity:${op}"><g transform="rotate(${rot} 9 9)"><path d="M9 2 L13 9 L9.8 8 L9.8 16 L8.2 16 L8.2 8 L5 9 Z" fill="${ink}"/></g></svg>`;
  }
  box.innerHTML = html;
}

/* ---------- 16 dias ---------- */
function climFor(dateStr){
  if(!S.clim || !S.clim.daily) return null;
  const tgt = parseLocal(dateStr), doy = d => Math.floor((d - new Date(d.getFullYear(),0,0))/864e5);
  const td = doy(tgt), D = S.clim.daily, mx=[], mn=[], pr=[];
  for(let k=0;k<D.time.length;k++){
    const dd = doy(parseLocal(D.time[k])); let diff = Math.abs(dd-td); diff = Math.min(diff, 366-diff);
    if(diff<=3){ mx.push(D.temperature_2m_max[k]); mn.push(D.temperature_2m_min[k]); pr.push(D.precipitation_sum[k]); }
  }
  return mx.length? {max:mean(mx), min:mean(mn), rain:mean(pr)} : null;
}
function renderDays(){
  const d=S.fc.daily, start = d.time.indexOf(S.fc.current.time.slice(0,10));
  const rows = [], lo = min(d.temperature_2m_min.slice(start)), hi = max(d.temperature_2m_max.slice(start));
  const span = Math.max(1, hi-lo), pct = v => (v-lo)/span*100;
  for(let k=start;k<d.time.length;k++){
    const dt = parseLocal(d.time[k]), [nm,kind] = wmo(d.weather_code[k]), cl = climFor(d.time[k]);
    const a = cl ? d.temperature_2m_max[k]-cl.max : null;
    const aCol = a==null? "var(--ink-3)" : a>=2? "var(--heat)" : a<=-2? "var(--cold)" : "var(--ink-2)";
    const l = pct(d.temperature_2m_min[k]), r = pct(d.temperature_2m_max[k]);
    rows.push(`<div class="day" title="${esc(nm)}" data-k="${k}" role="button" tabindex="0">
      <div class="d">${k===start?"Hoje":DOW[dt.getDay()]}<small>${dt.getDate()}/${dt.getMonth()+1}</small></div>
      <div>${icon(kind,26)}</div>
      <div class="range"><div class="track"></div>
        <div class="bar" style="left:${l}%;width:${Math.max(2,r-l)}%"></div>
        ${cl? `<div class="clim" style="left:${pct(cl.max)}%" title="Média climatológica da máxima: ${r1(cl.max)}°"></div>`:""}
        <span class="t" style="right:calc(${100-l}% + 6px);color:var(--cold)">${r0(d.temperature_2m_min[k])}°</span>
        <span class="t" style="left:calc(${r}% + 6px);color:var(--heat)">${r0(d.temperature_2m_max[k])}°</span>
      </div>
      <div class="num">${r1(d.precipitation_sum[k])}<small>mm</small></div>
      <div class="num">${r0(d.precipitation_probability_max[k])}<small>%</small></div>
      <div class="num">${r0(d.wind_gusts_10m_max[k])}<small>km/h ${dirName(d.wind_direction_10m_dominant[k])}</small></div>
      <div class="anom" style="color:${aCol}">${a==null?"—":(a>0?"+":"")+r1(a)+"°"}</div>
    </div>`);
  }
  $("days").innerHTML = rows.join("");
}

/* ---------- modelos ---------- */
function modelSpread(){
  const H = S.models.hourly, days = {};
  H.time.forEach((t,k)=>{
    const day = t.slice(0,10); days[day] ??= MODELS.map(()=>({tmax:-99,rain:0,n:0}));
    MODELS.forEach(([id],m)=>{
      const tv = H[`temperature_2m_${id}`]?.[k], pv = H[`precipitation_${id}`]?.[k];
      if(tv!=null){ days[day][m].tmax = Math.max(days[day][m].tmax, tv); days[day][m].n++; }
      if(pv!=null) days[day][m].rain += pv;
    });
  });
  return Object.entries(days).map(([day,arr])=>{
    const ok = arr.filter(x=>x.n>0);
    return {day, mean:mean(ok.map(x=>x.tmax)), sd:std(ok.map(x=>x.tmax)), rmin:min(ok.map(x=>x.rain)), rmax:max(ok.map(x=>x.rain)), n:ok.length};
  }).filter(x=>x.n>0);
}
function renderModels(){
  if(!S.models){ $("modelTbl").innerHTML = `<tr><td>Comparação de modelos indisponível no momento.</td></tr>`; return; }
  const H = S.models.hourly, cols = [css("--heat"),css("--cold"),css("--dew"),css("--storm"),css("--warn")];
  const ds = MODELS.map(([id,nm],m)=>({label:nm,data:H[`temperature_2m_${id}`]||[],borderColor:cols[m],backgroundColor:cols[m],borderWidth:1.6,pointRadius:0,tension:.35})).filter(d=>d.data.some(v=>v!=null));
  const t0 = S.fc.current.time.slice(0,13)+":00", idx = H.time.indexOf(t0);
  const saved = S.range; S.range = 168; // rótulos diários
  const o = baseOpts(idx<0?null:idx, H.time);
  o.plugins.legend = {display:true,position:"bottom",labels:{color:css("--ink-2"),usePointStyle:true,pointStyle:"circle",boxWidth:8,boxHeight:8,font:{family:FONT,size:12}}};
  mk("cModels",{type:"line",data:{labels:H.time,datasets:ds},options:o,plugins:[nowLine]});
  S.range = saved;
  const sp = modelSpread();
  $("modelTbl").innerHTML = `<thead><tr><th>Dia</th><th>Máx. média</th><th>± desvio</th><th>Chuva (mm)</th></tr></thead><tbody>` +
    sp.map(x=>{ const dt=parseLocal(x.day); const c = x.sd>=2? "var(--danger)" : x.sd>=1? "var(--warn)" : "var(--dew)";
      return `<tr><td>${DOW[dt.getDay()]} ${dt.getDate()}/${dt.getMonth()+1}</td><td>${r1(x.mean)}°</td><td style="color:${c};font-weight:600">${r1(x.sd)}°</td><td>${r1(x.rmin)} a ${r1(x.rmax)}</td></tr>`; }).join("") + `</tbody>`;
  renderAlerts();
}

/* ---------- ar ---------- */
function aqiCat(v){
  if(v<=50) return ["Boa","var(--dew)"]; if(v<=100) return ["Moderada","var(--warn)"]; if(v<=150) return ["Ruim para grupos sensíveis","var(--heat)"];
  if(v<=200) return ["Ruim","var(--danger)"]; if(v<=300) return ["Muito ruim","var(--storm)"]; return ["Perigosa","var(--storm)"];
}
function renderAir(){
  const card = $("aqCard");
  if(!S.air || !S.air.current){ card.querySelector(".sub").textContent = "Dados de qualidade do ar indisponíveis para este local."; return; }
  const c = S.air.current, [cat,col] = aqiCat(c.us_aqi);
  $("aqi").textContent = r0(c.us_aqi); $("aqi").style.color = col;
  $("aqiTxt").innerHTML = `<b style="font-size:18px">${cat}</b><br><span style="color:var(--ink-2);font-size:13px">Índice US AQI</span>`;
  const P = [["PM2,5",c.pm2_5,"µg/m³"],["PM10",c.pm10,"µg/m³"],["O₃",c.ozone,"µg/m³"],["NO₂",c.nitrogen_dioxide,"µg/m³"],["SO₂",c.sulphur_dioxide,"µg/m³"],["CO",c.carbon_monoxide,"µg/m³"]];
  $("aqPills").innerHTML = P.map(([n,v,u])=>`<div class="pill"><small>${n} (${u})</small><b>${r1(v)}</b></div>`).join("");
  const H = S.air.hourly, t0 = c.time.slice(0,13)+":00", idx = H.time.indexOf(t0);
  const saved=S.range; S.range=48;
  const o = baseOpts(idx, H.time); o.scales.y.beginAtZero = true;
  mk("cAir",{type:"line",data:{labels:H.time,datasets:[
    {data:H.pm2_5,borderColor:css("--storm"),backgroundColor:css("--storm")+"22",fill:true,borderWidth:1.6,pointRadius:0,tension:.35,label:"PM2,5"},
    {data:H.pm10,borderColor:css("--ink-3"),borderWidth:1.2,pointRadius:0,tension:.35,borderDash:[4,3],label:"PM10"}]},options:o,plugins:[nowLine]});
  S.range=saved;
}

/* ---------- mar ---------- */
function renderMarine(){
  const card = $("marCard");
  if(!S.mar || !S.mar.current || S.mar.current.wave_height==null){ card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  const c = S.mar.current;
  const P = [["Altura de onda",r1(c.wave_height)+" m"],["Período",r1(c.wave_period)+" s"],["Direção",`${dirName(c.wave_direction)} (${r0(c.wave_direction)}°)`],
             ["Swell",r1(c.swell_wave_height)+" m"],["Temp. da água",c.sea_surface_temperature==null?"—":r1(c.sea_surface_temperature)+"°"],["Máx. hoje",r1(S.mar.daily.wave_height_max[0])+" m"]];
  $("marPills").innerHTML = P.map(([n,v])=>`<div class="pill"><small>${n}</small><b>${v}</b></div>`).join("");
  const H = S.mar.hourly, idx = H.time.indexOf(c.time.slice(0,13)+":00");
  const saved=S.range; S.range=48;
  const o = baseOpts(idx, H.time); o.scales.y.beginAtZero = true;
  mk("cMar",{type:"line",data:{labels:H.time,datasets:[
    {data:H.wave_height,borderColor:css("--rain"),backgroundColor:css("--rain")+"22",fill:true,borderWidth:1.8,pointRadius:0,tension:.35,label:"Onda (m)"},
    {data:H.swell_wave_height,borderColor:css("--ink-3"),borderWidth:1.2,borderDash:[4,3],pointRadius:0,tension:.35,label:"Swell (m)"}]},options:o,plugins:[nowLine]});
  S.range=saved;
}

/* ---------- locais salvos ---------- */
const sameLoc = (a,b) => a && b && Math.abs(a.lat-b.lat)<.01 && Math.abs(a.lon-b.lon)<.01;
let places = store.get("clima-places", null) || [DEFAULT];
let placeTemps = {};
async function refreshPlaceTemps(){
  if(!places.length) return;
  try{
    const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${places.map(p=>p.lat).join(",")}&longitude=${places.map(p=>p.lon).join(",")}&current=temperature_2m,weather_code,is_day&timezone=auto`);
    const arr = Array.isArray(j) ? j : [j];
    placeTemps = {};
    arr.forEach((r,k)=>{ if(places[k]) placeTemps[`${places[k].lat},${places[k].lon}`] = r.current; });
    renderPlaces(); window.Home?.refresh("places");
  }catch(e){}
}
function renderPlaces(){
  const fav = places.some(p=>sameLoc(p,S.loc));
  $("fav").classList.toggle("on", fav);
  $("fav").title = fav ? "Remover dos locais" : "Salvar local atual";
  $("placesList").innerHTML = places.length ? places.map((p,k)=>{
    const c = placeTemps[`${p.lat},${p.lon}`];
    return `<div class="pl${sameLoc(p,S.loc)?" on":""}" role="button" tabindex="0" data-k="${k}">
      ${c? icon(wmo(c.weather_code)[1],24,!c.is_day) : ""}
      <span class="pn"><b>${esc(p.name)}</b><small>${esc([p.admin,p.country].filter(Boolean).join(", "))}</small></span>
      <span class="pt">${c? r0(c.temperature_2m)+"°" : ""}</span>
      <button class="x" data-del="${k}" aria-label="Remover ${esc(p.name)}">×</button>
    </div>`;
  }).join("") : `<div class="empty">Busque uma cidade e toque na estrela para salvá-la aqui.</div>`;
}
$("placesList").addEventListener("click", e=>{
  const del = e.target.closest("[data-del]");
  if(del){ e.stopPropagation(); places.splice(+del.dataset.del,1); store.set("clima-places",places); renderPlaces(); return; }
  const it = e.target.closest(".pl"); if(it) load(places[+it.dataset.k]);
});
$("placesList").addEventListener("keydown", e=>{
  const it = e.target.closest(".pl"); if(it && (e.key==="Enter"||e.key===" ")){ e.preventDefault(); load(places[+it.dataset.k]); }
});
$("fav").onclick = ()=>{
  if(!S.loc) return;
  const k = places.findIndex(p=>sameLoc(p,S.loc));
  if(k>=0) places.splice(k,1); else places.push(S.loc);
  store.set("clima-places", places); renderPlaces(); refreshPlaceTemps();
};

/* ---------- tema ---------- */
function applyTheme(t){
  const d = document.documentElement;
  delete d.dataset.mode;
  if(t==="sat"){ d.dataset.theme = "dark"; d.dataset.mode = "sat"; }
  else if(t==="light"||t==="dark") d.dataset.theme = t;
  else delete d.dataset.theme;
  window.Sat?.resize();
  store.set("clima-theme", t);
  document.querySelectorAll("#themeSeg button").forEach(b=>b.setAttribute("aria-checked", b.dataset.t===t));
  rerender();
}
function rerender(){ if(S.fc){ renderHero(); renderMeteogram(); renderModels(); renderAir(); renderMarine(); window.Experts?.refresh(); window.Lab?.render(); window.Sports?.render(); } }
document.querySelectorAll("#themeSeg button").forEach(b=>b.onclick=()=>applyTheme(b.dataset.t));
{
  let t = "sat"; try{ t = JSON.parse(localStorage.getItem("clima-theme")) || "sat"; }catch(e){}
  document.querySelectorAll("#themeSeg button").forEach(b=>b.setAttribute("aria-checked", b.dataset.t===t));
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rerender);

/* ---------- navegação lateral ---------- */
const navLinks = [...document.querySelectorAll(".nav a")];
const io = new IntersectionObserver(es=>{
  if(document.body.dataset.view !== "painel") return;   // só marca seção do painel quando o painel está aberto
  es.forEach(en=>{ if(en.isIntersecting) navLinks.forEach(a=>a.classList.toggle("on", a.getAttribute("href")==="#"+en.target.id)); });
},{rootMargin:"-30% 0px -60% 0px"});
document.querySelectorAll(".content section").forEach(s=>io.observe(s));

/* ---------- busca e eventos ---------- */
let tmr;
$("q").addEventListener("input", e=>{
  clearTimeout(tmr); const q = e.target.value.trim();
  if(q.length<2){ $("results").style.display="none"; return; }
  tmr = setTimeout(async ()=>{
    try{
      const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=pt&format=json`);
      const R = j.results || [];
      $("results").innerHTML = R.length ? R.map((r,k)=>`<button data-k="${k}">${esc(r.name)} <small>${esc([r.admin1,r.country].filter(Boolean).join(", "))}</small></button>`).join("") : `<button disabled>Nenhuma cidade encontrada</button>`;
      $("results").style.display="block";
      $("results").querySelectorAll("button[data-k]").forEach(b=>b.onclick=()=>{
        const r = R[+b.dataset.k]; $("results").style.display="none"; $("q").value="";
        load({name:r.name, admin:r.admin1, country:r.country, lat:r.latitude, lon:r.longitude});
      });
    }catch(err){ $("results").innerHTML = `<button disabled>Busca indisponível: ${esc(err.message)}</button>`; $("results").style.display="block"; }
  }, 300);
});
$("q").addEventListener("keydown", e=>{
  if(e.key==="Enter"){ const b = $("results").querySelector("button[data-k]"); if(b) b.click(); }
  if(e.key==="Escape") $("results").style.display="none";
});
document.addEventListener("click", e=>{ if(!e.target.closest(".search")) $("results").style.display="none"; });
document.addEventListener("keydown", e=>{ if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==="k"){ e.preventDefault(); $("q").focus(); } });
/* localização do aparelho: coordenadas pelo navegador, nome pela geocodificação reversa */
async function placeName(lat, lon){
  try{
    const j = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=pt`);
    return {name: j.city || j.locality || "Minha localização", admin: j.principalSubdivision || "", country: j.countryName || ""};
  }catch(e){ return {name:"Minha localização", admin:"", country:""}; }
}
function locate(silent){
  return new Promise(res=>{
    if(!navigator.geolocation){ if(!silent) toast("Este navegador não informa a localização."); return res(null); }
    // posição ao vivo já disponível (gps.js): usa na hora, sem esperar outra leitura
    const g = window.Gps?.fix?.(); if(g && Date.now() - g.t0 < 60000){ const [lo, la] = window.Gps.pos(); window.Gps.centrar();
      placeName(+la.toFixed(4), +lo.toFixed(4)).then(n => res({...n, lat:+la.toFixed(4), lon:+lo.toFixed(4), here:true})); return; }
    navigator.geolocation.getCurrentPosition(async p=>{
      const lat = +p.coords.latitude.toFixed(4), lon = +p.coords.longitude.toFixed(4);
      res({...(await placeName(lat, lon)), lat, lon, here:true}); window.Gps?.iniciar?.();
    }, ()=>{ if(!silent) toast("Localização negada — busque a cidade pelo nome ou libere a localização nas configurações do navegador."); res(null); },
    {enableHighAccuracy:true, timeout:12000, maximumAge:60000});
  });
}
$("geo").onclick = async ()=>{ $("status").textContent = "Obtendo sua localização…"; const l = await locate(false); if(l) load(l); };
$("reload").onclick = ()=> { load(S.loc || DEFAULT); refreshPlaceTemps(); };
document.querySelectorAll("#rangeSeg button").forEach(b=>b.onclick=()=>{
  document.querySelectorAll("#rangeSeg button").forEach(x=>x.setAttribute("aria-pressed", x===b));
  S.range = +b.dataset.r; renderMeteogram();
});
let rz; addEventListener("resize", ()=>{ clearTimeout(rz); rz=setTimeout(()=>{ if(S.fc){ const i=nowIndex(), s=Math.max(0,i-6), e=i+S.range+1; drawArrows(S.fc.hourly.wind_direction_10m.slice(s,e), S.fc.hourly.wind_speed_10m.slice(s,e)); } },150); });

/* ---------- modais: detalhes, KPIs e ações ---------- */
const dlg = $("modal");
const BF_T = [1,6,12,20,29,39,50,62,75,89,103,118];
const BF_N = ["Calmaria","Aragem","Brisa leve","Brisa fraca","Brisa moderada","Brisa forte","Vento fresco","Vento forte","Ventania","Ventania forte","Tempestade","Tempestade violenta","Furacão"];
const BF_E = ["fumaça sobe na vertical","fumaça indica a direção","folhas farfalham","folhas e galhos finos em movimento","poeira e papel levantam","arbustos balançam","galhos grandes balançam, fios assobiam","árvores inteiras balançam, difícil andar","galhos quebram","danos leves em telhados","árvores arrancadas","danos generalizados","destruição"];
const bfN = v => { let b=0; while(b<BF_T.length && v>=BF_T[b]) b++; return b; };
const whenL = iso => { const dt=parseLocal(iso); return `${DOW[dt.getDay()]} ${fmtH(iso)}`; };
const dayL = iso => { const dt=parseLocal(iso); return `${DOW[dt.getDay()]} ${dt.getDate()}/${dt.getMonth()+1}`; };
const ln = (label,data,color,o={}) => Object.assign({label,data,borderColor:color,backgroundColor:color,borderWidth:2,pointRadius:0,tension:.35},o);
const X_ICON = `<svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5 5 15"/></svg>`;

function openModal(m){
  const k = (m.kpis||[]).map(([l,v,u,s,col])=>`<div class="kpi"><small>${l}</small><b${col?` style="color:${col}"`:""}>${v}${u?`<em>${u}</em>`:""}</b>${s?`<span>${s}</span>`:""}</div>`).join("");
  dlg.innerHTML = `<div class="mbody">
    <div class="mh">${m.icon||""}<div class="mt"><h3>${m.title}</h3>${m.sub?`<p>${m.sub}</p>`:""}</div><button class="ibtn mx" aria-label="Fechar">${X_ICON}</button></div>
    ${k?`<div class="kpis">${k}</div>`:""}
    ${m.chart?`<div class="mcv"><canvas id="mChart"></canvas></div>`:""}
    ${m.html||""}
    ${m.actions?.length?`<div class="mact">${m.actions.map((a,i)=>`<button class="${a.primary?"xbtn":"mbtn"}" data-a="${i}">${a.label}</button>`).join("")}</div>`:""}
  </div>`;
  dlg.querySelector(".mx").onclick = closeModal;
  dlg.querySelectorAll("[data-a]").forEach(b=>b.onclick=()=>m.actions[+b.dataset.a].fn(b));
  if(!dlg.open){ dlg.showModal(); document.documentElement.classList.add("modal-open"); }
  if(m.chart) mk("mChart", m.chart); else if(charts.mChart){ charts.mChart.destroy(); delete charts.mChart; }
  dlg.querySelector(".mbody").scrollTop = 0;
}
function closeModal(){ dlg.close(); }
dlg.addEventListener("close", ()=>document.documentElement.classList.remove("modal-open"));
dlg.addEventListener("click", e=>{ if(e.target===dlg) closeModal(); });   // clique fora do cartão

// ações comuns
const goTo = hash => ({label: hash==="#agro"?"Abrir Ceres (agro)": hash==="#ops"?"Abrir Vigia (operações)":"Ver no meteograma", fn:()=>{ closeModal(); location.hash = hash; }});
const shareA = (title, lines) => ({label:"Compartilhar", fn:b=>{
  const txt = `${title} — ${S.loc.name}\n${lines.join("\n")}\n${location.origin}`;
  if(navigator.share) navigator.share({title, text:txt}).catch(()=>{});
  else navigator.clipboard?.writeText(txt).then(()=>{ b.textContent="Copiado ✓"; setTimeout(()=>b.textContent="Compartilhar",1600); });
}});

// gráfico compacto: rótulos a cada 6 h (ou personalizados), linha da hora atual
function miniChart(L, idx, ds, scales={}, type="line"){
  const o = baseOpts(idx, L);
  o.scales.x.ticks.callback = v => { const t=L[v]; if(!t) return ""; const hh=+t.slice(11,13); if(hh%6) return null; return hh===0 ? dayL(t) : `${hh}h`; };
  Object.entries(scales).forEach(([k,v])=>{ o.scales[k] = Object.assign(o.scales[k] || {position:"right",grid:{display:false},border:{display:false},ticks:{color:css("--ink-3"),font:{family:FONT,size:11},maxTicksLimit:4}}, v); });
  if(ds.length>1) o.plugins.legend = {display:true,position:"bottom",labels:{color:css("--ink-2"),usePointStyle:true,pointStyle:"circle",boxWidth:7,boxHeight:7,font:{family:FONT,size:11}}};
  return {type, data:{labels:L,datasets:ds}, options:o, plugins:[nowLine]};
}
const scale = (rows, cur) => `<div class="mscale">${rows.map(([k,name,desc],n)=>`<div class="${n===cur?"on":""}"><b>${k}</b><span>${name}</span><small>${desc}</small></div>`).join("")}</div>`;
const W24 = () => { const i=nowIndex(), s=Math.max(0,i-6), e=Math.min(S.fc.hourly.time.length,i+25); return {i,s,e,L:S.fc.hourly.time.slice(s,e),idx:i-s,cut:a=>a.slice(s,e)}; };

const MODALS = {
  wind(){
    const h=S.fc.hourly, c=S.fc.current, w=W24();
    const sp=sl(h.wind_speed_10m,w.i,w.i+24), gs=sl(h.wind_gusts_10m,w.i,w.i+24), gm=max(gs), gk=gs.indexOf(gm);
    let u=0,v=0; sl(h.wind_direction_10m,w.i,w.i+24).forEach((d,k)=>{ u+=sp[k]*Math.sin(d*Math.PI/180); v+=sp[k]*Math.cos(d*Math.PI/180); });
    const dom = (Math.atan2(u,v)*180/Math.PI+360)%360, gf = c.wind_gusts_10m/Math.max(1,c.wind_speed_10m), b = bfN(c.wind_speed_10m);
    openModal({title:"Vento", sub:`De ${dirName(c.wind_direction_10m)} (${r0(c.wind_direction_10m)}°) · ${BF_N[b].toLowerCase()} · Beaufort ${b}`,
      kpis:[["Agora",r0(c.wind_speed_10m),"km/h"],["Rajada agora",r0(c.wind_gusts_10m),"km/h"],["Rajada máx. 24 h",r0(gm),"km/h",whenL(h.time[w.i+gk]),gm>=55?"var(--danger)":null],
            ["Média 24 h",r0(mean(sp)),"km/h"],["Direção dominante",dirName(dom),"",`${r0(dom)}° nas próximas 24 h`],["Fator de rajada",r1(gf),"×",gf>=1.8?"ar turbulento":"escoamento regular"]],
      chart: miniChart(w.L,w.idx,[ln("médio",w.cut(h.wind_speed_10m),css("--ink")), ln("rajada",w.cut(h.wind_gusts_10m),css("--danger"),{borderDash:[4,3],borderWidth:1.5})],{y:{beginAtZero:true}}),
      html:`<h4 class="msub">Escala Beaufort</h4>`+scale(BF_N.map((n,k)=>[k,n,`${k?BF_T[k-1]:0}${k<12?`–${BF_T[k]-1}`:"+"} km/h · ${BF_E[k]}`]), b),
      actions:[goTo("#ops"), shareA("Vento", [`${r0(c.wind_speed_10m)} km/h de ${dirName(c.wind_direction_10m)}, rajadas de ${r0(c.wind_gusts_10m)} km/h`, `Rajada máxima em 24 h: ${r0(gm)} km/h (${whenL(h.time[w.i+gk])})`])]});
  },
  press(){
    const h=S.fc.hourly, c=S.fc.current, w=W24(), i=w.i;
    const d3 = c.pressure_msl - (h.pressure_msl[i-3] ?? c.pressure_msl), d12 = (h.pressure_msl[i+12] ?? c.pressure_msl) - c.pressure_msl;
    const past = sl(h.pressure_msl,i-24,i+1), nx = sl(h.pressure_msl,i,i+24);
    const s = Math.max(0,i-24), e = Math.min(h.time.length,i+25), L = h.time.slice(s,e);
    const cur = d3<=-3?0 : d3<=-1?1 : d3<1?2 : d3<3?3 : 4;
    openModal({title:"Pressão ao nível do mar", sub:`${pressTrend(d3)} · ${d12<=-3?"queda forte nas próximas 12 h":d12>=3?"subida forte nas próximas 12 h":"sem mudança brusca prevista"}`,
      kpis:[["Agora",r0(c.pressure_msl),"hPa"],["Tendência 3 h",(d3>=0?"+":"")+r1(d3),"hPa",pressTrend(d3)],["Próximas 12 h",(d12>=0?"+":"")+r1(d12),"hPa",null,d12<=-5?"var(--danger)":null],
            ["Mín. 24 h passadas",r0(min(past)),"hPa"],["Máx. 24 h passadas",r0(max(past)),"hPa"],["Faixa prevista 24 h",`${r0(min(nx))}–${r0(max(nx))}`,"hPa"]],
      chart: miniChart(L,i-s,[ln("pressão",h.pressure_msl.slice(s,e),css("--accent"),{fill:true,backgroundColor:css("--rain")+"18"})]),
      html:`<h4 class="msub">Como ler a tendência de 3 h</h4>`+scale([["≤ −3","Queda acentuada","frente ou ciclone se aproximando: vento e chuva em horas"],["−3 a −1","Em queda","tempo tende a piorar"],["±1","Estável","mantém o padrão atual"],["+1 a +3","Em subida","melhora, céu abrindo"],["≥ +3","Subida acentuada","pós-frontal: ar frio e vento"]],cur),
      actions:[goTo("#s-meteo"), shareA("Pressão", [`${r0(c.pressure_msl)} hPa, ${(d3>=0?"+":"")+r1(d3)} hPa em 3 h (${pressTrend(d3)})`])]});
  },
  hum(){
    const h=S.fc.hourly, c=S.fc.current, w=W24(), T=c.temperature_2m, RH=c.relative_humidity_2m;
    const es = 6.112*Math.exp(17.62*T/(243.12+T)), abs = 216.7*(RH/100*es)/(273.15+T), vpd = es*(1-RH/100)/10;
    const rh24 = sl(h.relative_humidity_2m,w.i,w.i+24), td = c.dew_point_2m;
    const cur = td<10?0 : td<16?1 : td<20?2 : td<24?3 : 4;
    openModal({title:"Umidade e ponto de orvalho", sub:`${dewFeel(td)} · diferença temperatura–orvalho de ${r1(T-td)}°`,
      kpis:[["Umidade relativa",r0(RH),"%"],["Ponto de orvalho",r1(td),"°C"],["Diferença T − Td",r1(T-td),"°",T-td<=2?"saturação: névoa/orvalho":""],
            ["Umidade absoluta",r1(abs),"g/m³"],["Déficit de pressão de vapor",r2(vpd),"kPa",vpd>2?"ar drenando plantas":vpd<0.4?"ar quase saturado":"faixa confortável"],["UR mín.–máx. 24 h",`${r0(min(rh24))}–${r0(max(rh24))}`,"%"]],
      chart: miniChart(w.L,w.idx,[ln("umidade (%)",w.cut(h.relative_humidity_2m),css("--rain"),{yAxisID:"y"}), ln("orvalho (°C)",w.cut(h.dew_point_2m),css("--dew"),{yAxisID:"y2",borderWidth:1.6})],{y:{min:0,max:100},y2:{}}),
      html:`<h4 class="msub">Conforto pelo ponto de orvalho</h4>`+scale([["< 10°","Ar seco","pele e mucosas ressecam"],["10–16°","Confortável","sensação agradável"],["16–20°","Úmido","começa a pesar no esforço"],["20–24°","Abafado","suor não evapora"],["≥ 24°","Opressivo","risco para idosos e trabalho pesado"]],cur),
      actions:[goTo("#agro"), shareA("Umidade", [`UR ${r0(RH)}%, orvalho ${r1(td)}°C (${dewFeel(td)})`])]});
  },
  cloud(){
    const h=S.fc.hourly, c=S.fc.current, w=W24(), i=w.i, today=c.time.slice(0,10);
    let sun=0; h.time.forEach((t,k)=>{ if(t.startsWith(today) && h.is_day[k]) sun += 1 - h.cloud_cover[k]/100; });
    const vis = h.visibility[i], fogK = sl(h.visibility,i,i+24).findIndex(v=>v<1000);
    openModal({title:"Nebulosidade e visibilidade", sub:`${r0(c.cloud_cover)}% de céu coberto${fogK>=0?` · visibilidade abaixo de 1 km ${whenL(h.time[i+fogK])}`:""}`,
      kpis:[["Cobertura total",r0(c.cloud_cover),"%"],["Baixas",r0(h.cloud_cover_low[i]),"%","até 2 km — chuva e garoa"],["Médias",r0(h.cloud_cover_mid[i]),"%","2–6 km"],["Altas",r0(h.cloud_cover_high[i]),"%","cirros, acima de 6 km"],
            ["Visibilidade",vis==null?"—":vis>=10000?">10":r1(vis/1000),"km"],["Sol efetivo hoje",r1(sun),"h","estimado pela cobertura"]],
      chart: miniChart(w.L,w.idx,[ln("altas",w.cut(h.cloud_cover_high),css("--storm"),{fill:true,backgroundColor:css("--storm")+"22",borderWidth:1.2}), ln("médias",w.cut(h.cloud_cover_mid),css("--rain"),{fill:true,backgroundColor:css("--rain")+"22",borderWidth:1.2}), ln("baixas",w.cut(h.cloud_cover_low),css("--ink-3"),{fill:true,backgroundColor:css("--ink-3")+"33",borderWidth:1.2})],{y:{min:0,max:100}}),
      actions:[goTo("#s-meteo"), shareA("Nuvens", [`${r0(c.cloud_cover)}% coberto, visibilidade ${vis>=10000?">10":r1(vis/1000)} km`])]});
  },
  uv(){
    const h=S.fc.hourly, d=S.fc.daily, c=S.fc.current, today=c.time.slice(0,10), ti=d.time.indexOf(today), i=nowIndex();
    const ks = h.time.map((t,k)=>t.startsWith(today)?k:-1).filter(k=>k>=0), L = ks.map(k=>h.time[k]), U = ks.map(k=>h.uv_index[k]);
    const um = max(U), pk = L[U.indexOf(um)], prot = U.filter(u=>u>=3).length, un = h.uv_index[i];
    const burn = u => u<0.5 ? "—" : r0(200/u);   // pele tipo III: ~300 J/m² de dose eritematosa
    const col = u => u<3?"#3EC46D": u<6?"#F5D33B": u<8?"#F59A2F": u<11?"#E4422F":"#A54BD8";
    const cfg = miniChart(L, L.indexOf(c.time.slice(0,13)+":00"), [{label:"UV",data:U,backgroundColor:U.map(col),borderRadius:4,barPercentage:.9,categoryPercentage:.9}], {y:{beginAtZero:true,suggestedMax:8}}, "bar");
    const cur = um<3?0 : um<6?1 : um<8?2 : um<11?3 : 4;
    openModal({title:"Índice UV", sub:`Máximo de ${r1(um)} hoje às ${fmtH(pk)} · ${uvCat(um)}`,
      kpis:[["Agora",r1(un),"",uvCat(un)],["Máximo hoje",r1(d.uv_index_max[ti]),"",fmtH(pk)],["Horas com UV ≥ 3",prot,"h","proteção necessária"],
            ["Queimadura agora",burn(un),"min","pele morena clara, sem protetor"],["Queimadura no pico",burn(um),"min","pele morena clara, sem protetor"],["Máximo amanhã",r1(d.uv_index_max[ti+1]),"",uvCat(d.uv_index_max[ti+1])]],
      chart: cfg,
      html:`<h4 class="msub">Categorias e proteção</h4>`+scale([["0–2","Baixo","sem proteção especial"],["3–5","Moderado","protetor FPS 30, chapéu"],["6–7","Alto","evite sol das 10 às 16 h"],["8–10","Muito alto","sombra obrigatória, roupa com proteção"],["11+","Extremo","não se exponha"]],cur),
      actions:[shareA("Índice UV", [`UV máximo ${r1(um)} às ${fmtH(pk)} (${uvCat(um)})`, `Queimadura em ~${burn(um)} min no pico`])]});
  },
  sun(){
    const d=S.fc.daily, ti=d.time.indexOf(S.fc.current.time.slice(0,10));
    const sr=parseLocal(d.sunrise[ti]), ss=parseLocal(d.sunset[ti]), noon=new Date((sr.getTime()+ss.getTime())/2), hm = x => x.toTimeString().slice(0,5);
    const dl = d.daylight_duration[ti]/3600, dl1 = d.daylight_duration[ti+1]/3600, dur = v => `${Math.floor(v)} h ${String(Math.round((v%1)*60)).padStart(2,"0")}`;
    const L = d.time.slice(ti), D = d.daylight_duration.slice(ti).map(v=>v/3600);
    const o = baseOpts(null, L); o.scales.x.ticks.callback = v => dayL(L[v]); o.scales.x.ticks.autoSkip = true; o.scales.x.ticks.maxTicksLimit = 8;
    o.plugins.tooltip.callbacks.title = it => dayL(L[it[0].dataIndex]); o.plugins.tooltip.callbacks.label = it => `${dur(it.raw)} de luz`;
    const rows = d.time.slice(ti, ti+7).map((t,k)=>`<tr><td>${k?dayL(t):"Hoje"}</td><td>${fmtH(d.sunrise[ti+k])}</td><td>${fmtH(d.sunset[ti+k])}</td><td>${dur(d.daylight_duration[ti+k]/3600)}</td><td>${r1(d.et0_fao_evapotranspiration[ti+k])}</td></tr>`).join("");
    openModal({title:"Sol", sub:`${dur(dl)} de luz · ${dl1>dl?"dias crescendo":"dias diminuindo"} ${r0(Math.abs(dl1-dl)*3600)} s por dia`,
      kpis:[["Nascer",fmtH(d.sunrise[ti])],["Pôr",fmtH(d.sunset[ti])],["Meio-dia solar",hm(noon)],["Luz do dia",dur(dl)],["Hora dourada (manhã)",`até ${hm(new Date(sr.getTime()+36e5))}`],["Hora dourada (tarde)",`desde ${hm(new Date(ss.getTime()-36e5))}`]],
      chart:{type:"line", data:{labels:L, datasets:[ln("luz do dia (h)",D,css("--warn"),{fill:true,backgroundColor:css("--warn")+"22"})]}, options:o},
      html:`<h4 class="msub">Próximos 7 dias</h4><div class="tbl"><table><thead><tr><th>Dia</th><th>Nascer</th><th>Pôr</th><th>Luz</th><th>ET₀ (mm)</th></tr></thead><tbody>${rows}</tbody></table></div>`,
      actions:[shareA("Sol", [`Nascer ${fmtH(d.sunrise[ti])}, pôr ${fmtH(d.sunset[ti])}, ${dur(dl)} de luz`])]});
  }
};
const r2 = v => v==null||isNaN(v) ? "—" : (Math.round(v*100)/100).toLocaleString("pt-BR");

/* modal de uma hora: tudo o que a previsão diz sobre ela + o que os especialistas acham */
function openHour(k){
  const h=S.fc.hourly, t=h.time[k]; if(!t) return;
  const [nm,kind] = wmo(h.weather_code[k]), vis=h.visibility[k];
  const st = window.Experts?.statusAt(t) || [];
  const xs = st.length ? `<h4 class="msub">Especialistas nesta hora</h4><div class="mst">${st.map(x=>`<div><i class="c${x.s}"></i><b>${esc(x.label)}</b><span>${esc(x.why)}${x.s&&x.tag?` — ${esc(x.tag)}`:""}</span><small>${x.n}</small></div>`).join("")}</div>` : "";
  openModal({icon: icon(kind,44,!h.is_day[k]), title: `${dayL(t)} · ${fmtH(t)}`, sub: nm,
    kpis:[["Temperatura",r1(h.temperature_2m[k]),"°C"],["Sensação",r1(h.apparent_temperature[k]),"°C"],["Ponto de orvalho",r1(h.dew_point_2m[k]),"°C"],["Umidade",r0(h.relative_humidity_2m[k]),"%"],
          ["Chuva",r1(h.precipitation[k]),"mm",`probabilidade ${r0(h.precipitation_probability[k])}%`,h.precipitation[k]>=5?"var(--rain)":null],["Vento",r0(h.wind_speed_10m[k]),"km/h",`de ${dirName(h.wind_direction_10m[k])} · rajada ${r0(h.wind_gusts_10m[k])}`],
          ["Pressão",r0(h.pressure_msl[k]),"hPa"],["Nuvens",r0(h.cloud_cover[k]),"%",`b ${r0(h.cloud_cover_low[k])} · m ${r0(h.cloud_cover_mid[k])} · a ${r0(h.cloud_cover_high[k])}`],
          ["Visibilidade",vis==null?"—":vis>=10000?">10":r1(vis/1000),"km"],["UV",r1(h.uv_index[k])],["CAPE",r0(h.cape[k]),"J/kg",`LI ${r1(h.lifted_index[k])}`],["Índice Beaufort",bfN(h.wind_speed_10m[k]),"",BF_N[bfN(h.wind_speed_10m[k])].toLowerCase()]],
    html: xs,
    actions:[{label:"← Hora anterior", fn:()=>openHour(k-1)}, {label:"Próxima hora →", primary:true, fn:()=>openHour(k+1)}, shareA(`${dayL(t)} ${fmtH(t)}`, [`${nm}, ${r0(h.temperature_2m[k])}°C, chuva ${r1(h.precipitation[k])} mm (${r0(h.precipitation_probability[k])}%), vento ${r0(h.wind_speed_10m[k])} km/h`])]});
}

/* modal de um dia da lista de 16 dias */
function openDay(k){
  const d=S.fc.daily, h=S.fc.hourly, t=d.time[k]; if(!t) return;
  const start = d.time.indexOf(S.fc.current.time.slice(0,10)); if(k<start) return;
  const [nm,kind] = wmo(d.weather_code[k]), cl = climFor(t), an = cl ? d.temperature_2m_max[k]-cl.max : null;
  const ks = h.time.map((x,j)=>x.startsWith(t)?j:-1).filter(j=>j>=0), L = ks.map(j=>h.time[j]);
  const idx = L.indexOf(S.fc.current.time.slice(0,13)+":00");
  const cfg = miniChart(L, idx<0?null:idx, [
    ln("temperatura (°C)", ks.map(j=>h.temperature_2m[j]), css("--heat"), {yAxisID:"y"}),
    {type:"bar", label:"chuva (mm)", data:ks.map(j=>h.precipitation[j]), backgroundColor:css("--rain")+"AA", borderRadius:3, yAxisID:"y2"}
  ], {y2:{beginAtZero:true,suggestedMax:2}});
  const label = k===start ? "Hoje" : dayL(t);
  openModal({icon: icon(kind,44), title: label, sub: `${nm}${cl?` · média climatológica da máxima ${r1(cl.max)}°`:""}`,
    kpis:[["Máxima",r0(d.temperature_2m_max[k]),"°C",null,"var(--heat)"],["Mínima",r0(d.temperature_2m_min[k]),"°C",null,"var(--cold)"],["Sensação máx.",r0(d.apparent_temperature_max[k]),"°C"],
          ["Anomalia",an==null?"—":(an>0?"+":"")+r1(an),"°","vs 2015–2024",an==null?null:an>=2?"var(--heat)":an<=-2?"var(--cold)":null],["Chuva",r1(d.precipitation_sum[k]),"mm",`${r0(d.precipitation_hours[k])} h com chuva`],["Probabilidade",r0(d.precipitation_probability_max[k]),"%"],
          ["Rajada máx.",r0(d.wind_gusts_10m_max[k]),"km/h",`dominante de ${dirName(d.wind_direction_10m_dominant[k])}`],["UV máx.",r1(d.uv_index_max[k]),"",uvCat(d.uv_index_max[k])],["Sol",`${fmtH(d.sunrise[k])}–${fmtH(d.sunset[k])}`],["ET₀",r1(d.et0_fao_evapotranspiration[k]),"mm","evapotranspiração de referência"]],
    chart: ks.length ? cfg : null,
    actions:[{label:"← Dia anterior", fn:()=>openDay(k-1)}, {label:"Próximo dia →", primary:true, fn:()=>openDay(k+1)}, shareA(label, [`${nm}, ${r0(d.temperature_2m_min[k])}–${r0(d.temperature_2m_max[k])}°C, chuva ${r1(d.precipitation_sum[k])} mm (${r0(d.precipitation_probability_max[k])}%)`])]});
}

// gatilhos: cartões de instrumento, horas e dias (clique ou Enter)
function trigger(e){
  if(e.type==="keydown" && e.key!=="Enter" && e.key!==" ") return;
  const m = e.target.closest("[data-m]"), hr = e.target.closest("[data-i]"), dy = e.target.closest("[data-k]");
  if(!S.fc || !(m||hr||dy) || e.target.closest(".pl")) return;
  if(e.type==="keydown") e.preventDefault();
  if(m) MODALS[m.dataset.m](); else if(hr) openHour(+hr.dataset.i); else if(dy && dy.closest("#days")) openDay(+dy.dataset.k);
}
$("app").addEventListener("click", trigger);
$("app").addEventListener("keydown", trigger);
document.querySelectorAll(".inst[data-m] h3").forEach(h=>h.insertAdjacentHTML("beforeend",`<svg class="chev" viewBox="0 0 20 20" aria-hidden="true"><path d="M8 5l5 5-5 5"/></svg>`));

/* núcleo compartilhado com os módulos especialistas (experts.js) */
const pertoDe = (a, b) => Math.abs(a.lat - b.lat) < 1e-3 && Math.abs(a.lon - b.lon) < 1e-3;
window.ClimaCore = { get S(){ return S; }, $, css, icon, wmo, esc, r0, r1, fmtH, DOW, parseLocal, sum, max, min, mean, sl, dirName, getJSON, nowIndex, modelSpread, mk, FONT, openHour, openDay, openModal, closeModal, dayL, whenL, load, placeName, aqiCat, uvCat, beaufort, get places(){ return places; }, isSaved: p => places.some(q=>pertoDe(q,p)),
  // salvar/remover qualquer lugar (cartão do mapa): não muda o local da previsão. Comparação exata (~100 m):
  // um ponto marcado no Centro não pode ser confundido com a cidade salva
  savePlace(p){ const k = places.findIndex(q=>pertoDe(q,p)); if(k>=0) places.splice(k,1); else places.push({name:p.name, admin:p.admin||"", country:p.country||"", lat:+(+p.lat).toFixed(4), lon:+(+p.lon).toFixed(4)});
    store.set("clima-places", places); renderPlaces(); refreshPlaceTemps(); return k < 0; }, get placeTemps(){ return placeTemps; } };

/* ---------- início ---------- */
// Ao abrir, pede a localização do aparelho; sem permissão, cai no último local visto (ou no padrão).
const start = store.get("clima-loc", null);
if(typeof Chart === "undefined"){ $("status").innerHTML = `<span class="err">A biblioteca de gráficos não carregou. Recarregue a página.</span>`; }
else {
  // mostra já o último local (ou o padrão) e troca para a posição do aparelho quando ela chegar
  load(start && start.lat!=null ? start : DEFAULT);
  refreshPlaceTemps();
  locate(true).then(l => { if(l && !sameLoc(l, S.loc)) load(l); });
}
// dados meteorológicos em tempo real: recarrega a cada 20 min (e ao voltar para o app, se passou desse tempo)
const REFRESH = 20*60*1000;
setInterval(()=>{ if(S.loc && !document.hidden){ load(S.loc); refreshPlaceTemps(); } }, REFRESH);
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden && S.loc && S.fetchedAt && Date.now() - S.fetchedAt > REFRESH){ load(S.loc); refreshPlaceTemps(); } });
/* PWA: avisa quando há versão nova (sem precisar recarregar "no escuro") e procura atualização a cada 30 min */
if("serviceWorker" in navigator){
  const hadCtrl = !!navigator.serviceWorker.controller;
  // procura versão nova a cada 5 min e ao voltar para a aba (o aviso "Atualizar" aparece logo que ela chega)
  navigator.serviceWorker.register("sw.js").then(reg=>{ const upd = ()=>reg.update().catch(()=>{});
    setInterval(upd, 5*60*1000); document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState === "visible") upd(); }); addEventListener("focus", upd); }).catch(()=>{});
  navigator.serviceWorker.addEventListener("controllerchange", ()=>{
    if(!hadCtrl || document.getElementById("updToast")) return;
    const t = document.createElement("div"); t.id = "updToast"; t.className = "upd-toast"; t.setAttribute("role","status");
    t.innerHTML = `<span>Nova versão do Clima disponível</span><button class="xbtn" type="button">Atualizar</button><button class="ibtn sm" type="button" aria-label="Depois">✕</button>`;
    t.querySelector(".xbtn").onclick = ()=>location.reload();
    t.querySelector(".ibtn").onclick = ()=>t.remove();
    document.body.appendChild(t);
  });
}
// instalável: guarda o convite do navegador e oferece no menu ☰ / clique direito
let installEvt = null;
addEventListener("beforeinstallprompt", e=>{ e.preventDefault(); installEvt = e; });
// aviso discreto (no lugar do alert do navegador, que trava a tela)
function toast(msg, ms = 4200){
  let t = document.getElementById("toast"); if(!t){ t = document.createElement("div"); t.id = "toast"; t.className = "toast glass"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), ms);
}
window.ClimaToast = toast;
window.ClimaInstall = () => installEvt ? (installEvt.prompt(), installEvt = null, true) : false;
})();
