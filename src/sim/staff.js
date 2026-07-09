//
// Staff: one listener owning every human employee. Staff accept directives
// from the manager (assign to task, go somewhere, come back from break) and
// have simple autonomy: front desk serves the queue from the desk, everyone
// drifts back to their station when idle, and people want a break now and
// then — a staffing pressure the manager has to plan around.
//

import { makeMover } from './mover.js'
import { personEntities, syncPerson, STAFF_NAMES, clamp } from './util.js'

const ROLES = {
  housekeeper: { caps: ['clean', 'deliver'], color: 0x7fb3ff, station: 'housekeeping', speed: 1.5 },
  front_desk:  { caps: ['front_desk'],       color: 0xffd166, station: 'front_desk',   speed: 1.5 },
  cook:        { caps: ['cook', 'deliver'],  color: 0xf5f5f5, station: 'kitchen',      speed: 1.4 },
  valet:       { caps: ['deliver', 'front_desk'], color: 0x8d99ae, station: 'lobby',   speed: 1.7 },
  security:    { caps: ['security'],         color: 0x1d3557, station: 'lobby',        speed: 1.9 },
  engineer:    { caps: ['fix'],              color: 0xf3722c, station: 'engineering',  speed: 1.6 },
}

export function makeStaff(world) {
  const staff = new Map()
  const rng = world.rng
  let seq = 0

  function hire(role) {
    const def = ROLES[role]
    const station = world.nav.areasById.has(def.station) ? def.station : 'lobby'
    const id = `staff-${++seq}`
    const pos = world.nav.randomPointIn(station, rng)
    const s = {
      id, role, name: STAFF_NAMES[(seq - 1) % STAFF_NAMES.length],
      caps: def.caps, color: def.color, station,
      pos, floor: 0, area: station, speed: def.speed, weight: 1,
      state: 'idle',            // idle | moving | working | pickup | break | to_break
      task: null, workLeft: 0, phase: null,
      fatigue: rng() * 30,      // grows with time; over ~100 they want a break
      entities: null,
    }
    s.mover = makeMover(world, s, 'staff')
    staff.set(id, s)
    if (world.render) {
      s.entities = personEntities(id, def.color, pos)
      world.bus.resolve(s.entities)
    }
    return s
  }

  // spawn per brief (+ one engineer always — someone has to fix the elevator)
  const staffing = { engineer: 1, ...world.brief.staffing }
  for (const [role, n] of Object.entries(staffing))
    for (let i = 0; i < n; i++) if (ROLES[role]) hire(role)

  // is a front-desk-capable human at the desk right now?
  function staffAtDesk() {
    for (const s of staff.values())
      if (s.caps.includes('front_desk') && s.area === 'front_desk' &&
          (s.state === 'idle' || s.state === 'working')) return s
    return null
  }
  world.staffAtDesk = staffAtDesk

  function assignTask(s, task) {
    if (s.task) world.tasks.release(s.task.id)
    s.task = task
    world.tasks.assign(task.id, s.id)
    s.phase = task.via ? 'pickup' : 'go'
    s.state = 'moving'
    s.mover.setGoal(task.via && s.phase === 'pickup' ? task.via : task.area)
    world.log(`ASSIGN ${s.id} ${s.name} (${s.role}) -> ${task.id}`)
  }

  function directive(d) {
    const s = staff.get(d.actor)
    if (!s) return false
    if (d.task) {
      const task = world.tasks.byId(d.task)
      if (!task || task.state === 'done' || task.state === 'expired') return false
      assignTask(s, task)
      return true
    }
    if (d.goto) {
      if (s.task) { world.tasks.release(s.task.id); s.task = null }
      s.state = 'moving'; s.phase = 'sent'
      return s.mover.setGoal(d.goto)
    }
    if (d.recall) {
      s.fatigue = Math.max(0, s.fatigue - 40)
      s.state = 'moving'; s.phase = 'station'
      s.mover.setGoal(s.station)
      return true
    }
    return false
  }

  function stepStaff(s, dt) {
    s.fatigue += dt * 0.05
    const status = s.mover.step(dt)

    switch (s.state) {
      case 'idle': {
        // front desk staff belong at the desk; others drift to station
        if (s.area !== s.station && !s.mover.active) {
          s.state = 'moving'; s.phase = 'station'
          s.mover.setGoal(s.station)
          break
        }
        // break pressure
        if (s.fatigue > 100 && world.nav.areasById.has('staff_room')) {
          s.state = 'to_break'
          s.mover.setGoal('staff_room')
          world.log(`BREAK ${s.id} ${s.name} (${s.role}) go on break`)
        }
        break
      }
      case 'moving':
        if (status === 'arrived') {
          if (s.phase === 'pickup') {
            s.state = 'working'; s.workLeft = 4 // gather the goods
          } else if (s.phase === 'go' || (s.task && s.phase !== 'station' && s.phase !== 'sent')) {
            s.state = 'working'; s.workLeft = s.task ? s.task.work : 2
          } else {
            s.state = 'idle'; s.phase = null
          }
        }
        break
      case 'working':
        s.workLeft -= dt
        if (s.workLeft <= 0) {
          if (s.task && s.phase === 'pickup') {
            s.phase = 'go'
            s.state = 'moving'
            s.mover.setGoal(s.task.area)
          } else if (s.task) {
            world.tasks.complete(s.task.id)
            s.task = null; s.phase = null; s.state = 'idle'
          } else {
            s.state = 'idle'
          }
        }
        break
      case 'to_break':
        if (status === 'arrived') { s.state = 'break'; s.breakLeft = 45 + rng() * 30 }
        break
      case 'break':
        s.breakLeft -= dt
        s.fatigue = clamp(s.fatigue - dt * 1.2, 0, 130)
        if (s.breakLeft <= 0) { s.state = 'idle'; s.fatigue = 0 }
        break
    }
  }

  const entity = {
    id: 'staff',
    resolve(event) {
      if (event.directive && event.directive.actor?.startsWith('staff')) {
        return directive(event.directive) ? { ok: true } : { ok: false }
      }
      if (!event.tick) return
      const dt = (world.paused || world.gameOver) ? 0 : event.dt
      for (const s of staff.values()) stepStaff(s, dt)
      if (world.render)
        for (const s of staff.values()) {
          const yExtra = (s.floorContinuous ?? s.floor) * world.view.explode
          syncPerson(s.entities, s.pos, yExtra)
        }
    },
  }

  return { entity, staff, directive, staffAtDesk }
}
