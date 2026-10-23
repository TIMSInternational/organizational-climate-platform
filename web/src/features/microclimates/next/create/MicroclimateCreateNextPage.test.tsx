import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { TranslationProvider } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { clearCompanyNameCache } from '../../../../company-context/useCompanyName'
import { tokenFor } from '../../../../test/jwtFixture'
import {
  createMicroclimate,
  getMicroclimate,
  getMicroclimateSeats,
  listMicroclimates,
  replaceMicroclimateContent,
  updateMicroclimate,
  type MicroclimateDetail,
} from '../../api/microclimates'
import { listMicroclimateTemplates } from '../../api/microclimateTemplates'
import MicroclimateCreateNextPage from './MicroclimateCreateNextPage'
import es from '../../../../i18n/es.json'
import { ANONYMITY_FLOOR } from '../../../../components/charts'

const copy = es.microclimates.next.create

vi.mock('../../api/microclimates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/microclimates')>()),
  listMicroclimates: vi.fn(),
  getMicroclimate: vi.fn(),
  createMicroclimate: vi.fn(),
  updateMicroclimate: vi.fn(),
  replaceMicroclimateContent: vi.fn(),
  getMicroclimateSeats: vi.fn(),
}))
vi.mock('../../api/microclimateTemplates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/microclimateTemplates')>()),
  listMicroclimateTemplates: vi.fn(),
}))
// `useCompanyName` reads `GET /profile` for the template note's company.
vi.mock('../../../profile/api/profile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../profile/api/profile')>()),
  getProfile: vi.fn(async () => ({ companyName: 'Grupo Meridiano S.A.' })),
}))

const COMPANY = 'c1'

/** The tenant's only session, as `GET /microclimates/{id}` answered on 11 Sep. */
const previous: MicroclimateDetail = {
  id: 'm1',
  title: 'Pulso semanal — ¿cómo fue la semana?',
  description: 'Cinco minutos, dos preguntas, anónimo.',
  companyId: COMPANY,
  createdBy: 'u-ana',
  status: 'active',
  responseCount: 0,
  targetParticipantCount: 20,
  startTime: '2026-09-10T02:06:08.991+00:00',
  endTime: '2026-09-12T02:06:08.992+00:00',
  anonymousResponses: true,
  showLiveResults: true,
  questions: [
    { id: 'q2', text: 'En una palabra, ¿qué ayudaría más?', type: 'open_ended', options: null, required: false, order: 1, emojiOptions: null },
    { id: 'q1', text: '¿Cómo se sintió esta semana?', type: 'likert', options: null, required: true, order: 0, emojiOptions: null },
  ],
  language: 'en',
  resolvedLocale: 'es',
  fallbackFields: [],
}

/** A Spanish-only draft of the tenant, as `GET /microclimates/d1?lang=es` answers it. */
const draft: MicroclimateDetail = {
  ...previous,
  id: 'd1',
  title: 'Pulso de octubre',
  status: 'draft',
  language: 'es',
  resolvedLocale: 'es',
  targetParticipantCount: 15,
  anonymousResponses: false,
  startTime: '2026-10-23T15:00:00Z',
  endTime: '2026-10-23T17:00:00Z',
  questions: [
    { id: 'dq1', text: '¿Qué cambiaría esta semana?', type: 'open_ended', options: null, required: true, order: 1, emojiOptions: null },
  ],
}

function Landed() {
  const location = useLocation()
  return <div data-testid="landed">{`${location.pathname} ${JSON.stringify(location.state ?? null)}`}</div>
}

