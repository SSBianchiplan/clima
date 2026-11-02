#!/usr/bin/env python3
"""Focos de calor (queimadas) da NASA FIRMS — GPlanSiS Clima.

Roda pelo cron de hora em hora. Baixa as detecções das últimas 24 h dos três
VIIRS (Suomi NPP, NOAA-20, NOAA-21; pixel de 375 m) no mundo todo pela API de
área da FIRMS e publica /opt/clima/data/firms.json, que o navegador lê.

A chave (MAP_KEY) fica só no servidor, em /opt/clima/bin/firms.key, e cada
hora gasta 3 transações da cota (5.000 a cada 10 min) — o número de
visitantes não muda nada. Os três satélites veem o mesmo fogo: focos na mesma
célula de ~375 m viram um só (o mais forte, com a hora mais recente).

Formato enxuto, em colunas achatadas (7 números por foco):
  {"t": gerado (epoch s), "h": horas, "sat": [nomes], "n": focos,
   "p": [lon*1e4, lat*1e4, frp*10, minutos antes de t, satélite, confiança 0-2, dia 1/0, ...]}
"""
import csv, io, json, os, time, urllib.request
from datetime import datetime, timezone

KEY_FILE = "/opt/clima/bin/firms.key"
OUT = "/opt/clima/data/firms.json"
SOURCES = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"]
SAT = ["Suomi NPP", "NOAA-20", "NOAA-21"]
HOURS = 24
CELL = 0.0035  # graus, ~375 m no equador: o pixel do VIIRS
CONF = {"l": 0, "n": 1, "h": 2}
UA = "GPlanSiS-Clima/1.0 (clima.gplansis.com)"


def fetch(key, source):
    # "world/2" = hoje e ontem (UTC): cobre as últimas 24 h em qualquer hora do dia
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/world/2"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        text = r.read().decode("utf-8", "replace")
    if not text.startswith("latitude"):
        raise ValueError(text[:200])  # cota esgotada ou chave inválida: mantém o arquivo anterior
    return csv.DictReader(io.StringIO(text))


def main():
    key = open(KEY_FILE).read().strip()
    now = time.time()
    cells = {}
    ok = 0
    for si, source in enumerate(SOURCES):
        try:
            rows = fetch(key, source)
            ok += 1
        except Exception:
            continue
        for r in rows:
            try:
                t = datetime.strptime(r["acq_date"] + r["acq_time"].zfill(4), "%Y-%m-%d%H%M").replace(tzinfo=timezone.utc).timestamp()
                age = (now - t) / 60
                if age > HOURS * 60 or age < -60:
                    continue
                lat, lon, frp = float(r["latitude"]), float(r["longitude"]), float(r["frp"] or 0)
            except (KeyError, ValueError):
                continue
            k = (round(lon / CELL), round(lat / CELL))
            cur = cells.get(k)
            f = [round(lon * 1e4), round(lat * 1e4), round(frp * 10), max(0, round(age)), si,
                 CONF.get(r.get("confidence", "n")[:1], 1), 1 if r.get("daynight") == "D" else 0]
            if cur is None:
                cells[k] = f
            else:  # o mais forte, com a hora mais recente entre os dois
                if f[2] > cur[2]:
                    f[3] = min(f[3], cur[3]); cells[k] = f
                else:
                    cur[3] = min(cur[3], f[3])
    if not ok:
        return
    flat = [v for f in sorted(cells.values(), key=lambda f: f[2]) for v in f]  # fracos primeiro: os fortes ficam por cima
    out = {"t": int(now), "h": HOURS, "sat": SAT, "n": len(cells), "p": flat}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w") as fp:
        json.dump(out, fp, separators=(",", ":"))
    os.chmod(tmp, 0o644)
    os.replace(tmp, OUT)


if __name__ == "__main__":
    main()
