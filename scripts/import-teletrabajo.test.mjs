/**
 * Pure-function tests for the Teletrabajo import. No network. `node --test scripts/`.
 *
 * The rows are shaped like ESPH's roster but every person is invented. Each block also feeds the
 * input that must be REFUSED, because the only thing this script is really for is refusing: a
 * survey aimed at people by id reaches exactly the ids it was given, so a row quietly dropped
 * here is a person who never gets asked and nothing anywhere says so.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clean, edadBand, antiguedadBand, parseRoster, toImportRow, splitByExisting,
  unknownValues, classifyDepartments, toSurveyBody, ROSTER_COLUMNS,
} from './import-teletrabajo.mjs'

/** A sheet from rows of [letter, value] pairs — row 1 is the header. */
const sheet = (rows) => Object.fromEntries(
  rows.flatMap((row, index) => Object.entries(row).map(([letter, value]) => [`${letter}${index + 1}`, { value }])),
)

// ESPH's own header spelling, including the one with the ñ.
const HEADER = {
  A: '#', B: 'NUM_FUNC', C: 'CEDULA', D: 'NOMBRE DEL TRABAJADOR', E: 'FECHA DE NACIMIENTO',
  F: 'EDAD', G: 'GENERO', H: 'AÑOS DE LABORAR EN LA EMPRESA', I: 'TIPO DE PUESTO',
  J: 'CORREO ELECTRONICO', K: 'MACROPROCESO', L: 'PROCESO', M: 'NOMBRE DE LA JEFATURA',
}
const PERSON = {
  A: 1, B: 900, C: '1-1111-1111', D: 'ANA SOLIS ROJAS', E: '1990-01-01', F: 36, G: 'Femenino',
  H: 12, I: 'Administrativo', J: 'ana.solis@ejemplo.test', K: 'Negocio de Agua Potable',
  L: 'Negocio AP - Comercial', M: 'Mora Vargas Luis',
}

test('a cell keeps neither the OOXML escape nor the control characters glued to it', () => {
  // Three ESPH addresses arrived as `foo@bar.com_x000D_\r\n`. `.trim()` alone leaves the seven
  // literal characters on the address, which creates an account that can never receive mail.
  assert.equal(clean('ana.solis@ejemplo.test_x000D_\r\n'), 'ana.solis@ejemplo.test')
  assert.equal(clean('  Negocio AP _x000A_ Comercial '), 'Negocio AP  Comercial')
  assert.equal(clean(36), '36')
  assert.equal(clean(null), '')
  assert.equal(clean(undefined), '')
})

test('the bands are the template dropdown labels, at the boundaries the clima import used', () => {
  // These must agree with build_esph.py exactly: the Clima import turned ITS output into this
  // company's options, so a band spelled or cut differently here is a value the field does not
  // list, which refuses the row.
  assert.deepEqual([24, 25, 34, 35, 44, 45, 54, 55].map(edadBand),
    ['Menos de 25', '25 a 34', '25 a 34', '35 a 44', '35 a 44', '45 a 54', '45 a 54', '55 o más'])
  // Out of range and unreadable both become the option the clima roster's own 126-year-old made.
  assert.equal(edadBand(126), 'Prefiero no indicar')
  assert.equal(edadBand(17), 'Prefiero no indicar')
  assert.equal(edadBand(''), 'Prefiero no indicar')
  assert.equal(edadBand('n/d'), 'Prefiero no indicar')
  assert.equal(edadBand(36.9), '35 a 44')            // truncated, not rounded up to 37

  assert.deepEqual([0, 0.5, 1, 3, 3.5, 6, 10, 10.5, 30].map(antiguedadBand),
    ['Menos de 1 año', 'Menos de 1 año', '1 a 3 años', '1 a 3 años', '4 a 6 años', '4 a 6 años',
      '7 a 10 años', 'Más de 10 años', 'Más de 10 años'])
  assert.equal(antiguedadBand('12,5'), 'Más de 10 años')   // a decimal comma is still a number
  assert.equal(antiguedadBand(''), 'Prefiero no indicar')
})

