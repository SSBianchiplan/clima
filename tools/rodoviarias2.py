import json, time, urllib.parse, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
L = [("Balneário Camboriú","Terminal Rodoviário de Balneário Camboriú"),("Itapema","Terminal Rodoviário José Carlos Moreira, Itapema"),
 ("Goiânia","Terminal Rodoviário de Goiânia"),("Rio de Janeiro","Terminal Rodoviário Novo Rio"),("Recife","Terminal Integrado de Passageiros, Jaboatão"),
 ("Salvador","Terminal Rodoviário de Salvador"),("Belo Horizonte","Terminal Rodoviário Governador Israel Pinheiro"),("Belém","Terminal Rodoviário de Belém"),
 ("Porto Alegre","Estação Rodoviária de Porto Alegre"),("Maceió","Terminal Rodoviário de Maceió"),("Natal","Terminal Rodoviário de Natal"),
 ("Teresina","Terminal Rodoviário Lucídio Portella"),("João Pessoa","Terminal Rodoviário Severino Camelo"),("Campo Grande","Terminal Rodoviário de Campo Grande, Mato Grosso do Sul"),
 ("Cuiabá","Terminal Rodoviário de Cuiabá"),("Aracaju","Terminal Rodoviário José Rollemberg Leite"),("Vitória","Rodoviária de Vitória, Espírito Santo"),
 ("São Paulo","Terminal Rodoviário Tietê"),("Brasília","Rodoviária Interestadual de Brasília"),("Fortaleza","Terminal Rodoviário Engenheiro João Thomé"),
 ("Dubai","Al Ghubaiba Bus Station"),("Washington","Union Station, Washington"),("Miami","Miami Intermodal Center"),("Orlando","Lynx Central Station, Orlando"),("Tampa","Tampa Greyhound Bus Station")]
out = []
for cidade, nome in L:
    u = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": nome, "format": "jsonv2", "limit": 1})
    time.sleep(1.1)
    try: r = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "GPlanSiS-Clima/1.0 (clima.gplansis.com)"}), timeout=30))
    except Exception: r = []
    if r:
        out.append({"cidade": cidade, "nome": nome.split(",")[0], "lon": round(float(r[0]["lon"]), 6), "lat": round(float(r[0]["lat"]), 6)}); print("ok ", cidade, r[0]["display_name"][:70])
    else: print("XX ", cidade, nome)
(ROOT / "public/data-rodoviarias.json").write_text(json.dumps(out, ensure_ascii=False))
print(len(out))
