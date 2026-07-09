# 2026-07-09 — how I'd approach this vs. how orbital approaches it

Written after building lita-game end-to-end on the orbital stack in one day —
so this is an assessment from inside the machine, not from a podium.

## How I would approach this project cold

If I were starting with no house style, I'd reach for the standard game-dev
toolkit:

- **An ECS library or engine** (bitecs/miniplex, or just Unity/Godot if 3D
  polish mattered most). Entities in typed arrays, systems as ordered
  functions over queries, fixed-timestep loop.
- **A scene graph owned by the game** — the renderer is not an observer, it
  IS the program, and game state lives in objects that hold their own
  meshes.
- **A build step** — TypeScript, Vite, npm everything.
- **Direct calls everywhere** — `elevator.request(floor)`, not messages.
- The same four-layer generation pipeline I built here (prose → brief →
  layout → geometry) — that part is domain logic and stack-independent; any
  approach needs it, and the literature (double-loaded slab, space
  programs, adjacency canon) dictates its shape.

That toolkit is optimized for shipping one game with maximum runtime
performance and tooling comfort. Orbital is optimized for something else,
and the difference is worth naming precisely.

## What the orbital approach actually is

Four commitments, unusual in combination:

1. **A late-binding bus instead of an import graph.** Capabilities register
   at runtime and speak in plain objects; nothing holds a reference to
   anything else. First-responder returns double as queries.
2. **Entities as component bags, presence-is-the-type.** No classes, no
   `type` field, a shared ontology of words (`pose`, `about`, `volume`)
   that multiple codebases agree on.
3. **State/presentation divorce.** The renderer (orbital-volume) is just
   another listener; a sim is complete and runnable with the renderer
   absent. Pose is physical truth; volume is looks.
4. **Coarse-unit composition.** A thousand agents are one listener owning
   an array — churn stays inside modules, the bus carries meaning.

## Where it was strong (observed, not theorized)

- **Headless-first fell out for free.** The identical sim runs in node
  batch mode (deterministic, seeded, 14 tests, full-day balance runs in
  ~2 seconds) and in the browser at 60fps. I tuned game balance by running
  five full hotel days from the CLI. In an engine-centric architecture,
  that separation is a week of discipline; here it was the default. This
  was the single biggest accelerant today.
- **Legibility to an LLM (and to humans).** Everything is a plain object
  or a function over plain objects. No framework ceremony, no build step,
  no type gymnastics. I could hold the entire runtime contract in my head:
  blobs in, blobs out, filter on key presence. cloudreef's README asks
  whether these tools make sims buildable by AI assistants — empirically,
  yes; I built a 3,000-line game against contracts I learned from reading
  four READMEs.
- **Late binding earned its keep at the seams.** The LLM manager and the
  heuristic manager are interchangeable because both just publish
  `{directive}` events; the HUD reads world state without the sim knowing
  the HUD exists; the volume renderer attached with one `{load}` line. The
  bus made the *boundaries* cheap, exactly as advertised.
- **The ontology is real leverage.** Because `pose` means one thing,
  orbital-spatial indexes agents passively, the renderer reads them
  without negotiation, and my sim code never wrote an adapter. A shared
  dictionary beats a shared framework.
- **`{run: batch}` vs `{run: 'realtime'}`** — one flag flips between
  deterministic tests and a living game. Underrated.

## Where it was weak (also observed)

- **Events are live and uncloned, and first-responder is a footgun.** A
  listener that accidentally returns a value silently halts fan-out. I had
  to be careful that the staff directive handler returns `undefined` for
  robot directives. This is the price of the single-blob model; SPEC.md
  documents it, but it *will* bite newcomers.
- **The renderer's per-tick re-invocation of every entity handler** is
  O(entities) per frame even for static walls. At lita's scale (~600
  entities) it's fine; at 5,000 it won't be. The volume `_update` delta
  merge is also a stub — live mutation of bound poses is the only real
  update path, which works but is an implicit contract you must know.
  Similarly there's no text/sprite primitive, so labels have to live in
  the HUD.
- **Ordering is convention, not structure.** The scene must exist before
  renderables (my first browser run crashed on exactly this); populations
  should tick after the clock. `before`/`after` hints exist, but the
  system trusts you. A traditional engine's explicit system ordering is
  ugly and verbose — and never lets this bug exist.
- **No spatial/nav layer existed** — expected; the README says worlds are
  arriving. Lita's portal-graph Dijkstra + occupancy metering
  (src/compile/navgraph.js, src/sim/mover.js) is exactly the kind of
  piece that wants extraction into an orbital package once a second sim
  needs it (the "note the shape, don't create the package" rule applied).
- **Query cost discipline is on you.** `bus.resolve` walks every listener
  per event. Keeping populations coarse made this a non-issue, but the
  architecture depends on everyone following rule 4; one naive
  listener-per-guest design would melt it.
- **Debugging is grep-shaped.** With no static import graph, "who consumes
  this event" is answered by convention and search, not by tooling. Fine
  at this scale, real cost at 10x.

## Net assessment

For this project — a simulation whose core loop is *meaning* (tasks,
needs, directives) rather than *physics*, with an LLM as both builder and
player — the orbital approach was a genuine advantage, and I would not
swap it for the traditional stack. The places it was weak were all
scale-and-tooling weaknesses, not correctness weaknesses, and all have
known escape hatches (a real update-batching pass in volume, extracted
nav, system-order assertions).

The honest framing: traditional game architecture optimizes the *inside*
of one program; orbital optimizes the *boundaries between* programs —
sim/render, sim/test, sim/LLM, this-sim/next-sim. Lita spent almost all
of today's effort at boundaries. That's why it fit.

Two recommendations back to the stack:
1. ~~Volume should support a `static: true` hint~~ — **shipped today**
   (orbital-volume `volume.static`, see its devlog 20260709-static-
   entities.md); lita marks all hotel geometry static. Still open on the
   volume side: finish delta-merge `_update`, and a text/sprite primitive
   for in-world labels.
2. The pause/dt-gating pattern and the population-listener shape
   (tick → step-all → sync-render) recurred in every lita module; that's
   a candidate `ecosystem-agents` convention worth writing down in the
   ontology's terms.
