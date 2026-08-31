/**
 * The survey half of the local seed: enough closed waves that a comparison screen has
 * something to compare.
 *
 *   node scripts/seed-surveys.mjs [--api http://127.0.0.1:5080]
 *
 * ## Why this exists
 *
 * `seed-local.mjs` fills the tracking module. This fills the climate side, and it exists
 * because `/surveys/climate-trends` shipped against a database holding exactly ONE closed
 * survey. A climate-over-time matrix with one row is not a wrong screen, it is an
 * unreviewable one — every property worth checking (a dimension appearing between waves,
 * a department crossing the floor in one wave and not the next, the colour scale spanning
 * a real spread) needs at least three.
 *
 * It also creates the OPEN survey the local stack has never had, which is what makes
 * `/surveys/:id/respond` and the distribution screens answer with something, plus the two
 * things that hang off it: a DISTRIBUTION for that survey and a survey TEMPLATE. Without
 * those, `/surveys/:surveyId/distribution` answers 404 and `/surveys/templates` and the
 * template step of `/surveys/new` render an empty list -- and the 404 has already been
 * filed once as a defect when it was the state of the data.
 *
 * ## What it does NOT do: rewrite the titles
 *
 * An earlier note said the four existing surveys had NULL titles and that this was why
 * survey screens looked broken. Measured on 2026-08-27: all four resolve a title. The real
 * gap was different and this script fixes that one instead — the three drafts have a single
 * question each with `category: null`, and category IS the dimension, so no amount of
 * responses would ever have produced a score. Verify before repeating a note.
 *
 * ## Through the API, never the database
 *
 * Same rule as `seed-local.mjs`: every row is created by the endpoint the UI calls, so the
 * data obeys the product's rules rather than an INSERT's idea of them.
 *
 * ## The four constraints that decide whether anything renders
 *
 * 1. **`Question.Category` IS the dimension.** A question with no category contributes to
 *    no dimension, so an uncategorised survey aggregates to an empty climate map however
 *    many people answer it.
 * 2. **A response only carries a department if the respondent is AUTHENTICATED.** An
 *    anonymous submission resolves to no user and no department, so the whole department
 *    breakdown comes back empty. Every respondent here logs in as themselves — which is
 *    the reason this script is slow, see the pacing note below.
 * 3. **Two floors, both 5.** A segment is suppressed at READ time when its respondent
 *    count is under `SurveyResultsPrivacy.MinimumSegmentRespondents`. Finance is given
 *    THREE respondents on purpose, in every wave, so the protected-cell path is exercised
 *    by real data rather than only by a fixture.
 * 4. **Bulk-imported users have random passwords.** `POST /auth/admin/reset-credentials`
 *    takes `{userId}` and RETURNS `{email, temporaryPassword}`, so this resets and then
 *    signs in. It genuinely changes those users' passwords; they were random and unknown
 *    beforehand, so nothing is lost, but it is a real mutation and is logged.
 *
 * ## Pacing, which is not optional
 *
 * Two rate limits apply and the tighter one is easy to miss:
 *
 * - `POST /auth/login` — **20 per minute per IP** (`RateLimitPolicies.Authentication`).
 * - `POST /surveys/{id}/responses` — 60 per minute per IP.
 *
 * Twenty-four respondents therefore cannot simply be logged in in a loop; the 21st is
 * refused. Each user is signed in ONCE and their token reused for every wave, with a
 * deliberate gap between logins. That makes a full run take a couple of minutes, and a
 * seed that takes two minutes and works beats one that takes ten seconds and silently
 * seeds four departments out of five.
 *
 * ## Idempotent
 *
 * Waves are matched by title before anything is created, because this WILL be re-run. So
 * is the open survey; the distribution is matched by asking for it (a 404 means none) and
 * the template by name. A second run reports `0 created` and changes nothing.
 *
 * The respondent sign-in loop is skipped entirely when no wave is missing, so that second
 * run takes seconds rather than two minutes -- and, more to the point, a stack that
 * already had the waves used to return before reaching the open survey at all.
 */
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://127.0.0.1:5080' },
    email: { type: 'string', default: 'fede.admin@acme.test' },
    password: { type: 'string', default: 'Local1234!' },
    /** Seconds between logins. 3.1s keeps 24 sign-ins under the 20/min auth ceiling. */
    loginGap: { type: 'string', default: '3.1' },
    /** Seconds between response submissions, under the 60/min respond ceiling. */
    submitGap: { type: 'string', default: '1.1' },
  },
})

