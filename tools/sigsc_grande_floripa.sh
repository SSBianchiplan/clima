#!/bin/bash
# Grande Florianópolis com o levantamento do estado (SIG-SC): altura medida + cor real do telhado em cada área
cd "$(dirname "$0")/.."
PY=${PY:-python3}
grep -v "^#" tools/cidades_floripa.txt | while read -r nome lon lat r; do
  [ -z "$nome" ] && continue
  bb=$(python3 -c "lo,la,r=$lon,$lat,$r; print(f'{lo-r:.4f},{la-r*.86:.4f},{lo+r:.4f},{la+r*.86:.4f}')")
  echo "== $nome $bb"; $PY tools/alturas_sigsc.py "$nome" "$bb" 2>&1 | tail -3
done
echo "##### SIG-SC Grande Florianópolis: fim"
