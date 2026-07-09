# 2026-07-09 — future roadmap (end-of-session notes)

Anselm's notes at the close of the two-round build day, expanded so a future
session can pick any thread and run. Current state: five hotels playable at
https://lita-hotels.exe.xyz, repo at github.com/orbitalfoundation/hotel-game,
heuristic manager plays; the Claude manager needs a local run with a key.

## Small / near-term

- **About page** — the web page needs an "about" (what this is, how it was
  built, the orbital stack, link to the repo and this devlog). Could live on
  the picker screen as a footer link + modal.
- **Blog post / writeup** — the four-level hotel grammar, the coarse-listener
  sim, and the LLM-manager contract are each writeup-worthy; the devlog
  already holds the raw material (stack survey, architecture research,
  build log, approach assessment).
- **First thing next session:** run Claude vs the heuristic baseline on
  palm-lagoon / hoyt-street (the B-grade hotels) — the endpoint, schema and
  fallback are all tested, it just needs credentials.

## Richer art (a project of its own)

Real procedural creatures and flora, done beautifully: fish with spine
animation rather than boxes, whales, procedural palm trees (L-systems),
coral reefs grown rather than scattered. The `volume.handler` custom-shader
hook proved out with the aurora — that's the extension surface. Consider a
dedicated `lita-art` or orbital package; this is exactly the kind of thing
that would also feed cloudreef and other sims.

## The real LITA connection

Friend's project: https://teal-basbousa-246ecd.netlify.app — "LITA Robot
Hotel — Smart Check-in Experience," by the CEO of the actual LITA hotel
company (litahotel.com) that inspired this game's name. Their focus is
robot/smart check-in. Natural crossovers: model their actual check-in flow
(kiosk + robot escort?) as the game's front-desk mechanic; demo the game to
them; maybe share the robot vocabulary (their real robot capabilities →
game robot capabilities).

## Real game mechanics (the big thread)

What's missing is *pressure design* — the current game has scarcity of
hands but no scarcity of money or energy, and incidents but no disasters.
Ideas from the session:

- **Player as agent of chaos AND manager**: throw wrenches — floods, fires,
  power outages — and see how the hotel responds. Possibly a sandbox
  "disaster mode" separate from the scored day.
- **Conversational interface**: direct staff by talking ("get someone to
  room 302, the Vasquezs are furious") — the manager contract already takes
  structured directives; a chat box → Claude → directives is a thin layer
  over what exists. Both modes together: you cause the fire, then you
  manage the response.
- **Energy / cost budgets**: score is currently guest happiness + points
  only. Add money (payroll, robot charging costs, food inventory,
  comps for angry guests) and energy (HVAC load, elevator power) so
  decisions trade off. "Limited hands" becomes "limited hands AND wallet."
- **Surge scenarios**: the hockey team that eats you out of house and home
  (food inventory pressure), the circus that makes a mess everywhere
  (cleaning surge + chaos animals?), a wedding party, a convention, a
  health inspector visit, a celebrity with paparazzi (security surge), a
  power outage during check-in rush.
- **Difficulty ladder**: easy/medium/hard unlockable levels — the five
  hotels already grade differently (aurora easy → hoyt hard); formalize
  into a campaign with unlock conditions and scripted scenario days.
- **Research fodder**: zany true hotel stories (hotel-industry "worst guest"
  lore), Hotel Tycoon / Two Point Hospital / Theme Hospital mechanics
  (queue pressure, room prestige, epidemic events), and hotel fiction —
  the Swedish show *Strandhotellet*, *The White Lotus* (a scripted "drama
  guest" arc per day would be very White Lotus), *Grand Budapest Hotel*.
  Riffing on recognizable plots as scenario days could be the game's
  signature move.
- **Multiplayer**: orbital's whole thesis is shared simulation — filespace
  + streams + server exist for exactly this. Two managers splitting one
  hotel, or rival hotels sharing a guest pool.
- **First-person view**: walk the hotel as the manager (or as a robot!).
  Volume renders three.js, so a pointer-lock FPV camera is feasible; the
  nav graph could drive NPC avoidance around you.

The design question underneath: *what pressures make it fun?* — list the
scenarios first, then check whether the sim's vocabulary (tasks,
capabilities, capacity, patience) can express them, extending it where it
can't (inventory, money, fire/water as spreading area states).

## Rich characters and LLM-driven minds

Today's guests are a name + party size + a dog flag; staff are a name and a
role. That's thin. What we want:

- **Guest archetypes with real backstories**: a blocked writer who never
  leaves the room and orders endless coffee; an artist sketching in the
  lobby; a wealthy CEO with impossible standards and a fat comp budget; a
  crazy musician *with entourage* (a party that's really five linked
  parties, noise complaints radiating from their floor); a crew of flight
  attendants and pilots cutting loose (arrive together at midnight, hit
  the bar hard, sleep till noon, hair-trigger checkout). The archetype
  drives the *need distribution* — each one leans on a different hotel
  subsystem, so who checks in IS the difficulty dial. Entourages/groups
  need a small extension: linked parties that act (and get angry) together.
- **Staff with stories too**: the housekeeper studying for exams (slower on
  break days, brilliant in a crisis), the front-desk romantic, the veteran
  engineer who grumbles but never fails, feuds and friendships that affect
  who works well together. Staff stories turn roster decisions into drama —
  very *Strandhotellet* / *White Lotus* below-stairs plotting.
- **LLM-driven agent minds**: right now every agent is heuristic; only the
  manager can be Claude. The fun version: LLM minds for *select* characters
  — the drama guests, maybe one staff member per day — deciding needs,
  reactions, and dialogue in character, while the crowd stays heuristic
  (the cloudreef "cognition budget" idea, applied socially). Mechanically
  this is the same seam as the manager: compact snapshot in, a structured
  intent out, published as ordinary bus events. Dialogue surfaces through
  the existing toast/hover overlay (guests could *say* things in-world).
  A per-day token budget keeps it sane; archetype prompt cards keep it
  cheap (one system prompt per archetype, cached).

Backstories are also what make the scenario days land: the hockey team
isn't a spawn rate, it's twelve linked guests with one shared mood.
