# 2026-07-09 — survey of the orbital stack before building lita-game

Four parallel read-throughs of the sibling repos, distilled. This is what
lita-game builds on and the exact contracts relied upon.

## orbital-bus (`@orbitalfoundation/bus`, packages/bus)

Tiny (<400 LOC) late-binding pub/sub kernel, ESM, env-neutral, one dep
(`@orbitalfoundation/utils` — logger + mulberry32).

- `createBus({description})` — no singleton; each bus independent.
- **Single blob model**: `bus.resolve(x)` registers x if it has a `resolve`
  function, otherwise dispatches it as an event. Arrays resolve in order.
- **First responder wins**: first listener returning non-`undefined` ends
  the walk (that's the query mechanism). Fan-out = nobody returns a value.
- Filters match **key presence** not value: `entity.resolve.filter = {tick:true}`.
  Ordering via `resolve.before` / `resolve.after` (topo sort).
- Registration immediately invokes the listener with `{registered:true}` —
  the init hook. `{id, obliterate:true}` removes a listener.
- `bus.install(name, svc)` hangs a service off the bus (`bus.spatial`...).
- **Tick driver built in**: batch `{run:true, ticks, dt}` (deterministic,
  awaited — use for headless tests) and realtime `{run:'realtime', hz, dt}`
  (rAF in browser, adaptive setTimeout in node) → publishes `{tick, t, dt}`.
- Manifests: `{load: url}` imports an ESM module; every export is resolved
  (listeners register, data dispatches); `inherits: url` = prefab merge.
- Events are LIVE and uncloned — listeners may decorate/mutate in flight;
  returning a value from a fan-out listener accidentally halts the chain
  (bit me once already: directive handlers must only return for their own
  actors).

## orbital-volume (v2.1, three.js 0.148 via importmap)

Declarative renderer; a single bus listener (`volume.js`), entities cached
by `uuid`. Blob with `volume` component = renderable; `tick` = repaint.

- Geometries: `scene`, `camera`, `light`, `cube/box/sphere/plane/cylinder`
  (cylinder/plane require `volume.props` = three ctor args), `file` (GLTF),
  `terrain`, `vegetation`, `layer`. **No text/line/sprite primitives.**
- `volume.material` ≈ Phong material props (`{color, opacity, transparent}`,
  `kind:'basic'` for MeshBasic).
- `volume.pose` {position, rotation (euler), scale} — accepts arrays or
  {x,y,z}. **After first render, pose.position/rotation/scale are rebound to
  the live three.js objects** — mutate them in place, no re-publish. This is
  the intended per-frame update path (delta-merge via publish is a stub).
- Scene handler owns renderer/camera per `div`; camera geometry adds
  OrbitControls (`pose.love` = orbit target); `prettier: true` = sRGB/ACES.
- Removal: set `entity.obliterate = true` and resolve it again.
- Mount: importmap (`three` → CDN), plain ES modules, no bundler.
- Caveat: every entity's handler re-runs every tick (cheap for built prims,
  it's how GLB mixers advance). Hundreds of entities OK; keep wall segments
  merged (the geometry compiler unions collinear intervals for this reason).

## orbital-spatial

Two halves. Tool: `makeSpatialHash({cellSize})` — uniform grid over
bounding spheres, `place` (upsert = move) / `near` (sorted, distances) /
`within` / `nearest` (expanding ring); guards the sparse-data blowup;
verified ~10k agents in single-digit ms. Concept: `attach(bus, opts)` —
reserves `{spatial: {query|command}}`, installs `bus.spatial`, and
**passively indexes any event carrying `id` + `pose`** (`pose:null`
removes). Pose = `{position:[x,y,z], rotation?, extent?}` in the world's
local frame (ontology: pose is physical truth; volume renders, never the
reverse).

## orbital-sim + reference/ (patterns, not dependencies)

- The ABM engine that drives orbital-sim's scenarios lives in
  `reference/20260417-sim/lib/sim/engine.js`: double-buffered state,
  `step/onEvents/view.neighbors` agent contract, spawns/despawns, seeded
  rng. Good pattern; not imported.
- **No pathfinding exists anywhere in the stack** — cloudreef boats use
  destination state machines with `@todo interpolate` teleports. Lita's
  portal-graph Dijkstra (src/compile/navgraph.js) is net-new.
- **No runtime LLM-in-the-loop exists** — orbital-puppet (reference/) has
  the closest shape: an `llm` component + a bus listener that consumes
  perception events and re-publishes utterances, with interrupt handling.
  Lita's manager follows that seam: snapshot in, `{directive}` events out.

## cloudreef-sim (reference/cloudreef-sim, Nov 2024, orbital-sys era)

The idiomatic app assembly: `index.html` importmap → `index.js` boots with
a `{load:[volume, agents/all.js]}` → `agents/all.js` manifest lists files
in Genesis order. One file per system; everything a plain exported object;
`emitter` component for spawning; one shared `organism.js` brain;
`Math.random() > 0.3` cognition budgets; hand-rolled clock (predates the
bus tick driver). Style: tabs, no semicolons, terse, `@todo` candor.

## Decisions this drove in lita-game

- One bus per running hotel; populations are **coarse listeners** (one
  `guests` listener owning all parties — never a listener per guest).
- Movement mutates live-bound `volume.pose` positions per tick; sim truth
  lives in plain `pos` arrays, render sync is a one-way copy at the end of
  each population's tick.
- Headless = same manifest minus volume, batch ticks, seeded rng.
- Characters are primitive composites (cylinder+sphere people, cube+eye
  robots) — no GLB dependency, no text labels (HUD carries names).
- Nav, elevators-as-agents, task board, and the LLM manager are the
  genuinely new layers; everything else rides the stack.
