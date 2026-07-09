//
// Shared sim utilities: seeded rng, name decks, small helpers.
//

export function mulberry(seed) {
  let a = seed >>> 0 || 1
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0
    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)]
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

const FIRST = ['Mabel', 'Otto', 'Priya', 'Jun', 'Sofia', 'Dmitri', 'Amara', 'Lars',
  'Rosa', 'Felix', 'Nadia', 'Hugo', 'Wren', 'Kofi', 'Ines', 'Marco', 'Yuki',
  'Beatrix', 'Omar', 'Tallulah', 'Gus', 'Perla', 'Ansel', 'Vera', 'Bo', 'Zadie']
const LAST = ['Fernsby', 'Okafor', 'Lindqvist', 'Marchetti', 'Delacroix', 'Huang',
  'Abernathy', 'Vasquez', 'Petrov', 'Nakamura', 'Ferreira', 'Osei', 'Bellweather',
  'Katz', 'Moreau', 'Sandoval', 'Iversen', 'Choudhury', 'Pemberton', 'Wolfe']
const PARTY_FLAVORS = [
  { kind: 'single', members: 1, label: n => `${n}, traveling alone` },
  { kind: 'couple', members: 2, label: n => `the ${n}s, date night` },
  { kind: 'couple', members: 2, label: n => `the ${n}s, anniversary trip` },
  { kind: 'family', members: 3, label: n => `the ${n} family` },
  { kind: 'family', members: 4, label: n => `the ${n} family, kids in tow` },
  { kind: 'single', members: 1, label: n => `${n}, here on business` },
  { kind: 'couple', members: 2, label: n => `the ${n}s, with a small dog`, dog: true },
]

export function makeParty(rng, id) {
  const flavor = pick(rng, PARTY_FLAVORS)
  const first = pick(rng, FIRST), last = pick(rng, LAST)
  const name = flavor.kind === 'single' ? `${first} ${last}` : last
  return {
    id, kind: flavor.kind, members: flavor.members, dog: !!flavor.dog,
    name: flavor.kind === 'single' ? name : `the ${last}s`,
    label: flavor.label(flavor.kind === 'single' ? `${first} ${last}` : last),
  }
}

export const STAFF_NAMES = ['Marisol', 'Tobias', 'Grace', 'Dev', 'Halima', 'Piotr',
  'Cleo', 'Ray', 'Suki', 'Ernesto', 'Birgit', 'Sam', 'Adaeze', 'Loic', 'Tam']

// hh:mm from seconds-of-day
export const hhmm = t => {
  const h = Math.floor(t / 3600) % 24, m = Math.floor(t / 60) % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export const dist2d = (a, b) => Math.hypot(b[0] - a[0], b[2] - a[2])

// Create the render pair (body + head) for a person, or a box for a robot.
// Returns the entities; caller publishes them and later mutates poses.
let vid = 0
export function personEntities(id, color, pos, scale = 1) {
  const body = {
    uuid: `${id}-body`, lita: { actor: id },
    volume: {
      geometry: 'cylinder', props: [0.22 * scale, 0.26 * scale, 1.15 * scale, 10, 1],
      material: { color },
      pose: { position: { x: pos[0], y: pos[1] + 0.62 * scale, z: pos[2] } },
    },
  }
  const head = {
    uuid: `${id}-head`, lita: { actor: id },
    volume: {
      geometry: 'sphere', material: { color: 0xe8c39e },
      pose: { position: { x: pos[0], y: pos[1] + 1.42 * scale, z: pos[2] },
              scale: { x: 0.19 * scale, y: 0.21 * scale, z: 0.19 * scale } },
    },
  }
  return [body, head]
}

// Robots must never read as people: each kind gets a machine silhouette.
// cleaning = low roomba disk + sensor dome, delivery = cart + parcel,
// security = tall dark column + red eye. Each part carries its own y
// offset (lita.dy) so syncRobot stays generic.
export function robotEntities(id, kind, color, pos) {
  const parts = []
  const add = (geometry, dy, color2, { scale, props } = {}) => parts.push({
    uuid: `${id}-p${parts.length}`, lita: { actor: id, dy },
    volume: {
      geometry, ...(props ? { props } : {}),
      material: { color: color2 },
      pose: {
        position: { x: pos[0], y: pos[1] + dy, z: pos[2] },
        ...(scale ? { scale: { x: scale[0], y: scale[1], z: scale[2] } } : {}),
      },
    },
  })
  if (kind === 'cleaning') {
    add('cylinder', 0.13, color, { props: [0.44, 0.48, 0.24, 18, 1] })
    add('sphere', 0.3, 0x9ff0e8, { scale: [0.15, 0.09, 0.15] })
  } else if (kind === 'security') {
    add('cylinder', 0.62, color, { props: [0.15, 0.3, 1.24, 12, 1] })
    add('sphere', 1.28, 0xff5555, { scale: [0.1, 0.1, 0.1] })
  } else { // delivery
    add('cube', 0.34, color, { scale: [0.5, 0.68, 0.72] })
    add('cube', 0.79, 0xd9c9a8, { scale: [0.34, 0.22, 0.42] })
  }
  return parts
}

// Mutate a (possibly live-bound three.js) pose position.
export function setPos(p, x, y, z) {
  if (!p) return
  if (typeof p.set === 'function') p.set(x, y, z)
  else { p.x = x; p.y = y; p.z = z }
}

// Move a person's render pair to a sim position (with floor explode offset).
export function syncPerson(entities, pos, yExtra = 0, scale = 1) {
  if (!entities) return
  const [body, head] = entities
  setPos(body?.volume.pose.position, pos[0], pos[1] + yExtra + 0.62 * scale, pos[2])
  if (head) setPos(head.volume.pose.position, pos[0], pos[1] + yExtra + 1.42 * scale, pos[2])
}
export function syncRobot(entities, pos, yExtra = 0) {
  for (const e of entities || [])
    setPos(e.volume.pose.position, pos[0], pos[1] + yExtra + (e.lita?.dy ?? 0), pos[2])
}
