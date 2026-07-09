//
// The hotel part vocabulary — the lego bricks.
//
// A hotel brief (L1) names parts from this closed set. Each kind carries
// defaults so briefs stay terse: a footprint in meters, which circulation
// world it belongs to (guest / service / both), how many occupants fit,
// and hints the layout compiler uses (which band of the ground floor it
// wants, canonical adjacencies).
//
// Sizes are [width, depth] in meters and are defaults, not laws — a brief
// may override any of them.
//

export const FLOOR_HEIGHT = 3.2 // meters, slab to slab

export const PARTS = {

  // ---- front of house -------------------------------------------------
  entrance:        { size: [6, 4],   world: 'guest',   band: 'front',   capacity: 8,  about: 'main entrance and doors' },
  porte_cochere:   { size: [10, 6],  world: 'guest',   band: 'front',   capacity: 10, outdoor: true, about: 'covered arrival area' },
  lobby:           { size: [14, 10], world: 'guest',   band: 'front',   capacity: 30, about: 'the lobby' },
  front_desk:      { size: [6, 4],   world: 'both',    band: 'front',   capacity: 6,  adjacent: ['lobby'], sees: ['entrance'], about: 'reception desk' },
  lounge:          { size: [8, 8],   world: 'guest',   band: 'front',   capacity: 16, adjacent: ['lobby'], about: 'guest lounge' },
  breakfast:       { size: [10, 8],  world: 'guest',   band: 'amenity', capacity: 24, adjacent: ['kitchen'], about: 'breakfast area' },
  restaurant:      { size: [12, 10], world: 'guest',   band: 'amenity', capacity: 40, adjacent: ['kitchen'], about: 'restaurant' },
  bar:             { size: [8, 6],   world: 'guest',   band: 'amenity', capacity: 16, about: 'bar' },
  pool:            { size: [14, 10], world: 'guest',   band: 'amenity', capacity: 20, wet: true, about: 'swimming pool' },
  hot_tub:         { size: [5, 5],   world: 'guest',   band: 'amenity', capacity: 6,  wet: true, adjacent: ['pool'], about: 'hot tub' },
  gym:             { size: [8, 8],   world: 'guest',   band: 'amenity', capacity: 12, about: 'fitness center' },
  spa:             { size: [8, 8],   world: 'guest',   band: 'amenity', capacity: 8,  about: 'spa' },
  guest_room:      { size: [5, 8],   world: 'guest',   floors: 'upper', capacity: 4,  about: 'guest room' },
  suite:           { size: [8, 8],   world: 'guest',   floors: 'upper', capacity: 6,  about: 'suite' },

  // ---- back of house ---------------------------------------------------
  kitchen:         { size: [8, 8],   world: 'service', band: 'back', capacity: 8, about: 'kitchen' },
  laundry:         { size: [6, 6],   world: 'service', band: 'back', capacity: 4, adjacent: ['service_elevator'], about: 'laundry' },
  housekeeping:    { size: [6, 5],   world: 'service', band: 'back', capacity: 6, adjacent: ['laundry'], about: 'housekeeping base' },
  storage:         { size: [5, 5],   world: 'service', band: 'back', capacity: 3, about: 'storage' },
  engineering:     { size: [6, 6],   world: 'service', band: 'back', capacity: 4, about: 'engineering and HVAC' },
  office:          { size: [5, 4],   world: 'service', band: 'back', capacity: 3, about: 'admin office' },
  security_office: { size: [4, 4],   world: 'service', band: 'back', capacity: 3, about: 'security and IT' },
  staff_room:      { size: [5, 5],   world: 'service', band: 'back', capacity: 8, about: 'staff break room' },
  loading_dock:    { size: [6, 5],   world: 'service', band: 'back', capacity: 4, outdoor: true, about: 'loading dock' },

  // ---- robot infrastructure ---------------------------------------------
  robot_bay:       { size: [6, 5],   world: 'service', band: 'back', capacity: 6, about: 'robot service bay and chargers' },
  robot_nook:      { size: [2, 2],   world: 'service', floors: 'upper', capacity: 1, about: 'robot charging nook' },

  // ---- circulation -------------------------------------------------------
  corridor:         { world: 'guest',   capacity: 6, about: 'corridor' },
  service_corridor: { world: 'service', capacity: 4, about: 'service corridor' },
  elevator:         { size: [2.5, 2.5], world: 'guest',   vertical: true, capacity: 6, about: 'guest elevator' },
  service_elevator: { size: [3, 3],     world: 'service', vertical: true, capacity: 4, about: 'service elevator' },
  dumbwaiter:       { size: [1.5, 1.5], world: 'robot',   vertical: true, capacity: 1, about: 'robot dumbwaiter' },
  stairs:           { size: [3, 5],     world: 'both',    vertical: true, capacity: 8, about: 'stairwell' },
  emergency_exit:   { size: [2, 1],     world: 'both',    capacity: 8, about: 'emergency exit' },
  parking:          { size: [20, 15],   world: 'guest',   band: 'front', capacity: 20, outdoor: true, about: 'parking' },
}

// Which worlds may traverse a part. Guests never walk through back of
// house; robots and staff may cross guest space but prefer service routes.
export function traversable(kind, world) {
  const part = PARTS[kind]
  if (!part) return false
  if (part.world === 'both') return true
  if (world === 'guest') return part.world === 'guest'
  // staff and robots may go anywhere except we keep guests-only nowhere;
  // service world covers all, robots additionally use dumbwaiters
  return true
}

export const GUEST_NEED_PARTS = ['breakfast', 'restaurant', 'bar', 'pool', 'hot_tub', 'gym', 'spa', 'lounge']
