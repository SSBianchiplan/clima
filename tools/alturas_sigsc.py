#!/usr/bin/env python3
"""Altura medida e cor real do telhado de cada prédio, pelo Levantamento Aerofotogramétrico de SC (SIG-SC, 2010–2012).

Fonte: Governo de Santa Catarina / SDE — serviço público SIG-SC (WMS sem taxas nem restrições de acesso).
  · MDS (superfície, com prédios) e MDT (terreno) de 1 m → altura do prédio = MDS − MDT (percentil 75 na pegada);
  · Ortofoto RGB 0,39 m → cor mediana do telhado.
O serviço de dados brutos (WCS) do estado está fora do ar; por isso pedimos o MDS/MDT pelo WMS com um estilo
próprio (SLD) que pinta a altura em tons de cinza, 1 m por tom (0 m = preto, 255 m = branco) — a precisão do dado.

Para cada prédio do Overture na área: altura medida (se ≥ 3 m; prédio mais novo que 2012 fica com a altura que já
tinha) e roof_color. O resultado entra em public/data-heights/<cidade>.geojson (substitui as alturas dessa área).

Uso: venv/bin/python tools/alturas_sigsc.py floripa "-48.5600,-27.6010,-48.5400,-27.5840"
"""
import io, json, math, sys, gzip, urllib.parse, urllib.request
from pathlib import Path
import numpy as np, pyproj, mapbox_vector_tile
from PIL import Image
from pmtiles.reader import Reader
sys.path.insert(0, str(Path(__file__).parent))
import alturas as A

WMS = "https://sigsc.sc.gov.br/sigserver/SIGSC/wms"
EPSG = 31982   # SIRGAS 2000 / UTM 22S, o sistema dos dados
BLOCO = 500    # metros por pedido


def sld(layer):
    return (f'<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld"><NamedLayer><Name>{layer}</Name><UserStyle>'
            '<FeatureTypeStyle><Rule><RasterSymbolizer><ColorMap type="ramp"><ColorMapEntry color="#000000" quantity="0"/>'
            '<ColorMapEntry color="#FFFFFF" quantity="255"/></ColorMap></RasterSymbolizer></Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>')


def wms(layer, e0, n0, e1, n1, px, cinza):
    q = {"service": "WMS", "version": "1.1.1", "request": "GetMap", "layers": f"SIGSC:{layer}", "styles": "", "srs": f"EPSG:{EPSG}",
         "bbox": f"{e0},{n0},{e1},{n1}", "width": str(px), "height": str(px), "format": "image/png"}
    if cinza: q["SLD_BODY"] = sld(f"SIGSC:{layer}")
    for n in range(5):
        try:
            d = urllib.request.urlopen(urllib.request.Request(WMS + "?" + urllib.parse.urlencode(q), headers={"User-Agent": "GPlanSiS-Clima/1.0"}), timeout=180).read()
            if d[:4] == b"\x89PNG":
                im = Image.open(io.BytesIO(d))
                return np.asarray(im.convert("L" if cinza else "RGB"))
        except Exception:
            pass
        import time; time.sleep(5 * (n + 1))
    raise RuntimeError(f"SIG-SC não respondeu: {layer} {e0},{n0}")


CACHE = Path("/private/tmp/claude-501/-Volumes-Armazena2-climagplansis/1a5e808c-0af9-46a1-999a-b9eaada857fb/scratchpad/sigsc/cache")


def mosaico(layer, E0, N0, E1, N1, mpp, cinza):
    """Imagem da área toda (norte em cima), juntando blocos de 500 m. Guardada em disco: a detecção de prédios reaproveita."""
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"{layer}_{int(E0)}_{int(N0)}_{int(E1)}_{int(N1)}_{mpp}.npy"
    if f.exists(): return np.load(f)
    a = _mosaico(layer, E0, N0, E1, N1, mpp, cinza); np.save(f, a); return a


def _mosaico(layer, E0, N0, E1, N1, mpp, cinza):
    """Imagem da área toda (norte em cima), juntando blocos de 500 m."""
    W, H = int(round((E1 - E0) / mpp)), int(round((N1 - N0) / mpp))
    out = np.zeros((H, W) if cinza else (H, W, 3), np.uint8)
    px = int(round(BLOCO / mpp))
    for e in np.arange(E0, E1, BLOCO):
        for n in np.arange(N0, N1, BLOCO):
            a = wms(layer, e, n, e + BLOCO, n + BLOCO, px, cinza)
            c0, r1 = int(round((e - E0) / mpp)), H - int(round((n - N0) / mpp))
            r0 = r1 - px
            ys, xs = slice(max(0, r0), min(H, r1)), slice(max(0, c0), min(W, c0 + px))
            out[ys, xs] = a[ys.start - r0:ys.stop - r0, xs.start - c0:xs.stop - c0]
    print(f"  {layer}: {W}×{H} px")
    return out


