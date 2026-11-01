/* =============================================================================
   ESPORTES — dois módulos com o mesmo motor:
   · MAR (#mar): ondas, swell, maré, corrente, água → surf, longboard, SUP,
     caiaque, mergulho, natação em mar aberto, pesca embarcada;
   · VENTO (#vento): vento em 10/80/120 m, rajada, terral/maral, camada limite →
     kitesurf, windsurf, wingfoil, vela, parapente, asa-delta, balonismo, drone.
   Cada esporte recebe nota hora a hora (0 não · 1 limitado · 2 bom · 3 épico),
   com motivo e alerta de perigo; daí saem "agora", melhores janelas e mapa de 7 dias.
   ============================================================================= */
(() => {
"use strict";
const C = window.ClimaCore;
const {$, esc, r0, r1, fmtH, DOW, parseLocal, max, min, mean, mk, FONT, css, dirName} = C;
const store = {
  get(k,d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const X = {loc:null, key:null, mar:null, up:null, busy:false, sel:{mar:store.get("sp-sel-mar","surf"), vento:store.get("sp-sel-vento","kite")}};
const urlMar = l => `https://marine-api.open-meteo.com/v1/marine?latitude=${l.lat}&longitude=${l.lon}&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,secondary_swell_wave_height,wind_wave_height,sea_surface_temperature,ocean_current_velocity,ocean_current_direction,sea_level_height_msl&forecast_days=8&timezone=auto&cell_selection=sea`;
const urlUp = l => `https://api.open-meteo.com/v1/forecast?latitude=${l.lat}&longitude=${l.lon}&hourly=wind_speed_80m,wind_speed_120m,wind_direction_80m,boundary_layer_height&forecast_days=8&timezone=auto&wind_speed_unit=kmh`;
const KN = 1.852, kt = v => v/KN;
const DIRS8 = [["N",0],["NE",45],["L",90],["SE",135],["S",180],["SO",225],["O",270],["NO",315]];
const ad = (a,b) => Math.abs(((b-a+540)%360)-180);
const view = () => document.body.dataset.view;
const active = () => view()==="mar" || view()==="vento";
const SC = ["Não recomendado","Limitado","Bom","Excelente"], SCOL = ["#6B7480","#E8C21C","#3EC46D","#19B4FF"];

/* ---------- orientação da praia (para onde o mar está), por local ---------- */
const locKey = () => X.loc ? `${X.loc.lat.toFixed(2)},${X.loc.lon.toFixed(2)}` : "";
const face = () => store.get("sp-face-"+locKey(), 90);
// relação do vento com a praia: 0° = maral (do mar), 90° = lateral, 180° = terral (da terra)
const relW = d => ad(d, face());
const relName = r => r < 45 ? "maral (do mar)" : r < 75 ? "lateral-maral" : r <= 110 ? "lateral" : r <= 140 ? "lateral-terral" : "terral (da terra)";

/* ---------- carga ---------- */
function setLoc(loc){ X.loc = loc; X.key = null; if(active()) ensure(); else window.Home?.refresh("sports"); }
async function ensure(force){
  if(!X.loc || !C.S.fc) return;
  const key = locKey();
  if(!force && X.key === key){ render(); return; }
  if(X.busy === key) return;
  X.busy = key;
  const b = $(`${view()}-body`); if(b) b.innerHTML = `<div class="xload">Lendo mar e vento para ${esc(X.loc.name)}…</div>`;
  const [m, u] = await Promise.allSettled([C.getJSON(urlMar(X.loc)), C.getJSON(urlUp(X.loc))]);
  if(X.busy !== key) return;
  X.busy = false; X.key = key;
  X.mar = m.status==="fulfilled" && m.value.hourly && m.value.hourly.wave_height.some(v=>v!=null) ? m.value.hourly : null;
  X.up  = u.status==="fulfilled" ? u.value.hourly : null;
  X.mIdx = X.mar ? new Map(X.mar.time.map((t,i)=>[t,i])) : null;
  X.uIdx = X.up ? new Map(X.up.time.map((t,i)=>[t,i])) : null;
  render(); window.Home?.refresh("sports");
}
addEventListener("hashchange", ()=>{ if(active()) ensure(); });

/* ---------- leitura de uma hora ---------- */
function at(k){
  const h = C.S.fc.hourly, t = h.time[k], j = X.mIdx?.get(t), u = X.uIdx?.get(t), M = X.mar, U = X.up;
  return {t, day:!!h.is_day[k], w:h.wind_speed_10m[k], g:h.wind_gusts_10m[k], d:h.wind_direction_10m[k], rain:h.precipitation[k], pp:h.precipitation_probability[k],
    cape:h.cape[k], li:h.lifted_index[k], vis:h.visibility[k], code:h.weather_code[k], temp:h.temperature_2m[k],
    w80:u!=null?U.wind_speed_80m[u]:null, w120:u!=null?U.wind_speed_120m[u]:null, blh:u!=null?U.boundary_layer_height[u]:null,
    H:j!=null?M.wave_height[j]:null, Hd:j!=null?M.wave_direction[j]:null, T:j!=null?M.wave_period[j]:null,
    sH:j!=null?M.swell_wave_height[j]:null, sT:j!=null?M.swell_wave_period[j]:null, sD:j!=null?M.swell_wave_direction[j]:null,
    wwH:j!=null?M.wind_wave_height[j]:null, sst:j!=null?M.sea_surface_temperature[j]:null, cur:j!=null?M.ocean_current_velocity[j]:null, tide:j!=null?M.sea_level_height_msl[j]:null,
    storm: h.weather_code[k]>=95 || (h.cape[k]>=1200 && h.lifted_index[k]<=-3)};
}
const R = (s, why, warn) => ({s, why, warn});
const noSea = R(0, "sem dados de mar neste local (fora da costa)");

/* ---------- esportes ---------- */
const SPORTS = {
  mar: [
    {id:"surf", nome:"Surf", ic:"🏄", tip:"Swell de 0,8–2,5 m com período ≥ 9 s, vento terral fraco ou calmo, swell entrando de frente na praia.", f(x){
      if(x.H==null) return noSea; if(x.storm) return R(0,"trovoadas","Raios: saia da água");
      const H = x.H, T = x.T||0, wr = relW(x.d), wk = kt(x.w), on = ad(x.sD ?? x.Hd, face()) < 80;
      if(H < .4) return R(0, `mar flat (${r1(H)} m)`);
      if(H > 3.2) return R(1, `ondas grandes ${r1(H)} m / ${r0(T)} s — só experientes`, "Ondas acima de 3 m");
      let s = H >= .8 ? 2 : 1;
      if(T >= 10 && H >= 1 && on) s = 3;
      if(!on) s = Math.min(s, 1);
      if(wr < 70 && wk > 12) s = Math.min(s, 1);        // maral forte desmancha a onda
      if(wr > 120 && wk <= 15 && s >= 2 && T >= 8) s = 3;   // terral leve penteia
      return R(s, `${r1(H)} m · ${r0(T)} s de ${dirName(x.sD ?? x.Hd)} · vento ${r0(wk)} kt ${relName(wr)}${on?"":" · swell não entra de frente"}`, H > 2.5 ? "Ondas fortes, correntes de retorno" : null); }},
    {id:"long", nome:"Longboard / iniciante", ic:"🛹", tip:"Ondas de 0,4–1,2 m, período médio, pouco vento — ideal para aprender.", f(x){
      if(x.H==null) return noSea; if(x.storm) return R(0,"trovoadas","Raios");
      const H = x.H, wk = kt(x.w);
      if(H < .3) return R(0, `flat (${r1(H)} m)`);
      if(H > 1.6) return R(0, `ondas de ${r1(H)} m — grandes para iniciantes`, "Mar forte para iniciante");
      let s = H <= 1.2 ? 2 : 1; if(wk < 10 && H >= .5 && H <= 1.1 && (x.T||0) >= 8) s = 3; if(wk > 14 && relW(x.d) < 80) s = Math.min(s,1);
      return R(s, `${r1(H)} m · ${r0(x.T)} s · vento ${r0(wk)} kt`); }},
    {id:"sup", nome:"Stand up paddle", ic:"🛶", tip:"Mar liso (< 0,6 m), vento abaixo de 10 kt, sem chuva forte.", f(x){
      if(x.H==null) return noSea; if(x.storm) return R(0,"trovoadas","Raios");
      const wk = kt(x.w), gk = kt(x.g);
      if(wr(x) > 140 && wk > 8) return R(0, `vento terral ${r0(wk)} kt — empurra para o alto-mar`, "Terral: risco de ser levado para fora");
      if(x.H > 1 || wk > 15) return R(0, `${r1(x.H)} m · vento ${r0(wk)} kt`);
      let s = x.H <= .6 && wk <= 10 ? 2 : 1; if(x.H <= .4 && wk <= 6 && gk <= 10) s = 3; if(x.rain > 2) s = Math.min(s,1);
      return R(s, `${r1(x.H)} m · vento ${r0(wk)} kt (raj. ${r0(gk)})`); }},
    {id:"caiaque", nome:"Caiaque / canoa havaiana", ic:"🚣", tip:"Ondas < 1 m, vento < 14 kt e rajadas < 20 kt; corrente fraca.", f(x){
      if(x.H==null) return noSea; if(x.storm) return R(0,"trovoadas","Raios");
      const wk = kt(x.w), gk = kt(x.g);
      if(x.H > 1.5 || gk > 25) return R(0, `${r1(x.H)} m · rajada ${r0(gk)} kt`, gk > 25 ? "Rajadas fortes" : null);
      let s = x.H <= 1 && wk <= 14 && gk <= 20 ? 2 : 1; if(x.H <= .6 && wk <= 9) s = 3; if((x.cur||0) > 2) s = Math.min(s,1);
      return R(s, `${r1(x.H)} m · vento ${r0(wk)} kt · corrente ${r1(x.cur)} km/h`); }},
    {id:"mergulho", nome:"Mergulho / snorkel", ic:"🤿", tip:"Mar calmo (< 0,8 m), pouca chuva nas 48 h anteriores (água limpa), água ≥ 18 °C.", f(x, k){
      if(x.H==null) return noSea; if(x.storm) return R(0,"trovoadas","Raios");
      const h = C.S.fc.hourly, prev = h.precipitation.slice(Math.max(0,k-48), k).reduce((a,b)=>a+(b||0),0), wk = kt(x.w);
      if(x.H > 1.3 || wk > 16) return R(0, `${r1(x.H)} m · vento ${r0(wk)} kt — visibilidade ruim`);
      let s = x.H <= .8 && wk <= 12 ? 2 : 1;
      if(prev > 15) s = Math.min(s,1); if(x.H <= .5 && prev < 3 && wk <= 8 && (x.sst||0) >= 20) s = 3;
      return R(s, `${r1(x.H)} m · chuva 48 h ${r0(prev)} mm (turbidez) · água ${r1(x.sst)}°C`); }},
    {id:"nado", nome:"Natação em mar aberto", ic:"🏊", tip:"Ondas < 0,8 m, vento < 12 kt, água ≥ 18 °C, corrente fraca.", f(x){
      if(x.H==null) return noSea; if(x.storm) return R(0,"trovoadas","Raios: saia da água");
      const wk = kt(x.w), w = x.sst ?? 99;
      if(x.H > 1.2) return R(0, `${r1(x.H)} m — correntes de retorno`, "Correntes de retorno");
      if(w < 15) return R(0, `água ${r1(w)}°C — hipotermia`, "Água fria");
      let s = x.H <= .8 && wk <= 12 ? 2 : 1; if(x.H <= .5 && wk <= 8 && w >= 20) s = 3; if((x.cur||0) > 1.5 || w < 18) s = Math.min(s,1);
      return R(s, `${r1(x.H)} m · água ${r1(w)}°C · corrente ${r1(x.cur)} km/h`); }},
    {id:"pesca", nome:"Pesca embarcada", ic:"🎣", tip:"Ondas < 1,5 m, vento < 15 kt, rajadas < 22 kt, sem trovoadas; mudança de maré favorece.", f(x){
      if(x.H==null) return noSea; if(x.storm) return R(0,"trovoadas","Raios no mar");
      const wk = kt(x.w), gk = kt(x.g);
      if(x.H > 2 || gk > 28) return R(0, `${r1(x.H)} m · rajada ${r0(gk)} kt`, "Mar grosso para embarcação pequena");
      let s = x.H <= 1.5 && wk <= 15 && gk <= 22 ? 2 : 1; if(x.H <= 1 && wk <= 10) s = 3;
      return R(s, `${r1(x.H)} m · vento ${r0(wk)} kt (raj. ${r0(gk)})`); }}
  ],
  vento: [
    {id:"kite", nome:"Kitesurf", ic:"🪁", tip:"12–30 kt (ideal 15–25), rajadas estáveis, vento lateral ou lateral-maral. Terral é perigoso.", f(x){
      if(x.storm) return R(0,"trovoadas","Raios: pipas atraem descargas"); if(!x.day) return R(0,"noite");
      const wk = kt(x.w), gk = kt(x.g), gf = gk/Math.max(1,wk), r = relW(x.d);
      if(r > 140 && wk >= 8) return R(0, `${r0(wk)} kt terral — leva para o alto-mar`, "Vento terral");
      if(wk < 11) return R(0, `${r0(wk)} kt — vento fraco`);
      if(wk > 34 || gk > 40) return R(0, `${r0(wk)} kt (raj. ${r0(gk)}) — forte demais`, "Vento extremo");
      let s = wk >= 15 && wk <= 25 ? 2 : 1;
      if(s===2 && gf <= 1.35 && r >= 45 && r <= 110) s = 3;
      if(gf > 1.6) s = Math.min(s,1);
      return R(s, `${r0(wk)} kt (raj. ${r0(gk)}) · ${dirName(x.d)} ${relName(r)} · pipa ${wk>=22?"7–9 m²":wk>=17?"9–11 m²":"12–14 m²"}`, gf > 1.6 ? "Rajadas irregulares" : null); }},
    {id:"wind", nome:"Windsurf", ic:"🏄‍♂️", tip:"12–30 kt; lateral é o ideal; terral perigoso.", f(x){
      if(x.storm) return R(0,"trovoadas","Raios"); if(!x.day) return R(0,"noite");
      const wk = kt(x.w), gk = kt(x.g), r = relW(x.d);
      if(r > 140 && wk >= 8) return R(0, `${r0(wk)} kt terral`, "Vento terral");
      if(wk < 11) return R(0, `${r0(wk)} kt — fraco (só pranchão)`);
      if(wk > 36) return R(0, `${r0(wk)} kt — forte demais`, "Vento extremo");
      let s = wk >= 14 && wk <= 28 ? 2 : 1; if(s===2 && gk/wk <= 1.35 && r >= 45 && r <= 120) s = 3;
      return R(s, `${r0(wk)} kt (raj. ${r0(gk)}) · ${relName(r)} · vela ${wk>=24?"4,5–5,3 m²":wk>=18?"5,5–6,5 m²":"7–8 m²"}`); }},
    {id:"wing", nome:"Wingfoil", ic:"🪽", tip:"10–25 kt; o foil funciona com menos vento que o kite.", f(x){
      if(x.storm) return R(0,"trovoadas","Raios"); if(!x.day) return R(0,"noite");
      const wk = kt(x.w), gk = kt(x.g), r = relW(x.d);
      if(r > 140 && wk >= 8) return R(0, `${r0(wk)} kt terral`, "Vento terral");
      if(wk < 9) return R(0, `${r0(wk)} kt — fraco`); if(wk > 30) return R(0, `${r0(wk)} kt — forte demais`, "Vento extremo");
      let s = wk >= 12 && wk <= 24 ? 2 : 1; if(s===2 && gk/wk <= 1.4 && wk >= 14 && wk <= 20) s = 3;
      return R(s, `${r0(wk)} kt (raj. ${r0(gk)}) · asa ${wk>=20?"4 m²":wk>=15?"5 m²":"6 m²"}`); }},
    {id:"vela", nome:"Vela (dinghy / veleiro)", ic:"⛵", tip:"6–20 kt; acima de 22 kt rizar; rajadas < 30 kt.", f(x){
      if(x.storm) return R(0,"trovoadas","Raios no mar");
      const wk = kt(x.w), gk = kt(x.g);
      if(wk < 4) return R(0, `${r0(wk)} kt — calmaria`); if(gk > 34) return R(0, `rajadas de ${r0(gk)} kt`, "Rajadas fortes");
      let s = wk >= 6 && wk <= 20 ? 2 : 1; if(wk >= 9 && wk <= 16 && gk <= 22 && x.day) s = 3; if(x.H != null && x.H > 2.5) s = Math.min(s,1);
      return R(s, `${r0(wk)} kt de ${dirName(x.d)} (raj. ${r0(gk)})${wk>22?" · rizar a vela":""}`); }},
    {id:"para", nome:"Parapente", ic:"🪂", tip:"Decolagem com 5–20 km/h, vento em 80 m < 25 km/h, rajada até +15 km/h; camada limite alta = térmicas.", f(x){
      if(x.storm) return R(0,"instabilidade/trovoadas","Cúmulo-nimbo: risco de sucção"); if(!x.day) return R(0,"noite");
      if(x.rain > .2) return R(0, "chuva");
      const w = x.w, g = x.g, w80 = x.w80 ?? w*1.3;
      if(w80 > 32 || g > 32) return R(0, `vento ${r0(w)} km/h (80 m ${r0(w80)}, raj. ${r0(g)})`, "Vento forte em altura");
      if(g - w > 18) return R(0, `rajadas irregulares (${r0(w)}→${r0(g)} km/h)`, "Turbulência");
      let s = w >= 5 && w <= 20 && w80 <= 25 ? 2 : 1;
      if(s===2 && (x.blh||0) >= 1200 && g - w <= 12) s = 3;
      return R(s, `${r0(w)} km/h de ${dirName(x.d)} · 80 m ${r0(w80)} km/h · térmicas até ~${r0(x.blh||0)} m`); }},
    {id:"asa", nome:"Asa-delta", ic:"🦅", tip:"Decolagem com 5–25 km/h, vento em 80 m < 30 km/h, rajadas < 35 km/h.", f(x){
      if(x.storm) return R(0,"trovoadas","Cúmulo-nimbo"); if(!x.day) return R(0,"noite"); if(x.rain > .2) return R(0,"chuva");
      const w = x.w, g = x.g, w80 = x.w80 ?? w*1.3;
      if(w80 > 38 || g > 38) return R(0, `vento forte (80 m ${r0(w80)} km/h)`, "Vento forte em altura");
      let s = w >= 5 && w <= 25 && w80 <= 30 && g <= 35 ? 2 : 1; if(s===2 && (x.blh||0) >= 1300 && g - w <= 14) s = 3;
      return R(s, `${r0(w)} km/h · 80 m ${r0(w80)} · térmicas ~${r0(x.blh||0)} m`); }},
    {id:"balao", nome:"Balonismo", ic:"🎈", tip:"Só nas 3 horas depois do nascer do sol: vento < 10 km/h na superfície e < 15 km/h em 80 m, sem chuva.", f(x){
      const hr = +x.t.slice(11,13), d = C.S.fc.daily, di = d.time.indexOf(x.t.slice(0,10)), sr = di>=0 ? +d.sunrise[di].slice(11,13) : 6;
      if(hr < sr || hr > sr+2) return R(0, "fora da janela da manhã");
      if(x.storm || x.rain > 0) return R(0, "chuva/instabilidade");
      const w80 = x.w80 ?? x.w*1.3;
      if(x.w > 14 || w80 > 20) return R(0, `vento ${r0(x.w)} km/h (80 m ${r0(w80)})`);
      let s = x.w <= 10 && w80 <= 15 ? 2 : 1; if(x.w <= 6 && w80 <= 10 && (x.vis||0) >= 8000) s = 3;
      return R(s, `${r0(x.w)} km/h · 80 m ${r0(w80)} km/h · visib. ${x.vis>=10000?">10":r1((x.vis||0)/1000)} km`); }},
    {id:"drone", nome:"Drone", ic:"🛸", tip:"Vento em 120 m < 30 km/h (rajada < 38), sem chuva, visibilidade > 3 km. Respeite as regras da ANAC/DECEA.", f(x){
      if(x.storm || x.rain > .2) return R(0, "chuva/trovoadas");
      const w120 = x.w120 ?? x.w*1.4, g = x.g;
      if(w120 > 40 || g > 45) return R(0, `vento em 120 m ${r0(w120)} km/h`, "Vento forte em altura");
      if((x.vis||10000) < 3000) return R(0, "visibilidade baixa");
      let s = w120 <= 30 && g <= 38 ? 2 : 1; if(w120 <= 18 && g <= 25 && x.day) s = 3;
      return R(s, `120 m ${r0(w120)} km/h · rajada ${r0(g)} km/h${x.day?"":" · noite (precisa de autorização)"}`); }}
  ]
};
function wr(x){ return relW(x.d); }

/* ---------- avaliação ---------- */
function evalAll(mod){
  const h = C.S.fc.hourly, i0 = C.nowIndex(), N = Math.min(168, h.time.length - i0);
  const xs = Array.from({length:N}, (_,k)=>at(i0+k));
  return SPORTS[mod].map(sp=>{
    // esportes diurnos: à noite a nota é zero (pesca, vela e drone têm regra própria)
    const night = !["pesca","vela","drone","balao"].includes(sp.id);
    const r = xs.map((x,k)=> night && !x.day ? R(0,"noite") : sp.f(x, i0+k));
    // melhor janela: maior bloco ≥ 2 h com nota ≥ 2 (desempate pela média)
    const runs = []; let st = -1;
    r.forEach((o,k)=>{ if(o.s>=2){ if(st<0) st=k; } else if(st>=0){ runs.push([st,k-1]); st=-1; } }); if(st>=0) runs.push([st,N-1]);
    const best = runs.filter(([a,b])=>b-a>=1).map(([a,b])=>({a,b,avg:mean(r.slice(a,b+1).map(o=>o.s)), n:b-a+1}))
      .sort((p,q)=>q.avg*q.n - p.avg*p.n)[0] || null;
    const next = runs.find(([a,b])=>b-a>=1) || null;
    const good = r.filter(o=>o.s>=2).length, epic = r.filter(o=>o.s===3).length;
    return {sp, r, xs, best, next, good, epic, now:r[0], i0};
  });
}
const winTxt = (E, a, b) => { const t0 = E.xs[a].t, t1 = E.xs[b].t, d0 = parseLocal(t0), d1 = parseLocal(t1);
  return `${DOW[d0.getDay()]} ${fmtH(t0)}–${d0.toDateString()===d1.toDateString() ? "" : DOW[d1.getDay()]+" "}${String(+t1.slice(11,13)+1).padStart(2,"0")}:00`; };

/* ---------- maré: extremos locais ---------- */
function tides(){
  if(!X.mar) return [];
  const M = X.mar, out = [], now = C.S.fc.current.time.slice(0,13)+":00";
  for(let i=1;i<M.time.length-1;i++){ const a = M.sea_level_height_msl[i-1], b = M.sea_level_height_msl[i], c = M.sea_level_height_msl[i+1];
    if(a==null||b==null||c==null || M.time[i] < now) continue;
    if(b>a && b>=c) out.push({t:M.time[i], v:b, hi:true}); else if(b<a && b<=c) out.push({t:M.time[i], v:b, hi:false}); }
  return out;
}
const suit = w => w==null ? "—" : w>=24 ? "lycra / sem roupa" : w>=21 ? "long john ou 2 mm" : w>=18 ? "3/2 mm" : w>=15 ? "4/3 mm" : "5/4 mm + bota";

/* ---------- praias da região (raio de 100 km) ---------- */
// Nominatim (OSM) lista as praias; a Open-Meteo devolve, para cada praia, o ponto de mar mais próximo —
// o rumo praia → mar dá a orientação da praia, que define terral/maral e se o swell entra.
const brg = (a, b) => { const y = Math.sin((b[0]-a[0])*Math.PI/180)*Math.cos(b[1]*Math.PI/180), x = Math.cos(a[1]*Math.PI/180)*Math.sin(b[1]*Math.PI/180) - Math.sin(a[1]*Math.PI/180)*Math.cos(b[1]*Math.PI/180)*Math.cos((b[0]-a[0])*Math.PI/180); return (Math.atan2(y,x)*180/Math.PI+360)%360; };
const kmD = (a, b) => { const R = 6371, dLa = (b[1]-a[1])*Math.PI/180, dLo = (b[0]-a[0])*Math.PI/180; return 2*R*Math.asin(Math.sqrt(Math.sin(dLa/2)**2 + Math.cos(a[1]*Math.PI/180)*Math.cos(b[1]*Math.PI/180)*Math.sin(dLo/2)**2)); };
async function loadBeaches(){
  const key = locKey(); if(X.bKey === key || X.bBusy === key) return; X.bBusy = key;
  const l = X.loc, dLat = .9, dLon = .9/Math.cos(l.lat*Math.PI/180);
  try{
    const res = await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=praia&limit=50&bounded=1&accept-language=pt&viewbox=${l.lon-dLon},${l.lat+dLat},${l.lon+dLon},${l.lat-dLat}`)).json();
    const seen = new Set();
    let B = res.filter(r=>r.type==="beach" && r.name).map(r=>({name:r.name, lat:+r.lat, lon:+r.lon, km:kmD([l.lon,l.lat],[+r.lon,+r.lat])}))
      .filter(b=>b.km<=100 && !seen.has(b.name) && seen.add(b.name)).sort((a,b)=>a.km-b.km).slice(0, 30);
    if(!B.length){ X.beaches = []; X.bKey = key; X.bBusy = null; render(); return; }
    const la = B.map(b=>b.lat.toFixed(4)).join(","), lo = B.map(b=>b.lon.toFixed(4)).join(",");
    const [m, w] = await Promise.all([
      C.getJSON(`https://marine-api.open-meteo.com/v1/marine?latitude=${la}&longitude=${lo}&current=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,sea_surface_temperature&cell_selection=sea&timezone=auto`),
      C.getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&timezone=auto`)]);
    const M = Array.isArray(m) ? m : [m], Wd = Array.isArray(w) ? w : [w];
    B.forEach((b,i)=>{ const mm = M[i], ww = Wd[i]; if(!mm || !mm.current) return;
      const sea = [mm.longitude, mm.latitude], dist = kmD([b.lon,b.lat], sea);
      b.face = dist > .3 ? brg([b.lon,b.lat], sea) : null; b.m = mm.current; b.w = ww?.current; });
    X.beaches = B.filter(b=>b.m && b.m.wave_height!=null);
  }catch(e){ X.beaches = null; }
  X.bKey = key; X.bBusy = null; if(view()==="mar") render();
}
// condição da praia: nota de surf e de banho/SUP com a orientação de cada praia
function beachRate(b){
  const H = b.m.wave_height, T = b.m.wave_period || 0, sD = b.m.swell_wave_direction ?? b.m.wave_direction, f = b.face ?? face();
  const wk = b.w ? kt(b.w.wind_speed_10m) : 0, wr = b.w ? ad(b.w.wind_direction_10m, f) : 90, on = ad(sD, f) < 80;
  let surf = H < .4 ? 0 : H > 3 ? 1 : H >= .8 ? 2 : 1;
  if(surf && !on) surf = Math.min(surf,1); if(wr < 70 && wk > 12) surf = Math.min(surf,1); if(surf===2 && T>=10 && H>=1 && on && (wr>110 || wk<8)) surf = 3;
  let calm = H > 1.2 || wk > 18 ? 0 : H <= .5 && wk <= 10 ? 3 : H <= .8 && wk <= 14 ? 2 : 1;
  const label = H > 2.5 ? ["Mar agitado", 0] : surf >= 2 ? [surf===3 ? "Surf excelente" : "Bom para surf", surf] : calm >= 2 ? [calm===3 ? "Mar calmo · banho e SUP" : "Mar tranquilo", calm] : ["Mar mexido", 1];
  return {surf, calm, label, wr, wk, on, f};
}

/* ---------- ranking ao vivo: onde está melhor para surfar no Brasil hoje ---------- */
// Coordenadas e orientação (para onde a praia está voltada) aproximadas de picos consagrados.
const SPOTS = [
  ["Cacimba do Padre","Fernando de Noronha · PE",-3.845,-32.441,330],["Praia do Futuro","Fortaleza · CE",-3.745,-38.445,60],
  ["Baía Formosa","RN",-6.372,-34.995,75],["Praia do Amor (Pipa)","Tibau do Sul · RN",-6.233,-35.048,90],
  ["Engenhoca","Itacaré · BA",-14.334,-38.995,95],["Regência","Linhares · ES",-19.652,-39.815,110],
  ["Itaúna","Saquarema · RJ",-22.936,-42.483,170],["Praia Grande","Arraial do Cabo · RJ",-22.970,-42.040,190],
  ["Arpoador","Rio de Janeiro · RJ",-22.990,-43.192,180],["Prainha","Rio de Janeiro · RJ",-23.041,-43.506,180],
  ["Itamambuca","Ubatuba · SP",-23.403,-45.015,140],["Maresias","São Sebastião · SP",-23.792,-45.566,160],
  ["Praia Brava","Itajaí · SC",-26.945,-48.630,90],["Moçambique","Florianópolis · SC",-27.530,-48.418,80],
  ["Praia Mole","Florianópolis · SC",-27.603,-48.432,100],["Joaquina","Florianópolis · SC",-27.630,-48.448,95],
  ["Silveira","Garopaba · SC",-28.035,-48.612,75],["Ferrugem","Garopaba · SC",-28.064,-48.627,120],
  ["Praia do Rosa","Imbituba · SC",-28.122,-48.642,100],["Praia da Vila","Imbituba · SC",-28.232,-48.655,120],
  ["Tramandaí","RS",-29.985,-50.120,110],["Cassino","Rio Grande · RS",-32.190,-52.158,130]
];
const clamp = v => Math.max(0, Math.min(1, v));
// qualidade 0–10: tamanho, período, swell entrando de frente e vento (terral leve é o melhor)
function surfQ(H, T, sD, wDir, wKmh, fc){
  if(H==null) return null;
  const s1 = H < .35 ? 0 : H <= 2.5 ? clamp((H-.3)/1.2) : clamp(1 - (H-2.5)/2.5);
  const s2 = clamp(((T||0)-5)/7);
  const da = ad(sD, fc), s3 = da < 60 ? 1 : da < 90 ? .6 : .25;
  const wk = kt(wKmh||0), wr = ad(wDir||0, fc);
  const s4 = wk < 5 ? 1 : wr > 115 ? (wk <= 15 ? 1 : .6) : wr > 65 ? (wk < 10 ? .8 : .5) : (wk < 8 ? .7 : wk < 14 ? .45 : .2);
  return 10 * Math.pow(s1, .8) * (.4 + .6*s2) * s3 * s4;
}
const qLabel = q => q >= 7 ? ["Clássico", 3] : q >= 4.5 ? ["Bom", 2] : q >= 2 ? ["Surfável", 1] : ["Fraco / flat", 0];
async function loadRank(){
  if(X.rank && Date.now() - X.rankAt < 30*6e4) return;
  if(X.rankBusy) return; X.rankBusy = true;
  const la = SPOTS.map(s=>s[2]).join(","), lo = SPOTS.map(s=>s[3]).join(",");
  try{
    const [m, w] = await Promise.all([
      C.getJSON(`https://marine-api.open-meteo.com/v1/marine?latitude=${la}&longitude=${lo}&hourly=wave_height,wave_period,wave_direction,swell_wave_direction,sea_surface_temperature&forecast_days=2&timezone=auto&cell_selection=sea`),
      C.getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&hourly=wind_speed_10m,wind_direction_10m,is_day&forecast_days=2&timezone=auto`)]);
    const M = Array.isArray(m) ? m : [m], W = Array.isArray(w) ? w : [w];
    X.rank = SPOTS.map((s,i)=>{
      const mh = M[i]?.hourly, wh = W[i]?.hourly; if(!mh || !wh) return null;
      const off = M[i].utc_offset_seconds || 0, nowLocal = new Date(Date.now() + off*1000).toISOString().slice(0,13)+":00";
      const wi = new Map(wh.time.map((t,j)=>[t,j]));
      const hrs = mh.time.map((t,j)=>{ const k = wi.get(t); if(k==null || t < nowLocal) return null;
        return {t, q:surfQ(mh.wave_height[j], mh.wave_period[j], mh.swell_wave_direction[j] ?? mh.wave_direction[j], wh.wind_direction_10m[k], wh.wind_speed_10m[k], s[4]),
          H:mh.wave_height[j], T:mh.wave_period[j], D:mh.wave_direction[j], wk:kt(wh.wind_speed_10m[k]), wr:ad(wh.wind_direction_10m[k], s[4]), sst:mh.sea_surface_temperature[j], day:!!wh.is_day[k]}; }).filter(Boolean);
      const now = hrs[0], day = hrs.filter(h=>h.day && h.q!=null).slice(0, 18);
      const best = day.reduce((a,b)=>!a || b.q > a.q ? b : a, null);
      return now && now.q!=null ? {name:s[0], where:s[1], lat:s[2], lon:s[3], face:s[4], now, best} : null;
    }).filter(Boolean).sort((a,b)=>(b.best?.q ?? b.now.q) - (a.best?.q ?? a.now.q));
    X.rankAt = Date.now();
  }catch(e){ X.rank = X.rank || null; }
  X.rankBusy = false;
  if(view()==="mar") render(); window.Home?.refresh("surfbr");
}
function rankSec(){
  const h = `<div class="sh"><h2>🇧🇷 Onde está melhor para surfar no Brasil</h2><p>Ranking ao vivo de ${SPOTS.length} picos, pela melhor hora com luz do dia nas próximas ~18 h (onda, período, swell entrando de frente e vento terral/maral). Atualiza a cada 30 min.</p></div>`;
  if(!X.rank) return h + `<div class="xload">${X.rankBusy || X.rank===undefined ? "Calculando o ranking dos picos…" : "Ranking indisponível agora."}</div>`;
  return h + `<div class="rk">${X.rank.map((r,i)=>{ const b = r.best || r.now, [lb, s] = qLabel(b.q);
    return `<div class="rk-r glass" style="--c:${SCOL[s]}"><span class="rk-n">${i+1}</span>
      <div class="rk-p"><b>${esc(r.name)}</b><small>${esc(r.where)}</small></div>
      <div class="rk-q"><b>${r1(b.q)}</b><em>${lb}</em></div>
      <div class="rk-d"><span>🌊 ${r1(b.H)} m · ${r0(b.T)} s ${dirName(b.D)}</span><span>💨 ${r0(b.wk)} kt ${relName(b.wr).split(" ")[0]}</span>
        <span>🕑 ${r.best ? `melhor ${DOW[parseLocal(b.t).getDay()]} ${fmtH(b.t)}` : "agora"} · agora ${r1(r.now.q)}</span></div>
      <div class="rk-a"><button class="mbtn" data-trip="${esc(r.name)}|${r.lat}|${r.lon}">Viajar</button><button class="mbtn" data-rk="${i}">Mapa</button><button class="mbtn" data-rkf="${i}">Previsão</button></div></div>`; }).join("")}</div>
    <p class="rg-n">Nota de 0 a 10 calculada pelo sistema (não é previsão oficial). Coordenadas e orientação dos picos são aproximadas. Ondas e vento: Open-Meteo.</p>`;
}

/* ---------- ranking ao vivo: onde está melhor para kite/windsurf no Brasil hoje ---------- */
// orientação null = lagoa (sem terral/maral relevante)
const WSPOTS = [
  ["Atins","Barreirinhas · MA",-2.570,-42.742,10],["Barra Grande","Cajueiro da Praia · PI",-2.903,-41.416,0],
  ["Jericoacoara","CE",-2.795,-40.513,0],["Preá","Cruz · CE",-2.815,-40.420,0],["Icaraí de Amontada","CE",-3.003,-39.645,20],
  ["Taíba","São Gonçalo do Amarante · CE",-3.508,-38.905,30],["Cumbuco","Caucaia · CE",-3.627,-38.733,20],
  ["Galinhos","RN",-5.090,-36.275,0],["São Miguel do Gostoso","RN",-5.123,-35.635,20],
  ["Rasa","Búzios · RJ",-22.735,-41.965,60],["Praia do Forte","Cabo Frio · RJ",-22.890,-42.015,160],
  ["Ponta das Canas","Ilhabela · SP",-23.733,-45.352,10],["Lagoa da Conceição","Florianópolis · SC",-27.598,-48.470,null],
  ["Lagoa de Ibiraquera","Imbituba · SC",-28.150,-48.660,null],["Itapirubá","Imbituba · SC",-28.335,-48.700,120],
  ["Lagoa dos Patos (Laranjal)","Pelotas · RS",-31.760,-52.230,null]
];
function windQ(wKmh, gKmh, dir, fc){
  const w = kt(wKmh||0), g = kt(gKmh||0);
  const sw = w < 11 ? 0 : w < 15 ? .3 + (w-11)/4*.45 : w <= 25 ? 1 : w <= 32 ? 1 - (w-25)/7*.6 : w <= 34 ? .3 : 0;
  const gf = g/Math.max(1,w), sg = gf <= 1.5 ? 1 : gf <= 1.8 ? .8 : gf <= 2.1 ? .6 : .4;   // rajada de modelo costuma vir alta
  const r = fc==null ? null : ad(dir, fc), sd = r==null ? .9 : r > 140 ? .15 : r >= 45 && r <= 115 ? 1 : r < 45 ? .75 : .6;
  return {q: 10*sw*sg*sd, w, g, r};
}
const wLabel = q => q >= 7 ? ["Épico", 3] : q >= 4.5 ? ["Bom", 2] : q >= 2 ? ["Velejável", 1] : ["Fraco", 0];
async function loadWRank(){
  if(X.wrank && Date.now() - X.wrankAt < 30*6e4) return;
  if(X.wrankBusy) return; X.wrankBusy = true;
  try{
    const j = await C.getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${WSPOTS.map(s=>s[2]).join(",")}&longitude=${WSPOTS.map(s=>s[3]).join(",")}&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,is_day&forecast_days=2&timezone=auto`);
    const A = Array.isArray(j) ? j : [j];
    X.wrank = WSPOTS.map((s,i)=>{ const h = A[i]?.hourly; if(!h) return null;
      const nowLocal = new Date(Date.now() + (A[i].utc_offset_seconds||0)*1000).toISOString().slice(0,13)+":00";
      const hrs = h.time.map((t,k)=> t < nowLocal ? null : {t, day:!!h.is_day[k], d:h.wind_direction_10m[k], ...windQ(h.wind_speed_10m[k], h.wind_gusts_10m[k], h.wind_direction_10m[k], s[4])}).filter(Boolean);
      const now = hrs[0], day = hrs.filter(x=>x.day).slice(0, 18), best = day.reduce((a,b)=>!a || b.q > a.q ? b : a, null);
      return now ? {name:s[0], where:s[1], lat:s[2], lon:s[3], face:s[4], now, best} : null;
    }).filter(Boolean).sort((a,b)=>(b.best?.q ?? b.now.q) - (a.best?.q ?? a.now.q));
    X.wrankAt = Date.now();
  }catch(e){}
  X.wrankBusy = false;
  if(view()==="vento") render(); window.Home?.refresh("kitebr");
}
function wRankSec(){
  const h = `<div class="sh"><h2>🇧🇷 Onde está melhor para kite e windsurf no Brasil</h2><p>Ranking ao vivo de ${WSPOTS.length} picos pela melhor hora com luz do dia nas próximas ~18 h: força do vento (ideal 15–25 kt), regularidade das rajadas e direção em relação à praia (terral derruba a nota). Atualiza a cada 30 min.</p></div>`;
  if(!X.wrank) return h + `<div class="xload">Calculando o ranking dos picos…</div>`;
  return h + `<div class="rk">${X.wrank.map((r,i)=>{ const b = r.best || r.now, [lb, s] = wLabel(b.q);
    return `<div class="rk-r glass" style="--c:${SCOL[s]}"><span class="rk-n">${i+1}</span>
      <div class="rk-p"><b>${esc(r.name)}</b><small>${esc(r.where)}</small></div>
      <div class="rk-q"><b>${r1(b.q)}</b><em>${lb}</em></div>
      <div class="rk-d"><span>💨 ${r0(b.w)} kt (raj. ${r0(b.g)}) de ${dirName(b.d)}</span><span>${b.r==null ? "lagoa" : relName(b.r)}</span>
        <span>🪁 ${b.w>=22?"7–9 m²":b.w>=17?"9–11 m²":b.w>=12?"12–14 m²":"—"}</span><span>🕑 ${r.best ? `melhor ${DOW[parseLocal(b.t).getDay()]} ${fmtH(b.t)}` : "agora"} · agora ${r1(r.now.q)}</span></div>
      <div class="rk-a"><button class="mbtn" data-trip="${esc(r.name)}|${r.lat}|${r.lon}">Viajar</button><button class="mbtn" data-wk="${i}">Mapa</button><button class="mbtn" data-wkf="${i}">Previsão</button></div></div>`; }).join("")}</div>
    <p class="rg-n">Nota de 0 a 10 calculada pelo sistema (não é previsão oficial). Coordenadas e orientação dos picos são aproximadas. Vento: Open-Meteo.</p>`;
}

/* ---------- renderização ---------- */
function render(){
  const mod = view(); if(mod!=="mar" && mod!=="vento") return;
  const body = $(`${mod}-body`); if(!body || !C.S.fc) return;
  if(X.key !== locKey()){ ensure(); return; }
  const all = evalAll(mod), sel = all.find(e=>e.sp.id===X.sel[mod]) || all[0], x = sel.xs[0];
  const isMar = mod==="mar";
  if(isMar && !X.mar){ body.innerHTML = head(mod) + `<div class="xf"><div class="dot" style="background:var(--warn)">!</div><div><b>Sem dados de mar para ${esc(X.loc.name)}</b><p>O modelo de ondas cobre o oceano e a costa. Busque uma cidade litorânea ou clique numa praia no mapa (botão direito → Previsão deste ponto).</p></div></div>`; wireHead(mod); return; }

  const kp = isMar ? (()=>{ const T = tides(), nx = T.slice(0,4), P = 0.49*(x.H||0)**2*(x.T||0);
    return [["Onda", r1(x.H), "m", `${r0(x.T)} s · de ${dirName(x.Hd)}`],["Swell", r1(x.sH), "m", `${r0(x.sT)} s · de ${dirName(x.sD)}`],
      ["Energia", r1(P), "kW/m", P>=15?"forte":P>=5?"boa":"fraca"],["Água", r1(x.sst), "°C", suit(x.sst)],
      ["Corrente", r1(x.cur), "km/h", (x.cur||0)>1.5?"forte":"fraca"],
      ["Maré", nx.length ? `${nx[0].hi?"▲":"▼"} ${fmtH(nx[0].t)}` : "—", "", nx.slice(1,3).map(t=>`${t.hi?"▲ alta":"▼ baixa"} ${fmtH(t.t)}`).join(" · ")],
      ["Vento", r0(kt(x.w)), "kt", `${dirName(x.d)} · ${relName(relW(x.d))}`]]; })()
    : [["Vento", r0(kt(x.w)), "kt", `${r0(x.w)} km/h · de ${dirName(x.d)}`],["Rajada", r0(kt(x.g)), "kt", `fator ${r1(x.g/Math.max(1,x.w))}×`],
      ["Na praia", r0(relW(x.d))+"°", "", relName(relW(x.d))],["80 m", r0(x.w80), "km/h", `120 m ${r0(x.w120)} km/h`],
      ["Térmicas", r0(x.blh), "m", "altura da camada limite"],["Beaufort", C.beaufort(x.w).match(/\d+/)?.[0] ?? "—", "", C.beaufort(x.w).split(" (")[0]]];

  body.innerHTML = head(mod) + `
    <div class="kpis sp-kpis">${kp.map(([l,v,u,s])=>`<div class="kpi"><small>${l}</small><b>${v}${u?`<em>${u}</em>`:""}</b>${s?`<span>${esc(s)}</span>`:""}</div>`).join("")}</div>

    <div class="sh"><h2>Esportes agora</h2><p>Toque num esporte para ver os 7 dias hora a hora. Nota: <i class="lg" style="background:${SCOL[3]}"></i>excelente <i class="lg" style="background:${SCOL[2]}"></i>bom <i class="lg" style="background:${SCOL[1]}"></i>limitado <i class="lg" style="background:${SCOL[0]}"></i>não.</p></div>
    <div class="sp-grid2">${all.map(E=>`<button class="sp-card glass${E===sel?" on":""}" data-sp="${E.sp.id}" style="--c:${SCOL[E.now.s]}">
      <div class="sp-ct"><span class="sp-ic">${E.sp.ic}</span><b>${esc(E.sp.nome)}</b><em>${SC[E.now.s]}</em></div>
      <p>${esc(E.now.why)}</p>${E.now.warn?`<p class="sp-warn">⚠ ${esc(E.now.warn)}</p>`:""}
      <div class="sp-cf"><span>${E.best ? `Melhor: <b>${winTxt(E, E.best.a, E.best.b)}</b>` : "Sem janela boa em 7 dias"}</span><span>${E.good} h boas${E.epic?` · ${E.epic} excelentes`:""}</span></div>
      <div class="sp-bar">${E.r.map(o=>`<i style="background:${SCOL[o.s]}"></i>`).join("")}</div></button>`).join("")}</div>

    ${isMar ? beachSec() + rankSec() : wRankSec()}
    <div class="sh"><h2>${sel.sp.ic} ${esc(sel.sp.nome)} · 7 dias</h2><p>${esc(sel.sp.tip)}</p></div>
    <div class="card glass heat-card">${heat(sel)}</div>

    <div class="sh"><h2>${isMar ? "Ondas, swell e maré" : "Vento por altura e rajadas"}</h2><p>${isMar ? "Altura de onda e swell (m), período (s) e nível do mar (maré astronômica + meteorológica)." : "Vento em 10, 80 e 120 m e rajadas (kt). Faixa sombreada: janela típica de kite/windsurf (12–30 kt)."}</p></div>
    <div class="card glass"><div class="cv" style="height:260px"><canvas id="spChart"></canvas></div></div>`;
  wireHead(mod);
  body.querySelectorAll("[data-trip]").forEach(b=>b.onclick=()=>{ const [n,la,lo] = b.dataset.trip.split("|"); window.Travel?.setDest({name:n, lat:+la, lon:+lo}); });
  if(!isMar){ loadWRank();
    body.querySelectorAll("[data-wk]").forEach(b=>b.onclick=()=>{ const x = X.wrank[+b.dataset.wk]; location.hash = "#sat";
      setTimeout(()=>{ const m = window.Sat?.map(); if(m) m.flyTo({center:[x.lon,x.lat], zoom:13, duration:2200}); }, 400); });
    body.querySelectorAll("[data-wkf]").forEach(b=>b.onclick=()=>{ const x = X.wrank[+b.dataset.wkf]; C.load({name:x.name, admin:x.where, country:"Brasil", lat:x.lat, lon:x.lon}); }); }
  if(isMar){ loadBeaches(); loadRank();
    body.querySelectorAll("[data-rk]").forEach(b=>b.onclick=()=>{ const x = X.rank[+b.dataset.rk]; location.hash = "#sat";
      setTimeout(()=>{ const m = window.Sat?.map(); if(m) m.flyTo({center:[x.lon,x.lat], zoom:14, duration:2200}); }, 400); });
    body.querySelectorAll("[data-rkf]").forEach(b=>b.onclick=()=>{ const x = X.rank[+b.dataset.rkf]; C.load({name:x.name, admin:x.where, country:"Brasil", lat:x.lat, lon:x.lon}); });
    body.querySelectorAll("[data-bm]").forEach(b=>b.onclick=()=>{ const x = X.beaches[+b.dataset.bm]; location.hash = "#sat";
      setTimeout(()=>{ const m = window.Sat?.map(); if(m) m.flyTo({center:[x.lon,x.lat], zoom:14, duration:1800}); }, 400); });
    body.querySelectorAll("[data-bf]").forEach(b=>b.onclick=()=>{ const x = X.beaches[+b.dataset.bf]; C.load({name:x.name, admin:"", country:"", lat:+x.lat.toFixed(4), lon:+x.lon.toFixed(4)}); }); }
  body.querySelectorAll("[data-sp]").forEach(b=>b.onclick=()=>{ X.sel[mod] = b.dataset.sp; store.set("sp-sel-"+mod, b.dataset.sp); render(); const E = evalAll(mod).find(e=>e.sp.id===b.dataset.sp); if(E) spModal(mod, E); });
  body.querySelector(".heat-card").onclick = e => { const c = e.target.closest("[data-hi]"); if(c) C.openHour(+c.dataset.hi); };
  chart(mod, sel);
}
/* ---------- modal avançado do esporte: veredito, condições agora, janelas por dia e as próximas 48 h ---------- */
function spModal(mod, E){
  const x = E.xs[0], isMar = mod === "mar", now = E.now;
  const sw = v => v == null ? "—" : v;
  // condições agora (mar + vento): o que pesa para este esporte
  const cond = [
    ["Vento", `${r0(kt(x.w))} kt`, `${r0(x.w)} km/h · de ${dirName(x.d)}`],
    ["Rajada", `${r0(kt(x.g))} kt`, `fator ${r1(x.g/Math.max(1,x.w))}× ${x.g/Math.max(1,x.w) > 1.6 ? "· irregular" : "· estável"}`],
    ["Na praia", relName(relW(x.d)).split(" (")[0], `${r0(relW(x.d))}° da orientação`],
    ...(X.mar ? [["Onda", `${sw(r1(x.H))} m`, `${sw(r0(x.T))} s · de ${dirName(x.Hd)}`], ["Swell", `${sw(r1(x.sH))} m`, `${sw(r0(x.sT))} s · de ${dirName(x.sD)}`],
      ["Mar de vento", `${sw(r1(x.wwH))} m`, "ondas locais (picado)"], ["Água", `${sw(r1(x.sst))} °C`, suit(x.sst)], ["Corrente", `${sw(r1(x.cur))} km/h`, (x.cur||0) > 1.5 ? "forte" : "fraca"]] : []),
    ...(!isMar ? [["80 m / 120 m", `${sw(r0(x.w80))} / ${sw(r0(x.w120))}`, "km/h em altitude"], ["Térmicas", `${sw(r0(x.blh))} m`, "camada limite"]] : []),
    ["Chuva", `${r1(x.rain)} mm`, `${r0(x.pp)}% de chance`], ["Visibilidade", x.vis != null ? (x.vis >= 10000 ? ">10 km" : `${r1(x.vis/1000)} km`) : "—", ""],
    ["Instabilidade", `CAPE ${r0(x.cape)}`, x.storm ? "⚠ risco de trovoada" : x.cape >= 500 ? "moderada" : "baixa"], ["Ar", `${r0(x.temp)} °C`, x.day ? "dia" : "noite"]];
  // por dia: melhor bloco, horas boas e nota média do dia
  const dias = []; E.xs.forEach((q, k) => { const d = q.t.slice(0, 10); let r = dias.find(o => o.d === d); if(!r){ r = {d, ks:[]}; dias.push(r); } r.ks.push(k); });
  const diaTxt = r => { const ks = r.ks, boas = ks.filter(k => E.r[k].s >= 2), top = Math.max(...ks.map(k => E.r[k].s));
    let a = -1, best = null; ks.forEach((k, i) => { if(E.r[k].s >= 2){ if(a < 0) a = i; } else if(a >= 0){ const n = i - a; if(!best || n > best.n) best = {a:ks[a], b:ks[i-1], n}; a = -1; } });
    if(a >= 0){ const n = ks.length - a; if(!best || n > best.n) best = {a:ks[a], b:ks[ks.length-1], n}; }
    const d0 = parseLocal(r.d + "T12:00");
    return `<div class="spm-day"><b>${r.d === E.xs[0].t.slice(0,10) ? "Hoje" : DOW[d0.getDay()] + " " + r.d.slice(8)}</b>
      <div class="spm-strip">${ks.map(k => `<i style="background:${SCOL[E.r[k].s]}${E.r[k].s === 0 ? ";opacity:.4" : ""}" title="${fmtH(E.xs[k].t)} · ${SC[E.r[k].s]} · ${esc(E.r[k].why)}"></i>`).join("")}</div>
      <span class="spm-dv" style="color:${SCOL[top]}">${SC[top]}</span><small>${best ? `${fmtH(E.xs[best.a].t)}–${String(+E.xs[best.b].t.slice(11,13)+1).padStart(2,"0")}:00 · ${boas.length} h boas` : "sem janela boa"}</small></div>`; };
  // próximas 48 h, de 3 em 3 h: nota + motivo + números-chave
  const linhas = E.xs.slice(0, 48).map((q, k) => [q, k]).filter(([q, k]) => k % 3 === 0).map(([q, k]) => `<tr>
      <td>${k ? `${DOW[parseLocal(q.t).getDay()]} ${fmtH(q.t)}` : "Agora"}</td><td><span class="spm-s" style="background:${SCOL[E.r[k].s]}">${SC[E.r[k].s]}</span></td>
      <td>${r0(kt(q.w))}/${r0(kt(q.g))} kt ${dirName(q.d)}</td>${X.mar ? `<td>${q.H != null ? `${r1(q.H)} m ${r0(q.T)} s` : "—"}</td>` : ""}
      <td class="spm-why">${esc(E.r[k].why)}${E.r[k].warn ? ` <em>⚠ ${esc(E.r[k].warn)}</em>` : ""}</td></tr>`).join("");
  C.openModal({icon:`<span class="pl-ic" style="background:${SCOL[now.s]}">${E.sp.ic}</span>`, title:esc(E.sp.nome), sub:`${esc(X.loc?.name || "")} · ${isMar ? "mar" : "vento"} · próximos 7 dias`,
    html:`<div class="spm-hero" style="--c:${SCOL[now.s]}"><div><small>Agora</small><b>${SC[now.s]}</b><p>${esc(now.why)}</p>${now.warn ? `<p class="spm-warn">⚠ ${esc(now.warn)}</p>` : ""}</div>
        <div><small>Melhor janela</small><b>${E.best ? winTxt(E, E.best.a, E.best.b) : "—"}</b><p>${E.good} h boas · ${E.epic} excelentes em 7 dias</p>
        ${E.next && (!E.best || E.next[0] !== E.best.a) ? `<p>Próxima janela: <b>${winTxt(E, E.next[0], E.next[1])}</b></p>` : ""}</div></div>
      <h4 class="msub">Condições agora</h4><div class="spm-k">${cond.map(([l, v, s]) => `<div><small>${l}</small><b>${v}</b>${s ? `<span>${esc(s)}</span>` : ""}</div>`).join("")}</div>
      <h4 class="msub">Dia a dia</h4><div class="spm-days">${dias.map(diaTxt).join("")}</div>
      <h4 class="msub">Próximas 48 h (a cada 3 h)</h4><div class="spm-tw"><table class="spm-t"><thead><tr><th>Hora</th><th>Nota</th><th>Vento/rajada</th>${X.mar ? "<th>Onda</th>" : ""}<th>Por quê</th></tr></thead><tbody>${linhas}</tbody></table></div>
      <p class="spm-src">Nota hora a hora a partir da previsão (Open-Meteo: vento, rajadas, chuva, CAPE${X.mar ? ", ondas, swell, maré, corrente e água" : ", vento a 80/120 m e camada limite"}). ${isMar ? "Orientação da praia" : "Relação com a praia"}: ${face()}°. Não substitui a avaliação no local.</p>`,
    actions:[...(E.best ? [{label:"⏱ Ver a melhor janela", fn:() => { C.closeModal(); C.openHour(E.i0 + E.best.a); }}] : []), {label:"Fechar", primary:true, fn:() => C.closeModal()}]});
}

function beachSec(){
  const B = X.beaches;
  const h = `<div class="sh"><h2>Praias da região · 100 km</h2><p>Condição do mar agora em cada praia, com a orientação de cada uma calculada pela posição do mar. Ordenadas pela distância.</p></div>`;
  if(B === undefined || X.bKey !== locKey()) return h + `<div class="xload">Buscando praias num raio de 100 km…</div>`;
  if(B === null) return h + `<div class="xload">Não foi possível buscar as praias agora (OpenStreetMap). Tente atualizar.</div>`;
  if(!B.length) return h + `<div class="xload">Nenhuma praia encontrada num raio de 100 km.</div>`;
  const best = B.map((b,i)=>({i, r:beachRate(b)})).sort((a,b)=>b.r.surf-a.r.surf)[0];
  return h + `${best && best.r.surf>=2 ? `<p class="bh-best">🏄 Melhor para surf agora: <b>${esc(B[best.i].name)}</b> (${r0(B[best.i].km)} km) — ${r1(B[best.i].m.wave_height)} m / ${r0(B[best.i].m.wave_period)} s.</p>` : ""}
    <div class="bh-list">${B.map((b,i)=>{ const r = beachRate(b);
      return `<div class="bh glass" style="--c:${SCOL[r.label[1]]}"><div class="bh-h"><b>${esc(b.name)}</b><small>${r0(b.km)} km · voltada para ${dirName(r.f)}</small></div>
        <em class="bh-st">${r.label[0]}</em>
        <div class="bh-k"><span>🌊 ${r1(b.m.wave_height)} m · ${r0(b.m.wave_period)} s ${dirName(b.m.wave_direction)}${r.on?"":" (não entra)"}</span>
          <span>💨 ${b.w ? `${r0(r.wk)} kt ${relName(r.wr).split(" ")[0]}` : "—"}</span><span>🌡 ${r1(b.m.sea_surface_temperature)}°C</span></div>
        <div class="bh-a"><button class="mbtn" data-bm="${i}">Ver no mapa</button><button class="mbtn" data-bf="${i}">Previsão</button></div></div>`; }).join("")}</div>
    <p class="rg-n">Praias: OpenStreetMap (Nominatim) · ondas e vento: Open-Meteo. Orientação estimada pelo ponto de mar mais próximo.</p>`;
}
function head(mod){
  const f = face(), isMar = mod==="mar";
  return `<div class="xhead glass"><div class="xid">
    <div class="ava ava-${mod}" aria-hidden="true">${isMar ? `<svg viewBox="0 0 32 32"><path d="M3 20c3-3 5-3 8 0s5 3 8 0 5-3 8 0M3 26c3-3 5-3 8 0s5 3 8 0 5-3 8 0M9 15c0-5 4-9 9-9-2 2-3 5-2 8"/></svg>` : `<svg viewBox="0 0 32 32"><path d="M3 11h17a4 4 0 1 0-4-4M3 17h23a4 4 0 1 1-4 4M3 23h11"/></svg>`}</div>
    <div><h2>${isMar ? "MAR" : "VENTO"}</h2><div class="cargo">${isMar ? "Ondas, maré e esportes aquáticos" : "Vento e esportes aéreos e aquáticos"} · ${esc(X.loc.name)}</div>
      <p class="bio">${isMar ? "Swell, período, energia, maré, corrente e temperatura da água viram nota hora a hora para cada esporte." : "Vento em três alturas, rajadas, terral/maral e térmicas viram nota hora a hora para cada esporte."}</p></div>
    <label class="xpick" title="Para onde a praia está voltada (onde fica o mar). Define terral, maral e lateral.">Praia voltada para <select id="spFace">${DIRS8.map(([n,d])=>`<option value="${d}"${d===f?" selected":""}>${n}</option>`).join("")}</select></label>
  </div></div>`;
}
function wireHead(){ const s = $("spFace"); if(s) s.onchange = ()=>{ store.set("sp-face-"+locKey(), +s.value); render(); window.Home?.refresh("sports"); }; }

function heat(E){
  const h = C.S.fc.hourly, days = [];
  E.xs.forEach((x,k)=>{ const d = x.t.slice(0,10); let row = days.find(r=>r.d===d); if(!row){ row = {d, c:new Array(24).fill(null)}; days.push(row); } row.c[+x.t.slice(11,13)] = k; });
  const hd = `<div class="hm-row hm-h"><span></span>${Array.from({length:24},(_,i)=>`<span>${i%3?"":i}</span>`).join("")}</div>`;
  return `<div class="hm">${hd}${days.map((r,j)=>`<div class="hm-row"><span class="hm-d">${j?`${DOW[parseLocal(r.d+"T12:00").getDay()]} ${r.d.slice(8)}`:"Hoje"}</span>${r.c.map(k=>k==null ? `<i class="hm-x"></i>`
    : `<i data-hi="${E.i0+k}" class="${k===0?"hm-now":""}" style="background:${SCOL[E.r[k].s]}${E.r[k].s===0?";opacity:.45":""}" title="${DOW[parseLocal(E.xs[k].t).getDay()]} ${fmtH(E.xs[k].t)} · ${SC[E.r[k].s]} · ${esc(E.r[k].why)}${E.r[k].warn?" · ⚠ "+esc(E.r[k].warn):""}"></i>`).join("")}</div>`).join("")}</div>`;
}

function chart(mod, E){
  const L = E.xs.map(x=>x.t), grid = css("--grid"), ink3 = css("--ink-3");
  const base = {responsive:true, maintainAspectRatio:false, animation:false, interaction:{mode:"index", intersect:false},
    plugins:{legend:{display:true, position:"bottom", labels:{color:css("--ink-2"), usePointStyle:true, boxWidth:7, boxHeight:7, font:{family:FONT,size:11}, filter:it=>!it.text.startsWith("_")}},
      tooltip:{filter:it=>!it.dataset.label.startsWith("_"), callbacks:{title:it=>{ const t = L[it[0].dataIndex]; return `${DOW[parseLocal(t).getDay()]} ${fmtH(t)}`; }}}},
    scales:{x:{grid:{color:grid}, ticks:{color:ink3, autoSkip:false, maxRotation:0, font:{family:FONT,size:10}, callback:v=>{ const t = L[v]; return t && t.slice(11,13)==="00" ? `${DOW[parseLocal(t).getDay()]} ${t.slice(8,10)}` : null; }}},
      y:{grid:{color:grid}, beginAtZero:true, ticks:{color:ink3, font:{family:FONT,size:10}}}}};
  const ln = (label, data, color, o={}) => ({type:"line", label, data, borderColor:color, backgroundColor:color, borderWidth:2, pointRadius:0, tension:.35, ...o});
  if(mod==="mar"){
    base.scales.y.title = {display:true, text:"m", color:ink3};
    base.scales.y2 = {position:"right", grid:{display:false}, ticks:{color:ink3, font:{family:FONT,size:10}}, title:{display:true, text:"s", color:ink3}};
    base.scales.y3 = {display:false};
    mk("spChart", {type:"line", data:{labels:L, datasets:[
      ln("onda (m)", E.xs.map(x=>x.H), css("--rain"), {fill:true, backgroundColor:css("--rain")+"30"}),
      ln("swell (m)", E.xs.map(x=>x.sH), "#7FD6FF", {borderDash:[5,3]}),
      ln("período (s)", E.xs.map(x=>x.T), css("--warn"), {yAxisID:"y2", borderWidth:1.4}),
      ln("maré (m)", E.xs.map(x=>x.tide), "#B08CFF", {yAxisID:"y3", borderWidth:1.6})]}, options:base});
  } else {
    base.scales.y.title = {display:true, text:"kt", color:ink3};
    mk("spChart", {type:"line", data:{labels:L, datasets:[
      ln("_hi", L.map(()=>30), "transparent", {fill:"+1", backgroundColor:"rgba(25,180,255,.10)", borderWidth:0}),
      ln("_lo", L.map(()=>12), "transparent", {borderWidth:0}),
      ln("10 m", E.xs.map(x=>kt(x.w)), css("--ink")),
      ln("rajada", E.xs.map(x=>kt(x.g)), css("--danger"), {borderDash:[4,3], borderWidth:1.4}),
      ln("80 m", E.xs.map(x=>x.w80==null?null:kt(x.w80)), "#5FD3FF", {borderWidth:1.4}),
      ln("120 m", E.xs.map(x=>x.w120==null?null:kt(x.w120)), "#B08CFF", {borderWidth:1.2})]}, options:base});
  }
}

/* ---------- resumo para o widget ---------- */
function summary(mod){
  if(!C.S.fc || X.key !== locKey()){ if(X.loc && !X.busy) ensure(); return null; }
  if(mod==="mar" && !X.mar) return {none:true};
  return evalAll(mod).map(E=>({ic:E.sp.ic, nome:E.sp.nome, s:E.now.s, best:E.best ? winTxt(E, E.best.a, E.best.b) : null}));
}
window.Sports = {loadWRank, wrank: () => X.wrank, wLabel, loadRank, rank: () => X.rank, qLabel, setLoc, render, summary, SC, SCOL};
})();
