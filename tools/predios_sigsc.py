#!/usr/bin/env python3
"""Prédios que existem mas não estão mapeados: detectados pelo levantamento aéreo de SC (SIG-SC 2010–2012).

Onde o OpenStreetMap/Overture não tem o contorno, o próprio levantamento mostra a construção: a superfície medida
(MDS) fica acima do terreno (MDT) num bloco compacto, de telhado plano ou de duas águas, e a foto aérea não é verde
(não é copa de árvore). Cada bloco vira um prédio retangular orientado pelo próprio bloco (as proporções do mapa),
com a altura medida e a cor real do telhado. Nada é desenhado onde já existe prédio mapeado.

Filtros contra "prédio fantasma": área 25–2500 m², altura 2,5–40 m, preenchimento do retângulo ≥ 55 %,
laje regular (p25 ≥ 50 % da altura), sem verde, terreno plano sob o bloco, fora d'água.
Limite: retrata 2010–2012 (prédio demolido depois pode aparecer; prédio mais novo não aparece).

Uso: venv/bin/python tools/predios_sigsc.py floripa-sul2 "-48.62,-27.84,-48.44,-27.69"
"""
import json, math, sys
from pathlib import Path
import numpy as np, pyproj
from scipy import ndimage
sys.path.insert(0, str(Path(__file__).parent))
import alturas as A, alturas_sigsc as S

CACHE = Path("/private/tmp/claude-501/-Volumes-Armazena2-climagplansis/1a5e808c-0af9-46a1-999a-b9eaada857fb/scratchpad/sigsc")


def camada(nome, layer, E0, N0, E1, N1, mpp, cinza):
    return S.mosaico(layer, E0, N0, E1, N1, mpp, cinza)   # mesma cópia em disco usada pela medição de altura


