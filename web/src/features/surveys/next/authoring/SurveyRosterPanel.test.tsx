import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SurveyRosterPanel from './SurveyRosterPanel'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import { clearToken, setToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'
import es from '../../../../i18n/es.json'
import type { SurveyParticipationView, SurveyRosterRow } from '../../api/surveys'
import { formatParticipationDay } from './participationDay'

const T = es.surveys.next.roster
const COMPANY = '11111111-1111-1111-1111-111111111111'
const SURVEY = '22222222-2222-2222-2222-222222222222'

function row(over: Partial<SurveyRosterRow> & { userId: string; name: string }): SurveyRosterRow {
  return {
    email: `${over.userId}@esph.test`,
    username: `esph-${over.userId}`,
    role: 'employee',
    status: 'not_started',
    lastActivityOn: null,
    demographics: [],
    ...over,
  }
}

const MARTA = row({
  userId: 'marta',
  name: 'Marta Villalobos',
  status: 'completed',
  lastActivityOn: '2026-10-12',
  demographics: [
    { field: 'puesto', labelEs: 'Puesto', labelEn: 'Position', value: 'Gerente' },
    { field: 'antiguedad', labelEs: 'Antigüedad', labelEn: 'Tenure', value: 'Más de 10 años' },
  ],
})
const HUGO = row({ userId: 'hugo', name: 'Hugo Peralta', status: 'started', lastActivityOn: '2026-10-13' })
const ANA = row({ userId: 'ana', name: 'Ana Lucía Mora', status: 'not_started' })
const ADMIN = row({ userId: 'admin', name: 'Admin Rojas', username: null, role: 'company_admin' })

function view(over: Partial<SurveyParticipationView> = {}): SurveyParticipationView {
  const roster = over.roster ?? [ADMIN, ANA, HUGO, MARTA]
  return {
    surveyId: SURVEY,
    tracksCompletionOnly: false,
    collectsParticipantIdentity: false,
    answeredCount: roster.filter((r) => r.status === 'completed').length,
    pendingCount: roster.filter((r) => r.status !== 'completed').length,
    answered: [],
    pending: [],
    startedCount: roster.filter((r) => r.status === 'started').length,
    notStartedCount: roster.filter((r) => r.status === 'not_started').length,
    roster,
    tracksIndividuals: true,
    ...over,
  }
}

type Sent = { url: string; body: unknown }

function fetchWith(
  participation: SurveyParticipationView,
  onPost?: (ids: string[]) => unknown,
  onReissue?: (userId: string) => { status: number; body: unknown },
  onRevoke?: (userId: string) => { status: number; body: unknown },
  onRemind?: (userId: string) => { status: number; body: unknown },
) {
  const sent: Sent[] = []
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    // Withdrawing a key is a DELETE on the credential itself, so it is matched before the
    // reissue POST below -- the two paths differ only by the trailing segment.
    const revoke = /\/surveys\/[^/]+\/credentials\/([^/]+)$/.exec(url)
    if (revoke && (init?.method ?? 'GET').toUpperCase() === 'DELETE') {
      sent.push({ url, body: null })
      const answer = onRevoke?.(revoke[1]) ?? {
        status: 200,
        body: { surveyId: SURVEY, userId: revoke[1], username: 'x', hadSignedIn: false, issuedOn: '2026-10-20' },
      }
      return Promise.resolve(
        new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'Content-Type': 'application/json' } }),
      )
    }
    // Matched before the generic POST below, which parses a JSON body -- a reminder sends none,
    // so falling through to it would throw rather than fail an assertion.
    const remind = /\/surveys\/[^/]+\/credentials\/([^/]+)\/remind$/.exec(url)
    if (remind && (init?.method ?? 'GET').toUpperCase() === 'POST') {
      sent.push({ url, body: null })
      const answer = onRemind?.(remind[1]) ?? {
        status: 200,
        body: { surveyId: SURVEY, userId: remind[1], username: 'x', delivered: true, failureReason: null },
      }
      return Promise.resolve(
        new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'Content-Type': 'application/json' } }),
      )
    }
    const reissue = /\/surveys\/[^/]+\/credentials\/([^/]+)\/reissue$/.exec(url)
    if (reissue && (init?.method ?? 'GET').toUpperCase() === 'POST') {
      // The October reissue sends no body; a handover sends its options, which the tests read.
      sent.push({ url, body: init?.body ? (JSON.parse(String(init.body)) as unknown) : null })
      const answer = onReissue?.(reissue[1]) ?? {
        status: 200,
        body: { surveyId: SURVEY, userId: reissue[1], username: 'x', delivered: true, failureReason: null, issuedOn: '2026-10-22' },
      }
      return Promise.resolve(
        new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'Content-Type': 'application/json' } }),
      )
    }
    if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
      const body = JSON.parse(String(init?.body)) as { userIds: string[] }
      sent.push({ url, body })
      const outcomes = onPost
        ? onPost(body.userIds)
        : body.userIds.map((userId) => ({ userId, email: null, delivered: true, failureReason: null, code: null }))
      const list = outcomes as { delivered: boolean }[]
      return Promise.resolve(
        new Response(
          JSON.stringify({
            requested: body.userIds.length,
            sent: list.filter((o) => o.delivered).length,
            failed: list.filter((o) => !o.delivered).length,
            outcomes: list,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }
    return Promise.resolve(
      new Response(JSON.stringify(participation), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
  })
  return { mock, sent }
}

/**
 * The panel takes the payload rather than fetching it: the page fetches once and hands it to
 * both panels that read it. `fetch` is still stubbed because the RESEND posts through it.
 */
function renderPanel(payload: SurveyParticipationView) {
  return render(
    <TranslationProvider>
      <SurveyRosterPanel state={{ status: 'ready', view: payload }} />
    </TranslationProvider>,
  )
}

/**
 * The screen an administrator watches all launch day: every invited person, how they sign in,
 * which of the THREE states they are in, and the demographics the import uploaded.
 */
describe('SurveyRosterPanel', () => {
  beforeEach(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    setToken(tokenFor({ role: 'company_admin', companyId: COMPANY }))
  })

  afterEach(() => {
    cleanup()
    clearToken()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('separates the person who stopped halfway from the person who never opened it', async () => {
    const payload = view()
    vi.stubGlobal('fetch', fetchWith(payload).mock)
    renderPanel(payload)

    expect(await screen.findByText('Marta Villalobos')).toBeTruthy()
    expect(within(rowOf('marta')).getByText(T.statusCompleted)).toBeTruthy()
    expect(within(rowOf('hugo')).getByText(T.statusStarted)).toBeTruthy()
    expect(within(rowOf('ana')).getByText(T.statusNotStarted)).toBeTruthy()

    // The counts an administrator reads off the filters, each from the payload's own field.
    expect(screen.getByRole('button', { name: new RegExp(`^${T.filterStarted}`) }).textContent).toContain('1')
    expect(screen.getByRole('button', { name: new RegExp(`^${T.filterNotStarted}`) }).textContent).toContain('2')
  })

  it('filters to just the people who started and did not finish', async () => {
    const payload = view()
    vi.stubGlobal('fetch', fetchWith(payload).mock)
    const user = userEvent.setup()
    renderPanel(payload)
    await screen.findByText('Marta Villalobos')

    await user.click(screen.getByRole('button', { name: new RegExp(`^${T.filterStarted}`) }))

    expect(screen.getByText('Hugo Peralta')).toBeTruthy()
    expect(screen.queryByText('Marta Villalobos')).toBeNull()
    expect(screen.queryByText('Ana Lucía Mora')).toBeNull()
  })

  it('shows the usuario, and offers no resend to an account that signs in by email', async () => {
    const payload = view()
    vi.stubGlobal('fetch', fetchWith(payload).mock)
    renderPanel(payload)
    await screen.findByText('Marta Villalobos')

    expect(within(rowOf('marta')).getByText('esph-marta')).toBeTruthy()
    // El rol, which the client asked for by name alongside la persona, el usuario y el correo.
    // Read from the catalogue the rest of the product already uses rather than a second copy
    // of the role names under this screen's own keys.
    expect(within(rowOf('marta')).getByText(es.superadmin.next.users.roles.employee)).toBeTruthy()
    expect(within(rowOf('admin')).getByText(es.superadmin.next.users.roles.company_admin)).toBeTruthy()
    expect(within(rowOf('admin')).getByText(T.noUsuario)).toBeTruthy()
    // Nothing a resend could send, so the row cannot be chosen for one.
    expect(
      within(rowOf('admin')).getByRole('checkbox', { name: T.selectRow.replace('{name}', 'Admin Rojas') }),
    ).toHaveProperty('disabled', true)
  })

  it('opens a row to the demographics the import uploaded', async () => {
    const payload = view()
    vi.stubGlobal('fetch', fetchWith(payload).mock)
    const user = userEvent.setup()
    renderPanel(payload)
    await screen.findByText('Marta Villalobos')

    expect(screen.queryByText('Gerente')).toBeNull()
    await user.click(screen.getByRole('button', { name: T.details.replace('{name}', 'Marta Villalobos') }))

    expect(screen.getByText('Gerente')).toBeTruthy()
    expect(screen.getByText('Más de 10 años')).toBeTruthy()
    expect(screen.getByText('Puesto')).toBeTruthy()
  })

  it('sends the chosen people their details again and reports every one', async () => {
    const payload = view()
    const { mock, sent } = fetchWith(payload, (ids) =>
      ids.map((userId, index) => ({
        userId,
        email: `${userId}@esph.test`,
        delivered: index === 0,
        failureReason: index === 0 ? null : 'mailbox full',
        code: index === 0 ? null : 'send_failed',
      })),
    )
    vi.stubGlobal('fetch', mock)
    const user = userEvent.setup()
    renderPanel(payload)
    await screen.findByText('Marta Villalobos')

    await user.click(within(rowOf('hugo')).getByRole('checkbox'))
    await user.click(within(rowOf('ana')).getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: T.send }))

    // It replaces passwords, so it asks first -- and nothing has gone before the answer.
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(T.sendConfirmTitle.replace('{count}', '2'))).toBeTruthy()
    expect(sent).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: T.send }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect((sent[0].body as { userIds: string[] }).userIds.toSorted()).toEqual(['ana', 'hugo'])

    // A failed send is a 200 with a per-person outcome. Reporting "2 sent" here is the defect
    // this summary exists to prevent.
    expect(
      await screen.findByText(T.sentSome.replace('{sent}', '1').replace('{requested}', '2').replace('{failed}', '1')),
    ).toBeTruthy()
  })

  it('sends nothing when the reminder is not confirmed', async () => {
    const payload = view()
    const { mock, sent } = fetchWith(payload)
    vi.stubGlobal('fetch', mock)
    const user = userEvent.setup()
    renderPanel(payload)
    await screen.findByText('Marta Villalobos')

    await user.click(within(rowOf('hugo')).getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: T.send }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: es.common.cancel }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(sent).toHaveLength(0)
  })

  describe('a per-survey survey', () => {
    // Ana was mailed a key and has not used it; Hugo has used his; Marta holds none yet.
    const perSurvey = () =>
      view({
        credentialMode: 'per_survey',
        surveyTitleEs: 'Clima Organizacional ESPH 2026',
        surveyTitleEn: null,
        roster: [
          { ...ANA, username: null, surveyUsername: 'esph-k7m2q9xa', credentialIssuedOn: '2026-10-20', lastSignInOn: null },
          { ...HUGO, username: null, surveyUsername: 'esph-p3r8t2wz', credentialIssuedOn: '2026-10-19', lastSignInOn: '2026-10-21' },
          { ...MARTA, status: 'not_started' as const, username: null, surveyUsername: null, credentialIssuedOn: null, lastSignInOn: null },
        ],
      })
    const day = (d: string) => formatParticipationDay(d, 'es')

    it('shows the survey username, when the code went and whether it was used -- never "Entra con su correo"', async () => {
      const payload = perSurvey()
      vi.stubGlobal('fetch', fetchWith(payload).mock)
      renderPanel(payload)
      await screen.findByText('Ana Lucía Mora')

      expect(within(rowOf('ana')).getByText('esph-k7m2q9xa')).toBeTruthy()
      expect(within(rowOf('ana')).getByText(T.codeSent.replace('{date}', day('2026-10-20')))).toBeTruthy()
      expect(within(rowOf('ana')).getByText(T.notSignedIn)).toBeTruthy()

      expect(within(rowOf('hugo')).getByText(T.signedInOn.replace('{date}', day('2026-10-21')))).toBeTruthy()
      expect(within(rowOf('marta')).getAllByText(T.noCode).length).toBeGreaterThan(0)

      // The false label is gone, and so is the account resend: it cannot reach a keyless account.
      expect(screen.queryByText(T.noUsuario)).toBeNull()
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    })

    /**
     * Withdrawing a key: the repair for a code that should never have been sent. Ten ESPH
     * people were mailed a Clima key by mistake on 2026-10-28 and the only in-product lever
     * was deactivating the account, which would also have closed the Teletrabajo survey they
     * were legitimately part-way through.
     */
    it('offers withdrawing a code only where there is one to withdraw and nobody has answered', async () => {
      const payload = perSurvey()
      vi.stubGlobal('fetch', fetchWith(payload).mock)
      renderPanel(payload)
      await screen.findByText('Ana Lucía Mora')

      const revokeOf = (name: string) => screen.getByRole('button', { name: T.revokeFor.replace('{name}', name) })
      // A code sent and never used: the mis-send case, and the only one it is offered for.
      expect(revokeOf('Ana Lucía Mora')).toHaveProperty('disabled', false)
      // Answering is what makes it a results decision instead of an access one.
      expect(revokeOf('Hugo Peralta')).toHaveProperty('disabled', true)
      expect(within(rowOf('hugo')).getByText(T.revokeWhyAnswered)).toBeTruthy()
      expect(revokeOf('Marta Villalobos')).toHaveProperty('disabled', true)
      expect(within(rowOf('marta')).getByText(T.revokeWhyNoCode)).toBeTruthy()
    })

    it('asks first, then withdraws the code and the row stops showing one', async () => {
      const payload = perSurvey()
      const { mock, sent } = fetchWith(payload)
      vi.stubGlobal('fetch', mock)
      const user = userEvent.setup()
      renderPanel(payload)
      await screen.findByText('Ana Lucía Mora')
      expect(within(rowOf('ana')).getByText('esph-k7m2q9xa')).toBeTruthy()

      await user.click(screen.getByRole('button', { name: T.revokeFor.replace('{name}', 'Ana Lucía Mora') }))

      // `ConfirmationDialog` is an AlertDialog, so the role is `alertdialog` -- measured, not
      // assumed: a `dialog` query finds nothing here.
      const dialog = await screen.findByRole('alertdialog')
      expect(within(dialog).getByText(T.revokeTitle.replace('{name}', 'Ana Lucía Mora'))).toBeTruthy()
      // It names the username that stops working and the survey it stops opening, and says the
      // account and the other surveys are untouched.
      expect(
        within(dialog).getByText(
          T.revokeBody
            .replace('{username}', 'esph-k7m2q9xa')
            .replace('{survey}', 'Clima Organizacional ESPH 2026')
            .replace('{name}', 'Ana Lucía Mora'),
        ),
      ).toBeTruthy()

      await user.click(within(dialog).getByRole('button', { name: T.revoke }))

      expect(sent).toHaveLength(1)
      expect(sent[0].url).toBe(`${import.meta.env.VITE_API_BASE_URL}/surveys/${SURVEY}/credentials/ana`)
      expect(await screen.findByText(T.revokeDone.replace('{name}', 'Ana Lucía Mora'))).toBeTruthy()
      // The row reads as keyless at once, without refetching a roster the page owns elsewhere.
      await waitFor(() => expect(within(rowOf('ana')).queryByText('esph-k7m2q9xa')).toBeNull())
      expect(within(rowOf('ana')).getAllByText(T.noCode).length).toBeGreaterThan(0)
    })

    /**
     * Sessions are stamped per PERSON, not per key, so a session opened with this key cannot be
     * ended without ending that person's other surveys' sessions too. The screen says so rather
     * than letting an administrator believe access stopped the instant they clicked.
     */
    it('warns when the withdrawn code had already been used to sign in', async () => {
      const payload = perSurvey()
      const { mock } = fetchWith(payload, undefined, undefined, () => ({
        status: 200,
        body: { surveyId: SURVEY, userId: 'ana', username: 'esph-k7m2q9xa', hadSignedIn: true, issuedOn: '2026-10-20' },
      }))
      vi.stubGlobal('fetch', mock)
      const user = userEvent.setup()
      renderPanel(payload)
      await screen.findByText('Ana Lucía Mora')

      await user.click(screen.getByRole('button', { name: T.revokeFor.replace('{name}', 'Ana Lucía Mora') }))
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: T.revoke }))

      expect(await screen.findByText(T.revokeDoneSignedIn.replace('{name}', 'Ana Lucía Mora'))).toBeTruthy()
    })

    it('says a refusal in Spanish and leaves the code on the row', async () => {
      const payload = perSurvey()
      const { mock } = fetchWith(payload, undefined, undefined, () => ({
        status: 409,
        body: { message: 'already answered', code: 'has_responses' },
      }))
      vi.stubGlobal('fetch', mock)
      const user = userEvent.setup()
      renderPanel(payload)
      await screen.findByText('Ana Lucía Mora')

      await user.click(screen.getByRole('button', { name: T.revokeFor.replace('{name}', 'Ana Lucía Mora') }))
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: T.revoke }))

      expect(await screen.findByText(T.revokeRefusedHasResponses)).toBeTruthy()
      expect(within(rowOf('ana')).getByText('esph-k7m2q9xa')).toBeTruthy()
    })

    it('offers each person the chase that fits them, and says why when there is none', async () => {
      // Hugo used to get a DISABLED reissue and a note explaining the dead end. He has signed
      // in, so a new password would lock him out of a survey he may be part-way through -- and
      // that is precisely who a reminder is for. The note stays for the two cases that really
      // have no action: no code at all, and nothing left to chase.
      const payload = perSurvey()
      vi.stubGlobal('fetch', fetchWith(payload).mock)
      renderPanel(payload)
      await screen.findByText('Ana Lucía Mora')

      const reissueOf = (name: string) => screen.getByRole('button', { name: T.reissueFor.replace('{name}', name) })

      // Holds a code, never used it: send a new one, nothing is lost.
      expect(reissueOf('Ana Lucía Mora')).toHaveProperty('disabled', false)

      // Signed in: a reminder instead, and no reissue button at all rather than a dead one.
      expect(screen.getByRole('button', { name: T.remindFor.replace('{name}', 'Hugo Peralta') })).toBeTruthy()
      expect(screen.queryByRole('button', { name: T.reissueFor.replace('{name}', 'Hugo Peralta') })).toBeNull()

      // No code: there is nothing to resend, and the row still says so.
      expect(reissueOf('Marta Villalobos')).toHaveProperty('disabled', true)
      expect(within(rowOf('marta')).getByText(T.reissueWhyNoCode)).toBeTruthy()
      expect(screen.queryByRole('button', { name: T.remindFor.replace('{name}', 'Marta Villalobos') })).toBeNull()
    })

    it('reminds without minting anything, and says so before sending', async () => {
      const payload = perSurvey()
      const { mock, sent } = fetchWith(payload)
      vi.stubGlobal('fetch', mock)
      const user = userEvent.setup()
      renderPanel(payload)
      await screen.findByText('Hugo Peralta')

      await user.click(screen.getByRole('button', { name: T.remindFor.replace('{name}', 'Hugo Peralta') }))

      // The promise is the opposite of the reissue dialog's, and it is made BEFORE the send.
      const dialog = await screen.findByRole('alertdialog')
      expect(within(dialog).getByText(/no lleva usuario ni contrase/i)).toBeTruthy()

      await user.click(within(dialog).getByRole('button', { name: T.remind }))

      expect(await screen.findByText(T.remindSent)).toBeTruthy()
      expect(sent.some((call) => call.url.endsWith('/remind'))).toBe(true)
      // And no reissue went out alongside it: the reminder is not a resend in disguise.
      expect(sent.some((call) => call.url.endsWith('/reissue'))).toBe(false)
    })

    /**
     * The reminder used to leave no trace at all, so an operator working a client's list of
     * names could not tell whether they had already written to somebody -- least of all from an
     * earlier sitting. ESPH sent SEVEN names on 2026-10-30 and five were mailed; the next list
     * overlaps with that one.
     */
    describe('having already been reminded', () => {
      it('says nothing about reminders for somebody who has never had one', async () => {
        const payload = perSurvey()
        vi.stubGlobal('fetch', fetchWith(payload).mock)
        renderPanel(payload)
        await screen.findByText('Hugo Peralta')

        // No "never reminded" line: on eight hundred rows that is noise, and absence says it.
        // Matched on the LINE's wording ("Recordatorio enviado ..."), not on the word, because
        // the button beside it legitimately reads "Enviar recordatorio".
        expect(within(rowOf('hugo')).queryByText(/Recordatorio enviado/)).toBeNull()
        expect(within(rowOf('hugo')).queryByText(/recordatorios, el último/)).toBeNull()
        expect(screen.getByRole('button', { name: T.remindFor.replace('{name}', 'Hugo Peralta') })).toBeTruthy()
      })

      it('shows the day of a single reminder, and offers ANOTHER rather than a first', async () => {
        const payload = perSurvey()
        payload.roster = payload.roster.map((r) =>
          r.userId === 'hugo' ? { ...r, lastRemindedOn: '2026-10-30', reminderCount: 1 } : r,
        )
        vi.stubGlobal('fetch', fetchWith(payload).mock)
        renderPanel(payload)
        await screen.findByText('Hugo Peralta')

        expect(within(rowOf('hugo')).getByText(T.remindedOnce.replace('{date}', day('2026-10-30')))).toBeTruthy()
        // The label is the last chance to notice before a second mail leaves.
        expect(screen.getByRole('button', { name: T.remindAgainFor.replace('{name}', 'Hugo Peralta') })).toBeTruthy()
        expect(screen.queryByRole('button', { name: T.remindFor.replace('{name}', 'Hugo Peralta') })).toBeNull()
      })

      it('counts them when there has been more than one', async () => {
        const payload = perSurvey()
        payload.roster = payload.roster.map((r) =>
          r.userId === 'hugo' ? { ...r, lastRemindedOn: '2026-10-30', reminderCount: 3 } : r,
        )
        vi.stubGlobal('fetch', fetchWith(payload).mock)
        renderPanel(payload)
        await screen.findByText('Hugo Peralta')

        // "reminded once, last week" and "reminded three times, last week" carry the same date
        // and call for different judgement, so the count cannot be left to the date alone.
        expect(
          within(rowOf('hugo')).getByText(
            T.remindedTimes.replace('{count}', '3').replace('{date}', day('2026-10-30')),
          ),
        ).toBeTruthy()
      })

      it('names the earlier reminder in the dialog, before a second one is sent', async () => {
        const payload = perSurvey()
        payload.roster = payload.roster.map((r) =>
          r.userId === 'hugo' ? { ...r, lastRemindedOn: '2026-10-30', reminderCount: 1 } : r,
        )
        vi.stubGlobal('fetch', fetchWith(payload).mock)
        const user = userEvent.setup()
        renderPanel(payload)
        await screen.findByText('Hugo Peralta')

        await user.click(screen.getByRole('button', { name: T.remindAgainFor.replace('{name}', 'Hugo Peralta') }))
        const dialog = await screen.findByRole('alertdialog')

        // Appended to the promise, not substituted for it: a second reminder still carries no
        // new password, and that is still the thing the operator needs told.
        expect(within(dialog).getByText(/no lleva usuario ni contrase/i)).toBeTruthy()
        expect(dialog.textContent).toContain(T.remindBodyAgainOne.replace('{date}', day('2026-10-30')))
      })

      it('records a reminder sent from this page, from the response rather than a refetch', async () => {
        const payload = perSurvey()
        // Fifth parameter: `onRemind`. The four before it answer the batch resend, the reissue
        // and the revoke.
        const { mock } = fetchWith(payload, undefined, undefined, undefined, (userId) => ({
          status: 200,
          body: {
            surveyId: SURVEY,
            userId,
            username: 'x',
            delivered: true,
            failureReason: null,
            remindedOn: '2026-10-31',
            reminderCount: 1,
          },
        }))
        vi.stubGlobal('fetch', mock)
        const user = userEvent.setup()
        renderPanel(payload)
        await screen.findByText('Hugo Peralta')

        await user.click(screen.getByRole('button', { name: T.remindFor.replace('{name}', 'Hugo Peralta') }))
        await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: T.remind }))
        await screen.findByText(T.remindSent)

        // The row says so immediately, and the payload it was handed still says it never
        // happened -- so the line can only have come from the send's own answer. The roster is
        // fetched once for the whole page and shared with the Participación panel, so one write
        // must not refetch eight hundred rows.
        expect(payload.roster.find((r) => r.userId === 'hugo')?.lastRemindedOn ?? null).toBeNull()
        expect(within(rowOf('hugo')).getByText(T.remindedOnce.replace('{date}', day('2026-10-31')))).toBeTruthy()
        // And it now offers another rather than a first, without the roster being re-read.
        expect(screen.getByRole('button', { name: T.remindAgainFor.replace('{name}', 'Hugo Peralta') })).toBeTruthy()
      })
    })

    it('asks first, naming who, which survey and that the old code stops working, then reissues', async () => {
      const payload = perSurvey()
      const { mock, sent } = fetchWith(payload)
      vi.stubGlobal('fetch', mock)
      const user = userEvent.setup()
      renderPanel(payload)
      await screen.findByText('Ana Lucía Mora')

      await user.click(screen.getByRole('button', { name: T.reissueFor.replace('{name}', 'Ana Lucía Mora') }))
      const dialog = await screen.findByRole('alertdialog')
      expect(within(dialog).getByText(T.reissueTitle.replace('{name}', 'Ana Lucía Mora'))).toBeTruthy()
      expect(
        within(dialog).getByText(
          T.reissueBody
            .replace('{email}', 'ana@esph.test')
            .replace('{survey}', 'Clima Organizacional ESPH 2026')
            .replace('{username}', 'esph-k7m2q9xa'),
        ),
      ).toBeTruthy()
      expect(sent).toHaveLength(0)

      await user.click(within(dialog).getByRole('button', { name: T.reissue }))

      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0].url).toBe(`${import.meta.env.VITE_API_BASE_URL}/surveys/${SURVEY}/credentials/ana/reissue`)
      expect(
        await screen.findByText(T.reissueSent.replace('{name}', 'Ana Lucía Mora').replace('{email}', 'ana@esph.test')),
      ).toBeTruthy()
      // The row now says when the NEW code went, without a refetch.
      expect(within(rowOf('ana')).getByText(T.codeSent.replace('{date}', day('2026-10-22')))).toBeTruthy()
    })

    /**
     * Between 26 Oct and 3 Nov 2026 about twenty ESPH accounts had their email re-pointed by SQL
     * to a TIMS inbox, only so TIMS could read the one mail with a password in it. A super admin
     * now gets the password on screen, once, and nothing is mailed.
     */
    describe('handing a password over in person', () => {
      // A made-up value the mocked server "returns"; named so no scanner mistakes it for a secret.
      const FIXTURE_HANDOVER = 'fixture-not-a-secret'
      const handedOver = (userId: string, hadSignedIn = false) => ({
        status: 200,
        body: {
          surveyId: SURVEY,
          userId,
          username: userId === 'hugo' ? 'esph-p3r8t2wz' : 'esph-k7m2q9xa',
          delivered: true,
          failureReason: null,
          issuedOn: '2026-11-03',
          delivery: 'handover',
          password: FIXTURE_HANDOVER,
          hadSignedIn,
        },
      })

      it('is not offered to a company admin', async () => {
        const payload = perSurvey()
        vi.stubGlobal('fetch', fetchWith(payload).mock)
        renderPanel(payload)
        await screen.findByText('Ana Lucía Mora')

        expect(screen.queryByRole('button', { name: T.handoverFor.replace('{name}', 'Ana Lucía Mora') })).toBeNull()
        expect(screen.queryByText(T.handover)).toBeNull()
      })

      it('asks first, then shows the new password once and hides it when dismissed', async () => {
        setToken(tokenFor({ role: 'super_admin' }))
        const payload = perSurvey()
        const { mock, sent } = fetchWith(payload, undefined, (userId) => handedOver(userId))
        vi.stubGlobal('fetch', mock)
        const user = userEvent.setup()
        renderPanel(payload)
        await screen.findByText('Ana Lucía Mora')

        await user.click(screen.getByRole('button', { name: T.handoverFor.replace('{name}', 'Ana Lucía Mora') }))
        const dialog = await screen.findByRole('alertdialog')
        expect(within(dialog).getByText(T.handoverTitle.replace('{name}', 'Ana Lucía Mora'))).toBeTruthy()
        expect(
          within(dialog).getByText(
            T.handoverBody.replace('{survey}', 'Clima Organizacional ESPH 2026').replace('{username}', 'esph-k7m2q9xa'),
          ),
        ).toBeTruthy()
        expect(sent).toHaveLength(0)

        await user.click(within(dialog).getByRole('button', { name: T.handover }))

        await waitFor(() => expect(sent).toHaveLength(1))
        expect(sent[0].url).toBe(`${import.meta.env.VITE_API_BASE_URL}/surveys/${SURVEY}/credentials/ana/reissue`)
        expect(sent[0].body).toEqual({ delivery: 'handover', replaceUsedKey: false })

        const shown = await screen.findByRole('status', { name: T.handoverDoneTitle.replace('{name}', 'Ana Lucía Mora') })
        expect(within(shown).getByText(FIXTURE_HANDOVER)).toBeTruthy()
        expect(within(shown).getByText('esph-k7m2q9xa')).toBeTruthy()
        expect(within(shown).getByText(T.handoverDoneNote)).toBeTruthy()
        // The row now says when the code now in force was issued.
        expect(within(rowOf('ana')).getByText(T.codeSent.replace('{date}', day('2026-11-03')))).toBeTruthy()

        await user.click(within(shown).getByRole('button', { name: T.handoverDismiss }))
        expect(screen.queryByText(FIXTURE_HANDOVER)).toBeNull()
      })

      it('says a used code is being replaced, and asks the server to replace it', async () => {
        setToken(tokenFor({ role: 'super_admin' }))
        const payload = perSurvey()
        const { mock, sent } = fetchWith(payload, undefined, (userId) => handedOver(userId, true))
        vi.stubGlobal('fetch', mock)
        const user = userEvent.setup()
        renderPanel(payload)
        await screen.findByText('Hugo Peralta')

        await user.click(screen.getByRole('button', { name: T.handoverFor.replace('{name}', 'Hugo Peralta') }))
        const dialog = await screen.findByRole('alertdialog')
        expect(
          within(dialog).getByText(
            `${T.handoverBody.replace('{survey}', 'Clima Organizacional ESPH 2026').replace('{username}', 'esph-p3r8t2wz')} ${T.handoverBodySignedIn}`,
          ),
        ).toBeTruthy()

        await user.click(within(dialog).getByRole('button', { name: T.handover }))
        await waitFor(() => expect(sent).toHaveLength(1))
        expect(sent[0].body).toEqual({ delivery: 'handover', replaceUsedKey: true })
        expect(await screen.findByText(T.handoverDoneSignedIn)).toBeTruthy()
      })

      it('says a refusal in Spanish and shows no password', async () => {
        setToken(tokenFor({ role: 'super_admin' }))
        const payload = perSurvey()
        vi.stubGlobal(
          'fetch',
          fetchWith(payload, undefined, () => ({
            status: 403,
            body: { message: 'Only a super admin may…', code: 'super_admin_only' },
          })).mock,
        )
        const user = userEvent.setup()
        renderPanel(payload)
        await screen.findByText('Ana Lucía Mora')

        await user.click(screen.getByRole('button', { name: T.handoverFor.replace('{name}', 'Ana Lucía Mora') }))
        await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: T.handover }))

        expect(await screen.findByText(T.reissueRefusedSuperAdminOnly)).toBeTruthy()
        expect(screen.queryByText(T.handoverPassword)).toBeNull()
      })

      it('is not offered for somebody who already finished', async () => {
        setToken(tokenFor({ role: 'super_admin' }))
        const payload = view({
          credentialMode: 'per_survey',
          surveyTitleEs: 'Clima Organizacional ESPH 2026',
          surveyTitleEn: null,
          roster: [{ ...MARTA, username: null, surveyUsername: 'esph-m4r7a2bb', credentialIssuedOn: '2026-10-20', lastSignInOn: '2026-10-21' }],
        })
        vi.stubGlobal('fetch', fetchWith(payload).mock)
        renderPanel(payload)
        await screen.findByText('Marta Villalobos')

        expect(screen.queryByRole('button', { name: T.handoverFor.replace('{name}', 'Marta Villalobos') })).toBeNull()
      })
    })

    /**
     * The bounce webhook (3 Nov 2026) records what the mail service reports. The roster says it,
     * on the row, and the reissue dialog says it BEFORE another mail goes to a dead address.
     */
    it('shows a bounce on the row and warns before re-sending to the same address', async () => {
      const base = perSurvey()
      const payload = {
        ...base,
        roster: base.roster.map((r) =>
          r.userId === 'ana' ? { ...r, deliveryProblem: 'bounced' as const, deliveryProblemOn: '2026-10-20' } : r,
        ),
      }
      vi.stubGlobal('fetch', fetchWith(payload).mock)
      const user = userEvent.setup()
      renderPanel(payload)
      await screen.findByText('Ana Lucía Mora')

      expect(within(rowOf('ana')).getByText(T.deliveryBounced.replace('{date}', day('2026-10-20')))).toBeTruthy()
      expect(within(rowOf('hugo')).queryByText(T.deliveryBounced.replace('{date}', day('2026-10-20')))).toBeNull()

      await user.click(screen.getByRole('button', { name: T.reissueFor.replace('{name}', 'Ana Lucía Mora') }))
      const dialog = await screen.findByRole('alertdialog')
      expect(
        within(dialog).getByText(
          `${T.reissueBody
            .replace('{email}', 'ana@esph.test')
            .replace('{survey}', 'Clima Organizacional ESPH 2026')
            .replace('{username}', 'esph-k7m2q9xa')} ${T.reissueBodyBounced.replace('{date}', day('2026-10-20'))}`,
        ),
      ).toBeTruthy()

      // Reissued from this page: the new mail is newer than the bounce, so the row stops showing it.
      await user.click(within(dialog).getByRole('button', { name: T.reissue }))
      await screen.findByText(T.reissueSent.replace('{name}', 'Ana Lucía Mora').replace('{email}', 'ana@esph.test'))
      expect(within(rowOf('ana')).queryByText(T.deliveryBounced.replace('{date}', day('2026-10-20')))).toBeNull()
    })

    it('says a failed mail changed nothing, and a refusal in Spanish', async () => {
      const payload = perSurvey()
      let answer: { status: number; body: unknown } = {
        status: 200,
        body: { delivered: false, failureReason: 'mailbox full', issuedOn: '2026-10-20' },
      }
      vi.stubGlobal('fetch', fetchWith(payload, undefined, () => answer).mock)
      const user = userEvent.setup()
      renderPanel(payload)
      await screen.findByText('Ana Lucía Mora')

      const reissueAna = () => screen.getByRole('button', { name: T.reissueFor.replace('{name}', 'Ana Lucía Mora') })
      await user.click(reissueAna())
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: T.reissue }))
      expect(await screen.findByText(T.reissueSendFailed.replace('{name}', 'Ana Lucía Mora'))).toBeTruthy()
      // The date on the row is the old code's, because the old code is the one in force.
      expect(within(rowOf('ana')).getByText(T.codeSent.replace('{date}', day('2026-10-20')))).toBeTruthy()

      answer = { status: 409, body: { message: 'This person has already signed in…', code: 'already_signed_in' } }
      await user.click(reissueAna())
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: T.reissue }))
      expect(await screen.findByText(T.reissueRefusedSignedIn)).toBeTruthy()
      expect(screen.queryByText(/already signed in/)).toBeNull()
    })
  })

  it('chunks a selection larger than the API cap instead of sending one oversized request', async () => {
    const many = Array.from({ length: 140 }, (_, index) =>
      row({ userId: `p${index}`, name: `Persona ${index}`, status: 'not_started' }),
    )
    const payload = view({ roster: many })
    const { mock, sent } = fetchWith(payload)
    vi.stubGlobal('fetch', mock)
    const user = userEvent.setup()
    renderPanel(payload)
    await screen.findByText('Persona 0')

    await user.click(screen.getByRole('checkbox', { name: T.selectAll }))
    await user.click(screen.getByRole('button', { name: T.send }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: T.send }))

    // 140 people, a cap of 100: two requests, and neither over the cap. One request of 140
    // would be refused by the API with `batch_too_large` and nobody would be mailed.
    await waitFor(() => expect(sent).toHaveLength(2))
    const sizes = sent.map((s) => (s.body as { userIds: string[] }).userIds.length)
    expect(sizes).toEqual([100, 40])
    expect(await screen.findByText(T.sentAll.replace('{sent}', '140').replace('{requested}', '140'))).toBeTruthy()
  })
  /**
   * An anonymous survey DOES know who finished, and the screen says so.
   *
   * Completion is recorded in `survey_participations`, apart from the answers, with nothing
   * that joins the two. So "terminó" and "sin terminar" are both facts here, while "empezó sin
   * terminar" is not — and the state the screen must never show is "no ha entrado", because
   * with no user id on the answers somebody halfway through looks exactly like somebody who
   * never opened it.
   */
  it('shows who finished on an anonymous survey, and offers only the two states it can know', async () => {
    const payload = view({
      tracksIndividuals: false,
      tracksCompletionOnly: true,
      roster: [
        { ...ANA, status: 'completed' as const },
        { ...MARTA, status: 'not_completed' as const },
      ],
    })
    vi.stubGlobal('fetch', fetchWith(payload).mock)
    renderPanel(payload)

    expect(await screen.findByText(T.completionOnlyNote)).toBeTruthy()

    // The state column is drawn, because here it carries something true. Scoped to the table:
    // "Sin terminar" is deliberately BOTH the filter chip and the row's state, so an unscoped
    // query matches two elements and proves neither.
    const table = screen.getByRole('table')
    expect(within(table).getByText(T.colStatus)).toBeTruthy()
    expect(within(table).getByText(T.statusCompleted)).toBeTruthy()
    expect(within(table).getByText(T.statusNotCompleted)).toBeTruthy()

    // The claim it cannot support.
    expect(screen.queryByText(T.statusNotStarted)).toBeNull()
    expect(screen.queryByText(T.notTracked)).toBeNull()

    // Two filters, not three: there is no "empezó sin terminar" to filter by.
    expect(screen.getByRole('button', { name: new RegExp(`^${T.filterCompleted}`) })).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(`^${T.filterNotCompleted}`) })).toBeTruthy()
    expect(screen.queryByRole('button', { name: new RegExp(`^${T.filterStarted}`) })).toBeNull()
    expect(screen.queryByRole('button', { name: new RegExp(`^${T.filterNotStarted}`) })).toBeNull()
  })

  /**
   * The defect reading the screenshot caught. On an ANONYMOUS survey no response carries a
   * user id, so every row comes back `not_started` whatever anybody did. Rendering that as
   * participation tells an administrator that 800 people have not answered, beside a notice on
   * the same page saying completion is never recorded against a person — two contradictory
   * claims, one of them false.
   */
  it('never presents state as a fact on a survey that records none', async () => {
    const payload = view({ tracksIndividuals: false })
    vi.stubGlobal('fetch', fetchWith(payload).mock)
    renderPanel(payload)

    expect(await screen.findByText(T.notTracked)).toBeTruthy()
    // The people, their usernames and the resend all stay — only the claim goes.
    expect(screen.getByText('Marta Villalobos')).toBeTruthy()
    expect(screen.getByText('esph-marta')).toBeTruthy()
    expect(screen.queryByText(T.statusNotStarted)).toBeNull()
    expect(screen.queryByText(T.colStatus)).toBeNull()
    expect(screen.queryByRole('button', { name: new RegExp(`^${T.filterCompleted}`) })).toBeNull()
  })
})

function rowOf(userId: string): HTMLElement {
  return document.querySelector(`tr[data-user-id="${userId}"]`) as HTMLElement
}
