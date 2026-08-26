import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MicroclimateQuestionEditor from './MicroclimateQuestionEditor'
import { TranslationProvider } from '../../../i18n'
import {
  emptyEmojiOption,
  emptyQuestion,
  type ContentLanguage,
  type WizardQuestionValues,
} from '../wizardValues'

function emojiQuestion(overrides: Partial<WizardQuestionValues> = {}): WizardQuestionValues {
  return {
    ...emptyQuestion('q1'),
    textEn: 'How was the week?',
    textEs: '¿Cómo estuvo la semana?',
    type: 'emoji_rating',
    emojiOptions: [
      { ...emptyEmojiOption('e1'), emoji: '\u{1F622}', labelEn: 'Sad', labelEs: 'Triste' },
      { ...emptyEmojiOption('e2'), emoji: '\u{1F642}', labelEn: 'Good', labelEs: 'Bien' },
    ],
    ...overrides,
  }
}

function renderEditor(question: WizardQuestionValues, language: ContentLanguage) {
  const onChange = vi.fn()
  let key = 0
  render(
    <TranslationProvider>
      <MicroclimateQuestionEditor
        question={question}
        order={1}
        language={language}
        onChange={onChange}
        onRemove={() => {}}
        nextKey={() => `k${(key += 1)}`}
      />
    </TranslationProvider>,
  )
  return onChange
}

afterEach(cleanup)

/**
 * The authoring half of the emoji scale (#198).
 *
 * The editor's own comment claims it deliberately does NOT copy the pre-existing
 * multiple-choice defect — where a single-language field is bound to `labelEn`
 * whatever the content language is, so a Spanish-only session writes into the column
 * `localizedFor('es', …)` never reads. A comment is not a test: replacing the correct
 * binding with the defective one was green before these cases existed.
 */
describe('MicroclimateQuestionEditor emoji scale', () => {
  it('binds the single name field to the column the content language actually writes', async () => {
    // Spanish-only session. `labelEn` deliberately holds a different word, so a field
    // bound to the wrong column shows the wrong one rather than an empty box — the
    // failure mode is silent, not blank.
    const question = emojiQuestion({
      emojiOptions: [
        { ...emptyEmojiOption('e1'), emoji: '\u{1F622}', labelEn: 'Sad', labelEs: 'Triste' },
        { ...emptyEmojiOption('e2'), emoji: '\u{1F642}', labelEn: 'Good', labelEs: 'Bien' },
      ],
    })
    const onChange = renderEditor(question, 'es')

    const field = screen.getByLabelText(/^Name for emoji 1/) as HTMLInputElement
    expect(field.value).toBe('Triste')

    // And the edit lands in the same column it was read from. Writing to `labelEn` here
    // is what makes `buildCreateInput` send an empty label and the server answer 400.
    await userEvent.type(field, '!')
    const patched = onChange.mock.calls.at(-1)![0] as WizardQuestionValues
    expect(patched.emojiOptions[0].labelEs).toBe('Triste!')
    expect(patched.emojiOptions[0].labelEn).toBe('Sad')
  })

  it('asks for both names on a bilingual session', () => {
    renderEditor(emojiQuestion(), 'both')

    expect((screen.getByLabelText(/Name for emoji 1 \(English\)/) as HTMLInputElement).value).toBe('Sad')
    expect((screen.getByLabelText(/Name for emoji 1 \(Spanish\)/) as HTMLInputElement).value).toBe('Triste')
  })

  it('marks the glyph and the name required, because the server refuses a face without either', () => {
    renderEditor(emojiQuestion(), 'en')

    // The name in particular: it is the face's accessible name, and an optional-looking
    // field is how a scale reaches a respondent as four unlabelled pictures.
    expect(screen.getByLabelText(/^Emoji 1/).getAttribute('required')).not.toBeNull()
    expect(screen.getByLabelText(/^Name for emoji 1/).getAttribute('required')).not.toBeNull()
  })

  it('shows no emoji editor on a type that cannot store one', () => {
    renderEditor({ ...emojiQuestion(), type: 'multiple_choice' }, 'en')

    expect(screen.queryByLabelText(/^Emoji 1/)).toBeNull()
  })
})
