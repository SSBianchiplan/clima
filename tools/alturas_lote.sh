#!/bin/bash
# Processa as cidades de tools/cidades.txt (pula as que já estão em public/data-heights/index.json)
cd "$(dirname "$0")/.."
PY=${PY:-python3}
grep -v "^#" "${LISTA:-tools/cidades.txt}" | while read -r nome lon lat r; do
  [ -z "$nome" ] && continue
  r=${r:-0.035}
  if python3 -c "import json,sys; sys.exit(0 if '$nome' in json.load(open('public/data-heights/index.json')) else 1)" 2>/dev/null; then echo "== $nome (já feito)"; continue; fi
  bb=$(python3 -c "lo,la,r=$lon,$lat,$r; print(f'{lo-r:.4f},{la-r*.86:.4f},{lo+r:.4f},{la+r*.86:.4f}')")
  echo "== $nome $bb"
  $PY tools/alturas.py "$nome" "$bb" 2>&1 | grep -v "^  baixando" | tail -2
done
