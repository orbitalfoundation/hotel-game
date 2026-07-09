//
// The manager — the player. Two implementations of one contract:
//
//   snapshot(world)  -> compact structured view of the whole hotel
//   { directive: { actor, task | goto | charge | recall | reboot } }
//       published on the bus; the staff/robots listeners execute them
//
// makeHeuristicManager is a greedy dispatcher: always available, no API
// key, and the baseline any LLM manager has to beat.
//
// makeLLMManager (browser) POSTs the snapshot to /api/manager on a slow
// cadence and applies the directives Claude returns. Its one-line
// "thought" is surfaced in the HUD so you can watch it reason.
//

import { hhmm } from './util.js'

export function snapshot(world) {
  const clip = (s, n = 70) => (s && s.length > n ? s.slice(0, n) + '…' : s)
  const guests = []
  for (const p of world.guests.parties.values()) {
    if (p.state === 'gone') continue
    guests.push({
      id: p.id, who: clip(p.label, 40), state: p.state, area: p.area,
      happy: Math.round(p.happiness),
      ...(p.waitingOn ? { waitingOn: p.waitingOn } : {}),
    })
  }
  const staff = []
  for (const s of world.staff.staff.values())
    staff.push({
      id: s.id, role: s.role, area: s.area, state: s.state,
      ...(s.task ? { task: s.task.id } : {}),
      ...(s.fatigue > 85 ? { tired: true } : {}),
    })
  const robots = []
  for (const r of world.robots.robots.values())
    robots.push({
      id: r.id, kind: r.kind, area: r.area, state: r.state,
      battery: Math.round(r.battery),
      ...(r.task ? { task: r.task.id } : {}),
    })
  const tasks = world.tasks.open().map(t => ({
    id: t.id, what: clip(t.label), area: t.area, needs: t.requires,
    ageS: Math.round(t.age), patienceS: Math.round(t.patience),
    ...(t.assignee ? { assignee: t.assignee } : {}),
  }))
  const rooms = { clean: 0, occupied: 0, dirty: 0 }
  for (const r of world.guests.rooms.values()) rooms[r.status] = (rooms[r.status] || 0) + 1
  const systems = []
  for (const cab of world.systems.cabs.values())
    systems.push({
      id: cab.id, floor: cab.floor, failed: cab.failed,
      riders: cab.riders.size, waiting: cab.tickets.size - cab.riders.size,
    })
  return {
    time: hhmm(world.clock.t),
    score: world.score.summary(),
    checkinQueue: world.guests.checkinQueue.length,
    rooms, tasks, staff, robots, systems, guests,
    log: world.events.slice(-8).map(e => `${hhmm(e.t)} ${e.msg}`),
  }
}

// ---------------------------------------------------------------------------

export function makeHeuristicManager(world) {
  let cool = 0

  function isFree(actor, isRobot) {
    if (actor.task) return false
    if (isRobot) return actor.state === 'idle' || (actor.state === 'charging' && actor.battery > 60)
    return actor.state === 'idle'
  }

  function dispatch() {
    const open = world.tasks.open().filter(t => !t.assignee)
      .sort((a, b) => (b.age / b.patience) - (a.age / a.patience))
    for (const t of open) {
      const candidates = []
      for (const s of world.staff.staff.values())
        if (s.caps.includes(t.requires) && isFree(s, false)) {
          // keep the desk covered during busy hours
          if (s.caps.includes('front_desk') && world.guests.checkinQueue.length > 0 &&
              !world.staff.staffAtDesk()) continue
          candidates.push({ actor: s, robot: false })
        }
      for (const r of world.robots.robots.values())
        if (r.caps.includes(t.requires) && isFree(r, true) && r.battery > 30)
          candidates.push({ actor: r, robot: true })
      if (!candidates.length) continue
      // nearest first, robots get a small preference for grunt work
      candidates.sort((a, b) => cost(a, t) - cost(b, t))
      const chosen = candidates[0].actor
      world.bus.resolve({ directive: { actor: chosen.id, task: t.id } })
    }
    // housekeeping robots top up when the board is quiet
    for (const r of world.robots.robots.values()) {
      if (r.state === 'idle' && r.battery < 35 && !r.task)
        world.bus.resolve({ directive: { actor: r.id, charge: true } })
      if (r.state === 'stuck' && r.stuckT > 8)
        world.bus.resolve({ directive: { actor: r.id, reboot: true } })
    }
  }

  function cost({ actor, robot }, t) {
    const d = Math.hypot(actor.pos[0] - t.pos[0], actor.pos[2] - t.pos[2]) +
      Math.abs(actor.floor - t.floor) * 25
    const pref = robot && (t.requires === 'clean' || t.requires === 'deliver') ? -10 : 0
    return d + pref
  }

  const entity = {
    id: 'manager-heuristic',
    resolve(event) {
      if (!event.tick || world.paused || world.gameOver) return
      if (!world.managerMode || world.managerMode === 'heuristic') {
        cool -= event.dt
        if (cool <= 0) { cool = 2; dispatch() }
      }
    },
  }
  entity.resolve.filter = { tick: true }
  return { entity, dispatch }
}

// ---------------------------------------------------------------------------

export function makeLLMManager(world, { endpoint = '/api/manager', cadence = 9000 } = {}) {
  const state = { thoughts: [], busy: false, errors: 0, enabled: false, timer: null }

  async function think() {
    if (state.busy || world.paused || world.gameOver || !state.enabled) return
    state.busy = true
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hotel: world.brief.about.label, snapshot: snapshot(world) }),
      })
      if (!res.ok) throw new Error(`manager api ${res.status}`)
      const out = await res.json()
      if (out.thought) {
        state.thoughts.push({ t: world.clock.t, text: out.thought })
        if (state.thoughts.length > 30) state.thoughts.shift()
        world.log(`MGR ${out.thought}`)
      }
      for (const d of out.directives || []) {
        const r = await world.bus.resolve({ directive: d })
        if (!r?.ok) world.log(`MGR directive rejected: ${JSON.stringify(d)}`)
      }
      state.errors = 0
      world.managerMode = 'llm'
    } catch (err) {
      state.errors++
      // let the heuristic cover the floor until Claude answers again
      world.managerMode = 'heuristic'
      world.log(`MGR offline (${err.message}) — heuristic covers`)
      if (state.errors > 2) setMode(false)
    } finally {
      state.busy = false
    }
  }

  function setMode(on) {
    state.enabled = on
    world.managerMode = on ? 'llm' : 'heuristic'
    if (on && !state.timer) state.timer = setInterval(think, cadence)
    if (!on && state.timer) { clearInterval(state.timer); state.timer = null }
  }

  return { state, setMode, think }
}