test('the roster is read by header text, so a column that MOVED still reads right', () => {
  // build_esph.py reads this file by letter. One inserted column and every field would be read
  // from its neighbour, for all 240 people, with nothing looking wrong anywhere.
  const shifted = { ...PERSON }
  const shiftedHeader = { ...HEADER }
  // slide the email and everything after it one column to the right
  shiftedHeader.J = 'ESTADO'; shiftedHeader.N = 'CORREO ELECTRONICO'
  shifted.J = 'activo'; shifted.N = 'ana.solis@ejemplo.test'
  const { problems, people } = parseRoster(sheet([shiftedHeader, shifted]))
  assert.deepEqual(problems, [])
  assert.equal(people[0].email, 'ana.solis@ejemplo.test')
  assert.equal(people[0].demographics.proceso, 'Negocio AP - Comercial')
})

test('a renamed or missing column stops the run and names what it was needed for', () => {
  const { [`H`]: _dropped, ...withoutAntiguedad } = HEADER
  const { problems, people } = parseRoster(sheet([withoutAntiguedad, PERSON]), { sheet: 'Teletrabajo' })
  assert.deepEqual(people, [])
  assert.deepEqual(problems, ['Teletrabajo: no column headed "anos de laborar en la empresa" (needed for antiguedad).'])
  // Two columns with the same header is just as ambiguous as none.
  const twice = parseRoster(sheet([{ ...HEADER, N: 'CORREO ELECTRONICO' }, PERSON]))
  assert.equal(twice.problems.length, 1)
  assert.match(twice.problems[0], /two columns are headed "correo electronico"/)
})

test('a row that cannot become a targetable person is a problem, never a silent skip', () => {
  const rows = [
    HEADER,
    PERSON,
    { ...PERSON, A: 2, D: 'BRUNO LEON PAZ', J: '' },                              // no email
    { ...PERSON, A: 3, D: 'CARLA DIAZ MORA', J: 'carla.diaz@ejemplo.test', K: '' }, // no department
    { ...PERSON, A: 4, D: 'DORA RUIZ SOTO', J: 'no-an-email' },                   // invalid
    { ...PERSON, A: 5, D: 'ELSA PENA LUZ', J: 'ANA.SOLIS@ejemplo.test' },         // repeated
    { ...PERSON, A: 6, D: '', J: 'sin.nombre@ejemplo.test' },                     // no name
  ]
  const { problems, people } = parseRoster(sheet(rows), { sheet: 'Teletrabajo' })
  assert.deepEqual(problems, [
    'Teletrabajo row 3: BRUNO LEON PAZ has NO EMAIL — cannot be given an account or be targeted.',
    'Teletrabajo row 4: CARLA DIAZ MORA has no macroproceso.',
    'Teletrabajo row 5: DORA RUIZ SOTO has an invalid email ("no-an-email").',
    'Teletrabajo row 6: ELSA PENA LUZ <ana.solis@ejemplo.test> is the same address as row 2 (ANA SOLIS ROJAS).',
    'Teletrabajo row 7: sin.nombre@ejemplo.test has no name.',
  ])
  // Carla is still READ — her problem is a missing department, not a missing person — so the
  // caller refusing on `problems` is what keeps her out, not a quiet filter in here.
  assert.deepEqual(people.map((p) => p.email), ['ana.solis@ejemplo.test', 'carla.diaz@ejemplo.test'])
  // An entirely blank row in the used range is not a problem, it is just not a row.
  assert.deepEqual(parseRoster(sheet([HEADER, PERSON, {}, { A: 9 }])).problems, [])
})

test('the email is lower-cased and the roster row number is kept for reporting', () => {
  const { people } = parseRoster(sheet([HEADER, { ...PERSON, J: 'Ana.Solis@Ejemplo.TEST' }]))
  assert.equal(people[0].email, 'ana.solis@ejemplo.test')
  assert.equal(people[0].row, 2)
  assert.equal(people[0].puesto, 'Administrativo')
  // the hyphen the clima roster omits on two rows
  const fixed = parseRoster(sheet([HEADER, { ...PERSON, I: 'Técnico Operativo' }]))
  assert.equal(fixed.people[0].puesto, 'Técnico-Operativo')
})

