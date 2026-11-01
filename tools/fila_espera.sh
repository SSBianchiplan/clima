#!/bin/bash
# itens que estavam em espera: 72 cidades sorteadas (Google 2.5D) e torres do Wikidata das capitais
cd "$(dirname "$0")/.."
PY=${PY:-python3}
echo "##### 72 sorteadas"
LISTA=tools/cidades2.txt PY=$PY ./tools/alturas_lote.sh
echo "##### Wikidata (capitais) — 1 consulta/min"
grep -v "^#" tools/cidades_wd_capitais.txt | while read -r nome bb; do
  [ -z "$nome" ] && continue
  python3 -c "import json,sys; sys.exit(0 if '$nome' in json.load(open('public/data-heights/index.json')) else 1)" 2>/dev/null && { echo "== $nome (já feito)"; continue; }
  echo "== $nome"; timeout 600 $PY tools/alturas_wikidata.py "$nome" "$bb" 2>&1 | tail -1
done
bash tools/publicar_alturas.sh >/dev/null 2>&1 && echo "publicado"
echo "##### espera: fim"
