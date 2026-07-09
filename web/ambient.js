//
// Theme ambience: pure presentation, driven by volume's custom-handler
// hook ({ volume: { geometry: '<name>', handler } } registers the handler).
// Underwater gets a fish swarm, rising bubbles and a shimmering surface
// overhead; arctic gets an aurora borealis shader and falling snow.
// Handlers are revisited every tick (not static), which is the animation.
//

import * as THREE from 'three'

const rnd = (a, b) => a + Math.random() * (b - a)

// ---- fish swarm ---------------------------------------------------------------
function makeFishHandler(layout) {
  const [W, D] = layout.bounds
  return async function fishHandler(bus, surface, entity) {
    const v = entity.volume
    if (entity.obliterate) { surface.scene?.remove(v.node); return }
    if (!v._built) {
      v._built = true
      const group = v.node = new THREE.Group()
      const colors = [0xffb26b, 0x63c7ff, 0xff7ab8, 0xb0f26b, 0x8f7aff, 0xffe36b]
      const geo = new THREE.BoxGeometry(0.42, 0.14, 0.1)
      const tail = new THREE.BoxGeometry(0.12, 0.1, 0.02)
      v._fish = []
      for (let i = 0; i < 26; i++) {
        const mat = new THREE.MeshPhongMaterial({ color: colors[i % colors.length] })
        const f = new THREE.Group()
        f.add(new THREE.Mesh(geo, mat))
        const tm = new THREE.Mesh(tail, mat); tm.position.x = -0.26; f.add(tm)
        f.position.set(rnd(-25, W + 25), rnd(2, 24), rnd(-20, D + 20))
        group.add(f)
        v._fish.push({ n: f, h: rnd(0, Math.PI * 2), s: rnd(0.5, 1.5), b: rnd(0, 9) })
      }
      surface.scene.add(group)
      v._t = performance.now() / 1000
      return
    }
    const now = performance.now() / 1000
    const dt = Math.min(0.1, now - v._t); v._t = now
    for (const f of v._fish) {
      f.h += rnd(-0.5, 0.5) * dt
      const p = f.n.position
      // steer back into bounds, and out of the hotel's footprint
      const inHull = p.x > -3 && p.x < W + 3 && p.z > -3 && p.z < D + 3 && p.y < layout.floors * 3.4
      if (p.x < -28 || p.x > W + 28 || p.z < -24 || p.z > D + 24 || inHull) {
        const tx = inHull ? (p.x < W / 2 ? -20 : W + 20) : W / 2
        f.h += (Math.atan2((inHull ? p.z : D / 2) - p.z, tx - p.x) - f.h) * 0.12
      }
      p.x += Math.cos(f.h) * f.s * dt
      p.z += Math.sin(f.h) * f.s * dt
      p.y += Math.sin(now * 1.3 + f.b) * 0.15 * dt
      p.y = Math.max(1.2, Math.min(26, p.y))
      f.n.rotation.y = -f.h
    }
  }
}

// ---- particle columns (bubbles rise, snow falls) ------------------------------
function makeParticles({ layout, count, size, color, opacity, vy, drift }) {
  const [W, D] = layout.bounds
  const X0 = -35, X1 = W + 35, Z0 = -25, Z1 = D + 25, TOP = 46
  return async function particleHandler(bus, surface, entity) {
    const v = entity.volume
    if (entity.obliterate) { surface.scene?.remove(v.node); return }
    if (!v._built) {
      v._built = true
      const pos = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) {
        pos[i * 3] = rnd(X0, X1); pos[i * 3 + 1] = rnd(0, TOP); pos[i * 3 + 2] = rnd(Z0, Z1)
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      v.node = new THREE.Points(geo, new THREE.PointsMaterial({
        color, size, transparent: true, opacity, depthWrite: false, sizeAttenuation: true,
      }))
      surface.scene.add(v.node)
      v._t = performance.now() / 1000
      return
    }
    const now = performance.now() / 1000
    const dt = Math.min(0.1, now - v._t); v._t = now
    const a = v.node.geometry.attributes.position
    for (let i = 0; i < count; i++) {
      let y = a.getY(i) + vy * dt
      a.setX(i, a.getX(i) + Math.sin(now * 0.7 + i) * drift * dt)
      if (y > TOP) y = 0
      if (y < 0) y = TOP
      a.setY(i, y)
    }
    a.needsUpdate = true
  }
}

