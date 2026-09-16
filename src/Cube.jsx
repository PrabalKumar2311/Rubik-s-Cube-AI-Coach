import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import {
  AXES,
  MOVES,
  QUARTER,
  COLORS,
  bakeTurn,
  createCubies,
  dominantAxis,
  getMembers,
  isSolved,
  normalizeTurns,
  randomScramble,
  resetCubies,
} from './cubeLogic'

const CUBIE_SIZE = 0.95
const STICKER_SIZE = 0.8
const DRAG_THRESHOLD = 0.1 // world units before a drag picks its direction
const DRAG_RADIUS = 1.5 // world units of drag per radian of turn

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOut = (t) => 1 - Math.pow(1 - t, 3)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

function roundedSquareGeometry(size, r) {
  const h = size / 2
  const s = new THREE.Shape()
  s.moveTo(-h + r, -h)
  s.lineTo(h - r, -h)
  s.quadraticCurveTo(h, -h, h, -h + r)
  s.lineTo(h, h - r)
  s.quadraticCurveTo(h, h, h - r, h)
  s.lineTo(-h + r, h)
  s.quadraticCurveTo(-h, h, -h, h - r)
  s.lineTo(-h, -h + r)
  s.quadraticCurveTo(-h, -h, -h + r, -h)
  return new THREE.ShapeGeometry(s, 8)
}

const Z_UP = new THREE.Vector3(0, 0, 1)

