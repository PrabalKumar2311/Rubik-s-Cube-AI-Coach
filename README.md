# Rubik's Cube — React Three Fiber

A fully interactive 3×3 Rubik's Cube built with React, `@react-three/fiber` and `@react-three/drei`.

## Run it

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

## AI Coach (Gemini)

1. Copy `.env.example` to `.env` and add your key (get one at https://aistudio.google.com/apikey):
   ```
   GEMINI_API_KEY=your_key_here
   # GEMINI_MODEL=gemini-3.8-flash   (optional override)
   ```
2. Restart `npm run dev`, then click **✦ AI Coach** (or press `H`).

- **Learn** mode coaches you through the beginner layer-by-layer method, one step at a time.
- **Fastest** mode shows the next few moves of a computer solver path, with Gemini explaining them.
- **Show me / Step** animate the suggested moves on the 3D cube.
- Every AI suggestion is **simulated locally** before you run it. The badge tells you whether it really makes progress, so a wrong LLM answer can't silently mislead you.
- Ask follow-up questions in the box at the bottom.
- With no key (or if Gemini is down) the coach falls back to solver-only hints.

### How the AI part works

| File | Role |
| --- | --- |
| `src/ai/cubeState.js` | Exports the cube as an unfolded net + Kociemba string, detects the beginner-method stage, lists unsolved pieces, simulates moves |
| `src/ai/solver.worker.js` | Runs the `cubejs` Kociemba solver (plus an exact short search for nearly-solved cubes) in a Web Worker |
| `server/prompt.js` | The prompt engineering: system role, notation contract, per-mode rules, JSON response schema, and a user prompt built from verified facts |
| `server/geminiPlugin.js` | `POST /api/hint` inside the Vite dev/preview server. Calls Gemini with structured JSON output and sanitises the reply |
| `src/ai/AICoach.jsx` | The coach panel UI, verification and playback |

LLMs are unreliable at picturing a cube in their head, so the prompt never asks Gemini to work out the state. The code hands it exact facts (net, stage analysis, unsolved pieces, a solver solution), and the browser checks whatever it suggests.

**Key safety:** the key stays on the server side (the Vite middleware) and is never bundled into the browser code. `/api/hint` only exists while `npm run dev` or `npm run preview` is running. To deploy on static hosting, move `server/geminiPlugin.js`'s handler into a serverless function (Vercel/Netlify/Cloudflare) at the same path.

Run `npm run test:logic` to check the cube model against `cubejs`.

## Controls

| Action | How |
| --- | --- |
| Turn a layer | Drag on any sticker. The layer follows your pointer; release to snap (flick for a fast turn). Dragging a centre sticker turns the middle slice, like a real cube. |
| Orbit camera | Drag the background, or right-drag anywhere |
| Zoom | Scroll / pinch |
| Face turns | `R L U D F B` (hold `Shift` for prime / counter-clockwise) |
| Slice turns | `M E S` |
| Whole cube | `X Y Z` |
| Scramble | `Space` or the button |
| Undo | `Ctrl/⌘+Z`, `Backspace`, or the button |
| AI Coach | `H` or the ✦ button |

**Solve** rewinds every move since the last reset. After a scramble, the timer starts on your first move and stops when the cube is solved.

## How it works

- `src/cubeLogic.js` — pure cube state: 27 cubies, each with an integer position and an orientation quaternion. Turns are "baked" by rotating and snapping to exact values, so no floating-point drift builds up.
- `src/Cube.jsx` — rendering, animation and input. A turning layer is animated by applying a temporary rotation to its members each frame (no scene-graph re-parenting). Drags are projected onto the plane of the touched face; the dominant drag direction picks the turn axis (`faceNormal × dragDirection`), and the pointer distance drives the angle directly.
- `src/App.jsx` — canvas, lighting, orbit controls, HUD and keyboard shortcuts.
