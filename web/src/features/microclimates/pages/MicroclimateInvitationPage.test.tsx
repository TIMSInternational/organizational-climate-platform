import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import MicroclimateInvitationPage from './MicroclimateInvitationPage'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'
import type { PublicMicroclimateDetail } from '../api/microclimates'
import type { MicroclimateInvitationTokenDetail } from '../api/microclimateLinks'

const TOKEN = 'fixture-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function invitation(
  overrides: Partial<MicroclimateInvitationTokenDetail> = {},
): MicroclimateInvitationTokenDetail {
  return {
    invitationId: 'inv-1',
    microclimateId: 'micro-42',
    microclimateTitle: 'Pulso semanal',
    microclimateDescription: 'Cómo se siente el equipo',
    language: 'es',
    resolvedLocale: 'es',
    fallbackFields: [],
    status: 'sent',
    microclimateStatus: 'active',
    startTime: '2026-08-26T09:00:00Z',
    endTime: '2026-08-26T17:00:00Z',
    expiresAt: '2026-08-26T17:00:00Z',
    anonymity: {
      anonymous: true,
      highestRecordableState: 'opened',
      suppressedStates: ['started', 'completed'],
      guarantee: 'Tracking stops at opened.',
    },
    ...overrides,
  }
}

function pulse(): PublicMicroclimateDetail {
  return {
    id: 'micro-42',
    title: 'Pulso semanal',
    status: 'active',
    language: 'es',
    resolvedLocale: 'es',
    fallbackFields: [],
    questions: [
      {
        id: 'q1',
        text: '¿Cómo te sientes hoy?',
        type: 'open_ended',
        options: null,
        required: false,
        order: 0,
      },
    ],
  }
}

/**
 * One handler for the three endpoints this page touches, so a test can fail one of them
 * without the rest.
 *
 * The ORDER of the branches matters: the state routes are
 * `/microclimate-invitations/{token}/{step}` and the resolve route is
 * `/microclimate-invitations/{token}`, so the POST branch has to be tested first or every
 * ping would be answered with an invitation payload.
 */
function serve(
  options: {
    resolve?: () => Response
    steps?: () => Response
    submit?: () => Response
  } = {},
): void {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/microclimate-invitations/') && init?.method === 'POST') {
      return Promise.resolve(
        options.steps?.() ??
          new Response(
            JSON.stringify({
              invitationId: 'inv-1',
              status: 'opened',
              recorded: true,
              suppressedForAnonymity: false,
              reason: null,
              anonymity: invitation().anonymity,
            }),
            { status: 200 },
          ),
      )
    }
    if (url.includes('/microclimate-invitations/')) {
      return Promise.resolve(
        options.resolve?.() ?? new Response(JSON.stringify(invitation()), { status: 200 }),
      )
    }
    if (url.includes('/responses')) {
      return Promise.resolve(options.submit?.() ?? new Response('', { status: 201 }))
    }
    return Promise.resolve(new Response(JSON.stringify(pulse()), { status: 200 }))
  })
}

/**
 * The invitation state routes that were posted, in order: `['opened']`,
 * `['opened','started']`…
 *
 * Filtered on the *path*, not on the method: `POST /microclimates/{id}/responses` is a POST
 * too, and a filter that only checked the verb would report submitting the pulse as a fourth
 * rung on the ladder.
 */
function steps(): string[] {
  return vi
    .mocked(fetch)
    .mock.calls.map(
      (call) => /\/microclimate-invitations\/[^/?]+\/(\w+)/.exec(String(call[0]))?.[1],
    )
    .filter((step): step is string => step !== undefined)
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[`/microclimate-invitations/${TOKEN}`]}>
        <Routes>
          <Route path="/microclimate-invitations/:token" element={<MicroclimateInvitationPage />} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
  clearToken()
})

