import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IntakeWizard from './IntakeWizard'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../i18n'
import { IntakeRequestError, type IntakeMapping, type IntakeRow, type IntakeUnderstanding } from '../api/intake'
import type { BulkImportResponse } from '../api/bulkImport'

const understandIntakeFile = vi.fn<(...args: unknown[]) => Promise<IntakeUnderstanding>>()
const submitIntakeRows = vi.fn<(...args: unknown[]) => Promise<BulkImportResponse>>()
const getIntakeTemplate = vi.fn<() => Promise<Blob>>()

// The real module is spread in so `IntakeRequestError` stays the real class the wizard checks.
vi.mock('../api/intake', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  understandIntakeFile: (...args: unknown[]) => understandIntakeFile(...args),
  submitIntakeRows: (...args: unknown[]) => submitIntakeRows(...args),
  getIntakeTemplate: (...args: unknown[]) => getIntakeTemplate(...(args as [])),
}))

const downloadBlobFile = vi.fn()
vi.mock('../../../lib/downloadBlobFile', () => ({
  downloadBlobFile: (...args: unknown[]) => downloadBlobFile(...(args as [])),
}))

function renderWizard(onImported = vi.fn(), locale: 'en' | 'es' = 'es') {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  return render(
    <TranslationProvider>
      <IntakeWizard baseUrl="http://api.test" companyId="c1" onImported={onImported} revealDelayMs={0} />
    </TranslationProvider>,
  )
}

