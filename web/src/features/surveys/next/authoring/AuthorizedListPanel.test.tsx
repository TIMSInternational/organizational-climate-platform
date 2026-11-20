import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AuthorizedListPanel, { OutsideAuthorizedListMark } from './AuthorizedListPanel'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import es from '../../../../i18n/es.json'
import type { AuthorizedListView, AuthorizedPerson } from '../../api/authorizedList'

const T = es.surveys.next.authorizedList
const SURVEY = '33333333-3333-3333-3333-333333333333'

function person(email: string, over: Partial<AuthorizedPerson> = {}): AuthorizedPerson {
  return { id: `id-${email}`, email, displayName: null, addedAt: '2026-11-19T15:00:00Z', addedBy: 'op', addedByName: 'Operadora TIMS', ...over }
}

function view(people: AuthorizedPerson[], over: Partial<AuthorizedListView> = {}): AuthorizedListView {
  return { surveyId: SURVEY, count: people.length, editable: true, lockReason: null, people, ...over }
}

type Sent = { method: string; url: string; body: unknown }
let sent: Sent[] = []

/** GET answers `list`; a write answers whatever `onWrite` returns for it. */
function serve(list: () => AuthorizedListView, onWrite: (s: Sent) => Response = () => new Response('{}', { status: 200 })) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const s = { method: init?.method ?? 'GET', url: String(input), body: init?.body ? JSON.parse(init.body as string) : null }
    sent.push(s)
    if (s.method === 'GET') return Promise.resolve(new Response(JSON.stringify(list()), { status: 200 }))
    return Promise.resolve(onWrite(s))
  })
}

function renderPanel(extra?: ReactNode) {
  render(
    <TranslationProvider>
      <AuthorizedListPanel surveyId={SURVEY} />
      {extra}
    </TranslationProvider>,
  )
}

beforeEach(() => {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
  vi.stubGlobal('fetch', vi.fn())
  sent = []
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('AuthorizedListPanel', () => {
  it('with no list says sends work as always, and marks nobody in the roster', async () => {
    serve(() => view([]))
    renderPanel(<OutsideAuthorizedListMark email="cualquiera@cliente.com" />)

    expect(await screen.findByText(T.none)).toBeTruthy()
    expect(screen.queryByText(es.surveys.next.roster.outsideList)).toBeNull()
  })

  it('shows who is on the list, who added each, and marks a roster address that is not on it', async () => {
    serve(() => view([person('ana@cliente.com', { displayName: 'Ana Pérez' }), person('bea@cliente.com', { addedByName: null })]))
    renderPanel(
      <>
        <OutsideAuthorizedListMark email="  ANA@cliente.com" />
        <OutsideAuthorizedListMark email="carlos@cliente.com" />
      </>,
    )

    expect(await screen.findByText(T.count.replace('{count}', '2'))).toBeTruthy()
    expect(screen.getByText('Ana Pérez')).toBeTruthy()
    expect(screen.getByText('Operadora TIMS')).toBeTruthy()
    expect(screen.getByText(T.unknownAdder)).toBeTruthy()
    // Ana is on it (matched as the server matches: trimmed, lower-case); Carlos is the one outside.
    expect(screen.getAllByText(es.surveys.next.roster.outsideList)).toHaveLength(1)
  })

  it('adds one person with the name typed beside the address', async () => {
    let list = view([person('ana@cliente.com')])
    serve(
      () => list,
      (s) => {
        list = view([person('ana@cliente.com'), person('bea@cliente.com', { displayName: 'Bea Solís' })])
        return new Response(JSON.stringify(person('bea@cliente.com', { displayName: (s.body as { displayName: string }).displayName })), { status: 201 })
      },
    )
    renderPanel()
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText(new RegExp(`^${T.emailLabel}\\b`)), 'bea@cliente.com')
    await user.type(screen.getByLabelText(T.nameLabel), 'Bea Solís')
    await user.click(screen.getByRole('button', { name: T.add }))

    await screen.findByText(T.added.replace('{email}', 'bea@cliente.com'))
    const post = sent.find((s) => s.method === 'POST')!
    expect(post.url).toBe(`${import.meta.env.VITE_API_BASE_URL}/surveys/${SURVEY}/authorized-people`)
    expect(post.body).toEqual({ email: 'bea@cliente.com', displayName: 'Bea Solís' })
  })

  it('loads a pasted column, replacing the list only when asked, and reports what it did', async () => {
    serve(
      () => view([person('ana@cliente.com')]),
      () =>
        new Response(
          JSON.stringify({
            added: ['bea@cliente.com'],
            alreadyOnList: ['ana@cliente.com'],
            duplicatesInPaste: [],
            removed: ['zoe@cliente.com'],
            list: view([person('ana@cliente.com'), person('bea@cliente.com')]),
          }),
          { status: 200 },
        ),
    )
    renderPanel()
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText(T.pasteLabel, { exact: false }), 'ana@cliente.com{enter}bea@cliente.com	Bea Solís')
    expect(screen.getByText(T.read.replace('{count}', '2'))).toBeTruthy()
    await user.click(screen.getByLabelText(T.replace, { exact: false }))
    await user.click(screen.getByRole('button', { name: T.submit }))

    await waitFor(() => expect(sent.some((s) => s.method === 'POST')).toBe(true))
    const post = sent.find((s) => s.method === 'POST')!
    expect(post.url).toBe(`${import.meta.env.VITE_API_BASE_URL}/surveys/${SURVEY}/authorized-people/bulk`)
    expect(post.body).toEqual({
      entries: [{ email: 'ana@cliente.com' }, { email: 'bea@cliente.com', displayName: 'Bea Solís' }],
      replace: true,
    })
    expect(await screen.findByText(/Se agregaron 1\. Ya estaban en la lista: 1\..*Se quitaron 1/)).toBeTruthy()
  })

  it('says which pasted entries are not addresses when the API refuses the paste', async () => {
    serve(
      () => view([]),
      () => new Response(JSON.stringify({ message: 'English', code: 'survey_authorized_list_invalid', invalid: ['ana@'] }), { status: 400 }),
    )
    renderPanel()
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText(T.pasteLabel, { exact: false }), 'bea@cliente.com')
    await user.click(screen.getByRole('button', { name: T.submit }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(es.errors.api.codes.survey_authorized_list_invalid)
    expect(alert.textContent).toContain('ana@')
    expect(alert.textContent).not.toContain('English')
  })

  it('offers no editing to a viewer the list is locked for, and says why', async () => {
    serve(() => view([person('ana@cliente.com')], { editable: false, lockReason: 'survey_authorized_list_locked' }))
    renderPanel()

    expect(await screen.findByText(es.errors.api.codes.survey_authorized_list_locked)).toBeTruthy()
    expect(screen.queryByRole('button', { name: T.add })).toBeNull()
    expect(screen.queryByRole('button', { name: T.remove })).toBeNull()
  })
})
