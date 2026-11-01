#!/usr/bin/env python3
"""Alturas de prédios para cidades sem altura no Overture.

Fonte: Google Open Buildings 2.5D Temporal (CC BY 4.0), altura estimada por satélite
(Sentinel-2), grade de 0,5 m, Sul Global. Teto prático ~99 m: torres acima disso são
corrigidas pela lista de arranha-céus do Wikidata (public/data-landmarks.json).

Para cada prédio do Overture SEM altura dentro da área, mede a altura dentro da
pegada (percentil 90 dos pixels) e grava public/data-heights/<cidade>.geojson
com {id, height} + o polígono. O mapa carrega o arquivo só quando a cidade está na tela.

Os GeoTIFFs do Google (200–570 MB cada) NÃO são baixados: são lidos direto da nuvem (Google Cloud
Storage) por partes, com HTTP Range — só os blocos 512×512 da banda de altura que ficam sob os prédios
da área, em paralelo, na memória. Nada é gravado em disco além do resultado.

Uso: venv/bin/python tools/alturas.py bc "-48.68,-27.06,-48.58,-26.94"
"""
import gzip, io, json, math, os, sys, urllib.request
from pathlib import Path
import numpy as np, pyproj, tifffile, zarr
import mapbox_vector_tile
from pmtiles.reader import Reader

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data-heights"
BUCKET = "https://storage.googleapis.com/open-buildings-temporal-data"
API = "https://storage.googleapis.com/storage/v1/b/open-buildings-temporal-data/o"
OVERTURE = "https://tiles.overturemaps.org/2026-09-23.0/buildings.pmtiles"
YEAR = "2023_06_30"
MIN_H = 10   # casas baixas já aparecem baixas; o arquivo leva só os prédios de verdade


def get(url, rng=None, tries=6):
    """GET com novas tentativas (conexão cai em downloads longos)."""
    import time
    for n in range(tries):
        try:
            return _get(url, rng)
        except Exception:
            if n == tries - 1:
                raise
            time.sleep(5 * (n + 1))


def _get(url, rng=None):
    h = {"User-Agent": "Mozilla/5.0 (GPlanSiS Clima; alturas)"}
    if rng:
        h["Range"] = f"bytes={rng[0]}-{rng[0] + rng[1] - 1}"
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


