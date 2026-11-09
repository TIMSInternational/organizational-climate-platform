import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../i18n'
import { clearToken, setToken } from '../../../auth/token'
import { tokenFor } from '../../../test/jwtFixture'
import es from '../../../i18n/es.json'
import { ErasePerson } from './ErasePerson'
import type { User } from '../api/users'

const E = es.users.next.erase

const PERSON = {
  id: 'u-9',
  name: 'Ana Sancho',
  email: 'asancho@esph.test',
  role: 'employee',
  isActive: true,
} as unknown as User

function stubFetch(status = 200, body: unknown = { erased: true }) {
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

/** «Eliminar persona» (ruled 2026-11-08): the GDPR erasure behind a button, not «Desactivar». */
describe('Deleting a person', () => {
  beforeEach(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    setToken(tokenFor({ role: 'super_admin' }))
  })
  afterEach(() => {
    cleanup()
    clearToken()
    vi.unstubAllGlobals()
  })

  it('says what it does, needs their email typed, then erases them and closes', async () => {
    const sent = stubFetch()
    const onErased = vi.fn()
    const user = userEvent.setup()
    render(
      <TranslationProvider>
        <ErasePerson user={PERSON} onErased={onErased} />
      </TranslationProvider>,
    )

    await user.click(screen.getByRole('button', { name: E.action }))
    const dialog = await screen.findByRole('dialog')
    for (const effect of [E.effectIdentity, E.effectAccess, E.effectAnswers, E.effectLog]) {
      expect(within(dialog).getByText(effect)).toBeTruthy()
    }
    const confirm = within(dialog).getByRole('button', { name: E.confirm })
    expect(confirm.hasAttribute('disabled')).toBe(true)

    await user.type(within(dialog).getByLabelText(E.typeEmail.replace('{email}', 'asancho@esph.test')), 'ASANCHO@esph.test')
    await user.click(confirm)

    expect(sent).toEqual([{ url: expect.stringMatching(/\/gdpr\/erasure$/) as unknown as string, body: { userId: 'u-9', confirm: true } }])
    expect(onErased).toHaveBeenCalledOnce()
  })

  it('says a refusal and keeps the person', async () => {
    stubFetch(400, { message: 'You cannot erase yourself' })
    const onErased = vi.fn()
    const user = userEvent.setup()
    render(
      <TranslationProvider>
        <ErasePerson user={PERSON} onErased={onErased} />
      </TranslationProvider>,
    )

    await user.click(screen.getByRole('button', { name: E.action }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(E.typeEmail.replace('{email}', 'asancho@esph.test')), 'asancho@esph.test')
    await user.click(within(dialog).getByRole('button', { name: E.confirm }))

    expect(await within(dialog).findByText(E.failed)).toBeTruthy()
    expect(onErased).not.toHaveBeenCalled()
  })
})
