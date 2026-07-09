//
// Incidents: the drama generator. Spills, elevator breakdowns, and the
// occasional bad actor prowling where they shouldn't. Everything lands on
// the task board; the fun is that it lands while three other things are
// already going wrong.
//

import { makeMover } from './mover.js'
import { personEntities, syncPerson, pick } from './util.js'

const SPILLS = ['a spilled mai tai', 'a burst luggage of snow globes',
  'a knocked-over plant', 'melted ice cream', 'a mysterious puddle',
  'a trail of sandy footprints', 'a dropped room-service tray']

export function makeIncidents(world) {
  const rng = world.rng
  const badActors = new Map()
  let seq = 0

  function spill() {
    const halls = world.layout.areas.filter(a =>
      a.kind === 'corridor' || a.kind === 'lobby')
    const hall = pick(rng, halls)
    const pos = world.nav.randomPointIn(hall.id, rng)
    world.tasks.create({
      kind: 'clean', label: `${pick(rng, SPILLS)} in ${hall.id}`,
      area: hall.id, floor: hall.floor, pos,
      requires: 'clean', patience: 230, work: 7,
    })
  }

  function elevatorFailure() {
    const cab = world.systems.cabs.get('elevator')
    if (!cab || cab.failed) return
    cab.failed = true
    const stuck = cab.riders.size
    world.log(`BREAKDOWN elevator out of service${stuck ? ` with ${stuck} riders INSIDE` : ''}`)
    world.toast(stuck ? `elevator down — ${stuck} trapped inside!` : 'elevator out of service!',
      [cab.at[0], cab.y, cab.at[1]], Math.round(cab.y / world.layout.floorHeight), 'bad')
    world.tasks.create({
      kind: 'fix', label: `elevator broke down${stuck ? ' — guests trapped inside!' : ''}`,
      area: 'elevator-0', floor: cab.floor, pos: [cab.at[0], cab.y, cab.at[1]],
      requires: 'fix', patience: stuck ? 220 : 400, work: 14,
      onDone: () => { cab.failed = false; world.log('FIXED elevator back in service') },
    })
  }

  function dumbwaiterFailure() {
    const cab = world.systems.cabs.get('dumbwaiter')
    if (!cab || cab.failed) return
    cab.failed = true
    world.log('BREAKDOWN dumbwaiter jammed — robots are cut off from the floors')
    world.tasks.create({
      kind: 'fix', label: 'dumbwaiter jammed',
      area: 'dumbwaiter-0', floor: 0, pos: [cab.at[0], cab.y, cab.at[1]],
      requires: 'fix', patience: 420, work: 10,
      onDone: () => { cab.failed = false; world.log('FIXED dumbwaiter running again') },
    })
  }

  function hvacGrumble() {
    const roomsList = world.layout.areas.filter(a => a.kind === 'guest_room')
    const room = pick(rng, roomsList)
    world.tasks.create({
      kind: 'fix', label: `${room.id} is freezing — HVAC acting up`,
      area: room.id, floor: room.floor, pos: world.nav.randomPointIn(room.id, rng),
      requires: 'fix', patience: 380, work: 9,
    })
  }

  // ---- bad actors -----------------------------------------------------------
  function spawnBadActor() {
    const id = `sneak-${++seq}`
    const pos = world.nav.randomPointIn('outdoor', rng)
    const b = {
      id, pos, floor: 0, area: 'outdoor', speed: 1.6, weight: 1,
      state: 'prowling', mischiefT: 25 + rng() * 30,
      leaveT: 110 + rng() * 80,   // sneaks get bored and slip away eventually
      entities: null,
    }
    b.mover = makeMover(world, b, 'staff') // sneaks go where they shouldn't
    badActors.set(id, b)
    if (world.render) {
      b.entities = personEntities(id, 0x111111, pos)
      world.bus.resolve(b.entities)
    }
    world.log(`SNEAK someone suspicious slipped in (${id})`)
    world.tasks.create({
      kind: 'security', label: `suspicious character prowling the hotel (${id})`,
      area: 'lobby', floor: 0, pos: pos.slice(),
      requires: 'security', patience: 240, work: 3,
      target: id,
    })
    return b
  }

  function despawnBadActor(b, why) {
    for (const t of world.tasks.open())
      if (t.target === b.id) world.tasks.complete(t.id)
    for (const e of b.entities || []) { e.obliterate = true; world.bus.resolve(e) }
    world.occupancy.get(b.area)?.delete(b.id)
    badActors.delete(b.id)
    world.log(why)
  }

  function stepBadActor(b, dt) {
    b.mover.step(dt)
    b.mischiefT -= dt
    b.leaveT -= dt
    if (b.leaveT <= 0)
      return despawnBadActor(b, `SNEAK ${b.id} slipped away before anyone noticed`)
    // prowl with a dwell between goals (never re-pick every tick, and never
    // the area they're already in — that re-randomized the target point
    // each frame and drew a whirling route line)
    if (!b.mover.active) {
      b.prowlT = (b.prowlT ?? 0) - dt
      if (b.prowlT <= 0) {
        const targets = world.layout.areas.filter(a =>
          ['service_corridor', 'kitchen', 'storage', 'security_office', 'corridor', 'lobby']
            .includes(a.kind) && a.id !== b.area)
        b.mover.setGoal(pick(rng, targets).id)
        b.prowlT = 3 + rng() * 5
      }
    }
    if (b.mischiefT <= 0) {
      b.mischiefT = 25 + rng() * 25
      spill()
      world.log(`MISCHIEF ${b.id} caused trouble in ${b.area}`)
      world.score.mischief()
    }
    // caught? any security-capable actor within 2.5m
    for (const actor of world.securityActors()) {
      if (actor.floor === b.floor &&
          Math.hypot(actor.pos[0] - b.pos[0], actor.pos[2] - b.pos[2]) < 2.5) {
        world.score.caught()
        world.toast('gotcha! sneak escorted out', b.pos, b.floor, 'good')
        return despawnBadActor(b, `CAUGHT ${b.id} escorted out by ${actor.id}`)
      }
    }
  }

  // ---- schedule ---------------------------------------------------------------
  let t = 0
  const entity = {
    id: 'incidents',
    resolve(event) {
      if (!event.tick) return
      const dt = (world.paused || world.gameOver) ? 0 : event.dt
      t += dt
      // rates are per-second probabilities; a real-time day is ~1080s, so
      // e.g. 0.008 ≈ eight or nine spills over the day
      const difficulty = world.brief.difficulty ?? 1
      if (rng() < 0.008 * dt * difficulty) spill()
      if (t > 120 && rng() < 0.0009 * dt * difficulty) elevatorFailure()
      if (t > 150 && rng() < 0.0006 * dt * difficulty) dumbwaiterFailure()
      if (rng() < 0.0014 * dt * difficulty) hvacGrumble()
      if (badActors.size < 1 && t > 90 && rng() < 0.0014 * dt * difficulty) spawnBadActor()

      for (const b of [...badActors.values()]) stepBadActor(b, dt)
      if (world.render)
        for (const b of badActors.values())
          syncPerson(b.entities, b.pos, (b.floorContinuous ?? b.floor) * world.view.explode)
    },
  }
  entity.resolve.filter = { tick: true }

  return { entity, badActors }
}
