#!/bin/bash
# sul da Ilha, bairro a bairro (áreas pequenas = cada uma pronta em minutos e publicada na hora)
cd "$(dirname "$0")/.."
PY=${PY:-python3}
while read -r nome bb; do
  [ -z "$nome" ] && continue
  echo "== $nome $bb"
  $PY tools/alturas_sigsc.py "$nome" "$bb" 2>&1 | tail -2
  $PY tools/predios_sigsc.py "$nome" "$bb" 2>&1 | tail -3
  bash tools/publicar_alturas.sh >/dev/null 2>&1 && echo "  publicado"
done <<'L'
ribeirao-ilha -48.5900,-27.7400,-48.5450,-27.6950
caiacanga -48.5800,-27.7700,-48.5350,-27.7350
armacao -48.5300,-27.7650,-48.4850,-27.7250
pantano-sul -48.5350,-27.7950,-48.4950,-27.7600
caieira-barra-sul -48.5800,-27.8300,-48.5350,-27.7700
L
echo "##### detecção: fim"