const FIELDS = [
  { id: 'f1', field: 'genero', type: 'select', options: [{ order: 0, value: 'femenino', label: 'Femenino' }, { order: 1, value: 'masculino', label: 'Masculino' }] },
  { id: 'f2', field: 'antiguedad', type: 'select', options: [{ order: 0, value: 'mas_de_10_anos', label: 'Más de 10 años' }] },
  { id: 'f3', field: 'rango_de_edad', type: 'select', options: [{ order: 0, value: '35_a_44', label: '35 a 44' }] },
  { id: 'f4', field: 'proceso', type: 'select', options: [{ order: 0, value: 'negocio_ap_comercial', label: 'Negocio AP - Comercial' }] },
  { id: 'f5', field: 'jefatura', type: 'select', options: [{ order: 0, value: 'mora_vargas_luis', label: 'Mora Vargas Luis' }] },
]

test('a row carries the slugged value of a select field, and nothing for a field the company lacks', () => {
  const { people } = parseRoster(sheet([HEADER, PERSON]))
  const row = toImportRow(people[0], FIELDS)
  assert.deepEqual(row, {
    rowNumber: 2,
    name: 'ANA SOLIS ROJAS',
    email: 'ana.solis@ejemplo.test',
    role: 'employee',
    department: 'Negocio de Agua Potable',
    demographics: {
      genero: 'femenino', antiguedad: 'mas_de_10_anos', rango_de_edad: '35_a_44',
      proceso: 'negocio_ap_comercial', jefatura: 'mora_vargas_luis',
    },
  })
  // A field the company does not have is omitted, not sent as a key the server would refuse.
  const fewer = toImportRow(people[0], FIELDS.filter((f) => f.field !== 'jefatura'))
  assert.equal('jefatura' in fewer.demographics, false)
  // A numeric field keeps the number rather than slugging it into a word.
  const numeric = toImportRow(people[0], [{ id: 'f9', field: 'antiguedad', type: 'number', options: [] }])
  assert.deepEqual(numeric.demographics, { antiguedad: 'Más de 10 años' })
  // A jefatura whose title makes them a leader is imported as one.
  const boss = parseRoster(sheet([HEADER, { ...PERSON, I: 'Gerente' }])).people[0]
  assert.equal(toImportRow(boss, FIELDS).role, 'leader')
})

test('who already has an account is decided case-insensitively, as the unique index is', () => {
  const { people } = parseRoster(sheet([
    HEADER, PERSON,
    { ...PERSON, A: 2, D: 'BRUNO LEON PAZ', J: 'bruno.leon@ejemplo.test' },
  ]))
  const split = splitByExisting(people, ['ANA.SOLIS@EJEMPLO.TEST', 'alguien.mas@ejemplo.test'])
  assert.deepEqual(split.existing.map((p) => p.email), ['ana.solis@ejemplo.test'])
  assert.deepEqual(split.fresh.map((p) => p.email), ['bruno.leon@ejemplo.test'])
  assert.deepEqual(splitByExisting(people, []).fresh.length, 2)
})

test('a value the field does not list is reported with the people who carry it', () => {
  const { people } = parseRoster(sheet([
    HEADER,
    { ...PERSON, L: 'Junta Directiva', M: 'Junta Directiva' },
    { ...PERSON, A: 2, D: 'BRUNO LEON PAZ', J: 'bruno.leon@ejemplo.test', L: 'Junta Directiva' },
  ]))
  const unknown = unknownValues(people, FIELDS)
  assert.deepEqual([...unknown.keys()], ['proceso', 'jefatura'])
  assert.deepEqual([...unknown.get('proceso').get('Junta Directiva')].map((p) => p.name), ['ANA SOLIS ROJAS', 'BRUNO LEON PAZ'])
  assert.deepEqual([...unknown.get('jefatura').keys()], ['Junta Directiva'])
  // Everything already listed reports nothing at all.
  assert.equal(unknownValues(parseRoster(sheet([HEADER, PERSON])).people, FIELDS).size, 0)
})

