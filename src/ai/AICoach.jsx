import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NAME_TO_HEX, analyze, faceGrids, orientation, parseAlg, simulate, toFacelets } from './cubeState.js'
import { solveFacelets, warmupSolver } from './solver.js'
import './coach.css'

const LOADING_LINES = ['Reading the cube…', 'Running the solver…', 'Asking Gemini…', 'Checking the moves…']
const QUICK_ASKS = ['Why these moves?', "I'm stuck on this step", 'Explain the notation']

function Sparkle({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zm7 11l.9 2.6 2.6.9-2.6.9L19 20l-.9-2.6-2.6-.9 2.6-.9L19 13z"
        fill="currentColor"
      />
    </svg>
  )
}

function MiniNet({ net }) {
  // 12 x 9 grid: U above F, L F R B across, D below F
  const placement = { U: [3, 0], L: [0, 3], F: [3, 3], R: [6, 3], B: [9, 3], D: [3, 6] }
  const cells = []
  for (const [face, [cx, cy]] of Object.entries(placement)) {
    net[face].forEach((row, r) =>
      row.forEach((color, c) =>
        cells.push(
          <span
            key={`${face}${r}${c}`}
            className="net-cell"
            style={{ gridColumn: cx + c + 1, gridRow: cy + r + 1, background: NAME_TO_HEX[color] }}
          />
        )
      )
    )
  }
  return (
    <div className="net" aria-label="Unfolded cube">
      {cells}
      <span className="net-label" style={{ gridColumn: '5', gridRow: '5' }}>F</span>
    </div>
  )
}

