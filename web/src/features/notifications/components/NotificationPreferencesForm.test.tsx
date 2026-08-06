import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../i18n'
import NotificationPreferencesForm from './NotificationPreferencesForm'
import type { NotificationPreferences } from '../api/notificationPreferences'

afterEach(cleanup)

const OPTED_IN: NotificationPreferences = {
  emailSurveys: true,
  emailMicroclimates: true,
  emailActionPlans: true,
  emailReminders: true,
  digestFrequency: 'weekly',
}

function renderForm(
  preferences: NotificationPreferences = OPTED_IN,
  onSubmit: (values: NotificationPreferences) => Promise<void> = () => Promise.resolve(),
) {
  return render(
    <TranslationProvider>
      <NotificationPreferencesForm preferences={preferences} onSubmit={onSubmit} />
    </TranslationProvider>,
  )
}

describe('NotificationPreferencesForm', () => {
  it('exposes exactly five controls: four email switches and the digest choice', () => {
    renderForm()
    expect(screen.getAllByRole('switch')).toHaveLength(4)
    expect(screen.getAllByRole('radio')).toHaveLength(4)
  })

  it('never offers a push toggle — the platform has no push delivery path', () => {
    const { container } = renderForm()
    expect(container.textContent?.toLowerCase()).not.toContain('push')
  })

  it('reflects the saved state rather than a default', () => {
    renderForm({
      emailSurveys: false,
      emailMicroclimates: true,
      emailActionPlans: false,
      emailReminders: false,
      digestFrequency: 'never',
    })

    const switches = screen.getAllByRole('switch')
    expect(switches.map((node) => node.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ])
    expect(screen.getByLabelText('Never send a digest').getAttribute('aria-checked')).toBe('true')
  })

  it('states each switch position in words, so a default cannot read as a choice', () => {
    renderForm({ ...OPTED_IN, emailSurveys: false })

    expect(screen.getAllByText(/Currently off: you do not receive this email\./)).toHaveLength(1)
    expect(screen.getAllByText(/Currently on: you receive this email\./)).toHaveLength(3)
  })

  it('updates the stated position when a switch is toggled', async () => {
    renderForm()
    expect(screen.queryByText(/Currently off/)).toBeNull()

    await userEvent.click(screen.getAllByRole('switch')[0])
    expect(screen.getAllByText(/Currently off: you do not receive this email\./)).toHaveLength(1)
  })

  it('submits exactly what was set, all five values, never a partial payload', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderForm(OPTED_IN, onSubmit)

    await userEvent.click(screen.getAllByRole('switch')[0])
    await userEvent.click(screen.getAllByRole('switch')[3])
    await userEvent.click(screen.getByLabelText('Monthly'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith({
      emailSurveys: false,
      emailMicroclimates: true,
      emailActionPlans: true,
      emailReminders: false,
      digestFrequency: 'monthly',
    })
  })

  it('leaves untouched preferences at their saved value on submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const optedOut: NotificationPreferences = {
      emailSurveys: false,
      emailMicroclimates: false,
      emailActionPlans: false,
      emailReminders: false,
      digestFrequency: 'never',
    }
    renderForm(optedOut, onSubmit)

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(optedOut))
  })

  it('confirms a save, and clears that confirmation the moment anything changes again', async () => {
    renderForm(OPTED_IN, () => Promise.resolve())

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Your notification preferences were saved.')).toBeTruthy()

    await userEvent.click(screen.getAllByRole('switch')[1])
    expect(screen.queryByText('Your notification preferences were saved.')).toBeNull()
  })

  it('reports a failed save and does not claim success', async () => {
    renderForm(OPTED_IN, () => Promise.reject(new Error('digestFrequency is required')))

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('digestFrequency is required')
    expect(screen.queryByText('Your notification preferences were saved.')).toBeNull()
  })

  it('marks account and security email as non-optional instead of offering a dead toggle', () => {
    renderForm()
    expect(screen.getByText('Always sent')).toBeTruthy()
    expect(
      screen.getByText(/Sign-in, password and account-security messages are always sent\./),
    ).toBeTruthy()
    // Five stored-and-exposed controls only: the always-sent category has none.
    expect(screen.getAllByRole('switch')).toHaveLength(4)
  })

  it('gives every control a real label a keyboard user can reach', async () => {
    renderForm()

    expect(screen.getByLabelText('Survey email')).toBeTruthy()
    expect(screen.getByLabelText('Microclimate email')).toBeTruthy()
    expect(screen.getByLabelText('Action plan email')).toBeTruthy()
    expect(screen.getByLabelText('Reminder email')).toBeTruthy()
    for (const option of ['Daily', 'Weekly', 'Monthly', 'Never send a digest']) {
      expect(screen.getByLabelText(option)).toBeTruthy()
    }

    // Toggling with the keyboard, not the mouse.
    const first = screen.getAllByRole('switch')[0]
    first.focus()
    await userEvent.keyboard(' ')
    expect(first.getAttribute('aria-checked')).toBe('false')
  })

  it('renders every string through the catalogue, in Spanish too', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    try {
      renderForm()
      expect(screen.getByText('Notificaciones por correo')).toBeTruthy()
      expect(screen.getByLabelText('Correos de encuestas')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Guardar' })).toBeTruthy()
    } finally {
      localStorage.removeItem(LOCALE_STORAGE_KEY)
    }
  })
})