const DEPARTMENTS = [
  { name: 'Negocio de Agua Potable', isActive: true },
  { name: 'Negocio de Energía Eléctrica', isActive: true },
]

test('a department is matched exactly, and one differing only in case is a conflict, not a new one', () => {
  const people = (department) => parseRoster(sheet([HEADER, { ...PERSON, K: department }])).people
  assert.deepEqual(classifyDepartments(people('Negocio de Agua Potable'), DEPARTMENTS), { missing: [], conflicts: [] })
  assert.deepEqual(classifyDepartments(people('Junta Directiva'), DEPARTMENTS), { missing: ['Junta Directiva'], conflicts: [] })
  // `d.Name == row.Department` is ordinal: this matches nothing, and approving it as new is
  // dropped because it collides case-insensitively with the real one. Creating it would split
  // one department's audience in two.
  assert.deepEqual(classifyDepartments(people('negocio de agua potable'), DEPARTMENTS),
    { missing: [], conflicts: [{ roster: 'negocio de agua potable', existing: 'Negocio de Agua Potable' }] })
  // An accent dropped in the roster is the same trap.
  assert.deepEqual(classifyDepartments(people('Negocio de Energia Electrica'), DEPARTMENTS).conflicts,
    [{ roster: 'Negocio de Energia Electrica', existing: 'Negocio de Energía Eléctrica' }])
})

test('the survey body overrides what the built payload decided, and aims at people only', () => {
  const payload = {
    companyId: '00000000-0000-0000-0000-000000000000',
    title: { es: 'Teletrabajo ESPH 2026', en: 'Teletrabajo ESPH 2026' },
    startDate: 'REPLACE-ME', endDate: 'REPLACE-ME', type: 'periodic',
    departmentIds: ['a-department-that-would-reach-625'],
    questions: [{ type: 'likert' }],
    settings: { anonymous: false, notificationSendInvitations: false },
  }
  const body = toSurveyBody(payload, {
    companyId: '11111111-2222-3333-4444-555555555555',
    startDate: '2026-10-19T14:00:00Z', endDate: '2026-10-27T05:59:00Z',
    userIds: ['u1', 'u2'],
  })
  assert.equal(body.companyId, '11111111-2222-3333-4444-555555555555')
  assert.equal(body.startDate, '2026-10-19T14:00:00Z')
  assert.equal(body.endDate, '2026-10-27T05:59:00Z')
  assert.deepEqual(body.userIds, ['u1', 'u2'])
  // The whole point of #587: departments cannot express this audience, so none are sent.
  assert.deepEqual(body.departmentIds, [])
  // The built payload carries false, which mints invitation rows and queues NO email. Per-person
  // completion tracking has no backfill, so the invitations must actually go out.
  assert.equal(body.settings.notificationSendInvitations, true)
  assert.equal(body.settings.anonymous, false)
  // Everything the payload decided and this script does not is untouched.
  assert.equal(body.type, 'periodic')
  assert.equal(body.serviceType, undefined)     // unmetered: no licence row is ever spent
  assert.deepEqual(body.questions, [{ type: 'likert' }])
})

test('every demographic a row carries actually came from a column of the roster', () => {
  // A demographic added to the row without a source column reads as blank for all 240 people and
  // is then simply omitted from the import — no error, no value, nobody told. Asserting the key
  // set AND that each one is filled for a complete person is what catches that.
  const { people } = parseRoster(sheet([HEADER, PERSON]))
  assert.deepEqual(Object.keys(people[0].demographics).sort(),
    ['antiguedad', 'genero', 'jefatura', 'proceso', 'rango_de_edad'])
  for (const [key, value] of Object.entries(people[0].demographics)) {
    assert.notEqual(value, '', `${key} read as blank from a complete roster row`)
  }
  for (const key of ['name', 'email', 'department', 'puesto', 'edad', 'genero', 'antiguedad', 'proceso', 'jefatura']) {
    assert.ok(key in ROSTER_COLUMNS, `${key} has no roster column`)
  }
})
