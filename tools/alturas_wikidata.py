#!/usr/bin/env python3
"""Alturas de prédios pelo Wikidata (CC0) para cidades fora da cobertura do Google 2.5D (ex.: Dubai).

Busca no Wikidata todo item com coordenada dentro da área e altura (P2048) ou andares (P1101),
encaixa cada um na pegada do Overture que o contém (ou a maior a até 45 m) e grava
public/data-heights/<cidade>.geojson + index.json — o mesmo formato de tools/alturas.py.
Também corrige prédios que o Overture tem MAIS BAIXOS que o Wikidata.

Uso: venv/bin/python tools/alturas_wikidata.py dubai "55.12,25.05,55.36,25.28"
"""
import json, math, sys, urllib.error, urllib.parse, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import alturas as A

def adiado(city, bb):
    """Com tools/.wd_adiar presente (Wikidata em espera), não consulta: guarda a cidade em tools/cidades_wd_capitais.txt."""
    flag = A.ROOT / "tools" / ".wd_adiar"
    if not flag.exists():
        return False
    lst = A.ROOT / "tools" / "cidades_wd_capitais.txt"
    linhas = lst.read_text().splitlines() if lst.exists() else ["# pendentes do Wikidata (torres) — rodar depois: alturas_wikidata.py <nome> <bbox>"]
    if not any(l.split()[0] == city for l in linhas if l and not l.startswith("#")):
        linhas.append(f"{city} {','.join(f'{v:.4f}' for v in bb)}")
        lst.write_text("\n".join(linhas) + "\n")
    print("  Wikidata em espera: guardada em tools/cidades_wd_capitais.txt")
    return True


def wikidata(bb):
    q = f"""SELECT ?item ?label ?coord ?h ?f WHERE {{
      SERVICE wikibase:box {{ ?item wdt:P625 ?coord .
        bd:serviceParam wikibase:cornerWest "Point({bb[0]} {bb[1]})"^^geo:wktLiteral .
        bd:serviceParam wikibase:cornerEast "Point({bb[2]} {bb[3]})"^^geo:wktLiteral . }}
      OPTIONAL {{ ?item p:P2048/psn:P2048/wikibase:quantityAmount ?h . }}
      OPTIONAL {{ ?item wdt:P1101 ?f . }}
      FILTER(BOUND(?h) || BOUND(?f))
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "pt,en". ?item rdfs:label ?label. }} }}"""
    url = "https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(q)
    req = urllib.request.Request(url, headers={"User-Agent": "GPlanSiS-Clima/1.0 (clima.gplansis.com)", "Accept": "application/sparql-results+json"})
    import time, fcntl
    # o Wikidata limita a 1 consulta/min: vários processos (capitais em paralelo) fazem fila por uma trava em
    # arquivo, com 62 s entre consultas; 429/5xx espera e tenta de novo por até ~40 min
    lock = A.OUT / ".wikidata.lock"
    for n in range(32):
        with open(lock, "a+") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            lk.seek(0); last = float(lk.read().strip() or 0)
            time.sleep(max(0, last + 62 - time.time()))
            try:
                rows = json.load(urllib.request.urlopen(req, timeout=120))["results"]["bindings"]; err = None
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
                err = e
            lk.seek(0); lk.truncate(); lk.write(str(time.time()))
        if err is None: break
        if n == 31 or (isinstance(err, urllib.error.HTTPError) and err.code not in (429, 500, 502, 503, 504)): raise err
        time.sleep(15)
    out = {}
    for r in rows:
        lon, lat = map(float, r["coord"]["value"][6:-1].split())
        h = float(r["h"]["value"]) if "h" in r else None
        f = float(r["f"]["value"]) if "f" in r else None
        hh = h if h and 8 < h < 900 else (f * 3.6 + 4 if f and 3 <= f < 200 else None)
        if not hh: continue
        k = r["item"]["value"]
        if k not in out or hh > out[k][2]: out[k] = (lon, lat, hh, r.get("label", {}).get("value", ""))
    return list(out.values())

