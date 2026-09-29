import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IntakeWizard from './IntakeWizard'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../i18n'
import { IntakeRequestError, type IntakeParseResult } from '../api/intake'
import type { BulkImportResponse } from '../api/bulkImport'

const parseIntakeWorkbook = vi.fn<() => Promise<IntakeParseResult>>()
const submitIntakeRows = vi.fn<() => Promise<BulkImportResponse>>()
const getIntakeTemplate = vi.fn<() => Promise<Blob>>()

vi.mock('../api/intake', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  parseIntakeWorkbook: (...args: unknown[]) => parseIntakeWorkbook(...(args as [])),
  submitIntakeRows: (...args: unknown[]) => submitIntakeRows(...(args as [])),
  getIntakeTemplate: (...args: unknown[]) => getIntakeTemplate(...(args as [])),
}))

const downloadBlobFile = vi.fn()
vi.mock('../../../lib/downloadBlobFile', () => ({
  downloadBlobFile: (...args: unknown[]) => downloadBlobFile(...(args as [])),
}))

function renderWizard(onImported = vi.fn(), locale: 'en' | 'es' = 'en') {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  return render(
    <TranslationProvider>
      <IntakeWizard baseUrl="http://api.test" companyId="c1" onImported={onImported} />
    </TranslationProvider>,
  )
}

