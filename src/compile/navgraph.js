//
// Nav graph: derived from an L2 layout, consumed by the sim.
//
// Nodes are area centers and portal points. Edges connect portals to the
// areas on both sides, portals to each other within an area (areas are
// convex rects, so straight lines stay inside), and vertical connector
// areas across floors (elevator / stairs / dumbwaiter).
//
// Three traversal worlds with different rules:
//   guest — front of house only; elevator and stairs; never service halls.
//   staff — everywhere except the dumbwaiter.
//   robot — everywhere except stairs; verticals only via the dumbwaiter;
//           guest-corridor travel is cost-penalized so robots prefer
//           service routes when they exist.
//
// find() returns a polyline of waypoints annotated with the area being
// entered, so the sim can meter occupancy and intercept elevator rides.
//

import { PARTS } from '../grammar/parts.js'

const GUEST_OK = new Set(['outdoor', 'parking', 'porte_cochere', 'corridor',
  'elevator', 'stairs', 'emergency_exit'])

function areaAllows(kind, world) {
  if (world === 'staff') return kind !== 'dumbwaiter'
  if (world === 'robot') return kind !== 'stairs'
  // guest
  if (GUEST_OK.has(kind)) return true
  const part = PARTS[kind]
  return part ? (part.world === 'guest' || part.world === 'both') : false
}