def main():
    nome, bb = sys.argv[1], [float(v) for v in sys.argv[2].split(",")]
    tr = pyproj.Transformer.from_crs(4326, S.EPSG, always_xy=True); inv = pyproj.Transformer.from_crs(S.EPSG, 4326, always_xy=True)
    es, ns = zip(*[tr.transform(lo, la) for lo in (bb[0], bb[2]) for la in (bb[1], bb[3])])
    E0, N0 = math.floor(min(es) / S.BLOCO) * S.BLOCO, math.floor(min(ns) / S.BLOCO) * S.BLOCO
    E1, N1 = math.ceil(max(es) / S.BLOCO) * S.BLOCO, math.ceil(max(ns) / S.BLOCO) * S.BLOCO
    print(f"{nome}: {E1 - E0:.0f} × {N1 - N0:.0f} m")
    mds = camada(nome, "MDS-2012", E0, N0, E1, N1, 1.0, True).astype(np.float32)
    mdt = camada(nome, "MDT-2012", E0, N0, E1, N1, 1.0, True).astype(np.float32)
    rgb = camada(nome, "OrtoRGB-Landsat-2012", E0, N0, E1, N1, .5, False)
    H, W = mds.shape
    # foto 0,5 m → 1 m (média 2×2)
    rgb1 = rgb[:H*2, :W*2].reshape(H, 2, W, 2, 3).mean(axis=(1, 3))
    r, g, b = rgb1[..., 0], rgb1[..., 1], rgb1[..., 2]
    ndsm = np.clip(mds - mdt, 0, None)
    verde = (2*g - r - b > 18) | ((g > r + 6) & (g > b + 4))
    agua = (b > r + 10) & (b > g - 2) & (ndsm < 1.5)
    # prédios já mapeados (Overture): marcados para não duplicar
    ja = np.zeros((H, W), bool)
    for fid, ring, h0 in S.predios(bb):
        xs, ys = tr.transform([q[0] for q in ring], [q[1] for q in ring])
        m = S.mascara([x - E0 for x in xs], [N1 - y for y in ys], H, W)
        if m: (sy, sx), mm = m; ja[sy, sx] |= mm
    # área habitada: até 60 m de prédios já mapeados (casa isolada no meio da mata quase sempre é copa de árvore)
    perto = ndimage.binary_dilation(ja, structure=np.ones((3, 3)), iterations=60)
    ja = ndimage.binary_dilation(ja, iterations=2)
    cand = (ndsm >= 2.5) & ~verde & ~agua & ~ja
    cand = ndimage.binary_opening(cand, structure=np.ones((3, 3)))     # tira postes, fios, ruído de borda
    lab, n = ndimage.label(cand)
    print(f"  {n} blocos candidatos")
    objs = ndimage.find_objects(lab)
    feats, motivo = [], {}
    def nao(k): motivo[k] = motivo.get(k, 0) + 1
    for i, sl in enumerate(objs, 1):
        if sl is None: continue
        m = lab[sl] == i; area = int(m.sum())
        if not perto[sl][m].any(): nao("longe de área habitada"); continue
        # telhado: a maior parte do bloco e a vizinhança imediata não podem ser vegetação
        anel = ndimage.binary_dilation(m, iterations=3) & ~m
        if verde[sl][anel].mean() > .6 if anel.any() else False: nao("cercado de mata"); continue
        if area < 25 or area > 2500: nao("área"); continue
        v = ndsm[sl][m]; h = float(np.percentile(v, 75))
        if h > 25: nao("alto demais p/ área sem mapeamento"); continue
        if float(np.percentile(v, 25)) < .5 * h: nao("laje irregular"); continue
        t = mdt[sl][m]
        if float(t.max() - t.min()) > max(4, .4 * h): nao("encosta"); continue
        # retângulo orientado pelo bloco (PCA): as proporções e a direção da construção na foto
        yy, xx = np.nonzero(m); yy = yy + sl[0].start + .5; xx = xx + sl[1].start + .5
        cx, cy = xx.mean(), yy.mean(); C = np.cov(np.vstack([xx - cx, yy - cy]))
        w_, V = np.linalg.eigh(C); u = V[:, 1]; vv = V[:, 0]
        pu = (xx - cx)*u[0] + (yy - cy)*u[1]; pv = (xx - cx)*vv[0] + (yy - cy)*vv[1]
        a0, a1, b0, b1 = pu.min() - .5, pu.max() + .5, pv.min() - .5, pv.max() + .5
        if area / ((a1 - a0) * (b1 - b0)) < .65: nao("forma irregular"); continue
        if max(a1 - a0, b1 - b0) > 35: nao("comprido demais (várias casas ou via)"); continue
        if min(a1 - a0, b1 - b0) < 3.5: nao("estreito (muro)"); continue
        cant = [(a0, b0), (a1, b0), (a1, b1), (a0, b1)]
        pts = [(cx + p*u[0] + q*vv[0], cy + p*u[1] + q*vv[1]) for p, q in cant]
        ring = [inv.transform(E0 + x, N1 - y) for x, y in pts]; ring = [[round(lo, 6), round(la, 6)] for lo, la in ring]; ring.append(ring[0])
        cor = "#%02X%02X%02X" % tuple(np.median(rgb1[sl][m], axis=0).astype(int))
        feats.append({"type": "Feature", "properties": {"id": f"sg-{nome}-{i}", "height": round(max(3, h), 1), "part": False, "src": "sigsc-novo",
                      "roof_color": cor, "fb": S.fachada(cor, f"sg{i}")}, "geometry": {"type": "Polygon", "coordinates": [ring]}})
    print(f"  {len(feats)} prédios criados a partir do levantamento · descartados: {motivo}")
    out = A.OUT / f"{nome}.geojson"
    base = json.loads(out.read_text()) if out.exists() else {"type": "FeatureCollection", "features": [], "bbox": bb}
    base["features"] = [f for f in base["features"] if f["properties"].get("src") != "sigsc-novo"] + feats
    bb0 = base.get("bbox") if isinstance(base.get("bbox"), list) and len(base.get("bbox")) == 4 else bb
    base["bbox"] = [min(bb0[0], bb[0]), min(bb0[1], bb[1]), max(bb0[2], bb[2]), max(bb0[3], bb[3])]
    base["source"] = (base.get("source", "") + " + prédios detectados no levantamento SIG-SC 2012").strip(" +") if "detectados" not in base.get("source", "") else base["source"]
    out.write_text(json.dumps(base, separators=(",", ":")))
    A.indice(nome, {"bbox": base["bbox"], "n": len(base["features"])})
    hs = sorted(f["properties"]["height"] for f in feats)
    print(f"  alturas: mediana {hs[len(hs)//2] if hs else 0} m · >15 m: {sum(x > 15 for x in hs)} · gravado em {out.name} ({len(base['features'])} no total)")


if __name__ == "__main__":
    main()