/** The file object itself is never read: `understandIntakeFile` is mocked. */
function hrExport() {
  return new File([new Uint8Array([1, 2, 3])], 'planilla-rrhh.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

const mapping: IntakeMapping = {
  sheet: 'Colaboradores',
  headerRow: 3,
  nameOrder: 'last_first',
  defaultRole: 'employee',
  columns: [
    { column: 1, header: 'Nombre del colaborador', target: 'name', demographicField: null, confidence: 'high', reason: 'Contiene nombres completos.' },
    { column: 2, header: 'Correo institucional', target: 'email', demographicField: null, confidence: 'high', reason: 'Direcciones de correo.' },
    { column: 3, header: 'Puesto', target: 'role', demographicField: null, confidence: 'medium', reason: 'Cargos que indican jerarquía.' },
    { column: 4, header: 'Área', target: 'department', demographicField: null, confidence: 'high', reason: 'Nombres de áreas.' },
    { column: 5, header: 'Sexo', target: 'demographic', demographicField: 'gender', confidence: 'high', reason: null },
    { column: 6, header: 'Cédula', target: 'ignore', demographicField: null, confidence: 'low', reason: 'Identificación personal; no se usa.' },
  ],
  roleValues: [
    { source: 'Jefe de área', target: 'leader', confidence: 'high', reason: 'Dirige un área.' },
    { source: 'Coordinador', target: 'supervisor', confidence: 'low', reason: 'Podría ser líder o supervisor.' },
  ],
  departmentValues: [
    { source: 'ING', department: 'Ingeniería', createNew: false, confidence: 'high', reason: 'Abreviatura de Ingeniería.' },
    { source: 'Logística', department: 'Logística', createNew: true, confidence: 'medium', reason: 'No existe en la empresa.' },
  ],
  demographicValues: [
    { field: 'gender', source: 'F', target: 'female', confidence: 'high' },
    { field: 'gender', source: 'M', target: 'male', confidence: 'high' },
  ],
  summary: 'El archivo es una planilla de RR. HH. con 3 personas en la hoja «Colaboradores»; los encabezados están en la fila 3.',
}

const rows: IntakeRow[] = [
  { rowNumber: 4, name: 'Ana Rojas', email: 'ana@meridiano.test', role: 'leader', department: 'Ingeniería', demographics: { gender: 'female' } },
  { rowNumber: 5, name: 'Luis Mora', email: 'luis@gmial.com', role: 'employee', department: 'Logística', demographics: { gender: 'male' } },
  { rowNumber: 6, name: 'Eva Soto', email: 'eva@gmial.com', role: 'supervisor', department: 'Logística', demographics: null },
]

function aiUnderstanding(overrides: Partial<IntakeUnderstanding> = {}): IntakeUnderstanding {
  return {
    source: 'ai',
    failureCode: null,
    mapping,
    rows,
    newDepartments: ['Logística'],
    problems: [],
    insights: [
      { code: 'email_typo', rows: [5, 6], value: 'gmial.com', suggestion: 'gmail.com' },
      { code: 'new_department', rows: [5, 6], value: 'Logística', suggestion: null },
    ],
    file: {
      fileName: 'planilla-rrhh.xlsx',
      sheets: [{ name: 'Colaboradores', rows: 7, columns: 6 }],
      namesNormalised: 0,
      skippedRows: [7],
    },
    ai: {
      model: 'claude-opus-5-5',
      inputTokens: 2400,
      outputTokens: 610,
      durationMs: 4200,
      cached: false,
      categoryColumns: ['Puesto', 'Área', 'Sexo'],
      maskedColumns: ['Nombre del colaborador', 'Correo institucional', 'Cédula'],
    },
    targets: {
      companyName: 'Meridiano',
      emailDomain: 'meridiano.test',
      departments: ['Finanzas', 'Ingeniería'],
      demographics: [{ field: 'gender', label: 'Género', type: 'select', options: ['female', 'male', 'other'] }],
    },
    ...overrides,
  }
}

const allValid = (sent: IntakeRow[]): BulkImportResponse => ({
  rows: sent.map((row) => ({ ...row, status: 'valid', errors: [], issues: [] })),
  successCount: sent.length,
  errorCount: 0,
})

async function uploadAndUnderstand(answer = aiUnderstanding(), locale: 'en' | 'es' = 'es', onImported = vi.fn()) {
  const user = userEvent.setup()
  understandIntakeFile.mockResolvedValue(answer)
  renderWizard(onImported, locale)
  await user.upload(screen.getByLabelText(locale === 'es' ? 'Archivo de personas' : 'People file'), hrExport())
  await screen.findByRole('heading', { name: locale === 'es' ? 'Así entendimos su archivo' : 'How we understood your file' })
  return user
}

async function continueToReview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Continuar a la revisión' }))
  await screen.findByDisplayValue('Ana Rojas')
}

beforeEach(() => {
  understandIntakeFile.mockReset()
  submitIntakeRows.mockReset()
  getIntakeTemplate.mockReset()
  downloadBlobFile.mockReset()
})

afterEach(() => {
  cleanup()
  localStorage.removeItem(LOCALE_STORAGE_KEY)
})

describe('IntakeWizard — upload and understanding', () => {
  it('sends the chosen file to /understand with the company and the reader’s language', async () => {
    await uploadAndUnderstand()

    expect(understandIntakeFile).toHaveBeenCalledTimes(1)
    const [baseUrl, companyId, file, language, sentMapping] = understandIntakeFile.mock.calls[0]
    expect(baseUrl).toBe('http://api.test')
    expect(companyId).toBe('c1')
    expect((file as File).name).toBe('planilla-rrhh.xlsx')
    expect(language).toBe('es')
    // The first reading sends no mapping: that is what lets the server ask the model.
    expect(sentMapping).toBeUndefined()
  })

  it('sends English when the reader reads English', async () => {
    await uploadAndUnderstand(aiUnderstanding(), 'en')

    expect(understandIntakeFile.mock.calls[0][3]).toBe('en')
  })

  it('accepts a file dropped on the zone, not only one chosen', async () => {
    understandIntakeFile.mockResolvedValue(aiUnderstanding())
    renderWizard()
    const zone = document.querySelector('[data-slot="intake-dropzone"]') as HTMLElement

    fireEvent.drop(zone, { dataTransfer: { files: [hrExport()] } })

    await screen.findByRole('heading', { name: 'Así entendimos su archivo' })
    expect((understandIntakeFile.mock.calls[0][2] as File).name).toBe('planilla-rrhh.xlsx')
  })

  it('hands the template over as a Blob, never as a link', async () => {
    const user = userEvent.setup()
    const blob = new Blob(['x'])
    getIntakeTemplate.mockResolvedValue(blob)
    renderWizard()

    await user.click(screen.getByRole('button', { name: 'Descargue la plantilla' }))

    await waitFor(() => expect(downloadBlobFile).toHaveBeenCalledWith('plantilla-personas.xlsx', blob))
  })

  it('shows the checklist while the file is being read, with the AI stage in it', async () => {
    const user = userEvent.setup()
    let resolve: (value: IntakeUnderstanding) => void = () => {}
    understandIntakeFile.mockReturnValue(new Promise((r) => (resolve = r)))
    renderWizard()

    await user.upload(screen.getByLabelText('Archivo de personas'), hrExport())

    expect(await screen.findByText('Entendiendo su archivo')).toBeTruthy()
    expect(screen.getByText('Leyendo el archivo')).toBeTruthy()
    expect(screen.getByText('La IA interpreta la estructura')).toBeTruthy()
    resolve(aiUnderstanding())
    await screen.findByRole('heading', { name: 'Así entendimos su archivo' })
  })

  it('never ticks the AI stage for our own template: it says the AI was not needed', async () => {
    const user = userEvent.setup()
    let resolve: (value: IntakeUnderstanding) => void = () => {}
    understandIntakeFile.mockReturnValue(new Promise((r) => (resolve = r)))
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    render(
      <TranslationProvider>
        <IntakeWizard baseUrl="http://api.test" companyId="c1" onImported={vi.fn()} revealDelayMs={60_000} />
      </TranslationProvider>,
    )
    await user.upload(screen.getByLabelText('Archivo de personas'), hrExport())

    resolve(aiUnderstanding({ source: 'template', ai: null }))

    expect(await screen.findByText('Plantilla reconocida: no hizo falta la IA')).toBeTruthy()
    expect(screen.queryByText('La IA interpreta la estructura')).toBeNull()
    const aiStage = document.querySelector('[data-stage="ai"]')
    expect(aiStage?.getAttribute('data-state')).toBe('skipped')
  })

  it('renders the model’s summary, the file facts and the model that read it', async () => {
    await uploadAndUnderstand()

    expect(screen.getByText(mapping.summary as string)).toBeTruthy()
    expect(screen.getByText('Interpretado por IA')).toBeTruthy()
    expect(screen.getByText('Colaboradores')).toBeTruthy()
    // "claude-opus-5-5" is named as a person would say it, with the time in Spanish decimals.
    expect(screen.getByText('Claude Opus 5.5 · 4,2 s')).toBeTruthy()
  })

  it('says, from the response, exactly what the AI was and was not shown', async () => {
    await uploadAndUnderstand()

    const privacy = document.querySelector('[data-slot="intake-privacy"]') as HTMLElement
    expect(privacy).toBeTruthy()
    expect(within(privacy).getByText('La IA solo vio la estructura del archivo.')).toBeTruthy()
    expect(within(privacy).getByText(/Ningún nombre ni correo completo salió de la plataforma/)).toBeTruthy()
    for (const column of ['Puesto', 'Área', 'Sexo', 'Nombre del colaborador', 'Correo institucional', 'Cédula']) {
      expect(within(privacy).getByText(column)).toBeTruthy()
    }
  })

  it('makes no privacy claim when the AI did not read the file', async () => {
    await uploadAndUnderstand(aiUnderstanding({ source: 'template', ai: null, mapping: { ...mapping, summary: null } }))

    expect(document.querySelector('[data-slot="intake-privacy"]')).toBeNull()
    expect(screen.getByText('Plantilla reconocida')).toBeTruthy()
  })

  it('explains a fallback to header words in Spanish, per failure code', async () => {
    await uploadAndUnderstand(
      aiUnderstanding({ source: 'heuristic', failureCode: 'ai_unavailable', mapping: { ...mapping, summary: null } }),
    )

    const banner = document.querySelector('[data-slot="intake-fallback"]') as HTMLElement
    expect(within(banner).getByText('La IA no está disponible en este momento')).toBeTruthy()
    expect(
      within(banner).getByText('Leímos las columnas por sus encabezados. Revise el mapeo de abajo antes de continuar.'),
    ).toBeTruthy()
    expect(screen.getByText('Leído por encabezados')).toBeTruthy()
    // The model did not read it, so the screen says nothing about what the model saw.
    expect(document.querySelector('[data-slot="intake-privacy"]')).toBeNull()
  })

  it('translates confidence and flags the low-confidence decisions first', async () => {
    await uploadAndUnderstand()

    expect(screen.getAllByText('Alta').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Media').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Baja').length).toBe(2)
    expect(screen.getByText('2 decisión(es) con confianza baja están resaltadas: revíselas primero.')).toBeTruthy()
    const flagged = [...document.querySelectorAll('[data-low-confidence]')].map((row) => row.textContent)
    expect(flagged).toHaveLength(2)
    expect(flagged[0]).toContain('Cédula')
    expect(flagged[1]).toContain('Coordinador')
  })

  it('offers existing departments, "Crear" and "(sin asignar)" for each area, and marks a new one', async () => {
    await uploadAndUnderstand()

    const select = screen.getByRole('combobox', { name: 'Departamento · Logística' }) as HTMLSelectElement
    const options = [...select.options].map((option) => option.textContent)
    expect(options).toEqual(['(sin asignar)', 'Finanzas', 'Ingeniería', 'Crear «Logística»'])
    expect(select.value).toBe('new:Logística')
    expect(screen.getByText('Nuevo')).toBeTruthy()
  })

  it('re-applies an edited mapping with no AI call and refreshes from the answer', async () => {
    const user = await uploadAndUnderstand()
    const continueButton = screen.getByRole('button', { name: 'Continuar a la revisión' })
    expect(continueButton.hasAttribute('disabled')).toBe(false)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Se usa como · Cédula' }), 'demographic:gender')

    // An edit not yet applied cannot be carried forward.
    expect(screen.getByRole('button', { name: 'Continuar a la revisión' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Ajustado')).toBeTruthy()

    understandIntakeFile.mockResolvedValue(aiUnderstanding({ source: 'manual', ai: null }))
    await user.click(screen.getByRole('button', { name: 'Aplicar cambios' }))

    await screen.findByText('Mapeo ajustado por usted')
    expect(understandIntakeFile).toHaveBeenCalledTimes(2)
    const [, , file, language, sent] = understandIntakeFile.mock.calls[1] as [string, string, File, string, IntakeMapping]
    expect(file.name).toBe('planilla-rrhh.xlsx')
    expect(language).toBe('es')
    const cedula = sent.columns.find((c) => c.column === 6)
    expect(cedula).toMatchObject({ target: 'demographic', demographicField: 'gender' })
    // Everything the admin did not touch goes back as it came.
    expect(sent.columns.find((c) => c.column === 1)).toEqual(mapping.columns[0])
    // The AI read this file earlier in the session, so what it was shown is still stated.
    expect(document.querySelector('[data-slot="intake-privacy"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continuar a la revisión' }).hasAttribute('disabled')).toBe(false)
  })

  it('returns to the upload with the reason in Spanish when the file is not a spreadsheet', async () => {
    const user = userEvent.setup()
    understandIntakeFile.mockRejectedValue(
      new IntakeRequestError('This file could not be read as a spreadsheet (.xlsx or .csv).', 'not_a_spreadsheet', 400),
    )
    renderWizard()

    await user.upload(screen.getByLabelText('Archivo de personas'), hrExport())

    expect(await screen.findByText(/Este archivo no se pudo leer como hoja de cálculo/)).toBeTruthy()
    expect(screen.queryByText(/could not be read/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Elegir archivo' })).toBeTruthy()
  })

  it('never prints a server sentence it has no translation for at a Spanish reader', async () => {
    const user = userEvent.setup()
    understandIntakeFile.mockRejectedValue(new IntakeRequestError('Request failed: 500', null, 500))
    renderWizard()

    await user.upload(screen.getByLabelText('Archivo de personas'), hrExport())

    expect(await screen.findByText('Ocurrió un error. Por favor intenta nuevamente.')).toBeTruthy()
    expect(screen.queryByText(/Request failed/)).toBeNull()
  })

  it('offers a way back from a file that yields nobody, with the fixable problem named', async () => {
    const user = await uploadAndUnderstand(
      aiUnderstanding({
        rows: [],
        insights: [],
        newDepartments: [],
        problems: [{ sheet: 'Colaboradores', message: 'No column holds the email address.', code: 'no_email_column' }],
      }),
    )

    expect(screen.getByText(/Ninguna columna contiene el correo/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continuar a la revisión' }).hasAttribute('disabled')).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Atrás' }))
    expect(screen.getByRole('button', { name: 'Elegir archivo' })).toBeTruthy()
  })
})

describe('IntakeWizard — before approving', () => {
  it('says each insight in Spanish with its rows, and how many people a new department affects', async () => {
    await uploadAndUnderstand()

    expect(screen.getByText('Correos con «@gmial.com», que parece un error de «@gmail.com» (filas 5, 6).')).toBeTruthy()
    expect(screen.getByText('Se creará el departamento «Logística» para 2 personas (filas 5, 6).')).toBeTruthy()
    expect(
      screen.getByText('Se omitió 1 fila que no describe a una persona (fila 7), por ejemplo un total al pie de la tabla.'),
    ).toBeTruthy()
  })

  it('"Corregir" rewrites the mistyped domain on every row it names', async () => {
    const user = await uploadAndUnderstand()

    await user.click(screen.getByRole('button', { name: 'Corregir' }))

    expect(screen.getByText('Corregido: «@gmial.com» ahora es «@gmail.com» (filas 5, 6).')).toBeTruthy()
    await continueToReview(user)
    expect(screen.getByDisplayValue('luis@gmail.com')).toBeTruthy()
    expect(screen.getByDisplayValue('eva@gmail.com')).toBeTruthy()
    expect(screen.queryByDisplayValue(/gmial/)).toBeNull()
    // A row the insight did not name is untouched.
    expect(screen.getByDisplayValue('ana@meridiano.test')).toBeTruthy()
  })
})

describe('IntakeWizard — review and approval', () => {
  it('refuses to create anything until the rows have been validated', async () => {
    const user = await uploadAndUnderstand()
    await continueToReview(user)

    expect(screen.getByRole('button', { name: 'Crear invitaciones' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Valide las filas antes de crear las invitaciones.')).toBeTruthy()
    expect(submitIntakeRows).not.toHaveBeenCalled()
  })

  it('shows each row’s demographics, and offers the approved new department in the select', async () => {
    const user = await uploadAndUnderstand()
    await continueToReview(user)

    expect(screen.getByText('Género: female')).toBeTruthy()
    expect(screen.getByText('Género: male')).toBeTruthy()
    const select = screen.getAllByRole('combobox', { name: 'Departamento' })[1] as HTMLSelectElement
    expect([...select.options].map((option) => option.textContent)).toEqual([
      '(sin departamento)',
      'Finanzas',
      'Ingeniería',
      'Logística (nuevo)',
    ])
    expect(select.value).toBe('Logística')
  })

  it('validates and approves with the new departments and each row’s demographics', async () => {
    const onImported = vi.fn()
    const user = await uploadAndUnderstand(aiUnderstanding(), 'es', onImported)
    await continueToReview(user)

    submitIntakeRows.mockImplementation(async (...args: unknown[]) => allValid(args[2] as IntakeRow[]))
    await user.click(screen.getByRole('button', { name: 'Validar' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Crear invitaciones' }).hasAttribute('disabled')).toBe(false),
    )

    submitIntakeRows.mockImplementation(async (...args: unknown[]) => {
      const sent = args[2] as IntakeRow[]
      return { ...allValid(sent), rows: sent.map((row) => ({ ...row, status: 'invited', errors: [], issues: [] })) }
    })
    await user.click(screen.getByRole('button', { name: 'Crear invitaciones' }))
    await waitFor(() => expect(onImported).toHaveBeenCalled())

    const [preview, approve] = submitIntakeRows.mock.calls as unknown as [
      [string, string, IntakeRow[], boolean, string[]],
      [string, string, IntakeRow[], boolean, string[]],
    ]
    expect(preview[3]).toBe(true)
    expect(approve[3]).toBe(false)
    for (const call of [preview, approve]) {
      expect(call[4]).toEqual(['Logística'])
      expect(call[2].find((row) => row.rowNumber === 4)?.demographics).toEqual({ gender: 'female' })
      expect(call[2].find((row) => row.rowNumber === 5)?.department).toBe('Logística')
    }
    expect(await screen.findByText('Departamentos creados: Logística.')).toBeTruthy()
  })

  it('withdraws approval again as soon as a cell is edited', async () => {
    const user = await uploadAndUnderstand()
    await continueToReview(user)
    submitIntakeRows.mockImplementation(async (...args: unknown[]) => allValid(args[2] as IntakeRow[]))

    await user.click(screen.getByRole('button', { name: 'Validar' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Crear invitaciones' }).hasAttribute('disabled')).toBe(false),
    )

    await user.type(screen.getByDisplayValue('ana@meridiano.test'), 'x')

    expect(screen.getByRole('button', { name: 'Crear invitaciones' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Valide las filas antes de crear las invitaciones.')).toBeTruthy()
  })

  it('says each refused row in Spanish, including the new reason codes', async () => {
    const user = await uploadAndUnderstand()
    await continueToReview(user)
    submitIntakeRows.mockResolvedValue({
      rows: [
        { rowNumber: 4, name: 'Ana Rojas', email: 'ana@meridiano.test', role: 'leader', department: 'Calidad', status: 'error', errors: ['Department is not active: Calidad'], issues: [{ code: 'department_inactive', value: 'Calidad' }] },
        { rowNumber: 5, name: 'Luis Mora', email: 'luis@gmial.com', role: 'employee', department: 'Logística', status: 'error', errors: ['Invalid value'], issues: [{ code: 'invalid_demographic', value: 'gender' }] },
        { rowNumber: 6, name: 'Eva Soto', email: 'eva@gmial.com', role: 'supervisor', department: 'Logística', status: 'duplicate', errors: ['This email already holds a pending invitation'], issues: [{ code: 'already_invited' }] },
      ],
      successCount: 0,
      errorCount: 2,
    })

    await user.click(screen.getByRole('button', { name: 'Validar' }))

    expect(await screen.findByText('El departamento «Calidad» existe, pero no está activo en esta empresa.')).toBeTruthy()
    expect(screen.getByText('Un dato demográfico no coincide con las opciones de su campo (gender).')).toBeTruthy()
    expect(screen.getByText('Este correo ya tiene una invitación pendiente.')).toBeTruthy()
    expect(screen.queryByText(/not active|Invalid value/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Crear invitaciones' }).hasAttribute('disabled')).toBe(true)
  })

  it('goes back to the mapping and forward again without losing the review’s own edits', async () => {
    const user = await uploadAndUnderstand()
    await continueToReview(user)
    const name = screen.getByDisplayValue('Ana Rojas')
    await user.clear(name)
    await user.type(name, 'Ana María Rojas')

    await user.click(screen.getByRole('button', { name: 'Atrás' }))
    await user.click(await screen.findByRole('button', { name: 'Continuar a la revisión' }))

    expect(await screen.findByDisplayValue('Ana María Rojas')).toBeTruthy()
  })
})

describe('IntakeWizard — language', () => {
  /**
   * Every visible string on the showpiece step, in Spanish, with no catalogue key and no English
   * leaking through — the server's own English (`message`) included.
   */
  it('shows no English and no raw key on the understanding step', async () => {
    await uploadAndUnderstand()

    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/users\.intake\./)
    for (const english of ['Confidence', 'Used as', 'Continue', 'Apply changes', 'Before approving', 'High', 'Low', 'Ignore', 'Create “']) {
      expect(text).not.toContain(english)
    }
  })

  it('is equally complete in English', async () => {
    await uploadAndUnderstand(aiUnderstanding(), 'en')

    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/users\.intake\./)
    expect(screen.getByText('The AI only saw the structure of the file.')).toBeTruthy()
    expect(screen.getByText('Emails at “@gmial.com”, which looks like a typo for “@gmail.com” (rows 5, 6).')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue to review' })).toBeTruthy()
  })
})
