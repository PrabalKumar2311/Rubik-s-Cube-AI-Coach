let worker = null
let nextId = 1
const pending = new Map()

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./solver.worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    const { id, error, ...rest } = e.data
    const p = pending.get(id)
    if (!p) return
    pending.delete(id)
    error ? p.reject(new Error(error)) : p.resolve(rest)
  }
  // If the worker itself crashes, fail every pending call instead of hanging forever
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'Solver worker crashed'))
    pending.clear()
    worker = null
  }
  return worker
}

function call(msg) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, ...msg })
  })
}

export const warmupSolver = () => call({ type: 'warmup' })

/** Returns an array of move tokens, e.g. ["R", "U'", "F2"] */
export async function solveFacelets(facelets) {
  const { solution } = await call({ type: 'solve', facelets })
  return solution ? solution.trim().split(/\s+/) : []
}
