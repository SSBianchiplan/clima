/* =============================================================================
   PREDITIVO — alarmes dos próximos 7 dias.
   Cruza a previsão determinística (Open-Meteo), 51 cenários do ensemble ECMWF
   (temperatura, chuva, rajada, pressão) e a circulação em 850 hPa para detectar
   sistemas (frente fria, corredor de umidade) e episódios (chuva, vento, tempestade,
   calor/frio/geada, nevoeiro, encosta). Cada alarme traz nível, janela, confiança
   medida no ensemble e ação. Pode avisar no aparelho.
   ============================================================================= */
(() => {
"use strict";
const C = window.ClimaCore;
const {$, esc, icon, wmo, r0, r1, fmtH, DOW, parseLocal, sum, max, min, mean, mk, FONT, css, dirName} = C;
const D = {loc:null, key:null, ens:null, lv:null, busy:false, res:null};
const store = {
  get(k,d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const urlEns = l => `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${l.lat}&longitude=${l.lon}&hourly=temperature_2m,precipitation,wind_gusts_10m,pressure_msl&models=ecmwf_ifs025&forecast_days=8&timezone=auto`;
const urlLv = l => `https://api.open-meteo.com/v1/forecast?latitude=${l.lat}&longitude=${l.lon}&hourly=wind_speed_850hPa,wind_direction_850hPa,relative_humidity_850hPa,temperature_850hPa&forecast_days=8&timezone=auto`;
const active = () => document.body.dataset.view === "pred";
const LVL = ["", "Atenção", "Alerta", "Perigo"];
const LCOL = ["var(--dew)", "#E8C21C", "#F28A1E", "#E0332A"];

/* ---------- carga ---------- */
function setLoc(loc){ D.loc = loc; D.key = null; D.res = null; if(active()) ensure(); else refreshWidget(); }
async function ensure(force){
  if(!D.loc || !C.S.fc) return;
  const key = `${D.loc.lat},${D.loc.lon}`;
  if(!force && D.key === key && D.res){ render(); return; }
  if(D.busy === key) return;
  D.busy = key;
  const body = $("pred-body"); if(body && active()) body.innerHTML = `<div class="xload">Rodando a análise preditiva de 7 dias para ${esc(D.loc.name)} — 51 cenários e a circulação em 850 hPa…</div>`;
  const [e, v] = await Promise.allSettled([C.getJSON(urlEns(D.loc)), C.getJSON(urlLv(D.loc))]);
  if(D.busy !== key) return;
  D.busy = false; D.key = key;
  D.ens = e.status==="fulfilled" ? e.value.hourly : null;
  D.lv  = v.status==="fulfilled" ? v.value.hourly : null;
  D.res = analyze();
  notify(D.res);
  if(active()) render();
  refreshWidget();
}
addEventListener("hashchange", ()=>{ if(active()) ensure(); });

/* ---------- utilidades ---------- */
const angDiff = (a,b) => ((b-a+540)%360)-180;
const inSector = (d, a, b) => a <= b ? d>=a && d<=b : d>=a || d<=b;   // setor angular (pode cruzar 0°)
const fmtW = (t0, t1) => { const a = parseLocal(t0), b = parseLocal(t1), dA = `${DOW[a.getDay()]} ${fmtH(t0)}`;
  return a.toDateString()===b.toDateString() ? `${dA}–${fmtH(t1)}` : `${dA} → ${DOW[b.getDay()]} ${fmtH(t1)}`; };
function episodes(n, test, gap=2, minLen=1){
  const out = []; let st = -1, last = -1;
  for(let k=0;k<n;k++){ if(test(k)){ if(st<0) st = k; last = k; } else if(st>=0 && k-last > gap){ if(last-st+1 >= minLen) out.push([st,last]); st = -1; } }
  if(st>=0 && last-st+1 >= minLen) out.push([st,last]);
  return out;
}

/* ---------- análise ---------- */
function analyze(){
  const h = C.S.fc.hourly, i0 = C.nowIndex(), N = Math.min(168, h.time.length - i0);
  const T = k => h.time[i0+k], at = (a,k) => h[a][i0+k];
  const E = D.ens, L = D.lv;
  const eIdx = E ? new Map(E.time.map((t,i)=>[t,i])) : null, lIdx = L ? new Map(L.time.map((t,i)=>[t,i])) : null;
  const memb = v => E ? Object.keys(E).filter(k=>k.startsWith(v+"_member") || k===v) : [];
  const ePrec = memb("precipitation"), eGust = memb("wind_gusts_10m"), ePres = memb("pressure_msl"), eTemp = memb("temperature_2m");
  const eAt = (key, k) => { const j = eIdx?.get(T(k)); return j==null ? null : E[key][j]; };
  const lAt = (key, k) => { const j = lIdx?.get(T(k)); return j==null ? null : L[key][j]; };
  // fração de cenários em que f(membro) é verdade
  const prob = (keys, f) => keys.length ? keys.filter(f).length/keys.length*100 : null;
  const winSum = (key, a, b) => { let s = 0; for(let k=a;k<=b;k++) s += eAt(key,k) || 0; return s; };
  const winMax = (key, a, b) => { let m = -1e9; for(let k=a;k<=b;k++) m = Math.max(m, eAt(key,k) ?? -1e9); return m; };
  const A = [];
  const push = (o) => A.push({...o, start:T(o.a), end:T(o.b)});

  // 1) chuva: episódios na determinística; confiança = cenários que passam do limiar na mesma janela (±3 h)
  episodes(N, k=>at("precipitation",k) >= .3, 3).forEach(([a,b])=>{
    let tot = 0, pk = 0, pkK = a; for(let k=a;k<=b;k++){ const p = at("precipitation",k); tot += p; if(p>pk){ pk = p; pkK = k; } }
    if(tot < 5 && pk < 5) return;
    const lvl = tot>=50 || pk>=20 ? 3 : tot>=25 || pk>=10 ? 2 : 1, thr = lvl===3 ? 50 : lvl===2 ? 25 : 5;
    const aa = Math.max(0,a-3), bb = Math.min(N-1,b+3);
    const conf = prob(ePrec, key=>winSum(key, aa, bb) >= thr*.7);
    const sums = ePrec.map(key=>winSum(key, aa, bb)).sort((x,y)=>x-y), q = p => sums.length ? sums[Math.floor((sums.length-1)*p)] : null;
    push({type:"chuva", lane:"Chuva", lvl, a, b, conf, title: lvl===3 ? "Chuva forte / acumulado alto" : lvl===2 ? "Chuva moderada a forte" : "Chuva",
      desc:`${r0(tot)} mm em ${b-a+1} h, pico de ${r1(pk)} mm/h às ${fmtH(T(pkK))}.${sums.length?` Cenários: ${r0(q(.1))}–${r0(q(.9))} mm (P10–P90).`:""}`,
      act: lvl===3 ? "Limpe calhas e bueiros antes; evite áreas de alagamento e encostas; reprograme obras e serviços externos." : lvl===2 ? "Planeje deslocamentos fora do pico; proteja materiais e cargas." : "Leve guarda-chuva; pista molhada."});
  });

  // 2) vento: episódios de rajada; confiança = cenários com rajada ≥ limiar na janela
  episodes(N, k=>at("wind_gusts_10m",k) >= 50, 2).forEach(([a,b])=>{
    let g = 0, gk = a; for(let k=a;k<=b;k++){ const v = at("wind_gusts_10m",k); if(v>g){ g = v; gk = k; } }
    const lvl = g>=80 ? 3 : g>=65 ? 2 : 1, thr = lvl===3 ? 80 : lvl===2 ? 65 : 50;
    const conf = prob(eGust, key=>winMax(key, Math.max(0,a-3), Math.min(N-1,b+3)) >= thr);
    push({type:"vento", lane:"Vento", lvl, a, b, conf, title: lvl===3 ? "Vendaval" : lvl===2 ? "Rajadas fortes" : "Rajadas",
      desc:`Rajada de até ${r0(g)} km/h de ${dirName(at("wind_direction_10m",gk))} às ${fmtH(T(gk))} (${DOW[parseLocal(T(gk)).getDay()]}).`,
      act: lvl>=2 ? "Recolha toldos e objetos soltos, suspenda içamento e trabalho em altura, cuidado com árvores e fiação." : "Atenção a objetos soltos e embarcações pequenas."});
  });

  // 3) frente fria: vento gira de N–NO para S–SE, pressão faz mínimo e sobe, temperatura cai
  for(let k=12;k<N-12;k++){
    const before = [], after = [];
    for(let j=k-12;j<k;j++) before.push(at("wind_direction_10m",j));
    for(let j=k;j<k+12;j++) after.push(at("wind_direction_10m",j));
    const vec = arr => { let x=0,y=0; arr.forEach(d=>{ x+=Math.sin(d*Math.PI/180); y+=Math.cos(d*Math.PI/180); }); return (Math.atan2(x,y)*180/Math.PI+360)%360; };
    const db = vec(before), da = vec(after);
    if(!(inSector(db, 290, 45) && inSector(da, 120, 230))) continue;
    const p = h.pressure_msl.slice(i0+k-12, i0+k+13), pmin = min(p), pminK = k-12+p.indexOf(pmin), rise = max(h.pressure_msl.slice(i0+pminK, i0+pminK+13)) - pmin;
    const t = h.temperature_2m.slice(i0+k-6, i0+k+25), drop = max(t.slice(0,8)) - min(t.slice(8));
    const score = (rise>=3) + (drop>=3) + (rise>=5) + (drop>=5);
    if(score < 2) continue;
    // confiança: cenários com mínimo de pressão perto (±6 h) e subida ≥ 3 hPa nas 12 h seguintes
    const conf = prob(ePres, key=>{ let mn = 1e9, mk2 = 0; for(let j=pminK-6;j<=pminK+6;j++){ const v = eAt(key,j); if(v!=null && v<mn){ mn = v; mk2 = j; } }
      let mx = -1e9; for(let j=mk2;j<=mk2+12;j++){ const v = eAt(key,j); if(v!=null) mx = Math.max(mx,v); } return mx-mn >= 3; });
    const rain = sum(h.precipitation.slice(i0+k-6, i0+k+12)), gust = max(h.wind_gusts_10m.slice(i0+k-3, i0+k+12));
    const lvl = gust>=65 || rain>=25 ? 3 : 2;
    push({type:"frente", lane:"Frente fria", lvl, a:Math.max(0,k-3), b:Math.min(N-1,k+6), conf, peak:T(k), title:"Passagem de frente fria",
      desc:`Vento gira de ${dirName(db)} para ${dirName(da)} por volta de ${DOW[parseLocal(T(k)).getDay()]} ${fmtH(T(k))}; pressão sobe ${r1(rise)} hPa em 12 h após mínimo de ${r0(pmin)} hPa e a temperatura cai ${r1(drop)}°C. Chuva associada ${r0(rain)} mm, rajadas até ${r0(gust)} km/h.`,
      act:"Antecipe atividades externas para antes da passagem; depois dela, ar mais frio e seco, vento sul no litoral (atenção ao mar)."});
    k += 24;   // uma frente por janela
  }

  // 4) corredor de umidade (jato de baixos níveis em 850 hPa vindo do norte/noroeste, úmido)
  if(L){
    episodes(N, k=>{ const ws = lAt("wind_speed_850hPa",k), wd = lAt("wind_direction_850hPa",k), rh = lAt("relative_humidity_850hPa",k);
      return ws!=null && ws>=35 && inSector(wd, 290, 40) && rh>=80; }, 2, 6).forEach(([a,b])=>{
      const ws = max(Array.from({length:b-a+1},(_,j)=>lAt("wind_speed_850hPa",a+j))), rainNext = sum(h.precipitation.slice(i0+a, i0+Math.min(N,b+24)));
      push({type:"umidade", lane:"Umidade 850 hPa", lvl: rainNext>=20 ? 2 : 1, a, b, conf:null, title:"Corredor de umidade (jato de baixos níveis)",
        desc:`Vento em 850 hPa (~1,5 km) de norte/noroeste a até ${r0(ws)} km/h com umidade acima de 80%: transporte de umidade da Amazônia alimentando chuva (${r0(rainNext)} mm previstos até 24 h depois).`,
        act:"Ambiente favorável a chuva persistente e trovoadas noturnas; acompanhe os alarmes de chuva."});
    });
  }

  // 5) tempestade (instabilidade convectiva)
  episodes(N, k=>at("cape",k)>=1000 && at("lifted_index",k)<=-2 && at("precipitation_probability",k)>=30, 2).forEach(([a,b])=>{
    let cape = 0, li = 9; for(let k=a;k<=b;k++){ cape = Math.max(cape, at("cape",k)); li = Math.min(li, at("lifted_index",k)); }
    const lvl = cape>=2000 && li<=-4 ? 3 : 2;
    push({type:"tempestade", lane:"Tempestade", lvl, a, b, conf:null, title: lvl===3 ? "Tempestades severas possíveis" : "Trovoadas",
      desc:`CAPE até ${r0(cape)} J/kg, índice de levantamento ${r1(li)}: energia para trovoadas${lvl===3?" com granizo e rajadas":""}.`,
      act:"Regra 30/30 para raios; evite campo aberto e água; desligue equipamentos sensíveis."});
  });

  // 6) térmico: calor, frio e geada
  episodes(N, k=>at("apparent_temperature",k) >= 35, 2).forEach(([a,b])=>{ const v = max(h.apparent_temperature.slice(i0+a,i0+b+1));
    const tair = max(h.temperature_2m.slice(i0+a,i0+b+1));   // confiança compara ar com ar (sensação é sempre maior)
    push({type:"calor", lane:"Térmico", lvl: v>=40 ? 3 : 2, a, b, conf: prob(eTemp, key=>winMax(key,a,b) >= tair - 1.5), title: v>=40 ? "Calor extremo" : "Calor intenso",
      desc:`Sensação térmica até ${r0(v)}°C.`, act:"Hidratação, sombra, trabalho pesado só cedo; atenção a idosos, crianças e animais."}); });
  episodes(N, k=>at("temperature_2m",k) <= 3 && at("wind_speed_10m",k) < 10, 2).forEach(([a,b])=>{ const v = min(h.temperature_2m.slice(i0+a,i0+b+1));
    push({type:"geada", lane:"Térmico", lvl: v<=0 ? 3 : 2, a, b, conf: prob(eTemp, key=>{ let m = 99; for(let k=a;k<=b;k++) m = Math.min(m, eAt(key,k) ?? 99); return m <= 4; }),
      title: v<=0 ? "Geada forte" : "Geada", desc:`Mínima de ${r1(v)}°C com vento fraco.`, act:"Proteja lavouras e mudas, recolha animais jovens, cuidado com pistas na serra."}); });
  episodes(N, k=>at("apparent_temperature",k) <= 5, 2, 3).forEach(([a,b])=>{ const v = min(h.apparent_temperature.slice(i0+a,i0+b+1));
    push({type:"frio", lane:"Térmico", lvl: v<=2 ? 2 : 1, a, b, conf:null, title:"Frio intenso", desc:`Sensação térmica mínima de ${r0(v)}°C.`, act:"Agasalho em camadas; atenção a pessoas em situação de rua."}); });

  // 7) nevoeiro
  episodes(N, k=>at("visibility",k) < 1000, 1, 2).forEach(([a,b])=>{ const v = min(h.visibility.slice(i0+a,i0+b+1));
    push({type:"nevoeiro", lane:"Nevoeiro", lvl: v<500 && b-a>=3 ? 2 : 1, a, b, conf:null, title:"Nevoeiro", desc:`Visibilidade mínima de ${v<1000?r0(v)+" m":r1(v/1000)+" km"}.`,
      act:"Atrasar saída de frota; farol baixo; atenção em aeroportos e rodovias de serra."}); });

  // 8) encosta/alagamento: chuva acumulada em 72 h (passado + previsão)
  episodes(N, k=>sum(h.precipitation.slice(Math.max(0,i0+k-72), i0+k+1)) >= 60, 3).forEach(([a,b])=>{
    const v = max(Array.from({length:b-a+1},(_,j)=>sum(h.precipitation.slice(Math.max(0,i0+a+j-72), i0+a+j+1))));
    push({type:"solo", lane:"Encosta/solo", lvl: v>=100 ? 3 : 2, a, b, conf:null, title: v>=100 ? "Risco alto de deslizamento" : "Solo encharcado",
      desc:`${r0(v)} mm acumulados em 72 h.`, act:"Evite encostas e margens; observe trincas, inclinação de postes e água barrenta — Defesa Civil 199."});
  });

  // 9) mar (3 dias de dados)
  const M = C.S.mar;
  if(M && M.hourly){ const mi = new Map(M.hourly.time.map((t,i)=>[t,i]));
    episodes(N, k=>{ const j = mi.get(T(k)); return j!=null && M.hourly.wave_height[j] >= 2.5; }, 2).forEach(([a,b])=>{
      const v = max(Array.from({length:b-a+1},(_,j)=>M.hourly.wave_height[mi.get(T(a+j))] ?? 0));
      push({type:"mar", lane:"Mar", lvl: v>=3.5 ? 3 : 2, a, b, conf:null, title:"Mar agitado / ressaca", desc:`Ondas de até ${r1(v)} m.`, act:"Evite banho de mar e pesca embarcada; atenção na orla."}); }); }

  const PRI = {frente:0, chuva:1, solo:2, vento:3, tempestade:4, mar:5, calor:6, geada:7, frio:8, umidade:9, nevoeiro:10};
  A.sort((x,y)=>y.lvl-x.lvl || PRI[x.type]-PRI[y.type] || x.a-y.a);

  // índice de risco por dia e confiança geral
  const days = [];
  for(let d=0; d<7; d++){
    const a = d*24 - (+T(0).slice(11,13)), ks = []; for(let k=Math.max(0,a); k<Math.min(N, a+24); k++) ks.push(k);
    if(!ks.length) continue;
    const date = T(ks[0]).slice(0,10), al = A.filter(x=>x.a <= ks[ks.length-1] && x.b >= ks[0]);
    const rain = sum(ks.map(k=>at("precipitation",k))), tmax = max(ks.map(k=>at("temperature_2m",k))), tmin = min(ks.map(k=>at("temperature_2m",k))), gust = max(ks.map(k=>at("wind_gusts_10m",k)));
    const p10 = prob(ePrec, key=>ks.reduce((s,k)=>s+(eAt(key,k)||0),0) >= 10);
    const risk = Math.min(100, (max(al.map(x=>x.lvl).concat(0)))*25 + al.length*6);
    const code = h.weather_code[i0+ks[Math.floor(ks.length/2)]];
    days.push({date, rain, tmax, tmin, gust, p10, risk, al, code});
  }
  const spread = E ? (()=>{ let out = []; for(let d=0; d<7; d++){ const vals = eTemp.map(key=>{ let m = -99; for(let k=d*24;k<d*24+24 && k<N;k++) m = Math.max(m, eAt(key,k) ?? -99); return m; }).filter(v=>v>-99);
    const m = mean(vals), s = Math.sqrt(mean(vals.map(v=>(v-m)**2))); out.push(s); } return out; })() : null;
  return {A, days, N, i0, spread, ePrecKeys:ePrec};
}

/* ---------- narrativa ---------- */
function narrative(R){
  const h = C.S.fc.hourly, i0 = R.i0, N = R.N, out = [];
  const rain7 = sum(h.precipitation.slice(i0, i0+N)), g = max(h.wind_gusts_10m.slice(i0, i0+N)), gk = h.wind_gusts_10m.slice(i0,i0+N).indexOf(g);
  const tmax = max(h.temperature_2m.slice(i0,i0+N)), tmin = min(h.temperature_2m.slice(i0,i0+N)), wet = R.days.filter(d=>d.rain>=1).length;
  out.push(`<b>Panorama.</b> ${r0(rain7)} mm previstos em 7 dias, chuva em ${wet} de ${R.days.length} dias; temperaturas entre ${r0(tmin)} e ${r0(tmax)}°C; rajada máxima de ${r0(g)} km/h ${DOW[parseLocal(h.time[i0+gk]).getDay()]} ${fmtH(h.time[i0+gk])}.`);
  const fr = R.A.filter(a=>a.type==="frente");
  out.push(fr.length ? `<b>Sistemas.</b> ${fr.map(f=>`${f.desc} Confiança ${f.conf==null?"—":r0(f.conf)+"%"} entre os cenários.`).join(" ")}` : `<b>Sistemas.</b> Nenhuma passagem clara de frente fria na semana: padrão dominado por ${(()=>{ const ds = h.wind_direction_10m.slice(i0,i0+N); let x=0,y=0; ds.forEach(d=>{x+=Math.sin(d*Math.PI/180);y+=Math.cos(d*Math.PI/180);}); return "vento de "+dirName((Math.atan2(x,y)*180/Math.PI+360)%360); })()}.`);
  const um = R.A.filter(a=>a.type==="umidade");
  if(um.length) out.push(`<b>Movimentação da umidade.</b> ${um.length} ${um.length>1?"janelas":"janela"} de corredor de umidade em 850 hPa (${um.map(u=>fmtW(u.start,u.end)).join("; ")}): é o transporte que costuma sustentar as chuvas mais volumosas.`);
  if(R.spread){ const lim = R.spread.findIndex(s=>s>2.5); out.push(`<b>Confiança.</b> ${lim<0 ? "Os 51 cenários concordam na semana inteira (dispersão da máxima < 2,5°C): previsão firme." : lim===0 ? "Cenários já divergem hoje: trate os números como tendência." : `Alta até ${DOW[parseLocal(R.days[lim-1].date+"T12:00").getDay()]}; depois a dispersão passa de ±2,5°C e os horários dos eventos podem deslizar.`}`); }
  const worst = R.days.reduce((a,b)=>b.risk>a.risk?b:a, R.days[0]);
  if(worst && worst.risk>=50) out.push(`<b>Dia crítico.</b> ${DOW[parseLocal(worst.date+"T12:00").getDay()]} ${worst.date.slice(8)}/${worst.date.slice(5,7)}: ${worst.al.map(a=>a.title.toLowerCase()).join(", ")}.`);
  return out;
}

/* ---------- renderização ---------- */
function render(){
  const body = $("pred-body"); if(!body || !active()) return;
  if(!D.res){ ensure(); return; }
  const R = D.res, h = C.S.fc.hourly;
  const t0 = Date.parse(h.time[R.i0]), span = R.N;
  const lanes = ["Frente fria","Umidade 850 hPa","Chuva","Vento","Tempestade","Térmico","Nevoeiro","Encosta/solo","Mar"].filter(l=>R.A.some(a=>a.lane===l));
  const dayTicks = R.days.map((d,i)=>{ const k = Math.max(0, i*24 - (+h.time[R.i0].slice(11,13))); return `<span style="left:${k/span*100}%">${DOW[parseLocal(d.date+"T12:00").getDay()]} ${d.date.slice(8)}</span>`; }).join("");
  const counts = [3,2,1].map(l=>R.A.filter(a=>a.lvl===l).length);
  const top = R.A[0];
  const perm = typeof Notification !== "undefined" ? Notification.permission : "unsupported";
  body.innerHTML = `
    <div class="xhead glass">
      <div class="xid"><div class="ava ava-pred" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M16 4 3 27h26z"/><path d="M16 13v6M16 23v.5"/></svg></div>
        <div><h2>PREDITIVO</h2><div class="cargo">Alarmes dos próximos 7 dias · ${esc(D.loc.name)}</div><p class="bio">Previsão determinística + 51 cenários do ECMWF + circulação em 850 hPa. Cada alarme diz quando, quanto e com que confiança.</p></div>
        <div class="pr-act"><button class="mbtn" id="prNotif"${perm==="unsupported"?" disabled":""}>${perm==="granted" ? "🔔 Avisos ativos" : "🔔 Avisar neste aparelho"}</button><button class="mbtn" id="prReload">↻ Recalcular</button></div></div>
      <div class="verdict"><div class="vtxt"><small>Alarme principal</small><strong>${top ? `${LVL[top.lvl]}: ${esc(top.title)} · ${fmtW(top.start, top.end)}` : "Semana sem alarmes relevantes."}</strong></div>
        <div class="pr-cnt">${counts.map((n,j)=>`<div style="--c:${LCOL[3-j]}"><b>${n}</b><small>${LVL[3-j]}</small></div>`).join("")}</div></div>
    </div>

    <div class="pr-days">${R.days.map(d=>{ const lv = max(d.al.map(a=>a.lvl).concat(0)); return `<div class="pr-day glass" style="--c:${LCOL[lv]}">
      <div class="pr-dh"><b>${DOW[parseLocal(d.date+"T12:00").getDay()]}</b><small>${d.date.slice(8)}/${d.date.slice(5,7)}</small></div>
      ${icon(wmo(d.code)[1], 34)}<div class="pr-t"><span>${r0(d.tmin)}°</span><b>${r0(d.tmax)}°</b></div>
      <div class="pr-m">☔ ${r0(d.rain)} mm${d.p10!=null?` · ${r0(d.p10)}% ≥10`:""}</div><div class="pr-m">💨 ${r0(d.gust)} km/h</div>
      <div class="pr-risk"><i style="width:${d.risk}%"></i></div>
      <div class="pr-chips">${d.al.slice(0,3).map(a=>`<span style="--c:${LCOL[a.lvl]}">${esc(a.lane)}</span>`).join("")}</div></div>`; }).join("")}</div>

    <div class="sh"><h2>Linha do tempo dos alarmes</h2><p>Cada barra é um alarme na sua janela de tempo; a cor é o nível. Passe o cursor para o detalhe.</p></div>
    <div class="pr-gantt glass"><div class="pr-ticks">${dayTicks}</div>
      ${lanes.map(l=>`<div class="pr-lane"><div class="pr-ln">${l}</div><div class="pr-track">${R.A.filter(a=>a.lane===l).map(a=>`<i style="left:${a.a/span*100}%;width:${Math.max(.8,(a.b-a.a+1)/span*100)}%;background:${LCOL[a.lvl]}" title="${esc(a.title)} · ${fmtW(a.start,a.end)} · ${esc(a.desc)}"></i>`).join("")}</div></div>`).join("") || `<div class="xload">Nenhum alarme nos próximos 7 dias.</div>`}</div>

    <div class="xgrid">
      <div><div class="sh"><h2>Alarmes</h2></div><div class="xfs">${R.A.length ? R.A.map(a=>`<div class="xf pr-al" style="--c:${LCOL[a.lvl]}"><div class="dot" style="background:${LCOL[a.lvl]}">${a.lvl===3?"!!":a.lvl===2?"!":"i"}</div><div>
        <b>${LVL[a.lvl]} · ${esc(a.title)}</b><p class="pr-w">🕑 ${fmtW(a.start, a.end)}${a.conf!=null?` · confiança <b>${r0(a.conf)}%</b> (${R.ePrecKeys.length} cenários)`:""}</p><p>${esc(a.desc)}</p><p class="ord">${esc(a.act)}</p></div></div>`).join("") : `<div class="xf"><div class="dot" style="background:var(--dew)">✓</div><div><b>Sem alarmes</b><p>Nenhuma condição adversa detectada nos próximos 7 dias.</p></div></div>`}</div></div>
      <div><div class="sh"><h2>Análise completa</h2></div><div class="card glass pr-nar">${narrative(R).map(p=>`<p>${p}</p>`).join("")}</div>
        <div class="sh"><h2>Movimentação: pressão, vento e chuva</h2></div><div class="card glass"><div class="cv" style="height:250px"><canvas id="prChart"></canvas></div><div class="pr-arrows" id="prArrows"></div></div></div>
    </div>`;

  drawChart(R);
  $("prReload").onclick = ()=>ensure(true);
  const nb = $("prNotif"); if(nb) nb.onclick = async ()=>{ if(Notification.permission !== "granted") await Notification.requestPermission(); store.set("pred-notify", Notification.permission==="granted"); render(); notify(R, true); };
}

function drawChart(R){
  const h = C.S.fc.hourly, i0 = R.i0, N = R.N, L = h.time.slice(i0, i0+N);
  const E = D.ens, eIdx = E ? new Map(E.time.map((t,i)=>[t,i])) : null;
  const pk = E ? Object.keys(E).filter(k=>k.startsWith("pressure_msl")) : [];
  const band = (q) => L.map(t=>{ const j = eIdx?.get(t); if(j==null) return null; const v = pk.map(k=>E[k][j]).filter(x=>x!=null).sort((a,b)=>a-b); return v.length ? v[Math.floor((v.length-1)*q)] : null; });
  const fronts = R.A.filter(a=>a.type==="frente").map(a=>L.indexOf(a.peak)).filter(i=>i>=0);
  const ink3 = css("--ink-3"), grid = css("--grid");
  const frontLine = {id:"fr", afterDatasetsDraw(ch){ const c = ch.ctx, {top,bottom} = ch.chartArea; fronts.forEach(i=>{ const x = ch.scales.x.getPixelForValue(i);
    c.save(); c.strokeStyle = "#4FA3FF"; c.lineWidth = 2; c.setLineDash([5,4]); c.beginPath(); c.moveTo(x,top); c.lineTo(x,bottom); c.stroke();
    c.fillStyle = "#4FA3FF"; c.font = `600 11px ${FONT}`; c.fillText("▼ frente fria", x+4, top+12); c.restore(); }); }};
  mk("prChart", {type:"bar", data:{labels:L, datasets:[
      {type:"line", label:"P90", data:band(.9), borderWidth:0, pointRadius:0, fill:"+1", backgroundColor:"rgba(160,140,255,.18)", yAxisID:"y"},
      {type:"line", label:"P10", data:band(.1), borderWidth:0, pointRadius:0, yAxisID:"y"},
      {type:"line", label:"pressão (hPa)", data:L.map((_,k)=>h.pressure_msl[i0+k]), borderColor:"#A98CFF", borderWidth:2, pointRadius:0, tension:.3, yAxisID:"y"},
      {type:"bar", label:"chuva (mm/h)", data:L.map((_,k)=>h.precipitation[i0+k]), backgroundColor:css("--rain"), yAxisID:"y2", barPercentage:1, categoryPercentage:1},
      {type:"line", label:"rajada (km/h)", data:L.map((_,k)=>h.wind_gusts_10m[i0+k]), borderColor:css("--danger"), borderDash:[4,3], borderWidth:1.4, pointRadius:0, tension:.3, yAxisID:"y3"}]},
    options:{responsive:true, maintainAspectRatio:false, animation:false, interaction:{mode:"index", intersect:false},
      plugins:{legend:{display:true, position:"bottom", labels:{color:css("--ink-2"), usePointStyle:true, boxWidth:7, boxHeight:7, font:{family:FONT,size:11}, filter:it=>!/^P\d/.test(it.text)}},
        tooltip:{filter:it=>!/^P\d/.test(it.dataset.label), callbacks:{title:it=>{ const t = L[it[0].dataIndex]; return `${DOW[parseLocal(t).getDay()]} ${fmtH(t)}`; }}}},
      scales:{x:{grid:{color:grid}, ticks:{color:ink3, autoSkip:false, maxRotation:0, font:{family:FONT,size:10}, callback:v=>{ const t = L[v]; return t && t.slice(11,13)==="00" ? `${DOW[parseLocal(t).getDay()]} ${t.slice(8,10)}` : null; }}},
        y:{position:"left", beginAtZero:false, grace:"5%", grid:{color:grid}, ticks:{color:ink3, font:{family:FONT,size:10}}, title:{display:true, text:"hPa", color:ink3}},
        y2:{position:"right", beginAtZero:true, suggestedMax:8, grid:{display:false}, ticks:{color:ink3, font:{family:FONT,size:10}}, title:{display:true, text:"mm/h", color:ink3}},
        y3:{display:false, beginAtZero:true}}},
    plugins:[frontLine]});
  // setas do vento a cada 6 h (10 m) — mostram o giro do vento na passagem das frentes
  const el = $("prArrows"); if(!el) return;
  let html = ""; for(let k=0;k<N;k+=6){ const d = h.wind_direction_10m[i0+k], s = h.wind_speed_10m[i0+k];
    html += `<span style="left:${(k+.5)/N*100}%" title="${fmtH(L[k])} · ${r0(s)} km/h de ${dirName(d)}"><svg viewBox="0 0 16 16" style="transform:rotate(${d+180}deg);opacity:${.4+Math.min(s,40)/40*.6}"><path d="M8 1l4 7H9v7H7V8H4z"/></svg></span>`; }
  el.innerHTML = html;
}

/* ---------- aviso no aparelho (alarmes de nível 2+ começando em até 24 h) ---------- */
async function notify(R, force){
  if(typeof Notification === "undefined" || Notification.permission !== "granted" || !store.get("pred-notify", false)) return;
  const sent = new Set(store.get("pred-sent", [])), now = Date.now();
  const due = R.A.filter(a=>a.lvl>=2 && (Date.parse(a.start) - now) < 24*36e5);
  for(const a of due){
    const id = `${D.key}|${a.type}|${a.start}`; if(sent.has(id) && !force) continue; sent.add(id);
    const reg = await navigator.serviceWorker?.getRegistration();
    const body = `${fmtW(a.start, a.end)} — ${a.desc}`;
    if(reg) reg.showNotification(`${LVL[a.lvl]}: ${a.title} · ${D.loc.name}`, {body, icon:"icons/icon-192.png", tag:id});
    else new Notification(`${LVL[a.lvl]}: ${a.title}`, {body});
    if(force) break;
  }
  store.set("pred-sent", [...sent].slice(-80));
}

/* ---------- widget da Minha tela ---------- */
function refreshWidget(){ window.Home?.refresh("alarms"); if(!D.res && D.loc && C.S.fc && !D.busy) ensure(); }
window.Pred = {setLoc, ensure, render, result: () => D.res, LVL, LCOL};
})();
