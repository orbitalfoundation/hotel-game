//
// Lita Hotels — browser entry. Picker -> hotel bus -> volume renderer + sim.
//

import { createBus } from '@orbitalfoundation/bus'
import { attach as attachSpatial } from '@orbitalfoundation/spatial'
import { BRIEFS } from '/lita-game/src/grammar/briefs.js'
import { compileLayout } from '/lita-game/src/compile/layout.js'
import { compileGeometry, THEMES } from '/lita-game/src/compile/geometry.js'
import { createHotelWorld } from '/lita-game/src/sim/world.js'
import { makeHeuristicManager, makeLLMManager } from '/lita-game/src/sim/manager.js'
import { setPos } from '/lita-game/src/sim/util.js'
import { mountHud } from './hud.js'
import { mountOverlay } from './overlay.js'
import { mountDayNight } from './daynight.js'

// ---- picker ----------------------------------------------------------------
const cards = document.getElementById('cards')
for (const brief of BRIEFS) {
  const theme = THEMES[brief.theme] || THEMES.default
  const el = document.createElement('div')
  el.className = 'card'
  const hex = c => '#' + c.toString(16).padStart(6, '0')
  el.innerHTML = `
    <div class="swatch" style="background:linear-gradient(120deg, ${hex(theme.bg)}, ${hex(theme.accent)})"></div>
    <b>${brief.about.label}</b>
    <span>${brief.about.description}</span>`
  el.onclick = () => start(brief)
  cards.appendChild(el)
}

