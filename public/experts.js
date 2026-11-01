/* =============================================================================
   Módulos especialistas — CERES (agrometeorologia) e VIGIA (operações e HSE).
   Regras determinísticas sobre a previsão horária: cada hora recebe um estado
   (0 liberado · 1 atenção · 2 parado) com o motivo; daí saem janelas, achados,
   ordens e um veredito. Nada aqui é IA generativa: é critério técnico explícito.
   ============================================================================= */
(() => {
"use strict";
const C = window.ClimaCore;
const {$, esc, r0, r1, fmtH, DOW, parseLocal, sum, max, min, mean, sl, dirName, getJSON} = C;
const H = 48;                         // horizonte da linha do tempo
const X = {loc:null, h:null, i0:0, busy:false};
const store = {
  get(k,d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};

const XH = "temperature_2m,relative_humidity_2m,dew_point_2m,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,wind_speed_80m,wind_direction_10m,cape,lifted_index,visibility,shortwave_radiation,vapour_pressure_deficit,et0_fao_evapotranspiration,soil_temperature_0cm,soil_moisture_0_to_1cm,soil_moisture_3_to_9cm,cloud_cover,is_day";
const urlX = l => `https://api.open-meteo.com/v1/forecast?latitude=${l.lat}&longitude=${l.lon}&hourly=${XH}&past_days=3&forecast_days=8&timezone=auto&wind_speed_unit=kmh`;

/* ---------- física ---------- */
// bulbo úmido (Stull, 2011) — erro < 0,3 °C para UR 5–99 %
const wetBulb = (T,RH) => T*Math.atan(0.151977*Math.sqrt(RH+8.313659)) + Math.atan(T+RH) - Math.atan(RH-1.676331) + 0.00391838*RH**1.5*Math.atan(0.023101*RH) - 4.686035;
// índice de temperatura e umidade para bovinos
const thi = (T,RH) => (1.8*T+32) - (0.55-0.0055*RH)*(1.8*T-26);
// taxa de evaporação do concreto fresco (ACI 305R, forma de Uno), kg/m²/h; concreto ≈ ar + 2 °C
const evap = (T,RH,V) => Math.max(0, 5*((T+2+18)**2.5 - (RH/100)*(T+18)**2.5)*(V+4)*1e-6);
// IBUTG externo estimado: bulbo úmido natural e globo aproximados a partir de T, UR, radiação e vento
const ibutg = (T,RH,SW,V) => { const ws = V/3.6, tw = wetBulb(T,RH) + 0.0015*SW, tg = T + 0.017*SW/(1+0.15*ws); return 0.7*tw + 0.2*tg + 0.1*T; };

/* ---------- tempo ---------- */
function rel(iso){
  const today = C.S.fc.current.time.slice(0,10), d = parseLocal(iso), t = parseLocal(today+"T00:00");
  const dd = Math.round((new Date(d.getFullYear(),d.getMonth(),d.getDate()) - t)/864e5);
  const hh = fmtH(iso).slice(0,2)+"h";
  return dd===0 ? `hoje ${hh}` : dd===1 ? `amanhã ${hh}` : dd===-1 ? `ontem ${hh}` : `${DOW[d.getDay()]} ${hh}`;
}
const hrs = n => n===1 ? "1 h" : `${n} h`;

/* janelas contínuas de um estado dentro do horizonte */
function runs(cells, ok = s => s===0){
  const out = []; let st = -1;
  cells.forEach((c,k)=>{ if(ok(c.s)){ if(st<0) st=k; } else if(st>=0){ out.push([st,k-1]); st=-1; } });
  if(st>=0) out.push([st,cells.length-1]);
  return out;
}
function bestRun(cells, minLen, ok = s => s===0, dayOnly = false){
  const c = dayOnly ? cells.map((x,k)=>({s: at("is_day",k) ? x.s : 9})) : cells;
  return runs(c, ok).filter(([a,b])=>b-a+1>=minLen)[0] || null;
}
// "hoje 15h → 19h" no mesmo dia; "hoje 15h → amanhã 12h" quando atravessa
const span = (r) => {
  const a = X.h.time[X.i0+r[0]], b = X.h.time[X.i0+r[1]+1] || X.h.time[X.i0+r[1]];
  return a.slice(0,10)===b.slice(0,10) ? `${rel(a)} → ${fmtH(b).slice(0,2)}h` : `${rel(a)} → ${rel(b)}`;
};
// primeira hora (a partir de k) em que a condição deixa de ser "parado"
const until = (cells, k=0) => { const j = cells.findIndex((c,n)=>n>=k && c.s<2); return j<0 ? null : X.h.time[X.i0+j]; };
function topWhy(cells){
  const t = {}; cells.forEach(c=>{ if(c.s>0 && c.tag) t[c.tag]=(t[c.tag]||0)+1; });
  return Object.entries(t).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
}

/* ---------- carga ---------- */
async function load(loc){
  X.loc = loc; X.h = null;
  ["agro","ops"].forEach(k=>{ const el=$("x-"+k+"-body"); if(el) el.innerHTML = `<div class="xload">Lendo a atmosfera para ${esc(loc.name)}…</div>`; });
  try{ const j = await getJSON(urlX(loc)); if(X.loc!==loc) return; X.h = j.hourly; }
  catch(e){ ["agro","ops"].forEach(k=>{ $("x-"+k+"-body").innerHTML = `<div class="xload err">Dados do especialista indisponíveis (${esc(e.message)}).</div>`; }); return; }
  refresh();
}
function refresh(){
  if(!X.h || !C.S.fc) return;
  const t = C.S.fc.current.time.slice(0,13)+":00", i = X.h.time.indexOf(t);
  X.i0 = i<0 ? 72 : i;
  X.last = {agro: ceres(), ops: vigia()};
  renderExpert("agro", X.last.agro);
  renderExpert("ops", X.last.ops);
  window.Home?.refresh();
}
const at = (a,k) => X.h[a][X.i0+k];
const win = (a,s,e) => sl(X.h[a], X.i0+s, X.i0+e);
function confidence(){
  if(!C.S.models) return {v:null, txt:"sem comparação de modelos"};
  const sd = max(C.modelSpread().slice(0,3).map(x=>x.sd));
  const v = Math.round(Math.max(35, Math.min(95, 95 - sd*18)));
  return {v, txt: sd<1 ? `modelos convergem (±${r1(sd)}°)` : sd<2 ? `modelos divergem pouco (±${r1(sd)}°)` : `modelos em conflito (±${r1(sd)}°)`};
}

/* =============================================================================
   CERES — agrometeorologista sênior
   ============================================================================= */
const CROPS = {
  soja:    {nome:"Soja",            doenca:"ferrugem-asiática",       tmin:15, tmax:28, horas:6,  calor:35, frio:{t:2,  txt:"geada"}},
  milho:   {nome:"Milho",           doenca:"cercosporiose",           tmin:22, tmax:30, horas:11, calor:35, frio:{t:2,  txt:"geada"}},
  arroz:   {nome:"Arroz irrigado",  doenca:"brusone",                 tmin:20, tmax:28, horas:10, calor:35, frio:{t:15, txt:"frio na floração (esterilidade de espigueta)"}},
  maca:    {nome:"Maçã",            doenca:"sarna-da-macieira",       tmin:10, tmax:24, horas:9,  calor:34, frio:{t:0,  txt:"geada na brotação/floração"}},
  horta:   {nome:"Hortaliças",      doenca:"míldio",                  tmin:10, tmax:22, horas:4,  calor:32, frio:{t:2,  txt:"geada"}},
  pasto:   {nome:"Pastagem e gado", doenca:"fungos foliares",         tmin:18, tmax:28, horas:12, calor:35, frio:{t:2,  txt:"geada no pasto"}}
};
function ceres(){
  const crop = CROPS[store.get("ceres-crop","soja")] || CROPS.soja;
  const rows = [], F = [];

  // --- pulverização: Delta T, vento, chuva de lavagem, temperatura
  const spray = [];
  for(let k=0;k<H;k++){
    const T=at("temperature_2m",k), RH=at("relative_humidity_2m",k), W=at("wind_speed_10m",k), G=at("wind_gusts_10m",k);
    const dT = T - wetBulb(T,RH), rain2 = sum(win("precipitation",k,k+3)), p3 = max(win("precipitation_probability",k,k+3)), day = at("is_day",k);
    let s=0, why=`ΔT ${r1(dT)} · vento ${r0(W)} km/h`, tag="";
    if(at("precipitation",k)>0.1 || rain2>=0.5){ s=2; tag="chuva lava o produto"; why=`chuva ${r1(rain2)} mm nas próximas 3 h`; }
    else if(W>=18 || G>=28){ s=2; tag="vento: deriva"; why=`vento ${r0(W)} / rajada ${r0(G)} km/h`; }
    else if(dT>10 || T>32){ s=2; tag="ar seco/quente: evaporação da gota"; why=`ΔT ${r1(dT)} · ${r0(T)}°C`; }
    else if(W<4){ s=1; tag="calmaria: risco de inversão térmica"; why=`vento ${r0(W)} km/h — gota fica suspensa`; }
    else if(dT<2){ s=1; tag="ΔT baixo: gota fina escorre/deriva"; why=`ΔT ${r1(dT)}`; }
    else if(dT>8 || T>28 || RH<50){ s=1; tag="ΔT alto: perda por evaporação"; why=`ΔT ${r1(dT)} · UR ${r0(RH)}%`; }
    else if(p3>=50){ s=1; tag="chance de chuva"; why=`probabilidade ${r0(p3)}% em 3 h`; }
    if(!day && s===0){ s=1; tag="noite: inversão provável"; why+=" · noite"; }
    spray.push({s,why,tag});
  }
  rows.push({label:"Pulverização", cells:spray});

  // --- molhamento foliar e pressão de doença
  const wet = [];
  for(let k=0;k<72;k++){
    const T=at("temperature_2m",k), RH=at("relative_humidity_2m",k), Td=at("dew_point_2m",k), P=at("precipitation",k);
    const isWet = RH>=90 || P>0.1 || T-Td<=2, fav = isWet && T>=crop.tmin && T<=crop.tmax;
    wet.push({s: fav?2 : isWet?1 : 0, why: isWet ? `molhado · ${r0(T)}°C · UR ${r0(RH)}%${fav?" — faixa ótima do fungo":""}` : `seco · UR ${r0(RH)}%`, tag: fav?"molhamento favorável":"molhamento"});
  }
  rows.push({label:`Molhamento · ${crop.doenca}`, cells:wet.slice(0,H)});

  // --- máquinas no campo / colheita
  const past72 = sum(sl(X.h.precipitation, X.i0-72, X.i0));
  const mach = [];
  for(let k=0;k<H;k++){
    const prev24 = sum(sl(X.h.precipitation, X.i0+k-24, X.i0+k)), sm = at("soil_moisture_3_to_9cm",k), RH = at("relative_humidity_2m",k), P = at("precipitation",k);
    let s=0, why=`solo ${r0(sm*100)}% vol · chuva 24 h ${r1(prev24)} mm`, tag="";
    if(P>=0.5){ s=2; tag="chovendo"; why=`chuva ${r1(P)} mm/h`; }
    else if(prev24>=20 || sm>=0.40){ s=2; tag="solo encharcado: compactação"; }
    else if(prev24>=8 || sm>=0.34){ s=1; tag="solo úmido: patinagem"; }
    else if(RH>=88){ s=1; tag="orvalho: grão/palha úmidos"; why=`UR ${r0(RH)}% — umidade do grão alta`; }
    mach.push({s,why,tag});
  }
  rows.push({label:"Máquinas e colheita", cells:mach});

  // --- conforto animal (ITU)
  const cow = [];
  for(let k=0;k<H;k++){
    const v = thi(at("temperature_2m",k), at("relative_humidity_2m",k));
    cow.push({s: v>=79?2 : v>=72?1 : 0, why:`ITU ${r0(v)}`, tag: v>=79?"estresse calórico":"desconforto", v});
  }
  rows.push({label:"Gado (ITU)", cells:cow});

  // --- geada / frio crítico
  const frost = [];
  for(let k=0;k<H;k++){
    const T=at("temperature_2m",k), W=at("wind_speed_10m",k), cc=at("cloud_cover",k), Ts=at("soil_temperature_0cm",k);
    const rad = W<8 && cc<40;           // noite de radiação: folha resfria 2–4 °C abaixo do abrigo
    let s=0, why=`${r1(T)}°C · solo ${r1(Ts)}°C`;
    if(T<=crop.frio.t || Ts<=0 || (rad && T<=crop.frio.t+2)) s=2;
    else if(T<=crop.frio.t+3 && rad) s=1;
    frost.push({s,why: why + (rad?" · céu limpo e vento fraco":""), tag:crop.frio.txt});
  }
  rows.push({label: crop.frio.t>=10 ? "Frio crítico" : "Geada", cells:frost});

  /* ---- achados ---- */
  const sw = bestRun(spray, 3, undefined, true);
  if(sw){
    const now = sw[0]===0;
    F.push({lvl: now?0:1, head: now ? `PULVERIZE AGORA. A janela fecha ${fmtH(X.h.time[X.i0+sw[1]+1])}.` : `Pulverização só ${rel(X.h.time[X.i0+sw[0]])}.`,
      t:"Janela de pulverização", d:`${span(sw)} (${hrs(sw[1]-sw[0]+1)} contínuas com ΔT 2–8, vento 4–18 km/h e sem chuva de lavagem).`,
      o:`Aplique ${span(sw)}. Gota média a grossa, barra baixa, volume de calda cheio. Fora disso, máquina parada.`});
  } else {
    const w = topWhy(spray);
    F.push({lvl:2, head:"NÃO PULVERIZE nas próximas 48 h.", t:"Sem janela de pulverização", d:`Nenhum bloco de 3 h seguras. Principal bloqueio: ${w[0]||"—"}${w[1]?`; depois, ${w[1]}`:""}.`,
      o:"Segure o produto no galpão. Aplicar nessas condições é jogar dinheiro na deriva ou na enxurrada."});
  }

  const wr = runs(wet, s=>s===2).map(([a,b])=>({a,b,n:b-a+1})).sort((x,y)=>y.n-x.n)[0];
  if(wr && wr.n>=crop.horas){
    const ante = sw && sw[1] < wr.a ? ` A janela de pulverização ${span(sw)} vem antes — use-a.` : " Não há janela de aplicação antes disso: priorize produto sistêmico na primeira brecha.";
    F.push({lvl:3, head:`${crop.doenca.toUpperCase()}: infecção provável ${rel(X.h.time[X.i0+wr.a])}.`, t:`Pressão alta de ${crop.doenca}`,
      d:`${hrs(wr.n)} seguidas de folha molhada entre ${crop.tmin} e ${crop.tmax}°C a partir de ${rel(X.h.time[X.i0+wr.a])}. O limiar para ${crop.nome.toLowerCase()} é ${hrs(crop.horas)}.`,
      o:`Proteção preventiva ANTES de ${rel(X.h.time[X.i0+wr.a])}.${ante}`});
  } else if(wr && wr.n>=Math.ceil(crop.horas*.6)){
    F.push({lvl:1, t:`Pressão moderada de ${crop.doenca}`, d:`Molhamento favorável de ${hrs(wr.n)} (limiar ${hrs(crop.horas)}) a partir de ${rel(X.h.time[X.i0+wr.a])}.`, o:"Vistorie as folhas do baixeiro em 48 h. Se aparecer lesão, entre com curativo."});
  } else F.push({lvl:0, t:`Pressão baixa de ${crop.doenca}`, d:`Maior período favorável: ${hrs(wr?wr.n:0)} em 72 h (limiar ${hrs(crop.horas)}).`});

  const t72 = win("temperature_2m",0,72), tminV = min(t72), tminK = t72.indexOf(tminV);
  const soilMin = min(win("soil_temperature_0cm",0,72));
  if(tminV<=crop.frio.t || soilMin<=0){
    F.push({lvl:3, head:`${crop.frio.txt.toUpperCase()} ${rel(X.h.time[X.i0+tminK])}: ${r1(tminV)}°C.`, t:`Risco de ${crop.frio.txt}`,
      d:`Mínima de ${r1(tminV)}°C ${rel(X.h.time[X.i0+tminK])}, superfície do solo até ${r1(soilMin)}°C, nebulosidade ${r0(at("cloud_cover",tminK))}%, vento ${r0(at("wind_speed_10m",tminK))} km/h.`,
      o: crop.frio.t>=10 ? "Lâmina d'água alta (15–20 cm) na lavoura em floração para proteger a panícula." : "Ligue a aspersão antes da temperatura cruzar 1°C e só desligue com o sol derretendo o gelo. Recolha bezerros; cubra mudas."});
  } else if(tminV<=crop.frio.t+3){
    F.push({lvl:1, t:`Frio próximo do limite`, d:`Mínima de ${r1(tminV)}°C ${rel(X.h.time[X.i0+tminK])}. A folha pode ficar 2–3°C abaixo disso em noite limpa.`, o:"Monitore a madrugada. Baixadas e encostas sul são as primeiras a gear."});
  }

  const tmaxV = max(t72), tmaxK = t72.indexOf(tmaxV);
  if(tmaxV>=crop.calor) F.push({lvl:2, t:"Calor na fase reprodutiva", d:`${r1(tmaxV)}°C ${rel(X.h.time[X.i0+tmaxK])}. Acima de ${crop.calor}°C há abortamento de flores e pólen inviável.`, o:"Se houver irrigação, molhe de madrugada no dia do pico. Não faça aplicação foliar no período quente."});

  const rain7 = sum(win("precipitation",0,168)), et7 = sum(win("et0_fao_evapotranspiration",0,168)), bal = rain7-et7;
  if(bal<=-25) F.push({lvl:2, t:"Déficit hídrico", d:`7 dias: chuva ${r0(rain7)} mm contra evapotranspiração de ${r0(et7)} mm. Saldo: ${r0(bal)} mm.`, o:`Reponha ${r0(-bal)} mm na semana (≈ ${r0(-bal/2)} mm a cada 3–4 dias), sempre à noite ou de madrugada.`});
  else if(bal>=60) F.push({lvl:2, t:"Excesso de água", d:`7 dias: chuva ${r0(rain7)} mm, evapotranspiração ${r0(et7)} mm. Sobram ${r0(bal)} mm.`, o:"Limpe drenos e curvas de nível já. Adie adubação de cobertura: o nitrogênio vai embora com a água."});
  else F.push({lvl:0, t:"Balanço hídrico equilibrado", d:`7 dias: chuva ${r0(rain7)} mm, evapotranspiração ${r0(et7)} mm (saldo ${bal>0?"+":""}${r0(bal)} mm).`});

  const sm = at("soil_moisture_3_to_9cm",0);
  if(past72>=40 || sm>=0.40){
    const ok = bestRun(mach, 4);
    F.push({lvl:2, t:"Solo sem trafegabilidade", d:`${r0(past72)} mm nas últimas 72 h; umidade a 3–9 cm de ${r0(sm*100)}% vol.`, o:`Máquina pesada fora da lavoura${ok?` até ${rel(X.h.time[X.i0+ok[0]])}`:" nas próximas 48 h"}. Compactação agora custa produtividade por anos.`});
  }

  const thiMax = max(cow.map(c=>c.v)), thiK = cow.findIndex(c=>c.v===thiMax);
  if(thiMax>=79) F.push({lvl: thiMax>=84?3:2, t:"Estresse calórico no rebanho", d:`ITU ${r0(thiMax)} ${rel(X.h.time[X.i0+thiK])}. Acima de 79 a vaca leiteira derruba produção e fertilidade.`, o:"Sombra para todos, água à vontade (o consumo sobe 30%), ordenha e manejo só antes das 9h e depois das 17h. Aspersão + ventilação no curral de espera."});
  else if(thiMax>=72) F.push({lvl:1, t:"Desconforto térmico leve no rebanho", d:`ITU máximo ${r0(thiMax)} ${rel(X.h.time[X.i0+thiK])}.`, o:"Garanta sombra e bebedouro limpo no piquete da tarde."});

  const vpd = win("vapour_pressure_deficit",0,H), vMax = max(vpd), vK = vpd.indexOf(vMax);
  if(vMax>=2.5) F.push({lvl:1, t:"Demanda atmosférica extrema", d:`VPD de ${r1(vMax)} kPa ${rel(X.h.time[X.i0+vK])}: a planta fecha estômato e para de absorver produto.`, o:"Nada de foliar no pico da tarde. Irrigação de madrugada."});

  let gdd = 0; for(let d=0; d<7; d++){ const day = win("temperature_2m", d*24, d*24+24); gdd += Math.max(0, (max(day)+min(day))/2 - 10); }
  F.push({lvl:0, t:"Graus-dia (base 10°C)", d:`${r0(gdd)} GD acumulados nos próximos 7 dias (${r1(gdd/7)} por dia).`});

  return {
    id:"agro", nome:"CERES", cargo:"Agrometeorologista sênior",
    bio:"Lê a atmosfera pelo que ela faz com a lavoura, o pasto e o solo. Não negocia com deriva, nem com fungo.",
    extra: cropPicker(), rows, F, ok:"Campo liberado. Trabalhe."
  };
}
function cropPicker(){
  const cur = store.get("ceres-crop","soja");
  return `<label class="xpick">Cultura <select id="ceresCrop">${Object.entries(CROPS).map(([k,c])=>`<option value="${k}"${k===cur?" selected":""}>${c.nome}</option>`).join("")}</select></label>`;
}

/* =============================================================================
   VIGIA — meteorologista de operações e segurança
   ============================================================================= */
function vigia(){
  const rows = [], F = [];
  const lightning = k => { const wc=at("weather_code",k), cape=at("cape",k), li=at("lifted_index",k), pp=at("precipitation_probability",k);
    return wc>=95 || (cape>=1500 && li<=-3) ? 2 : (cape>=800 && li<=-1 && pp>=30) ? 1 : 0; };

  const ray = [];
  for(let k=0;k<H;k++){ const s=lightning(k); ray.push({s, why:`CAPE ${r0(at("cape",k))} · LI ${r1(at("lifted_index",k))}${at("weather_code",k)>=95?" · trovoada prevista":""}`, tag:"descargas atmosféricas"}); }
  rows.push({label:"Raios", cells:ray});

  const crane = [];
  for(let k=0;k<H;k++){
    const w80=at("wind_speed_80m",k), g=at("wind_gusts_10m",k);
    let s = (w80>=45 || g>=55 || ray[k].s===2) ? 2 : (w80>=30 || g>=40 || ray[k].s===1) ? 1 : 0;
    crane.push({s, why:`vento a 80 m ${r0(w80)} · rajada ${r0(g)} km/h${ray[k].s?" · raio":""}`, tag: ray[k].s===2?"raio":"vento em altura"});
  }
  rows.push({label:"Içamento / guindaste", cells:crane});

  const height = [];
  for(let k=0;k<H;k++){
    const g=at("wind_gusts_10m",k), P=at("precipitation",k), vis=at("visibility",k);
    let s=0, tag="";
    if(ray[k].s===2 || g>=40 || P>=1){ s=2; tag = ray[k].s===2?"raio": g>=40?"rajada ≥ 40 km/h":"chuva: superfície escorregadia"; }
    else if(g>=30 || P>0 || vis<1000 || ray[k].s===1){ s=1; tag = g>=30?"rajada forte": P>0?"garoa":"visibilidade/instabilidade"; }
    height.push({s, why:`rajada ${r0(g)} km/h · chuva ${r1(P)} mm`, tag});
  }
  rows.push({label:"Trabalho em altura (NR-35)", cells:height});

  const conc = [];
  for(let k=0;k<H;k++){
    const T=at("temperature_2m",k), RH=at("relative_humidity_2m",k), W=at("wind_speed_10m",k), E=evap(T,RH,W), r6=sum(win("precipitation",k,k+6));
    let s=0, tag="";
    if(r6>=1){ s=2; tag="chuva nas 6 h seguintes"; }
    else if(T<5 || T>35){ s=2; tag="temperatura fora da faixa"; }
    else if(E>=1){ s=2; tag="evaporação ≥ 1 kg/m²/h: fissura plástica"; }
    else if(E>=0.5 || T>30 || at("precipitation_probability",k)>=50){ s=1; tag = E>=0.5?"evaporação alta":"calor/chance de chuva"; }
    conc.push({s, why:`evaporação ${r1(E)} kg/m²/h · chuva 6 h ${r1(r6)} mm`, tag, E});
  }
  rows.push({label:"Concretagem", cells:conc});

  const heat = [];
  for(let k=0;k<H;k++){
    const v = ibutg(at("temperature_2m",k), at("relative_humidity_2m",k), at("shortwave_radiation",k), at("wind_speed_10m",k));
    heat.push({s: v>28?2 : v>25?1 : 0, why:`IBUTG ≈ ${r1(v)}°C`, tag:"sobrecarga térmica", v});
  }
  rows.push({label:"Trabalho pesado ao sol", cells:heat});

  const road = [];
  for(let k=0;k<H;k++){
    const vis=at("visibility",k), P=at("precipitation",k), g=at("wind_gusts_10m",k);
    let s=0, tag="";
    if(vis<500 || P>=15 || g>=70){ s=2; tag = vis<500?"neblina densa": P>=15?"aquaplanagem":"tombamento de carga alta"; }
    else if(vis<2000 || P>=5 || g>=50){ s=1; tag = vis<2000?"visibilidade reduzida": P>=5?"pista molhada":"vento lateral"; }
    road.push({s, why:`visib. ${vis>=10000?">10":r1(vis/1000)} km · chuva ${r1(P)} mm/h · rajada ${r0(g)}`, tag});
  }
  rows.push({label:"Estrada / frota", cells:road});

  const M = C.S.mar;
  if(M && M.hourly && M.current && M.current.wave_height!=null){
    const sea = [];
    for(let k=0;k<H;k++){
      const j = M.hourly.time.indexOf(X.h.time[X.i0+k]), wv = j<0 ? null : M.hourly.wave_height[j], g = at("wind_gusts_10m",k);
      const s = wv==null ? 0 : (wv>=2.5 || g>=65) ? 2 : (wv>=1.5 || g>=45) ? 1 : 0;
      sea.push({s, why: wv==null ? "sem dado de onda" : `onda ${r1(wv)} m · rajada ${r0(g)} km/h`, tag: wv>=2.5?"mar grosso":"vento no costado"});
    }
    rows.push({label:"Porto / embarcações", cells:sea});
  }

  /* ---- achados ---- */
  const rr = runs(ray, s=>s===2)[0];
  if(rr) F.push({lvl:3, head:`RAIOS ${rel(X.h.time[X.i0+rr[0]])}. Todo mundo no chão.`, t:"Descargas atmosféricas", d:`Convecção forte ${span(rr)}: CAPE até ${r0(max(win("cape",rr[0],rr[1]+1)))} J/kg, LI ${r1(min(win("lifted_index",rr[0],rr[1]+1)))}.`,
    o:"Regra 30/30: no primeiro trovão, todos para abrigo fechado ou veículo; retorno só 30 min após o último. Guindaste arriado, andaime e telhado evacuados."});
  else if(ray.some(c=>c.s===1)){ const k = ray.findIndex(c=>c.s===1); F.push({lvl:1, t:"Instabilidade", d:`Energia para trovoadas isoladas a partir de ${rel(X.h.time[X.i0+k])}.`, o:"Detector de raios ligado e líder de frente com autoridade para parar."}); }

  const w80 = win("wind_speed_80m",0,H), w80m = max(w80), gM = max(win("wind_gusts_10m",0,H)), gK = win("wind_gusts_10m",0,H).indexOf(gM);
  const cw = bestRun(crane, 3, undefined, true);
  if(crane.some(c=>c.s===2)) F.push({lvl:2, head: cw ? `Içamento só ${span(cw)}.` : "GUINDASTE ARRIADO nas próximas 48 h.", t:"Içamento restrito", d:`Vento a 80 m até ${r0(w80m)} km/h; rajada a 10 m até ${r0(gM)} km/h ${rel(X.h.time[X.i0+gK])}.`,
    o: cw ? `Programe as cargas de maior área vélica para ${span(cw)}. Fora disso, lança recolhida e cabo-guia em tudo.` : "Nenhuma janela de 3 h. Replaneje as cargas críticas."});
  else F.push({lvl:0, t:"Içamento", d:`Vento a 80 m no máximo ${r0(w80m)} km/h. ${cw?`Janela contínua ${span(cw)}.`:""}`});

  if(gM>=60) F.push({lvl: gM>=80?3:2, t:"Vento destrutivo no canteiro", d:`Rajadas de ${r0(gM)} km/h de ${dirName(at("wind_direction_10m",gK))} ${rel(X.h.time[X.i0+gK])}.`, o:"Amarre tapumes, telhas, lonas e chapas antes disso. Isole área sob fachadas e coberturas."});

  const hh = height.filter(c=>c.s===2).length;
  if(hh){
    const hw = bestRun(height, 4, undefined, true), now = height[0].s===2, lib = now ? until(height) : null, first = height.findIndex(c=>c.s===2);
    F.push({lvl:2,
      head: now ? `ALTURA PARADA AGORA — ${height[0].tag}.${lib?` Libera ${rel(lib)}.`:""}` : `Altura bloqueada a partir de ${rel(X.h.time[X.i0+first])}.`,
      t:"Trabalho em altura bloqueado", d:`${hrs(hh)} das próximas 48 h fora do limite (rajada ≥ 40 km/h, chuva ou raio)${now?`; agora: ${height[0].why}`:""}.`,
      o: hw ? `Desça todo mundo${now?" já":` antes de ${rel(X.h.time[X.i0+first])}`}. Frentes de altura só com luz do dia: ${span(hw)}.` : "Sem bloco diurno de 4 h seguro: só serviço em solo."});
  }

  const cr = bestRun(conc, 4, undefined, true);
  const Emax = max(conc.map(c=>c.E));
  if(cr) F.push({lvl:0, t:"Concretagem", d:`Janela ${span(cr)}: sem chuva nas 6 h seguintes e evaporação abaixo de 0,5 kg/m²/h.`, o:`Lance ${span(cr)}. Cura úmida desde o acabamento.`});
  else F.push({lvl:2, head:"NÃO CONCRETE em 48 h sem proteção.", t:"Sem janela de concretagem", d:`Bloqueio: ${topWhy(conc)[0]||"—"}. Evaporação máxima de ${r1(Emax)} kg/m²/h.`, o:"Se for inevitável: lona, quebra-vento, aspersão em névoa e agente de cura imediatamente após o sarrafeamento."});

  const hv = heat.map(c=>c.v), hvM = max(hv), hvK = hv.indexOf(hvM), hot = heat.filter(c=>c.s===2).length;
  const regime = v => v<=25 ? "contínuo" : v<26 ? "45 min trabalho / 15 descanso" : v<28 ? "30 / 30" : v<=30 ? "15 / 45" : "proibido sem medida de controle";
  if(hvM>25) F.push({lvl: hvM>30?3 : hvM>28?2 : 1, t:"Sobrecarga térmica", d:`IBUTG estimado de ${r1(hvM)}°C ${rel(X.h.time[X.i0+hvK])}${hot?`; ${hrs(hot)} acima de 28°C`:""}. Referência: tabela clássica da NR-15, Anexo 3, para trabalho pesado.`,
    o:`No pico: regime ${regime(hvM)}. Água fresca de 250 ml a cada 20 min, sombra no descanso, tarefa pesada antes das 10h. Meça com termômetro de globo no local: isto é estimativa.`});

  const past72 = sum(sl(X.h.precipitation, X.i0-72, X.i0)), next24 = sum(win("precipitation",0,24)), acc = past72+next24, p1 = max(win("precipitation",0,H)), p1K = win("precipitation",0,H).indexOf(p1);
  if(acc>=100) F.push({lvl:3, head:"ENCOSTA EM RISCO. Saia de área de deslizamento.", t:"Risco geo-hidrológico alto", d:`${r0(past72)} mm nas últimas 72 h + ${r0(next24)} mm previstos em 24 h = ${r0(acc)} mm. Solo saturado.`, o:"Evacue encostas e margens. Nada de escavação, talude ou vala aberta. Acompanhe a Defesa Civil (199)."});
  else if(acc>=60) F.push({lvl:2, t:"Solo saturando", d:`Acumulado de ${r0(acc)} mm (72 h passadas + 24 h futuras).`, o:"Escore taludes e valas. Vistorie drenagem de canteiro e acessos."});
  if(p1>=30) F.push({lvl:3, t:"Chuva de alagamento", d:`${r1(p1)} mm em uma hora ${rel(X.h.time[X.i0+p1K])}.`, o:"Retire máquinas e materiais de pontos baixos. Não atravesse via alagada."});
  else if(p1>=15) F.push({lvl:2, t:"Chuva forte pontual", d:`${r1(p1)} mm/h ${rel(X.h.time[X.i0+p1K])}.`, o:"Reduza velocidade da frota e dobre a distância de seguimento."});

  const fogK = win("visibility",0,H).findIndex(v=>v<1000);
  if(fogK>=0) F.push({lvl:2, t:"Neblina na estrada", d:`Visibilidade abaixo de 1 km ${rel(X.h.time[X.i0+fogK])}.`, o:"Atrase a saída da frota até a neblina dissipar. Farol baixo, nunca pisca-alerta em movimento."});

  if(M && M.hourly){ const wv = M.hourly.wave_height.filter(v=>v!=null), wM = max(wv);
    if(wM>=2.5) F.push({lvl:2, t:"Mar grosso", d:`Ondas de até ${r1(wM)} m no ponto de mar mais próximo.`, o:"Suspenda transbordo e operação de lancha. Reforce amarração."}); }

  return {
    id:"ops", nome:"VIGIA", cargo:"Meteorologista de operações e segurança",
    bio:"Obra, içamento, estrada e porto. Se o vento ou o raio podem ferir alguém, a resposta é parar — e eu digo até que horas.",
    extra:"", rows, F, ok:"Operação liberada. Sem restrição meteorológica."
  };
}

/* =============================================================================
   renderização comum
   ============================================================================= */
function renderExpert(key, R){
  const body = $(`x-${key}-body`); if(!body) return;
  const F = R.F.slice().sort((a,b)=>b.lvl-a.lvl);
  // o veredito vem do achado mais grave; sem nada grave, da melhor manchete disponível
  const lead = F[0];
  const verdict = lead.lvl>=2 ? (lead.head || `${lead.t.toUpperCase()}. ${lead.o||""}`) : (F.find(f=>f.head)?.head || R.ok);
  const risk = Math.min(100, Math.round(max(F.map(f=>f.lvl))*25 + F.filter(f=>f.lvl>=2).length*6 + F.filter(f=>f.lvl===1).length*2));
  const conf = confidence();
  const riskCol = risk>=70 ? "var(--danger)" : risk>=40 ? "var(--warn)" : "var(--dew)";
  const T = X.h.time.slice(X.i0, X.i0+H);
  (X.sum ||= {})[key] = {nome:R.nome, cargo:R.cargo, verdict, risk, riskCol, conf:conf.v, alerts:F.filter(f=>f.lvl>=2).length};

  const ticks = T.map((t,k)=>{ const hh=+t.slice(11,13); return hh%6 ? "" : `<span style="grid-column:${k+2}">${hh===0? DOW[parseLocal(t).getDay()] : hh+"h"}</span>`; }).join("");
  const tl = R.rows.map(r=>`<div class="tl-row"><div class="tl-l">${esc(r.label)}</div>${r.cells.map((c,k)=>`<i class="c${c.s}" title="${esc(rel(T[k]))}: ${esc(c.why)}${c.s&&c.tag?` — ${esc(c.tag)}`:""}"></i>`).join("")}</div>`).join("");

  const sym = ["✓","i","!","!!"];
  const finds = F.map(f=>`<div class="xf l${f.lvl}"><div class="dot">${sym[f.lvl]}</div><div><b>${esc(f.t)}</b><p>${esc(f.d)}</p>${f.o?`<p class="ord">${esc(f.o)}</p>`:""}</div></div>`).join("");
  const orders = F.filter(f=>f.o && f.lvl>=1);

  body.innerHTML = `
    <div class="xhead glass">
      <div class="xid">
        <div class="ava ava-${key}" aria-hidden="true">${key==="agro"
          ? `<svg viewBox="0 0 32 32"><path d="M16 29V11M16 15c-4 0-6-3-6-6 4 0 6 3 6 6zm0 0c4 0 6-3 6-6-4 0-6 3-6 6zm0 6c-4 0-6-3-6-6 4 0 6 3 6 6zm0 0c4 0 6-3 6-6-4 0-6 3-6 6zm0-10c-2-2-2-5 0-8 2 3 2 6 0 8z"/></svg>`
          : `<svg viewBox="0 0 32 32"><path d="M16 3 5 7v8c0 7 5 12 11 14 6-2 11-7 11-14V7z"/><path d="M11 16l3.5 3.5L21 13"/></svg>`}</div>
        <div><h2>${R.nome}</h2><div class="cargo">${esc(R.cargo)}</div><p class="bio">${esc(R.bio)}</p></div>
        ${R.extra}
      </div>
      <div class="verdict">
        <div class="vtxt"><small>Veredito · ${esc(C.S.loc.name)} · ${fmtH(C.S.fc.current.time)}</small><strong>${esc(verdict)}</strong></div>
        <div class="gauges">
          ${gauge(risk, riskCol, "risco")}
          ${gauge(conf.v, "var(--accent)", "confiança", conf.txt)}
        </div>
      </div>
      <div class="xact"><button class="xbtn" data-copy="${key}">Copiar briefing</button><span class="xsig">— ${R.nome}, leitura de ${fmtH(C.S.fc.current.time)}</span></div>
    </div>

    <div class="sh"><h2>Linha do tempo · 48 h</h2><p><i class="lg c0"></i>liberado <i class="lg c1"></i>atenção <i class="lg c2"></i>parado — passe o cursor (ou toque) em cada hora para ver o motivo.</p></div>
    <div class="tl glass"><div class="tl-in"><div class="tl-row tl-h"><div class="tl-l"></div>${ticks}</div>${tl}</div><div class="tl-tip" aria-live="polite">Toque numa hora para ver o motivo.</div></div>

    <div class="xgrid">
      <div><div class="sh"><h2>Diagnóstico</h2></div><div class="xfs">${finds}</div></div>
      <div><div class="sh"><h2>Ordens</h2></div><ol class="orders glass">${orders.length ? orders.map(f=>`<li><b>${esc(f.t)}.</b> ${esc(f.o)}</li>`).join("") : `<li>${esc(R.ok)}</li>`}</ol></div>
    </div>`;

  body.querySelector("[data-copy]").onclick = e => {
    const txt = `${R.nome} · ${R.cargo}\n${C.S.loc.name} — ${C.S.fc.current.time.replace("T"," ")}\n\nVEREDITO: ${verdict}\nRisco ${risk}/100 · confiança ${conf.v??"—"}%\n\n` +
      F.filter(f=>f.lvl>=1).map(f=>`• ${f.t}: ${f.d}${f.o?`\n  → ${f.o}`:""}`).join("\n") + `\n\nclima.gplansis.com`;
    const done = () => { e.target.textContent = "Copiado ✓"; setTimeout(()=>e.target.textContent="Copiar briefing", 1800); };
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(done).catch(()=>{ window.ClimaToast?.("Não foi possível copiar automaticamente — selecione o texto do briefing e copie."); });
  };
  // toque/clique numa hora: mostra o motivo (no celular não existe tooltip)
  const tip = body.querySelector(".tl-tip");
  body.querySelector(".tl").onclick = e => { const c = e.target.closest(".tl-row i"); if(!c) return;
    body.querySelectorAll(".tl-row i.sel").forEach(x=>x.classList.remove("sel")); c.classList.add("sel");
    tip.textContent = `${c.parentElement.querySelector(".tl-l").textContent} · ${c.title}`; };
  const sel = body.querySelector("#ceresCrop");
  if(sel) sel.onchange = () => { store.set("ceres-crop", sel.value); refresh(); };
}
function gauge(v, col, label, sub=""){
  const R = 26, L = 2*Math.PI*R, p = v==null ? 0 : v/100;
  return `<div class="gauge" title="${esc(sub)}"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="${R}" class="gtr"/><circle cx="32" cy="32" r="${R}" class="gv" style="stroke:${col};stroke-dasharray:${L*p} ${L}"/></svg><b>${v==null?"—":v}</b><small>${label}</small></div>`;
}

/* ---------- navegação entre painel e módulos ---------- */
const VIEWS = {"#home":"home", "#sat":"sat", "#agro":"agro", "#ops":"ops", "#lab":"lab", "#pred":"pred", "#mar":"mar", "#vento":"vento", "#viagem":"viagem"};
function route(){
  const v = VIEWS[location.hash] || (location.hash.length>1 ? "painel" : "home");
  document.body.dataset.view = v;
  // Minha tela no desktop = mapa interativo com colunas de widgets; "Mapa" = mesmo mapa sem a coluna de widgets
  const desk = matchMedia("(min-width: 861px)").matches;
  document.body.classList.toggle("mapview", v==="sat" || (v==="home" && desk));
  document.body.classList.toggle("widgets-off", v==="sat");
  document.querySelectorAll(".nav a").forEach(a=>{ if(VIEWS[a.getAttribute("href")]) a.classList.toggle("on", VIEWS[a.getAttribute("href")]===v); else if(v!=="painel") a.classList.remove("on"); });
  if(v!=="painel") window.scrollTo({top:0, behavior:"instant"});
  else if(location.hash){ const el = document.querySelector(location.hash); if(el) requestAnimationFrame(()=>el.scrollIntoView()); }
}
addEventListener("hashchange", route);
matchMedia("(min-width: 861px)").addEventListener("change", ()=>{ route(); window.dispatchEvent(new Event("hashchange")); });
route();

// estado de cada linha dos especialistas numa hora (usado pelo modal da hora)
function statusAt(iso){
  if(!X.h || !X.last) return [];
  const k = X.h.time.indexOf(iso) - X.i0;
  if(k<0 || k>=H) return [];
  return [["CERES",X.last.agro],["VIGIA",X.last.ops]].flatMap(([n,R])=>R.rows.map(r=>({n, label:r.label, ...r.cells[k]})));
}
window.Experts = {load, refresh, statusAt, summary: k => X.sum?.[k]};
})();
