import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { Toaster } from './toast'
import { toast } from 'sonner'
import { resolveToasterTheme } from './toasterTheme'
import { ADMIN_THEME_ATTRIBUTE } from '../../theme/adminTheme'

beforeEach(() => {
  document.documentElement.removeAttribute(ADMIN_THEME_ATTRIBUTE)
})

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute(ADMIN_THEME_ATTRIBUTE)
})

describe('resolveToasterTheme', () => {
  it('reads data-admin-theme, not next-themes', () => {
    document.documentElement.setAttribute(ADMIN_THEME_ATTRIBUTE, 'dark')
    expect(resolveToasterTheme()).toBe('dark')
  })

  it('is light when the attribute says light', () => {
    document.documentElement.setAttribute(ADMIN_THEME_ATTRIBUTE, 'light')
    expect(resolveToasterTheme()).toBe('light')
  })

  it('falls back to light when the attribute is absent', () => {
    expect(resolveToasterTheme()).toBe('light')
  })
})

describe('Toaster', () => {
  it('shows a toast raised from anywhere, with no prop threading', async () => {
    render(<Toaster />)
    toast('Saved')
    expect(await screen.findByText('Saved')).toBeTruthy()
  })

  it('renders success and error toasts', async () => {
    render(<Toaster />)
    toast.success('Created')
    toast.error('Failed')
    await waitFor(() => expect(screen.getByText('Created')).toBeTruthy())
    expect(screen.getByText('Failed')).toBeTruthy()
  })

  it('announces toasts in a polite live region', async () => {
    render(<Toaster />)
    // Sonner owns the region; assert it exists rather than trusting it, since a
    // toast nobody announces is invisible to a screen-reader user.
    const region = document.querySelector('section[aria-live]')
    expect(region?.getAttribute('aria-live')).toBe('polite')
  })
})