def predios(bb):
    """Todos os prédios do Overture (z14) na área, sem partes: [(id, anel lon/lat)]."""
    rd = Reader(lambda off, ln: A.get(A.OVERTURE, (off, ln)))
    n = 2 ** 14
    tx = lambda lo: int((lo + 180) / 360 * n)
    ty = lambda la: int((1 - math.asinh(math.tan(math.radians(la))) / math.pi) / 2 * n)
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
                p, g = f["properties"], f["geometry"]
                if p.get("has_parts") or p.get("is_underground") or p.get("id") in seen: continue
                polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"] if g["type"] == "MultiPolygon" else []
                if not polys: continue
                ring = [[(x + px / ext) / n * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + py / ext) / n))))] for px, py in polys[0][0]]
                c = (sum(q[0] for q in ring) / len(ring), sum(q[1] for q in ring) / len(ring))
                if not (bb[0] <= c[0] <= bb[2] and bb[1] <= c[1] <= bb[3]) or len(ring) < 4: continue
                seen.add(p["id"]); out.append((p["id"], ring, p.get("height")))
    return out


def mascara(cs, rs, h, w):
    """Pixels cujo centro cai dentro do polígono (coordenadas em pixels)."""
    r0, r1, c0, c1 = max(0, int(min(rs))), min(h, int(max(rs)) + 1), max(0, int(min(cs))), min(w, int(max(cs)) + 1)
    if r1 <= r0 or c1 <= c0: return None
    m = np.zeros((r1 - r0, c1 - c0), bool); poly = list(zip(cs, rs))
    for i in range(r1 - r0):
        yc, xs = r0 + i + .5, []
        for (xa, ya), (xb, yb) in zip(poly, poly[1:] + poly[:1]):
            if (ya > yc) != (yb > yc): xs.append(xa + (yc - ya) * (xb - xa) / (yb - ya))
        xs.sort()
        for k in range(0, len(xs) - 1, 2):
            a, b = max(c0, math.ceil(xs[k] - .5)), min(c1 - 1, math.floor(xs[k + 1] - .5))
            if b >= a: m[i, a - c0:b - c0 + 1] = True
    return (slice(r0, r1), slice(c0, c1)), m


# tom da fachada (índice na paleta FACADE de sat.js) puxado da cor medida do telhado: telhado clareado (as paredes
# refletem mais luz que a laje vista de cima) e aproximado ao tom de cidade mais próximo
FACADE = ["#EEEBE4","#E8E1D3","#E6D9BE","#DCCAA6","#D2D2CC","#B9BDC1","#E3BFA7","#CC9A80","#C3D3DC","#CBD8C6","#DDBF7E","#C7BCAE"]
def fachada(cor, semente=""):
    r, g, b = (int(cor[i:i+2], 16) for i in (1, 3, 5))
    L = .3*r + .59*g + .11*b
    h = sum(map(ord, str(semente))) if semente else int(L * 7)
    pick = lambda opc: opc[h % len(opc)]
    if r > g + 12 and r > b + 22: return pick([0, 1, 2, 2, 6])        # telhado cerâmico: casa de parede clara
    if b > r + 8 and b >= g: return pick([8, 0, 1])                    # azulado
    if g > r + 6 and g > b + 6: return pick([9, 1])                     # esverdeado
    if r > b + 25 and g > b + 20: return pick([3, 10, 2])               # amarelado/areia
    if L > 150: return pick([0, 1, 0, 4])                               # laje clara
    if L < 85: return pick([5, 11, 4, 1])                               # laje escura (prédios)
    return pick([1, 4, 11, 0, 2, 3])                                    # cinza médio


