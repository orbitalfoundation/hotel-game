# Lita Hotels!

Manage a hotel. Guests flood in, dogs have accidents in hallways, the
elevator breaks with people inside, robots run out of battery in the
dumbwaiter, and somebody suspicious is prowling the service corridor. Keep
happiness up or watch the Iversens storm out.

Hotels are procedurally generated from parametric briefs, rendered in 3D,
and populated by simulated guests, staff and robots. The manager on duty is
either a greedy heuristic — or **Claude**, playing the game live through a
structured snapshot/directive loop.

Built on the [orbital](../orbital/README.md) stack: one bus per running
hotel ([@orbitalfoundation/bus](https://github.com/orbitalfoundation/orbital-bus)),
[orbital-volume](https://github.com/orbitalfoundation/orbital-volume) for
rendering, [orbital-spatial](../orbital/orbital-spatial) for space.

**Play it live: https://lita-hotels.exe.xyz** (static deploy — the heuristic
manager runs the floor; the Claude manager needs a local run, see below and
[deploy/DEPLOYMENT.md](deploy/DEPLOYMENT.md)).

## Run it

```sh
npm install
npm start                      # http://localhost:8787
ANTHROPIC_API_KEY=... npm start   # same, plus the Claude manager works
```

Pick one of five hotels (country boutique, tropical resort, Brooklyn tower,
arctic lodge, underwater habitat). The day runs 06:00 → 24:00. Watch the
tasks tab, drag the **explode** slider to pull the floors apart, and flip
**manager** to Claude to let the LLM run the floor. Grade S–F at midnight.

```sh
npm test                       # layout validity + nav + sim behavior
npm run headless [hotel-id]    # a full day in the terminal, ~2 seconds
```

## How it works

A hotel exists at four levels with deterministic compilers between them —
LLMs/humans author only the top, so generated hotels are always physically
valid (see [docs/DESIGN.md](docs/DESIGN.md)):

```
L0 prose  →  L1 brief (parts + counts + adjacency)      src/grammar/
          →  L2 layout (rects, portals, verticals)       src/compile/layout.js
          →  nav graph (Dijkstra, per-world rules)       src/compile/navgraph.js
          →  L3 geometry (walls, props, themes)          src/compile/geometry.js
```

The sim is a set of coarse bus listeners, one per population
(`src/sim/`): guests (needs-driven parties), staff (with breaks), robots
(batteries, faults, dumbwaiter-only floor travel), systems
(elevators-as-agents), incidents (the drama generator), tasks (the board),
score. The manager — heuristic or Claude via `POST /api/manager` — sees a
compact snapshot and publishes `{directive}` events like everyone else.

The design history and research live in [devlog/](devlog/), including the
hotel-architecture research (space programs, the double-loaded slab canon)
and an assessment of the orbital approach vs. traditional game architecture.
