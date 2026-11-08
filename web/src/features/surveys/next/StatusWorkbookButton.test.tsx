import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranslationProvider } from '../../../i18n'
import { listSurveys, type SurveyListItem } from '../api/surveys'
import { StatusWorkbookButton } from './StatusWorkbookButton'
import { distributedSurveys } from './statusWorkbookChoices'
import en from '../../../i18n/en.json'

const copy = en.surveys.next.statusWorkbook

vi.mock('../../../api/authFetch', () => ({ authFetch: vi.fn() }))
vi.mock('../api/surveys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/surveys')>()),
  listSurveys: vi.fn(),
}))
const { authFetch } = await import('../../../api/authFetch')

const WORKBOOK = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function row(over: Partial<SurveyListItem>): SurveyListItem {
  return {
    id: 'id',
    title: 'T',
    companyId: 'c1',
    type: 'periodic',
    status: 'active',
    language: 'es',
    startDate: '2026-01-01T00:00:00Z',
    endDate: '2026-02-01T00:00:00Z',
    responseCount: 0,
    targetAudienceCount: null,
    questionCount: 6,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  }
}

const COMPANY_SURVEYS = [
  row({ id: 'clima', title: 'Clima Organizacional', createdAt: '2026-01-01T00:00:00Z' }),
  row({ id: 'contraloria', title: 'Contraloría Empresarial', status: 'closed', createdAt: '2026-02-01T00:00:00Z' }),
  row({ id: 'teletrabajo', title: 'Teletrabajo', createdAt: '2026-03-01T00:00:00Z' }),
]

function renderPicker() {
  return render(
    <TranslationProvider>
      <StatusWorkbookButton companyId="c1" companyName="ESPH" baseUrl="https://api.example.test" label="Estado" />
    </TranslationProvider>,
  )
}

/** The URL the component asked the server for, which is the whole contract. */
function requestedUrl() {
  return String(vi.mocked(authFetch).mock.calls[0]?.[0] ?? '')
}

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Estado' }))
  // Wait for the company's list to land, so the sheets are on screen.
  await screen.findByRole('checkbox', { name: copy.all })
}

