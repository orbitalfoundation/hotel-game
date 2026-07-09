//
// Scoring: the win/lose meter. Guest happiness is the heart of it; task
// outcomes, walkouts and security events move the points. The day is won
// if average happiness stays high and walkouts stay rare.
//

export function makeScore(world) {
  const s = {
    points: 100,
    resolved: 0, expired: 0, walkouts: 0, caught: 0, mischief: 0,
    happiness: 78, servedParties: 0,
    history: [],           // sampled happiness over the day for the chart
  }

  const score = {
    state: s,
    taskResolved(t) { s.resolved++; s.points += t.guest ? 10 : 6 },
    taskExpired(t) { s.expired++; s.points -= t.guest ? 15 : 8 },
    walkout() { s.walkouts++; s.points -= 40 },
    caught() { s.caught++; s.points += 25 },
    mischief() { s.mischief++; s.points -= 5 },

    grade() {
      if (s.happiness >= 75 && s.walkouts === 0) return 'S'
      if (s.happiness >= 65 && s.walkouts <= 1) return 'A'
      if (s.happiness >= 55 && s.walkouts <= 3) return 'B'
      if (s.happiness >= 45) return 'C'
      return 'F'
    },
    summary() {
      return {
        points: Math.round(s.points),
        happiness: Math.round(s.happiness),
        grade: score.grade(),
        resolved: s.resolved, expired: s.expired,
        walkouts: s.walkouts, caught: s.caught, mischief: s.mischief,
      }
    },
  }

  let sampleT = 0
  const entity = {
    id: 'score',
    resolve(event) {
      if (!event.tick) return
      const g = world.guests.stats()
      s.happiness = g.avgHappiness
      sampleT += event.dt
      if (sampleT > 5) {
        sampleT = 0
        s.history.push({ t: world.clock.t, happiness: s.happiness, tasks: world.tasks.open().length })
        if (s.history.length > 400) s.history.shift()
      }
    },
  }
  entity.resolve.filter = { tick: true }
  score.entity = entity
  return score
}