class Remoto(io.RawIOBase):
    """Arquivo na nuvem lido por partes (HTTP Range), em blocos de 256 KB guardados só na memória."""
    B = 1 << 18

    def __init__(self, url):
        self.url, self.p, self.blk = url, 0, {}
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0 (GPlanSiS Clima; alturas)"})
        self.size = int(urllib.request.urlopen(req, timeout=60).headers["Content-Length"])

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.p

    def seek(self, o, w=0):
        self.p = o if w == 0 else self.p + o if w == 1 else self.size + o
        return self.p

    def _bloco(self, i):
        if i not in self.blk:
            self.blk[i] = get(self.url, (i * self.B, min(self.B, self.size - i * self.B)))
        return self.blk[i]

    def readinto(self, b):
        n = min(len(b), self.size - self.p)
        if n <= 0:
            return 0
        feito = 0
        while feito < n:
            pos = self.p + feito
            i = pos // self.B
            bl = self._bloco(i)
            o = pos - i * self.B
            k = min(n - feito, len(bl) - o)
            b[feito:feito + k] = bl[o:o + k]
            feito += k
        self.p += n
        return n

    def adiantar(self, trechos, conexoes=16):
        """Busca em paralelo os blocos que cobrem os trechos [(início, tamanho)] ainda não lidos."""
        from concurrent.futures import ThreadPoolExecutor
        falta = sorted({i for ini, tam in trechos for i in range(ini // self.B, (ini + tam - 1) // self.B + 1)} - set(self.blk))
        with ThreadPoolExecutor(conexoes) as ex:
            for i, d in zip(falta, ex.map(lambda i: get(self.url, (i * self.B, min(self.B, self.size - i * self.B))), falta)):
                self.blk[i] = d
        return len(falta) * self.B


def janelas(a, epsg, blds, res):
    """Janela de pixels (r0, r1, c0, c1) de cada prédio ainda sem altura, no sistema do GeoTIFF."""
    tr = pyproj.Transformer.from_crs(4326, epsg, always_xy=True)
    sx, sy, x0, y0 = a["scaleX"], a["scaleY"], a["translateX"], a["translateY"]
    for fid, ly, ring in blds:
        if fid in res:
            continue
        xs, ys = tr.transform([p[0] for p in ring], [p[1] for p in ring])
        cs = [(x - x0) / sx for x in xs]
        rs = [(y - y0) / sy for y in ys]
        yield fid, ly, ring, cs, rs, int(min(rs)), int(max(rs)) + 1, int(min(cs)), int(max(cs)) + 1


def adiantar_altura(rf, tf, a, epsg, blds, res):
    """Só os blocos da banda de altura (banda 1) que ficam sob os prédios da área."""
    pg = tf.pages[0]
    H, W, tw, th = pg.imagelength, pg.imagewidth, pg.tilewidth, pg.tilelength
    nx, ny = -(-W // tw), -(-H // th)
    offs, cnts = pg.dataoffsets, pg.databytecounts
    banda = nx * ny if len(offs) >= 3 * nx * ny else None   # planar separado: blocos da banda 1 vêm depois dos da banda 0
    if banda is None:
        return 0
    need = set()
    for *_, r0, r1, c0, c1 in janelas(a, epsg, blds, res):
        if r1 < 0 or c1 < 0 or r0 >= H or c0 >= W or (c1 - c0) * (r1 - r0) > 400 * 400:
            continue
        for ty in range(max(0, r0) // th, (min(H, r1) - 1) // th + 1):
            for tx in range(max(0, c0) // tw, (min(W, c1) - 1) // tw + 1):
                need.add(banda + ty * nx + tx)
    return rf.adiantar([(offs[i], cnts[i]) for i in sorted(need) if cnts[i]])


def utm_epsg(lon, lat):
    return (32600 if lat >= 0 else 32700) + int((lon + 180) // 6) + 1


def tiles_for(bbox):
    """Arquivos GeoTIFF que cobrem a área: [(url, transform, epsg)]."""
    lon0, lat0, lon1, lat1 = bbox
    epsg = utm_epsg((lon0 + lon1) / 2, (lat0 + lat1) / 2)
    tr = pyproj.Transformer.from_crs(4326, epsg, always_xy=True)
    xs, ys = zip(*[tr.transform(lo, la) for lo in (lon0, lon1) for la in (lat0, lat1)])
    names = json.loads(get(f"{API}?prefix=v1/manifests/&matchGlob=**EPSG_{epsg}_{YEAR}*"))
    out = []
    for it in names.get("items", []):
        man = json.loads(get(f"{BUCKET}/{it['name']}"))
        pre = man["uriPrefix"].replace("gs://open-buildings-temporal-data", BUCKET)
        for s in man["tilesets"][0]["sources"]:
            a, d = s["affineTransform"], s["dimensions"]
            x0, y1 = a["translateX"], a["translateY"]
            x1, y0 = x0 + d["width"] * a["scaleX"], y1 + d["height"] * a["scaleY"]
            if x0 < max(xs) and x1 > min(xs) and y0 < max(ys) and y1 > min(ys):
                out.append((pre + s["uris"][0], a, epsg))
    # o mesmo arquivo aparece em mais de um manifesto
    return list({u: (u, a, e) for u, a, e in out}.values())


def overture_buildings(bbox):
    """Prédios do Overture (z14) sem altura dentro da área: [(id, [[lon,lat],...])]."""
    rd = Reader(lambda off, ln: get(OVERTURE, (off, ln)))
    lon0, lat0, lon1, lat1 = bbox
    n = 2 ** 14
    tx = lambda lo: int((lo + 180) / 360 * n)
    ty = lambda la: int((1 - math.asinh(math.tan(math.radians(la))) / math.pi) / 2 * n)
    out, seen, total = [], set(), 0
    for x in range(tx(lon0), tx(lon1) + 1):
        for y in range(ty(lat1), ty(lat0) + 1):
            data = rd.get(14, x, y)
            if not data:
                continue
            if data[:2] == b"\x1f\x8b":
                data = gzip.decompress(data)
            layers = mapbox_vector_tile.decode(data, default_options={"y_coord_down": True})
            for ly in ("building", "building_part"):
                L = layers.get(ly)
                if not L:
                    continue
                ext = L.get("extent", 4096)
                for f in L["features"]:
                    p = f["properties"]
                    if ly == "building":
                        total += 1
                    if p.get("height") is not None or p.get("num_floors") is not None or p.get("is_underground"):
                        continue
                    if ly == "building" and p.get("has_parts"):
                        continue
                    fid = p.get("id")
                    g = f["geometry"]
                    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"] if g["type"] == "MultiPolygon" else []
                    for poly in polys[:1]:
                        ring = [[(x + px / ext) / n * 360 - 180,
                                 math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + py / ext) / n))))] for px, py in poly[0]]
                        if fid in seen or len(ring) < 4:
                            continue
                        seen.add(fid)
                        out.append((fid, ly, ring))
    return out, total


class Banda:
    """Banda de altura (1) lida bloco a bloco: cada bloco 512×512 é descomprimido UMA vez e reaproveitado por
    todos os prédios que caem nele (antes cada prédio descomprimia o bloco de novo — 97% do tempo)."""

    def __init__(self, tf, banda=1, guardar=900):
        pg = tf.pages[0]
        self.pg, self.fh, self.b, self.max = pg, tf.filehandle, banda, guardar
        self.H, self.W, self.tw, self.th = pg.imagelength, pg.imagewidth, pg.tilewidth, pg.tilelength
        self.nx, self.ny = -(-self.W // self.tw), -(-self.H // self.th)
        self.cache = {}

    def bloco(self, ty, tx):
        i = self.b * self.nx * self.ny + ty * self.nx + tx
        if i not in self.cache:
            off, n = self.pg.dataoffsets[i], self.pg.databytecounts[i]
            if not n:
                a = np.zeros((self.th, self.tw), np.float32)
            else:
                self.fh.seek(off)
                seg = self.pg.decode(self.fh.read(n), i)[0]
                a = np.asarray(seg, dtype=np.float32).reshape(self.th, self.tw)
            if len(self.cache) >= self.max:
                self.cache.pop(next(iter(self.cache)))
            self.cache[i] = a
        return self.cache[i]

    def janela(self, r0, r1, c0, c1):
        out = np.empty((r1 - r0, c1 - c0), np.float32)
        for ty in range(r0 // self.th, (r1 - 1) // self.th + 1):
            for tx in range(c0 // self.tw, (c1 - 1) // self.tw + 1):
                b = self.bloco(ty, tx)
                ya, yb = max(r0, ty * self.th), min(r1, (ty + 1) * self.th)
                xa, xb = max(c0, tx * self.tw), min(c1, (tx + 1) * self.tw)
                out[ya - r0:yb - r0, xa - c0:xb - c0] = b[ya - ty * self.th:yb - ty * self.th, xa - tx * self.tw:xb - tx * self.tw]
        return out


def raster_heights(tf, a, epsg, blds, res):
    """Percentil 90 da altura dentro de cada pegada (pixels do prédio com altura > 0)."""
    tr = pyproj.Transformer.from_crs(4326, epsg, always_xy=True)
    band = Banda(tf)
    H, W = band.H, band.W
    sx, sy, x0, y0 = a["scaleX"], a["scaleY"], a["translateX"], a["translateY"]
    for fid, ly, ring in blds:
        if fid in res:
            continue
        xs, ys = tr.transform([p[0] for p in ring], [p[1] for p in ring])
        cs = [(x - x0) / sx for x in xs]
        rs = [(y - y0) / sy for y in ys]
        c0, c1, r0, r1 = int(min(cs)), int(max(cs)) + 1, int(min(rs)), int(max(rs)) + 1
        if c1 < 0 or r1 < 0 or c0 >= W or r0 >= H or (c1 - c0) * (r1 - r0) > 400 * 400:
            continue
        c0, r0, c1, r1 = max(0, c0), max(0, r0), min(W, c1), min(H, r1)
        if c1 <= c0 or r1 <= r0:
            continue
        win = band.janela(r0, r1, c0, c1)
        # pixels cujo centro cai dentro do polígono (regra par-ímpar por linha)
        mask = np.zeros(win.shape, bool)
        poly = list(zip([c - c0 for c in cs], [r - r0 for r in rs]))
        for i in range(win.shape[0]):
            yc, xs_ = i + .5, []
            for (xa, ya), (xb, yb) in zip(poly, poly[1:] + poly[:1]):
                if (ya > yc) != (yb > yc):
                    xs_.append(xa + (yc - ya) * (xb - xa) / (yb - ya))
            xs_.sort()
            for k in range(0, len(xs_) - 1, 2):
                a_, b_ = max(0, int(math.ceil(xs_[k] - .5))), min(win.shape[1] - 1, int(math.floor(xs_[k + 1] - .5)))
                if b_ >= a_:
                    mask[i, a_:b_ + 1] = True
        v = win[mask & (win > 0)]
        if v.size >= 4:
            res[fid] = (float(np.percentile(v, 90)), ly, ring)


def indice(city, val):
    """Grava a cidade no index.json com trava: várias cidades podem ser processadas ao mesmo tempo."""
    import fcntl
    with open(OUT / ".index.lock", "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        idx = OUT / "index.json"
        I = json.loads(idx.read_text()) if idx.exists() else {}
        I[city] = val
        tmp = idx.with_suffix(".tmp")
        tmp.write_text(json.dumps(I, separators=(",", ":")))
        tmp.replace(idx)


def main():
    city, bb = sys.argv[1], [float(v) for v in sys.argv[2].split(",")]
    OUT.mkdir(exist_ok=True)
    blds, total = overture_buildings(bb)
    print(f"{city}: {len(blds)} de {total} prédios sem altura no Overture")
    if total and len(blds) / total < .35:
        print("  cobertura de altura já boa no Overture — pulando"); return
    res = {}
    tl = tiles_for(bb)
    if not tl:
        print("  sem dados do Google Open Buildings 2.5D nesta região (fora do Sul Global)"); return
    for url, a, epsg in tl:
        nome = url.rsplit("/", 1)[-1]
        for n in range(3):   # a conexão às vezes cai: tenta de novo o arquivo (os blocos já lidos continuam na memória)
            try:
                rf = Remoto(url) if n == 0 else rf
                tf = tifffile.TiffFile(io.BufferedReader(rf, 1 << 16))
                mb = adiantar_altura(rf, tf, a, epsg, blds, res) / 2**20
                print(f"  {nome}: lidos {mb:.0f} de {rf.size / 2**20:.0f} MB direto da nuvem")
                raster_heights(tf, a, epsg, blds, res)
                tf.close(); rf.blk.clear()
                break
            except Exception as e:
                if n == 2:
                    print(f"  {nome}: falhou a leitura na nuvem ({e}) — segue sem ele")
    # arranha-céus acima do teto da fonte: altura real do Wikidata (ponto dentro/perto da pegada)
    lm = json.loads((ROOT / "public" / "data-landmarks.json").read_text())["features"]
    def inside(pt, ring):
        x, y, c = pt[0], pt[1], False
        for (xa, ya), (xb, yb) in zip(ring, ring[1:] + ring[:1]):
            if (ya > y) != (yb > y) and x < xa + (y - ya) * (xb - xa) / (yb - ya):
                c = not c
        return c
    fixed = 0
    for l in lm:
        pt, h = l["geometry"]["coordinates"], l["properties"].get("h")
        if not h or not (bb[0] <= pt[0] <= bb[2] and bb[1] <= pt[1] <= bb[3]):
            continue
        best = None
        for fid, (hh, ly, ring) in res.items():
            if inside(pt, ring):
                best = fid; break
        if best is None:   # ponto do Wikidata fora da pegada: o prédio alto mais próximo até 60 m
            dmin = 60
            for fid, (hh, ly, ring) in res.items():
                cx, cy = sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)
                d = math.hypot((cx - pt[0]) * 111320 * math.cos(math.radians(pt[1])), (cy - pt[1]) * 110574)
                if d < dmin and hh > 50:
                    dmin, best = d, fid
        if best:
            res[best] = (float(h), res[best][1], res[best][2]); fixed += 1
    feats = [{"type": "Feature", "properties": {"id": fid, "height": round(h, 1), "part": ly == "building_part"},
              "geometry": {"type": "Polygon", "coordinates": [[[round(x, 6), round(y, 6)] for x, y in ring]]}}
             for fid, (h, ly, ring) in res.items()
             if h >= MIN_H and bb[0] <= sum(p[0] for p in ring)/len(ring) <= bb[2] and bb[1] <= sum(p[1] for p in ring)/len(ring) <= bb[3]]
    out = OUT / f"{city}.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection", "bbox": bb, "source": "Google Open Buildings 2.5D Temporal (CC BY 4.0) 2023 + Wikidata",
                               "features": feats}, separators=(",", ":")))
    indice(city, {"bbox": bb, "n": len(feats)})
    hs = sorted(f["properties"]["height"] for f in feats)
    print(f"  {len(feats)} prédios com altura (de {len(blds)}); torres corrigidas pelo Wikidata: {fixed}; "
          f"mediana {hs[len(hs)//2] if hs else 0} m, >40 m: {sum(h > 40 for h in hs)}, máx {hs[-1] if hs else 0} m; {out.stat().st_size//1024} KB")


if __name__ == "__main__":
    main()