function StageList({ analysis }) {
  return (
    <ol className="stages">
      {analysis.stages.map((s, i) => {
        const state = s.complete && i < analysis.currentStage ? 'done' : i === analysis.currentStage ? 'active' : 'todo'
        return (
          <li key={s.name} className={`stage ${state}`}>
            <span className="stage-dot">{state === 'done' ? '✓' : i + 1}</span>
            <span className="stage-name">{s.name}</span>
            <span className="stage-bar">
              <i style={{ width: `${(s.done / s.total) * 100}%` }} />
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function verifyHint(hint, cubies, before) {
  if (hint.source === 'solver' || hint.source === 'offline')
    return { level: 'solver', text: 'Solver-backed · guaranteed to lead to a solve' }
  if (!hint.moves.length) return { level: 'info', text: 'No moves this time — read the tip' }
  let parsed
  try {
    parsed = parseAlg(hint.moves.join(' '))
  } catch {
    return { level: 'warn', text: 'Contains moves the cube does not understand' }
  }
  const after = analyze(simulate(cubies, parsed))
  if (after.solved) return { level: 'good', text: 'Verified · this solves the cube!' }
  if (after.score > before.score + 0.01) {
    if (after.currentStage > before.currentStage)
      return { level: 'good', text: `Verified · completes ${before.currentStageName.toLowerCase()}` }
    const s0 = before.stages[before.currentStage]
    const s1 = after.stages[before.currentStage]
    return { level: 'good', text: `Verified · ${s0.name} ${s0.done}/${s0.total} → ${s1.done}/${s1.total}` }
  }
  return { level: 'warn', text: "Couldn't confirm progress — may be a setup step. Try again or use Fastest." }
}

export default function AICoach({ open, onClose, cubeRef, stats }) {
  const [mode, setMode] = useState('learn')
  const [status, setStatus] = useState('idle') // idle | loading | ready | error
  const [hint, setHint] = useState(null)
  const [error, setError] = useState(null)
  const [verification, setVerification] = useState(null)
  const [question, setQuestion] = useState('')
  const [played, setPlayed] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loadingLine, setLoadingLine] = useState(0)
  const [model, setModel] = useState('')
  const requestId = useRef(0)
  const hintFacelets = useRef('')
  const playFacelets = useRef('')

  // Live view of the cube, refreshed on every move
  const live = useMemo(() => {
    const cubies = cubeRef.current?.getCubies()
    if (!cubies) return null
    return { net: faceGrids(cubies), analysis: analyze(cubies), facelets: toFacelets(cubies) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, open])

  useEffect(() => {
    if (open) warmupSolver().catch(() => {})
  }, [open])

  useEffect(() => {
    if (status !== 'loading') return
    const id = setInterval(() => setLoadingLine((i) => (i + 1) % LOADING_LINES.length), 1400)
    return () => clearInterval(id)
  }, [status])

  const moves = hint?.moves ?? []
  const finishedPlaying = hint && moves.length > 0 && played >= moves.length
  // Stale if the cube changed for a reason other than playing this hint
  const stale =
    !!hint &&
    !!live &&
    !playing &&
    live.facelets !== hintFacelets.current &&
    !(played > 0 && live.facelets === playFacelets.current)

  const askCoach = useCallback(
    async (q = '') => {
      const cube = cubeRef.current
      if (!cube) return
      const id = ++requestId.current
      const cubies = cube.getCubies()
      const analysis = analyze(cubies)
      setError(null)
      setPlayed(0)
      setPlaying(false)

      if (analysis.solved) {
        hintFacelets.current = toFacelets(cubies)
        setHint({ solved: true, moves: [] })
        setVerification(null)
        setStatus('ready')
        return
      }

      setStatus('loading')
      setLoadingLine(0)
      const facelets = toFacelets(cubies)
      let solverMoves = []
      try {
        solverMoves = await solveFacelets(facelets)
      } catch (e) {
        console.warn('Solver failed', e)
      }

      const payload = {
        mode,
        question: q,
        orientation: orientation(cubies),
        net: faceGrids(cubies),
        analysis: {
          currentStageName: analysis.currentStageName,
          stages: analysis.stages,
          whiteFace: analysis.whiteFace,
          yellowFace: analysis.yellowFace,
          unsolvedInCurrentStage: analysis.unsolvedInCurrentStage,
        },
        solverMoves,
        recentMoves: cube.recentMoves(8),
        movesSoFar: stats?.moves ?? 0,
        previousHint: hint && !hint.solved ? `${hint.headline} (${hint.moves.join(' ')})` : '',
      }

      let result
      try {
        const res = await fetch('/api/hint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({ error: 'bad_response', message: 'The hint server did not respond with JSON.' }))
        result = res.ok ? data : { ...data, failed: true }
      } catch (e) {
        result = { failed: true, error: 'network', message: 'Could not reach the hint server. Is `npm run dev` running?' }
      }
      if (id !== requestId.current) return

      let next
      if (result.failed) {
        setError({ code: result.error, message: result.message })
        next = {
          headline: 'Offline hint from the solver',
          stage: analysis.currentStageName,
          explanation:
            'The AI coach is unavailable, so here are the next moves on the solver path. They will get you closer to solved, though they skip the beginner stages.',
          moves: solverMoves.slice(0, 3),
          lookFor: '',
          proTip: '',
          source: 'offline',
        }
      } else {
        next = result.hint
        setModel(result.model || '')
      }
      hintFacelets.current = facelets
      setHint(next)
      setVerification(verifyHint(next, cubies, analysis))
      setStatus('ready')
    },
    [cubeRef, hint, mode, stats]
  )

  const play = (count) => {
    const cube = cubeRef.current
    if (!cube || !hint || playing || cube.isBusy()) return
    let parsed
    try {
      parsed = parseAlg(moves.join(' '))
    } catch {
      return
    }
    const start = stale ? 0 : played
    const slice = parsed.slice(start, count ? start + count : undefined)
    if (!slice.length) return
    if (stale) {
      // The cube changed; re-anchor the hint to the current state
      hintFacelets.current = toFacelets(cube.getCubies())
    }
    setPlaying(true)
    if (stale) setPlayed(0)
    const ok = cube.playMoves(slice, {
      onStep: (i) => {
        setPlayed(start + i + 1)
        if (i === slice.length - 1) {
          setPlaying(false)
          playFacelets.current = toFacelets(cube.getCubies())
        }
      },
    })
    if (!ok) setPlaying(false)
  }

  const submitQuestion = (e) => {
    e?.preventDefault()
    if (status === 'loading') return
    const q = question.trim()
    setQuestion('')
    askCoach(q)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <aside className="coach" role="dialog" aria-label="AI Coach">
      <div className="coach-glow" aria-hidden="true" />
      <div className="coach-inner">
        <header className="coach-head">
          <div className="coach-brand">
            <span className="coach-orb">
              <Sparkle />
            </span>
            <div>
              <div className="coach-title">AI Coach</div>
              <div className="coach-sub">Gemini + solver verified</div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close coach">
            ✕
          </button>
        </header>

        <div className="segmented" data-mode={mode}>
          <span className="seg-thumb" />
          <button className={mode === 'learn' ? 'on' : ''} onClick={() => setMode('learn')}>
            Learn
          </button>
          <button className={mode === 'fast' ? 'on' : ''} onClick={() => setMode('fast')}>
            Fastest
          </button>
        </div>
        <p className="mode-desc">
          {mode === 'learn'
            ? 'Step-by-step beginner method, explained like a coach.'
            : 'Computer solver path (fewest moves), with Gemini explaining each chunk.'}
        </p>

        {live && (
          <section className="coach-state">
            <MiniNet net={live.net} />
            <StageList analysis={live.analysis} />
          </section>
        )}

        <section className="coach-body">
          {status === 'idle' && (
            <div className="empty">
              <p>
                {live?.analysis.solved
                  ? 'The cube is solved. Scramble it and ask for help whenever you get stuck.'
                  : `You're on ${live?.analysis.currentStageName.toLowerCase()}. Ask the coach for your next move.`}
              </p>
              <button className="cta" onClick={() => askCoach()}>
                <Sparkle size={16} /> Get next move
              </button>
            </div>
          )}

          {status === 'loading' && (
            <div className="loading">
              <div className="loading-orb" />
              <div className="loading-text">{LOADING_LINES[loadingLine]}</div>
              <div className="shimmer w80" />
              <div className="shimmer w60" />
              <div className="shimmer w70" />
            </div>
          )}

          {status === 'ready' && hint?.solved && (
            <div className="solved-card">
              <div className="big">Solved!</div>
              <p>Nothing left to do. Hit Scramble for another round.</p>
            </div>
          )}

          {status === 'ready' && hint && !hint.solved && (
            <div className="hint">
              {error && (
                <div className={`notice ${error.code === 'missing_key' ? 'key' : ''}`}>
                  {error.code === 'missing_key' ? (
                    <>
                      <b>Add your Gemini key to enable the AI</b>
                      <code>GEMINI_API_KEY=your_key_here</code>
                      <span>Put it in a <code>.env</code> file in the project root, then restart <code>npm run dev</code>.</span>
                    </>
                  ) : (
                    <>
                      <b>AI unavailable</b>
                      <span>{error.message}</span>
                    </>
                  )}
                </div>
              )}

              <div className="hint-stage">{hint.stage}</div>
              <h2 className="hint-headline">{hint.headline}</h2>
              <p className="hint-text">{hint.explanation}</p>

              {moves.length > 0 && (
                <div className="moves" aria-label="Suggested moves">
                  {moves.map((m, i) => (
                    <span
                      key={i}
                      className={`chip ${!stale && i < played ? 'done' : ''} ${playing && i === played ? 'active' : ''}`}
                    >
                      {m}
                    </span>
                  ))}
                </div>
              )}

              {verification && <div className={`verify ${verification.level}`}>{verification.text}</div>}

              {stale && (
                <div className="notice subtle">The cube changed since this hint. Get a fresh one for accurate advice.</div>
              )}

              <div className="actions">
                {moves.length > 0 && (
                  <>
                    <button className="cta" onClick={() => play()} disabled={playing || (finishedPlaying && !stale)}>
                      ▶ {played > 0 && !finishedPlaying && !stale ? 'Continue' : 'Show me'}
                    </button>
                    <button onClick={() => play(1)} disabled={playing || (finishedPlaying && !stale)}>
                      Step
                    </button>
                  </>
                )}
                <button className={finishedPlaying || stale ? 'cta' : ''} onClick={() => askCoach()} disabled={playing}>
                  <Sparkle size={14} /> {finishedPlaying || stale ? 'Next hint' : 'Ask again'}
                </button>
              </div>

              {hint.lookFor && (
                <div className="tip">
                  <span>Look for</span>
                  {hint.lookFor}
                </div>
              )}
              {hint.proTip && (
                <div className="tip">
                  <span>Pro tip</span>
                  {hint.proTip}
                </div>
              )}
              {model && hint.source !== 'offline' && <div className="model">via {model}</div>}
            </div>
          )}
        </section>

        <form className="ask" onSubmit={submitQuestion}>
          <div className="quick">
            {QUICK_ASKS.map((q) => (
              <button type="button" key={q} onClick={() => askCoach(q)} disabled={status === 'loading'}>
                {q}
              </button>
            ))}
          </div>
          <div className="ask-row">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask the coach anything…"
              maxLength={400}
            />
            <button type="submit" className="send" disabled={status === 'loading'} aria-label="Ask">
              ↑
            </button>
          </div>
        </form>
      </div>
    </aside>
  )
}
