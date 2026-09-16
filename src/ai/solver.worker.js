// Runs the Kociemba two-phase solver (cubejs) off the main thread so the cube never stutters.
//
// cubejs is legacy CommonJS that depends on a top-level `this`, which ES-module workers don't
// have. Loading the sources as raw text and evaluating them with an explicit scope works the
// same in `vite dev` and in production builds.
import cubeSrc from 'cubejs/lib/cube.js?raw'
import solveSrc from 'cubejs/lib/solve.js?raw'

function loadCube() {
  const scope = {}
  const cubeModule = { exports: {} }
  new Function('module', 'exports', 'require', cubeSrc).call(scope, cubeModule, cubeModule.exports, () => null)
  const Cube = cubeModule.exports
  scope.Cube = Cube
  // solve.js reads `this.Cube` and extends it in place
  new Function('module', 'exports', 'require', solveSrc).call(scope, undefined, undefined, () => Cube)
  return Cube
}

let Cube = null

// Exact shortest solution for nearly-solved cubes (cubejs alone returns long paths for these)
const FACES = ['U', 'R', 'F', 'D', 'L', 'B']
const SUFFIXES = ['', "'", '2']
function shortSearch(start, maxDepth = 4) {
  const path = []
  const dfs = (cube, depth, lastFace) => {
    if (cube.isSolved()) return true
    if (depth === 0) return false
    for (const f of FACES) {
      if (f === lastFace) continue
      for (const s of SUFFIXES) {
        const next = cube.clone()
        next.move(f + s)
        path.push(f + s)
        if (dfs(next, depth - 1, f)) return true
        path.pop()
      }
    }
    return false
  }
  for (let d = 1; d <= maxDepth; d++) {
    path.length = 0
    if (dfs(start, d, null)) return path.join(' ')
  }
  return null
}

self.onmessage = (e) => {
  const { id, type, facelets } = e.data
  try {
    if (!Cube) {
      Cube = loadCube()
      Cube.initSolver()
    }
    if (type === 'warmup') return self.postMessage({ id, ready: true })
    const cube = Cube.fromString(facelets)
    const solution = cube.isSolved() ? '' : shortSearch(cube) ?? cube.solve()
    self.postMessage({ id, solution })
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) })
  }
}
