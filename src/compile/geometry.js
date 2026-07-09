//
// Geometry compiler: L2 layout -> L3 renderable entities (orbital-volume).
//
// Presentation only — the sim never reads these. Every entity carries a
// `lita` component with its floor so the app can explode floors apart for
// visibility (dollhouse view: no ceilings, floors separated vertically).
//
// Walls are built per floor by collecting boundary intervals along shared
// edges (so neighboring rooms don't double the wall), subtracting portal
// gaps, and emitting thin boxes.
//

import { FLOOR_HEIGHT } from '../grammar/parts.js'

const WALL_H = 2.4
const WALL_T = 0.16
const SLAB_T = 0.18

export const THEMES = {
  default: {
    bg: 0x181c22, ground: 0x2c3440, wall: 0xd8d2c4, groundSize: 160,
    floorColors: {}, accent: 0xff8844,
  },
  countryside: {
    bg: 0xbfd7e8, ground: 0x6f9e5a, wall: 0xefe6d2, accent: 0x8a5a33,
    sun: { intensity: 1.1, position: [40, 60, 20] },
    props: 'trees',
  },
  tropical: {
    bg: 0x9fd8ef, ground: 0xe4d5a3, wall: 0xfdf6e3, accent: 0x1fb6a6,
    sun: { intensity: 1.3, position: [30, 70, 10] },
    props: 'palms', water: 0x2ec4d6,
  },
  brooklyn: {
    bg: 0x2a2f3a, ground: 0x3a3f46, wall: 0x9a6b4f, accent: 0xffc857,
    sun: { intensity: 0.7, position: [-30, 50, -20] },
    props: 'city',
  },
  arctic: {
    bg: 0x0e1a2e, ground: 0xe8f1f7, wall: 0x7c8ea0, accent: 0x64d2ff,
    sun: { intensity: 0.5, position: [-20, 30, 40] },
    props: 'ice',
  },
  underwater: {
    bg: 0x06283d, ground: 0x0f4c5c, wall: 0x1a6f8a, accent: 0x9ff0e8,
    fog: { color: 0x06283d, near: 20, far: 140 },
    sun: { intensity: 0.6, position: [0, 80, 0] },
    props: 'reef',
  },
}

const FLOOR_COLORS = {
  lobby: 0xc9b48a, front_desk: 0xb89a6a, lounge: 0xb98f68, corridor: 0xa9a29a,
  service_corridor: 0x8a8f96, breakfast: 0xc7a97c, restaurant: 0xb07a52,
  bar: 0x7a5230, pool: 0x76c7d4, hot_tub: 0x76c7d4, gym: 0x8fa3ad, spa: 0xcbb8d8,
  guest_room: 0xb9c4b0, suite: 0xc4b9d0, kitchen: 0xd7dde2, laundry: 0xd0d8dd,
  housekeeping: 0xc4cbd2, storage: 0x9aa1a8, engineering: 0x7d858d,
  office: 0xb6bec6, security_office: 0x99a4b0, staff_room: 0xb9ae9a,
  robot_bay: 0x5f6f7a, robot_nook: 0x5f6f7a, loading_dock: 0x6f7780,
  elevator: 0x888f96, stairs: 0x9aa1a8, dumbwaiter: 0x55606a,
  parking: 0x4c525a, porte_cochere: 0x8f9aa4,
}

let uid = 0
const ent = (uuid, geometry, position, scale, color, extra = {}, material = {}) => ({
  uuid: uuid || `geom-${uid++}`,
  lita: { geom: true, floor: extra.floor ?? 0 },
  volume: {
    geometry,
    static: true,   // built once; volume skips it on tick (pose stays live-bound)
    material: { color, ...material },
    pose: { position: { x: position[0], y: position[1], z: position[2] },
            scale: { x: scale[0], y: scale[1], z: scale[2] } },
    ...extra.volume,
  },
})