const API = values.api.replace(/\/$/, '')
const LOGIN_GAP = Number(values.loginGap) * 1000
const SUBMIT_GAP = Number(values.submitGap) * 1000

const log = (line) => process.stdout.write(`${line}\n`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
    throw new Error(`${init.method ?? 'GET'} ${url} -> ${response.status} ${body.slice(0, 300)}`)
  }
  return body ? JSON.parse(body) : null
}

/**
 * `json`, except a 404 is an answer rather than a failure.
 *
 * `GET /surveys/{id}/distribution` answers 404 when the survey has none, and that is
 * exactly the question this script needs to ask before creating one. Everything else still
 * throws, so a 403 or a 500 stays as loud as it was.
 */
async function tryJson(url, init = {}, token) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  if (response.status === 404) return null
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${url} -> ${response.status} ${body.slice(0, 300)}`)
  }
  return body ? JSON.parse(body) : null
}

/** ISO date, offset in days from today. */
function day(offset) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return date.toISOString()
}

// ---------------------------------------------------------------------------
// The instrument
// ---------------------------------------------------------------------------

/**
 * The design's six dimensions, as `category` keys.
 *
 * Raw keys, never display names: the climate map, the standings table and the respond
 * page's sections all group on this string, and a translated one would split a dimension
 * in two the first time someone read the page in the other language.
 */
const QUESTIONS = [
  ['psychological_safety', 'I feel safe raising concerns without fear of blame.', 'Puedo plantear preocupaciones sin miedo a represalias.'],
  ['workload', 'My workload is sustainable over the long term.', 'Mi carga de trabajo es sostenible a largo plazo.'],
  ['trust', 'I trust the decisions leadership makes.', 'Confío en las decisiones que toma la dirección.'],
  ['recognition', 'Good work here is noticed and acknowledged.', 'Aquí se reconoce el buen trabajo.'],
  ['growth', 'I can see a path to grow in this organisation.', 'Veo un camino para crecer en esta organización.'],
  ['belonging', 'I feel I belong on my team.', 'Siento que pertenezco a mi equipo.'],
]

/**
 * The waves, oldest first. Q3 already exists in the local database and is deliberately not
 * recreated — this fills in the two before it so the matrix has three columns.
 *
 * `drift` shifts every department's answers for that wave. Q1 is the worst and Q2 sits
 * between, so the series has a direction a reader can actually see; without that the three
 * columns would be noise and the screen would look broken while being correct.
 */
const WAVES = [
  { title: 'Q1 Climate Survey', endOffset: -210, drift: -0.6 },
  { title: 'Q2 Climate Survey', endOffset: -120, drift: -0.3 },
]

/**
 * Per-department answer profile: a base score per dimension, in the same order as
 * `QUESTIONS`.
 *
 * Operations is deliberately the worst on workload and psychological safety, so one cell
 * rings red and "where to look first" has something true to point at. Engineering is the
 * best. These are the same relative positions the existing Q3 wave has, so the three
 * columns tell one story rather than three unrelated ones.
 *
 * `respondents` is how many of that department's members answer. Finance is THREE, under
 * the floor of 5, in every wave — that is the protected row, and it is the reason this
 * seed is worth more than a fixture.
 */
const DEPARTMENTS = [
  { name: 'Engineering', respondents: 6, base: [4.2, 3.6, 4.0, 3.3, 4.1, 4.3] },
  { name: 'Finance', respondents: 3, base: [3.6, 3.2, 3.4, 3.0, 3.5, 3.7] },
  { name: 'Operations', respondents: 5, base: [2.6, 2.4, 2.9, 2.8, 3.0, 3.2] },
  { name: 'People', respondents: 5, base: [4.4, 3.9, 4.0, 3.6, 4.2, 4.4] },
  { name: 'Sales', respondents: 5, base: [3.9, 3.3, 3.7, 3.5, 3.8, 4.0] },
]

/**
 * A 1-5 answer for one respondent, deterministic in every input.
 *
 * Deterministic rather than random so two runs of this script produce the same numbers and
 * a screenshot diff means something. The per-respondent spread is what stops a department
 * answering as one voice, which would make every distribution a single bar.
 */
function answerFor(base, drift, respondentIndex, questionIndex) {
  const spread = ((respondentIndex * 7 + questionIndex * 3) % 5) - 2 // -2..2
  const value = base + drift + spread * 0.4
  return String(Math.max(1, Math.min(5, Math.round(value))))
}

// ---------------------------------------------------------------------------

async function main() {
  const { token: adminToken } = await json(`${API}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email: values.email, password: values.password }),
  })
  const profile = await json(`${API}/profile`, {}, adminToken)
  const companyId = profile.companyId
  if (!companyId) throw new Error(`${values.email} has no company; seed with a company_admin`)
  log(`seed-surveys: ${profile.name} (${profile.role}) on ${profile.companyName}`)

  const { departments } = await json(`${API}/admin/departments?companyId=${companyId}`, {}, adminToken)
  const { users } = await json(`${API}/admin/users?companyId=${companyId}`, {}, adminToken)
  const byName = new Map(departments.map((d) => [d.name, d]))

  // Who answers, decided once and reused for every wave: the same people answering each
  // time is what makes a series a series rather than five unrelated samples.
  const roster = []
  for (const spec of DEPARTMENTS) {
    const department = byName.get(spec.name)
    if (!department) throw new Error(`no department named ${spec.name}`)
    // Employees only, and never a `fede.*` account.
    //
    // Both halves matter. This script RESETS each respondent's password in order to sign
    // in as them, and the five `fede.*` accounts are the ones `web/scripts/e2e.mjs` signs
    // in with using a known password -- resetting one would break the end-to-end harness
    // in a way that looks like an auth regression. Engineering is where they live, so an
    // unfiltered "first N members of this department" would have taken them.
    //
    // Restricting to `employee` also keeps the leader and supervisor surfaces honest:
    // their dashboards read their own team, and a leader who answered their own survey
    // would make that reading partly about themselves.
    const members = users
      .filter(
        (u) =>
          u.isActive &&
          u.departmentId === department.id &&
          u.role === 'employee' &&
          !u.email.startsWith('fede.'),
      )
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, spec.respondents)
    if (members.length < spec.respondents) {
      throw new Error(`${spec.name} has ${members.length} active members, need ${spec.respondents}`)
    }
    roster.push({ spec, department, members })
    log(`seed-surveys: ${spec.name} -> ${members.length} respondents${spec.respondents < 5 ? ' (under the floor, will be protected)' : ''}`)
  }

  const existing = await json(`${API}/surveys`, {}, adminToken)
  // A Map, not a Set: the open survey's ID is needed on a RE-RUN too, because its
  // distribution is checked every time rather than only on the run that created it.
  const have = new Map((existing.surveys ?? []).map((s) => [s.title, s]))

  const wanted = WAVES.filter((w) => !have.has(w.title))
  const needOpen = !have.has(OPEN_SURVEY.title)

  // Sign in as each respondent ONCE, paced under the 20/min auth ceiling, and reuse the
  // token for every wave. This is the slow part and it is deliberate -- see the header.
  //
  // Skipped entirely when no wave is missing. Respondent tokens exist only to ANSWER a
  // wave; the open survey, its distribution and the template are admin-only writes. Before
  // this the script returned early instead, which is why a stack that had the waves could
  // never acquire the two things below.
  const tokens = new Map()
  if (wanted.length > 0) {
    const total = roster.reduce((n, r) => n + r.members.length, 0)
    log(`seed-surveys: signing in ${total} respondents, ~${Math.round((total * LOGIN_GAP) / 1000)}s (auth is 20/min)`)
    let signedIn = 0
    for (const { members } of roster) {
      for (const member of members) {
        const { temporaryPassword } = await json(`${API}/auth/admin/reset-credentials`, {
          method: 'POST',
          body: JSON.stringify({ userId: member.id }),
        }, adminToken)
        const { token } = await json(`${API}/auth/login`, {
          method: 'POST',
          body: JSON.stringify({ email: member.email, password: temporaryPassword }),
        })
        tokens.set(member.id, token)
        signedIn += 1
        if (signedIn % 6 === 0) log(`seed-surveys:   ${signedIn}/${total} signed in`)
        await sleep(LOGIN_GAP)
      }
    }
  }

  let created = 0

  for (const wave of wanted) {
    await seedWave(adminToken, companyId, wave, roster, tokens)
    created += 1
  }

  // The open survey, then the two things that hang off it. `openSurvey` is resolved from
  // the listing on a re-run so the distribution check has an id to ask about.
  let openSurvey = have.get(OPEN_SURVEY.title) ?? null
  if (needOpen) {
    openSurvey = await seedOpenSurvey(adminToken, companyId, roster)
    created += 1
  }

  if (await seedDistribution(adminToken, openSurvey)) created += 1
  if (await seedTemplate(adminToken, companyId)) created += 1

  log(`\nseed-surveys: done, ${created} created.`)
  if (created === 0) log('seed-surveys: everything already existed; nothing was changed.')
}

