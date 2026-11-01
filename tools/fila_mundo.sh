#!/bin/bash
# depois do pacote da Grande Florianópolis: capitais do mundo; depois retoma a área ampliada das capitais brasileiras
cd /Volumes/Armazena2/climagplansis
PY=/private/tmp/claude-501/-Volumes-Armazena2-climagplansis/1a5e808c-0af9-46a1-999a-b9eaada857fb/scratchpad/venv/bin/python
while pgrep -f "tools/fila_floripa.sh" >/dev/null; do sleep 30; done
pkill -f "tools/fila.sh"; pkill -f "alturas_lote.sh"; sleep 2; pkill -f "tools/alturas.py"
echo "##### capitais do mundo (3D avançado)"
PY=$PY ./tools/capitais_mundo.sh
echo "##### retomando capitais brasileiras"
exec ./tools/fila.sh
