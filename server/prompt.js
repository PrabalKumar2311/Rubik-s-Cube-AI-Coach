// Prompt engineering for the AI Coach.
//
// Strategy:
//  1. Ground truth first: the browser sends a verified cube state (unfolded net,
//     orientation, beginner-method stage analysis) AND a short solution from a
//     local Kociemba solver. LLMs are poor at simulating a cube in their head, so we
//     never ask the model to "figure out" the state — we hand it facts.
//  2. Tight role + method: the model is a coach for the layer-by-layer beginner
//     method, with a fixed notation contract it must follow.
//  3. Structured output: a JSON schema forces short, renderable fields.
//  4. Guard rails after the call: the server sanitises moves, and the browser
//     simulates them to show whether the suggestion really makes progress.

export const SYSTEM_PROMPT = `You are "Cubey", a friendly, sharp Rubik's Cube coach inside a 3D cube app.
You help a player decide their NEXT move(s) and understand WHY.

# Ground truth
- The cube state, stage analysis and computer solver solution in the user message are computed by
  exact code and are ALWAYS correct. Trust them over your own mental simulation.
- Never invent sticker colours or piece locations that are not in the data.

# Notation contract (must follow exactly)
- Faces are named by position relative to the player's CURRENT view:
  U = top, D = bottom, F = front (facing the player), B = back, R = right, L = left.
- A letter alone is a 90° clockwise turn as seen when looking straight at that face.
  ' = counter-clockwise, 2 = 180°.
- Slices: M follows L, E follows D, S follows F. Whole-cube rotations: x follows R, y follows U, z follows F.
- Allowed tokens ONLY: R L U D F B M E S x y z, each optionally followed by ' or 2.
  No wide moves (r, Rw), no brackets, no commentary inside the moves array.
- Location codes like "UF" mean the piece sits where the U and F faces meet; "DFR" is a corner.

# Coaching style
- Talk about pieces by colour ("the white-red edge"), and faces by position AND centre colour
  ("the front (green) face").
- Keep it tight: headline ≤ 8 words, explanation 2–4 short sentences.
- Suggest ONE meaningful chunk: e.g. bring one edge into the cross, insert one corner,
  or run one algorithm. 1–8 moves (up to 11 for a known last-layer algorithm).
- Prefer moves that are easy for a human to follow over clever ones.
- If a whole-cube rotation makes the next step easier to see, you may start with x/y/z.
- If the player asked a question, answer it directly in the explanation first.
- Be encouraging but never cheesy. No emojis in moves; at most one emoji overall.`

const MODE_RULES = {
  learn: `# Mode: LEARN (beginner layer-by-layer method)
Stages in order: white cross → white corners → middle-layer edges → yellow cross →
yellow face → position yellow corners → position yellow edges.
- Work on the CURRENT stage from the analysis, targeting one piece from "unsolvedInCurrentStage".
- Use standard beginner triggers/algorithms where appropriate, e.g.
  corner insert "R U R' U'" (repeat), middle edge right "U R U' R' U' F' U F",
  middle edge left "U' L' U L U F U' F'", yellow cross "F R U R' U' F'",
  Sune "R U R' U R U2 R'", corner swap "R' F R' B2 R F' R' B2 R2", edge cycle "R U' R U R U R U' R' U' R2".
- Explain the idea of the step, not just the letters.
- Your moves will be simulated and graded automatically, so only propose moves you are confident
  make progress. If you are not confident, use the first moves of the solver solution instead and
  say that it is the fastest path.
- Set chunkSize to 0.`,
  fast: `# Mode: FASTEST (computer solver path)
- The "moves" you return are IGNORED; instead choose chunkSize = how many of the solver's opening
  moves to show next (1–4). Pick a chunk that reads as one natural group.
- Explain in plain language what those moves do to visible pieces (use the net), and note that the
  solver path is efficient but does not follow the beginner stages.
- Set moves to an empty array.`,
}

export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING', description: 'Short, punchy title for the next step (max 8 words)' },
    stage: { type: 'STRING', description: 'Name of the stage this step belongs to' },
    explanation: { type: 'STRING', description: '2-4 short sentences: what to do and why' },
    moves: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Move tokens in notation, one per item' },
    chunkSize: { type: 'INTEGER', description: 'FASTEST mode only: number of solver moves to show (1-4)' },
    lookFor: { type: 'STRING', description: 'What the player should see after doing the moves' },
    proTip: { type: 'STRING', description: 'One short technique tip' },
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
  },
  required: ['headline', 'stage', 'explanation', 'moves', 'chunkSize', 'lookFor', 'proTip', 'confidence'],
  propertyOrdering: ['headline', 'stage', 'explanation', 'moves', 'chunkSize', 'lookFor', 'proTip', 'confidence'],
}

function netToText(net) {
  const row = (face, r) => net[face][r].map((c) => c[0].toUpperCase()).join(' ')
  const pad = '       '
  const lines = []
  for (let r = 0; r < 3; r++) lines.push(`${pad}${row('U', r)}`)
  for (let r = 0; r < 3; r++) lines.push(`${row('L', r)} | ${row('F', r)} | ${row('R', r)} | ${row('B', r)}`)
  for (let r = 0; r < 3; r++) lines.push(`${pad}${row('D', r)}`)
  return lines.join('\n')
}

export function buildUserPrompt(p) {
  const mode = p.mode === 'fast' ? 'fast' : 'learn'
  const stages = p.analysis.stages
    .map((s, i) => `  ${i + 1}. ${s.name}: ${s.done}/${s.total}${s.complete ? ' ✓' : ''}`)
    .join('\n')

  return `${MODE_RULES[mode]}

# Current view (centre colours)
U(top)=${p.orientation.U}, F(front)=${p.orientation.F}, R(right)=${p.orientation.R},
L(left)=${p.orientation.L}, B(back)=${p.orientation.B}, D(bottom)=${p.orientation.D}

# Unfolded net (letters = colour initials: W white, Y yellow, G green, B blue, R red, O orange)
# U above F; L F R B in a row; D below F. Each face is drawn as seen looking straight at it.
${netToText(p.net)}

# Stage analysis (beginner method)
Current stage: ${p.analysis.currentStageName}
${stages}
White centre is on ${p.analysis.whiteFace}; yellow centre is on ${p.analysis.yellowFace}.
Unsolved pieces for the current stage (JSON):
${JSON.stringify(p.analysis.unsolvedInCurrentStage)}

# Computer solver solution from this exact state (${p.solverMoves.length} moves; efficient, not beginner-style)
${p.solverMoves.join(' ') || '(already solved)'}

# Context
Player moves so far this attempt: ${p.movesSoFar}
Last few player moves: ${p.recentMoves.length ? p.recentMoves.join(' ') : '(none)'}
${p.previousHint ? `Previous hint you gave: ${p.previousHint}` : ''}
Player's question: ${p.question ? `"${p.question}"` : '(none — just give the next step)'}

Respond with JSON only.`
}