def main():
    city, bb = sys.argv[1], [float(v) for v in sys.argv[2].split(",")]
    tr = pyproj.Transformer.from_crs(4326, EPSG, always_xy=True)
    es, ns = zip(*[tr.transform(lo, la) for lo in (bb[0], bb[2]) for la in (bb[1], bb[3])])
    E0, N0 = math.floor(min(es) / BLOCO) * BLOCO, math.floor(min(ns) / BLOCO) * BLOCO
    E1, N1 = math.ceil(max(es) / BLOCO) * BLOCO, math.ceil(max(ns) / BLOCO) * BLOCO
    print(f"{city}: área {E1 - E0:.0f} × {N1 - N0:.0f} m (SIG-SC 2010–2012)")
    mds = mosaico("MDS-2012", E0, N0, E1, N1, 1.0, True).astype(np.float32)
    mdt = mosaico("MDT-2012", E0, N0, E1, N1, 1.0, True).astype(np.float32)
    rgb = mosaico("OrtoRGB-Landsat-2012", E0, N0, E1, N1, .5, False)
    ndsm = np.clip(mds - mdt, 0, None)
    H, W = ndsm.shape
    bl = predios(bb); print(f"  {len(bl)} prédios do Overture na área")
    feats, novos, medidos = [], 0, []
    for fid, ring, h0 in bl:
        xs, ys = tr.transform([q[0] for q in ring], [q[1] for q in ring])
        r = mascara([x - E0 for x in xs], [N1 - y for y in ys], H, W)
        if not r: continue
        (sy, sx), m = r
        v = ndsm[sy, sx][m]
        if v.size < 6: continue
        h = float(np.percentile(v, 75))
        # anti-"prédio fantasma": árvore sobre a casa, encosta de morro (MDT suavizado) ou contorno pequeno demais
        if h > 8:
            p25 = float(np.percentile(v, 25)); t_ = mdt[sy, sx][m]
            area = float(m.sum())   # pixels de 1 m² dentro do contorno
            if p25 < .5 * h: continue                                   # telhado irregular: copa ou encosta, não laje
            if float(t_.max() - t_.min()) > max(4, .4 * h): continue    # terreno inclinado sob o contorno
            if (area < 60 and h > 12) or (area < 150 and h > 25) or (h > 4 * math.sqrt(area) and h > 15): continue
        if h > 100:
            continue   # morro/encosta: o MDT do estado é suavizado e a "altura" vira o desnível do terreno — fica a altura anterior
        if h < 3:
            novos += 1; continue   # prédio mais novo que 2012 (ou térreo): fica com a altura que já tinha
        # cor do telhado: mediana dos pixels da foto (0,5 m) dentro da pegada, sem a borda
        r2 = mascara([(x - E0) * 2 for x in xs], [(N1 - y) * 2 for y in ys], H * 2, W * 2)
        cor = None
        if r2:
            (sy2, sx2), m2 = r2
            pix = rgb[sy2, sx2][m2]
            if len(pix) >= 8:
                c = np.median(pix, axis=0).astype(int); cor = "#%02X%02X%02X" % tuple(c)
        if cor and h > 8:
            cr, cg, cb = (int(cor[i:i+2], 16) for i in (1, 3, 5))
            if cg > cr + 8 and cg > cb + 6: continue                     # telhado "verde" = copa de árvore
        medidos.append(h)
        p = {"id": fid, "height": round(h, 1), "part": False, "src": "sigsc"}
        if cor: p["roof_color"] = cor; p["fb"] = fachada(cor, fid)
        feats.append({"type": "Feature", "properties": p, "geometry": {"type": "Polygon", "coordinates": [[[round(x, 6), round(y, 6)] for x, y in ring]]}})
    hs = sorted(medidos)
    print(f"  {len(feats)} prédios medidos (mediana {hs[len(hs)//2] if hs else 0:.1f} m, >40 m: {sum(h > 40 for h in hs)}, máx {hs[-1] if hs else 0:.0f} m); "
          f"{novos} mais novos que 2012 ou térreos ficam como estavam")
    # junta no arquivo da cidade: a medida do estado substitui a estimativa nessa área
    out = A.OUT / f"{city}.geojson"
    base = json.loads(out.read_text()) if out.exists() else {"type": "FeatureCollection", "features": []}
    ids = {f["properties"]["id"] for f in feats}
    base["features"] = [f for f in base["features"] if f["properties"]["id"] not in ids] + feats
    bb0 = base.get("bbox")
    if not (isinstance(bb0, list) and len(bb0) == 4 and all(isinstance(v, (int, float)) for v in bb0)): bb0 = bb
    base["bbox"] = [min(bb0[0], bb[0]), min(bb0[1], bb[1]), max(bb0[2], bb[2]), max(bb0[3], bb[3])]
    base["source"] = (base.get("source", "") + " + SIG-SC/SDE Santa Catarina 2012 (MDS/MDT 1 m, ortofoto 0,39 m)").strip(" +")
    out.write_text(json.dumps(base, separators=(",", ":")))
    A.indice(city, {"bbox": base["bbox"], "n": len(base["features"])})
    Image.fromarray(np.uint8(np.clip(ndsm * 3, 0, 255))).save(Path("/private/tmp/claude-501/-Volumes-Armazena2-climagplansis/1a5e808c-0af9-46a1-999a-b9eaada857fb/scratchpad/sigsc") / f"{city}_ndsm.png")
    print(f"  gravado em {out.name}: {len(base['features'])} prédios no total")


if __name__ == "__main__":
    main()
