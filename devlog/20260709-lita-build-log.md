# 2026-07-09 — lita-game: the one-day build

What got built today, in order, with the decisions and the bugs — so the
project can be re-speedrun later.

## Sequence

1. **Surveyed the stack** (four parallel read-throughs → 20260709-orbital-
   stack-survey.md) and **researched hotel architecture** (→ 20260709-hotel-
   architecture-procedural-generation.md). The two files anchor everything.
2. **Grammar** — `src/grammar/parts.js`: closed vocabulary of ~30 part
   kinds with defaults (size, capacity, world: guest/service/robot, ground-
   floor band). `briefs.js`: five hotels as L1 data with prose preserved.
3. **Layout compiler** — `src/compile/layout.js`: spine-and-slots double-
   loaded slab. Banded podium (front / guest hall / amenities / service
   hall / BOH), guest floors above, vertical core (elevator + stairs +
   dumbwaiter) at a fixed rect across floors, robot nook + linen closet per
   guest floor. Emits areas (rects), portals (doors with widths), verticals.
4. **Nav graph** — `src/compile/navgraph.js`: nodes = area centers +
   portals; portal-to-portal shortcuts inside convex areas; Dijkstra with
   per-world edge rules (guests never in BOH, robots never on stairs or in
   the guest elevator, robot cost penalty in guest corridors).
5. **Geometry compiler** — `src/compile/geometry.js`: walls by interval
   union minus portal gaps (no doubled shared walls), per-kind floor tiles
   and props, five theme palettes with scatter dressing (palms / city
   blocks / ice / reef). Dollhouse: no ceilings + explode offset per floor.
6. **Sim** — coarse population listeners per the workspace rules:
   `tasks` (the board: patience, expiry, markers), `systems` (elevator +
   dumbwaiter cabs with capacity-by-weight, failures), `mover` (shared
   path-following with occupancy metering + ride delegation), `guests`
   (parties as needs-driven state machines, happiness, walkouts), `staff`
   (roles/capabilities, breaks, station drift), `robots` (battery, faults,
   charge-seeking, dumbwaiter-only floors), `incidents` (spills, HVAC,
   breakdowns, bad actors that get bored and leave), `score`.
7. **Managers** — one contract, two implementations. Heuristic: greedy
   nearest-capable dispatch every 2s, keeps the desk covered, reboots and
   charges robots. LLM: browser POSTs a compact snapshot to `/api/manager`
   every 9s; server calls claude-opus-4-8 with structured outputs
   (json_schema: thought + directives); directives are ordinary
   `{directive}` bus events. On API failure the heuristic covers
   seamlessly; three straight failures flips the mode back.
8. **Web** — importmap maps bus/utils/spatial to the sibling repos and
   three to CDN; `server.js` serves the workspace root and the manager
   endpoint. Picker → scene → world → geometry → HUD (meters, tabs, feed,
   speed/pause/explode/manager controls).
9. **Verified** — 14 node tests (layout validity, nav rules per world, sim
   behaviors, directive protocol, elevator failure/repair) plus headless
   full days for all five hotels plus Playwright-driven Chrome runs with
   screenshots for three of them.

## Bugs worth remembering

- **Renderables before the scene = silent nothing + thrown handler.** The
  world spawns staff at construction; the volume scene entity must be
  published first. (Boot order: volume → scene → world → geometry.)
- **Server rewrote `/` to the picker page, so relative `./app.js` 404'd.**
  Absolute paths in the HTML.
- **Balance bug 1:** incident rates had a stray ×10 → a spill every 30s.
- **Balance bug 2:** sneaks never left hotels with no security capability →
  infinite mischief. Sneaks now get bored (`leaveT`).
- **Balance bug 3:** guests generated a request every 30–90s; 14 parties =
  4× workforce capacity. Requests now every 2–6 minutes.
- **Balance bug 4:** "blocked" happiness decay of 0.25/s treated elevator
  queues as jams → walkout storms in tall/wide hotels (23 walkouts at
  Hoyt Street). Queueing is hotel life: decay only after 8s, gently.
- **Robot gridlock:** one-bot-per-corridor applied to the service hall too;
  five robots deadlocked in BOH. Guest halls stay exclusive (that's the
  fun), service hall allows two.
- Task patience must cover *real* travel (pickup leg + elevator queue +
  work); anything under ~3 minutes for a cross-floor delivery expires on
  workers already en route.

## Balance snapshot (heuristic manager, seeds as committed)

| hotel | grade | happiness | resolved/expired | walkouts |
|---|---|---|---|---|
| juniper-house | A | 79 | 11/5 | 1 |
| palm-lagoon | B | 55 | 18/8 | 1 |
| hoyt-street | B | 59 | 18/12 | 3 |
| aurora-station | A | 89 | 37/12 | 1 |
| meridian-deep | A | 81 | 28/5 | 1 |

The big hotels grade B under the heuristic — that's the headroom the LLM
manager is supposed to demonstrate. Next session: run Claude on
palm-lagoon/hoyt-street with a key and compare.

## Round 2 (same day, after playtest feedback)

- **Repo:** pushed to github.com/orbitalfoundation/hotel-game (public).
- **Wall-walking fixed** — the cause was `outdoor` being one giant rect
  *containing* the building, so outdoor legs cut straight through walls.
  Outdoors is now a ring of four strips with corner portals; people walk
  around the building. (Indoor routing was already wall-safe: all areas are
  convex rects, and within-area segments can't leave them.)
- **Semantic furniture** — the bed now backs onto the wall opposite the
  room's door (portal lookup in the geometry compiler), dresser beside the
  door. General principle established: props read the portal graph.
- **Floor picker** — HUD row [all][G][1][2]…; picking a floor hides all
  static geometry above it (dollhouse slice) and the view-sync listener
  hides dynamic actors/cabs/markers/labels on hidden floors each tick.
- **Lighting** — extended orbital-volume: shadow config on lights, prims
  cast/receive by default, and a `line` handler (see orbital-volume devlog
  20260709-lines-lights-shadows.md). Scene runs `prettier` (ACES + soft
  shadow maps); the sun orbits with the game clock (warm at golden hours,
  cool moonlight + darkened sky after 20:00, fog/background lerped per theme).
- **The 3D view is now a HUD** — `web/overlay.js` projects DOM labels
  through the camera: persistent task callouts (urgency pulse, dashed when
  assigned), transient toasts ("the Petrovs checking in!", "elevator down —
  3 trapped inside!"), and hover cards on every person/robot. `web/app.js`
  draws dashed planned-route trails for staff/robots on a job (from
  `mover.remaining`). Found + fixed along the way: elevator cabs were never
  visually synced (nothing called `systems.sync`).
- **Mobile** — under 760px the HUD becomes a collapsible bottom sheet.
- Verified throughout with Playwright-driven Chrome screenshots (day, night,
  floor-isolated, mobile collapsed).

## Open threads

- LLM manager not yet exercised against the real API (no credentials in
  the build environment) — the endpoint, schema, fallback, and toggle are
  tested; the actual Claude-vs-heuristic comparison is the first thing to
  do next.
- Prose→brief (L0→L1) generator: deliberately deferred; the brief schema
  is the contract, so it's an isolated feature.
- Candidates for extraction into orbital packages: navgraph + mover
  (portal-graph pathfinding with occupancy), and the population-listener
  pattern writeup. See 20260709-approach-assessment.md.
- Volume wishlist filed in the assessment: `static: true` build-once hint,
  finished delta-merge, a text/sprite primitive.