// ---- game boot ----------------------------------------------------------------
async function start(brief) {
  document.getElementById('picker').style.display = 'none'
  document.getElementById('hud').style.display = 'flex'
  document.getElementById('hotel-name').textContent = brief.about.label

  const bus = createBus({ description: `lita-${brief.id}` })
  window.lita = { bus } // for poking at things in devtools

  // renderer + space
  await bus.resolve({ load: '/orbital/orbital-volume/volume.js' })
  attachSpatial(bus, { cellSize: 8 })

  // scene must exist before anything publishes a renderable (the world
  // spawns staff and robots the moment it's created)
  const layout = compileLayout(brief)
  const theme = THEMES[brief.theme] || THEMES.default
  const [W, D] = layout.bounds
  const cx = W / 2, cz = D / 2
  const H = brief.floors * layout.floorHeight

  const sunEntity = { uuid: 'sun001', volume: {
    geometry: 'light', light: 'directional',
    intensity: theme.sun?.intensity ?? 1.0, color: 0xfff2e0,
    shadow: { extent: Math.max(W, D) * 0.8 + 30, size: 2048, far: 900 },
    target: [cx, 0, cz],
    pose: { position: theme.sun?.position ?? [30, 60, 20] },
  } }
  const ambientEntity = { uuid: 'ambient001', volume: {
    geometry: 'light', light: 'ambient', intensity: 0.55, color: 0xbfd0e8,
    pose: { position: [0, 10, 0] },
  } }
  const sceneEntities = [
    { uuid: 'scene001', volume: {
      geometry: 'scene', div: 'volume001',
      background: theme.bg, near: 0.1, far: 900,
      prettier: true,
      ...(theme.fog ? { fog: theme.fog } : {}),
    } },
    { uuid: 'camera001', volume: {
      geometry: 'camera', cameraMin: 6, cameraMax: 500,
      pose: {
        position: [cx + W * 0.85, H + Math.max(W, D) * 0.95, cz + D * 2.3],
        love: [cx, H / 3, cz],
      },
    } },
    sunEntity,
    ambientEntity,
  ]
  await bus.resolve(sceneEntities)

  // world (sim truth) — spawns staff and robots, so the scene is ready now
  const world = createHotelWorld(bus, brief, { render: true, speed: 60 })
  window.lita.world = world
  world.view.floorMode = 'all'

  // hotel geometry (L3)
  const geom = compileGeometry(world.layout)
  for (const g of geom) g.lita.baseY = g.volume.pose.position.y
  await bus.resolve(geom)

  // elevator / dumbwaiter cabs
  await bus.resolve(world.systems.makeEntities())

  // managers
  const heuristic = makeHeuristicManager(world)
  bus.register(heuristic.entity)
  const llm = makeLLMManager(world, { endpoint: '/api/manager', cadence: 9000 })
  world.llmManager = llm

  const fh = world.layout.floorHeight
  const floorShown = f =>
    world.view.floorMode === 'all' || Math.round(f) <= world.view.floorMode

  // explode view: static geometry re-offsets when the slider moves;
  // agents, cabs, markers and trails read world.view.explode every tick
  world.applyExplode = () => {
    const e = world.view.explode
    for (const g of geom)
      setPos(g.volume.pose.position, g.volume.pose.position.x,
        g.lita.baseY + g.lita.floor * e, g.volume.pose.position.z)
  }

  // floor isolation: hide static geometry above the picked floor (the
  // classic dollhouse slice); dynamic things follow in the view listener
  world.applyFloorMode = () => {
    for (const g of geom) {
      const node = g.volume.node
      if (node) node.visible = floorShown(g.lita.floor)
    }
  }

  // ---- planned-route trails -------------------------------------------------
  const trails = new Map()
  const trailFor = (id, color) => {
    let t = trails.get(id)
    if (!t) {
      t = { uuid: `trail-${id}`, volume: {
        geometry: 'line', points: [], rev: 0,
        material: { color, opacity: 0.7, dashed: true, dashSize: 0.7, gapSize: 0.45 },
      } }
      trails.set(id, t)
      bus.resolve(t)
    }
    return t
  }
  const setTrail = (t, pts) => {
    t.volume.points = pts
    t.volume.rev = (t.volume.rev || 0) + 1
  }
  const routePoints = (actor) => {
    const rem = actor.mover.remaining
    if (!rem || !rem.length) return []
    const e = world.view.explode
    const lift = p => [p[0], p[1] + Math.round(p[1] / fh) * e + 0.35, p[2]]
    const here = [actor.pos[0], actor.pos[1] + (actor.floorContinuous ?? actor.floor) * e + 0.35, actor.pos[2]]
    return [here, ...rem.map(lift)]
  }

  // ---- per-tick view sync: markers, visibility, trails -------------------------
  const view = {
    id: 'view-sync',
    resolve(event) {
      if (!event.tick) return
      const e = world.view.explode
      const t0 = performance.now() / 1000

      // task markers bob (and respect explode + floor slice)
      for (const t of world.tasks.open())
        if (t.marker) {
          setPos(t.marker.volume.pose.position,
            t.pos[0], t.pos[1] + 2.3 + t.floor * e + Math.sin(t0 * 3 + t.pos[0]) * 0.12, t.pos[2])
          if (t.marker.volume.node) t.marker.volume.node.visible = floorShown(t.floor)
        }

      // dynamic visibility per floor slice
      const setVis = (entities, floor) => {
        if (!entities) return
        for (const ent of entities) {
          const n = ent.volume?.node
          if (n) n.visible = floorShown(floor)
        }
      }
      for (const p of world.guests.parties.values())
        for (const m of p.entities) setVis(m.pair, p.floorContinuous ?? p.floor)
      for (const s of world.staff.staff.values()) setVis(s.entities, s.floorContinuous ?? s.floor)
      for (const r of world.robots.robots.values()) setVis(r.entities, r.floorContinuous ?? r.floor)
      for (const b of world.incidents.badActors.values()) setVis(b.entities, b.floorContinuous ?? b.floor)
      for (const cab of world.systems.cabs.values())
        setVis(cab.entities, cab.y / fh)

      // trails: staff and robots on a job show where they're headed
      const live = new Set()
      const crew = [...world.staff.staff.values(), ...world.robots.robots.values()]
      for (const a of crew) {
        if (!a.task || !a.mover.active) continue
        live.add(a.id)
        const t = trailFor(a.id, a.color)
        setTrail(t, floorShown(a.floorContinuous ?? a.floor) ? routePoints(a) : [])
      }
      for (const [id, t] of trails)
        if (!live.has(id) && t.volume.points.length) setTrail(t, [])
    },
  }
  view.resolve.filter = { tick: true }
  bus.register(view)

  // cab explode offset rides the systems module's own sync
  const cabSync = {
    id: 'cab-sync',
    resolve(event) { if (event.tick) world.systems.sync(world.view.explode) },
  }
  cabSync.resolve.filter = { tick: true }
  bus.register(cabSync)

  // in-world labels + day/night + HUD
  mountOverlay(world, bus)
  mountDayNight(world, bus, { theme, sunEntity, ambientEntity, layout })
  mountHud(world, llm)

  // go!
  bus.resolve({ run: 'realtime', hz: 60, dt: 1 / 60 })
}