const Cube = forwardRef(function Cube({ onChange }, ref) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const controls = useThree((s) => s.controls)

  const cubies = useRef(null)
  if (!cubies.current) cubies.current = createCubies()

  const groups = useRef([])
  const anim = useRef(null) // current layer animation / drag
  const queue = useRef([]) // pending moves
  const history = useRef([]) // completed moves
  const drag = useRef(null)

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const controlsRef = useRef(controls)
  controlsRef.current = controls

  // ---------- shared geometry / materials ----------
  const stickerGeo = useMemo(() => roundedSquareGeometry(STICKER_SIZE, 0.09), [])
  const bodyMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#0d0d0f', roughness: 0.55, metalness: 0.1 }),
    []
  )
  const stickerMats = useMemo(() => {
    const m = {}
    for (const c of Object.values(COLORS))
      m[c] = new THREE.MeshPhysicalMaterial({
        color: c,
        roughness: 0.28,
        clearcoat: 0.6,
        clearcoatRoughness: 0.2,
      })
    return m
  }, [])

  // ---------- helpers ----------
  const busy = () => !!anim.current || queue.current.length > 0 || !!drag.current

  const notify = () => {
    const h = history.current
    onChangeRef.current?.({
      moves: h.filter((m) => m.kind === 'user' && m.layer !== null).length,
      solved: isSolved(cubies.current),
      canUndo: h.length > 0 && h[h.length - 1].kind === 'user',
      canSolve: h.length > 0,
    })
  }

  const enqueue = (move, duration, kind, onDone) => {
    queue.current.push({ ...move, duration, kind, onDone })
  }

  const startNext = () => {
    const m = queue.current.shift()
    anim.current = {
      mode: 'auto',
      axis: m.axis,
      layer: m.layer,
      members: getMembers(cubies.current, m.axis, m.layer),
      angle: 0,
      from: 0,
      target: m.turns * QUARTER,
      t: 0,
      duration: m.duration * (Math.abs(m.turns) === 2 ? 1.4 : 1),
      kind: m.kind,
      onDone: m.onDone,
    }
  }

  const finish = () => {
    const a = anim.current
    const n = normalizeTurns(Math.round(a.target / QUARTER))
    if (n !== 0) {
      bakeTurn(cubies.current, a.members, a.axis, n)
      if (a.kind) history.current.push({ axis: a.axis, layer: a.layer, turns: n, kind: a.kind })
    }
    anim.current = null
    notify()
    a.onDone?.()
  }

  // ---------- per-frame: animate + write transforms ----------
  const rotQ = useMemo(() => new THREE.Quaternion(), [])
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1)
    if (!anim.current && queue.current.length) startNext()

    const a = anim.current
    if (a && a.mode !== 'drag') {
      a.t += dt / a.duration
      const k = Math.min(a.t, 1)
      const e = a.mode === 'snap' ? easeOut(k) : easeInOut(k)
      a.angle = a.from + (a.target - a.from) * e
      if (a.t >= 1) finish()
    }

    const cur = anim.current
    if (cur) rotQ.setFromAxisAngle(AXES[cur.axis], cur.angle)
    const list = cubies.current
    for (let i = 0; i < list.length; i++) {
      const g = groups.current[i]
      if (!g) continue
      const c = list[i]
      if (cur && cur.members.has(i)) {
        g.position.copy(c.pos).applyQuaternion(rotQ)
        g.quaternion.copy(rotQ).multiply(c.quat)
      } else {
        g.position.copy(c.pos)
        g.quaternion.copy(c.quat)
      }
    }
  })

  // ---------- drag-to-turn ----------
  const rootRef = useRef(null)

  // Starts a drag from a raycast hit. Returns true if the cube took the pointer.
  const beginDrag = (hit, pointerId) => {
    if (busy()) return false
    let obj = hit.object
    while (obj && obj.userData.cubie === undefined) obj = obj.parent
    if (!obj) return false
    const index = obj.userData.cubie

    // The cube is centred at the origin, so the dominant axis of the hit point
    // tells us which outer face was touched (robust on rounded bevels too).
    const p = hit.point
    const nAxis = dominantAxis(p)
    const nSign = Math.sign(p.getComponent(nAxis))
    // Ignore hits deep inside the gaps between cubies
    if (Math.abs(p.getComponent(nAxis)) < 1.25) return false
    if (Math.round(cubies.current[index].pos.getComponent(nAxis)) !== nSign) return false

    const n = new THREE.Vector3()
    n.setComponent(nAxis, nSign)
    drag.current = {
      index,
      n,
      nAxis,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, hit.point),
      start: hit.point.clone(),
      pointerId,
      decided: false,
      dir: null,
      rotSign: 1,
      lastAngle: 0,
      lastTime: performance.now(),
      vel: 0,
    }
    document.body.style.cursor = 'grabbing'
    return true
  }

  useEffect(() => {
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const hit = new THREE.Vector3()
    const delta = new THREE.Vector3()

    const setRay = (ev) => {
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1
      )
      raycaster.setFromCamera(ndc, camera)
    }

    // Capture phase on the canvas parent runs before OrbitControls and R3F,
    // so the camera never starts orbiting when a layer drag begins.
    const onDown = (ev) => {
      if (ev.target !== gl.domElement) return
      if (ev.pointerType === 'mouse' && ev.button !== 0) return
      if (drag.current || !rootRef.current) return
      setRay(ev)
      const hits = raycaster.intersectObject(rootRef.current, true)
      if (!hits.length) return
      if (beginDrag(hits[0], ev.pointerId)) {
        if (controlsRef.current) controlsRef.current.enabled = false
      }
    }

    const onMove = (ev) => {
      const d = drag.current
      if (!d || ev.pointerId !== d.pointerId) return
      setRay(ev)
      if (!raycaster.ray.intersectPlane(d.plane, hit)) return
      delta.copy(hit).sub(d.start)

      if (!d.decided) {
        if (delta.length() < DRAG_THRESHOLD) return
        // Pick the in-plane axis the finger is moving along most
        let best = -1
        let bestVal = -1
        for (let ax = 0; ax < 3; ax++) {
          if (ax === d.nAxis) continue
          const v = Math.abs(delta.getComponent(ax))
          if (v > bestVal) {
            bestVal = v
            best = ax
          }
        }
        const dir = new THREE.Vector3()
        dir.setComponent(best, Math.sign(delta.getComponent(best)) || 1)
        // Turning about (normal × dir) moves the touched surface along dir
        const w = new THREE.Vector3().crossVectors(d.n, dir)
        const rotAxis = dominantAxis(w)
        d.rotSign = Math.sign(w.getComponent(rotAxis))
        d.dir = dir
        const layer = Math.round(cubies.current[d.index].pos.getComponent(rotAxis))
        anim.current = {
          mode: 'drag',
          axis: rotAxis,
          layer,
          members: getMembers(cubies.current, rotAxis, layer),
          angle: 0,
          kind: 'user',
        }
        d.decided = true
      }

      const angle = (d.rotSign * delta.dot(d.dir)) / DRAG_RADIUS
      const now = performance.now()
      const dtms = now - d.lastTime
      if (dtms > 0) {
        const inst = (angle - d.lastAngle) / (dtms / 1000)
        d.vel = d.vel * 0.5 + inst * 0.5
      }
      d.lastAngle = angle
      d.lastTime = now
      anim.current.angle = angle
    }

    const onUp = (ev) => {
      const d = drag.current
      if (!d || ev.pointerId !== d.pointerId) return
      drag.current = null
      document.body.style.cursor = ''
      if (controlsRef.current) controlsRef.current.enabled = true

      const a = anim.current
      if (!d.decided || !a || a.mode !== 'drag') return
      // Flick: carry velocity forward, then snap to the nearest quarter turn
      const vel = performance.now() - d.lastTime > 90 ? 0 : d.vel
      const projected = a.angle + clamp(vel * 0.12, -QUARTER * 0.7, QUARTER * 0.7)
      const target = Math.round(projected / QUARTER) * QUARTER
      a.mode = 'snap'
      a.from = a.angle
      a.target = target
      a.t = 0
      a.duration = clamp((Math.abs(target - a.angle) / QUARTER) * 0.28, 0.07, 0.32)
    }

    const host = gl.domElement.parentElement
    host.addEventListener('pointerdown', onDown, { capture: true })
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      host.removeEventListener('pointerdown', onDown, { capture: true })
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [camera, gl])

  // ---------- public API ----------
  useImperativeHandle(ref, () => ({
    getCubies: () => cubies.current,
    isBusy: () => busy(),
    recentMoves(count = 8) {
      return history.current
        .filter((h) => h.kind === 'user')
        .slice(-count)
        .map((h) => {
          const entry = Object.entries(MOVES).find(([, m]) => m.axis === h.axis && m.layer === h.layer)
          if (!entry) return null
          const rel = h.turns * entry[1].dir
          const name = entry[1].layer === null ? entry[0].toLowerCase() : entry[0]
          return rel === 2 || rel === -2 ? `${name}2` : rel === -1 ? `${name}'` : name
        })
        .filter(Boolean)
    },
    /** moves: [{ name, prime, double }] — onStep(i) fires as each move lands */
    playMoves(moves, { duration = 0.32, onStep } = {}) {
      if (drag.current) return false
      moves.forEach((m, i) => {
        const def = MOVES[m.name]
        if (!def) return
        const turns = def.dir * (m.prime ? -1 : 1) * (m.double ? 2 : 1)
        enqueue({ axis: def.axis, layer: def.layer, turns }, duration, 'user', () => onStep?.(i))
      })
      return true
    },
    move(name, prime = false, double = false) {
      const m = MOVES[name]
      if (!m || drag.current) return
      const turns = m.dir * (prime ? -1 : 1) * (double ? 2 : 1)
      enqueue({ axis: m.axis, layer: m.layer, turns }, 0.2, 'user')
    },
    scramble(length = 25) {
      if (busy()) return false
      for (const mv of randomScramble(length)) enqueue(mv, 0.09, 'scramble')
      return true
    },
    undo() {
      if (busy()) return
      const h = history.current
      const last = h[h.length - 1]
      if (!last || last.kind !== 'user') return
      h.pop()
      enqueue({ axis: last.axis, layer: last.layer, turns: -last.turns }, 0.2, null)
      notify()
    },
    solve() {
      if (busy()) return false
      const moves = history.current.slice().reverse()
      if (!moves.length) return false
      history.current = []
      for (const mv of moves)
        enqueue({ axis: mv.axis, layer: mv.layer, turns: -mv.turns }, 0.085, null)
      return true
    },
    reset() {
      queue.current = []
      anim.current = null
      drag.current = null
      history.current = []
      if (controlsRef.current) controlsRef.current.enabled = true
      resetCubies(cubies.current)
      notify()
    },
  }))

  useEffect(() => {
    notify()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- render ----------
  return (
    <group ref={rootRef}>
      {cubies.current.map((c, i) => (
        <group
          key={i}
          ref={(el) => (groups.current[i] = el)}
          position={c.pos.toArray()}
          userData={{ cubie: i }}
          onPointerOver={(e) => {
            e.stopPropagation()
            if (!drag.current) document.body.style.cursor = 'grab'
          }}
          onPointerOut={() => {
            if (!drag.current) document.body.style.cursor = ''
          }}
        >
          <RoundedBox args={[CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE]} radius={0.07} smoothness={3}>
            <primitive object={bodyMat} attach="material" />
          </RoundedBox>
          {c.stickers.map((s, j) => (
            <mesh
              key={j}
              geometry={stickerGeo}
              material={stickerMats[s.color]}
              position={s.normal.clone().multiplyScalar(CUBIE_SIZE / 2 + 0.003).toArray()}
              quaternion={new THREE.Quaternion().setFromUnitVectors(Z_UP, s.normal)}
            />
          ))}
        </group>
      ))}
    </group>
  )
})

export default Cube
