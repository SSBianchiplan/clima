#!/usr/bin/env python3
"""Coletor de voos (histórico por aeronave) — GPlanSiS Clima.

Roda pelo cron a cada 5 min. Varre o espaço aéreo brasileiro em círculos de
250 NM na adsb.lol (ODbL) e grava, por aeronave (hex ICAO), cada "perna" de voo:
indicativo, primeiro/último visto, primeira e última posição. Uma perna nova
começa quando o indicativo muda ou a aeronave some por mais de 45 min.
Publica /opt/clima/data/air/<hex>.json com as últimas 10 pernas, que o
navegador lê (as rotas origem→destino são resolvidas no navegador via adsbdb).
"""
import json, os, sqlite3, time, urllib.request

DB = "/opt/clima/data/air.sqlite"
OUT = "/opt/clima/data/air"
GAP = 45 * 60
# 12 círculos de 250 NM cobrem os corredores aéreos do Brasil
CENTERS = [(-3.0, -60.0), (-2.0, -48.5), (-4.0, -39.5), (-8.5, -36.0), (-12.5, -39.5), (-10.5, -48.0),
           (-15.8, -47.8), (-15.5, -56.0), (-20.5, -43.5), (-23.3, -47.0), (-26.8, -49.5), (-30.0, -52.0)]
UA = "GPlanSiS-Clima/1.0 (clima.gplansis.com)"


def fetch(lat, lon):
    url = f"https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/250"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r).get("ac", [])


def main():
    os.makedirs(OUT, exist_ok=True)
    db = sqlite3.connect(DB)
    db.execute("""CREATE TABLE IF NOT EXISTS legs(hex TEXT, cs TEXT, first INTEGER, last INTEGER,
                  lat0 REAL, lon0 REAL, lat1 REAL, lon1 REAL, PRIMARY KEY(hex, first))""")
    now = int(time.time())
    seen = {}
    for lat, lon in CENTERS:
        try:
            for a in fetch(lat, lon):
                if a.get("lat") is None or not a.get("hex"):
                    continue
                cs = (a.get("flight") or "").strip()
                if cs:
                    seen[a["hex"].lower()] = (cs, a["lat"], a["lon"])
        except Exception:
            pass
        time.sleep(8)  # a adsb.lol devolve 429 com menos de ~5 s entre consultas
    touched = set()
    for hx, (cs, la, lo) in seen.items():
        row = db.execute("SELECT first, cs, last FROM legs WHERE hex=? ORDER BY first DESC LIMIT 1", (hx,)).fetchone()
        if row and row[1] == cs and now - row[2] <= GAP:
            db.execute("UPDATE legs SET last=?, lat1=?, lon1=? WHERE hex=? AND first=?", (now, la, lo, hx, row[0]))
        else:
            db.execute("INSERT OR IGNORE INTO legs VALUES(?,?,?,?,?,?,?,?)", (hx, cs, now, now, la, lo, la, lo))
        touched.add(hx)
    db.execute("DELETE FROM legs WHERE last < ?", (now - 30 * 86400,))  # guarda 30 dias
    db.commit()
    for hx in touched:
        rows = db.execute("SELECT cs, first, last, lat0, lon0, lat1, lon1 FROM legs WHERE hex=? ORDER BY first DESC LIMIT 10", (hx,)).fetchall()
        legs = [dict(cs=r[0], first=r[1], last=r[2], from_=[r[3], r[4]], to=[r[5], r[6]]) for r in rows]
        tmp = f"{OUT}/{hx}.json.tmp"
        with open(tmp, "w") as f:
            json.dump({"hex": hx, "updated": now, "legs": legs}, f)
        os.chmod(tmp, 0o644)
        os.replace(tmp, f"{OUT}/{hx}.json")
    db.close()


if __name__ == "__main__":
    main()
