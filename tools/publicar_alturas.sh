#!/bin/bash
# publicação leve: só os arquivos de altura que mudaram + sw.js (o enviar.sh manda o site inteiro, ~50 MB)
cd "$(dirname "$0")/.."
rsync -az --partial --timeout=120 public/data-heights/ vps2:/opt/clima/public/data-heights/ && \
rsync -az --timeout=60 public/sw.js vps2:/opt/clima/public/sw.js && \
ssh vps2 "chmod -R a+rX /opt/clima/public/data-heights /opt/clima/public/sw.js" && \
curl -s https://clima.gplansis.com/sw.js | grep -o 'clima-v[0-9]*'
