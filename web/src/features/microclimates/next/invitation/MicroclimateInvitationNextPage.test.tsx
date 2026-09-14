import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import MicroclimateInvitationNextPage from './MicroclimateInvitationNextPage'
import { TranslationProvider } from '../../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../../i18n/locale'
import { setToken, clearToken } from '../../../../auth/token'
import { safeReturnPath } from '../../../../auth/returnPath'
import type { PublicMicroclimateDetail } from '../../api/microclimates'
import type { MicroclimateInvitationTokenDetail } from '../../api/microclimateLinks'

const TOKEN = 'fixture-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

/**
 * The shape is a real payload's, not an invented one: every field is
 * `MicroclimateInvitationTokenDetail`, which mirrors the DTO the endpoint serialises, and
 * nothing is added to it. A fixture can publish what the API withholds, and the thing this
 * page must never publish is exactly what this payload does not carry — the invitee's
 * address, the company, the author, the running count.
 */
function invitation(
  overrides: Partial<MicroclimateInvitationTokenDetail> = {},
): MicroclimateInvitationTokenDetail {
  return {
    invitationId: 'inv-1',
    microclimateId: 'micro-42',
    microclimateTitle: 'Pulso semanal — ¿cómo fue la semana?',
    microclimateDescription: 'Dos preguntas, menos de un minuto.',
    language: 'es',
    resolvedLocale: 'es',
    fallbackFields: [],
    status: 'sent',
    microclimateStatus: 'active',
    startTime: '2026-09-09T09:00:00Z',
    endTime: '2026-09-11T17:00:00Z',
    expiresAt: '2026-09-12T17:00:00Z',
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
      { id: 'q1', text: '¿Cómo te sientes hoy?', type: 'open_ended', options: null, required: false, order: 0 },
    ],
  }
}

/**
 * One handler for the three endpoints this page touches.
 *
 * The ORDER of the branches matters: the state routes are
 * `/microclimate-invitations/{token}/{step}` and the resolve route is
 * `/microclimate-invitations/{token}`, so the POST branch has to be tested first or every
 * ping would be answered with an invitation payload.
 */
function serve(options: { resolve?: () => Response; steps?: () => Response } = {}): void {
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
      return Promise.resolve(options.resolve?.() ?? new Response(JSON.stringify(invitation()), { status: 200 }))
    }
    if (url.includes('/responses')) return Promise.resolve(new Response('', { status: 201 }))
    return Promise.resolve(new Response(JSON.stringify(pulse()), { status: 200 }))
  })
}

function refused(status: number, reason: string | null, message = 'from the server'): () => Response {
  return () => new Response(JSON.stringify({ message, reason }), { status })
}

/** The invitation state routes that were posted, in order: `['opened']`, `['opened','started']`… */
function steps(): string[] {
  return vi
    .mocked(fetch)
    .mock.calls.map((call) => /\/microclimate-invitations\/[^/?]+\/(\w+)/.exec(String(call[0]))?.[1])
    .filter((step): step is string => Boolean(step))
}

/** Records what `/login` was navigated to WITH, so the return promise can be checked. */
let loginState: unknown = undefined

function LoginProbe() {
  loginState = useLocation().state
  return <p>login page</p>
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[`/microclimate-invitations/${TOKEN}`]}>
        <Routes>
          <Route path="/microclimate-invitations/:token" element={<MicroclimateInvitationNextPage />} />
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
  clearToken()
  loginState = undefined
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MicroclimateInvitationNextPage — the landing card', () => {
  it('names the pulse and prints ONE deadline, the earlier of the two the token carries', async () => {
    serve()
    renderPage()

    expect(await screen.findByRole('heading', { name: /Pulso semanal/ })).toBeTruthy()
    expect(screen.getByText('Puede responder hasta')).toBeTruthy()
    // endTime (11 Sep) is earlier than expiresAt (12 Sep), so 11 is the reading.
    expect(screen.getByText('11 sept')).toBeTruthy()
    expect(screen.queryByText('12 sept')).toBeNull()
  })

  /**
   * The floor of five, said to the person about to type a word — the one reader entitled
   * to know it will never be published as their text.
   */
  it('states the word-frequency floor out loud, with the number the rule actually uses', async () => {
    serve()
    renderPage()
    expect(
      await screen.findByText(
        'Las palabras se muestran como frecuencias, nunca su texto, y solo cuando 5 personas hayan respondido.',
      ),
    ).toBeTruthy()
  })

  it('states the anonymity contract the payload actually reports', async () => {
    serve()
    renderPage()
    expect(await screen.findByText('No se asocia a usted')).toBeTruthy()

    cleanup()
    serve({
      resolve: () =>
        new Response(
          JSON.stringify(
            invitation({
              anonymity: { ...invitation().anonymity, anonymous: false, highestRecordableState: 'completed' },
            }),
          ),
          { status: 200 },
        ),
    })
    setToken('a-stored-session')
    renderPage()
    expect(await screen.findByText('Este pulso registra quién participa')).toBeTruthy()
    expect(screen.queryByText('No se asocia a usted')).toBeNull()
  })

  it('records opened on arrival and started only when the respondent begins', async () => {
    serve()
    renderPage()
    const begin = await screen.findByRole('button', { name: /Responder/ })
    await waitFor(() => expect(steps()).toEqual(['opened']))

    await userEvent.click(begin)
    await waitFor(() => expect(steps()).toEqual(['opened', 'started']))
  })
})

