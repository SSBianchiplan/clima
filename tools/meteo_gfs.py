#!/usr/bin/env python3
"""Camadas de previsão no mapa (estilo Windy) a partir do NOAA GFS e GFS-Wave — dados abertos e grátis.

Lê do espelho público da NOAA na AWS (noaa-gfs-bdp-pds) só os campos necessários, por HTTP Range
(o arquivo .idx de cada hora diz onde está cada campo), e grava por hora três PNGs RGB de 0,5°
(720 × 361, longitude −180…179,5, latitude 90…−90) que o navegador decodifica e pinta:

  a.png  R = vento u (m/s, −40…40)   G = vento v      B = temperatura a 2 m (°C, −60…50)
  b.png  R = chuva (mm/h, √)         G = chuva acumulada desde o início (mm, √)   B = CAPE (J/kg, √)
  w.png  R = altura das ondas (m ×17; 255 = terra)   G = direção (°/1,42)   B = período (s ×10)

Saída: /opt/clima/data/meteo/gfs/<AAAAMMDDHH>/<FFF>{a,b,w}.png + meta.json; latest.json aponta a rodada.
Uso (no vps2): venv/bin/python gfs.py [saida]   — roda de hora em hora; só trabalha quando há rodada nova.
"""
import datetime as dt, io, json, os, shutil, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np, eccodes
from PIL import Image

S3 = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
OUT = sys.argv[1] if len(sys.argv) > 1 else "/opt/clima/data/meteo/gfs"
HOURS = list(range(0, 121, 3))
UA = {"User-Agent": "GPlanSiS-Clima/1.0 (clima.gplansis.com; uso nao comercial)"}


def get(url, rng=None, tries=5):
    h = dict(UA)
    if rng: h["Range"] = f"bytes={rng[0]}-{rng[1]}"
    for n in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=90) as r:
                return r.read()
        except Exception:
            if n == tries - 1: raise
            import time; time.sleep(4 * (n + 1))


def exists(url):
    try:
        urllib.request.urlopen(urllib.request.Request(url, method="HEAD", headers=UA), timeout=30); return True
    except Exception:
        return False


def idx(url):
    """[(campo, nível, período, início, fim)] a partir do .idx."""
    lines = get(url + ".idx").decode().strip().splitlines(); out = []
    for i, l in enumerate(lines):
        p = l.split(":"); start = int(p[1])
        end = int(lines[i + 1].split(":")[1]) - 1 if i + 1 < len(lines) else None
        out.append((p[3], p[4], p[5], start, end))
    return out


