//
// The five seed hotels — L1 briefs.
//
// Each brief is the parametric grounding of a prose description (kept in
// `prose` so the conversational origin stays visible). Parts are drawn
// from the vocabulary in parts.js; the layout compiler supplies required
// infrastructure (halls, core, BOH) automatically.
//

export const BRIEFS = [
  {
    id: 'juniper-house',
    about: {
      label: 'Juniper House',
      description: 'a quaint boutique hotel on a back-country road',
    },
    prose: `A beautiful small boutique hotel on a back-country road with ample
      parking next door, a quaint front lobby, a guest breakfast area on the
      main floor, back of hotel operations behind, and an elevator serving
      five stories with four guest rooms per floor.`,
    theme: 'countryside',
    seed: 11,
    floors: 5,
    roomsPerFloor: 4,
    parts: ['parking', 'porte_cochere', 'lounge', 'breakfast'],
    staffing: { housekeeper: 2, front_desk: 1, cook: 1, valet: 1 },
    robots: { cleaning: 1, delivery: 1 },
  },
  {
    id: 'palm-lagoon',
    about: {
      label: 'Palm Lagoon Resort',
      description: 'a breezy tropical resort with pool, hot tub and spa',
    },
    prose: `A tropical resort: wide lobby open to the trade winds, a big pool
      with a hot tub beside it, a spa, a bar and restaurant, three lazy
      stories of rooms, sand and palms all around.`,
    theme: 'tropical',
    seed: 22,
    floors: 3,
    roomsPerFloor: 10,
    parts: ['parking', 'porte_cochere', 'lounge', 'restaurant', 'bar', 'pool', 'hot_tub', 'spa'],
    staffing: { housekeeper: 3, front_desk: 2, cook: 2, valet: 1, security: 1 },
    robots: { cleaning: 2, delivery: 2, security: 1 },
  },
  {
    id: 'hoyt-street',
    about: {
      label: 'The Hoyt Street',
      description: 'a tall skinny hotel in downtown Brooklyn',
    },
    prose: `Downtown Brooklyn: a narrow eight-story hotel squeezed between
      brownstones, tiny sharp lobby, espresso bar, a basement gym, six rooms
      a floor, no parking to speak of — everyone arrives by cab.`,
    theme: 'brooklyn',
    seed: 33,
    floors: 8,
    roomsPerFloor: 6,
    parts: ['lounge', 'bar', 'breakfast', 'gym'],
    staffing: { housekeeper: 3, front_desk: 2, cook: 1, security: 1 },
    robots: { cleaning: 2, delivery: 2 },
  },
  {
    id: 'aurora-station',
    about: {
      label: 'Aurora Station',
      description: 'an arctic research-lodge hotel under the northern lights',
    },
    prose: `An arctic lodge: a warm low building against the snow, a great
      hearth lounge, a sauna-spa, hearty restaurant, four stories, triple
      glazing, snowcats parked outside, aurora overhead.`,
    theme: 'arctic',
    seed: 44,
    floors: 4,
    roomsPerFloor: 6,
    parts: ['parking', 'porte_cochere', 'lounge', 'restaurant', 'spa', 'gym'],
    staffing: { housekeeper: 2, front_desk: 1, cook: 2, valet: 1 },
    robots: { cleaning: 2, delivery: 1, security: 1 },
  },
  {
    id: 'meridian-deep',
    about: {
      label: 'Meridian Deep',
      description: 'an underwater hotel beneath a tropical sea',
    },
    prose: `An underwater hotel: a pressurized hull on the seabed, portholes
      full of fish, a glowing lobby, restaurant and bar with a view into the
      blue, a small spa, three decks of rooms, guests arrive by submarine
      airlock.`,
    theme: 'underwater',
    seed: 55,
    floors: 3,
    roomsPerFloor: 8,
    parts: ['lounge', 'restaurant', 'bar', 'spa'],
    staffing: { housekeeper: 2, front_desk: 1, cook: 2, security: 1 },
    robots: { cleaning: 2, delivery: 2, security: 1 },
  },
]

export function briefById(id) {
  return BRIEFS.find(b => b.id === id)
}