describe('MicroclimateInvitationPage', () => {
  it('names the session the invitee was sent, and when their link stops working', async () => {
    serve()
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Pulso semanal' })).toBeTruthy()
    expect(screen.getByText('Su invitación')).toBeTruthy()
    expect(screen.getByText('Su enlace funciona hasta')).toBeTruthy()
    expect(screen.getByText('Cierra')).toBeTruthy()
  })

  /**
   * The whole value of the ladder to an administrator is telling "they saw it" apart from
   * "they began". Recording both on page load would make the funnel a straight line by
   * construction — and it is the easiest possible thing to do by accident.
   */
  it('records opened on arrival and started only when the respondent begins', async () => {
    serve()
    renderPage()

    await screen.findByRole('heading', { name: 'Pulso semanal' })
    await waitFor(() => expect(steps()).toEqual(['opened']))

    await userEvent.click(screen.getByRole('button', { name: 'Participar' }))

    await waitFor(() => expect(steps()).toEqual(['opened', 'started']))
  })

  it('closes the ladder by recording completed when the answers are accepted', async () => {
    serve()
    renderPage()

    await screen.findByRole('heading', { name: 'Pulso semanal' })
    await userEvent.click(screen.getByRole('button', { name: 'Participar' }))

    await screen.findByText('¿Cómo te sientes hoy?')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => expect(steps()).toEqual(['opened', 'started', 'completed']))
  })

  /**
   * `completed` means THE ANSWERS ARE IN. Nothing else it could mean is worth recording.
   *
   * <p>The rung is not decoration: on a non-anonymous session `Advances` is strictly
   * monotonic, so `completed` is irreversible, the invitee's token answers 409
   * `already_completed` from then on, and the only way back is an admin reinstating them.
   * Reporting it for a submission the server refused would close a respondent's invitation
   * over answers that were never stored, and hand them a link that tells them they already
   * answered.</p>
   *
   * <p>The neighbouring test covers the TRACKING calls failing. This one is the submission
   * failing, which is the opposite direction and the one that costs somebody their response:
   * hoisting `onSubmitted?.()` above the `await` typechecks clean and passed the whole
   * suite.</p>
   */
  it('does not record completed when the server refuses the answers', async () => {
    serve({ submit: () => new Response(JSON.stringify({ message: 'nope' }), { status: 500 }) })
    renderPage()

    await screen.findByRole('heading', { name: 'Pulso semanal' })
    await userEvent.click(screen.getByRole('button', { name: 'Participar' }))
    await screen.findByText('¿Cómo te sientes hoy?')
    await userEvent.type(screen.getByRole('textbox'), 'bastante bien')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    // The ladder stopped where the truth stopped. `completed` is irreversible on a
    // non-anonymous session, so recording it here would close this invitation over answers
    // that were never stored.
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(steps()).toEqual(['opened', 'started'])

    // And the failure leaves them able to act on it: their words are still in the box and
    // the button is still there. A failed SUBMIT is not a failed LOAD — folding the two
    // together unmounted the form and threw the answers away.
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('bastante bien')
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeTruthy()

    // Retrying works, and only then does the ladder close.
    serve()
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(steps()).toEqual(['opened', 'started', 'completed']))
  })

  /**
   * The three writes are telemetry about an invitation, not a precondition for answering.
   * A respondent blocked from a pulse because an administrator's counter would not
   * increment is a product that has confused whose page this is.
   */
  it('lets the respondent answer even when every tracking call fails', async () => {
    serve({ steps: () => new Response('{}', { status: 500 }) })
    renderPage()

    await screen.findByRole('heading', { name: 'Pulso semanal' })
    await userEvent.click(screen.getByRole('button', { name: 'Participar' }))

    expect(await screen.findByText('¿Cómo te sientes hoy?')).toBeTruthy()

    // And nothing about the failure is put in front of them.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  /**
   * A dead token has NOT been opened by anybody. Recording `opened` for an invitation the
   * server has just refused would put a timestamp on a row nobody reached.
   */
  it('records nothing at all for a token the server refuses', async () => {
    serve({
      resolve: () =>
        new Response(JSON.stringify({ message: 'gone', reason: 'revoked' }), { status: 410 }),
    })
    renderPage()

    expect(await screen.findByText('Esta invitación fue anulada')).toBeTruthy()
    expect(steps()).toEqual([])
  })

  /**
   * Revoked and expired both arrive as 410 and are separated only by `reason` — and the
   * server checks revoked BEFORE expiry so an administrator's deliberate act is not reported
   * as the passage of time. This is the rendered half of that.
   */
  it.each([
    ['revoked', 410, 'Esta invitación fue anulada'],
    ['expired', 410, 'Esta invitación ha caducado'],
    ['not_found', 404, 'No se encontró esta invitación'],
  ])('renders the %s outcome distinctly', async (reason, status, heading) => {
    serve({
      resolve: () => new Response(JSON.stringify({ message: 'no', reason }), { status }),
    })
    renderPage()

    expect(await screen.findByText(heading)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Participar' })).toBeNull()
  })

  /**
   * `already_completed` is a 409 and is not a problem: the answers are in. It renders in the
   * success treatment and with `role="status"` rather than `role="alert"`, because a
   * confirmation that interrupts reads as a failure.
   */
  it('reads an already-answered pulse as a confirmation rather than an error', async () => {
    serve({
      resolve: () =>
        new Response(JSON.stringify({ message: 'done', reason: 'already_completed' }), {
          status: 409,
        }),
    })
    renderPage()

    expect(await screen.findByText('Ya participó')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status')).toBeTruthy()
  })

  /**
   * The anonymity chip and the notice are a promise about how a response is stored, and this
   * page has no basis for making it until the payload says so.
   */
  it('states the anonymity contract the payload actually reports', async () => {
    serve()
    renderPage()

    expect(await screen.findByText('Sus respuestas no se asocian a usted')).toBeTruthy()

    cleanup()
    serve({
      resolve: () =>
        new Response(
          JSON.stringify(
            invitation({
              anonymity: {
                anonymous: false,
                highestRecordableState: 'completed',
                suppressedStates: [],
                guarantee: 'The full lifecycle is recorded.',
              },
            }),
          ),
          { status: 200 },
        ),
    })
    renderPage()

    expect(await screen.findByText('Esta sesión registra quién participa')).toBeTruthy()
  })

  /**
   * The OTHER anonymity claim on this page, and the more prominent of the two.
   *
   * `RespondShell` draws a green "Anónima" chip beside the lockup, above the fold — the first
   * privacy statement a respondent reads, before the notice tested above. Its own doc calls
   * the default-off "the one promise it is least entitled to guess at", and this route is its
   * only microclimate caller. Inverting what gets passed shows the chip on an identified
   * session and hides it on an anonymous one, which is the worst direction for it to be
   * wrong in, and the whole test suite stayed green.
   *
   * Both directions, because the chip's absence is as load-bearing as its presence.
   */
  it.each([
    ['an anonymous session', true, true],
    ['a session that records who participates', false, false],
  ])('shows the shell anonymity chip for %s only when the payload says so', async (_what, anonymous, expected) => {
    serve({
      resolve: () =>
        new Response(
          JSON.stringify(
            invitation({
              anonymity: {
                anonymous,
                highestRecordableState: anonymous ? 'opened' : 'completed',
                suppressedStates: anonymous ? ['started', 'completed'] : [],
                guarantee: 'x',
              },
            }),
          ),
          { status: 200 },
        ),
    })
    renderPage()

    await screen.findByRole('heading', { name: 'Pulso semanal' })
    expect(screen.queryByText('Anónima') !== null).toBe(expected)
  })

  /**
   * And it is off before the payload has said anything. A page still resolving the token has
   * no basis for a privacy claim, and a chip that renders optimistically would be making one
   * on a link that is about to come back revoked.
   */
  it('makes no anonymity claim while the token is still being resolved', async () => {
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    serve({
      // A fresh Response per call, gated on `held`: a single shared instance would have its
      // body consumed by whichever caller read it first.
      resolve: () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              await held
              controller.enqueue(new TextEncoder().encode(JSON.stringify(invitation())))
              controller.close()
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    })
    renderPage()

    expect(screen.queryByText('Anónima')).toBeNull()

    release!()
    expect(await screen.findByText('Anónima')).toBeTruthy()
  })

  /**
   * The client does NOT branch on anonymity. `MicroclimateInvitationStatuses` says the later
   * states "are accepted by the API (the respondent's client should not have to branch on
   * anonymity) and deliberately not persisted" — one implementation of the ceiling, in the
   * one place that owns the rows. A client that suppressed them itself would be a second
   * copy of the boundary, and the two would eventually disagree.
   *
   * The server's honest `recorded: false` is what this test feeds back, so it also pins that
   * a suppressed write does not derail the page.
   */
  it('posts started and completed even for an anonymous session, and lets the server refuse them', async () => {
    serve({
      steps: () =>
        new Response(
          JSON.stringify({
            invitationId: 'inv-1',
            status: 'opened',
            recorded: false,
            suppressedForAnonymity: true,
            reason: 'This microclimate is anonymous…',
            anonymity: invitation().anonymity,
          }),
          { status: 200 },
        ),
    })
    renderPage()

    await screen.findByRole('heading', { name: 'Pulso semanal' })
    await userEvent.click(screen.getByRole('button', { name: 'Participar' }))
    await screen.findByText('¿Cómo te sientes hoy?')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => expect(steps()).toEqual(['opened', 'started', 'completed']))

    // And the refusal is not shown to the respondent — it is an administrator's business.
    expect(screen.queryByText(/anonymous/i)).toBeNull()
  })

  /**
   * The one case where an invitee DOES need an account, named before they hit it.
   *
   * A non-anonymous session refuses an unauthenticated respondent -- `GET /microclimates/{id}`
   * serves an anonymous caller only when the session is both anonymous and active. Without the
   * note, pressing the button produces "this microclimate is not currently available": a
   * sentence about the session, for a problem about the browser, which reads as the link being
   * broken.
   */
  it('warns an identified session\'s invitee that they will be asked to sign in', async () => {
    serve({
      resolve: () =>
        new Response(
          JSON.stringify(
            invitation({
              anonymity: {
                anonymous: false,
                highestRecordableState: 'completed',
                suppressedStates: [],
                guarantee: 'The full lifecycle is recorded.',
              },
            }),
          ),
          { status: 200 },
        ),
    })
    renderPage()

    await screen.findByRole('heading', { name: 'Pulso semanal' })
    expect(
      screen.getByText(/se le pedirá iniciar sesión en su cuenta antes de responder/),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Iniciar sesión' }).getAttribute('href')).toBe('/login')

    // The button is still offered: the server is the authority on what this browser may do,
    // and a session in another tab is a real case.
    expect(screen.getByRole('button', { name: 'Participar' })).toBeTruthy()
  })

  /**
   * And it is advice for the people who need it, not a banner everyone reads. Two ways it must
   * stay quiet: a signed-in reader, and an anonymous session where no account is wanted at all.
   */
  it.each([
    ['a reader who already holds a session', true, false],
    ['an anonymous session, where no account is needed', false, true],
  ])('says nothing about signing in for %s', async (_what, signedIn, anonymous) => {
    if (signedIn) setToken('a-real-looking-jwt')
    serve({
      resolve: () =>
        new Response(
          JSON.stringify(
            invitation({
              anonymity: {
                anonymous,
                highestRecordableState: anonymous ? 'opened' : 'completed',
                suppressedStates: anonymous ? ['started', 'completed'] : [],
                guarantee: 'x',
              },
            }),
          ),
          { status: 200 },
        ),
    })
    renderPage()

    await screen.findByRole('heading', { name: 'Pulso semanal' })
    expect(screen.queryByRole('link', { name: 'Iniciar sesión' })).toBeNull()
  })

  /**
   * A token can outlive the session it opens: an invitation minted at 09:00 for a pulse that
   * ends at 17:00 still resolves at 16:59 and is useless at 17:01. The lifecycle job closes
   * the session; the invitation row knows nothing about it. Saying so on the card beats
   * letting them press the button and meet a bare "not currently available".
   */
  it('does not offer the button for a session that has already closed', async () => {
    serve({
      resolve: () =>
        new Response(JSON.stringify(invitation({ microclimateStatus: 'closed' })), { status: 200 }),
    })
    renderPage()

    await screen.findByRole('heading', { name: 'Pulso semanal' })
    expect(screen.getByText('Esta sesión no está recibiendo respuestas')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Participar' })).toBeNull()

    // The link itself is still live, so `opened` is still the truth about this visit.
    await waitFor(() => expect(steps()).toEqual(['opened']))
  })

  /**
   * Two rules about one stored session, and they point opposite ways.
   *
   * <p><b>The invitation routes get no bearer, ever.</b> They take no `ClaimsPrincipal` and
   * the group carries no `RequireAuthorization()` — the token in the path IS the credential,
   * and the server cannot see an `Authorization` header here even if one arrives. An
   * administrator checking a link from the browser they administer in is the routine case,
   * and handing a second credential to a route that ignores it is a leak with no upside.</p>
   *
   * <p><b>The submission gets one whenever there is one to give.</b> A microclimate with
   * `anonymousResponses: false` answers 401 to an unauthenticated POST, so an invitee who
   * followed the sign-in note on the card and came back would otherwise have signed in for
   * nothing — the card would have named a remedy that could not work. Asserted here rather
   * than only in the api client's own test because it is the PAGE that has to carry the
   * session from the landing card through to the answers.</p>
   */
  it('withholds the bearer from the invitation routes and sends it with the answers', async () => {
    setToken('a-real-looking-jwt')
    serve()
    renderPage()

    await screen.findByRole('heading', { name: 'Pulso semanal' })
    await userEvent.click(screen.getByRole('button', { name: 'Participar' }))
    await screen.findByText('¿Cómo te sientes hoy?')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(steps()).toEqual(['opened', 'started', 'completed']))

    const authorizationOn = (predicate: (url: string) => boolean) =>
      vi
        .mocked(fetch)
        .mock.calls.filter((call) => predicate(String(call[0])))
        .map((call) =>
          new Headers((call[1] as RequestInit | undefined)?.headers ?? {}).get('Authorization'),
        )

    const invitationCalls = authorizationOn((url) => url.includes('/microclimate-invitations/'))
    expect(invitationCalls.length).toBeGreaterThan(0)
    expect(invitationCalls.every((value) => value === null)).toBe(true)

    expect(authorizationOn((url) => url.endsWith('/responses'))).toEqual([
      'Bearer a-real-looking-jwt',
    ])
  })

  /**
   * The blocker that cost the survey route its answers once: `locale` is a dependency of the
   * resolve effect, so a language switch mid-answer would re-resolve, replace `answering`
   * with `loading`, unmount the form and hand the respondent back an empty answer map — on
   * the one route whose visitor has no account, no draft and no way back.
   *
   * Asserted by changing the locale after the questions are up and checking the resolve
   * route is not called again.
   */
  it('does not re-resolve the invitation once the questions are on screen', async () => {
    serve()
    renderPage()

    await screen.findByRole('heading', { name: 'Pulso semanal' })
    await userEvent.click(screen.getByRole('button', { name: 'Participar' }))
    await screen.findByText('¿Cómo te sientes hoy?')

    const resolvesBefore = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/microclimate-invitations/') &&
          (init as RequestInit | undefined)?.method !== 'POST',
      ).length

    // Type an answer first: the loss this guards against is silent, and a test that only
    // checked the question was still on screen would pass against a remounted form.
    await userEvent.type(screen.getByRole('textbox'), 'agotado')

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Cambiar Idioma' }),
      'en',
    )

    // The switch really landed: the shell's own control is renamed by it.
    await screen.findByRole('combobox', { name: 'Switch Language' })

    // Still answering, still holding the answer, and the invitation was not re-resolved.
    await waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('agotado'),
    )
    expect(screen.queryByRole('button', { name: 'Participar' })).toBeNull()
    expect(screen.queryByText('Su invitación')).toBeNull()
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(
          ([url, init]) =>
            String(url).includes('/microclimate-invitations/') &&
            (init as RequestInit | undefined)?.method !== 'POST',
        ).length,
    ).toBe(resolvesBefore)

    // And no rung was re-posted. A client that has to be saved by the server's idempotency
    // is a client that is getting the ladder wrong.
    expect(steps()).toEqual(['opened', 'started'])
  })
})