export function compileGeometry(layout) {
  uid = 0
  const theme = THEMES[layout.theme] || THEMES.default
  const out = []
  const [W, D] = layout.bounds
  const cx = W / 2, cz = D / 2
  const yOf = f => f * FLOOR_HEIGHT

  // ---- ground plane -------------------------------------------------------
  const gs = theme.groundSize || 140
  out.push(ent('ground', 'cube', [cx, -SLAB_T - 0.06, cz], [gs, 0.12, gs], theme.ground))

  // ---- per-area floor tiles ----------------------------------------------
  for (const a of layout.areas) {
    if (a.kind === 'outdoor') continue
    const [x, z, w, d] = a.rect
    const color = FLOOR_COLORS[a.kind] ?? 0xa0a0a0
    const wet = (a.kind === 'pool' || a.kind === 'hot_tub')
    out.push(ent(`floor-${a.id}`, 'cube',
      [x + w / 2, yOf(a.floor) - SLAB_T / 2, z + d / 2],
      [w - 0.05, SLAB_T, d - 0.05], color,
      { floor: a.floor }))
    if (wet && theme.water !== undefined)
      out.push(ent(`water-${a.id}`, 'cube',
        [x + w / 2, yOf(a.floor) + 0.18, z + d / 2],
        [w - 1.6, 0.35, d - 1.6], theme.water, { floor: a.floor },
        { opacity: 0.75, transparent: true }))
  }

  // ---- walls ---------------------------------------------------------------
  // Collect intervals per (floor, orientation, line). orientation 'h' means
  // the wall runs along x at fixed z; 'v' runs along z at fixed x.
  const lines = new Map()
  const addInterval = (floor, orient, at, from, to) => {
    const key = `${floor}|${orient}|${at.toFixed(2)}`
    if (!lines.has(key)) lines.set(key, { floor, orient, at, spans: [] })
    lines.get(key).spans.push([Math.min(from, to), Math.max(from, to)])
  }
  const OUTDOORISH = new Set(['outdoor', 'parking', 'porte_cochere'])
  for (const a of layout.areas) {
    if (OUTDOORISH.has(a.kind)) continue
    const [x, z, w, d] = a.rect
    addInterval(a.floor, 'h', z, x, x + w)          // north edge
    addInterval(a.floor, 'h', z + d, x, x + w)      // south edge
    addInterval(a.floor, 'v', x, z, z + d)          // west edge
    addInterval(a.floor, 'v', x + w, z, z + d)      // east edge
  }

  // union spans, subtract portal gaps, emit boxes
  for (const line of lines.values()) {
    // union
    const spans = line.spans.sort((s, t) => s[0] - t[0])
    const merged = []
    for (const s of spans) {
      const last = merged[merged.length - 1]
      if (last && s[0] <= last[1] + 0.01) last[1] = Math.max(last[1], s[1])
      else merged.push(s.slice())
    }
    // gaps from portals sitting on this line
    const gaps = []
    for (const p of layout.portals) {
      if (p.floor !== line.floor) continue
      const [px, pz] = p.at
      const on = line.orient === 'h'
        ? Math.abs(pz - line.at) < 0.3 : Math.abs(px - line.at) < 0.3
      if (!on) continue
      const c = line.orient === 'h' ? px : pz
      gaps.push([c - p.width / 2, c + p.width / 2])
    }
    gaps.sort((a, b) => a[0] - b[0])
    // subtract
    const pieces = []
    for (const [s0, s1] of merged) {
      let cur = s0
      for (const [g0, g1] of gaps) {
        if (g1 <= cur || g0 >= s1) continue
        if (g0 > cur) pieces.push([cur, g0])
        cur = Math.max(cur, g1)
      }
      if (cur < s1) pieces.push([cur, s1])
    }
    for (const [p0, p1] of pieces) {
      const len = p1 - p0
      if (len < 0.12) continue
      const mid = (p0 + p1) / 2
      const y = yOf(line.floor) + WALL_H / 2
      if (line.orient === 'h')
        out.push(ent(null, 'cube', [mid, y, line.at], [len, WALL_H, WALL_T],
          theme.wall, { floor: line.floor }))
      else
        out.push(ent(null, 'cube', [line.at, y, mid], [WALL_T, WALL_H, len],
          theme.wall, { floor: line.floor }))
    }
  }

  // ---- props per area -------------------------------------------------------
  for (const a of layout.areas) {
    const [x, z, w, d] = a.rect
    const y = yOf(a.floor)
    const cx2 = x + w / 2, cz2 = z + d / 2
    const f = { floor: a.floor }
    switch (a.kind) {
      case 'guest_room': {
        // semantic placement: the bed backs onto the wall OPPOSITE the door
        // (headboard + pillow against it), the dresser hugs the door wall
        // off to the side of the doorway
        const door = layout.portals.find(p =>
          (p.a === a.id || p.b === a.id) && p.kind === 'door')
        const side = !door ? 'N'
          : Math.abs(door.at[1] - z) < 0.3 ? 'N'
          : Math.abs(door.at[1] - (z + d)) < 0.3 ? 'S'
          : Math.abs(door.at[0] - x) < 0.3 ? 'W' : 'E'
        const BL = 2.1, BW = 1.7   // bed length (into room) and width
        if (side === 'N' || side === 'S') {
          const bedZ = side === 'N' ? z + d - BL / 2 - 0.15 : z + BL / 2 + 0.15
          const pilZ = side === 'N' ? z + d - 0.4 : z + 0.4
          out.push(ent(null, 'cube', [cx2, y + 0.3, bedZ], [BW, 0.5, BL], 0xffffff, f))
          out.push(ent(null, 'cube', [cx2, y + 0.62, pilZ], [1.5, 0.22, 0.5], theme.accent, f))
          // dresser on the door wall, shifted away from the doorway
          const doorX = door ? door.at[0] : cx2
          const dx = doorX < cx2 ? x + w - 0.55 : x + 0.55
          const dz = side === 'N' ? z + 0.65 : z + d - 0.65
          out.push(ent(null, 'cube', [dx, y + 0.4, dz], [0.9, 0.8, 1.1], 0x7a5b3a, f))
        } else {
          const bedX = side === 'W' ? x + w - BL / 2 - 0.15 : x + BL / 2 + 0.15
          const pilX = side === 'W' ? x + w - 0.4 : x + 0.4
          out.push(ent(null, 'cube', [bedX, y + 0.3, cz2], [BL, 0.5, BW], 0xffffff, f))
          out.push(ent(null, 'cube', [pilX, y + 0.62, cz2], [0.5, 0.22, 1.5], theme.accent, f))
          const doorZ = door ? door.at[1] : cz2
          const dz = doorZ < cz2 ? z + d - 0.55 : z + 0.55
          const dx = side === 'W' ? x + 0.65 : x + w - 0.65
          out.push(ent(null, 'cube', [dx, y + 0.4, dz], [1.1, 0.8, 0.9], 0x7a5b3a, f))
        }
        break
      }
      case 'front_desk':
        out.push(ent(null, 'cube', [cx2, y + 0.55, cz2], [Math.min(3.4, w * 0.7), 1.1, 0.7], 0x6b4a2f, f))
        break
      case 'lobby': case 'lounge':
        for (const dx of [-1.4, 1.4])
          out.push(ent(null, 'cube', [cx2 + dx, y + 0.28, cz2 + 1.2], [1.9, 0.55, 0.85], theme.accent, f))
        out.push(ent(null, 'cylinder', [cx2, y + 0.3, cz2 - 1.2], [1, 1, 1],
          0x9c7a4d, { ...f, volume: { props: [0.65, 0.65, 0.6, 18, 1] } }))
        break
      case 'breakfast': case 'restaurant': case 'bar': {
        const n = Math.max(2, Math.floor(w * d / 22))
        for (let i = 0; i < n; i++) {
          const tx = x + 1.6 + ((i * 2.7) % Math.max(1, w - 3.2))
          const tz = z + 1.6 + Math.floor((i * 2.7) / Math.max(1, w - 3.2)) * 2.6
          if (tz > z + d - 1.4) break
          out.push(ent(null, 'cylinder', [tx, y + 0.42, tz], [1, 1, 1],
            a.kind === 'bar' ? 0x3a2a20 : 0xd9c9a8, { ...f, volume: { props: [0.55, 0.5, 0.84, 14, 1] } }))
        }
        break
      }
      case 'kitchen':
        out.push(ent(null, 'cube', [cx2, y + 0.45, z + 1.0], [w * 0.7, 0.9, 0.8], 0xc9ced4, f))
        out.push(ent(null, 'cube', [cx2, y + 0.45, z + d - 1.0], [w * 0.5, 0.9, 0.8], 0xc9ced4, f))
        break
      case 'laundry':
        for (let i = 0; i < 3; i++)
          out.push(ent(null, 'cube', [x + 1 + i * 1.2, y + 0.45, z + 0.8], [0.9, 0.9, 0.8], 0xeef2f5, f))
        break
      case 'robot_bay': case 'robot_nook': {
        const n = a.kind === 'robot_bay' ? 3 : 1
        for (let i = 0; i < n; i++)
          out.push(ent(null, 'cube', [x + 0.9 + i * 1.4, y + 0.03, z + d - 0.9], [1.0, 0.06, 1.0], 0x39d98a, f))
        break
      }
      case 'gym':
        for (let i = 0; i < 3; i++)
          out.push(ent(null, 'cube', [x + 1.2 + i * 1.8, y + 0.3, cz2], [1.2, 0.6, 0.6], 0x4a5560, f))
        break
      case 'spa':
        out.push(ent(null, 'cylinder', [cx2, y + 0.25, cz2], [1, 1, 1],
          0xcbb8d8, { ...f, volume: { props: [1.4, 1.4, 0.5, 20, 1] } }))
        break
      case 'stairs': {
        const steps = 5
        for (let i = 0; i < steps; i++)
          out.push(ent(null, 'cube', [cx2, y + 0.2 + i * 0.45, z + 0.7 + i * (d - 1.4) / steps],
            [w * 0.7, 0.12, 0.5], 0xb2a68f, f))
        break
      }
      case 'porte_cochere': {
        out.push(ent(null, 'cube', [cx2, y + 3.0, cz2], [w, 0.25, d], theme.wall, f))
        for (const [dx, dz] of [[-w / 2 + 0.4, -d / 2 + 0.4], [w / 2 - 0.4, -d / 2 + 0.4],
                                 [-w / 2 + 0.4, d / 2 - 0.4], [w / 2 - 0.4, d / 2 - 0.4]])
          out.push(ent(null, 'cylinder', [cx2 + dx, y + 1.5, cz2 + dz], [1, 1, 1],
            0x8a8f96, { ...f, volume: { props: [0.14, 0.14, 3.0, 10, 1] } }))
        break
      }
      case 'parking': {
        out.push(ent(null, 'cube', [cx2, y - 0.02, cz2], [w, 0.08, d], 0x3c4148, f))
        for (let i = 0; i < 2; i++)
          out.push(ent(null, 'cube', [x + 2.5 + i * 5, y + 0.5, cz2], [2.0, 0.9, 4.2],
            [0xc0392b, 0x2a6f97][i], f))
        break
      }
    }
  }

  // ---- invisible shadow roofs -----------------------------------------------
  // One per floor: a colorWrite:false slab that casts shadow but draws
  // nothing, so interiors read as *inside* (no dramatic sun shadows from
  // hallway walls and furniture) while the building still throws its
  // massing shadow on the ground. The floor picker disables the roofs of
  // ghosted floors so the picked floor doesn't sit in their darkness.
  for (let f = 0; f < layout.floors; f++) {
    const floorAreas = layout.areas.filter(a => a.floor === f && !OUTDOORISH.has(a.kind))
    if (!floorAreas.length) continue
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (const a of floorAreas) {
      x0 = Math.min(x0, a.rect[0]); z0 = Math.min(z0, a.rect[1])
      x1 = Math.max(x1, a.rect[0] + a.rect[2]); z1 = Math.max(z1, a.rect[1] + a.rect[3])
    }
    out.push({
      uuid: `shadow-roof-${f}`,
      lita: { geom: true, floor: f, shadowRoof: true },
      volume: {
        geometry: 'cube', static: true,
        material: { colorWrite: false, depthWrite: false },
        pose: {
          position: { x: (x0 + x1) / 2, y: yOf(f) + WALL_H + 0.06, z: (z0 + z1) / 2 },
          scale: { x: x1 - x0, y: 0.08, z: z1 - z0 },
        },
      },
    })
  }

  // ---- elevator / dumbwaiter shaft markers ---------------------------------
  for (const v of layout.verticals) {
    if (v.kind === 'stairs') continue
    const h = layout.floors * FLOOR_HEIGHT
    out.push(ent(`shaft-${v.id}`, 'cube', [v.at[0], h / 2 - FLOOR_HEIGHT / 2 + WALL_H / 2, v.at[1]],
      [0.1, 0.1, 0.1], 0x000000, { floor: 0, volume: { visible: false } }))
  }

  // ---- theme dressing --------------------------------------------------------
  const rng = mulberry(layout.seed)
  const scatter = (n, fn) => { for (let i = 0; i < n; i++) fn(scatterPoint(rng, W, D)) }
  switch (theme.props) {
    case 'palms': case 'trees':
      scatter(14, ([px, pz]) => {
        const h = 2.5 + rng() * 3
        out.push(ent(null, 'cylinder', [px, h / 2, pz], [1, 1, 1],
          0x8a6642, { floor: 0, volume: { props: [0.12, 0.18, h, 8, 1] } }))
        out.push(ent(null, 'sphere', [px, h + 0.4, pz],
          theme.props === 'palms' ? [1.6, 0.5, 1.6] : [1.3, 1.3, 1.3],
          theme.props === 'palms' ? 0x2f9e44 : 0x3f7d2d, { floor: 0 }))
      })
      break
    case 'city':
      scatter(10, ([px, pz]) => {
        const h = 8 + rng() * 18
        out.push(ent(null, 'cube', [px, h / 2, pz], [6 + rng() * 6, h, 6 + rng() * 6],
          [0x4a4038, 0x5a5048, 0x3a3630][Math.floor(rng() * 3)], { floor: 0 }))
      })
      break
    case 'ice':
      scatter(12, ([px, pz]) => {
        out.push(ent(null, 'cube', [px, 0.4 + rng() * 0.4, pz], [1 + rng() * 2, 1 + rng(), 1 + rng() * 2],
          0xd9ecf5, { floor: 0 }, { opacity: 0.9, transparent: true }))
      })
      break
    case 'reef':
      scatter(16, ([px, pz]) => {
        out.push(ent(null, 'sphere', [px, 0.4, pz], [0.6 + rng(), 0.5 + rng() * 0.8, 0.6 + rng()],
          [0xff6b6b, 0xffa94d, 0x9ff0e8, 0xc77dff][Math.floor(rng() * 4)], { floor: 0 }))
      })
      break
  }

  return out
}

function scatterPoint(rng, W, D) {
  // ring around the building, outside the footprint
  for (let tries = 0; tries < 20; tries++) {
    const px = -14 + rng() * (W + 28)
    const pz = -14 + rng() * (D + 28)
    if (px < -2 || px > W + 2 || pz < -8 || pz > D + 2) return [px, pz]
  }
  return [-10, -10]
}

function mulberry(seed) {
  let a = seed >>> 0 || 1
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0
    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}
