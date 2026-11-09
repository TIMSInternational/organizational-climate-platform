import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SurveyRosterPanel from './SurveyRosterPanel'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import { clearToken, setToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'
import es from '../../../../i18n/es.json'
import type { SurveyParticipationView, SurveyRosterRow } from '../../api/surveys'

const T = es.surveys.next.roster.exclusion
const SURVEY = '22222222-2222-2222-2222-222222222222'

function row(over: Partial<SurveyRosterRow> & { userId: string; name: string }): SurveyRosterRow {
  return { email: `${over.userId}@esph.test`, username: `esph-${over.userId}`, role: 'employee', status: 'not_started', lastActivityOn: null, demographics: [], ...over }
}

const MARTA = row({ userId: 'marta', name: 'Marta Villalobos', status: 'completed', lastActivityOn: '2026-10-28' })
const HUGO = row({ userId: 'hugo', name: 'Hugo Peralta', status: 'started', lastActivityOn: '2026-10-29' })
const OUT = row({ userId: 'out', name: 'Ana Sancho', status: 'completed', lastActivityOn: '2026-10-28', excludedFromResults: true })

function view(roster: SurveyRosterRow[]): SurveyParticipationView {
  return {
    surveyId: SURVEY,
    tracksCompletionOnly: false,
    collectsParticipantIdentity: false,
    answeredCount: roster.filter((r) => r.status === 'completed').length,
    pendingCount: roster.filter((r) => r.status !== 'completed').length,
    answered: [],
    pending: [],
    startedCount: roster.filter((r) => r.status === 'started').length,
    notStartedCount: 0,
    roster,
    tracksIndividuals: true,
  }
}

function stubFetch(status = 200, body: unknown = { excluded: true, changed: true, responseCount: 411 }) {
  const sent: { url: string; body: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), body: init?.body ? (JSON.parse(String(init.body)) as unknown) : null })
      return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
    }),
  )
  return sent
}

function renderPanel(roster: SurveyRosterRow[]) {
  return render(
    <TranslationProvider>
      <SurveyRosterPanel state={{ status: 'ready', view: view(roster) }} />
    </TranslationProvider>,
  )
}

const named = (template: string, name: string) => template.replace('{name}', name)

/**
 * «Excluir de los resultados» (ruled 2026-11-08): ESPH's 28 Oct case, from the roster, by TIMS
 * only -- and never visible to a client administrator, who could otherwise subtract the results
 * to recover the person's answers.
 */
describe('Excluding one response from the results', () => {
  beforeEach(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    setToken(tokenFor({ role: 'super_admin' }))
  })

  afterEach(() => {
    cleanup()
    clearToken()
    vi.unstubAllGlobals()
  })

  it('is offered to a super admin on somebody who finished, and only on them', async () => {
    stubFetch()
    renderPanel([MARTA, HUGO])
    await screen.findByText('Marta Villalobos')

    expect(screen.getByRole('button', { name: named(T.excludeFor, 'Marta Villalobos') })).toBeTruthy()
    expect(screen.queryByRole('button', { name: named(T.excludeFor, 'Hugo Peralta') })).toBeNull()
  })

  it('is never offered to a client administrator', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: '11111111-1111-1111-1111-111111111111' }))
    stubFetch()
    renderPanel([MARTA, OUT])
    await screen.findByText('Marta Villalobos')

    expect(screen.queryByText(T.exclude)).toBeNull()
    expect(screen.queryByText(T.restore)).toBeNull()
  })

  it('asks for a reason, says what subtraction reveals, and sends the person in the body', async () => {
    const sent = stubFetch()
    const user = userEvent.setup()
    renderPanel([MARTA])
    await screen.findByText('Marta Villalobos')

    await user.click(screen.getByRole('button', { name: named(T.excludeFor, 'Marta Villalobos') }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(T.subtraction)).toBeTruthy()
    const confirm = within(dialog).getByRole('button', { name: T.excludeConfirm })
    expect(confirm.hasAttribute('disabled')).toBe(true)

    await user.type(within(dialog).getByLabelText(T.reasonLabel), 'No está en la lista del cliente')
    await user.click(confirm)

    expect(sent).toEqual([
      { url: expect.stringMatching(new RegExp(`/surveys/${SURVEY}/response-exclusions$`)) as unknown as string, body: { userId: 'marta', reason: 'No está en la lista del cliente' } },
    ])
    expect(await screen.findByText(named(T.excludeDone, 'Marta Villalobos'))).toBeTruthy()
    expect(screen.getByText(T.excludedChip)).toBeTruthy()
    expect(screen.getByRole('button', { name: named(T.restoreFor, 'Marta Villalobos') })).toBeTruthy()
  })

  it('shows an excluded response as such, and puts it back without asking for a reason', async () => {
    const sent = stubFetch(200, { excluded: false, changed: true, responseCount: 412 })
    const user = userEvent.setup()
    renderPanel([OUT])
    await screen.findByText('Ana Sancho')
    expect(screen.getByText(T.excludedChip)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: named(T.restoreFor, 'Ana Sancho') }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByLabelText(T.reasonLabel)).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: T.restoreConfirm }))

    expect(sent[0].url).toMatch(/\/response-exclusions\/restore$/)
    expect(sent[0].body).toEqual({ userId: 'out' })
    expect(await screen.findByText(named(T.restoreDone, 'Ana Sancho'))).toBeTruthy()
    expect(screen.queryByText(T.excludedChip)).toBeNull()
  })

  it('says the server refusal in Spanish and changes nothing on the row', async () => {
    stubFetch(409, { code: 'exclusion_no_response', message: 'English' })
    const user = userEvent.setup()
    renderPanel([MARTA])
    await screen.findByText('Marta Villalobos')

    await user.click(screen.getByRole('button', { name: named(T.excludeFor, 'Marta Villalobos') }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(T.reasonLabel), 'Motivo suficiente')
    await user.click(within(dialog).getByRole('button', { name: T.excludeConfirm }))

    expect(await within(dialog).findByText(es.errors.api.codes.exclusion_no_response)).toBeTruthy()
    expect(screen.queryByText(T.excludedChip)).toBeNull()
  })
})
