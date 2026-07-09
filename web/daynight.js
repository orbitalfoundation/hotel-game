//
// Day-night cycle: the sun orbits with the game clock, warms at the golden
// hours, hands off to cool moonlight after 20:00, and the sky/fog darken
// with it. Pure presentation — mutates the live three.js nodes each tick.
//

import { Color } from 'three'

export function mountDayNight(world, bus, { theme, sunEntity, ambientEntity, layout, muted = false }) {
  const [W, D] = layout.bounds
  const cx = W / 2, cz = D / 2
  const R = Math.max(W, D) * 1.6 + 60

  const dayBg = new Color(theme.bg)
  const nightBg = new Color(theme.bg).multiplyScalar(0.10)
  const bg = new Color()
  const dayFog = theme.fog ? new Color(theme.fog.color) : null
  const nightFog = theme.fog ? new Color(theme.fog.color).multiplyScalar(0.15) : null

  const daySun = new Color(0xfff2e0)
  const goldSun = new Color(0xffc47e)
  const moon = new Color(0x8fa8d8)

  const listener = {
    id: 'daynight',
    resolve(event) {
      if (!event.tick) return
      const sun = sunEntity.volume.node
      const amb = ambientEntity.volume.node
      const surface = bus.volume?._surfaces?.volume001
      if (!sun || !amb || !surface?.scene) return

      const h = world.clock.t / 3600
      // daylight arc 06:00 → 20:00
      const arc = Math.PI * (h - 6) / 14
      let daylight = h < 6 || h > 20 ? 0 : Math.max(0, Math.sin(arc))
      // muted (underwater): a faint blue shimmer at most; interior lights
      // carry the scene
      if (muted) daylight *= 0.35

      if (muted) {
        sun.position.set(cx, R * 0.8, cz + 10)
        sun.intensity = 0.15 + 0.3 * daylight
        sun.color.set(0x9fd8e8)
      } else if (daylight > 0) {
        sun.position.set(cx + Math.cos(arc) * R, Math.max(10, Math.sin(arc) * R * 0.7), cz + D * 0.9)
        sun.intensity = 0.25 + 1.05 * daylight
        sun.color.copy(daySun).lerp(goldSun, daylight < 0.35 ? 1 - daylight / 0.35 : 0)
      } else {
        // moonlight: steady, cool, from the south-west
        sun.position.set(cx - W * 0.4, R * 0.5, cz + D * 1.2)
        sun.intensity = 0.14
        sun.color.copy(moon)
      }
      // underwater has no real night — the station's own lighting dominates
      amb.intensity = muted ? 0.34 + 0.22 * daylight : 0.09 + 0.55 * daylight

      bg.copy(nightBg).lerp(dayBg, daylight)
      if (surface.scene.background?.isColor) surface.scene.background.copy(bg)
      if (surface.scene.fog && dayFog)
        surface.scene.fog.color.copy(nightFog).lerp(dayFog, daylight)
    },
  }
  listener.resolve.filter = { tick: true }
  bus.register(listener)
}
