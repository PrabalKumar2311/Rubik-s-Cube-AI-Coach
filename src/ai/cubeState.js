import * as THREE from 'three'
import { COLORS, MOVES, bakeTurn, dominantAxis, getMembers, isSolved } from '../cubeLogic.js'

export const COLOR_NAMES = {
  [COLORS.U]: 'white',
  [COLORS.D]: 'yellow',
  [COLORS.F]: 'green',
  [COLORS.B]: 'blue',
  [COLORS.R]: 'red',
  [COLORS.L]: 'orange',
}
export const NAME_TO_HEX = Object.fromEntries(Object.entries(COLOR_NAMES).map(([h, n]) => [n, h]))

export const FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B']
const FACE_NORMALS = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  R: [1, 0, 0],
  L: [-1, 0, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
}

// Kociemba facelet order (also the layout of a standard unfolded net)
const I = [-1, 0, 1]
const R_ = [1, 0, -1]
const FACE_POSITIONS = {
  U: I.flatMap((z) => I.map((x) => [x, 1, z])),
  R: R_.flatMap((y) => R_.map((z) => [1, y, z])),
  F: R_.flatMap((y) => I.map((x) => [x, y, 1])),
  D: R_.flatMap((z) => I.map((x) => [x, -1, z])),
  L: R_.flatMap((y) => I.map((z) => [-1, y, z])),
  B: R_.flatMap((y) => R_.map((x) => [x, y, -1])),
}

const _n = new THREE.Vector3()
function faceOfNormal(v) {
  const ax = dominantAxis(v)
  const s = v.getComponent(ax) > 0
  return ax === 0 ? (s ? 'R' : 'L') : ax === 1 ? (s ? 'U' : 'D') : s ? 'F' : 'B'
}

/** Map "x,y,z|FACE" -> sticker hex colour for the current state */
function stickerMap(cubies) {
  const map = new Map()
  for (const c of cubies) {
    for (const s of c.stickers) {
      _n.copy(s.normal).applyQuaternion(c.quat)
      const key = `${Math.round(c.pos.x)},${Math.round(c.pos.y)},${Math.round(c.pos.z)}|${faceOfNormal(_n)}`
      map.set(key, s.color)
    }
  }
  return map
}

function centerColors(map) {
  const out = {}
  for (const f of FACE_ORDER) out[f] = map.get(`${FACE_NORMALS[f].join(',')}|${f}`)
  return out
}

/** 3x3 grid of colour names per face, in net order */
export function faceGrids(cubies) {
  const map = stickerMap(cubies)
  const grids = {}
  for (const f of FACE_ORDER) {
    const cells = FACE_POSITIONS[f].map((p) => COLOR_NAMES[map.get(`${p.join(',')}|${f}`)])
    grids[f] = [cells.slice(0, 3), cells.slice(3, 6), cells.slice(6, 9)]
  }
  return grids
}

/** 54-char Kociemba string (URFDLB) for the solver */
export function toFacelets(cubies) {
  const map = stickerMap(cubies)
  const centers = centerColors(map)
  const letterOf = Object.fromEntries(FACE_ORDER.map((f) => [centers[f], f]))
  return FACE_ORDER.map((f) =>
    FACE_POSITIONS[f].map((p) => letterOf[map.get(`${p.join(',')}|${f}`)]).join('')
  ).join('')
}

export function orientation(cubies) {
  const centers = centerColors(stickerMap(cubies))
  return Object.fromEntries(FACE_ORDER.map((f) => [f, COLOR_NAMES[centers[f]]]))
}

// ---------- beginner-method stage analysis (orientation independent) ----------

function locationName(pos) {
  const parts = []
  if (pos.y === 1) parts.push('U')
  if (pos.y === -1) parts.push('D')
  if (pos.z === 1) parts.push('F')
  if (pos.z === -1) parts.push('B')
  if (pos.x === 1) parts.push('R')
  if (pos.x === -1) parts.push('L')
  return parts.join('')
}

export const STAGES = [
  'White cross',
  'White corners (first layer)',
  'Middle layer edges',
  'Yellow cross',
  'Yellow face (orient last layer)',
  'Position last-layer corners',
  'Position last-layer edges',
]

