/**
 * Put enough real data in the local stack that a screen means something.
 *
 *   node scripts/seed-local.mjs [--api http://127.0.0.1:5080] [--tracking http://localhost:5091]
 *
 * ## Why this exists
 *
 * `scripts/e2e.mjs` drives every screen against the real API, and a screen with no rows
 * renders its empty state and passes. That is a green run over a product nobody looked at:
 * the local database had four surveys with NO TITLE AT ALL, no templates, and zero action
 * plans, so most of the tracking and survey screens were being "verified" empty.
 *
 * It also cost two false findings. A survey that happened to be CLOSED answered 400 on
 * /respond, and one with no distribution answered 404 — both read as defects in the first
 * sweep and both were the state of the data.
 *
 * ## Through the API, never the database
 *
 * Every row here is created by the same endpoint the UI calls, so the data obeys the
 * product's own rules rather than a hand-written INSERT's idea of them. Writing straight to
 * Postgres is how a seed ends up with a shape the application can never produce — and then
 * the screens built on it are verified against a fiction.
 *
 * ## Idempotent
 *
 * Re-running must not pile up duplicates, because it WILL be re-run. Every plan carries a
 * marker in its description and existing ones are matched on it before anything is created.
 */
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://127.0.0.1:5080' },
    tracking: { type: 'string', default: 'http://localhost:5091' },
    email: { type: 'string', default: 'fede.admin@acme.test' },
    password: { type: 'string', default: 'Local1234!' },
  },
})

const API = values.api.replace(/\/$/, '')
const TRACKING = values.tracking.replace(/\/$/, '')

/** Marks a row as this script's, so a re-run updates rather than duplicates. */
const MARKER = '[seed-local]'

const log = (line) => process.stdout.write(`${line}\n`)

async function json(url, init = {}, token) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${url} -> ${response.status} ${body.slice(0, 200)}`)
  }
  return body ? JSON.parse(body) : null
}

/** `YYYY-MM-DD`, offset from today. The three semáforo states are driven by this. */
function day(offset) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return date.toISOString().slice(0, 10)
}

/**
 * One plan per semáforo state, so the summary strip shows three different numbers rather
 * than a column of zeros — the strip is the thing this repository has twice had to fix for
 * publishing readings nobody took, and a seed that makes every state identical would hide
 * a regression in exactly the component most likely to have one.
 */
const PLANS = [
  {
    key: 'atrasado',
    fechaCompromiso: day(-21),
    descripcionQue: `${MARKER} Reponer la reunión de handover entre turnos`,
    metodologiaComo: 'Sesión de 20 minutos al cierre de cada turno, con acta breve.',
  },
  {
    key: 'en-riesgo',
    fechaCompromiso: day(5),
    descripcionQue: `${MARKER} Publicar el rol de fines de semana con dos semanas de antelación`,
    metodologiaComo: 'Calendario compartido, actualizado los lunes por la jefatura del nodo.',
  },
  {
    key: 'al-dia',
    fechaCompromiso: day(60),
    descripcionQue: `${MARKER} Programa de reconocimiento entre pares`,
    metodologiaComo: 'Nominaciones mensuales, resultado comunicado en la reunión general.',
  },
]

async function main() {
  const { token } = await json(`${API}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email: values.email, password: values.password }),
  })
  const profile = await json(`${API}/profile`, {}, token)
  const companyId = profile.companyId
  if (!companyId) throw new Error(`${values.email} has no company; seed with a company_admin`)
  log(`seed: ${profile.name} (${profile.role}) on ${profile.companyName}`)

  // The pickers are the same source the create form uses, so a seeded plan points at a
  // nodo and a persona the UI can actually resolve and display.
  const { nodos } = await json(`${API}/tracking/picker/nodos?companyId=${companyId}`, {}, token)
  const { personas } = await json(`${API}/tracking/picker/personas?companyId=${companyId}`, {}, token)
  if (!nodos?.length || !personas?.length) throw new Error('no nodos or personas to point a plan at')
  log(`seed: ${nodos.length} nodos, ${personas.length} personas available`)

  const existing = await json(`${TRACKING}/api/planes-accion`, {}, token)
  const already = new Set(
    (Array.isArray(existing) ? existing : existing?.planes ?? [])
      .map((plan) => plan.descripcionQue)
      .filter((text) => typeof text === 'string' && text.includes(MARKER)),
  )

  let created = 0
  for (const [index, plan] of PLANS.entries()) {
    if (already.has(plan.descripcionQue)) {
      log(`seed: plan already present (${plan.key})`)
      continue
    }
    // Spread across nodos so the consolidado has more than one row.
    const nodo = nodos[index % nodos.length]
    const persona = personas[index % personas.length]
    await json(`${TRACKING}/api/planes-accion`, {
      method: 'POST',
      body: JSON.stringify({
        nodoExternalId: nodo.id,
        descripcionQue: plan.descripcionQue,
        metodologiaComo: plan.metodologiaComo,
        responsableEjecucionExternalId: persona.id,
        fechaCompromiso: plan.fechaCompromiso,
        involucrados: [persona.id],
      }),
    }, token)
    created += 1
    log(`seed: created ${plan.key} on ${nodo.name} for ${persona.name}`)
  }

  const after = await json(`${TRACKING}/api/planes-accion`, {}, token)
  const total = (Array.isArray(after) ? after : after?.planes ?? []).length
  log(`\nseed: ${created} created, ${total} plans now visible to the tracking module.`)
}

await main()
