import { describe, it, expect } from 'vitest'
import {
  buildCreateInput,
  defaultEmojiScale,
  derivedOptionValue,
  emptyEmojiOption,
  emptyOption,
  emptyQuestion,
  emptyWizardValues,
  localizedFor,
  scheduledMinutes,
  wizardStepErrors,
  type MicroclimateWizardValues,
  type WizardEmojiOptionValues,
} from './wizardValues'
import type { TranslateFn } from '../../i18n'

/** Returns the key path plus its params, so a message can be asserted by key. */
const t: TranslateFn = (key, params) =>
  params ? `${key}(${Object.values(params).join(',')})` : key

function values(overrides: Partial<MicroclimateWizardValues> = {}): MicroclimateWizardValues {
  return {
    ...emptyWizardValues('en'),
    titleEn: 'Team pulse',
    startTime: '2026-08-07T10:00',
    endTime: '2026-08-07T10:20',
    questions: [{ ...emptyQuestion('q1'), textEn: 'How was the week?' }],
    ...overrides,
  }
}

describe('localizedFor', () => {
  it('sends a bare string for a single-language microclimate', () => {
    // `LocalizedInput` attributes a bare string to the content's own language, which
    // is what keeps single-language authoring from needing a one-entry map.
    expect(localizedFor('en', 'Team pulse', '')).toBe('Team pulse')
    expect(localizedFor('es', '', 'Pulso de equipo')).toBe('Pulso de equipo')
  })

  it('sends the locale map for a bilingual microclimate, never a bare string', () => {
    // `TryResolve` rejects a bare string when the content is authored in `both`,
    // rather than guessing which column it belongs in.
    expect(localizedFor('both', 'Team pulse', 'Pulso de equipo')).toEqual({
      en: 'Team pulse',
      es: 'Pulso de equipo',
    })
  })

  it('treats whitespace as absent', () => {
    expect(localizedFor('en', '   ', '')).toBeUndefined()
  })
})

describe('derivedOptionValue', () => {
  it('mirrors DeriveOptionValue: English label, else Spanish, else nothing', () => {
    expect(derivedOptionValue({ key: 'a', labelEn: ' Yes ', labelEs: 'Sí' })).toBe('Yes')
    expect(derivedOptionValue({ key: 'a', labelEn: '', labelEs: ' Sí ' })).toBe('Sí')
    expect(derivedOptionValue(emptyOption('a'))).toBeNull()
  })
})