export function analyze(cubies) {
  const map = stickerMap(cubies)
  const centers = centerColors(map)
  const faceOfColor = Object.fromEntries(FACE_ORDER.map((f) => [centers[f], f]))
  const W = COLORS.U
  const Y = COLORS.D

  const pieces = cubies
    .filter((c) => c.stickers.length >= 2)
    .map((c) => {
      const pos = { x: Math.round(c.pos.x), y: Math.round(c.pos.y), z: Math.round(c.pos.z) }
      const stickers = c.stickers.map((s) => {
        _n.copy(s.normal).applyQuaternion(c.quat)
        return { color: s.color, facing: faceOfNormal(_n) }
      })
      const solved = stickers.every((s) => centers[s.facing] === s.color)
      return {
        type: stickers.length === 2 ? 'edge' : 'corner',
        colors: stickers.map((s) => s.color),
        stickers,
        solved,
        location: locationName(pos),
        home: stickers.map((s) => faceOfColor[s.color]).join(''),
      }
    })

  const has = (p, col) => p.colors.includes(col)
  const facesColor = (p, col) => p.stickers.find((s) => s.color === col)?.facing === faceOfColor[col]

  const groups = [
    { pieces: pieces.filter((p) => p.type === 'edge' && has(p, W)), ok: (p) => p.solved },
    { pieces: pieces.filter((p) => p.type === 'corner' && has(p, W)), ok: (p) => p.solved },
    { pieces: pieces.filter((p) => p.type === 'edge' && !has(p, W) && !has(p, Y)), ok: (p) => p.solved },
    { pieces: pieces.filter((p) => p.type === 'edge' && has(p, Y)), ok: (p) => facesColor(p, Y) },
    { pieces: pieces.filter((p) => p.type === 'corner' && has(p, Y)), ok: (p) => facesColor(p, Y) },
    { pieces: pieces.filter((p) => p.type === 'corner' && has(p, Y)), ok: (p) => p.solved },
    { pieces: pieces.filter((p) => p.type === 'edge' && has(p, Y)), ok: (p) => p.solved },
  ]

  const stages = groups.map((g, i) => {
    const done = g.pieces.filter(g.ok).length
    return { name: STAGES[i], done, total: g.pieces.length, complete: done === g.pieces.length }
  })
  let current = stages.findIndex((s) => !s.complete)
  const solved = isSolved(cubies)
  if (solved) current = stages.length

  const describe = (p) => ({
    piece: p.colors.map((c) => COLOR_NAMES[c]).join('-'),
    currentlyAt: p.location,
    belongsAt: p.home,
    stickerFacing: Object.fromEntries(p.stickers.map((s) => [COLOR_NAMES[s.color], s.facing])),
  })

  const focus =
    current < groups.length ? groups[current].pieces.filter((p) => !groups[current].ok(p)).map(describe) : []

  // Progress score used to verify AI suggestions
  const score = solved
    ? 1000
    : stages.reduce((acc, s, i) => (i < current ? acc + 100 : i === current ? acc + (s.done / s.total) * 100 : acc), 0)

  return {
    solved,
    currentStage: current,
    currentStageName: STAGES[current] ?? 'Solved',
    stages,
    whiteFace: faceOfColor[W],
    yellowFace: faceOfColor[Y],
    unsolvedInCurrentStage: focus,
    score,
  }
}

// ---------- notation ----------

const TOKEN = /^([RLUDFBMESxyz])(2'?|'|’)?$/
export function parseAlg(text) {
  const tokens = String(text || '')
    .replace(/[()[\],]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  return tokens.map((t) => {
    const m = TOKEN.exec(t)
    if (!m) throw new Error(`Unknown move "${t}"`)
    const name = m[1].toUpperCase()
    const suffix = m[2] || ''
    return {
      token: `${m[1]}${suffix.replace('’', "'")}`,
      name,
      prime: suffix === "'" || suffix === '’',
      double: suffix.startsWith('2'),
    }
  })
}

export function moveToTurn(m) {
  const def = MOVES[m.name]
  return { axis: def.axis, layer: def.layer, turns: def.dir * (m.prime ? -1 : 1) * (m.double ? 2 : 1) }
}

export function cloneCubies(cubies) {
  return cubies.map((c) => ({ ...c, pos: c.pos.clone(), quat: c.quat.clone() }))
}

export function simulate(cubies, moves) {
  const copy = cloneCubies(cubies)
  for (const m of moves) {
    const t = moveToTurn(m)
    let n = ((t.turns % 4) + 4) % 4
    if (n === 3) n = -1
    bakeTurn(copy, getMembers(copy, t.axis, t.layer), t.axis, n)
  }
  return copy
}
