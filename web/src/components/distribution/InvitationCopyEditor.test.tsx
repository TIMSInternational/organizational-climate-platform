import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranslationProvider } from '../../i18n'
import InvitationCopyEditor from './InvitationCopyEditor'
import type { InvitationCopyByLocale } from '../../features/surveys/api/surveyInvitationCopy'
import type { Locale } from '../../i18n'

afterEach(cleanup)

const BOTH_AUTHORED: InvitationCopyByLocale = {
  en: {
    subject: { text: 'Your invitation', authored: true },
    message: { text: 'Please answer by Friday.', authored: true },
  },
  es: {
    subject: { text: 'Tu invitación', authored: true },
    message: { text: 'Por favor responde antes del viernes.', authored: true },
  },
}

const SPANISH_MISSING: InvitationCopyByLocale = {
  en: {
    subject: { text: 'Your invitation', authored: true },
    message: { text: 'Please answer by Friday.', authored: true },
  },
  es: {
    subject: { text: '', authored: false },
    message: { text: '', authored: false },
  },
}

function renderEditor(
  copy: InvitationCopyByLocale,
  requiredLocales: Locale[],
  overrides: { onChange?: () => void; onSave?: () => void; editable?: boolean } = {},
) {
  return render(
    <TranslationProvider>
      <InvitationCopyEditor
        copy={copy}
        requiredLocales={requiredLocales}
        onChange={overrides.onChange ?? (() => {})}
        onSave={overrides.onSave ?? (() => {})}
        editable={overrides.editable ?? true}
      />
    </TranslationProvider>,
  )
}

describe('InvitationCopyEditor', () => {
  /**
   * The parity gap this component closes.
   *
   * The invitation subject and message live in paired `_en`/`_es` columns. One text box
   * would file whatever was typed into one column and leave the other empty, so half the
   * audience gets an invitation in a language they did not choose — the exact failure the
   * paired columns exist to prevent.
   */
  it('offers a box per language, both visible at once, when the survey is bilingual', () => {
    renderEditor(BOTH_AUTHORED, ['en', 'es'])

    expect(screen.getAllByLabelText('Subject')).toHaveLength(2)
    expect(screen.getAllByLabelText('Message')).toHaveLength(2)
    expect(screen.getByRole('heading', { name: 'English' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Spanish' })).toBeTruthy()
  })

  it('shows each language’s own text, never one language’s text in the other’s box', () => {
    renderEditor(BOTH_AUTHORED, ['en', 'es'])

    const subjects = screen.getAllByLabelText('Subject') as HTMLInputElement[]
    expect(subjects.map((input) => input.value)).toEqual(['Your invitation', 'Tu invitación'])
  })

  it('asks for one language only when the survey is written in one', () => {
    // Demanding a Spanish translation of an English-only survey would invent a
    // requirement the server's own publish gate does not have.
    renderEditor(BOTH_AUTHORED, ['en'])

    expect(screen.getAllByLabelText('Subject')).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: 'Spanish' })).toBeNull()
    expect(screen.queryByText(/needs both/)).toBeNull()
  })

  it('names every missing field and language rather than leaving an empty box', () => {
    renderEditor(SPANISH_MISSING, ['en', 'es'])

    expect(screen.getByText(/written in both languages/)).toBeTruthy()
    expect(screen.getByText('Subject in Spanish')).toBeTruthy()
    expect(screen.getByText('Message in Spanish')).toBeTruthy()
    expect(screen.queryByText('Subject in English')).toBeNull()
  })

  it('badges a language that has nothing of its own', () => {
    renderEditor(SPANISH_MISSING, ['en', 'es'])
    expect(screen.getByText('Not written yet')).toBeTruthy()
  })

  it('treats whitespace as missing, not as content', () => {
    const blank: InvitationCopyByLocale = {
      ...SPANISH_MISSING,
      es: {
        subject: { text: '   ', authored: true },
        message: { text: '\n', authored: true },
      },
    }
    renderEditor(blank, ['en', 'es'])

    expect(screen.getByText('Subject in Spanish')).toBeTruthy()
  })

  it('reports which language and field an edit belongs to', async () => {
    const onChange = vi.fn()
    renderEditor(SPANISH_MISSING, ['en', 'es'], { onChange })

    await userEvent.type((screen.getAllByLabelText('Subject') as HTMLInputElement[])[1], 'T')

    expect(onChange).toHaveBeenCalledWith('es', 'subject', 'T')
  })

  it('locks the whole surface for a closed survey, and says why', () => {
    renderEditor(BOTH_AUTHORED, ['en', 'es'], { editable: false })

    expect(screen.getByText(/closed, so its invitation wording can no longer be changed/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)
    for (const input of screen.getAllByLabelText('Subject')) {
      expect(input.hasAttribute('disabled')).toBe(true)
    }
  })

  it('still lets an incomplete pair be saved, because a draft is not an error', async () => {
    // The missing-content notice is guidance, not a gate: an admin part-way through a
    // translation must be able to keep what they have written. The gate that matters runs
    // server-side at publish time.
    const onSave = vi.fn()
    renderEditor(SPANISH_MISSING, ['en', 'es'], { onSave })

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})