/** One closed wave: draft -> active -> responses -> closed. */
async function seedWave(adminToken, companyId, wave, roster, tokens) {
  log(`\nseed-surveys: creating ${wave.title}`)
  const survey = await json(`${API}/surveys`, {
    method: 'POST',
    body: JSON.stringify({
      title: { en: wave.title, es: wave.title.replace('Climate Survey', 'Encuesta de Clima') },
      companyId,
      type: 'periodic',
      language: 'both',
      startDate: day(wave.endOffset - 21),
      endDate: day(wave.endOffset),
      description: {
        en: 'How the organisation felt this quarter, across six dimensions.',
        es: 'Cómo se sintió la organización este trimestre, en seis dimensiones.',
      },
      // Not anonymous: an anonymous survey strips the department at WRITE time for small
      // departments, and the department breakdown is the whole point of this seed.
      settings: { anonymous: false, allowPartialResponses: true, showProgress: true },
      questions: QUESTIONS.map(([category, en, es], order) => ({
        text: { en, es },
        type: 'likert',
        category,
        scaleMin: 1,
        scaleMax: 5,
        scaleLabelMin: { en: 'Strongly disagree', es: 'Muy en desacuerdo' },
        scaleLabelMax: { en: 'Strongly agree', es: 'Muy de acuerdo' },
        required: true,
        order,
      })),
    }),
  }, adminToken)

  // Responses are accepted on STATUS alone, so a past endDate does not block them --
  // which is what lets this seed backdate a wave and still fill it.
  await json(`${API}/surveys/${survey.id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'active' }),
  }, adminToken)

  const questionIds = survey.questions.map((q) => q.id)
  let submitted = 0
  for (const { spec, members } of roster) {
    for (const [index, member] of members.entries()) {
      await json(`${API}/surveys/${survey.id}/responses`, {
        method: 'POST',
        body: JSON.stringify({
          isComplete: true,
          language: 'en',
          answers: questionIds.map((questionId, q) => ({
            questionId,
            value: answerFor(spec.base[q], wave.drift, index, q),
            timeSpentSeconds: 20 + ((index + q) % 25),
          })),
        }),
      }, tokens.get(member.id))
      submitted += 1
      await sleep(SUBMIT_GAP)
    }
  }

  await json(`${API}/surveys/${survey.id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'closed' }),
  }, adminToken)
  log(`seed-surveys: ${wave.title} closed with ${submitted} responses`)
}

