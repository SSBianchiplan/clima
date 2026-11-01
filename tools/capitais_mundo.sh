#!/bin/bash
# capitais nacionais do mundo (tools/cidades_capitais.txt), 3 ao mesmo tempo:
# 1) Google 2.5D + correção de torres pelo Wikidata (tools/alturas.py) onde há cobertura (Sul Global);
# 2) fora da cobertura — ou com o Overture já bom — torres e prédios altos do Wikidata (tools/alturas_wikidata.py).
# O resto da cidade já tem a escala global do GHSL. Duas passadas: a segunda refaz as que caíram por erro de rede.
# Saída de cada cidade sai junta no log (printf de uma vez) para não misturar linhas dos 3 processos.
cd "$(dirname "$0")/.."
PY=${PY:-python3}
inidx(){ python3 -c "import json,sys; sys.exit(0 if '$1' in json.load(open('public/data-heights/index.json')) else 1)" 2>/dev/null; }
# 3 cidades ao mesmo tempo (os GeoTIFFs são lidos direto da nuvem, sem disco; o gargalo agora é a CPU).
# O index.json tem trava (tools/alturas.py: indice), então os processos não se atropelam.
N=${PARALELO:-3}
trabalhador(){ k=$1
for passada in 1 2; do
grep -v "^#" tools/cidades_capitais.txt | awk -v n=$N -v k=$k 'NF && (NR-1) % n == k' | while read -r nome lon lat r; do
  if inidx "$nome" || grep -qx "$nome" tools/.capitais_wd_vazias 2>/dev/null; then [ $passada = 1 ] && echo "== $nome (já feito)"; continue; fi
  bb=$(python3 -c "lo,la,r=$lon,$lat,$r; print(f'{lo-r:.4f},{la-r*.86:.4f},{lo+r:.4f},{la+r*.86:.4f}')")
  out=$($PY tools/alturas.py "$nome" "$bb" 2>&1 | grep -v "^  baixando" | tail -6)
  printf '== %s %s\n%s\n' "$nome" "$bb" "$out"
  if ! inidx "$nome" && echo "$out" | grep -q "fora do Sul Global\|já boa no Overture"; then
    w=$($PY tools/alturas_wikidata.py "$nome" "$bb" 2>&1 | tail -1); echo "  $nome → torres do Wikidata: $w"
    inidx "$nome" || echo "$nome" >> tools/.capitais_wd_vazias   # sem prédio com altura no Wikidata: não tenta de novo
  fi
done
done; }
for k in $(seq 0 $((N-1))); do trabalhador $k & done
wait
echo "##### capitais do mundo: fim"
