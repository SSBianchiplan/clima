#!/usr/bin/env python3
"""Rodoviária (terminal de ônibus intermunicipal) de cada cidade com 3D — ponto de partida do modo direção.
Fonte: OpenStreetMap via Nominatim (1 consulta/s). Gera public/data-rodoviarias.json."""
import json, time, urllib.parse, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
I = json.loads((ROOT / "public/data-heights/index.json").read_text())
EXTRA = {"sao-paulo": [-46.75, -23.65, -46.55, -23.48], "brasilia": [-48.05, -15.86, -47.82, -15.72], "fortaleza": [-38.62, -3.84, -38.45, -3.69]}
NOME = {"bc": "Balneário Camboriú", "rio-centro": "Rio de Janeiro", "rio-zonasul": None, "sao-paulo": "São Paulo", "goiania": "Goiânia", "itapema": "Itapema", "recife": "Recife",
        "salvador-centro": "Salvador", "bh-centro": "Belo Horizonte", "belem-centro": "Belém", "porto-alegre-centro": "Porto Alegre", "maceio-centro": "Maceió", "natal-centro": "Natal",
        "teresina-centro": "Teresina", "joao-pessoa-centro": "João Pessoa", "campo-grande-centro": "Campo Grande", "cuiaba-centro": "Cuiabá", "aracaju-centro": "Aracaju",
        "vitoria-centro": "Vitória", "brasilia": "Brasília", "fortaleza": "Fortaleza", "dubai": "Dubai", "washington": "Washington", "miami": "Miami", "orlando": "Orlando", "tampa": "Tampa"}
def q(text, bb):
    pad = .06
    vb = f"{bb[0]-pad},{bb[3]+pad},{bb[2]+pad},{bb[1]-pad}"
    u = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": text, "format": "jsonv2", "limit": 3, "viewbox": vb, "bounded": 1})
    r = urllib.request.Request(u, headers={"User-Agent": "GPlanSiS-Clima/1.0 (clima.gplansis.com)"})
    time.sleep(1.1)
    return json.load(urllib.request.urlopen(r, timeout=30))
out = []
areas = {**{k: v["bbox"] for k, v in I.items() if v.get("n", 0) > 0}, **EXTRA}
for k, bb in areas.items():
    nome = NOME.get(k)
    if not nome: continue
    br = k not in ("dubai", "washington", "miami", "orlando", "tampa")
    hit = None
    for text in (["terminal rodoviário", "rodoviária", "estação rodoviária"] if br else ["bus station", "intercity bus station"]):
        try: res = q(text, bb)
        except Exception: res = []
        if res: hit = res[0]; break
    if hit:
        out.append({"cidade": nome, "nome": hit.get("name") or hit["display_name"].split(",")[0], "lon": round(float(hit["lon"]), 6), "lat": round(float(hit["lat"]), 6)})
        print(f"{nome}: {out[-1]['nome']}")
    else:
        print(f"{nome}: não encontrada")
(ROOT / "public/data-rodoviarias.json").write_text(json.dumps(out, ensure_ascii=False, indent=0))
print(len(out), "rodoviárias")
