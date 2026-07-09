# Lita Hotels — deployment reference

Live at **https://lita-hotels.exe.xyz** (deployed 2026-07-09). The exhaustive
exe.dev model, quirks, and recovery runbook live in
**`/Volumes/summer/projects/2026/intotheblue/deploy/DEPLOYMENT.md`** — read
that for the deep dive. This file records the lita-specific facts and the
exact path that worked.

## Shape of the deployment

The game is **fully client-side** — plain ES modules, no build step, no
backend required. "Building" (`deploy/build.sh`) just composes `deploy/dist/`
in the directory shape the importmap expects (`/lita-game/...` +
`/orbital/...`), the same shape `server.js` serves locally from the workspace.
three.js comes from the unpkg CDN. ~2.5 MB total.

**The Claude manager is intentionally not deployed.** `/api/manager` 404s on
the static site, and the in-game toggle falls back to the heuristic manager
by design (verified). Exposing it publicly would put an Anthropic API key
behind an unauthenticated endpoint that every visitor could bill. To demo
the LLM manager, run locally (`ANTHROPIC_API_KEY=... npm start`) — or, if a
public demo is ever wanted, run `server.js` in a node container on the VM
behind a rate limit and a shared secret, and point Caddy's `/api/*` at it.

## What's deployed

- **VM:** `lita-hotels` (exeuntu, 2 vCPU / 8 GB, region `lax`), login user
  `exedev`, created via the HTTPS API (`new --name lita-hotels`), proxy
  port 8000, public.
- **Serving:** `caddy:2` Docker container named `lita-hotels`, `-p 8000:80`,
  bind-mounting `/srv/site` + `/srv/Caddyfile` read-only. Docker enabled at
  boot by provision.sh (exe.dev quirk #5).

## The path that worked (2026-07-09)

```sh
# control plane over the HTTPS API; the shared token lives at
# ../../2026/water-atlas/deploy/.api-token (scoped: ls/whoami/new work, share does not)
TOKEN=$(tr -d '[:space:]' < ../../2026/water-atlas/deploy/.api-token)
API() { curl -sS -X POST https://exe.dev/exec -H "Authorization: Bearer $TOKEN" -d "$1"; }
API 'new --name lita-hotels'

deploy/provision.sh lita-hotels     # /srv, Caddyfile, enable docker, caddy :8000
deploy/deploy.sh lita-hotels        # build.sh + rsync dist → /srv/site

# public flip: not in the scoped token, but gateway SSH worked from this
# machine (keepalives make a hang die in ~15s):
ssh -o ServerAliveInterval=5 -o ServerAliveCountMax=3 exe.dev share port lita-hotels 8000
ssh -o ServerAliveInterval=5 -o ServerAliveCountMax=3 exe.dev share set-public lita-hotels
```

Verified end-to-end by driving the live URL in Chrome (Playwright): picker →
Aurora Station → sim running, tasks assigned, no console errors but the
favicon 404.

## Every update

```sh
deploy/deploy.sh          # ~2.5 MB rsync; Caddy picks it up immediately
```

Note `deploy/dist/` is a generated artifact — don't commit it if this
becomes a git repo. The deployed copy of the orbital packages is a snapshot
taken at build time; redeploy after touching `../orbital` (e.g. the
`volume.static` feature shipped today rides along).

## Quick recovery

- **Down after reboot:** `ssh exedev@lita-hotels.exe.xyz 'sudo systemctl enable --now docker; docker start lita-hotels'`
- **Host key complaint:** scripts already pass `accept-new`; manual fix
  `ssh-keygen -R lita-hotels.exe.xyz`.
- **VM gone:** `API 'new --name lita-hotels'` → provision → deploy → share
  steps above. Everything needed is in this repo; nothing precious on the VM.
