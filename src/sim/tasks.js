//
// The task board. Every guest need and incident becomes a task with a
// location, a required capability, and a patience window. The manager
// (LLM or heuristic) assigns tasks to staff and robots; unresolved tasks
// expire and cost points and guest happiness.
//

export function makeTasks(world) {
  const tasks = new Map()
  let seq = 0

  function create(spec) {
    const t = {
      id: `task-${++seq}`,
      kind: spec.kind,                 // 'clean' | 'deliver' | 'room_service' | 'fix' | 'security' | ...
      label: spec.label,
      area: spec.area, floor: spec.floor ?? 0,
      pos: spec.pos,
      requires: spec.requires,         // capability string
      via: spec.via || null,           // optional pickup area (e.g. kitchen, housekeeping)
      patience: spec.patience ?? 120,  // real seconds until it expires
      age: 0,
      state: 'open',                   // open | assigned | done | expired
      assignee: null,
      guest: spec.guest || null,       // party id whose happiness rides on this
      work: spec.work ?? 10,           // seconds of on-site work
      onDone: spec.onDone || null,
      marker: null,
    }
    tasks.set(t.id, t)
    world.log(`NEW ${t.id} ${t.label}`)
    if (world.render) {
      t.marker = {
        uuid: `marker-${t.id}`, lita: { marker: t.id, floor: t.floor },
        volume: {
          geometry: 'sphere', material: { color: 0xff4d4d },
          pose: { position: { x: t.pos[0], y: t.pos[1] + 2.3, z: t.pos[2] },
                  scale: { x: 0.16, y: 0.16, z: 0.16 } },
        },
      }
      world.bus.resolve(t.marker)
    }
    return t
  }

  function assign(taskId, actorId) {
    const t = tasks.get(taskId)
    if (!t || t.state === 'done' || t.state === 'expired') return false
    t.assignee = actorId
    t.state = 'assigned'
    return true
  }

  function release(taskId) {
    const t = tasks.get(taskId)
    if (t && t.state === 'assigned') { t.state = 'open'; t.assignee = null }
  }

  function close(t, outcome) {
    t.state = outcome
    if (t.marker) { t.marker.obliterate = true; world.bus.resolve(t.marker); t.marker = null }
    if (outcome === 'done') t.onDone?.()
    for (const hook of world.onTaskClosed || []) hook(t, outcome)
  }

  function complete(taskId) {
    const t = tasks.get(taskId)
    if (!t || t.state === 'done' || t.state === 'expired') return
    close(t, 'done')
    world.score.taskResolved(t)
    world.log(`DONE ${t.id} ${t.label}`)
  }

  const open = () => [...tasks.values()].filter(t => t.state === 'open' || t.state === 'assigned')
  const byId = id => tasks.get(id)

  const entity = {
    id: 'tasks',
    resolve(event) {
      if (!event.tick) return
      const dt = (world.paused || world.gameOver) ? 0 : event.dt
      for (const t of tasks.values()) {
        if (t.state === 'done' || t.state === 'expired') continue
        t.age += dt
        if (t.age > t.patience) {
          close(t, 'expired')
          world.score.taskExpired(t)
          world.log(`EXPIRED ${t.id} ${t.label}`)
        }
      }
    },
  }
  entity.resolve.filter = { tick: true }

  return { entity, create, assign, release, complete, open, byId, all: tasks }
}
