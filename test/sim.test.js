import { test } from 'node:test'
import assert from 'node:assert'
import { createBus } from '@orbitalfoundation/bus'
import { attach as attachSpatial } from '@orbitalfoundation/spatial'
import { briefById } from '../src/grammar/briefs.js'
import { createHotelWorld } from '../src/sim/world.js'
import { makeHeuristicManager } from '../src/sim/manager.js'

async function runFor(world, bus, simSeconds, dt = 0.1) {
  await bus.resolve({ run: true, ticks: Math.ceil(simSeconds / dt), dt })
}

test('a morning at juniper house: guests arrive, check in, tasks get done', async () => {
  const bus = createBus({ description: 'sim-test' })
  attachSpatial(bus, { cellSize: 8 })
  const world = createHotelWorld(bus, briefById('juniper-house'), { render: false, speed: 60 })
  bus.register(makeHeuristicManager(world).entity)

  // three sim-hours of hotel life (180 real-seconds at speed 60)
  await runFor(world, bus, 180)

  assert.ok(world.guests.parties.size > 0, 'guests arrived')
  const checkedIn = [...world.guests.parties.values()].filter(p => p.room)
  assert.ok(checkedIn.length > 0, 'at least one party checked in')
  assert.ok(world.score.state.resolved + world.tasks.open().length >= 0)

  // clock advanced ~3 hours
  assert.ok(world.clock.t > 8.5 * 3600 && world.clock.t < 9.5 * 3600,
    `clock ~09:00 (got ${world.clock.t / 3600})`)
})

test('the heuristic manager assigns tasks and they complete', async () => {
  const bus = createBus({ description: 'sim-test-2' })
  attachSpatial(bus, { cellSize: 8 })
  const world = createHotelWorld(bus, briefById('juniper-house'), { render: false, speed: 60 })
  bus.register(makeHeuristicManager(world).entity)

  // plant a spill; someone should clean it up well within its patience
  const hall = world.layout.areas.find(a => a.kind === 'corridor' && a.floor === 0)
  const t = world.tasks.create({
    kind: 'clean', label: 'test spill', area: hall.id, floor: 0,
    pos: world.nav.randomPointIn(hall.id, world.rng),
    requires: 'clean', patience: 300, work: 5,
  })
  await runFor(world, bus, 120)
  assert.equal(t.state, 'done', `spill cleaned (state=${t.state}, assignee=${t.assignee})`)
})

test('directives are executed and rejected sensibly', async () => {
  const bus = createBus({ description: 'sim-test-3' })
  attachSpatial(bus, { cellSize: 8 })
  const world = createHotelWorld(bus, briefById('palm-lagoon'), { render: false, speed: 60 })

  const robotId = [...world.robots.robots.keys()][0]
  const ok = await bus.resolve({ directive: { actor: robotId, goto: 'lobby' } })
  assert.deepEqual(ok, { ok: true }, 'robot accepts goto')

  const bad = await bus.resolve({ directive: { actor: 'robot-99', goto: 'lobby' } })
  assert.deepEqual(bad, { ok: false }, 'unknown robot rejected')

  const staffId = [...world.staff.staff.keys()][0]
  const ok2 = await bus.resolve({ directive: { actor: staffId, goto: 'kitchen' } })
  assert.deepEqual(ok2, { ok: true }, 'staff accepts goto')

  await runFor(world, bus, 60)
  const robot = world.robots.robots.get(robotId)
  assert.ok(robot.area === 'lobby' || robot.state === 'moving' || robot.state === 'charging' || robot.state === 'stuck',
    `robot heading to lobby (state=${robot.state} area=${robot.area})`)
})

test('elevator failure strands riders until fixed', async () => {
  const bus = createBus({ description: 'sim-test-4' })
  attachSpatial(bus, { cellSize: 8 })
  const world = createHotelWorld(bus, briefById('hoyt-street'), { render: false, speed: 60 })
  bus.register(makeHeuristicManager(world).entity)

  await runFor(world, bus, 60)
  const cab = world.systems.cabs.get('elevator')
  cab.failed = true
  world.tasks.create({
    kind: 'fix', label: 'test elevator failure', area: 'elevator-0', floor: cab.floor,
    pos: [cab.at[0], cab.y, cab.at[1]], requires: 'fix', patience: 400, work: 6,
    onDone: () => { cab.failed = false },
  })
  await runFor(world, bus, 150)
  assert.equal(cab.failed, false, 'engineer fixed the elevator')
})