describe('wizardStepErrors', () => {
  it('accepts a complete single-language session', () => {
    const errors = wizardStepErrors(values(), t)
    expect(errors.basics).toEqual([])
    expect(errors.schedule).toEqual([])
    expect(errors.audience).toEqual([])
    expect(errors.questions).toEqual([])
    expect(errors.review).toEqual([])
  })

  it('asks for both titles when the content is bilingual', () => {
    // The failure this prevents is a 400 from `TryResolve` after five steps of
    // typing, with a message about a JSON shape the author never saw.
    const errors = wizardStepErrors(values({ language: 'both', titleEs: '' }), t)
    expect(errors.basics).toEqual(['microclimates.validationTitleBoth'])
  })

  it('reads the Spanish title when the content is Spanish', () => {
    const spanish = values({ language: 'es', titleEn: 'Team pulse', titleEs: '' })
    expect(wizardStepErrors(spanish, t).basics).toEqual([
      'microclimates.validationTitleRequired',
    ])
  })

  it('rejects an end time at or before the start', () => {
    expect(wizardStepErrors(values({ endTime: '2026-08-07T10:00' }), t).schedule).toEqual([
      'microclimates.validationEndAfterStart',
    ])
  })

  it('does not add the ordering message while a time is still missing', () => {
    // Otherwise a blank form shows "the closing time must be after the opening
    // time" before either has been chosen.
    expect(wizardStepErrors(values({ startTime: '', endTime: '' }), t).schedule).toEqual([
      'microclimates.validationStartRequired',
      'microclimates.validationEndRequired',
    ])
  })

  it('requires a whole positive participant target', () => {
    expect(wizardStepErrors(values({ targetParticipantCount: '0' }), t).audience).toEqual([
      'microclimates.validationTargetPositive',
    ])
    expect(wizardStepErrors(values({ targetParticipantCount: '2.5' }), t).audience).toEqual([
      'microclimates.validationTargetPositive',
    ])
    expect(wizardStepErrors(values({ targetParticipantCount: '' }), t).audience).toEqual([
      'microclimates.validationTargetPositive',
    ])
  })

  it('refuses a session with no questions, which the server would accept', () => {
    // A product rule, not a mirror of a server rule: `CreateAsync` allows an empty
    // question list, and the result is a respond page with nothing on it.
    expect(wizardStepErrors(values({ questions: [] }), t).questions).toEqual([
      'microclimates.validationQuestionsRequired',
    ])
  })

  it('names the question by the same 1-based order the server uses', () => {
    const withBlank = values({
      questions: [
        { ...emptyQuestion('q1'), textEn: 'How was the week?' },
        emptyQuestion('q2'),
      ],
    })
    expect(wizardStepErrors(withBlank, t).questions).toEqual([
      'microclimates.validationQuestionText(2)',
    ])
  })

  it('requires two usable options on a multiple_choice question', () => {
    const choice = values({
      questions: [
        {
          ...emptyQuestion('q1'),
          textEn: 'Pick one',
          type: 'multiple_choice',
          options: [{ key: 'o1', labelEn: 'Yes', labelEs: '' }, emptyOption('o2')],
        },
      ],
    })
    expect(wizardStepErrors(choice, t).questions).toEqual([
      'microclimates.validationOptionsMin2(1)',
    ])
  })

  it('flags duplicate option values on the string the server will actually compare', () => {
    // The server derives the stored value from the English label and rejects a
    // repeat with `StringComparison.Ordinal`. Comparing the visible Spanish label
    // instead would miss this pair entirely.
    const choice = values({
      language: 'both',
      titleEs: 'Pulso',
      questions: [
        {
          ...emptyQuestion('q1'),
          textEn: 'Pick one',
          textEs: 'Elige una',
          type: 'multiple_choice',
          options: [
            { key: 'o1', labelEn: 'Yes', labelEs: 'Sí' },
            { key: 'o2', labelEn: 'Yes', labelEs: 'Claro' },
          ],
        },
      ],
    })
    expect(wizardStepErrors(choice, t).questions).toEqual([
      'microclimates.validationOptionsDuplicate(1,Yes)',
    ])
  })

  it('ignores options on a type that does not use them', () => {
    // `likert` falls back to a 1-5 scale server side, so an option list left behind
    // by switching type must not block the step.
    const scale = values({
      questions: [
        {
          ...emptyQuestion('q1'),
          textEn: 'Rate the week',
          type: 'likert',
          options: [emptyOption('o1')],
        },
      ],
    })
    expect(wizardStepErrors(scale, t).questions).toEqual([])
  })

  // #198. Each of these mirrors one refusal MicroclimateEndpoints.CreateAsync makes,
  // so the author reads the message beside the field rather than after a 400.
  it('requires at least two faces on an emoji_rating question', () => {
    const scale = values({
      questions: [
        {
          ...emptyQuestion('q1'),
          textEn: 'How was the week?',
          type: 'emoji_rating',
          emojiOptions: [{ ...emptyEmojiOption('e1'), emoji: '\u{1F642}', labelEn: 'Good' }],
        },
      ],
    })
    expect(wizardStepErrors(scale, t).questions).toEqual([
      'microclimates.validationEmojiOptionsMin2(1)',
    ])
  })

  it('requires a name on every face, because the name is its accessible name', () => {
    // The whole reason emoji_rating has its own table (#198): a face with a glyph and
    // no word reaches a screen reader with no name a respondent can rely on.
    const scale = values({
      questions: [
        {
          ...emptyQuestion('q1'),
          textEn: 'How was the week?',
          type: 'emoji_rating',
          emojiOptions: [
            { ...emptyEmojiOption('e1'), emoji: '\u{1F622}', labelEn: 'Sad' },
            { ...emptyEmojiOption('e2'), emoji: '\u{1F642}' },
          ],
        },
      ],
    })
    expect(wizardStepErrors(scale, t).questions).toEqual([
      'microclimates.validationEmojiLabel(1,2)',
    ])
  })

  it('asks for a name in both languages on a bilingual session', () => {
    const scale = values({
      language: 'both',
      titleEs: 'Pulso',
      questions: [
        {
          ...emptyQuestion('q1'),
          textEn: 'How was the week?',
          textEs: '¿Cómo estuvo la semana?',
          type: 'emoji_rating',
          emojiOptions: [
            { ...emptyEmojiOption('e1'), emoji: '\u{1F622}', labelEn: 'Sad', labelEs: 'Triste' },
            { ...emptyEmojiOption('e2'), emoji: '\u{1F642}', labelEn: 'Good' },
          ],
        },
      ],
    })
    expect(wizardStepErrors(scale, t).questions).toEqual([
      'microclimates.validationEmojiLabelBoth(1,2)',
    ])
  })

  it('accepts a named two-point scale', () => {
    const scale = values({
      questions: [
        {
          ...emptyQuestion('q1'),
          textEn: 'How was the week?',
          type: 'emoji_rating',
          emojiOptions: [
            { ...emptyEmojiOption('e1'), emoji: '\u{1F622}', labelEn: 'Sad' },
            { ...emptyEmojiOption('e2'), emoji: '\u{1F642}', labelEn: 'Good' },
          ],
        },
      ],
    })
    expect(wizardStepErrors(scale, t).questions).toEqual([])
  })

  it('ignores an emoji scale left behind by switching type', () => {
    // Faces typed before the author changed the type must not block the step -- and
    // `buildCreateInput` must not send them either, since the server REJECTS an emoji
    // scale on a type that cannot render one rather than ignoring it.
    const switched = values({
      questions: [
        {
          ...emptyQuestion('q1'),
          textEn: 'Anything to add?',
          type: 'open_ended',
          emojiOptions: [{ ...emptyEmojiOption('e1'), emoji: '\u{1F642}' }],
        },
      ],
    })
    expect(wizardStepErrors(switched, t).questions).toEqual([])
    expect(buildCreateInput(switched, 'company-1').questions?.[0].emojiOptions).toBeUndefined()
  })

  it('carries every other step onto review as a backstop', () => {
    const broken = values({ titleEn: '', targetParticipantCount: '0' })
    expect(wizardStepErrors(broken, t).review).toEqual([
      'microclimates.validationTitleRequired',
      'microclimates.validationTargetPositive',
    ])
  })
})

