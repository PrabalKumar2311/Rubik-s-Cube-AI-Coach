// Sanity checks: our facelet export matches cubejs, and solver output really solves our cube.
import { createRequire } from 'module'
import * as L from '../src/cubeLogic.js'
import * as S from '../src/ai/cubeState.js'
const require = createRequire(import.meta.url)
const Cube = require('cubejs')
require('cubejs/lib/solve')

let fails = 0
const check = (label, a, b) => {
  if (a !== b) { fails++; console.log('FAIL', label, '\n ours', a, '\n cjs ', b) }
}
check('solved', S.toFacelets(L.createCubies()), new Cube().asString())
for (const mv of ['R', 'L', 'U', 'D', 'F', 'B', "R'", 'U2', "F'", 'D2', "L'", "B'"]) {
  check(mv, S.toFacelets(S.simulate(L.createCubies(), S.parseAlg(mv))), new Cube().move(mv).asString())
}
const alg = "R U R' U' F2 D L' B U2 R2 F' D' L2 B2 U"
check('alg', S.toFacelets(S.simulate(L.createCubies(), S.parseAlg(alg))), new Cube().move(alg).asString())

Cube.initSolver()
const toks = ['R', 'U', 'F', 'L', 'D', 'B', 'M', 'E', 'S', 'x', 'y', 'z'].flatMap((t) => [t, t + "'", t + '2'])
for (let k = 0; k < 25; k++) {
  const rnd = Array.from({ length: 30 }, () => toks[Math.floor(Math.random() * toks.length)]).join(' ')
  const c = S.simulate(L.createCubies(), S.parseAlg(rnd))
  const sol = Cube.fromString(S.toFacelets(c)).solve()
  if (!L.isSolved(S.simulate(c, S.parseAlg(sol)))) { fails++; console.log('FAIL roundtrip', rnd) }
}
const a = S.analyze(S.simulate(L.createCubies(), S.parseAlg("R U R' U'")))
console.log('sample analysis:', a.currentStageName, a.stages.map((s) => `${s.done}/${s.total}`).join(' '))
console.log(fails ? `${fails} FAILURES` : 'All cube logic checks passed')
process.exit(fails ? 1 : 0)
