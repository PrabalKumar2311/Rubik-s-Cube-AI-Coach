import * as THREE from 'three'

export const QUARTER = Math.PI / 2

export const AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
]

// Standard colour scheme: white top, green front, red right
export const COLORS = {
  U: '#f4f4f4', // white
  D: '#ffd500', // yellow
  F: '#009e60', // green
  B: '#0051ba', // blue
  R: '#c41e3a', // red
  L: '#ff6a00', // orange
}

// FACE_BY_NORMAL[axis][sign > 0 ? 1 : 0]
const FACE_BY_NORMAL = [
  ['L', 'R'],
  ['D', 'U'],
  ['B', 'F'],
]

// Singmaster notation. `dir` is the rotation sign (right-hand rule around the
// positive axis) for a clockwise turn when looking at that face.
// layer: -1 / 0 / 1, or null for a whole-cube rotation.
export const MOVES = {
  R: { axis: 0, layer: 1, dir: -1 },
  L: { axis: 0, layer: -1, dir: 1 },
  M: { axis: 0, layer: 0, dir: 1 },
  U: { axis: 1, layer: 1, dir: -1 },
  D: { axis: 1, layer: -1, dir: 1 },
  E: { axis: 1, layer: 0, dir: 1 },
  F: { axis: 2, layer: 1, dir: -1 },
  B: { axis: 2, layer: -1, dir: 1 },
  S: { axis: 2, layer: 0, dir: -1 },
  X: { axis: 0, layer: null, dir: -1 },
  Y: { axis: 1, layer: null, dir: -1 },
  Z: { axis: 2, layer: null, dir: -1 },
}

export function createCubies() {
  const list = []
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++) {
        const coord = [x, y, z]
        const stickers = []
        for (let axis = 0; axis < 3; axis++) {
          const v = coord[axis]
          if (v === 0) continue
          const normal = new THREE.Vector3()
          normal.setComponent(axis, v)
          stickers.push({ normal, color: COLORS[FACE_BY_NORMAL[axis][v > 0 ? 1 : 0]] })
        }
        list.push({
          home: new THREE.Vector3(x, y, z),
          pos: new THREE.Vector3(x, y, z),
          quat: new THREE.Quaternion(),
          stickers,
        })
      }
  return list
}

export function resetCubies(cubies) {
  for (const c of cubies) {
    c.pos.copy(c.home)
    c.quat.identity()
  }
}

export function dominantAxis(v) {
  const ax = Math.abs(v.x)
  const ay = Math.abs(v.y)
  const az = Math.abs(v.z)
  if (ax >= ay && ax >= az) return 0
  if (ay >= az) return 1
  return 2
}

export function getMembers(cubies, axis, layer) {
  const set = new Set()
  cubies.forEach((c, i) => {
    if (layer === null || Math.round(c.pos.getComponent(axis)) === layer) set.add(i)
  })
  return set
}

export function normalizeTurns(t) {
  const n = ((t % 4) + 4) % 4
  return n === 3 ? -1 : n
}

const _q = new THREE.Quaternion()
const _m = new THREE.Matrix4()
const ROT_IDX = [0, 1, 2, 4, 5, 6, 8, 9, 10]

// Permanently apply a layer turn to cubie state, snapping to exact values
export function bakeTurn(cubies, members, axis, turns) {
  _q.setFromAxisAngle(AXES[axis], turns * QUARTER)
  for (const i of members) {
    const c = cubies[i]
    c.pos.applyQuaternion(_q).round()
    c.quat.premultiply(_q)
    _m.makeRotationFromQuaternion(c.quat)
    for (const k of ROT_IDX) _m.elements[k] = Math.round(_m.elements[k])
    c.quat.setFromRotationMatrix(_m).normalize()
  }
}

const _n = new THREE.Vector3()
export function isSolved(cubies) {
  const faces = new Map()
  for (const c of cubies) {
    for (const s of c.stickers) {
      _n.copy(s.normal).applyQuaternion(c.quat)
      const ax = dominantAxis(_n)
      const key = ax * 2 + (_n.getComponent(ax) > 0 ? 1 : 0)
      const existing = faces.get(key)
      if (existing && existing !== s.color) return false
      faces.set(key, s.color)
    }
  }
  return true
}

export function randomScramble(length = 25) {
  const faces = ['R', 'L', 'U', 'D', 'F', 'B']
  const out = []
  let lastAxis = -1
  while (out.length < length) {
    const f = faces[Math.floor(Math.random() * faces.length)]
    const m = MOVES[f]
    if (m.axis === lastAxis) continue
    lastAxis = m.axis
    const amount = [1, -1, 2][Math.floor(Math.random() * 3)]
    out.push({ axis: m.axis, layer: m.layer, turns: m.dir * amount })
  }
  return out
}
