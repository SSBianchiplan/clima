#!/usr/bin/env python3
"""Camadas do tempo com o ECMWF IFS (dados abertos, CC BY 4.0) — mesmo formato do tools/meteo_gfs.py.

Lê do servidor de dados abertos do ECMWF (data.ecmwf.int) só os campos necessários, por HTTP Range a partir do
arquivo .index de cada hora: vento 10 m (10u/10v), temperatura 2 m (2t), chuva acumulada (tp), CAPE (mucape) e
ondas (swh, mwd, mwp). Grade 0,25° reduzida para 0,5° (720 × 361) e gravada como PNG de dados por hora.

Saída: /opt/clima/data/meteo/ecmwf/<AAAAMMDDHH>/<FFF>{a,b,w}.png + meta.json; latest.json aponta a rodada.
"""
import datetime as dt, json, os, shutil, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np, eccodes
from PIL import Image

BASE = "https://data.ecmwf.int/forecasts"
OUT = sys.argv[1] if len(sys.argv) > 1 else "/opt/clima/data/meteo/ecmwf"
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


def idx(url):
    return [json.loads(l) for l in get(url).decode().splitlines() if l.strip()]


def campo(grib, items, param):
    for j in items:
        if j.get("param") == param:
            g = eccodes.codes_new_from_message(get(grib, (j["_offset"], j["_offset"] + j["_length"] - 1)))
            try:
                ni, nj = eccodes.codes_get(g, "Ni"), eccodes.codes_get(g, "Nj"); lon0 = eccodes.codes_get(g, "longitudeOfFirstGridPointInDegrees")
                v = eccodes.codes_get_values(g).reshape(nj, ni); miss = eccodes.codes_get(g, "missingValue")
            finally:
                eccodes.codes_release(g)
            v = np.where(v == miss, np.nan, v)
            if lon0 >= 0 and lon0 < 1: v = np.roll(v, ni // 2, axis=1)      # 0…360 → −180…180
            return v[::2, ::2]                                                # 0,25° → 0,5°
    return None


def png(path, r, g, b):
    Image.fromarray(np.dstack([r, g, b]).astype(np.uint8), "RGB").save(path, optimize=True)


def q(a, lo, hi):
    return np.clip(np.rint((np.nan_to_num(a, nan=lo) - lo) / (hi - lo) * 255), 0, 255)


def url(t, h, stream):
    return f"{BASE}/{t:%Y%m%d}/{t:%H}z/ifs/0p25/{stream}/{t:%Y%m%d%H}0000-{h}h-{stream}-fc"


def rodada():
    agora = dt.datetime.now(dt.timezone.utc)
    for k in range(0, 48, 12):
        t = (agora - dt.timedelta(hours=k)).replace(minute=0, second=0, microsecond=0); t = t.replace(hour=t.hour // 12 * 12)
        try:
            urllib.request.urlopen(urllib.request.Request(url(t, HOURS[-1], "oper") + ".index", method="HEAD", headers=UA), timeout=30); return t
        except Exception:
            continue
    return None


def main():
    t = rodada()
    if not t: print("nenhuma rodada completa do ECMWF"); return
    run = f"{t:%Y%m%d%H}"; os.makedirs(OUT, exist_ok=True); latest = os.path.join(OUT, "latest.json")
    if os.path.exists(latest) and json.load(open(latest)).get("run") == run: print("rodada", run, "já processada"); return
    tmp = os.path.join(OUT, run + ".tmp"); os.makedirs(tmp, exist_ok=True)

    def uma(h):
        g = url(t, h, "oper") + ".grib2"; it = idx(url(t, h, "oper") + ".index")
        uu, vv, tt, tp, cape = (campo(g, it, p) for p in ("10u", "10v", "2t", "tp", "mucape"))
        try:
            w = url(t, h, "wave") + ".grib2"; wi = idx(url(t, h, "wave") + ".index")
            hs, dp, tpw = (campo(w, wi, p) for p in ("swh", "mwd", "mwp"))
        except Exception:
            hs = dp = tpw = None
        return h, uu, vv, tt, tp, cape, hs, dp, tpw

    with ThreadPoolExecutor(6) as ex:
        res = sorted(ex.map(uma, HOURS), key=lambda r: r[0])
    prev = None
    for h, uu, vv, tt, tp, cape, hs, dp, tpw in res:
        total = np.nan_to_num(tp) * 1000 if tp is not None else np.zeros(uu.shape)      # m → mm acumulado desde o início
        rate = np.maximum(0, total - prev) / 3 if prev is not None else np.zeros(uu.shape); prev = total
        f = f"{h:03d}"
        png(f"{tmp}/{f}a.png", q(uu, -40, 40), q(vv, -40, 40), q(tt - 273.15, -60, 50))
        png(f"{tmp}/{f}b.png", q(np.sqrt(rate), 0, 10), q(np.sqrt(total), 0, np.sqrt(600)), q(np.sqrt(np.nan_to_num(cape)), 0, np.sqrt(6000)))
        if hs is not None:
            land = np.isnan(hs)
            png(f"{tmp}/{f}w.png", np.where(land, 255, np.clip(np.rint(np.nan_to_num(hs) * 17), 0, 254)), q(dp, 0, 360), q(tpw, 0, 25.5))
    meta = {"model": "ECMWF", "fonte": "ECMWF IFS 0,25° dados abertos (CC BY 4.0) + ondas ECMWF WAM", "run": run, "time": t.isoformat(), "hours": HOURS,
            "grid": [720, 361, -180, 90, .5], "ondas": all(r[6] is not None for r in res)}
    json.dump(meta, open(f"{tmp}/meta.json", "w"))
    final = os.path.join(OUT, run)
    if os.path.exists(final): shutil.rmtree(final)
    os.rename(tmp, final)
    json.dump({"run": run, "time": meta["time"]}, open(latest + ".tmp", "w")); os.replace(latest + ".tmp", latest)
    for d in sorted(x for x in os.listdir(OUT) if x.isdigit())[:-2]: shutil.rmtree(os.path.join(OUT, d), ignore_errors=True)
    print("rodada", run, "pronta:", len(res), "horas")


if __name__ == "__main__":
    main()
