//
// Layout compiler: L1 brief -> L2 layout.
//
// The scheme is deliberately the archetype real hotels use: a podium
// ground floor organized as bands (front of house / guest hall / amenities
// / service hall / back of house) and double-loaded corridor guest floors
// above, with a vertical core (elevator, stairs, dumbwaiter) fixed at the
// same position on every floor.
//
// Coordinates: meters. x runs along the building width, z along its depth
// (front of hotel at low z), y is up (floor * FLOOR_HEIGHT). An area rect
// is [x, z, w, d] on its floor.
//
// Output (L2):
//   {
//     id, about, theme, seed, floors, floorHeight, bounds: [W, D],
//     areas:    [{ id, kind, floor, rect, name? }],
//     portals:  [{ id, a, b, floor, at: [x, z], width, kind }],
//     verticals:[{ id, kind, at: [x, z], size, floors: [..], capacity }],
//   }
//
// 'outdoor' is a real area (floor 0, generous rect around the building) so
// arrivals, parking and emergency exits are ordinary portals.
//

import { PARTS, FLOOR_HEIGHT } from '../grammar/parts.js'

const HALL_W = 2.6          // guest corridor width
const SERVICE_HALL_W = 2.2  // service corridor width
const DOOR = 1.0
const OPENING = 3.0

