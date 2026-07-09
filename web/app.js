//
// Lita Hotels — browser entry. Picker -> hotel bus -> volume renderer + sim.
//

import { createBus } from '@orbitalfoundation/bus'
import { attach as attachSpatial } from '@orbitalfoundation/spatial'
import { BRIEFS } from '/lita-game/src/grammar/briefs.js'
import { compileGeometry, THEMES } from '/lita-game/src/compile/geometry.js'
import { createHotelWorld } from '/lita-game/src/sim/world.js'
import { makeHeuristicManager, makeLLMManager } from '/lita-game/src/sim/manager.js'
import { setPos } from '/lita-game/src/sim/util.js'
import { mountHud } from './hud.js'

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
  const { compileLayout } = await import('/lita-game/src/compile/layout.js')
  const layout = compileLayout(brief)
  const theme = THEMES[brief.theme] || THEMES.default
  const [W, D] = layout.bounds
  const cx = W / 2, cz = D / 2
  const H = brief.floors * layout.floorHeight

  // scene, camera, light
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
    { uuid: 'sun001', volume: {
      geometry: 'light', light: 'directional',
      intensity: theme.sun?.intensity ?? 1.0, color: 0xfff2e0,
      pose: { position: theme.sun?.position ?? [30, 60, 20] },
    } },
    { uuid: 'ambient001', volume: {
      geometry: 'light', light: 'ambient', intensity: 0.55, color: 0xbfd0e8,
      pose: { position: [0, 10, 0] },
    } },
  ]
  await bus.resolve(sceneEntities)

  // world (sim truth) — spawns staff and robots, so the scene is ready now
  const world = createHotelWorld(bus, brief, { render: true, speed: 60 })
  window.lita.world = world

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

  // explode view: static geometry re-offsets when the slider moves;
  // agents and cabs read world.view.explode every tick on their own
  world.applyExplode = () => {
    const e = world.view.explode
    for (const g of geom)
      setPos(g.volume.pose.position, g.volume.pose.position.x,
        g.lita.baseY + g.lita.floor * e, g.volume.pose.position.z)
    for (const t of world.tasks.open())
      if (t.marker) setPos(t.marker.volume.pose.position,
        t.pos[0], t.pos[1] + 2.3 + t.floor * e, t.pos[2])
  }

  // task markers bob, and respect the explode offset when created mid-game
  const markerSync = {
    id: 'marker-sync',
    resolve(event) {
      if (!event.tick) return
      const e = world.view.explode
      const t0 = performance.now() / 1000
      for (const t of world.tasks.open())
        if (t.marker) setPos(t.marker.volume.pose.position,
          t.pos[0], t.pos[1] + 2.3 + t.floor * e + Math.sin(t0 * 3 + t.pos[0]) * 0.12, t.pos[2])
    },
  }
  markerSync.resolve.filter = { tick: true }
  bus.register(markerSync)

  // HUD
  mountHud(world, llm)

  // go!
  bus.resolve({ run: 'realtime', hz: 60, dt: 1 / 60 })
}
