# Lita Hotels — design

A hotel-management game. Hotels are procedurally generated from a parametric
description, rendered in 3D, and populated by simulated guests, staff, and
robots. An LLM (or later, a human player) manages the hotel by directing
staff and robots to handle guest needs and incidents. Guest happiness is the
score.

This document records the architecture. It is written to be read alongside
the orbital workspace conventions (`../orbital/README.md`): the bus is the
spine, entities are component bags, populations are coarse single listeners.

## The four representations of a hotel

The central design move is that a hotel exists at four levels, with a
deterministic compiler between each adjacent pair. LLMs (or humans) author
only the top level; everything below is ordinary code, so hotels are always
physically valid.

```
L0  prose        "a boutique hotel on a back-country road, five stories…"
     │  (LLM or human authors L1 from L0 — creative, offline for now)
L1  brief        parts + parameters + adjacency wishes     (data, JSON)
     │  (layout compiler — deterministic code, seeded)
L2  layout       rooms with rects on a floor grid + portal graph (data)
     │  (geometry compiler — deterministic code)
L3  geometry     walls/floors/doors/props as renderable volumes (data)
```

- **L1 brief** is the "architectural program" of the hotel: a list of parts
  drawn from a closed vocabulary (below), counts and sizes, floors, theme,
  and adjacency requirements ("kitchen ADJACENT breakfast", "front desk
  SEES entrance"). This is the level a conversation grounds into. It cannot
  express an impossible hotel because it doesn't express coordinates at all.
- **L2 layout** is the truth the *simulation* runs on: axis-aligned rects on
  a per-floor grid (1 unit = 1 meter), a portal graph (doors/openings
  connecting areas), and vertical connectors (elevators, stairs,
  dumbwaiters) linking floors. The nav graph, capacities, and congestion all
  derive from L2. The renderer never invents truth; it reads L2/L3.
- **L3 geometry** is presentation only: wall slabs with door holes, floor
  and ceiling panels, furniture props, palette per theme.

Seed strategy (per the brief): we statically author five L1 briefs
(tropical resort, Brooklyn downtown, arctic station, underwater, space) and
compile them. An interactive prose→L1 generator is a later, separable
feature — the compiler doesn't change.

## The part vocabulary (hotel lego bricks)

Grounded in real hotel space programming (front-of-house / back-of-house).
Each part kind carries defaults (typical size, capacity, service flags) so
briefs stay terse.

Front of house: `entrance`, `lobby`, `front_desk`, `lounge`, `breakfast`,
`restaurant`, `bar`, `guest_room`, `suite`, `pool`, `gym`, `spa`,
`business_center`.

Back of house: `kitchen`, `laundry`, `housekeeping`, `storage`,
`engineering`, `office`, `security_office`, `staff_room`, `loading_dock`.

Robot infrastructure: `robot_bay` (service/charging), `robot_nook`
(per-floor charging closet), `dumbwaiter` (robot-only vertical connector).

Circulation: `corridor`, `elevator`, `service_elevator`, `stairs`,
`emergency_exit`, `porte_cochere`, `parking`.

Rules encoded in the compiler, not re-stated per hotel:
- every habitable part connects (transitively) to the lobby and to an
  emergency exit; guests never path through back-of-house;
- staff/robot traffic prefers service circulation (service elevator,
  dumbwaiter, BOH corridors);
- canonical adjacencies as soft constraints: kitchen↔breakfast/restaurant,
  housekeeping↔service core, front desk sightline to entrance, laundry near
  service elevator.

## The layout compiler (L1 → L2)

Deliberately simple and reliable rather than clever: a **spine-and-slots**
scheme, the double-loaded-corridor archetype real hotels actually use.

- Guest floors: a corridor spine with room slots on both sides; the vertical
  core (elevators, stairs, dumbwaiter, robot nook, linen closet) anchors one
  end or the middle.
- Ground floor: front band (porte-cochère, lobby, front desk, lounge),
  amenity band (breakfast/restaurant/pool/gym per brief), back band
  (kitchen, laundry, housekeeping, engineering, offices, robot bay, loading
  dock), with a BOH corridor separating guest space from service space.
- Parking is a detached or attached slab per brief.
- Output: per-floor list of `{ id, kind, rect: [x, y, w, h], floor }` plus
  portals `{ a, b, at: [x, y], width, kind: door|opening|elevator_door }`
  and vertical connectors with capacities.

Everything downstream (nav graph, congestion, rendering) is derivation, so
alternate compilers (courtyard, tower, minecraft-style) can arrive later
without touching the sim.

## Simulation (bus arrangement)

One bus per running hotel. Following the coarse-unit principle, each
*population* is one listener:

- `guests` — owns all guest parties (singles, couples, families). Each party
  is a needs-driven state machine (arrive → check in → room → eat/swim/
  sleep…) with a happiness scalar decayed by waiting and boosted by service.
  Parties spawn in waves (check-in rush, breakfast rush, random arrivals).
- `staff` — housekeepers (with carts), front desk, kitchen, valet, security,
  manager. Idle staff can accept directives; they also have shifts/breaks.
- `robots` — cleaning / delivery / security bots: battery, charge-seeking,
  fault states, task queues. Use dumbwaiters between floors.
- `systems` — elevators (called, capacity-limited, can fail), automatic
  doors, HVAC. Modeled as agents so they can break and be fixed.
- `incidents` — the drama generator: spills, towel requests, room service
  orders, dog accidents, broken elevator, bad actors probing doors. Emits
  `task` entities with a location, requirement (capability), and patience
  timer.
- `nav` — owns the nav graph derived from L2; answers path queries; enforces
  capacity (elevator cab limits, one-robot-per-corridor-segment rules) so
  logjams are real.
- `score` — aggregates happiness, complaints, resolved/expired tasks into
  the win/lose meter.
- `manager` — the player. Sees a compact structured snapshot (who/where/
  status/tasks), issues directives `{ directive: { actor, action, target } }`.
  Two implementations, same contract: `manager-llm` (Claude via a tiny local
  proxy) and `manager-heuristic` (greedy dispatcher, always available, also
  the baseline to beat).

Space: `orbital-spatial` attached to the hotel bus indexes every
pose-bearing entity passively; proximity queries serve collision softening
and "who is near the spill".

Time: a fixed-step driver (sim ticks ~5–10 Hz, agents interpolate) published
as `{ tick }`; the manager runs on a slower cadence (every few seconds of
sim time).

## Rendering

`orbital-volume` in the browser reads pose + volume components. The sim
publishes entity upserts on the hotel bus; the renderer is just another
listener — state and presentation stay separated, headless runs (tests,
balance tuning) drop the renderer entirely.

Web shell: pick-a-hotel page → 3D view (orbit camera, floor slicing),
side panel with the manager's directive feed, task list, happiness meter.