def campo(url, items, var, lev, per=None):
    for v, l, p, a, b in items:
        if v == var and l == lev and (per is None or per(p)):
            data = get(url, (a, b if b is not None else ""))
            g = eccodes.codes_new_from_message(data)
            try:
                ni, nj = eccodes.codes_get(g, "Ni"), eccodes.codes_get(g, "Nj")
                vals = eccodes.codes_get_values(g).reshape(nj, ni)
                miss = eccodes.codes_get(g, "missingValue")
            finally:
                eccodes.codes_release(g)
            vals = np.where(vals == miss, np.nan, vals)
            if eccodes and ni == 1440:   # ondas 0,25° → 0,5°
                vals = vals[::2, ::2]
            return np.roll(vals, vals.shape[1] // 2, axis=1), p   # 0…360 → −180…180
    return None, None


def png(path, r, g, b):
    Image.fromarray(np.dstack([r, g, b]).astype(np.uint8), "RGB").save(path, optimize=True)


def q(a, lo, hi):   # valor → 0…255
    return np.clip(np.rint((np.nan_to_num(a, nan=lo) - lo) / (hi - lo) * 255), 0, 255)


def rodada():
    agora = dt.datetime.now(dt.timezone.utc)
    for k in range(0, 48, 6):
        t = (agora - dt.timedelta(hours=k)).replace(minute=0, second=0, microsecond=0)
        t = t.replace(hour=t.hour // 6 * 6)
        base = f"{S3}/gfs.{t:%Y%m%d}/{t:%H}"
        # rodada completa quando a última hora que usamos já está publicada
        if exists(f"{base}/atmos/gfs.t{t:%H}z.pgrb2.0p50.f{HOURS[-1]:03d}.idx"):
            return t, base
    return None, None


def main():
    t, base = rodada()
    if not t:
        print("nenhuma rodada completa encontrada"); return
    run = f"{t:%Y%m%d%H}"
    os.makedirs(OUT, exist_ok=True)
    latest = os.path.join(OUT, "latest.json")
    if os.path.exists(latest) and json.load(open(latest)).get("run") == run:
        print("rodada", run, "já processada"); return
    tmp = os.path.join(OUT, run + ".tmp"); os.makedirs(tmp, exist_ok=True)
    acc = {0: None}   # chuva acumulada total (mm) por hora

    def uma(h):
        u = f"{base}/atmos/gfs.t{t:%H}z.pgrb2.0p50.f{h:03d}"
        it = idx(u)
        uu, _ = campo(u, it, "UGRD", "10 m above ground"); vv, _ = campo(u, it, "VGRD", "10 m above ground")
        tt, _ = campo(u, it, "TMP", "2 m above ground")
        cape, _ = campo(u, it, "CAPE", "surface")
        ap, per = (None, None) if h == 0 else campo(u, it, "APCP", "surface", lambda p: "acc" in p)
        w = f"{base}/wave/gridded/gfswave.t{t:%H}z.global.0p25.f{h:03d}.grib2"
        try:
            wi = idx(w); hs, _ = campo(w, wi, "HTSGW", "surface"); dp, _ = campo(w, wi, "DIRPW", "surface"); tp, _ = campo(w, wi, "PERPW", "surface")
        except Exception:
            hs = dp = tp = None
        return h, uu, vv, tt, cape, ap, per, hs, dp, tp

    with ThreadPoolExecutor(6) as ex:
        res = sorted(ex.map(uma, HOURS), key=lambda r: r[0])
    shape = res[0][1].shape
    prev_total = np.zeros(shape)
    for h, uu, vv, tt, cape, ap, per, hs, dp, tp in res:
        # APCP do GFS vem em "baldes" de 6 h ("6-9 hour acc"): total(fim) = total(início) + valor
        if ap is None:
            total = np.zeros(shape)
        else:
            a0 = int(per.split("-")[0]) if "-" in per else 0
            total = (acc.get(a0) if acc.get(a0) is not None else np.zeros(shape)) + np.nan_to_num(ap)
        acc[h] = total
        rate = np.maximum(0, total - prev_total) / 3 if h else np.zeros(shape)   # mm/h na janela de 3 h
        prev_total = total
        f = f"{h:03d}"
        png(f"{tmp}/{f}a.png", q(uu, -40, 40), q(vv, -40, 40), q(tt - 273.15, -60, 50))
        png(f"{tmp}/{f}b.png", q(np.sqrt(rate), 0, 10), q(np.sqrt(total), 0, np.sqrt(600)), q(np.sqrt(np.nan_to_num(cape)), 0, np.sqrt(6000)))
        if hs is not None:
            land = np.isnan(hs)
            png(f"{tmp}/{f}w.png", np.where(land, 255, np.clip(np.rint(np.nan_to_num(hs) * 17), 0, 254)), q(dp, 0, 360), q(tp, 0, 25.5))
    meta = {"model": "GFS", "fonte": "NOAA GFS 0,5° + GFS-Wave (WaveWatch III), domínio público",
            "run": run, "time": t.isoformat(), "hours": HOURS, "grid": [720, 361, -180, 90, .5],
            "ondas": all(r[7] is not None for r in res),
            "esc": {"u": [-40, 40], "v": [-40, 40], "t": [-60, 50], "rate_sqrt": [0, 10], "acc_sqrt": [0, float(np.sqrt(600))], "cape_sqrt": [0, float(np.sqrt(6000))], "hs": 17, "dir": [0, 360], "per": [0, 25.5]}}
    json.dump(meta, open(f"{tmp}/meta.json", "w"))
    final = os.path.join(OUT, run)
    if os.path.exists(final): shutil.rmtree(final)
    os.rename(tmp, final)
    json.dump({"run": run, "time": meta["time"]}, open(latest + ".tmp", "w")); os.replace(latest + ".tmp", latest)
    # guarda só as 2 últimas rodadas
    runs = sorted(d for d in os.listdir(OUT) if d.isdigit())
    for d in runs[:-2]: shutil.rmtree(os.path.join(OUT, d), ignore_errors=True)
    print("rodada", run, "pronta:", len(res), "horas")


if __name__ == "__main__":
    main()
