#!/bin/bash
# capitais: termina o miolo em andamento → área ampliada → repete as que falharam. Sorteadas e Wikidata: em espera.
cd /Volumes/Armazena2/climagplansis
while pgrep -f "alturas_lote.sh" >/dev/null; do sleep 60; done
for lista in tools/cidades_amp.txt tools/cidades_miolo.txt tools/cidades_amp.txt; do echo "##### $lista"; LISTA=$lista PY=/private/tmp/claude-501/-Volumes-Armazena2-climagplansis/1a5e808c-0af9-46a1-999a-b9eaada857fb/scratchpad/venv/bin/python ./tools/alturas_lote.sh; done
echo "##### fim"
