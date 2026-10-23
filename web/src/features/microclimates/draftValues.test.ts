import { describe, it, expect } from 'vitest'
import type { MicroclimateDetail } from './api/microclimates'
import { buildCreateInput, buildReplaceInput, wizardValuesFromDraft } from './wizardValues'

function draft(overrides: Partial<MicroclimateDetail>): MicroclimateDetail {
  return {
    id: 'm1',
    title: 'Pulse',
    description: null,
    companyId: 'c1',
    createdBy: 'u1',
    status: 'draft',
    responseCount: 0,
    targetParticipantCount: 14,
    startTime: '2026-10-23T15:00:00Z',
    endTime: '2026-10-23T17:00:00Z',
    anonymousResponses: false,
    showLiveResults: true,
    questions: [],
    language: 'en',
    resolvedLocale: 'en',
    fallbackFields: [],
    ...overrides,
  }
}

let n = 0
const nextKey = () => `k${++n}`

describe('a draft as the form edits it (G23)', () => {
  it('takes each column of a bilingual draft from its own read, and leaves a fallback empty', () => {
    const question = { id: 'q1', type: 'multiple_choice', required: true, order: 1, emojiOptions: null }
    const en = draft({
      language: 'both',
      title: 'Weekly pulse',
      questions: [{ ...question, text: 'How was it?', options: [{ order: 0, value: 'Good', label: 'Good' }, { order: 1, value: 'Bad', label: 'Bad' }] }],
    })
    const es = draft({
      language: 'both',
      resolvedLocale: 'es',
      title: 'Pulso semanal',
      // The second option has no Spanish label: the server filled it from English and said so.
      fallbackFields: ['questions[1].options[1].label'],
      questions: [{ ...question, text: '¿Cómo fue?', options: [{ order: 0, value: 'Good', label: 'Bien' }, { order: 1, value: 'Bad', label: 'Bad' }] }],
    })

    const values = wizardValuesFromDraft(en, es, nextKey)

    expect(values.language).toBe('both')
    expect([values.titleEn, values.titleEs]).toEqual(['Weekly pulse', 'Pulso semanal'])
    expect(values.questions[0]).toMatchObject({ textEn: 'How was it?', textEs: '¿Cómo fue?', type: 'multiple_choice', required: true })
    expect(values.questions[0]!.options.map((option) => [option.labelEn, option.labelEs])).toEqual([
      ['Good', 'Bien'],
      ['Bad', ''],
    ])
    expect(values.targetParticipantCount).toBe('14')
    expect(values.anonymousResponses).toBe(false)
    expect(new Date(values.startTime).toISOString()).toBe('2026-10-23T15:00:00.000Z')
  })

  it('reads a Spanish-only draft into the Spanish column, with its emoji scale', () => {
    const es = draft({
      language: 'es',
      resolvedLocale: 'es',
      title: 'Pulso',
      questions: [
        {
          id: 'q1',
          text: '¿Cómo se siente?',
          type: 'emoji_rating',
          options: null,
          required: false,
          order: 1,
          emojiOptions: [
            { order: 0, emoji: '😢', value: 1, label: 'Mal' },
            { order: 1, emoji: '🙂', value: 2, label: 'Bien' },
          ],
        },
      ],
    })

    const values = wizardValuesFromDraft(null, es, nextKey)

    expect(values.language).toBe('es')
    expect([values.titleEn, values.titleEs]).toEqual(['', 'Pulso'])
    expect(values.questions[0]!.emojiOptions.map((face) => [face.emoji, face.labelEs])).toEqual([
      ['😢', 'Mal'],
      ['🙂', 'Bien'],
    ])
  })

  it('sends the create body minus the company and the template', () => {
    const values = wizardValuesFromDraft(draft({ title: 'Pulse', questions: [{ id: 'q', text: 'Why?', type: 'open_ended', options: null, required: true, order: 1 }] }), null, nextKey)
    // toEqual reads an undefined property as absent, so this is "the create body without those two".
    expect(buildReplaceInput(values)).toEqual({ ...buildCreateInput(values, 'c1'), companyId: undefined, templateId: undefined })
    expect(buildReplaceInput(values)).not.toHaveProperty('companyId')
  })
})