/** The file object itself is never read: `parseIntakeWorkbook` is mocked. */
function xlsx() {
  return new File([new Uint8Array([1, 2, 3])], 'personas.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

const oneGoodRow: IntakeParseResult = {
  rows: [{ rowNumber: 5, name: 'Ana Rojas', email: 'ana@meridiano.test', role: 'employee', department: 'Ingeniería' }],
  problems: [],
}

const allValid: BulkImportResponse = {
  rows: [{ rowNumber: 5, name: 'Ana Rojas', email: 'ana@meridiano.test', role: 'employee', department: 'Ingeniería', status: 'valid', errors: [] }],
  successCount: 1,
  errorCount: 0,
}

async function uploadAndReachReview() {
  const user = userEvent.setup()
  parseIntakeWorkbook.mockResolvedValue(oneGoodRow)
  renderWizard()
  await user.upload(screen.getByLabelText(/Upload the completed workbook/), xlsx())
  await screen.findByDisplayValue('Ana Rojas')
  return user
}

beforeEach(() => {
  parseIntakeWorkbook.mockReset()
  submitIntakeRows.mockReset()
  getIntakeTemplate.mockReset()
  downloadBlobFile.mockReset()
})

afterEach(() => {
  cleanup()
  localStorage.removeItem(LOCALE_STORAGE_KEY)
})

describe('IntakeWizard', () => {
  it('hands the template over as a Blob, never as a link', async () => {
    const user = userEvent.setup()
    const blob = new Blob(['x'])
    getIntakeTemplate.mockResolvedValue(blob)
    renderWizard()

    await user.click(screen.getByRole('button', { name: 'Download template' }))

    // The route is authorized, so an <a href> would send cookies and not the bearer
    // header. `surveyExport.ts` states the rule; this pins it for the intake too.
    await waitFor(() => expect(downloadBlobFile).toHaveBeenCalledWith('people-template.xlsx', blob))
  })

  it('shows every parsed row as something editable before anything is created', async () => {
    await uploadAndReachReview()

    expect(screen.getByDisplayValue('ana@meridiano.test')).toBeTruthy()
    expect(screen.getByDisplayValue('Ingeniería')).toBeTruthy()
    // Nothing has been submitted merely by reading the file.
    expect(submitIntakeRows).not.toHaveBeenCalled()
  })

  it('refuses to create anything until the rows have been validated', async () => {
    await uploadAndReachReview()

    const approve = screen.getByRole('button', { name: 'Create invitations' })
    expect(approve.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Validate the rows before creating invitations.')).toBeTruthy()
  })

  it('enables approval once the server says every row is valid', async () => {
    const user = await uploadAndReachReview()
    submitIntakeRows.mockResolvedValue(allValid)

    await user.click(screen.getByRole('button', { name: 'Validate' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create invitations' }).hasAttribute('disabled')).toBe(false),
    )
    // Validation is a preview: the fourth argument is the `preview` flag.
    expect(submitIntakeRows).toHaveBeenCalledWith('http://api.test', 'c1', expect.anything(), true)
  })

  /**
   * The property the whole step exists for. Validating, then editing, then approving would
   * otherwise create something nobody ever checked.
   */
  it('withdraws approval again as soon as a cell is edited', async () => {
    const user = await uploadAndReachReview()
    submitIntakeRows.mockResolvedValue(allValid)

    await user.click(screen.getByRole('button', { name: 'Validate' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create invitations' }).hasAttribute('disabled')).toBe(false),
    )

    await user.type(screen.getByDisplayValue('ana@meridiano.test'), 'x')

    expect(screen.getByRole('button', { name: 'Create invitations' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Validate the rows before creating invitations.')).toBeTruthy()
  })

  it('keeps approval shut while any row is still in error', async () => {
    const user = await uploadAndReachReview()
    submitIntakeRows.mockResolvedValue({
      rows: [{ ...allValid.rows[0], status: 'error', errors: ['Invalid email format'], issues: [{ code: 'invalid_email' }] }],
      successCount: 0,
      errorCount: 1,
    })

    await user.click(screen.getByRole('button', { name: 'Validate' }))

    await waitFor(() => expect(screen.getByText('The email is not in a valid format.')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Create invitations' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Fix the rows marked with an error, then validate again.')).toBeTruthy()
  })

  it('commits with preview off and tells the caller to reload', async () => {
    const onImported = vi.fn()
    const user = userEvent.setup()
    parseIntakeWorkbook.mockResolvedValue(oneGoodRow)
    renderWizard(onImported)
    await user.upload(screen.getByLabelText(/Upload the completed workbook/), xlsx())
    await screen.findByDisplayValue('Ana Rojas')

    submitIntakeRows.mockResolvedValue(allValid)
    await user.click(screen.getByRole('button', { name: 'Validate' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create invitations' }).hasAttribute('disabled')).toBe(false),
    )

    submitIntakeRows.mockResolvedValue({ ...allValid, rows: [{ ...allValid.rows[0], status: 'invited' }] })
    await user.click(screen.getByRole('button', { name: 'Create invitations' }))

    await waitFor(() => expect(onImported).toHaveBeenCalled())
    expect(submitIntakeRows).toHaveBeenLastCalledWith('http://api.test', 'c1', expect.anything(), false)
  })

  it('shows a file-level problem instead of pretending the file was empty', async () => {
    const user = userEvent.setup()
    parseIntakeWorkbook.mockResolvedValue({
      rows: [],
      problems: [{ sheet: 'Personas', message: 'The workbook has no sheet named "Personas".', code: 'no_people_sheet', value: 'Personas' }],
    })
    renderWizard()

    await user.upload(screen.getByLabelText(/Upload the completed workbook/), xlsx())

    expect(await screen.findByText('The workbook has no “Personas” sheet. Use the downloaded template.')).toBeTruthy()
  })

  it('offers a way back from a file with no rows, rather than a dead end', async () => {
    const user = userEvent.setup()
    parseIntakeWorkbook.mockResolvedValue({
      rows: [],
      problems: [{ sheet: 'Personas', message: 'The sheet has a header but no data rows.', code: 'no_data_rows' }],
    })
    renderWizard()

    await user.upload(screen.getByLabelText(/Upload the completed workbook/), xlsx())
    await user.click(await screen.findByRole('button', { name: 'Back' }))

    expect(screen.getByRole('button', { name: 'Download template' })).toBeTruthy()
  })

  it('reports a refusal from the parse route rather than a blank screen', async () => {
    const user = userEvent.setup()
    parseIntakeWorkbook.mockRejectedValue(
      new IntakeRequestError('This file could not be read as an Excel workbook (.xlsx).', 'not_a_workbook', 400),
    )
    renderWizard(vi.fn(), 'es')

    await user.upload(screen.getByLabelText(/Suba el libro completado/), xlsx())

    expect(
      await screen.findByText('Este archivo no se pudo leer como un libro de Excel (.xlsx). Suba la plantilla completada.'),
    ).toBeTruthy()
    expect(screen.queryByText(/could not be read/)).toBeNull()
  })

  it('never prints a server sentence it has no translation for at a Spanish reader', async () => {
    const user = userEvent.setup()
    parseIntakeWorkbook.mockRejectedValue(new IntakeRequestError('Request failed: 500', null, 500))
    renderWizard(vi.fn(), 'es')

    await user.upload(screen.getByLabelText(/Suba el libro completado/), xlsx())

    expect(await screen.findByText('Ocurrió un error. Por favor intenta nuevamente.')).toBeTruthy()
    expect(screen.queryByText(/Request failed/)).toBeNull()
  })

  it('says each refused row in Spanish, naming the department and which duplicate it is', async () => {
    const user = userEvent.setup()
    parseIntakeWorkbook.mockResolvedValue({
      rows: [
        { rowNumber: 5, name: 'Ana Rojas', email: 'ana@meridiano.test', role: 'employee', department: 'Marketing' },
        { rowNumber: 6, name: 'Luis Mora', email: 'luis@meridiano.test', role: 'employee', department: null },
        { rowNumber: 7, name: 'Eva Soto', email: 'eva@meridiano.test', role: 'employee', department: null },
      ],
      problems: [],
    })
    renderWizard(vi.fn(), 'es')
    await user.upload(screen.getByLabelText(/Suba el libro completado/), xlsx())
    await screen.findByDisplayValue('Ana Rojas')

    submitIntakeRows.mockResolvedValue({
      rows: [
        { rowNumber: 5, name: 'Ana Rojas', email: 'ana@meridiano.test', role: 'employee', department: 'Marketing', status: 'error', errors: ['Department not found: Marketing'], issues: [{ code: 'department_not_found', value: 'Marketing' }] },
        { rowNumber: 6, name: 'Luis Mora', email: 'luis@meridiano.test', role: 'employee', department: null, status: 'duplicate', errors: ['This email already holds a pending invitation'], issues: [{ code: 'already_invited' }] },
        { rowNumber: 7, name: 'Eva Soto', email: 'eva@meridiano.test', role: 'employee', department: null, status: 'error', errors: ['Something new'], issues: [{ code: 'a_code_this_screen_predates' }] },
      ],
      successCount: 0,
      errorCount: 3,
    })
    await user.click(screen.getByRole('button', { name: 'Validar' }))

    expect(await screen.findByText('El departamento «Marketing» no existe o no está activo en esta empresa.')).toBeTruthy()
    expect(screen.getByText('Este correo ya tiene una invitación pendiente.')).toBeTruthy()
    expect(screen.queryByText(/Department not found/)).toBeNull()
    // A code this screen was not written for still explains the row, in the server's words.
    expect(screen.getByText('Something new')).toBeTruthy()
  })
})