export function makeNavGraph(layout) {
  const yOf = f => f * layout.floorHeight
  const nodes = new Map()   // id -> { id, position, area, kind, floor }
  const edges = new Map()   // nodeId -> [{ to, cost, area, kind }]
  const areasById = new Map(layout.areas.map(a => [a.id, a]))

  const addNode = (id, position, area, kind, floor) => {
    if (!nodes.has(id)) { nodes.set(id, { id, position, area, kind, floor }); edges.set(id, []) }
    return nodes.get(id)
  }
  const addEdge = (a, b, area, kind = 'walk', costScale = 1) => {
    const pa = nodes.get(a).position, pb = nodes.get(b).position
    const cost = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]) * costScale || 0.5
    edges.get(a).push({ to: b, cost, area, kind })
    edges.get(b).push({ to: a, cost, area, kind })
  }

  // area center nodes
  for (const a of layout.areas) {
    const [x, z, w, d] = a.rect
    addNode(a.id, [x + w / 2, yOf(a.floor), z + d / 2], a.id, a.kind, a.floor)
  }
  // portal nodes + edges to both sides
  const portalsOfArea = new Map()
  for (const p of layout.portals) {
    addNode(p.id, [p.at[0], yOf(p.floor), p.at[1]], null, 'portal', p.floor)
    for (const side of [p.a, p.b]) {
      const area = areasById.get(side)
      if (!area) continue
      addEdge(p.id, side, side)
      if (!portalsOfArea.has(side)) portalsOfArea.set(side, [])
      portalsOfArea.get(side).push(p.id)
    }
  }
  // portal-to-portal shortcuts within each area (skip the center zigzag)
  for (const [areaId, pids] of portalsOfArea) {
    for (let i = 0; i < pids.length; i++)
      for (let j = i + 1; j < pids.length; j++)
        addEdge(pids[i], pids[j], areaId)
  }
  // vertical edges through connector shafts
  for (const v of layout.verticals) {
    for (let i = 0; i + 1 < v.floors.length; i++) {
      const a = `${v.id}-${v.floors[i]}`, b = `${v.id}-${v.floors[i + 1]}`
      if (!nodes.has(a) || !nodes.has(b)) continue
      const kind = v.kind
      const scale = kind === 'stairs' ? 3.0 : kind === 'elevator' ? 3.5 : 2.0
      addEdge(a, b, a, kind, scale)
    }
  }

  // ---- pathfinding ------------------------------------------------------
  const allowed = (nodeId, world) => {
    const n = nodes.get(nodeId)
    if (!n) return false
    if (n.kind === 'portal') return true
    return areaAllows(n.kind, world)
  }
  const edgeAllowed = (e, world) => {
    if (world === 'guest' && e.kind === 'dumbwaiter') return false
    if (world === 'staff' && e.kind === 'dumbwaiter') return false
    if (world === 'robot' && (e.kind === 'stairs' || e.kind === 'elevator')) return false
    return true
  }
  const edgeCost = (e, world) => {
    let c = e.cost
    if (world === 'robot') {
      const area = areasById.get(e.area)
      if (area && area.kind === 'corridor') c *= 2.0   // prefer service routes
    }
    return c
  }

  // Dijkstra — the graph is small (a few hundred nodes).
  function route(fromId, toId, world) {
    if (!nodes.has(fromId) || !nodes.has(toId)) return null
    const dist = new Map([[fromId, 0]]), prev = new Map()
    const open = [[0, fromId]]
    const done = new Set()
    while (open.length) {
      let bi = 0
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i
      const [d, u] = open.splice(bi, 1)[0]
      if (u === toId) break
      if (done.has(u)) continue
      done.add(u)
      for (const e of edges.get(u)) {
        if (done.has(e.to)) continue
        if (!edgeAllowed(e, world)) continue
        // destination itself is exempt from world rules so a guest can be
        // *sent* somewhere odd if the game demands it; intermediate hops
        // are not
        if (e.to !== toId && !allowed(e.to, world)) continue
        const nd = d + edgeCost(e, world)
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd); prev.set(e.to, [u, e])
          open.push([nd, e.to])
        }
      }
    }
    if (!prev.has(toId) && fromId !== toId) return null
    const hops = []
    let cur = toId
    while (cur !== fromId) {
      const [p, e] = prev.get(cur)
      hops.unshift({ node: nodes.get(cur), via: e })
      cur = p
    }
    return hops
  }

  // Which area contains a point on a floor (smallest match wins so halls
  // don't swallow rooms; 'outdoor' is the fallback).
  function areaAtPoint(x, z, floor) {
    let best = null, bestSize = Infinity
    for (const a of layout.areas) {
      if (a.floor !== floor) continue
      const [ax, az, w, d] = a.rect
      if (x >= ax && x <= ax + w && z >= az && z <= az + d) {
        const size = w * d
        if (size < bestSize) { best = a; bestSize = size }
      }
    }
    return best
  }

  function randomPointIn(areaId, rng = Math.random) {
    const a = areasById.get(areaId)
    if (!a) return [0, 0, 0]
    const [x, z, w, d] = a.rect
    const m = Math.min(0.8, w / 4, d / 4) // stay off the walls
    return [x + m + rng() * (w - 2 * m), yOf(a.floor), z + m + rng() * (d - 2 * m)]
  }

  // A doorway waypoint sits exactly on the wall line, so walking door-to-
  // door along one wall would run *inside* the wall (and bodies clip its
  // face). Give each portal an approach point inset into the area on each
  // side: travel parallels walls at body distance and crossings pass
  // perpendicular through the door center.
  const INSET = 0.55
  function insetPoint(portalNode, areaId) {
    const a = areasById.get(areaId)
    if (!a) return null
    const [ax, az, w, d] = a.rect
    const [px, , pz] = portalNode.position
    const y = portalNode.position[1]
    if (Math.abs(pz - az) < 0.35) return [px, y, az + Math.min(INSET, d / 3)]
    if (Math.abs(pz - (az + d)) < 0.35) return [px, y, az + d - Math.min(INSET, d / 3)]
    if (Math.abs(px - ax) < 0.35) return [ax + Math.min(INSET, w / 3), y, pz]
    if (Math.abs(px - (ax + w)) < 0.35) return [ax + w - Math.min(INSET, w / 3), y, pz]
    return null
  }

  // find: from an arbitrary position to a target area. Returns waypoints
  // [{ position, area, kind, via }] ending inside the target.
  function find(fromPos, floor, toAreaId, world, rng) {
    const here = areaAtPoint(fromPos[0], fromPos[2], floor)
    if (!here) return null
    if (here.id === toAreaId)
      return [{ position: randomPointIn(toAreaId, rng), area: toAreaId, kind: here.kind }]
    const hops = route(here.id, toAreaId, world)
    if (!hops) return null
    const way = []
    let prevArea = here.id
    for (let i = 0; i < hops.length; i++) {
      const h = hops[i]
      const isTarget = h.node.id === toAreaId
      const base = {
        area: h.node.kind === 'portal' ? (h.via?.area ?? null) : h.node.id,
        node: h.node.id,
        kind: h.node.kind,
        via: h.via?.kind || 'walk',
      }
      if (h.node.kind === 'portal' && base.via === 'walk') {
        // area after the door = the area of the edge leaving this portal
        const next = hops[i + 1]
        const afterArea = next
          ? (next.node.kind === 'portal' ? next.via?.area : next.node.id)
          : toAreaId
        const inA = insetPoint(h.node, prevArea)
        const inB = insetPoint(h.node, afterArea)
        if (inA) way.push({ ...base, position: inA })
        way.push({ ...base, position: h.node.position.slice() })
        if (inB) way.push({ ...base, area: afterArea, position: inB })
      } else {
        way.push({
          ...base,
          position: isTarget ? randomPointIn(toAreaId, rng) : h.node.position.slice(),
        })
      }
      if (base.area) prevArea = base.area
      if (h.node.kind !== 'portal') prevArea = h.node.id
    }
    return way
  }

  return { nodes, edges, areasById, route, find, areaAtPoint, randomPointIn, yOf }
}
