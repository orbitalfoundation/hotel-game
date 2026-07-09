//
// Building systems as agents: elevator cabs and the robot dumbwaiter.
// Cabs are called to floors, hold a limited number of riders, break down
// (an incident sets `failed`; an engineer with a fix task clears it), and
// riders caught mid-ride during a failure are simply stuck — that's the
// game.
//

import { setPos } from './util.js'

const CAB_SPEED = 1.6      // m/s vertical
const DOOR_TIME = 2.4      // seconds doors stay open

export function makeSystems(world) {
  const cabs = new Map()
  for (const v of world.layout.verticals) {
    if (v.kind === 'stairs') continue
    cabs.set(v.kind, {
      id: v.kind, kind: v.kind, at: v.at.slice(), size: v.size,
      capacity: v.kind === 'dumbwaiter' ? 1 : v.capacity,
      y: 0, floor: 0, doorOpen: 0, failed: false,
      riders: new Map(),      // agentId -> toFloor
      calls: new Set(),       // floors requested
      tickets: new Map(),     // agentId -> { from, to, state }
      entities: null,
    })
  }

  const fh = world.layout.floorHeight

  function requestRide(agent, kind, fromFloor, toFloor) {
    const cab = cabs.get(kind)
    if (!cab) return null
    const t = { agentId: agent.id, from: fromFloor, to: toFloor, state: 'queued' }
    cab.tickets.set(agent.id, t)
    cab.calls.add(fromFloor)
    return { kind, agentId: agent.id }
  }

  function cancelRide(agentId) {
    for (const cab of cabs.values()) {
      cab.riders.delete(agentId)
      cab.tickets.delete(agentId)
    }
  }

  function rideStatus(ticket, agent) {
    if (!ticket) return 'failed'
    const cab = cabs.get(ticket.kind)
    const t = cab?.tickets.get(ticket.agentId)
    if (!cab || !t) return 'failed'
    if (t.state === 'queued') {
      if (cab.failed) { cab.tickets.delete(ticket.agentId); return 'failed' }
      const load = [...cab.riders.values()].reduce((a, r) => a + r.weight, 0)
      if (cab.floor === t.from && cab.doorOpen > 0 && load + (agent.weight || 1) <= cab.capacity) {
        cab.riders.set(agent.id, { to: t.to, weight: agent.weight || 1 })
        cab.calls.add(t.to)
        t.state = 'riding'
        return 'boarding'
      }
      cab.calls.add(t.from)
      return 'queued'
    }
    if (t.state === 'riding') {
      // rider follows the cab
      agent.pos[0] = cab.at[0]; agent.pos[2] = cab.at[1]; agent.pos[1] = cab.y
      agent.floorContinuous = cab.y / fh
      if (!cab.failed && cab.floor === t.to && cab.doorOpen > 0) {
        cab.riders.delete(agent.id)
        cab.tickets.delete(agent.id)
        delete agent.floorContinuous
        return 'done'
      }
      return 'riding'
    }
    return 'failed'
  }

  function step(dt) {
    for (const cab of cabs.values()) {
      if (cab.failed) { cab.doorOpen = 0; continue }
      if (cab.doorOpen > 0) { cab.doorOpen -= dt; continue }
      // pick the nearest requested floor
      if (!cab.calls.size) continue
      let best = null, bestD = Infinity
      for (const f of cab.calls) {
        const d = Math.abs(f * fh - cab.y)
        if (d < bestD) { best = f; bestD = d }
      }
      const targetY = best * fh
      const dy = targetY - cab.y
      const step = CAB_SPEED * dt * (cab.kind === 'dumbwaiter' ? 1.6 : 1)
      if (Math.abs(dy) <= step) {
        cab.y = targetY; cab.floor = best
        cab.calls.delete(best)
        cab.doorOpen = DOOR_TIME
      } else {
        cab.y += Math.sign(dy) * step
        cab.floor = Math.round(cab.y / fh)
      }
    }
  }

  function makeEntities() {
    const out = []
    for (const cab of cabs.values()) {
      const [w, d] = cab.size
      cab.entities = [{
        uuid: `cab-${cab.id}`, lita: { cab: cab.id },
        volume: {
          geometry: 'cube',
          material: { color: cab.kind === 'dumbwaiter' ? 0x39d98a : 0xdde3ea },
          pose: { position: { x: cab.at[0], y: 1.1, z: cab.at[1] },
                  scale: { x: w - 0.5, y: 2.2, z: d - 0.5 } },
        },
      }]
      out.push(...cab.entities)
    }
    return out
  }

  function sync(explode) {
    for (const cab of cabs.values()) {
      if (!cab.entities) continue
      const yExtra = (cab.y / fh) * explode
      setPos(cab.entities[0].volume.pose.position, cab.at[0], cab.y + yExtra + 1.1, cab.at[1])
    }
  }

  const entity = {
    id: 'systems',
    resolve(event) {
      if (event.tick && !world.paused && !world.gameOver) step(event.dt)
    },
  }
  entity.resolve.filter = { tick: true }

  return { entity, cabs, requestRide, rideStatus, cancelRide, makeEntities, sync }
}
