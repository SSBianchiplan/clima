/* Propagação SGP4 da constelação Starlink fora da thread principal.
   Recebe o texto TLE uma vez; a cada "tick" devolve lon/lat (Float32Array),
   quem está acima de 25° do observador (Uint8Array) e a lista dos mais altos. */
importScripts("vendor/satellite.min.js");
let sats = [];
onmessage = ({data:m}) => {
  if(m.type === "tle"){
    const L = m.text.split(/\r?\n/); sats = [];
    for(let i=0;i+2<L.length;i++){
      if(L[i+1].startsWith("1 ") && L[i+2].startsWith("2 ")){
        try{ sats.push({name:L[i].trim(), rec:satellite.twoline2satrec(L[i+1], L[i+2])}); }catch(e){}
        i += 2;
      }
    }
    postMessage({type:"ready", n:sats.length});
    return;
  }
  if(m.type === "tick"){
    const now = new Date(m.t || Date.now()), gmst = satellite.gstime(now), n = sats.length;
    const lon = new Float32Array(n), lat = new Float32Array(n), up = new Uint8Array(n);
    const o = m.obs, obs = o ? {longitude:o.lon*Math.PI/180, latitude:o.lat*Math.PI/180, height:0} : null;
    const over = [];
    for(let i=0;i<n;i++){
      const s = sats[i], pv = satellite.propagate(s.rec, now);
      if(!pv || !pv.position){ lon[i] = NaN; continue; }
      const gd = satellite.eciToGeodetic(pv.position, gmst);
      lat[i] = gd.latitude*180/Math.PI; lon[i] = satellite.degreesLong(gd.longitude);
      if(obs && Math.abs(lat[i]-o.lat) < 25){
        const la = satellite.ecfToLookAngles(obs, satellite.eciToEcf(pv.position, gmst)), el = la.elevation*180/Math.PI;
        if(el >= 25){ up[i] = 1; over.push({name:s.name, el, az:la.azimuth*180/Math.PI, h:gd.height}); }
      }
    }
    over.sort((a,b)=>b.el-a.el);
    postMessage({type:"pos", lon, lat, up, over:over.slice(0,6), nOver:over.length, total:n}, [lon.buffer, lat.buffer, up.buffer]);
  }
};
