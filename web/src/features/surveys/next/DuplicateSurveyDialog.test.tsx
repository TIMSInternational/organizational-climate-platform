import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../i18n'
import es from '../../../i18n/es.json'
import { DuplicateSurveyDialog } from './DuplicateSurveyDialog'

const D = es.surveys.next.duplicate

function renderDialog(onDuplicate = vi.fn()) {
  const onOpenChange = vi.fn()
  render(
    <TranslationProvider>
      <DuplicateSurveyDialog open onOpenChange={onOpenChange} onDuplicate={onDuplicate} />
    </TranslationProvider>,
  )
  return { onDuplicate, onOpenChange, dialog: screen.getByTestId('duplicate-survey-dialog') }
}

/**
 * «Duplicar» asks first (ruled 2026-11-18): the same audience by default -- today's copy -- or
 * the questions only, the audience left to choose. It says that the settings travel either way.
 */
describe('DuplicateSurveyDialog', () => {
  beforeEach(() => localStorage.setItem(LOCALE_STORAGE_KEY, 'es'))
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('offers both copies in Spanish, says what travels either way, and defaults to the same audience', async () => {
    const user = userEvent.setup()
    const { dialog, onDuplicate } = renderDialog()

    expect(within(dialog).getByText(D.title)).toBeTruthy()
    expect(within(dialog).getByText(D.withAudience)).toBeTruthy()
    expect(within(dialog).getByText(D.questionsOnly)).toBeTruthy()
    expect(within(dialog).getByText(D.questionsOnlyHelp)).toBeTruthy()
    expect(within(dialog).getByText(D.keeps)).toBeTruthy()
    expect(within(dialog).getByRole('radio', { name: new RegExp(D.withAudience) }).getAttribute('aria-checked')).toBe('true')

    await user.click(within(dialog).getByRole('button', { name: D.confirm }))
    expect(onDuplicate).toHaveBeenCalledWith(true)
  })

  it('makes the questions-only copy when that is chosen', async () => {
    const user = userEvent.setup()
    const { dialog, onDuplicate } = renderDialog()

    await user.click(within(dialog).getByRole('radio', { name: new RegExp(D.questionsOnly) }))
    await user.click(within(dialog).getByRole('button', { name: D.confirm }))

    expect(onDuplicate).toHaveBeenCalledWith(false)
  })

  it('sends nothing when cancelled', async () => {
    const user = userEvent.setup()
    const { dialog, onDuplicate, onOpenChange } = renderDialog()

    await user.click(within(dialog).getByRole('button', { name: es.common.cancel }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onDuplicate).not.toHaveBeenCalled()
  })
})
