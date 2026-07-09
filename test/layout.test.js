import { test } from 'node:test'
import assert from 'node:assert'
import { BRIEFS } from '../src/grammar/briefs.js'
import { compileLayout } from '../src/compile/layout.js'
import { makeNavGraph } from '../src/compile/navgraph.js'

const overlap = (a, b) => {
  const [ax, az, aw, ad] = a.rect, [bx, bz, bw, bd] = b.rect
  const e = 0.01
  return ax + e < bx + bw && bx + e < ax + aw && az + e < bz + bd && bz + e < az + ad
}

for (const brief of BRIEFS) {
  test(`layout: ${brief.id} compiles sanely`, () => {
    const layout = compileLayout(brief)
    assert.ok(layout.areas.length > 10)
    const rooms = layout.areas.filter(a => a.kind === 'guest_room')
    assert.equal(rooms.length, brief.roomsPerFloor * (brief.floors - 1),
      'expected room count')

    // no two indoor areas on the same floor overlap
    const indoor = layout.areas.filter(a => !['outdoor', 'parking', 'porte_cochere'].includes(a.kind))
    for (let i = 0; i < indoor.length; i++)
      for (let j = i + 1; j < indoor.length; j++) {
        const a = indoor[i], b = indoor[j]
        if (a.floor !== b.floor) continue
        assert.ok(!overlap(a, b), `${a.id} overlaps ${b.id}`)
      }

    // every portal references real areas
    const ids = new Set(layout.areas.map(a => a.id))
    for (const p of layout.portals) {
      assert.ok(ids.has(p.a), `portal ${p.id} side a '${p.a}' exists`)
      assert.ok(ids.has(p.b), `portal ${p.id} side b '${p.b}' exists`)
    }
  })

  test(`nav: ${brief.id} guests, staff and robots can get around`, () => {
    const layout = compileLayout(brief)
    const nav = makeNavGraph(layout)
    const rooms = layout.areas.filter(a => a.kind === 'guest_room')
    const topRoom = rooms[rooms.length - 1]

    // guest: outdoors -> lobby -> top-floor room
    const outdoorPos = [layout.bounds[0] / 2, 0, -8]
    const toLobby = nav.find(outdoorPos, 0, 'lobby', 'guest')
    assert.ok(toLobby, 'guest reaches lobby')
    const lobbyPos = nav.randomPointIn('lobby', () => 0.5)
    const toRoom = nav.find(lobbyPos, 0, topRoom.id, 'guest')
    assert.ok(toRoom, `guest reaches ${topRoom.id}`)
    // guests never pass through service space
    for (const wp of toRoom)
      assert.ok(wp.kind !== 'service_corridor' && wp.kind !== 'kitchen',
        `guest path avoids BOH (${wp.kind})`)

    // staff: kitchen -> top room (room service)
    if (layout.areas.some(a => a.kind === 'kitchen')) {
      const kPos = nav.randomPointIn('kitchen', () => 0.5)
      assert.ok(nav.find(kPos, 0, topRoom.id, 'staff'), 'staff route kitchen->room')
    }

    // robot: bay -> top room, and it must ride the dumbwaiter, never stairs
    const bayPos = nav.randomPointIn('robot_bay', () => 0.5)
    const botPath = nav.find(bayPos, 0, topRoom.id, 'robot')
    assert.ok(botPath, 'robot route bay->room')
    if (topRoom.floor > 0)
      assert.ok(botPath.some(wp => wp.via === 'dumbwaiter'), 'robot uses dumbwaiter')
    assert.ok(!botPath.some(wp => wp.via === 'stairs' || wp.via === 'elevator'),
      'robot avoids stairs and elevator')

    // guest room -> pool/breakfast amenity if present
    const amenity = layout.areas.find(a => ['pool', 'breakfast', 'restaurant', 'gym', 'spa', 'bar'].includes(a.kind))
    if (amenity) {
      const rPos = nav.randomPointIn(topRoom.id, () => 0.5)
      assert.ok(nav.find(rPos, topRoom.floor, amenity.id, 'guest'),
        `guest route ${topRoom.id} -> ${amenity.id}`)
    }
  })
}
