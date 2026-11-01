#!/usr/bin/env bash
# Publica o GPlanSiS Clima na vps2 do hub. Rode da RAIZ do projeto.
#
#   bash deploy/enviar.sh              # só os arquivos do site
#   PRIMEIRA=1 bash deploy/enviar.sh   # também instala o bloco do Caddy
#
# tar por SSH (funciona igual em macOS, Linux e Git Bash).
set -euo pipefail
# servidor: variável VPS ou o arquivo local deploy/.vps (fora do git), ex.: root@seu-servidor
VPS="${VPS:-$(cat "$(dirname "$0")/.vps" 2>/dev/null)}"
[ -n "$VPS" ] || { echo "Defina VPS=usuario@servidor ou crie deploy/.vps"; exit 1; }
CHAVE="${CHAVE:-$HOME/.ssh/hostinger_gplansis}"
APP=/opt/clima
SSH="ssh -i $CHAVE -o BatchMode=yes -o ConnectTimeout=20"

echo "==> site -> $VPS:$APP/public"
COPYFILE_DISABLE=1 tar --no-mac-metadata --exclude='.DS_Store' -czf - public | \
  $SSH "$VPS" "rm -rf $APP.novo && mkdir -p $APP.novo && tar xzf - -C $APP.novo --no-same-owner \
    && rm -rf $APP/public.antigo && mkdir -p $APP \
    && { [ -d $APP/public ] && mv $APP/public $APP/public.antigo || true; } \
    && mv $APP.novo/public $APP/public && rmdir $APP.novo \
    && chmod -R a+rX $APP/public"

if [[ "${PRIMEIRA:-0}" == 1 ]]; then
  echo "==> starlink (cron + primeira carga)"
  $SSH "$VPS" "mkdir -p $APP/bin $APP/data && cat > $APP/bin/starlink.sh && chmod 755 $APP/bin/starlink.sh" < deploy/starlink.sh
  $SSH "$VPS" "cat > /etc/cron.d/clima-starlink && chmod 644 /etc/cron.d/clima-starlink" < deploy/clima-starlink.cron
  $SSH "$VPS" "[ -s $APP/data/starlink.tle ] || $APP/bin/starlink.sh; ls -la $APP/data"
  echo "==> coletor de voos (cron 3 min)"
  $SSH "$VPS" "cat > $APP/bin/air-collector.py && chmod 755 $APP/bin/air-collector.py" < deploy/air-collector.py
  $SSH "$VPS" "cat > /etc/cron.d/clima-air && chmod 644 /etc/cron.d/clima-air" < deploy/clima-air.cron
  echo "==> caddy"
  # Se a validação falhar, o Caddyfile volta ao backup e o Caddy nem é recarregado.
  # chave da TomTom: arquivo só local (deploy/clima-tomtom.caddy, fora de versionamento), legível só pelo caddy
  if [[ -f deploy/clima-tomtom.caddy ]]; then $SSH "$VPS" "umask 077; cat > /etc/caddy/clima-tomtom.caddy && chown root:caddy /etc/caddy/clima-tomtom.caddy && chmod 640 /etc/caddy/clima-tomtom.caddy" < deploy/clima-tomtom.caddy; fi
  $SSH "$VPS" "cat > /etc/caddy/clima.caddy" < deploy/clima.caddy
  # O log precisa existir com dono caddy: o validate roda como root e não pega isso.
  $SSH "$VPS" "touch /var/log/caddy/clima.log && chown caddy:caddy /var/log/caddy/clima.log"
  $SSH "$VPS" "set -e; BAK=/etc/caddy/Caddyfile.bak-clima-\$(date +%Y%m%d-%H%M%S); cp /etc/caddy/Caddyfile \$BAK; \
    grep -q 'import /etc/caddy/clima.caddy' /etc/caddy/Caddyfile \
      || printf '\n# GPlanSiS Clima\nimport /etc/caddy/clima.caddy\n' >> /etc/caddy/Caddyfile; \
    if caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then systemctl reload caddy; echo 'caddy recarregado'; \
    else cp \$BAK /etc/caddy/Caddyfile; caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -3; echo 'VALIDACAO FALHOU - Caddyfile restaurado'; exit 1; fi"
fi

echo "==> verificação"
sleep 2
curl -s -o /dev/null -w 'clima.gplansis.com %{http_code}\n' https://clima.gplansis.com/ || true