describe('picking which surveys go in the status workbook', () => {
  let clicked: { name?: string }
  let realClick: () => void

  beforeEach(() => {
    vi.mocked(authFetch).mockReset()
    vi.mocked(authFetch).mockResolvedValue(
      new Response('xlsx', { status: 200, headers: { 'content-type': WORKBOOK } }),
    )
    vi.mocked(listSurveys).mockReset()
    vi.mocked(listSurveys).mockResolvedValue(COMPANY_SURVEYS)
    clicked = {}
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
    realClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      clicked.name = this.download
    }
  })

  afterEach(() => {
    HTMLAnchorElement.prototype.click = realClick
    cleanup()
    vi.unstubAllGlobals()
  })

  it('asks for ESPH’s progress layout when it is chosen, and for the full one by default', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    // The default sends no format at all: the request every caller sent before the choice.
    expect(screen.getByRole('radio', { name: new RegExp(`^${copy.formatStandard}`) }).getAttribute('aria-checked')).toBe('true')
    await user.click(screen.getByRole('radio', { name: new RegExp(`^${copy.formatProgress.replace(/[()]/g, '\\$&')}`) }))
    await user.click(screen.getByRole('button', { name: copy.download }))

    await waitFor(() => expect(clicked.name).toBeDefined())
    expect(requestedUrl()).toBe(
      'https://api.example.test/admin/companies/c1/participation/export?survey=clima&survey=contraloria&survey=teletrabajo&format=progress',
    )
  })

  it('opens a picker rather than downloading straight away', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByRole('button', { name: 'Estado' }))

    expect(await screen.findByText(copy.description)).toBeTruthy()
    expect(vi.mocked(authFetch)).not.toHaveBeenCalled()
  })

  /**
   * The bug this pins: the list pages send the reader's search to `GET /surveys`, so building
   * the picker from their rows would offer whatever was last searched for while calling itself
   * the company's status. The dialog asks for the company and nothing else.
   */
  it('asks for the company own unfiltered list, not a filtered page of it', async () => {
    const user = userEvent.setup()
    renderPicker()

    await openPicker(user)

    // The filters are the point: the company and NOTHING else. No `q`, no `status`.
    expect(vi.mocked(listSurveys).mock.calls[0][0]).toBe('https://api.example.test')
    expect(vi.mocked(listSurveys).mock.calls[0][1]).toEqual({ companyId: 'c1' })
  })

  it('starts with every survey ticked', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    for (const title of ['Clima Organizacional', 'Contraloría Empresarial', 'Teletrabajo']) {
      expect(screen.getByRole('checkbox', { name: title }).getAttribute('aria-checked')).toBe('true')
    }
    expect(screen.getByRole('checkbox', { name: copy.all }).getAttribute('aria-checked')).toBe('true')
  })

  /**
   * Every ticked id is named even when that is all of them. Asking for "no filter" instead
   * would hand back whatever the server counts as distributed now, which can include a survey
   * that went out since the dialog opened — a sheet in a client's file nobody reviewed.
   */
  it('names every ticked survey, so the file holds exactly what was on screen', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    await user.click(screen.getByRole('button', { name: copy.download }))

    await waitFor(() => expect(clicked.name).toBeDefined())
    expect(requestedUrl()).toBe(
      'https://api.example.test/admin/companies/c1/participation/export'
      + '?survey=clima&survey=contraloria&survey=teletrabajo',
    )
  })

  it('names only the surveys left ticked', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    await user.click(screen.getByRole('checkbox', { name: 'Contraloría Empresarial' }))
    await user.click(screen.getByRole('button', { name: copy.download }))

    await waitFor(() => expect(clicked.name).toBeDefined())
    expect(requestedUrl()).toBe(
      'https://api.example.test/admin/companies/c1/participation/export?survey=clima&survey=teletrabajo',
    )
  })

  /**
   * The name sits in a `<label>` beside the box. `<button>` IS a labelable element, so the
   * label forwards its click — which can toggle twice (once forwarded, once bubbled) and
   * land back where it started. Clicking the words must change the state exactly once.
   */
  it('toggles when the survey name itself is clicked, exactly once', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    await user.click(screen.getByText('Clima Organizacional'))

    expect(screen.getByRole('checkbox', { name: 'Clima Organizacional' }).getAttribute('aria-checked')).toBe('false')
  })

  it('cannot be downloaded with nothing ticked', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    await user.click(screen.getByRole('checkbox', { name: copy.all }))

    expect(screen.getByRole('button', { name: copy.download }).hasAttribute('disabled')).toBe(true)
  })

  it('ticks and unticks everything from the one box', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    await user.click(screen.getByRole('checkbox', { name: copy.all }))
    expect(screen.getByRole('checkbox', { name: 'Clima Organizacional' }).getAttribute('aria-checked')).toBe('false')

    await user.click(screen.getByRole('checkbox', { name: copy.all }))
    expect(screen.getByRole('checkbox', { name: 'Clima Organizacional' }).getAttribute('aria-checked')).toBe('true')
  })

  /** A browser gives no sign that a fetch rejected, so the dialog has to say it. */
  it('says so when the file cannot be prepared', async () => {
    vi.mocked(authFetch).mockResolvedValue(new Response('no', { status: 500 }))
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    await user.click(screen.getByRole('button', { name: copy.download }))

    expect(await screen.findByText(copy.failed)).toBeTruthy()
  })

  it('says so when the survey list itself cannot be loaded, instead of offering an empty pick', async () => {
    vi.mocked(listSurveys).mockRejectedValue(new Error('nope'))
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByRole('button', { name: 'Estado' }))

    expect(await screen.findByText(copy.loadFailed)).toBeTruthy()
    expect(screen.getByRole('button', { name: copy.download }).hasAttribute('disabled')).toBe(true)
  })

  /** Unchanged behaviour for an empty company: an openable file, not a refusal. */
  it('still asks for a file when the company has nothing distributed', async () => {
    vi.mocked(listSurveys).mockResolvedValue([])
    const user = userEvent.setup()
    renderPicker()
    await user.click(screen.getByRole('button', { name: 'Estado' }))
    expect(await screen.findByText(copy.none)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: copy.download }))

    await waitFor(() => expect(clicked.name).toBeDefined())
    expect(requestedUrl()).toBe('https://api.example.test/admin/companies/c1/participation/export')
  })
})

describe('which surveys the workbook can hold', () => {
  const rows = [
    { id: 'b', title: 'B', companyId: 'c1', status: 'active', createdAt: '2026-02-01T00:00:00Z' },
    { id: 'draft', title: 'Draft', companyId: 'c1', status: 'draft', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'a', title: 'A', companyId: 'c1', status: 'closed', createdAt: '2026-01-15T00:00:00Z' },
    { id: 'other', title: 'Other', companyId: 'c2', status: 'active', createdAt: '2026-01-02T00:00:00Z' },
    { id: 'sched', title: 'Scheduled', companyId: 'c1', status: 'scheduled', createdAt: '2026-03-01T00:00:00Z' },
  ]

  it('leaves out a draft, because nobody was invited to one', () => {
    expect(distributedSurveys(rows, 'c1').map((s) => s.id)).not.toContain('draft')
  })

  /**
   * A scheduled survey is NOT a draft, so the server counts it as distributed. If this list
   * dropped it, a pick would quietly omit a sheet the server would have included.
   */
  it('keeps a scheduled survey, matching the server rule of everything but a draft', () => {
    expect(distributedSurveys(rows, 'c1').map((s) => s.id)).toContain('sched')
  })

  it('leaves out another company', () => {
    expect(distributedSurveys(rows, 'c1').map((s) => s.id)).not.toContain('other')
  })

  /** The order the dialog lists them in is the order the workbook's tabs will be in. */
  it('orders them by creation, as the workbook does', () => {
    expect(distributedSurveys(rows, 'c1').map((s) => s.id)).toEqual(['a', 'b', 'sched'])
  })
})
