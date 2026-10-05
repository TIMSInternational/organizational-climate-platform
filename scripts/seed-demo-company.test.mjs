import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PROFILES, profileFor, personAt } from './seed-demo-company.mjs'
import { DEPARTMENT_SPECS } from './seed-surveys.mjs'

/**
 * The demo profiles, and the two scripts' agreement with each other.
 *
 * These are not style checks. `seed-demo-company.mjs` creates the departments and the people;
 * `seed-surveys.mjs` then looks those departments up **by name** and **throws** when one is
 * missing or short of members. A disagreement between the two therefore fails a seeding run
 * half-way through, after a company, five departments and three dozen signups already exist in
 * whatever environment it was pointed at — which, for a demo built in production the day
 * before it is shown, is the expensive moment to find out.
 */

const names = (profile) => profile.departments.map(([name]) => name)

for (const [key, profile] of Object.entries(PROFILES)) {
  /**
   * The write-time floor, which is the one that cannot be recovered from later.
   * `SurveyResponsePrivacy.DepartmentFor` drops the department from a response unless the
   * department's POPULATION is at least 5, so a department seeded with 4 people can never
   * disclose however many of them answer. TIMS's own survey is the worked example: 15 people
   * in 6 departments, largest 4, and every department breakdown permanently empty.
   */
  test(`${key}: every department holds at least 5 people`, () => {
    for (const [name, count] of Object.entries(profile.headcount)) {
      assert.ok(count >= 5, `${name} has ${count}, under the floor of 5`)
    }
  })

  test(`${key}: headcount covers exactly the departments it declares`, () => {
    assert.deepEqual(Object.keys(profile.headcount).sort(), names(profile).sort())
  })

  test(`${key}: every leader and the demo employee sit in a department that exists`, () => {
    for (const [, , , department] of profile.leaders) {
      assert.ok(names(profile).includes(department), `leader in unknown department ${department}`)
    }
    assert.ok(names(profile).includes(profile.demoEmployee[3]), 'demo employee in an unknown department')
  })

  test(`${key}: every action plan names a real department, or the whole company`, () => {
    for (const [title, , department] of profile.plans) {
      if (department === null) continue
      assert.ok(names(profile).includes(department), `plan "${title}" names unknown department ${department}`)
    }
  })

  /** One signup per address: a collision would silently seed fewer people than intended. */
  test(`${key}: no two people share an email local part`, () => {
    const locals = [profile.admin[1], ...profile.leaders.map((p) => p[1]), profile.demoEmployee[1]]
    assert.equal(new Set(locals).size, locals.length)
  })

  test(`${key}: has a survey spec profile of the same name`, () => {
    assert.ok(DEPARTMENT_SPECS[key], `no DEPARTMENT_SPECS["${key}"] in seed-surveys.mjs`)
  })

  /**
   * The cross-script contract, in both directions. `seed-surveys.mjs` resolves each spec with
   * `spec.names.map((n) => byName.get(n)).find(Boolean)` and throws `no department named …`;
   * it then slices `respondents` members from that department's **employees only** — leaders
   * and supervisors are excluded deliberately — and throws `… has N active members, need M`.
   */
  test(`${key}: every survey spec resolves to a seeded department`, () => {
    for (const spec of DEPARTMENT_SPECS[key]) {
      const matched = spec.names.filter((name) => names(profile).includes(name))
      assert.ok(matched.length > 0, `spec "${spec.name}" matches no department of ${key}`)
    }
  })

  test(`${key}: no spec asks for more respondents than its department has employees`, () => {
    for (const spec of DEPARTMENT_SPECS[key]) {
      const name = spec.names.find((n) => names(profile).includes(n))
      if (!name) continue
      const employees = profile.headcount[name]
      assert.ok(
        spec.respondents <= employees,
        `${spec.name} wants ${spec.respondents} respondents from ${employees} employees`,
      )
    }
  })
}

test('an unknown profile is refused by name, not by returning undefined', () => {
  assert.throws(() => profileFor('nope'), /unknown --profile nope/)
  assert.ok(profileFor('meridiano'))
})

/**
 * Meridiano is the tenant every screenshot, runbook and demo script in this repository already
 * names, so adding a profile must not have moved it.
 */
test('meridiano is unchanged: the company, the five departments and the 33 employees', () => {
  const m = PROFILES.meridiano
  assert.equal(m.company.name, 'Grupo Meridiano S.A.')
  assert.equal(m.domain, 'meridiano.test')
  assert.equal(m.admin[1], 'ana.rojas')
  assert.deepEqual(names(m), ['Ingeniería', 'Finanzas', 'Operaciones', 'Personas', 'Ventas'])
  assert.equal(Object.values(m.headcount).reduce((a, b) => a + b, 0), 33)
  assert.equal(m.demoEmployee[1], 'diego.solano')
})

/** Meridiano keeps its protected row; it is the reason that seed is worth more than a fixture. */
test('meridiano still protects Finance, below the floor in every wave', () => {
  const finance = DEPARTMENT_SPECS.meridiano.find((d) => d.name === 'Finance')
  assert.equal(finance.respondents, 3)
})

