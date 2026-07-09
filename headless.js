//
// Headless day: run a full hotel day at batch speed with the heuristic
// manager and print the outcome. Balance-tuning and smoke-testing tool.
//
//   node --preserve-symlinks headless.js [hotel-id] [--quiet]
//

import { createBus } from '@orbitalfoundation/bus'
import { attach as attachSpatial } from '@orbitalfoundation/spatial'
import { BRIEFS, briefById } from './src/grammar/briefs.js'
import { createHotelWorld } from './src/sim/world.js'
import { makeHeuristicManager } from './src/sim/manager.js'
import { hhmm } from './src/sim/util.js'

const id = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'juniper-house'
const quiet = process.argv.includes('--quiet')
const brief = briefById(id)
if (!brief) {
  console.error(`unknown hotel '${id}' — try: ${BRIEFS.map(b => b.id).join(', ')}`)
  process.exit(1)
}

const bus = createBus({ description: `lita-headless-${id}` })
attachSpatial(bus, { cellSize: 8 })
const world = createHotelWorld(bus, brief, { render: false, speed: 60 })
bus.register(makeHeuristicManager(world).entity)

if (!quiet) {
  let printed = 0
  const tail = { id: 'tail', resolve(e) {
    if (!e.tick) return
    while (printed < world.events.length) {
      const ev = world.events[printed++]
      console.log(`${hhmm(ev.t)}  ${ev.msg}`)
    }
  } }
  tail.resolve.filter = { tick: true }
  bus.register(tail)
}

// 6:00 -> 24:00 at speed 60 = 1080 sim-seconds; step at 10Hz
const DT = 0.1
const TICKS = Math.ceil((18 * 3600) / world.clock.speed / DT) + 10
console.log(`running ${brief.about.label} — ${world.layout.floors} floors, ` +
  `${world.layout.areas.filter(a => a.kind === 'guest_room').length} rooms, ` +
  `${world.staff.staff.size} staff, ${world.robots.robots.size} robots\n`)

await bus.resolve({ run: true, ticks: TICKS, dt: DT })

const s = world.score.summary()
console.log(`\n===== closing time =====`)
console.log(`grade ${s.grade} · ${s.points} points · happiness ${s.happiness}`)
console.log(`tasks: ${s.resolved} resolved, ${s.expired} expired · walkouts ${s.walkouts} · sneaks caught ${s.caught}`)
