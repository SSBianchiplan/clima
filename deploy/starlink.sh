#!/usr/bin/env bash
# Baixa os elementos orbitais (TLE) da constelação Starlink do CelesTrak.
# O CelesTrak atualiza a cada 2 h e bloqueia downloads repetidos do mesmo IP,
# então quem baixa é o servidor (cron), e os navegadores leem a cópia local.
set -euo pipefail
D=/opt/clima/data
mkdir -p "$D"
TMP=$(mktemp)
if curl -sf --max-time 60 -A "GPlanSiS-Clima/1.0 (clima.gplansis.com)" \
     -o "$TMP" "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle" \
   && [ "$(grep -c '^1 ' "$TMP")" -gt 1000 ]; then
  chmod 644 "$TMP"; mv "$TMP" "$D/starlink.tle"
else
  rm -f "$TMP"   # mantém a última cópia boa
fi
