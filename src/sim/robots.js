//
// Robots: cleaning, delivery, and security bots. Battery-limited, they use
// the dumbwaiter between floors (never the guest elevator, never stairs),
// prefer service corridors, charge at the bay or a floor nook, develop
// faults, and get stuck — every one of which becomes the manager's problem.
//

import { makeMover } from './mover.js'
import { robotEntities, syncRobot, clamp, pick } from './util.js'

const KINDS = {
  cleaning: { caps: ['clean'], color: 0x2fbf71, speed: 1.0 },
  delivery: { caps: ['deliver'], color: 0xff8f2d, speed: 1.4 },
  security: { caps: ['security'], color: 0x33415c, speed: 1.2 },
}

const DRAIN_MOVE = 0.16    // %/s while moving
const DRAIN_IDLE = 0.03
const CHARGE_RATE = 1.4    // %/s on a pad

export function makeRobots(world) {
  const robots = new Map()
  const rng = world.rng
  let seq = 0

  const chargers = world.layout.areas
    .filter(a => a.kind === 'robot_bay' || a.kind === 'robot_nook')
    .map(a => a.id)

  function build(kind) {
    const def = KINDS[kind]
    const home = chargers[0] || 'lobby'
    const id = `robot-${++seq}`
    const pos = world.nav.randomPointIn(home, rng)
    const r = {
      id, kind, name: `${kind}-bot ${seq}`,
      caps: def.caps, color: def.color,
      pos, floor: 0, area: home, speed: def.speed, weight: 1, home,
      battery: 70 + rng() * 30,
      state: 'idle',   // idle | moving | working | pickup | to_charge | charging | stuck | dead
      task: null, workLeft: 0, phase: null, stuckT: 0,
      entities: null,
    }
    r.mover = makeMover(world, r, 'robot')
    robots.set(id, r)
    if (world.render) {
      r.entities = robotEntities(id, kind, def.color, pos)
      world.bus.resolve(r.entities)
    }
    return r
  }

  for (const [kind, n] of Object.entries(world.brief.robots || {}))
    for (let i = 0; i < n; i++) if (KINDS[kind]) build(kind)

  function nearestCharger(r) {
    let best = chargers[0], bestD = Infinity
    for (const c of chargers) {
      const a = world.nav.areasById.get(c)
      const d = Math.abs(a.floor - r.floor) * 30 +
        Math.hypot(a.rect[0] - r.pos[0], a.rect[1] - r.pos[2])
      if (d < bestD) { best = c; bestD = d }
    }
    return best
  }

  function assignTask(r, task) {
    if (r.task) world.tasks.release(r.task.id)
    r.task = task
    world.tasks.assign(task.id, r.id)
    r.phase = task.via ? 'pickup' : 'go'
    r.state = 'moving'
    r.mover.setGoal(task.via && r.phase === 'pickup' ? task.via : task.area)
    world.log(`ASSIGN ${r.id} (${r.kind}) -> ${task.id}`)
  }

  function directive(d) {
    const r = robots.get(d.actor)
    if (!r || r.state === 'dead') return false
    if (r.state === 'stuck' && !d.reboot) return false
    if (d.reboot) {
      if (r.state === 'stuck') { r.state = 'idle'; r.stuckT = 0; world.log(`REBOOT ${r.id} back online`) }
      return true
    }
    if (d.charge) {
      r.state = 'to_charge'
      if (r.task) { world.tasks.release(r.task.id); r.task = null }
      return r.mover.setGoal(nearestCharger(r))
    }
    if (d.task) {
      const task = world.tasks.byId(d.task)
      if (!task || task.state === 'done' || task.state === 'expired') return false
      assignTask(r, task)
      return true
    }
    if (d.goto) {
      if (r.task) { world.tasks.release(r.task.id); r.task = null }
      r.state = 'moving'; r.phase = 'sent'
      return r.mover.setGoal(d.goto)
    }
    return false
  }

  function stepRobot(r, dt) {
    if (r.state === 'dead') return
    if (r.state === 'stuck') { r.stuckT += dt; return }

    const moving = r.mover.active
    r.battery = clamp(r.battery - (moving ? DRAIN_MOVE : DRAIN_IDLE) * dt, 0, 100)

    // flat battery: dead where it stands; someone must rescue it
    if (r.battery <= 0 && r.state !== 'charging') {
      r.state = 'dead'
      r.mover.cancel()
      if (r.task) { world.tasks.release(r.task.id); r.task = null }
      world.log(`DEAD ${r.id} battery flat in ${r.area}`)
      world.toast(`${r.name} battery flat!`, r.pos, r.floor, 'bad')
      world.tasks.create({
        kind: 'fix', label: `${r.name} died in ${r.area} — needs a rescue`,
        area: r.area, floor: r.floor, pos: r.pos.slice(),
        requires: 'fix', patience: 500, work: 10,
        onDone: () => { r.state = 'charging'; r.battery = 25 },
      })
      return
    }

    // random fault
    if ((r.state === 'moving' || r.state === 'working') && rng() < 0.0025 * dt) {
      r.state = 'stuck'
      r.stuckT = 0
      r.mover.cancel()
      if (r.task) { world.tasks.release(r.task.id); r.task = null }
      const why = pick(rng, ['wheel jam', 'lidar glitch', 'confused by a rug', 'software tantrum'])
      world.log(`FAULT ${r.id} ${why} in ${r.area}`)
      world.toast(`${r.name}: ${why}!`, r.pos, r.floor, 'bad')
      return
    }

    // low battery: bail to charger on its own
    if (r.battery < 28 && r.state !== 'to_charge' && r.state !== 'charging') {
      if (r.task) { world.tasks.release(r.task.id); r.task = null }
      r.state = 'to_charge'
      r.mover.setGoal(nearestCharger(r))
      world.log(`LOWBAT ${r.id} heads to charger (${Math.round(r.battery)}%)`)
    }

    const status = r.mover.step(dt)
    if (status === 'blocked') { r.stuckT += dt } else r.stuckT = 0

    switch (r.state) {
      case 'moving':
        if (status === 'arrived') {
          if (r.phase === 'pickup') { r.state = 'working'; r.workLeft = 3 }
          else if (r.task) { r.state = 'working'; r.workLeft = r.task.work * 1.2 }
          else { r.state = 'idle'; r.phase = null }
        }
        break
      case 'working':
        r.workLeft -= dt
        r.battery = clamp(r.battery - 0.1 * dt, 0, 100)
        if (r.workLeft <= 0) {
          if (r.task && r.phase === 'pickup') {
            r.phase = 'go'; r.state = 'moving'
            r.mover.setGoal(r.task.area)
          } else if (r.task) {
            world.tasks.complete(r.task.id)
            r.task = null; r.phase = null; r.state = 'idle'
          } else r.state = 'idle'
        }
        break
      case 'to_charge':
        if (status === 'arrived') { r.state = 'charging' }
        break
      case 'charging':
        r.battery = clamp(r.battery + CHARGE_RATE * dt, 0, 100)
        if (r.battery >= 95) r.state = 'idle'
        break
      case 'idle':
        // security bots patrol on their own
        if (r.kind === 'security' && !r.mover.active && rng() < 0.005) {
          const halls = world.layout.areas.filter(a =>
            a.kind === 'corridor' || a.kind === 'service_corridor')
          const hall = pick(rng, halls)
          r.state = 'moving'; r.phase = 'sent'
          r.mover.setGoal(hall.id)
        }
        break
    }
  }

  const entity = {
    id: 'robots',
    resolve(event) {
      if (event.directive && event.directive.actor?.startsWith('robot')) {
        return directive(event.directive) ? { ok: true } : { ok: false }
      }
      if (!event.tick) return
      const dt = (world.paused || world.gameOver) ? 0 : event.dt
      for (const r of robots.values()) stepRobot(r, dt)
      if (world.render)
        for (const r of robots.values()) {
          const yExtra = (r.floorContinuous ?? r.floor) * world.view.explode
          syncRobot(r.entities, r.pos, yExtra)
        }
    },
  }

  return { entity, robots, directive }
}
