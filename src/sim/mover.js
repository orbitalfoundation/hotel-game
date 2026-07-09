//
// Mover: shared movement along nav-graph paths, with occupancy metering
// (only so many bodies fit in an area), robot corridor exclusivity, stair
// walking, and elevator/dumbwaiter rides delegated to the systems module.
//
// An agent using a mover carries: pos [x,y,z], floor, area, speed (m/s).
//

import { dist2d } from './util.js'

export function makeMover(world, agent, travelWorld) {
  let path = null, wpi = 0, waited = 0, ride = null

  const occupancyBlocked = (wp) => {
    if (!wp.area || wp.area === agent.area) return false
    const areaRec = world.nav.areasById.get(wp.area)
    if (!areaRec) return false
    const occ = world.occupancy.get(wp.area)
    const cap = world.capacity.get(wp.area) ?? 99
    const count = occ ? occ.size : 0
    if (count >= cap) return true
    // robots yield to other robots in guest hallways — one bot at a time
    // (the service corridor tolerates two before they gridlock)
    if (travelWorld === 'robot' &&
        (areaRec.kind === 'corridor' || areaRec.kind === 'service_corridor')) {
      const limit = areaRec.kind === 'corridor' ? 1 : 2
      let bots = 0
      if (occ) for (const other of occ)
        if (other !== agent.id && other.startsWith('robot')) bots++
      if (bots >= limit) return true
    }
    return false
  }

  const enterArea = (areaId) => {
    if (agent.area === areaId) return
    world.occupancy.get(agent.area)?.delete(agent.id)
    agent.area = areaId
    if (areaId) {
      if (!world.occupancy.has(areaId)) world.occupancy.set(areaId, new Set())
      world.occupancy.get(areaId).add(agent.id)
    }
  }

  // Collapse chains of vertical-shaft waypoints into ride pseudo-waypoints.
  const compress = (way) => {
    const out = []
    let i = 0
    while (i < way.length) {
      const wp = way[i]
      if (wp.via === 'elevator' || wp.via === 'dumbwaiter') {
        const kind = wp.via
        let j = i
        while (j + 1 < way.length && way[j + 1].via === kind) j++
        const fromFloor = Math.round(way[i - 1]?.position[1] / world.layout.floorHeight) || agent.floor
        const toFloor = Math.round(way[j].position[1] / world.layout.floorHeight)
        out.push({ ride: kind, fromFloor, toFloor, position: way[j].position, area: way[j].area })
        i = j + 1
      } else {
        out.push(wp); i++
      }
    }
    return out
  }

  return {
    get active() { return !!path },
    get blockedFor() { return waited },

    setGoal(areaId) {
      const way = world.nav.find(agent.pos, agent.floor, areaId, travelWorld, world.rng)
      if (!way) return false
      path = compress(way); wpi = 0; waited = 0; ride = null
      return true
    },

    cancel() { path = null; ride = null; world.systems?.cancelRide(agent.id) },

    // returns 'idle' | 'moving' | 'blocked' | 'riding' | 'arrived'
    step(dt) {
      if (!path) return 'idle'
      if (wpi >= path.length) { path = null; return 'arrived' }
      const wp = path[wpi]

      // ---- vertical rides ------------------------------------------------
      if (wp.ride) {
        if (!ride) ride = world.systems.requestRide(agent, wp.ride, wp.fromFloor, wp.toFloor)
        const s = world.systems.rideStatus(ride, agent, dt)
        if (s === 'riding' || s === 'queued' || s === 'boarding') {
          waited = s === 'queued' ? waited + dt : 0
          return s === 'queued' ? 'blocked' : 'riding'
        }
        if (s === 'done') {
          agent.floor = wp.toFloor
          agent.pos[0] = wp.position[0]; agent.pos[1] = wp.position[1]; agent.pos[2] = wp.position[2]
          enterArea(wp.area)
          ride = null; wpi++; waited = 0
          return 'moving'
        }
        if (s === 'failed') { // shaft out of service: replan around it
          ride = null
          const goal = path[path.length - 1].area
          path = null
          if (goal) this.setGoal(goal)
          return 'blocked'
        }
        return 'blocked'
      }

      // ---- occupancy gate --------------------------------------------------
      if (occupancyBlocked(wp)) {
        waited += dt
        if (waited > 8) { // give up on this route, replan
          const goal = path[path.length - 1].area
          path = null; waited = 0
          if (goal) this.setGoal(goal)
        }
        return 'blocked'
      }

      // ---- walk toward waypoint ---------------------------------------------
      const p = agent.pos, t = wp.position
      const d = dist2d(p, t)
      const dy = t[1] - p[1]
      const step = agent.speed * dt
      if (d <= step + 0.05) {
        p[0] = t[0]; p[1] = t[1]; p[2] = t[2]
        if (wp.area) enterArea(wp.area)
        if (Number.isFinite(t[1])) agent.floor = Math.round(t[1] / world.layout.floorHeight)
        wpi++; waited = 0
        if (wpi >= path.length) { path = null; return 'arrived' }
        return 'moving'
      }
      p[0] += (t[0] - p[0]) / d * step
      p[2] += (t[2] - p[2]) / d * step
      if (Math.abs(dy) > 0.01) p[1] += dy / d * step // stairs slope
      waited = 0
      return 'moving'
    },
  }
}