/**
 * The open survey the local stack has never had.
 *
 * Left ACTIVE with no responses: `/surveys/:id/respond` needs a survey that is accepting
 * answers, and two findings in an earlier sweep were a closed survey answering 400 there
 * and an undistributed one answering 404 — both the state of the data rather than defects.
 */
const OPEN_SURVEY = { title: 'Q4 Climate Survey (open)' }

async function seedOpenSurvey(adminToken, companyId, roster) {
  log(`\nseed-surveys: creating ${OPEN_SURVEY.title}`)
  const survey = await json(`${API}/surveys`, {
    method: 'POST',
    body: JSON.stringify({
      title: { en: OPEN_SURVEY.title, es: 'Encuesta de Clima Q4 (abierta)' },
      companyId,
      type: 'periodic',
      language: 'both',
      startDate: day(-7),
      endDate: day(30),
      description: {
        en: 'Open for responses. Seeded so the respond and distribution screens have a live survey.',
        es: 'Abierta a respuestas. Sembrada para que las pantallas de respuesta y distribución tengan una encuesta viva.',
      },
      settings: { anonymous: false, allowPartialResponses: true, showProgress: true },
      departmentIds: roster.map((r) => r.department.id),
      targetAudienceCount: roster.reduce((n, r) => n + r.members.length, 0),
      questions: QUESTIONS.map(([category, en, es], order) => ({
        text: { en, es },
        type: 'likert',
        category,
        scaleMin: 1,
        scaleMax: 5,
        scaleLabelMin: { en: 'Strongly disagree', es: 'Muy en desacuerdo' },
        scaleLabelMax: { en: 'Strongly agree', es: 'Muy de acuerdo' },
        required: true,
        order,
      })),
    }),
  }, adminToken)

  await json(`${API}/surveys/${survey.id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'active' }),
  }, adminToken)
  log(`seed-surveys: ${OPEN_SURVEY.title} is ACTIVE at /surveys/${survey.id}`)
  return survey
}

/**
 * The open survey's distribution.
 *
 * `/surveys/:id/distribution` answered 404 on every local stack this repository has ever
 * had, and that 404 was once filed as a defect. It was the state of the data: a survey has
 * no distribution until an admin creates one, and nothing here ever did.
 *
 * `accessType: 'public'` rather than the `tokenized` DDL default, because tokenized mints
 * no `publicLink` and the screen's share-link block, its QR panel and the regenerate/revoke
 * affordances are then all unreachable — the larger half of the screen, invisible.
 *
 * ## What this deliberately does NOT do: invite anybody
 *
 * `POST /surveys/{id}/invitations` is what fills the summary strip, and it QUEUES MAIL.
 * A seed that mails an entire seeded company the first time someone runs it is a seed
 * nobody can run twice, so the invitation counts stay at zero and the strip is
 * photographed in its real "distributed, nobody invited yet" state. Invite from the UI
 * when that is the state you want.
 *
 * Returns true when it created one.
 */
async function seedDistribution(adminToken, survey) {
  if (!survey) {
    log('seed-surveys: no open survey to distribute; skipping the distribution.')
    return false
  }
  const current = await tryJson(`${API}/surveys/${survey.id}/distribution`, {}, adminToken)
  if (current) {
    log(`seed-surveys: ${OPEN_SURVEY.title} already has a distribution (${current.accessType}).`)
    return false
  }

  const distribution = await json(`${API}/surveys/${survey.id}/distribution`, {
    method: 'PUT',
    body: JSON.stringify({
      accessType: 'public',
      accessRules: {
        // Login required and anonymous OFF for the same reason the waves are not
        // anonymous: a response only carries a department when its author is
        // authenticated, and the department breakdown is what these screens are for.
        requireLogin: true,
        allowAnonymous: false,
        singleResponse: true,
        activeOutsideSchedule: false,
      },
      qrCustomization: {
        foregroundColor: '#1F2544',
        backgroundColor: '#FFFFFF',
        size: 256,
      },
    }),
  }, adminToken)

  log(`seed-surveys: distribution created, accessType=${distribution.accessType}, link=${distribution.publicLink ?? 'none'}`)
  return true
}

/**
 * One survey template, so `/surveys/templates` and `/surveys/new` are not empty.
 *
 * Scoped to the company rather than global: `CanWriteTemplate` refuses a company_admin who
 * omits `companyId`, and this script is documented to run as one. A global template would
 * also be visible to every other tenant on a shared stack, which a local seed has no
 * business creating.
 *
 * The questions are the same six dimensions the waves ask, so a survey created FROM this
 * template aggregates into the same climate map as the seeded history rather than into a
 * seventh, empty set of dimensions.
 *
 * Matched by name before anything is created. Returns true when it created one.
 */
const TEMPLATE_NAME = 'Standard climate instrument (seeded)'

async function seedTemplate(adminToken, companyId) {
  const { templates } = await json(`${API}/survey-templates?companyId=${companyId}`, {}, adminToken)
  if ((templates ?? []).some((template) => template.name === TEMPLATE_NAME)) {
    log(`seed-surveys: template "${TEMPLATE_NAME}" already exists.`)
    return false
  }

  const template = await json(`${API}/survey-templates`, {
    method: 'POST',
    body: JSON.stringify({
      name: TEMPLATE_NAME,
      description: 'The six-dimension climate instrument the seeded waves use. Start here.',
      category: 'climate',
      companyId,
      industry: 'Logistics',
      companySize: '100-500',
      isPublic: true,
      tags: ['climate', 'seeded'],
      // `language` is deliberately omitted. It exists only to attribute BARE strings to a
      // column, and every string below is already locale-keyed, so declaring one could
      // only ever contradict the content.
      questions: QUESTIONS.map(([category, en, es], order) => ({
        text: { en, es },
        type: 'likert',
        category,
        scaleMin: 1,
        scaleMax: 5,
        scaleLabelMin: { en: 'Strongly disagree', es: 'Muy en desacuerdo' },
        scaleLabelMax: { en: 'Strongly agree', es: 'Muy de acuerdo' },
        required: true,
        commentRequired: false,
        order,
      })),
    }),
  }, adminToken)

  log(`seed-surveys: template created at /surveys/templates/${template.id} (${template.questions?.length ?? 0} questions)`)
  return true
}

await main()