def all_buildings(bb):
    """Todas as pegadas do Overture (com ou sem altura): [(id, ring, altura|None, area_m2)]."""
    import gzip, mapbox_vector_tile
    from pmtiles.reader import Reader
    rd = Reader(lambda off, ln: A.get(A.OVERTURE, (off, ln)))
    n = 2 ** 14; tx = lambda lo: int((lo + 180) / 360 * n); ty = lambda la: int((1 - math.asinh(math.tan(math.radians(la))) / math.pi) / 2 * n)
    out, seen = [], set()
    for x in range(tx(bb[0]), tx(bb[2]) + 1):
        for y in range(ty(bb[3]), ty(bb[1]) + 1):
            d = rd.get(14, x, y)
            if not d: continue
            if d[:2] == b"\x1f\x8b": d = gzip.decompress(d)
            L = mapbox_vector_tile.decode(d, default_options={"y_coord_down": True}).get("building")
            if not L: continue
            ext = L.get("extent", 4096)
            for f in L["features"]:
                p = f["properties"]; fid = p.get("id")
                if fid in seen or p.get("is_underground") or p.get("has_parts"): continue
                g = f["geometry"]; polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"] if g["type"] == "MultiPolygon" else []
                if not polys: continue
                ring = [[(x + px / ext) / n * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + py / ext) / n))))] for px, py in polys[0][0]]
                if len(ring) < 4: continue
                seen.add(fid)
                kx = 111320 * math.cos(math.radians(ring[0][1]))
                area = abs(sum((a[0] * b[1] - b[0] * a[1]) for a, b in zip(ring, ring[1:] + ring[:1]))) / 2 * kx * 110574
                h = p.get("height") if p.get("height") is not None else (p["num_floors"] * 3.2 if p.get("num_floors") is not None else None)
                out.append((fid, ring, h, area))
    return out

def inside(pt, ring):
    x, y, c = pt[0], pt[1], False
    for (xa, ya), (xb, yb) in zip(ring, ring[1:] + ring[:1]):
        if (ya > y) != (yb > y) and x < xa + (y - ya) * (xb - xa) / (yb - ya): c = not c
    return c

def main():
    city, bb = sys.argv[1], [float(v) for v in sys.argv[2].split(",")]
    if adiado(city, bb):
        return
    wd = wikidata(bb); print(f"{city}: {len(wd)} itens com altura/andares no Wikidata")
    bl = all_buildings(bb); print(f"  {len(bl)} prédios no Overture, {sum(1 for b in bl if b[2] is None)} sem altura")
    # índice espacial simples (células de ~100 m)
    G = 1000; grid = {}
    for i, (fid, ring, h, area) in enumerate(bl):
        cx, cy = sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)
        grid.setdefault((int(cx * G), int(cy * G)), []).append(i)
    res = {}
    for lon, lat, hh, label in wd:
        cand = [i for a in (-1, 0, 1) for b in (-1, 0, 1) for i in grid.get((int(lon * G) + a, int(lat * G) + b), [])]
        best = next((i for i in cand if inside((lon, lat), bl[i][1])), None)
        if best is None:   # ponto fora da pegada: o maior prédio a até 45 m
            kx = 111320 * math.cos(math.radians(lat)); bd = 45
            for i in cand:
                ring = bl[i][1]; cx, cy = sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)
                d = math.hypot((cx - lon) * kx, (cy - lat) * 110574)
                if d < bd and bl[i][3] > 300: bd, best = d, i
        if best is None: continue
        fid, ring, h, area = bl[best]
        if h is not None and h >= hh * .85: continue           # Overture já tem altura parecida
        if fid not in res or hh > res[fid][0]: res[fid] = (hh, ring)
    feats = [{"type": "Feature", "properties": {"id": fid, "height": round(h, 1), "part": False},
              "geometry": {"type": "Polygon", "coordinates": [[[round(x, 6), round(y, 6)] for x, y in ring]]}} for fid, (h, ring) in res.items()]
    out = A.OUT / f"{city}.geojson"; A.OUT.mkdir(exist_ok=True)
    out.write_text(json.dumps({"type": "FeatureCollection", "bbox": bb, "source": "Wikidata (CC0)", "features": feats}, separators=(",", ":")))
    A.indice(city, {"bbox": bb, "n": len(feats)})
    hs = sorted(f["properties"]["height"] for f in feats)
    print(f"  {len(feats)} prédios corrigidos; >100 m: {sum(h > 100 for h in hs)}, >200 m: {sum(h > 200 for h in hs)}, máx {hs[-1] if hs else 0} m; {out.stat().st_size // 1024} KB")

if __name__ == "__main__":
    main()