describe('scheduledMinutes', () => {
  it('reports the length of the session', () => {
    expect(scheduledMinutes(values())).toBe(20)
  })

  it('reports nothing rather than a negative duration', () => {
    expect(scheduledMinutes(values({ endTime: '2026-08-07T09:00' }))).toBeNull()
    expect(scheduledMinutes(values({ endTime: '' }))).toBeNull()
  })
})

describe('buildCreateInput', () => {
  it('sends the fields CreateMicroclimateRequest actually has, and no others', () => {
    const input = buildCreateInput(values(), 'company-1')

    expect(Object.keys(input).toSorted()).toEqual([
      'anonymousResponses',
      'companyId',
      'description',
      'endTime',
      'language',
      'questions',
      'startTime',
      'targetParticipantCount',
      'templateId',
      'title',
    ])
  })

  it('leaves the timezone to the API client rather than stamping a second one', () => {
    // `createMicroclimate` fills `timezone` and converts both datetime-local strings
    // to UTC. Doing either here would be a second place that has to know about the
    // offset problem.
    expect('timezone' in buildCreateInput(values(), 'company-1')).toBe(false)
    expect(buildCreateInput(values(), 'company-1').startTime).toBe('2026-08-07T10:00')
  })

  it('omits an untouched description rather than sending an empty one', () => {
    expect(buildCreateInput(values(), 'company-1').description).toBeUndefined()
  })

  it('omits an unselected template rather than sending an empty guid', () => {
    expect(buildCreateInput(values(), 'company-1').templateId).toBeUndefined()
    expect(buildCreateInput(values({ templateId: 'tpl-1' }), 'company-1').templateId).toBe('tpl-1')
  })

  it('numbers questions from 1 and drops options from types that do not use them', () => {
    const built = buildCreateInput(
      values({
        questions: [
          { ...emptyQuestion('q1'), textEn: 'One', type: 'open_ended', options: [emptyOption('o')] },
          {
            ...emptyQuestion('q2'),
            textEn: 'Two',
            type: 'multiple_choice',
            options: [
              { key: 'o1', labelEn: 'Yes', labelEs: '' },
              { key: 'o2', labelEn: 'No', labelEs: '' },
            ],
          },
        ],
      }),
      'company-1',
    )

    expect(built.questions?.map((q) => q.order)).toEqual([1, 2])
    expect(built.questions?.[0].options).toBeUndefined()
    expect(built.questions?.[1].options).toEqual([{ label: 'Yes' }, { label: 'No' }])
  })

  it('sends the emoji scale as glyph plus label, and no client-side value', () => {
    const built = buildCreateInput(
      values({
        questions: [
          {
            ...emptyQuestion('q1'),
            textEn: 'How was the week?',
            type: 'emoji_rating',
            emojiOptions: [
              { ...emptyEmojiOption('e1'), emoji: ' \u{1F622} ', labelEn: 'Sad' },
              { ...emptyEmojiOption('e2'), emoji: '\u{1F642}', labelEn: 'Good' },
              // Blank glyphs are dropped rather than sent -- the server would 400 on
              // one, and an empty row is an author who added a face and walked away.
              emptyEmojiOption('e3'),
            ],
          },
        ],
      }),
      'company-1',
    )

    // No `value`: the server numbers the scale by position, which is why the wizard
    // has no field for it. Sending one would be the client inventing stored keys.
    expect(built.questions?.[0].emojiOptions).toEqual([
      { emoji: '\u{1F622}', label: 'Sad' },
      { emoji: '\u{1F642}', label: 'Good' },
    ])
  })

  it('seeds four faces with glyphs and no names', () => {
    let n = 0
    const scale: WizardEmojiOptionValues[] = defaultEmojiScale(() => `k${(n += 1)}`)

    expect(scale).toHaveLength(4)
    expect(scale.every((face) => face.emoji.length > 0)).toBe(true)
    // Names are deliberately blank: a prefilled name is a name nobody chose, on the
    // one field whose job is to say what this face means in THIS question. (It would
    // also be English copy in a `.ts` module, which the #217 guard rejects.)
    expect(scale.every((face) => face.labelEn === '' && face.labelEs === '')).toBe(true)
    expect(new Set(scale.map((face) => face.key)).size).toBe(4)
  })

  it('sends bilingual question text as a locale map', () => {
    const built = buildCreateInput(
      values({
        language: 'both',
        titleEs: 'Pulso',
        questions: [{ ...emptyQuestion('q1'), textEn: 'One', textEs: 'Uno' }],
      }),
      'company-1',
    )

    expect(built.title).toEqual({ en: 'Team pulse', es: 'Pulso' })
    expect(built.questions?.[0].text).toEqual({ en: 'One', es: 'Uno' })
  })

  it('sends a bilingual emoji name as a locale map too, never a bare string', () => {
    // The counterpart of the option-label case above, and the one that costs most if
    // it regresses: `TryResolve` REJECTS a bare string on `both`-language content, so
    // sending `face.labelEn` here 400s every bilingual emoji scale at create time —
    // and the name is the only accessible name the face has.
    const built = buildCreateInput(
      values({
        language: 'both',
        titleEs: 'Pulso',
        questions: [
          {
            ...emptyQuestion('q1'),
            textEn: 'How was the week?',
            textEs: '¿Cómo estuvo la semana?',
            type: 'emoji_rating',
            emojiOptions: [
              { ...emptyEmojiOption('e1'), emoji: '\u{1F622}', labelEn: 'Sad', labelEs: 'Triste' },
              { ...emptyEmojiOption('e2'), emoji: '\u{1F642}', labelEn: 'Good', labelEs: 'Bien' },
            ],
          },
        ],
      }),
      'company-1',
    )

    expect(built.questions?.[0].emojiOptions).toEqual([
      { emoji: '\u{1F622}', label: { en: 'Sad', es: 'Triste' } },
      { emoji: '\u{1F642}', label: { en: 'Good', es: 'Bien' } },
    ])
  })
})
