#!/bin/bash
# prioridade: Grande Florianópolis logo depois da área ampliada de Salvador; depois retoma a fila das capitais
cd /Volumes/Armazena2/climagplansis
PY=/private/tmp/claude-501/-Volumes-Armazena2-climagplansis/1a5e808c-0af9-46a1-999a-b9eaada857fb/scratchpad/venv/bin/python
while pgrep -f "tools/alturas.py salvador" >/dev/null; do sleep 30; done
# pausa a fila (o lote já pode ter começado a próxima cidade: o download é retomável, nada se perde)
pkill -f "tools/fila.sh"; pkill -f "alturas_lote.sh"; sleep 2; pkill -f "tools/alturas.py"
echo "##### Grande Florianópolis (3D avançado)"
for i in 1 2 3; do LISTA=tools/cidades_floripa.txt PY=$PY ./tools/alturas_lote.sh; done
echo "##### retomando capitais"
exec ./tools/fila.sh