function renderAs(claims: Record<string, unknown>, path = '/microclimates/new') {
  setToken(tokenFor({ sub: 'u-ana', nodoId: '', ...claims }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[path]}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/microclimates/new" element={<MicroclimateCreateNextPage />} />
            <Route path="/microclimates/:id/edit" element={<MicroclimateCreateNextPage />} />
            <Route path="/microclimates/:id" element={<Landed />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

async function nameField(): Promise<HTMLInputElement> {
  return (await screen.findByRole('textbox', { name: new RegExp(`^${copy.name}`) })) as HTMLInputElement
}

describe('MicroclimateCreateNextPage', () => {
  beforeEach(() => {
    // Thursday 10 Sep at 21:07, the reader's own clock.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 10, 21, 7))
    window.localStorage.clear()
    window.localStorage.setItem('preferredLocale', 'es')
    vi.mocked(listMicroclimates)
      .mockReset()
      .mockResolvedValue([
        {
          id: 'm1',
          title: previous.title,
          companyId: COMPANY,
          status: 'active',
          language: 'en',
          responseCount: 0,
          targetParticipantCount: 20,
          createdAt: '2026-09-10T02:06:08.994263+00:00',
        },
      ])
    vi.mocked(getMicroclimate).mockReset().mockResolvedValue(previous)
    vi.mocked(createMicroclimate).mockReset().mockResolvedValue({ ...previous, id: 'm2', status: 'draft' })
    vi.mocked(updateMicroclimate).mockReset().mockResolvedValue({ ...previous, id: 'm2' })
    vi.mocked(listMicroclimateTemplates).mockReset().mockResolvedValue([])
    vi.mocked(replaceMicroclimateContent).mockReset().mockResolvedValue({ ...draft, title: 'Pulso de octubre, corregido' })
    vi.mocked(getMicroclimateSeats)
      .mockReset()
      .mockResolvedValue({ licensed: true, status: 'active', seatsTotal: 200, seatsUsed: 37, seatsRemaining: 163 })
  })

  afterEach(() => {
    cleanup()
    clearToken()
    clearCompanyNameCache()
    vi.useRealTimers()
    window.localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  })

  it('starts from the previous session: its questions in order, its expected count, its window, a name for this week', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    await waitFor(async () => expect((await nameField()).value).toBe('Pulso semanal — semana del 10 sept'))
    const texts = screen.getAllByRole('textbox', { name: /Texto de la pregunta/ }).map((field) => (field as HTMLInputElement).value)
    expect(texts).toEqual(['¿Cómo se sintió esta semana?', 'En una palabra, ¿qué ayudaría más?'])
    expect((screen.getByRole('spinbutton', { name: copy.expected }) as HTMLInputElement).value).toBe('20')
    expect(screen.getByText(copy.expectedSame)).toBeTruthy()
    expect(screen.getByText('2 · una escala, una palabra')).toBeTruthy()
    expect(screen.getByText('48 horas, jue 10 a sáb 12')).toBeTruthy()
    expect(
      await screen.findByText(
        'Plantilla: Grupo Meridiano S.A. aún no tiene plantillas de microclima, y una plantilla hoy solo registra en qué se basó la sesión; no trae preguntas.',
      ),
    ).toBeTruthy()
  })

  it('writes Apertura and Cierre as the board does — a leading calendar glyph, the day first, a 24-hour clock — with no native datetime field', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    await waitFor(async () => expect((await nameField()).value).not.toBe(''))
    const opens = screen.getByRole('button', { name: new RegExp(`^${copy.opens} `) })
    const closes = screen.getByRole('button', { name: new RegExp(`^${copy.closes} `) })
    // MicroclimateCreate.dc.html, Programación: "14/09/2026 · 08:00" behind the calendar glyph.
    expect(opens.textContent).toBe('10/09/2026 · 21:00')
    expect(closes.textContent).toBe('12/09/2026 · 21:00')
    expect(opens.firstElementChild?.tagName.toLowerCase()).toBe('svg')
    // The glyph is the calendar, not the picker's clock: lucide names each icon in its class.
    for (const field of [opens, closes]) {
      expect(field.firstElementChild?.getAttribute('class')?.split(' ')).toContain('lucide-calendar')
      expect(field.querySelector('.lucide-clock')).toBeNull()
    }
    // The native field printed the browser's format: "09/10/2026, 09:00 PM" in an en-US browser.
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull()
  })

  it('draws the board’s glyphs and its 34px controls: a plain page on Guardar borrador, a 13px shield in the preview’s chip', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    await waitFor(async () => expect((await nameField()).value).not.toBe(''))
    const paths = (element: Element | null | undefined) =>
      [...(element?.querySelectorAll('path') ?? [])].map((path) => path.getAttribute('d'))
    // MicroclimateCreate.dc.html, the header: a plain page and its fold — not lucide's FileText,
    // whose page carries lines of text.
    const draft = screen.getByRole('button', { name: copy.saveDraft })
    expect(paths(draft)).toEqual(['M4 2h5l3 3v9H4z', 'M9 2v3h3'])
    // The preview's "No se asocia a usted": the board's shield, 13px, inside the 22px chip. The
    // chip's own `[&>svg]:size-3` cannot reach an icon it wraps in a span, so the glyph is sized here.
    const chip = screen
      .getAllByText(es.microclimates.respondAnonymityChip)
      .map((element) => element.closest('[data-slot="chip"]'))
      .find(Boolean)
    const shield = chip?.querySelector('svg')
    expect(paths(shield)).toEqual(['M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z'])
    expect(shield?.getAttribute('class')?.split(' ')).toContain('size-3.25')
    // The canvas's .btn is 34px outside: 32px of content box and its 1px border.
    expect(draft.className.split(' ')).toContain('h-control-canvas')
    expect(screen.getByRole('button', { name: copy.launch }).className.split(' ')).toContain('h-control-canvas')
    expect(
      screen.getByRole('button', { name: copy.questionMenu.replace('{order}', '1') }).className.split(' '),
    ).toContain('size-control-canvas')
    expect(screen.getByText(copy.previewSubmit, { selector: 'span' }).className.split(' ')).toContain('h-control-canvas')
  })

  it('moves Cierre through its picker — a day, then an hh:mm — and the save carries the datetime-local string', async () => {
    const { baseElement } = renderAs({ role: 'company_admin', companyId: COMPANY })
    await waitFor(async () => expect((await nameField()).value).not.toBe(''))
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${copy.closes} `) }))
    await screen.findByRole('grid')
    const day = baseElement.querySelector<HTMLElement>('td[data-day="2026-09-11"] button')
    expect(day).not.toBeNull()
    await userEvent.click(day!)
    const time = screen.getByRole('textbox', { name: copy.time })
    // The day keeps the time it had.
    expect((time as HTMLInputElement).value).toBe('21:00')
    // A full keyboard, not a digit pad: a phone's digit pad has no ":".
    expect(time.getAttribute('inputmode')).toBeNull()
    await userEvent.clear(time)
    // An emptied field is not yet a wrong one.
    expect(screen.queryByText(copy.timeInvalid)).toBeNull()
    // A half-typed time moves nothing and says how to write one.
    await userEvent.type(time, '8:3')
    expect(screen.getByText(copy.timeInvalid)).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(`^${copy.closes} `) }).textContent).toBe('11/09/2026 · 21:00')
    await userEvent.type(time, '0')
    expect(screen.queryByText(copy.timeInvalid)).toBeNull()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('grid')).toBeNull())
    expect(screen.getByRole('button', { name: new RegExp(`^${copy.closes} `) }).textContent).toBe('11/09/2026 · 08:30')
    await userEvent.click(screen.getByRole('button', { name: copy.saveDraft }))
    await waitFor(() => expect(createMicroclimate).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createMicroclimate).mock.calls[0]?.[1]).toMatchObject({
      startTime: '2026-09-10T21:00',
      endTime: '2026-09-11T08:30',
    })
  })

  /**
   * The journey rail's Leer note states the privacy floor, and it is the one floor
   * sentence in this feature that spelled the number instead of interpolating it — so it
   * went on promising "las palabras desde 5" after the platform floor became 3. Asserted
   * against `ANONYMITY_FLOOR` rather than against a literal, which is the whole point: a
   * test naming 3 here would be the same defect one number later.
   */
  it('states the privacy floor in the journey rail from the constant, not from a literal', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })

    const note = es.microclimates.next.journey.readNote.replace('{floor}', String(ANONYMITY_FLOOR))
    expect(await screen.findByText(note)).toBeTruthy()
    // The superseded wording, which is what shipped until the floor moved.
    expect(screen.queryByText('al cerrar: el conteo y las palabras desde 5')).toBeNull()
  })

  it('says what launching does: it opens the session now, and the sweep closes it at the end', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    await waitFor(async () => expect((await nameField()).value).not.toBe(''))
    expect(screen.getByText(/Lanzar crea la sesión y la abre ahora; se cierra sola el 12 sept a las 21:00/)).toBeTruthy()
    expect(screen.queryByText(/lista para abrir/)).toBeNull()
  })

  it('saves a draft through the old page’s create, and only the create', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    await waitFor(async () => expect((await nameField()).value).not.toBe(''))
    await userEvent.click(screen.getByRole('button', { name: copy.saveDraft }))
    await waitFor(() => expect(createMicroclimate).toHaveBeenCalledTimes(1))
    const input = vi.mocked(createMicroclimate).mock.calls[0]?.[1]
    expect(input).toMatchObject({
      title: 'Pulso semanal — semana del 10 sept',
      companyId: COMPANY,
      targetParticipantCount: 20,
      anonymousResponses: true,
      language: 'es',
      startTime: '2026-09-10T21:00',
      endTime: '2026-09-12T21:00',
    })
    expect(input?.questions?.map((question) => [question.text, question.type, question.required])).toEqual([
      ['¿Cómo se sintió esta semana?', 'likert', true],
      ['En una palabra, ¿qué ayudaría más?', 'open_ended', false],
    ])
    expect(updateMicroclimate).not.toHaveBeenCalled()
    expect((await screen.findByTestId('landed')).textContent).toBe('/microclimates/m2 null')
  })

  it('launches: the same create, then the old detail page’s status write', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    await waitFor(async () => expect((await nameField()).value).not.toBe(''))
    await userEvent.click(screen.getByRole('button', { name: copy.launch }))
    await waitFor(() => expect(vi.mocked(updateMicroclimate).mock.calls[0]?.slice(1)).toEqual(['m2', { status: 'active' }]))
    expect((await screen.findByTestId('landed')).textContent).toBe('/microclimates/m2 null')
  })

  it('lands on the draft with the reason when the launch is refused, never offering a second create', async () => {
    vi.mocked(updateMicroclimate).mockRejectedValue(new Error('Faltan traducciones'))
    renderAs({ role: 'company_admin', companyId: COMPANY })
    await waitFor(async () => expect((await nameField()).value).not.toBe(''))
    await userEvent.click(screen.getByRole('button', { name: copy.launch }))
    expect((await screen.findByTestId('landed')).textContent).toBe('/microclimates/m2 {"launchError":"Faltan traducciones"}')
    expect(createMicroclimate).toHaveBeenCalledTimes(1)
  })

  it('refuses to send a session with no name, and says so', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    const name = await nameField()
    await waitFor(() => expect(name.value).not.toBe(''))
    await userEvent.clear(name)
    await userEvent.click(screen.getByRole('button', { name: copy.launch }))
    expect(await screen.findByText(es.microclimates.validationTitleRequired)).toBeTruthy()
    expect(createMicroclimate).not.toHaveBeenCalled()
  })

  it('starts blank when there is no previous session, with the previous-session start unavailable', async () => {
    vi.mocked(listMicroclimates).mockResolvedValue([])
    renderAs({ role: 'company_admin', companyId: COMPANY })
    const previousStart = await screen.findByRole('radio', { name: copy.startPrevious })
    await waitFor(() => expect(previousStart.hasAttribute('disabled')).toBe(true))
    expect(screen.getByRole('radio', { name: copy.startBlank }).getAttribute('aria-checked')).toBe('true')
    expect(getMicroclimate).not.toHaveBeenCalled()
  })

  it('asks a super administrator with no company chosen to choose one before anything is read', async () => {
    renderAs({ role: 'super_admin' })
    expect(await screen.findByText(es.companyContext.chooseACompany)).toBeTruthy()
    expect(listMicroclimates).not.toHaveBeenCalled()
  })

  it('refuses a supervisor before any request is sent', async () => {
    renderAs({ role: 'supervisor', companyId: COMPANY })
    expect(await screen.findByText(es.microclimates.next.noAccessTitle)).toBeTruthy()
    expect(listMicroclimates).not.toHaveBeenCalled()
    expect(listMicroclimateTemplates).not.toHaveBeenCalled()
  })
  // ---- G23: a draft is edited on this same page ----

  it('shows the company’s seats where a session is launched', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    expect(await screen.findByText('Cupos disponibles: 163 de 200 (37 usados)')).toBeTruthy()
    expect(screen.getByText(es.microclimates.next.seats.availableBody)).toBeTruthy()
  })

  it('opens a draft filled in, and saves it through PUT /content — never a second create', async () => {
    vi.mocked(getMicroclimate).mockResolvedValue(draft)
    renderAs({ role: 'company_admin', companyId: COMPANY }, '/microclimates/d1/edit')
    const name = await nameField()
    expect(name.value).toBe('Pulso de octubre')
    expect(screen.getByRole('heading', { level: 1, name: es.microclimates.next.edit.title })).toBeTruthy()
    // The draft is the starting point: no "start from" picker, and the previous session is not read.
    expect(screen.queryByRole('radio', { name: copy.startPrevious })).toBeNull()
    expect(listMicroclimates).not.toHaveBeenCalled()
    expect(vi.mocked(getMicroclimate).mock.calls[0]?.slice(1)).toEqual(['d1', 'es'])

    await userEvent.clear(name)
    await userEvent.type(name, 'Pulso de octubre, corregido')
    await userEvent.click(screen.getByRole('button', { name: es.microclimates.next.edit.save }))

    await waitFor(() => expect(replaceMicroclimateContent).toHaveBeenCalledTimes(1))
    const [, id, input] = vi.mocked(replaceMicroclimateContent).mock.calls[0]!
    expect(id).toBe('d1')
    expect(input).toMatchObject({ title: 'Pulso de octubre, corregido', language: 'es', targetParticipantCount: 15, anonymousResponses: false })
    expect(input.questions?.map((question) => question.text)).toEqual(['¿Qué cambiaría esta semana?'])
    expect(input).not.toHaveProperty('companyId')
    expect(createMicroclimate).not.toHaveBeenCalled()
    expect(updateMicroclimate).not.toHaveBeenCalled()
    expect((await screen.findByTestId('landed')).textContent).toBe('/microclimates/d1 null')
  })

  it('launches an edited draft: the save, then the status write', async () => {
    vi.mocked(getMicroclimate).mockResolvedValue(draft)
    vi.mocked(replaceMicroclimateContent).mockResolvedValue(draft)
    renderAs({ role: 'company_admin', companyId: COMPANY }, '/microclimates/d1/edit')
    await nameField()
    await userEvent.click(screen.getByRole('button', { name: copy.launch }))
    await waitFor(() => expect(vi.mocked(updateMicroclimate).mock.calls[0]?.slice(1)).toEqual(['d1', { status: 'active' }]))
    expect(createMicroclimate).not.toHaveBeenCalled()
  })

  it('offers no form for a session that is no longer a draft', async () => {
    vi.mocked(getMicroclimate).mockResolvedValue({ ...draft, status: 'active' })
    renderAs({ role: 'company_admin', companyId: COMPANY }, '/microclimates/d1/edit')
    expect(await screen.findByText(es.microclimates.next.edit.notDraftTitle)).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('link', { name: es.microclimates.next.edit.backToSession }).getAttribute('href')).toBe('/microclimates/d1')
  })
})
