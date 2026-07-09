//
// Guests: one listener owning every guest party (coarse-unit principle).
//
// A party is a small state machine driven by needs: arrive, check in, get
// to the room, then a day of outings (breakfast, pool, spa...) and requests
// (towels, room service...) — each request becomes a task on the board.
// Happiness rises when needs are met promptly and decays while waiting.
// A party whose happiness collapses storms out: a walkout, the thing the
// manager is paid to prevent.
//

import { makeMover } from './mover.js'
import { makeParty, personEntities, syncPerson, pick, clamp, hhmm } from './util.js'
import { GUEST_NEED_PARTS } from '../grammar/parts.js'

const PARTY_COLORS = [0xe07a5f, 0x3d84a8, 0x81b29a, 0xf2cc8f, 0x9a5aa8,
  0x5f9ea0, 0xc86b85, 0x6a8d39, 0xb5651d, 0x4869a8]

const CHECKIN_TIME = 7      // seconds of front-desk service per party
const WALK = 1.25           // guest walk speed m/s

export function makeGuests(world) {
  const parties = new Map()
  let seq = 0
  const rng = world.rng

  // rooms ledger: clean | occupied | dirty | cleaning
  const rooms = new Map()
  for (const a of world.layout.areas)
    if (a.kind === 'guest_room') rooms.set(a.id, { status: 'clean', party: null })
  world.rooms = rooms

  const amenities = world.layout.areas
    .filter(a => GUEST_NEED_PARTS.includes(a.kind))
    .map(a => ({ id: a.id, kind: a.kind }))

  const checkinQueue = []

  function spawnParty() {
    const p = makeParty(rng, `party-${++seq}`)
    const outdoor = world.nav.areasById.get('parking') ? 'parking' : 'outdoor'
    const start = world.nav.randomPointIn(outdoor, rng)
    Object.assign(p, {
      pos: start, floor: 0, area: outdoor, speed: WALK,
      weight: p.members,
      state: 'arriving', happiness: 78, room: null,
      needTimer: 10 + rng() * 30, waitingOn: null, dwell: 0,
      color: PARTY_COLORS[seq % PARTY_COLORS.length],
      entities: [],
    })
    p.mover = makeMover(world, p, 'guest')
    p.mover.setGoal('lobby')
    parties.set(p.id, p)
    if (world.render) {
      for (let m = 0; m < p.members; m++) {
        const scale = p.kind === 'family' && m >= 2 ? 0.72 : 1
        const pair = personEntities(`${p.id}-m${m}`, p.color, start, scale)
        p.entities.push({ pair, scale })
        world.bus.resolve(pair)
      }
    }
    world.log(`ARRIVE ${p.id} ${p.label}`)
    return p
  }

  function despawnParty(p) {
    p.state = 'gone'
    world.occupancy.get(p.area)?.delete(p.id)
    for (const e of p.entities) {
      for (const ent of e.pair) { ent.obliterate = true; world.bus.resolve(ent) }
    }
    p.entities = []
    parties.delete(p.id)
  }

  function freeRoom() {
    for (const [id, r] of rooms) if (r.status === 'clean') return id
    return null
  }

  function makeRequest(p) {
    const roll = rng()
    const hour = world.clock.t / 3600
    const room = world.nav.areasById.get(p.room)
    const roomPos = world.nav.randomPointIn(p.room, rng)
    if (roll < 0.30) {
      world.tasks.create({
        kind: 'deliver', label: `${p.name} want fresh towels (${p.room})`,
        area: p.room, floor: room.floor, pos: roomPos,
        requires: 'deliver', via: 'housekeeping', patience: 190, work: 3, guest: p.id,
      })
      p.waitingOn = 'towels'
    } else if (roll < 0.42) {
      world.tasks.create({
        kind: 'deliver', label: `${p.name} forgot a toothbrush (${p.room})`,
        area: p.room, floor: room.floor, pos: roomPos,
        requires: 'deliver', via: 'housekeeping', patience: 210, work: 3, guest: p.id,
      })
      p.waitingOn = 'sundries'
    } else if (roll < 0.72 && (hour > 11 || !amenities.length)) {
      const dish = pick(rng, ['a burger', 'pancakes', 'the seafood platter',
        'two milkshakes', 'a pot of tea', 'the famous club sandwich'])
      world.tasks.create({
        kind: 'room_service', label: `${p.name} ordered ${dish} (${p.room})`,
        area: p.room, floor: room.floor, pos: roomPos,
        requires: 'deliver', via: 'kitchen', patience: 260, work: 4, guest: p.id,
      })
      p.waitingOn = 'room service'
    } else if (amenities.length) {
      return goOnOuting(p)
    }
    return true
  }

  function goOnOuting(p) {
    const hour = world.clock.t / 3600
    let pool = amenities
    if (hour >= 6.5 && hour < 10.5)
      pool = amenities.filter(a => ['breakfast', 'restaurant'].includes(a.kind))
    else if (hour >= 18)
      pool = amenities.filter(a => ['restaurant', 'bar', 'lounge', 'hot_tub'].includes(a.kind))
    if (!pool.length) pool = amenities
    const dest = pick(rng, pool)
    if (!p.mover.setGoal(dest.id)) return false
    p.state = 'outing'
    p.outing = dest
    world.log(`OUT ${p.id} ${p.name} head to ${dest.kind}`)
    return true
  }

  // a resolved task lifts the party; an expired one stings
  world.onTaskClosed = world.onTaskClosed || []
  world.onTaskClosed.push((t, outcome) => {
    if (!t.guest) return
    const p = parties.get(t.guest)
    if (!p) return
    p.waitingOn = null
    p.happiness = clamp(p.happiness + (outcome === 'done' ? 11 : -16), 0, 100)
    if (outcome === 'done') p.needTimer = 120 + rng() * 240
  })

  function stepParty(p, dt) {
    const decay = amount => { p.happiness = clamp(p.happiness - amount * dt, 0, 100) }

    // universal: waiting on an open task erodes happiness
    if (p.waitingOn) decay(0.12)
    // being stuck in a real jam erodes it too (short waits are hotel life)
    if (p.mover.active && p.mover.blockedFor > 8) decay(0.09)

    const status = p.mover.step(dt)

    switch (p.state) {
      case 'arriving':
        if (status === 'arrived') {
          p.state = 'queue'
          checkinQueue.push(p.id)
          p.queueT = 0
        }
        break

      case 'queue': {
        p.queueT += dt
        const idx = checkinQueue.indexOf(p.id)
        decay(0.06 + idx * 0.02)   // queue position hurts
        // front of the queue + a working front desk = service
        if (idx === 0) {
          const desk = world.staffAtDesk?.()
          if (desk) {
            p.serviceT = (p.serviceT || 0) + dt
            if (p.serviceT > CHECKIN_TIME) {
              const room = freeRoom()
              if (room) {
                checkinQueue.shift()
                rooms.get(room).status = 'occupied'
                rooms.get(room).party = p.id
                p.room = room
                p.happiness = clamp(p.happiness + 6, 0, 100)
                p.state = 'to_room'
                p.mover.setGoal(room)
                world.log(`CHECKIN ${p.id} ${p.name} -> ${room}`)
                world.toast(`${p.name} checking in!`, p.pos, p.floor)
              } else decay(0.15) // checked in but no room ready: misery
            }
          }
        }
        break
      }

      case 'to_room':
        if (status === 'arrived') {
          p.state = 'in_room'
          p.needTimer = 15 + rng() * 40
        }
        break

      case 'in_room': {
        p.happiness = clamp(p.happiness + 0.35 * dt, 0, 100) // resting is nice
        p.needTimer -= dt
        if (p.needTimer <= 0 && !p.waitingOn) {
          p.needTimer = 150 + rng() * 250
          makeRequest(p)
        }
        // dogs will be dogs
        if (p.dog && rng() < 0.00025) {
          const halls = world.layout.areas.filter(a => a.kind === 'corridor')
          const hall = pick(rng, halls)
          const pos = world.nav.randomPointIn(hall.id, rng)
          world.tasks.create({
            kind: 'clean', label: `${p.name}'s dog had an accident in ${hall.id}`,
            area: hall.id, floor: hall.floor, pos, requires: 'clean',
            patience: 220, work: 8,
          })
        }
        break
      }

      case 'outing':
        if (status === 'arrived') {
          p.state = 'at_amenity'
          p.dwell = 25 + rng() * 35
          p.happiness = clamp(p.happiness + 7, 0, 100)
        }
        break

      case 'at_amenity':
        p.dwell -= dt
        p.happiness = clamp(p.happiness + 0.15 * dt, 0, 100)
        if (p.dwell <= 0) {
          p.state = 'to_room'
          p.mover.setGoal(p.room)
        }
        break

      case 'leaving':
        if (status === 'arrived') {
          world.log(`GONE ${p.id} ${p.name} left ${p.walkout ? 'FURIOUS' : 'satisfied'}`)
          despawnParty(p)
        }
        break
    }

    // walkout check: fed-up guests leave and cost the hotel dearly
    if (p.happiness <= 8 && p.state !== 'leaving' && p.state !== 'gone') {
      p.walkout = true
      world.score.walkout(p)
      world.log(`WALKOUT ${p.id} ${p.name} storm out at ${hhmm(world.clock.t)}`)
      world.toast(`${p.name} storm out!!`, p.pos, p.floor, 'bad')
      if (p.room) { rooms.get(p.room).status = 'dirty'; rooms.get(p.room).party = null; autoCleanTask(p.room) }
      const idx = checkinQueue.indexOf(p.id); if (idx >= 0) checkinQueue.splice(idx, 1)
      p.mover.cancel()
      p.state = 'leaving'
      p.mover.setGoal('outdoor')
    }
  }

  function autoCleanTask(roomId) {
    const room = world.nav.areasById.get(roomId)
    world.tasks.create({
      kind: 'clean', label: `${roomId} needs housekeeping`,
      area: roomId, floor: room.floor, pos: world.nav.randomPointIn(roomId, rng),
      requires: 'clean', patience: 400, work: 12,
      onDone: () => { const r = rooms.get(roomId); if (r) r.status = 'clean' },
    })
    const r = rooms.get(roomId)
    if (r) r.status = 'dirty'
  }

  // arrival schedule: trickle all day, surges at check-in time and dinner
  let spawnClock = 0
  function arrivalsPerHour(hour) {
    const base = world.brief.roomsPerFloor * (world.brief.floors - 1) / 14
    if (hour >= 15 && hour < 18) return base * 3.2   // check-in rush
    if (hour >= 8 && hour < 11) return base * 1.4
    if (hour >= 19 && hour < 21) return base * 1.8
    if (hour < 7) return base * 0.3
    return base
  }

  const entity = {
    id: 'guests',
    resolve(event) {
      if (!event.tick) return
      const dt = (world.paused || world.gameOver) ? 0 : event.dt
      // spawning — the interval is tracked in game-seconds so changing the
      // game speed speeds arrivals up too
      spawnClock -= dt * world.clock.speed
      if (spawnClock <= 0) {
        const hour = world.clock.t / 3600
        const perHour = arrivalsPerHour(hour)
        spawnClock = 3600 / Math.max(0.2, perHour) * (0.6 + rng() * 0.8)
        const anyRoom = [...rooms.values()].some(r => r.status === 'clean')
        if (hour < 22 && (anyRoom || checkinQueue.length < 4)) spawnParty()
      }
      for (const p of [...parties.values()]) stepParty(p, dt)
      // render sync
      if (world.render) {
        for (const p of parties.values()) {
          const yExtra = (p.floorContinuous ?? p.floor) * world.view.explode
          p.entities.forEach((e, i) => {
            const off = [[0, 0], [0.45, 0.1], [-0.4, 0.25], [0.15, -0.45]][i] || [0, 0]
            syncPerson(e.pair, [p.pos[0] + off[0], p.pos[1], p.pos[2] + off[1]], yExtra, e.scale)
          })
        }
      }
    },
  }
  entity.resolve.filter = { tick: true }

  return {
    entity, parties, rooms, checkinQueue, autoCleanTask,
    stats() {
      const list = [...parties.values()].filter(p => p.state !== 'gone')
      const avg = list.length
        ? list.reduce((a, p) => a + p.happiness, 0) / list.length : 75
      return { count: list.length, avgHappiness: avg }
    },
  }
}
