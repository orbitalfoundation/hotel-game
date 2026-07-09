//
// In-world overlay: DOM labels projected through the three.js camera.
// This is what turns the 3D view into a HUD — persistent task callouts
// ("spill here!" with an urgency ring), transient event toasts ("the Hoyts
// checking in!"), and a hover card for any person or robot.
//
// Everything renders into one pointer-events-none layer; positions update
// on the render tick via camera projection, so labels ride the explode
// slider and the orbit camera for free.
//

import { Vector3 } from 'three'

const TOAST_TTL = 4.5

export function mountOverlay(world, bus) {
  const layer = document.createElement('div')
  layer.id = 'overlay'
  document.body.appendChild(layer)

  const v = new Vector3()
  const els = new Map()   // key -> DOM element
  let mouse = null
  document.addEventListener('mousemove', e => { mouse = [e.clientX, e.clientY] })
  document.addEventListener('mouseleave', () => { mouse = null })

  const surface = () => bus.volume?._surfaces?.volume001

  const floorShown = f =>
    world.view.floorMode === 'all' || Math.round(f) <= world.view.floorMode

  // world position -> screen, or null if behind the camera / hidden floor
  function project(pos, floor) {
    const s = surface()
    if (!s?.camera || !floorShown(floor)) return null
    const e = world.view.explode
    v.set(pos[0], pos[1] + floor * e, pos[2]).project(s.camera)
    if (v.z > 1) return null
    return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]
  }

  function el(key, cls) {
    let d = els.get(key)
    if (!d) {
      d = document.createElement('div')
      d.className = `tag ${cls}`
      layer.appendChild(d)
      els.set(key, d)
    }
    d.dataset.live = '1'
    return d
  }

  function place(d, xy, text) {
    d.style.transform = `translate(${Math.round(xy[0])}px, ${Math.round(xy[1])}px)`
    if (text !== undefined && d.dataset.text !== text) { d.textContent = text; d.dataset.text = text }
    d.style.display = ''
  }

  // hoverable actors: everyone with a position and a story
  function* actors() {
    for (const p of world.guests.parties.values())
      if (p.state !== 'gone') yield {
        pos: p.pos, floor: p.floorContinuous ?? p.floor,
        text: `${p.label} — ${p.state}${p.waitingOn ? ', waiting: ' + p.waitingOn : ''} · ${Math.round(p.happiness)}♥`,
      }
    for (const s of world.staff.staff.values()) yield {
      pos: s.pos, floor: s.floorContinuous ?? s.floor,
      text: `${s.name} (${s.role}) — ${s.state}${s.task ? ': ' + s.task.label : ''}`,
    }
    for (const r of world.robots.robots.values()) yield {
      pos: r.pos, floor: r.floorContinuous ?? r.floor,
      text: `${r.name} — ${r.state}${r.task ? ': ' + r.task.label : ''} · ${Math.round(r.battery)}%`,
    }
    for (const b of world.incidents.badActors.values()) yield {
      pos: b.pos, floor: b.floorContinuous ?? b.floor, text: '??? — looks suspicious',
    }
  }

  let lastT = performance.now() / 1000
  const listener = {
    id: 'overlay',
    resolve(event) {
      if (!event.tick) return
      const now = performance.now() / 1000
      const dt = Math.min(0.25, now - lastT)
      lastT = now
      for (const d of els.values()) { d.dataset.live = ''; d.style.display = 'none' }

      // ---- task callouts ----------------------------------------------------
      for (const t of world.tasks.open()) {
        const xy = project(t.pos, t.floor)
        if (!xy) continue
        const urgency = t.age / t.patience
        const d = el(`task-${t.id}`, 'task')
        d.classList.toggle('urgent', urgency > 0.6)
        d.classList.toggle('assigned', !!t.assignee)
        place(d, xy, `${t.kind === 'clean' ? '🧹' : t.kind === 'fix' ? '🔧' : t.kind === 'security' ? '🕵️' : '🛎'} ${short(t.label)}`)
      }

      // ---- toasts -----------------------------------------------------------
      for (let i = world.toasts.length - 1; i >= 0; i--) {
        const t = world.toasts[i]
        t.age += dt
        if (t.age > TOAST_TTL) { world.toasts.splice(i, 1); continue }
        const xy = project(t.pos, t.floor)
        if (!xy) continue
        const d = el(`toast-${t.msg}-${t.pos[0].toFixed(1)}`, `toast ${t.kind}`)
        d.style.opacity = t.age < 0.3 ? t.age / 0.3 : t.age > TOAST_TTL - 1 ? (TOAST_TTL - t.age) : 1
        place(d, [xy[0], xy[1] - 26 - t.age * 6], t.msg)
      }

      // ---- hover card ---------------------------------------------------------
      if (mouse) {
        let best = null, bestD = 26 * 26
        for (const a of actors()) {
          const xy = project(a.pos, a.floor)
          if (!xy) continue
          const dx = xy[0] - mouse[0], dy = xy[1] - mouse[1] + 18
          const d2 = dx * dx + dy * dy
          if (d2 < bestD) { best = { ...a, xy }; bestD = d2 }
        }
        if (best) place(el('tooltip', 'tooltip'), [best.xy[0], best.xy[1] - 34], best.text)
      }

      // drop dead elements
      for (const [k, d] of els) if (!d.dataset.live) { d.remove(); els.delete(k) }
    },
  }
  listener.resolve.filter = { tick: true }
  bus.register(listener)
}

const short = (s, n = 34) => (s.length > n ? s.slice(0, n) + '…' : s)
