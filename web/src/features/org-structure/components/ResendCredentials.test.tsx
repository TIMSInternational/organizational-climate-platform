import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResendCredentials } from './ResendCredentials'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../i18n'
import type { User } from '../api/users'

const resendCredentials = vi.fn<(...args: unknown[]) => Promise<{ delivered: boolean; failureReason: string | null }>>()
vi.mock('../api/users', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resendCredentials: (...args: unknown[]) => resendCredentials(...args),
}))

afterEach(() => {
  cleanup()
  resendCredentials.mockReset()
  localStorage.removeItem(LOCALE_STORAGE_KEY)
})

function person(overrides: Partial<User> = {}): User {
  return {
    id: 'u-7',
    email: 'marta@esph.test',
    name: 'Marta',
    role: 'employee',
    departmentId: 'd1',
    isActive: true,
    lastLoginAt: null,
    createdAt: '2026-10-13T00:00:00Z',
    username: 'marta.v',
    ...overrides,
  }
}

function show(user: User) {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
  return render(
    <TranslationProvider>
      <ResendCredentials user={user} baseUrl="http://api.test" />
    </TranslationProvider>,
  )
}

describe('ResendCredentials', () => {
  /**
   * The whole point of the component: before it existed, `POST /admin/users/{id}/credentials`
   * had no caller, so an account whose credentials email failed could only be recovered by
   * deleting the person and importing them again.
   */
  it('sends a fresh pair for a mass-invite account', async () => {
    const user = userEvent.setup()
    resendCredentials.mockResolvedValue({ delivered: true, failureReason: null })
    show(person())

    await user.click(screen.getByRole('button', { name: 'Reenviar datos de acceso' }))

    await waitFor(() => expect(resendCredentials).toHaveBeenCalledWith('http://api.test', 'u-7'))
    expect(await screen.findByText('Datos de acceso enviados')).toBeTruthy()
  })

  /**
   * An account that signs in by email has no generated pair to replace, and the API answers
   * such a request 409 `not_mass_invite`. Offering the action would be offering a 409.
   */
  it('offers nothing for an account that signs in by email', () => {
    show(person({ username: null }))

    expect(screen.queryByRole('button', { name: 'Reenviar datos de acceso' })).toBeNull()
  })

  /**
   * Found by clicking it against a real API: locally there is no mail provider, the endpoint
   * answered 200 with `delivered: false`, and this said "Datos de acceso enviados" -- the same
   * defect as the one this change exists to fix, one layer up. A mocked client cannot see it.
   */
  it('believes the server, not the status code, when the mail did not go', async () => {
    const user = userEvent.setup()
    resendCredentials.mockResolvedValue({ delivered: false, failureReason: 'no email provider' })
    show(person())

    await user.click(screen.getByRole('button', { name: 'Reenviar datos de acceso' }))

    expect(await screen.findByText('No se pudieron enviar los datos de acceso')).toBeTruthy()
    expect(screen.queryByText('Datos de acceso enviados')).toBeNull()
  })

  it('says so when the send fails, rather than looking like it worked', async () => {
    const user = userEvent.setup()
    resendCredentials.mockRejectedValue(new Error('smtp down'))
    show(person())

    await user.click(screen.getByRole('button', { name: 'Reenviar datos de acceso' }))

    expect(await screen.findByText('No se pudieron enviar los datos de acceso')).toBeTruthy()
    expect(screen.queryByText('Datos de acceso enviados')).toBeNull()
  })
})
