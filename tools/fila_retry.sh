#!/bin/bash
# depois da fila principal: repete todas as listas (as feitas são puladas) para refazer as que falharam
cd /Volumes/Armazena2/climagplansis
while pgrep -f "tools/fila.sh" >/dev/null; do sleep 120; done
for lista in tools/cidades_miolo.txt tools/cidades.txt tools/cidades2.txt; do LISTA=$lista PY=/private/tmp/claude-501/-Volumes-Armazena2-climagplansis/1a5e808c-0af9-46a1-999a-b9eaada857fb/scratchpad/venv/bin/python ./tools/alturas_lote.sh; done
