//
// World assembly: one bus per running hotel. Compiles the brief, derives
// the nav graph, and registers the population listeners (guests, staff,
// robots, systems, incidents, tasks, score) plus the clock. The renderer,
// if present, is just another listener on the same bus.
//

import { compileLayout } from '../compile/layout.js'
import { makeNavGraph } from '../compile/navgraph.js'
import { PARTS } from '../grammar/parts.js'
import { mulberry, hhmm } from './util.js'
import { makeTasks } from './tasks.js'
import { makeSystems } from './systems.js'
import { makeGuests } from './guests.js'
import { makeStaff } from './staff.js'
import { makeRobots } from './robots.js'
import { makeIncidents } from './incidents.js'
import { makeScore } from './score.js'

const DAY_START = 6 * 3600
const DAY_END = 24 * 3600

export function createHotelWorld(bus, brief, { render = false, speed = 60 } = {}) {
  const layout = compileLayout(brief)
  const nav = makeNavGraph(layout)

  const world = {
    bus, brief, layout, nav, render,
    rng: mulberry(brief.seed * 7919 + 13),
    paused: false,
    gameOver: false,
    clock: { t: DAY_START, speed, day: 1 },
    view: { explode: 0 },
    occupancy: new Map(),
    capacity: new Map(),
    events: [],           // rolling activity log
    onTaskClosed: [],
    log(msg) {
      world.events.push({ t: world.clock.t, msg })
      if (world.events.length > 250) world.events.shift()
    },
    // every actor that can catch a sneak
    securityActors() {
      const out = []
      for (const s of world.staff.staff.values())
        if (s.caps.includes('security') && s.state !== 'break') out.push(s)
      for (const r of world.robots.robots.values())
        if (r.caps.includes('security') && (r.state === 'moving' || r.state === 'idle' || r.state === 'working'))
          out.push(r)
      return out
    },
  }

  // area capacities: part default, scaled up for big rooms; corridors by area
  for (const a of layout.areas) {
    const part = PARTS[a.kind]
    const [, , w, d] = a.rect
    if (a.kind === 'corridor' || a.kind === 'service_corridor')
      world.capacity.set(a.id, Math.max(4, Math.floor(w * d / 3)))
    else if (a.kind === 'outdoor' || a.kind === 'parking')
      world.capacity.set(a.id, 999)
    else
      world.capacity.set(a.id, Math.max(part?.capacity ?? 8, Math.floor(w * d / 5)))
  }

  // clock — runs first each tick (registered before the populations)
  const clock = {
    id: 'clock',
    resolve(event) {
      if (!event.tick || world.paused || world.gameOver) return
      world.clock.t += event.dt * world.clock.speed
      if (world.clock.t >= DAY_END) {
        world.gameOver = true
        world.log(`CLOSE the day ends — final grade ${world.score.grade()}`)
        bus.resolve({ dayEnd: true, summary: world.score.summary() })
      }
    },
  }
  clock.resolve.filter = { tick: true }
  bus.register(clock)

  // populations — order matters a little: systems move cabs before movers ask
  world.score = makeScore(world)
  world.tasks = makeTasks(world)
  world.systems = makeSystems(world)
  world.guests = makeGuests(world)
  world.staff = makeStaff(world)
  world.robots = makeRobots(world)
  world.incidents = makeIncidents(world)

  bus.register(world.score.entity)
  bus.register(world.tasks.entity)
  bus.register(world.systems.entity)
  bus.register(world.staff.entity)
  bus.register(world.robots.entity)
  bus.register(world.guests.entity)
  bus.register(world.incidents.entity)

  bus.install('world', world)
  world.log(`OPEN ${brief.about.label} opens at ${hhmm(world.clock.t)}`)
  return world
}