describe('MicroclimateInvitationNextPage — the six states', () => {
  /**
   * The states artboard's own sentence: "Una frase por caso, **en el lugar de la
   * invitación**". A state that appeared under the landing card would leave the button —
   * and the pulse's title — on a page that cannot be answered.
   */
  it.each([
    ['expired', refused(410, 'expired'), 'Invitación caducada', 'Esta invitación caducó'],
    ['revoked', refused(410, 'revoked'), 'Invitación anulada', 'Esta invitación fue anulada'],
    ['notFound', refused(404, 'not_found'), 'Invitación no encontrada', 'No encontramos esta invitación'],
    ['used', refused(409, 'already_completed'), 'Invitación ya usada', 'Ya participó'],
  ])('draws the %s state in place of the invitation', async (_kind, resolve, label, title) => {
    serve({ resolve })
    renderPage()

    expect(await screen.findByRole('heading', { name: title })).toBeTruthy()
    expect(screen.getByText(label)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Responder/ })).toBeNull()
  })

  /**
   * Fail closed. A refused token must not put the session's title, description or dates on
   * a page that anybody holding the URL can open — the leak a shared-report link produced
   * once already, and that only an integration run caught.
   */
  it.each([
    ['expired', refused(410, 'expired')],
    ['revoked', refused(410, 'revoked')],
    ['notFound', refused(404, 'not_found')],
    ['used', refused(409, 'already_completed')],
    ['unknown', refused(429, null)],
  ])('leaks nothing about the pulse on the %s state', async (_kind, resolve) => {
    serve({ resolve })
    renderPage()
    await screen.findByRole('heading')

    const text = document.body.textContent ?? ''
    expect(text).not.toContain('Pulso semanal')
    expect(text).not.toContain('Dos preguntas')
    expect(text).not.toContain('sept')
    expect(text).not.toContain('micro-42')
  })

  it('records nothing at all for a token the server refuses', async () => {
    serve({ resolve: refused(410, 'expired') })
    renderPage()
    await screen.findByRole('heading', { name: 'Esta invitación caducó' })
    expect(steps()).toEqual([])
  })

  it('draws the closed pulse with the day it closed, not a bare refusal', async () => {
    serve({ resolve: () => new Response(JSON.stringify(invitation({ microclimateStatus: 'closed' })), { status: 200 }) })
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Este pulso ya no recibe respuestas' })).toBeTruthy()
    expect(screen.getByText(/Cerró el 11 de septiembre/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Responder/ })).toBeNull()
  })

  /**
   * "Iniciar sesión y volver aquí" — the label is only true if the destination travels. The
   * button carries this invitation's own path, and `safeReturnPath` is what `LoginPage`
   * reads it back through.
   */
  it('takes an identified pulse’s visitor to sign in, carrying this invitation back', async () => {
    serve({
      resolve: () =>
        new Response(
          JSON.stringify(invitation({ anonymity: { ...invitation().anonymity, anonymous: false } })),
          { status: 200 },
        ),
    })
    renderPage()

    const action = await screen.findByRole('link', { name: 'Iniciar sesión y volver aquí' })
    expect(screen.getByText('Pulso con nombre · sin sesión iniciada')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Responder/ })).toBeNull()

    await userEvent.click(action)
    expect(await screen.findByText('login page')).toBeTruthy()
    expect(safeReturnPath(loginState)).toBe(`/microclimate-invitations/${TOKEN}`)
  })

  /**
   * A status this build has no copy for is a 429, a 5xx or an offline fetch. The server's
   * own message is a better answer than the nearest sentence we happen to have — and never
   * a blank.
   */
  it('falls back to the server’s own words for a refusal it cannot name', async () => {
    serve({ resolve: refused(429, null, 'Too many attempts. Try again in a minute.') })
    renderPage()
    expect(await screen.findByRole('heading', { name: 'No se pudo abrir esta invitación' })).toBeTruthy()
    expect(screen.getByText('Too many attempts. Try again in a minute.')).toBeTruthy()
  })

  it('shows a sentence and not a blank when the refusal carried no message', async () => {
    serve({ resolve: () => new Response('', { status: 500 }) })
    renderPage()
    const heading = await screen.findByRole('heading', { name: 'No se pudo abrir esta invitación' })
    const card = heading.closest('section')
    expect(card?.textContent?.trim().length).toBeGreaterThan(40)
  })
})

describe('MicroclimateInvitationNextPage — answering', () => {
  it('lets the respondent answer even when every tracking call fails', async () => {
    serve({ steps: () => new Response('', { status: 500 }) })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Responder/ }))
    expect(await screen.findByText('¿Cómo te sientes hoy?')).toBeTruthy()
  })

  it('withholds the bearer from the invitation routes', async () => {
    serve()
    setToken('a-stored-session')
    renderPage()
    await screen.findByRole('button', { name: /Responder/ })

    const invitationCalls = vi
      .mocked(fetch)
      .mock.calls.filter((call) => String(call[0]).includes('/microclimate-invitations/'))
    expect(invitationCalls.length).toBeGreaterThan(0)
    for (const [, init] of invitationCalls) {
      expect(init?.headers).toBeUndefined()
    }
  })
})