/**
 * Procomer's demo exists to show a COMPLETED cycle whose results are all readable. Two things
 * have to hold for that, and only the first is obvious:
 *
 * 1. every department answers at or above the floor, so each one discloses; and
 * 2. because every department discloses, the remainder `SurveyAggregation.WithholdComplement`
 *    measures is 0 — nothing is left over to be withheld, so no disclosed segment is pulled
 *    back. A single department under the floor would strand its respondents in that remainder
 *    and, if it landed between 1 and 4, would withhold the smallest disclosing department too.
 */
test('procomer: every department discloses, and the complement is zero', () => {
  const specs = DEPARTMENT_SPECS.procomer
  for (const spec of specs) {
    assert.ok(spec.respondents >= 5, `${spec.name} answers ${spec.respondents}, under the floor`)
  }
  const total = specs.reduce((n, s) => n + s.respondents, 0)
  const disclosed = specs.filter((s) => s.respondents >= 5).reduce((n, s) => n + s.respondents, 0)
  assert.equal(total - disclosed, 0)
})

/** A demo in which literally everyone answered reads as fabricated. */
test('procomer: the response rate is high but not total', () => {
  const people = Object.values(PROFILES.procomer.headcount).reduce((a, b) => a + b, 0)
  const answering = DEPARTMENT_SPECS.procomer.reduce((n, s) => n + s.respondents, 0)
  assert.ok(answering < people, 'every single person answered')
  assert.ok(answering / people > 0.75, `only ${answering} of ${people} answered`)
})

/**
 * The seeded story has to be one story: the weakest department is the one the seeded action
 * plan addresses. Six base scores per department; the lowest mean is Ventanilla Única, which
 * "Equilibrar la carga en Ventanilla Única" then answers.
 */
test('procomer: the weakest department is the one the action plan addresses', () => {
  const mean = (s) => s.base.reduce((a, b) => a + b, 0) / s.base.length
  const weakest = [...DEPARTMENT_SPECS.procomer].sort((a, b) => mean(a) - mean(b))[0]
  assert.equal(weakest.name, 'Ventanilla Única')
  const plan = PROFILES.procomer.plans.find((p) => p[2] === 'Ventanilla Única de Comercio Exterior')
  assert.ok(plan, 'no action plan for the weakest department')
})

/**
 * The 409 that stopped a seeding run half-way, pinned.
 *
 * Employees are generated from a 33-name first list and a 33-name surname list. The pair used
 * to repeat with period 33, so any profile with more than 33 employees regenerated an earlier
 * address and `POST /auth/signup` answered 409 — after the company, its departments and three
 * dozen accounts already existed. Asserted per profile at its real size, and above it, because
 * the next profile is the one that will be bigger again.
 */
test('generated employees never share an address, at any profile size', () => {
  for (const [key, profile] of Object.entries(PROFILES)) {
    const total = Object.values(profile.headcount).reduce((a, b) => a + b, 0)
    const locals = new Set()
    for (let n = 0; n < total; n++) locals.add(personAt(n).local)
    assert.equal(locals.size, total, `${key} generates ${locals.size} distinct addresses for ${total} employees`)
  }
  const many = new Set()
  for (let n = 0; n < 200; n++) many.add(personAt(n).local)
  assert.equal(many.size, 200, 'the generator collides before 200 employees')
})

/**
 * Meridiano's 33 generated addresses must not have moved. Asserted against the ORIGINAL
 * formula rather than against strings typed from memory — the shift term is `floor(n / 33)`,
 * which is 0 for every n below 33, so the two must agree exactly there, and the test states
 * the reason rather than restating an answer. (My first attempt hardcoded a guess and failed.)
 */
test('meridiano: the 33 generated addresses are unchanged', () => {
  const FIRST = ['María', 'José', 'Laura', 'Andrés', 'Valeria', 'Daniel', 'Camila', 'Esteban', 'Paula', 'Gabriel', 'Natalia', 'Sebastián', 'Fernanda', 'Alejandro', 'Mariana', 'Ricardo', 'Isabel', 'Javier', 'Adriana', 'Rodrigo', 'Carolina', 'Felipe', 'Daniela', 'Óscar', 'Lucía', 'Mauricio', 'Verónica', 'Ignacio', 'Patricia', 'Jorge', 'Silvia', 'Roberto', 'Melissa']
  const LAST = ['Chaves', 'Alvarado', 'Salas', 'Brenes', 'Campos', 'Zúñiga', 'Ramírez', 'Arias', 'Herrera', 'Montero', 'Céspedes', 'Villalobos', 'Umaña', 'Guzmán', 'Barrantes', 'Sandoval', 'Méndez', 'Cordero', 'Fallas', 'Ulate', 'Araya', 'Segura', 'Bolaños', 'Madrigal', 'Espinoza', 'Retana', 'Coto', 'Marín', 'Porras', 'Vindas', 'Aguilar', 'Pacheco', 'Leiva']
  const before = (n) => `${FIRST[n % 33]}.${LAST[(n * 7) % 33]}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  for (let n = 0; n < 33; n++) assert.equal(personAt(n).local, before(n), `employee ${n} moved`)
  // And the 34th is exactly where they must differ, which is the whole point of the change.
  assert.notEqual(personAt(33).local, before(33))
})
