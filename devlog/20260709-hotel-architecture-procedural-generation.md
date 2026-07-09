# 2026-07-09 — hotel architecture + procedural generation research

Research pass done before writing the lita-game hotel generator. This is the
domain grounding for `src/grammar/parts.js` and `src/compile/layout.js`.

## Hotel space programming (the professional decomposition)

The standard document in the trade is the "building program" / design brief:
a list of activities, space allocations (usually per key = per guest room),
and adjacency relationships, drawn first as a bubble diagram with the lobby
as the hub joining public zones and back-of-house. Canonical texts: deRoos,
*Planning and Programming a Hotel* (Cornell); Rutes/Penner/Adams, *Hotel
Design, Planning and Development*.

Top-level decomposition:
- **Guestrooms block** (rooms + corridors + floor cores + floor pantries):
  65–85% of total floor area; the design goal is to maximize this.
- **Public / front-of-house**: lobby & front desk, F&B outlets, function
  space, retail, pool/fitness/spa, public toilets.
- **Back-of-house**: kitchens, receiving/loading, storage, housekeeping +
  laundry + linen, employee facilities, engineering/mechanical, admin.

Numbers worth encoding as defaults:
- Gross area per key: economy ~420 sf → resort/luxury ~780 sf; non-room
  share 10% (economy) to ~30% (luxury).
- Kitchen ≈ 30–45% of restaurant area; food storage ≈ 35–40% of kitchen.
- BOH ≈ 20–25% of total (up to 40% at resorts); laundry ~7 sf/key; linen
  ~3 sf/key; mechanical 13–18 sf/key.
- Guest room module ~12'–13'6" wide × 25'–30' deep (we use 5m × 8m).
- Corridor: 5 ft (1.5 m) min clear, 6–7 ft upscale (we use 2.6 m).
- Rooms per floor: double-loaded slab commonly 16–30; elevator-to-farthest-
  room ≤ ~150 ft; two egress stairs per floor at corridor ends.
- Elevators: ~1 passenger car per 75–100 keys; service elevators = 30–40%
  of passenger count (min 1); one housekeeping/linen pantry per guest floor
  adjacent to the service core (this is exactly our per-floor linen closet
  + robot nook).

## Massing archetypes (Rutes/Penner taxonomy)

1. **Double-loaded slab** — rooms both sides of a central corridor; most
   efficient (~70–75% salable). The default for low/mid-rise. **This is the
   archetype lita's layout compiler implements.**
2. Offset/staggered slab — corridor shifts around a mid-slab core.
3. Single-loaded slab — view-driven (resorts); 55–65% efficient.
4. Tower — central core ringed by 16–24 rooms/floor.
5. Atrium — Portman-style galleries over a grand lobby; <60% efficient.
6. Courtyard — rooms wrap a landscaped court.
7. Motel / exterior corridor — cheapest, parking at the door.

Canonical adjacencies (encoded as layout-compiler rules, not per-hotel data):
- Front desk sightline to every guest entrance; front office behind desk.
- Lobby is the hub: entrance, desk, vertical core, F&B, function, retail.
- Kitchen adjacent to all F&B outlets and banquet via service corridor;
  kitchen ↔ receiving/storage.
- Housekeeping ↔ laundry ↔ linen ↔ service elevator, landing beside floor
  pantries on every guest floor.
- Employee entrance → time clock/security → lockers → cafeteria, all on the
  BOH corridor. Golden rule: **guest and service circulation never cross.**

## Procedural floor-plan literature (approaches to borrow later)

- Squarified treemaps (Marson & Musse 2010) — partition footprint into
  near-square rooms by target area, carve corridors. Fast, game-oriented.
- Constrained growth (Lopes et al. 2010) — rooms grow cell-by-cell on a
  grid from seeds; handles irregular footprints.
- Graph/connectivity-driven — embed a program adjacency graph, place doors,
  add corridors for unmet edges; rectangular dualization (Shekhawat,
  arXiv:1910.00081) makes it exact.
- Merrell/Schkufza/Koltun 2010 — Bayesian nets over programs + stochastic
  search; the classic data-driven layout paper.
- Shape/split grammars — Wonka 2003, Müller CGA Shape 2006 (CityEngine);
  ideal for the slab→bays→rooms split step.
- MIQP/MIP space planning (Wu et al. 2018) — rooms as rectangles with
  linear adjacency/size constraints.
- Deep: RPLAN, Graph2Plan, House-GAN — bubble-diagram-in floorplan-out;
  overkill for the game but the graph conditioning maps onto our L1.

## What lita actually does with this

Four representations with deterministic compilers between them (L0 prose →
L1 brief → L2 layout → L3 geometry, see docs/DESIGN.md). The L1→L2 compiler
is a **spine-and-slots double-loaded slab**: banded podium ground floor
(front / guest hall / amenities / service hall / BOH), guest floors above,
vertical core (guest elevator + stairs + robot dumbwaiter) at a fixed
position across floors, per-floor linen closet + robot charging nook beside
the core. All the archetypes above stay reachable later as alternate
compilers behind the same L2 schema.

Sources: Cornell deRoos PDF; Rutes/Penner CHRAQ; facilityplanning.wordpress
hotel space allocation; iklimnet guestroom corridors; BASE4 + Dazen elevator
guides; hospitality.institute BOH planning; Marson & Musse 2010; Visual
Computer 2015 procedural floorplan survey.
