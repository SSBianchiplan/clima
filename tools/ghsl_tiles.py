#!/usr/bin/env python3
"""Escala global de altura: GHSL GHS-BUILT-H R2023A (altura média dos prédios, ~90 m, 2018, CC BY 4.0).

Converte o GeoTIFF (WGS84, 3 segundos) em imagens PNG em tons de cinza no esquema de tiles do mapa
(zoom 11, ~65–76 m por pixel), só onde há área construída. Valor do pixel = altura média em metros
(0 = sem prédio). O mapa lê essas imagens e dá a cada prédio SEM altura nos dados abertos a altura
média do quadrado onde ele está.

Uso:  python tools/ghsl_tiles.py <arquivo.tif> [saida]   (saída padrão: _ghsl/tiles)
"""
import math, sys, zlib, struct
from pathlib import Path
import numpy as np, tifffile, zarr

Z = 11
N = 2 ** Z


def png_gray(a):
    """PNG 8 bits em tons de cinza (sem dependências)."""
    h, w = a.shape
    raw = b"".join(b"\x00" + a[r].tobytes() for r in range(h))
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def main():
    src = Path(sys.argv[1]); out = Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).parent.parent / "_ghsl" / "tiles")
    tf = tifffile.TiffFile(src); pg = tf.pages[0]
    sx, sy = pg.tags[33550].value[:2]; lon0, lat0 = pg.tags[33922].value[3:5]
    H, W = pg.shape[-2:]
    store = tifffile.imread(src, aszarr=True); arr = zarr.open(store, mode="r")
    if isinstance(arr, zarr.Group): arr = arr["0"]
    lon1, lat1 = lon0 + W * sx, lat0 - H * sy
    tx = lambda lo: int((lo + 180) / 360 * N)
    ty = lambda la: int((1 - math.asinh(math.tan(math.radians(max(-85, min(85, la))))) / math.pi) / 2 * N)
    # trabalha em faixas de tiles para ler o GeoTIFF por janelas (o global tem 432000 × 216000 px)
    made = 0
    # partes paralelas: argv[3] = "i/n" processa só a i-ésima de n faixas de latitude
    part = sys.argv[3] if len(sys.argv) > 3 else "0/1"; pi, pn = map(int, part.split("/"))
    ys = list(range(ty(lat0), ty(lat1) + 1)); ys = ys[len(ys) * pi // pn: len(ys) * (pi + 1) // pn]
    # cache de bloco: lê 1024 linhas do GeoTIFF de uma vez, já em 1 byte (metros arredondados)
    cache = {"r0": -1, "r1": -1, "a": None}
    def rows(r0, r1):
        if not (cache["r0"] <= r0 and r1 <= cache["r1"]):
            b0 = (r0 // 512) * 512; b1 = min(H, max(r1, b0 + 1024))
            blk = np.asarray(arr[b0:b1, :], dtype=np.float32)
            cache.update(r0=b0, r1=b1, a=np.where(blk > 0, np.clip(np.rint(blk), 1, 255), 0).astype(np.uint8)); del blk
        return cache["a"][r0 - cache["r0"]:r1 - cache["r0"]]
    for y in ys:
        la_t = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / N))))
        la_b = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / N))))
        r0, r1 = max(0, int((lat0 - la_t) / sy) - 1), min(H, int((lat0 - la_b) / sy) + 2)
        if r1 <= r0: continue
        band = rows(r0, r1)
        if not (band > 0).any(): continue
        # latitude de cada linha de pixel do tile (Mercator)
        rr = (np.arange(256) + .5) / 256
        lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (y + rr) / N))))
        ri = np.clip(((lat0 - lat) / sy).astype(int) - r0, 0, r1 - r0 - 1)
        for x in range(tx(lon0), tx(lon1) + 1):
            lo_l = x / N * 360 - 180
            c0 = int((lo_l - lon0) / sx)
            if c0 >= W or c0 + int(360 / N / sx) + 2 < 0: continue
            cols = (np.arange(256) + .5) / 256
            lon = (x + cols) / N * 360 - 180
            ci = ((lon - lon0) / sx).astype(int)
            ok = (ci >= 0) & (ci < W)
            if not ok.any(): continue
            ci = np.clip(ci, 0, W - 1)
            t = band[ri[:, None], ci[None, :]]
            t[:, ~ok] = 0
            if not t.any(): continue
            f = out / str(Z) / str(x) / f"{y}.png"; f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(png_gray(t)); made += 1
    print(f"{src.name}: {made} tiles")


if __name__ == "__main__":
    main()
