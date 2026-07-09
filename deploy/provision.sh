#!/usr/bin/env bash
# One-time setup of a fresh exe.dev VM for Lita Hotels: /srv layout, Caddyfile,
# docker enabled at boot (exe.dev quirk: it isn't by default), Caddy on :8000
# (the VM's default proxy_port). Usage: deploy/provision.sh [vm-name]
set -euo pipefail

VM="${1:-lita-hotels}"
HOST="$VM.exe.xyz"
DEST="exedev@$HOST"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH="ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ServerAliveInterval=5 -o ServerAliveCountMax=3"

echo "› preparing /srv on $HOST"
$SSH "$DEST" 'sudo mkdir -p /srv/site && sudo chown -R exedev:exedev /srv'

echo "› installing Caddyfile"
scp -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
  "$ROOT/deploy/Caddyfile" "$DEST:/srv/Caddyfile"

echo "› enabling docker + starting caddy on :8000"
$SSH "$DEST" '
  sudo systemctl enable --now docker
  docker rm -f lita-hotels 2>/dev/null || true
  docker run -d --name lita-hotels --restart unless-stopped \
    -p 8000:80 \
    -v /srv/site:/srv/site:ro \
    -v /srv/Caddyfile:/etc/caddy/Caddyfile:ro \
    caddy:2
  docker ps --filter name=lita-hotels --format "{{.Names}}  {{.Status}}"
'
echo "✓ provisioned — now run deploy/deploy.sh $VM"
