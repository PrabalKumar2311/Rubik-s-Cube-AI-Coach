import { loadEnv } from 'vite'
import { RESPONSE_SCHEMA, SYSTEM_PROMPT, buildUserPrompt } from './prompt.js'

// Serves POST /api/hint from the Vite dev & preview servers.
// The Gemini key is read server-side from .env (GEMINI_API_KEY) and never reaches the browser.

const MOVE_TOKEN = /^[RLUDFBMESxyz](2|'|2')?$/
const FALLBACK_MODEL = 'gemini-flash-latest'

function readBody(req, limit = 200_000) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > limit) reject(new Error('Body too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function parseModelJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')
  return JSON.parse(cleaned)
}

async function callGemini({ apiKey, model, payload }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45_000)
  try {
    const r = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildUserPrompt(payload) }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    })
    const data = await r.json().catch(() => ({}))
    return { ok: r.ok, status: r.status, data }
  } finally {
    clearTimeout(timer)
  }
}

export default function geminiHintPlugin() {
  let env = {}

  const handler = async (req, res, next) => {
    if (!req.url?.startsWith('/api/hint')) return next()
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' })

    const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY
    if (!apiKey) {
      return send(res, 400, {
        error: 'missing_key',
        message: 'Add GEMINI_API_KEY to a .env file in the project root, then restart the dev server.',
      })
    }

    let payload
    try {
      payload = JSON.parse(await readBody(req))
      if (!payload?.net || !payload?.analysis || !Array.isArray(payload.solverMoves)) throw new Error('bad payload')
      payload.question = String(payload.question || '').slice(0, 400)
      payload.previousHint = String(payload.previousHint || '').slice(0, 300)
      payload.recentMoves = (payload.recentMoves || []).filter((m) => MOVE_TOKEN.test(m)).slice(-12)
      payload.movesSoFar = Number(payload.movesSoFar) || 0
    } catch {
      return send(res, 400, { error: 'bad_request', message: 'Invalid request body.' })
    }

    const preferred = env.GEMINI_MODEL || process.env.GEMINI_MODEL || 'gemini-3.8-flash'
    try {
      let model = preferred
      let result = await callGemini({ apiKey, model, payload })
      if (result.status === 404 && model !== FALLBACK_MODEL) {
        model = FALLBACK_MODEL
        result = await callGemini({ apiKey, model, payload })
      }
      if (!result.ok) {
        const msg = result.data?.error?.message || `Gemini returned HTTP ${result.status}`
        return send(res, 502, { error: 'gemini_error', message: msg })
      }

      const text = (result.data?.candidates?.[0]?.content?.parts || [])
        .filter((p) => !p.thought)
        .map((p) => p.text || '')
        .join('')
      if (!text) return send(res, 502, { error: 'empty', message: 'Gemini returned no content (possibly blocked).' })

      const raw = parseModelJson(text)
      const hint = {
        headline: String(raw.headline || 'Next step').slice(0, 80),
        stage: String(raw.stage || payload.analysis.currentStageName).slice(0, 60),
        explanation: String(raw.explanation || '').slice(0, 900),
        lookFor: String(raw.lookFor || '').slice(0, 300),
        proTip: String(raw.proTip || '').slice(0, 300),
        confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'medium',
        source: 'ai',
        moves: [],
      }

      if (payload.mode === 'fast') {
        const n = Math.min(4, Math.max(1, Number(raw.chunkSize) || 2))
        hint.moves = payload.solverMoves.slice(0, n)
        hint.source = 'solver'
      } else {
        hint.moves = (Array.isArray(raw.moves) ? raw.moves : String(raw.moves || '').split(/\s+/))
          .map((m) => String(m).trim().replace('’', "'"))
          .filter((m) => MOVE_TOKEN.test(m))
          .slice(0, 12)
      }

      return send(res, 200, { hint, model })
    } catch (err) {
      const aborted = err?.name === 'AbortError'
      return send(res, 502, {
        error: aborted ? 'timeout' : 'server_error',
        message: aborted ? 'Gemini took too long to respond.' : String(err?.message || err),
      })
    }
  }

  return {
    name: 'gemini-hint-api',
    configResolved(config) {
      env = loadEnv(config.mode, config.root, '')
    },
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}