// ---- aurora borealis -----------------------------------------------------------
function makeAuroraHandler(layout) {
  const [W, D] = layout.bounds
  return async function auroraHandler(bus, surface, entity) {
    const v = entity.volume
    if (entity.obliterate) { surface.scene?.remove(v.node); return }
    if (!v._built) {
      v._built = true
      const group = v.node = new THREE.Group()
      v._mats = []
      // parked in the sky band the default camera actually sees, just
      // above the building silhouette on the north side
      const ribbons = [
        { w: 300, h: 42, y: 52, z: -28, hue: 0 },
        { w: 380, h: 56, y: 66, z: -55, hue: 0.35 },
        { w: 240, h: 34, y: 44, z: -14, hue: 0.7 },
      ]
      for (const r of ribbons) {
        const mat = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          uniforms: { time: { value: 0 }, hue: { value: r.hue } },
          vertexShader: `
            uniform float time;
            varying vec2 vUv;
            void main() {
              vUv = uv;
              vec3 p = position;
              p.y += sin(uv.x * 5.0 + time * 0.35) * 4.0;
              p.z += sin(uv.x * 3.0 - time * 0.22) * 6.0;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
            }`,
          fragmentShader: `
            uniform float time;
            uniform float hue;
            varying vec2 vUv;
            void main() {
              float curtain = 0.55
                + 0.45 * sin(vUv.x * 14.0 + time * 0.6 + hue * 7.0)
                * sin(vUv.x * 31.0 - time * 0.31);
              float fade = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
              vec3 green = vec3(0.10, 0.95, 0.55);
              vec3 violet = vec3(0.45, 0.25, 0.95);
              vec3 col = mix(green, violet, vUv.y + 0.25 * sin(vUv.x * 6.0 + time * 0.2 + hue * 4.0));
              gl_FragColor = vec4(col, curtain * fade * 0.5);
            }`,
        })
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.h, 96, 1), mat)
        mesh.position.set(W / 2 + (r.hue - 0.35) * 60, r.y, r.z)
        group.add(mesh)
        v._mats.push(mat)
      }
      surface.scene.add(group)
      return
    }
    const t = performance.now() / 1000
    for (const m of v._mats) m.uniforms.time.value = t
  }
}

// ---- interior glow -------------------------------------------------------------
// Warm point lights along each floor's corridor plus the lobby — the deep-sea
// station (and the arctic lodge) would be pitch black without them.
function interiorLights(layout, { color = 0xffd9a0, intensity = 1.1, reach = 22 } = {}) {
  const fh = layout.floorHeight
  const ents = []
  const spots = layout.areas.filter(a =>
    a.kind === 'corridor' || a.kind === 'lobby' || a.kind === 'restaurant' || a.kind === 'bar')
  let i = 0
  for (const a of spots) {
    const [x, z, w, d] = a.rect
    // long corridors get two lamps, everything else one
    const n = a.kind === 'corridor' && w > 24 ? 2 : 1
    for (let k = 0; k < n; k++) {
      ents.push({ uuid: `glow-${i++}`, volume: {
        geometry: 'light', light: 'point', static: true,
        color, intensity, distance: reach, decay: 1.6,
        pose: { position: [x + w * (n === 2 ? 0.25 + k * 0.5 : 0.5), a.floor * fh + 2.3, z + d / 2] },
      } })
    }
  }
  return ents
}

// ---- mount ------------------------------------------------------------------------
export function mountAmbient(world, bus, { themeName, theme, layout }) {
  const [W, D] = layout.bounds
  const ents = []
  if (themeName === 'underwater') {
    ents.push(...interiorLights(layout, { intensity: 1.35, reach: 26 }))
    // hull floodlights: cool exterior glow at the corners
    for (const [i, [fx, fz]] of [[-6, -6], [W + 6, -6], [-6, D + 6], [W + 6, D + 6]].entries())
      ents.push({ uuid: `flood-${i}`, volume: {
        geometry: 'light', light: 'point', static: true,
        color: 0x6fd8ff, intensity: 0.8, distance: 34, decay: 1.4,
        pose: { position: [fx, 6, fz] },
      } })
    ents.push({ uuid: 'ambient-fish', volume: { geometry: 'fishswarm', handler: makeFishHandler(layout) } })
    ents.push({ uuid: 'ambient-bubbles', volume: {
      geometry: 'bubbles',
      handler: makeParticles({ layout, count: 160, size: 0.16, color: 0xcdf6ff, opacity: 0.55, vy: 1.6, drift: 0.4 }),
    } })
    // the sea surface far overhead
    ents.push({ uuid: 'ambient-surface', volume: {
      geometry: 'plane', props: [420, 420], static: true,
      material: { color: 0x2ec4d6, opacity: 0.20, transparent: true, side: 2, shininess: 120 },
      pose: { position: [W / 2, 47, D / 2], rotation: [-Math.PI / 2, 0, 0] },
    } })
  }
  if (themeName === 'arctic') {
    ents.push(...interiorLights(layout, { color: 0xffc98a, intensity: 0.9 }))
    ents.push({ uuid: 'ambient-aurora', volume: { geometry: 'aurora', handler: makeAuroraHandler(layout) } })
    ents.push({ uuid: 'ambient-snow', volume: {
      geometry: 'snowfall',
      handler: makeParticles({ layout, count: 420, size: 0.14, color: 0xffffff, opacity: 0.8, vy: -1.5, drift: 0.8 }),
    } })
  }
  if (ents.length) bus.resolve(ents)
}
