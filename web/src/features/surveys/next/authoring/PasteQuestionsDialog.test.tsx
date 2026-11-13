import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import es from '../../../../i18n/es.json'
import { PasteQuestionsDialog } from './PasteQuestionsDialog'
import type { ContentLanguage } from '../../wizardValues'

const P = es.surveys.next.builder.paste

/** PROCOMER's sheet shape: a numbering column, a theme, two wording rounds, a type. */
const SHEET = [
  '#\tTema\tPropuesta\tVersión Final para TIMS\tTipo',
  '1\tLiderazgo\tMi jefe me oye\tMi jefatura me escucha cuando propongo algo\tLikert 1-5',
  '2\tGeneral\tRecomendaría\t¿Qué tan probable es que recomiende PROCOMER?\teNPS 0-10',
].join('\r\n')

function renderDialog(language: ContentLanguage = 'es') {
  const onAdd = vi.fn()
  let next = 0
  render(
    <TranslationProvider>
      <PasteQuestionsDialog
        open
        onOpenChange={() => undefined}
        language={language}
        takeKeys={(count) => Array.from({ length: count }, () => `q${next++}`)}
        onAdd={onAdd}
      />
    </TranslationProvider>,
  )
  return onAdd
}

beforeEach(() => localStorage.setItem(LOCALE_STORAGE_KEY, 'es'))
afterEach(() => cleanup())

/** «Pegar desde Excel»: a client's own questionnaire into the wizard, verbatim or not at all. */
describe('Pasting questions from Excel', () => {
  it('lets the operator pick the final wording column and adds those words exactly', async () => {
    const user = userEvent.setup()
    const onAdd = renderDialog()
    const dialog = screen.getByRole('dialog')

    await user.click(within(dialog).getByLabelText(P.pasteLabel))
    await user.paste(SHEET)
    // The header suggests "Propuesta" is not the question; nothing is guessed, the operator picks.
    await user.selectOptions(within(dialog).getByLabelText(P.columnTextEs), 'D · Versión Final para TIMS')

    expect(within(dialog).getByRole('status').textContent).toBe(P.readyCount.replace('{count}', '2'))
    await user.click(within(dialog).getByRole('button', { name: P.add.replace('{count}', '2') }))

    const added = onAdd.mock.calls[0][0] as { textEs: string; category: string; type: string; scaleMin: number | null; scaleMax: number | null }[]
    expect(added.map((q) => [q.textEs, q.category, q.type, q.scaleMin, q.scaleMax])).toEqual([
      ['Mi jefatura me escucha cuando propongo algo', 'Liderazgo', 'likert', 1, 5],
      ['¿Qué tan probable es que recomiende PROCOMER?', 'General', 'rating', 0, 10],
    ])
  })

  it('adds nothing while one row cannot be read, and names its line', async () => {
    const user = userEvent.setup()
    const onAdd = renderDialog()
    const dialog = screen.getByRole('dialog')

    await user.click(within(dialog).getByLabelText(P.pasteLabel))
    await user.paste('Tema\tPregunta\tTipo\r\nLiderazgo\tMe escuchan\tLikert 1-5\r\nGeneral\tOrdene sus prioridades\tRanking')

    expect(within(dialog).getByText(P.problemType.replace('{line}', '3').replace('{value}', 'Ranking'))).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: P.add.replace('{count}', '2') }).hasAttribute('disabled')).toBe(true)
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('asks for the English column too on a bilingual survey', async () => {
    const user = userEvent.setup()
    renderDialog('both')
    const dialog = screen.getByRole('dialog')

    await user.click(within(dialog).getByLabelText(P.pasteLabel))
    await user.paste('Tema\tPregunta\r\nLiderazgo\tMe escuchan')

    expect(within(dialog).getByLabelText(P.columnTextEn)).toBeTruthy()
    expect(within(dialog).getByText(P.chooseText)).toBeTruthy()
  })
})
