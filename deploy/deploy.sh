#!/usr/bin/env bash
# Build the static site and push it to the exe.dev VM. Run for every update.
# Usage: deploy/deploy.sh [vm-name]        (default: lita-hotels)
set -euo pipefail

VM="${1:-lita-hotels}"
HOST="$VM.exe.xyz"
DEST="exedev@$HOST"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH="ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ServerAliveInterval=5 -o ServerAliveCountMax=3"

"$ROOT/deploy/build.sh"

echo "› syncing deploy/dist/ → $HOST:/srv/site"
rsync -avh --delete -e "$SSH" "$ROOT/deploy/dist/" "$DEST:/srv/site/"

echo "✓ deployed → https://$HOST"
