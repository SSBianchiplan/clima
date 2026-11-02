// Service worker
// · casca do app: rede primeiro, cache como reserva (abre offline);
// · tiles de mapa/satélite/relevo: cache primeiro — a URL já carrega data/hora
//   ou é imagem estática, então o que está no cache vale e evita baixar de novo.
// Dados meteorológicos (Open-Meteo) nunca vão para o cache.
const V = "clima-v225", TILES = "clima-tiles-v1", MAXT = 20000;   // ~400 MB de imagens: lugares já visitados abrem sem rede
const SHELL = ["/", "/index.html", "/app.css", "/app.js", "/experts.js", "/lab.js", "/sat.js", "/home.js", "/menu.js", "/timeline.js", "/places.js", "/flightsim.js", "/webcams.js", "/geo.js", "/fires.js", "/data-volcanoes.json", "/data-temples.json", "/data-webcams.json", "/data-airports.json", "/data-landmarks.json", "/pred.js", "/sports.js", "/travel.js", "/routes.js", "/icons.js", "/bridges3d.js", "/joy.js", "/drive.js", "/drone.js", "/roofs3d.js", "/meteo.js", "/gps.js", "/layout.js", "/boot.js", "/data-rodoviarias.json", "/wind3d.js", "/starlink-worker.js", "/theme.js", "/icon.svg", "/manifest.webmanifest",
  "/vendor/chart.umd.min.js", "/vendor/maplibre-gl.js", "/vendor/maplibre-gl.css", "/vendor/maplibre-contour.min.js", "/vendor/pmtiles.js", "/vendor/satellite.min.js", "/icons/icon-192.png", "/icons/apple-touch-icon.png"];
const TILE_HOSTS = new Set(["gibs.earthdata.nasa.gov", "server.arcgisonline.com", "elevation-tiles-prod.s3.amazonaws.com", "tiles.openfreemap.org"]);
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== TILES && k !== "clima-dem0-dem4" && k !== "clima-api").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
let puts = 0;
async function trim(c){ const ks = await c.keys(); for(let i=0; i < ks.length - MAXT; i++) await c.delete(ks[i]); }
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (TILE_HOSTS.has(u.hostname)) {
    // índices que mudam (hora mais recente, "default", tilejson) seguem pela rede
    if (u.pathname.endsWith(".xml") || u.pathname.includes("/default/default/") || u.pathname === "/planet") return;
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(e.request); if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) { c.put(e.request, r.clone()); if (++puts % 200 === 0) trim(c); }
      return r;
    }));
    return;
  }
  if (u.origin !== location.origin || u.pathname.startsWith("/data/")) return;
  // proxies com dados ao vivo (aviões, trânsito, rotas): sempre pela rede, nunca no cache do app
  if (/^\/(tt|adsb|adsbdb|opensky)\//.test(u.pathname)) return;
  e.respondWith(fetch(e.request).then(r => {
    const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); return r;
  }).catch(() => caches.match(e.request)));
});