export function compileLayout(brief) {
  const out = {
    id: brief.id,
    about: brief.about,
    theme: brief.theme || 'default',
    seed: brief.seed || 1,
    floors: brief.floors,
    floorHeight: FLOOR_HEIGHT,
    areas: [],
    portals: [],
    verticals: [],
  }
  const size = kind => {
    const o = brief.overrides?.[kind]?.size
    return o ? o.slice() : (PARTS[kind].size || [4, 4]).slice()
  }

  // ---- the vertical core: sized first, placed at the east end -----------
  // [elevator | stairs | dumbwaiter] side by side, opening north onto the
  // guest hall / upper corridor.
  const core = ['elevator', 'stairs', 'dumbwaiter']
    .map(kind => ({ kind, w: size(kind)[0], d: size(kind)[1] }))
  const coreW = core.reduce((a, c) => a + c.w, 0)
  const coreD = Math.max(...core.map(c => c.d))

  // ---- ground floor bands ------------------------------------------------
  const frontParts = ['lobby', 'front_desk']
    .concat(brief.parts.filter(p => p === 'lounge'))
  const amenityParts = brief.parts.filter(p => PARTS[p]?.band === 'amenity')
  const backParts = ['kitchen', 'laundry', 'housekeeping', 'engineering',
    'office', 'security_office', 'staff_room', 'storage', 'robot_bay']
    .filter(p => p !== 'kitchen' || amenityParts.some(a =>
      ['breakfast', 'restaurant', 'bar'].includes(a)) || brief.parts.includes('kitchen'))

  const rowWidth = parts => parts.reduce((a, p) => a + size(p)[0], 0)
  const roomsPerRow = Math.ceil(brief.roomsPerFloor / 2)
  const roomW = size('guest_room')[0]
  const roomD = size('guest_room')[1]
  const upperW = roomsPerRow * roomW + coreW + size('robot_nook')[0] + size('storage')[0]

  const W = Math.max(rowWidth(frontParts), rowWidth(amenityParts) + coreW,
    rowWidth(backParts), upperW)

  // Band depths
  const frontD = Math.max(...frontParts.map(p => size(p)[1]))
  const amenityD = Math.max(coreD, ...amenityParts.map(p => size(p)[1]), 6)
  const backD = Math.max(...backParts.map(p => size(p)[1]))

  // z cursors, front (z=0) to back
  const zFront = 0
  const zHall = zFront + frontD              // guest hall strip
  const zAmenity = zHall + HALL_W
  const zService = zAmenity + amenityD       // service hall strip
  const zBack = zService + SERVICE_HALL_W
  const D = zBack + backD
  out.bounds = [W, D]

  const area = (id, kind, floor, rect, name) => {
    const a = { id, kind, floor, rect, name }
    out.areas.push(a)
    return a
  }
  let pid = 0
  const portal = (a, b, floor, at, width = DOOR, kind = 'door') =>
    out.portals.push({ id: `portal-${pid++}`, a, b, floor, at, width, kind })

  // Outdoors is a RING of strips around the footprint — never a rect that
  // contains the building, or outdoor paths cut straight through the walls.
  // 'outdoor' proper is the street side (the front strip); guests arrive
  // and leave there.
  const MARGIN = 12
  area('outdoor', 'outdoor', 0, [-MARGIN, -MARGIN, W + 2 * MARGIN, MARGIN])
  area('outdoor-back', 'outdoor', 0, [-MARGIN, D, W + 2 * MARGIN, MARGIN])
  area('outdoor-west', 'outdoor', 0, [-MARGIN, 0, MARGIN, D])
  area('outdoor-east', 'outdoor', 0, [W, 0, MARGIN, D])
  portal('outdoor', 'outdoor-west', 0, [-MARGIN / 2, 0], MARGIN * 0.8, 'outdoor')
  portal('outdoor', 'outdoor-east', 0, [W + MARGIN / 2, 0], MARGIN * 0.8, 'outdoor')
  portal('outdoor-back', 'outdoor-west', 0, [-MARGIN / 2, D], MARGIN * 0.8, 'outdoor')
  portal('outdoor-back', 'outdoor-east', 0, [W + MARGIN / 2, D], MARGIN * 0.8, 'outdoor')
  if (brief.parts.includes('parking')) {
    const [pw, pd] = size('parking')
    // parking pad sits in the west strip; its south edge opens onto it
    area('parking', 'parking', 0, [-MARGIN, 0, Math.min(pw, MARGIN), pd])
    portal('parking', 'outdoor-west', 0, [-MARGIN + Math.min(pw, MARGIN) / 2, pd], OPENING, 'outdoor')
  }
  if (brief.parts.includes('porte_cochere')) {
    const [pw, pd] = size('porte_cochere')
    area('porte_cochere', 'porte_cochere', 0, [W / 2 - pw / 2, -pd, pw, pd])
    portal('porte_cochere', 'outdoor', 0, [W / 2, -pd - 0.2], OPENING, 'outdoor')
  }

  // Lay a row of parts across [0, W] at band [z0, depth], stretching part
  // widths proportionally so the row fills the building exactly.
  // reserveEast leaves room (e.g. for the core) at the east end.
  const layRow = (parts, z0, depth, floor, reserveEast = 0) => {
    const natural = rowWidth(parts)
    const scale = (W - reserveEast) / natural
    let x = 0
    const placed = []
    for (const p of parts) {
      const w = size(p)[0] * scale
      placed.push(area(p, p, floor, [x, z0, w, depth]))
      x += w
    }
    return placed
  }

  const frontRow = layRow(frontParts, zFront, frontD, 0)
  const amenityRow = layRow(amenityParts, zAmenity, amenityD, 0, coreW)
  const backRow = layRow(backParts, zBack, backD, 0)

  // Halls as areas (full width strips)
  area('hall-0', 'corridor', 0, [0, zHall, W, HALL_W])
  area('service-hall-0', 'service_corridor', 0, [0, zService, W, SERVICE_HALL_W])

  // ---- core placement (identical rect on every floor) --------------------
  // Core sits at the east end, in the amenity band, opening north onto the
  // guest hall (ground) / corridor (upper floors, which share the hall z).
  {
    let x = W - coreW
    for (const c of core) {
      const idBase = c.kind
      out.verticals.push({
        id: idBase, kind: c.kind,
        at: [x + c.w / 2, zAmenity + c.d / 2],
        size: [c.w, c.d],
        floors: Array.from({ length: brief.floors }, (_, i) => i),
        capacity: PARTS[c.kind].capacity,
      })
      // per-floor area + door onto the hall/corridor of that floor
      for (let f = 0; f < brief.floors; f++) {
        const aid = `${idBase}-${f}`
        area(aid, c.kind, f, [x, zAmenity, c.w, c.d])
        const hall = f === 0 ? 'hall-0' : `hall-${f}`
        // dumbwaiter opens onto the service hall on the ground floor
        const target = (c.kind === 'dumbwaiter' && f === 0) ? 'service-hall-0' : hall
        const doorZ = (c.kind === 'dumbwaiter' && f === 0) ? zService : zAmenity
        portal(aid, target, f, [x + c.w / 2, doorZ], c.kind === 'stairs' ? DOOR : c.w * 0.8,
          c.kind === 'stairs' ? 'door' : `${c.kind}_door`)
      }
      x += c.w
    }
  }

  // ---- ground floor doors -------------------------------------------------
  // Front row rooms open south onto the guest hall; lobby also opens to the
  // outdoors (the entrance) and gets a wide opening to its row neighbors.
  for (const a of frontRow) {
    const [x, z, w, d] = a.rect
    portal(a.id, 'hall-0', 0, [x + w / 2, z + d], a.kind === 'lobby' ? OPENING : DOOR,
      a.kind === 'lobby' ? 'opening' : 'door')
  }
  const lobby = frontRow.find(a => a.kind === 'lobby')
  {
    const [x, , w] = lobby.rect
    const entranceTarget = brief.parts.includes('porte_cochere') ? 'porte_cochere' : 'outdoor'
    portal('lobby', entranceTarget, 0, [x + w / 2, 0], OPENING, 'entrance')
  }
  // openings between adjacent front-row rooms (front desk reachable from lobby)
  for (let i = 0; i + 1 < frontRow.length; i++) {
    const a = frontRow[i], b = frontRow[i + 1]
    const xShared = b.rect[0]
    portal(a.id, b.id, 0, [xShared, a.rect[1] + a.rect[3] / 2], OPENING, 'opening')
  }
  // Amenity rooms open north onto the guest hall
  for (const a of amenityRow) {
    const [x, z, w] = a.rect
    portal(a.id, 'hall-0', 0, [x + w / 2, z], PARTS[a.kind].wet ? DOOR : OPENING,
      PARTS[a.kind].wet ? 'door' : 'opening')
    // and a service door south onto the service hall for F&B rooms
    if (['breakfast', 'restaurant', 'bar'].includes(a.kind))
      portal(a.id, 'service-hall-0', 0, [x + w / 2, zService], DOOR, 'service_door')
  }
  // Back of house rooms open north onto the service hall
  for (const a of backRow) {
    const [x, z, w] = a.rect
    portal(a.id, 'service-hall-0', 0, [x + w / 2, z], DOOR, 'door')
  }
  // Staff door joining the two halls at the west end, and at the core
  portal('hall-0', 'service-hall-0', 0, [1.2, zAmenity + amenityD / 2], DOOR, 'staff_door')
  // Emergency exits: west end of guest hall, and loading exit from service hall
  portal('hall-0', 'outdoor-west', 0, [0, zHall + HALL_W / 2], DOOR, 'emergency_exit')
  portal('service-hall-0', 'outdoor-east', 0, [W, zService + SERVICE_HALL_W / 2], DOOR, 'service_exit')

  // ---- upper floors ---------------------------------------------------------
  // Double-loaded corridor at the same z as the ground guest hall. Rooms
  // north (toward the front) and south; the south row yields the east end
  // to the core; a robot nook and a linen closet sit beside the core.
  let roomNumber = 0
  for (let f = 1; f < brief.floors; f++) {
    const hallId = `hall-${f}`
    area(hallId, 'corridor', f, [0, zHall, W, HALL_W])

    const nook = size('robot_nook'), linen = size('storage')
    const southReserved = coreW + nook[0] + linen[0]
    const northCount = Math.ceil(brief.roomsPerFloor / 2)
    const southCount = brief.roomsPerFloor - northCount

    const lay = (count, z0, depth, reserved, doorZ) => {
      const wEach = (W - reserved) / count
      for (let i = 0; i < count; i++) {
        const id = `room-${f}${String(i + (z0 < zHall ? 0 : northCount) + 1).padStart(2, '0')}`
        roomNumber++
        area(id, 'guest_room', f, [i * wEach, z0, wEach, depth],
          `Room ${f}${String(i + (z0 < zHall ? 0 : northCount) + 1).padStart(2, '0')}`)
        portal(id, hallId, f, [i * wEach + wEach / 2, doorZ], DOOR, 'door')
      }
    }
    lay(northCount, zHall - roomD, roomD, 0, zHall)
    if (southCount > 0) lay(southCount, zAmenity, roomD, southReserved, zAmenity)

    // robot nook + linen closet just west of the core, opening onto the hall
    const nookX = W - coreW - nook[0]
    area(`robot-nook-${f}`, 'robot_nook', f, [nookX, zAmenity, nook[0], nook[1]])
    portal(`robot-nook-${f}`, hallId, f, [nookX + nook[0] / 2, zAmenity], DOOR, 'robot_door')
    const linenX = nookX - linen[0]
    area(`linen-${f}`, 'storage', f, [linenX, zAmenity, linen[0], linen[1]])
    portal(`linen-${f}`, hallId, f, [linenX + linen[0] / 2, zAmenity], DOOR, 'door')
  }

  return out
}
