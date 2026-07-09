//
// HUD: meters, control strip, roster tabs, and the event/manager feed.
// Pure DOM, refreshed a few times a second off its own interval — the sim
// doesn't know the HUD exists.
//

import { hhmm } from '/lita-game/src/sim/util.js'

const $ = id => document.getElementById(id)

export function mountHud(world, llm) {
  let tab = 'tasks'
  const speeds = [60, 120, 240]
  let speedIdx = 0

  // ---- controls ------------------------------------------------------------
  $('b-pause').onclick = () => {
    world.paused = !world.paused
    $('b-pause').textContent = world.paused ? 'resume' : 'pause'
    $('b-pause').classList.toggle('on', world.paused)
  }
  $('b-speed').onclick = () => {
    speedIdx = (speedIdx + 1) % speeds.length
    world.clock.speed = speeds[speedIdx]
    $('b-speed').textContent = `speed ×${speedIdx + 1}`
  }
  $('b-llm').onclick = () => {
    const on = !(llm.state.enabled)
    llm.setMode(on)
    $('b-llm').textContent = on ? 'manager: Claude' : 'manager: heuristic'
    $('b-llm').classList.toggle('on', on)
  }
  $('explode').oninput = e => {
    world.view.explode = parseFloat(e.target.value)
    world.applyExplode()
  }
  for (const b of document.querySelectorAll('#tabs button'))
    b.onclick = () => {
      tab = b.dataset.tab
      document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b))
    }

  // ---- refresh -----------------------------------------------------------------
  const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))

  function rowsTasks() {
    const tasks = world.tasks.open().sort((a, b) => (b.age / b.patience) - (a.age / a.patience))
    if (!tasks.length) return '<div class="row ok">all quiet… suspiciously quiet</div>'
    return tasks.map(t => {
      const urgency = t.age / t.patience
      return `<div class="row ${urgency > 0.6 ? 'warn' : ''}">
        ${esc(t.label)}<br><small>${t.id} · needs ${t.requires} ·
        ${t.assignee ? 'assigned ' + t.assignee : 'UNASSIGNED'} ·
        ${Math.max(0, Math.round(t.patience - t.age))}s left</small></div>`
    }).join('')
  }

  function rowsCrew() {
    const out = []
    for (const s of world.staff.staff.values())
      out.push(`<div class="row">${esc(s.name)} <small>(${s.role})</small><br>
        <small>${s.state}${s.task ? ' → ' + s.task.id : ''} · in ${s.area ?? '?'}${s.fatigue > 85 ? ' · tired' : ''}</small></div>`)
    for (const r of world.robots.robots.values()) {
      const warn = r.state === 'stuck' || r.state === 'dead' || r.battery < 20
      out.push(`<div class="row ${warn ? 'warn' : ''}">${esc(r.name)}<br>
        <small>${r.state}${r.task ? ' → ' + r.task.id : ''} · ${Math.round(r.battery)}% · in ${r.area ?? '?'}</small>
        <div class="hbar"><i style="width:${r.battery}%;background:${r.battery < 20 ? 'var(--bad)' : 'var(--good)'}"></i></div></div>`)
    }
    return out.join('')
  }

  function rowsGuests() {
    const out = []
    for (const p of world.guests.parties.values()) {
      if (p.state === 'gone') continue
      const mood = p.happiness > 60 ? 'ok' : p.happiness > 30 ? '' : 'warn'
      out.push(`<div class="row ${mood}">${esc(p.label)}<br>
        <small>${p.state}${p.room ? ' · ' + p.room : ''}${p.waitingOn ? ' · waiting: ' + p.waitingOn : ''}</small>
        <div class="hbar"><i style="width:${p.happiness}%;background:${p.happiness > 40 ? 'var(--good)' : 'var(--bad)'}"></i></div></div>`)
    }
    return out.join('') || '<div class="row">nobody here yet</div>'
  }

  let lastFeedLen = -1
  function refresh() {
    // keep the manager button honest if the LLM manager bowed out on its own
    if (!llm.state.enabled && $('b-llm').classList.contains('on')) {
      $('b-llm').textContent = 'manager: heuristic'
      $('b-llm').classList.remove('on')
    }
    $('clock').textContent = hhmm(world.clock.t)
    const s = world.score.summary()
    $('m-happy').textContent = s.happiness
    $('m-happy').style.color = s.happiness > 60 ? 'var(--good)' : s.happiness > 40 ? 'var(--accent)' : 'var(--bad)'
    $('m-points').textContent = s.points
    $('m-tasks').textContent = world.tasks.open().length
    $('m-grade').textContent = s.grade

    $('panel').innerHTML = tab === 'tasks' ? rowsTasks() : tab === 'crew' ? rowsCrew() : rowsGuests()

    if (world.events.length !== lastFeedLen) {
      lastFeedLen = world.events.length
      $('feed').innerHTML = world.events.slice(-24).reverse()
        .map(e => `<div class="${e.msg.startsWith('MGR') ? 'mgr' : ''}">${hhmm(e.t)} ${esc(e.msg)}</div>`)
        .join('')
    }

    if (world.gameOver && $('gameover').style.display !== 'flex') {
      $('gameover').style.display = 'flex'
      $('final-grade').textContent = s.grade
      $('final-line').textContent =
        `${s.resolved} tasks handled · ${s.expired} dropped · ${s.walkouts} walkouts · ${s.points} points`
    }
  }
  setInterval(refresh, 400)
  refresh()
}
