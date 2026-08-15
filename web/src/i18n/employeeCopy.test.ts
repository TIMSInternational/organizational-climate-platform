import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CATALOGUES, LOCALES } from './locale'
import type { Locale, MessageNode } from './translate'

/**
 * The copy contract behind the approved employee design.
 *
 * Its three neighbours in this directory each guard something this one cannot.
 * `catalogues.test.ts` proves the two locales agree — but two locales agree
 * perfectly when a key is absent from both. `keysExist.test.ts` proves the code
 * asks for nothing missing — but only once the code exists, and these strings were
 * written one pass ahead of the pages that render them, precisely so the pages
 * could be built against a fixed vocabulary. `noHardcodedStrings.test.ts` proves
 * copy comes from a catalogue, not which catalogue entry it is.
 *
 * So this file asserts the two things about the *values* that the redesign cannot
 * survive losing:
 *
 * 1. **The anonymity floor is never explained by naming who fell below it.** The
 *    "what came of it" panel reports a protected department, and a clause that
 *    said "Finance — only 3 answered" would hand back, in the reassurance itself,
 *    the very reading the floor exists to withhold. The protected clause is the
 *    one string in this catalogue whose *placeholders* are a privacy boundary, and
 *    a well-meaning edit ("say which one, it reads better") is exactly how it would
 *    be crossed.
 *
 * 2. **Every dimension the *product* ships has its own heading.** The categories
 *    are `varchar(100)` free text, so the catalogue is a lookup rather than a
 *    controlled vocabulary. `SurveyRespondForm` prints a category the catalogue has
 *    never heard of in the author's own words, which is right for a word an author
 *    typed and wrong for the values the product itself chose: those are English
 *    slugs (`psychological_safety`), so a missing entry puts an English heading over
 *    a Spanish survey. Hence the sweep over the shipped fixture, and hence the
 *    second test, which is about what the entries *say* — two dimensions sharing
 *    wording, or one headed with the generic, is the same collapse the form was
 *    fixed for, reintroduced from the catalogue side.
 *
 * Plus a plain register of the keys the employee screens are being built against,
 * so that deleting one fails here rather than in whichever page renders it.
 */

/** Walks a dot path, mirroring `lookup` in translate.ts. */
function read(locale: Locale, key: string): string | null {
  let node: MessageNode | undefined = CATALOGUES[locale] as MessageNode
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, segment)) return null
    node = node[segment]
  }
  return typeof node === 'string' ? node : null
}

/**
 * The dimension headings a locale ships, keyed by the stored `Question.Category`.
 *
 * Read as a subtree rather than through `read`, because the assertions below are
 * about the set of entries — a heading nobody looked up is exactly the one that
 * drifts.
 */
function dimensions(locale: Locale): Record<string, string> {
  const root = CATALOGUES[locale] as MessageNode
  if (typeof root !== 'object') return {}
  const scope = root.surveyRespond
  if (typeof scope !== 'object') return {}
  const node = scope.dimensions
  if (typeof node !== 'object') return {}
  return Object.fromEntries(
    Object.entries(node).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

/** The `{placeholder}` names in a string, sorted. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
}

/**
 * Every `category` value anywhere in the respond fixture.
 *
 * The fixture is the recorded shape of the respond endpoint, so its categories are
 * the ones a respondent actually meets rather than a list invented here.
 */
function categoriesIn(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) categoriesIn(item, found)
  } else if (typeof node === 'object' && node !== null) {
    const record = node as Record<string, unknown>
    if (typeof record.category === 'string' && record.category.trim() !== '') {
      found.add(record.category.trim())
    }
    for (const value of Object.values(record)) categoriesIn(value, found)
  }
  return found
}

// Vitest runs with the package root as cwd, as in keysExist.test.ts.
const FIXTURE = join(process.cwd(), 'scripts', 'shot-fixtures', 'respond.json')

/**
 * The keys the employee screens are built against, including the ones deliberately
 * reused rather than duplicated. Reuse is what makes them worth listing: nothing in
 * `dashboard` or `common` hints that an employee screen depends on it.
 */
const CONTRACT = [
  // Home — the greeting, the one task, and the quiet state.
  'employee.greetingMorning',
  'employee.greetingAfternoon',
  'employee.greetingEvening',
  'employee.homeDescription',
  'employee.homeDescriptionNothingDue',
  'employee.taskQuestions',
  'employee.taskAbout',
  'employee.taskCloses',
  'employee.taskMinutes',
  'employee.taskClosesInDays',
  'employee.taskClosesInOneDay',
  'employee.taskClosesToday',
  'employee.startAnswering',
  'employee.emptyBodyInDepartment',
  'dashboard.noPendingSurveys',
  'dashboard.noPendingSurveysDescription',
  // What came of the last one.
  'employee.cameOfItHeading',
  'employee.cameOfItClosedTitle',
  'employee.cameOfItClosedBody',
  'employee.cameOfItProtectedOne',
  'employee.cameOfItProtectedMany',
  'employee.cameOfItPlansTitle',
  'employee.cameOfItPlansTitleOne',
  'employee.cameOfItPlansBody',
  'employee.cameOfItPlansNone',
  'employee.cameOfItOpenTitle',
  'employee.cameOfItOpenBody',
  'employee.cameOfItOpenMarker',
  'employee.cameOfItFooter',
  'employee.cameOfItNoneTitle',
  'employee.cameOfItNoneBody',
  // My surveys.
  'employee.mySurveysDescription',
  'employee.mySurveysClosedHeading',
  'employee.mySurveysFootnote',
  'employee.mySurveysEmptyTitle',
  'employee.mySurveysEmptyBody',
  'employee.notRecordedChip',
  'employee.notForYouChip',
  'employee.daysLeftChip',
  'employee.oneDayLeftChip',
  'employee.surveyMeta',
  'employee.surveyMetaOneQuestion',
  'employee.closedMeta',
  'employee.notInAudienceMeta',
  'employee.seeWhatCameOfIt',
  'dashboard.respondNow',
  // Notifications.
  'notifications.emptyTitle',
  'notifications.emptyBody',
  // Answering.
  'surveyRespond.dimensionUnknown',
  'surveyRespond.dimensionNone',
  'surveyRespond.dimensionRange',
  'surveyRespond.dimensionPosition',
  'surveyRespond.promiseTitle',
  'surveyRespond.anonymousBody',
  'surveyRespond.anonymousChip',
  'surveyRespond.answeredOfTotal',
  'surveyRespond.saveAndFinishLater',
  'surveyRespond.submitResponse',
  'surveyRespond.freeTextNote',
  'surveyRespond.commentPlaceholder',
  'surveyRespond.openTextPlaceholder',
  // Submitted.
  'surveyRespond.thankYouTitle',
  'surveyRespond.submittedSummary',
  'surveyRespond.whatHappensNowTitle',
  'surveyRespond.happensPooledTitle',
  'surveyRespond.happensPooledBody',
  'surveyRespond.happensClosesTitle',
  'surveyRespond.happensClosesBody',
  'surveyRespond.happensResultsTitle',
  'surveyRespond.happensResultsBody',
  'surveyRespond.noCopyNote',
  'surveyRespond.backToHome',
  // Sign in.
  'auth.signInDetail',
  'auth.passwordHelp',
  'auth.signInAssurance',
]

describe('employee copy', () => {
  it('names no department and counts no answers in the protected clause', () => {
    // The clause may say how many are needed — `{floor}` is the rule, and the rule
    // is public. It may not say who, or how many that group actually gave.
    const forbidden = ['department', 'departments', 'survey', 'responses', 'answers']

    for (const locale of LOCALES) {
      for (const key of ['employee.cameOfItProtectedOne', 'employee.cameOfItProtectedMany']) {
        const value = read(locale, key)
        expect(value, `${locale} is missing ${key}`).toBeTruthy()
        const names = placeholders(value ?? '')
        expect(names, `${key} must state the floor`).toContain('floor')
        expect(
          names.filter((name) => forbidden.includes(name)),
          `${locale} ${key} would identify the protected group`,
        ).toEqual([])
      }
    }
  })

  it('still carries those placeholders where naming the group is safe', () => {
    // Vacuity control for the check above: if `placeholders` returned nothing, the
    // forbidden-name filter would pass on every string in the file. The row this
    // clause hangs off does report both figures, company-wide, where they identify
    // nobody.
    for (const locale of LOCALES) {
      expect(placeholders(read(locale, 'employee.cameOfItClosedBody') ?? '')).toEqual([
        'departments',
        'responses',
      ])
    }
  })

  it('gives every category the respond fixture carries a section heading', () => {
    const categories = [...categoriesIn(JSON.parse(readFileSync(FIXTURE, 'utf8')))].sort()

    // Vacuity control: a fixture that stopped carrying categories, or a walker that
    // stopped finding them, would otherwise make the sweep below pass on nothing.
    expect(categories).toEqual(['enps', 'open', 'priorities', 'psychological_safety', 'workload'])

    const missing: string[] = []
    for (const locale of LOCALES) {
      for (const category of categories) {
        const heading = read(locale, `surveyRespond.dimensions.${category}`)
        if (heading === null || heading.trim() === '') missing.push(`${locale}: ${category}`)
      }
    }

    expect(
      missing,
      'A category with no heading is printed in the survey’s own words instead, and ' +
        'these are the product’s own English slugs — `psychological_safety` would sit ' +
        'over a Spanish survey. Add it under surveyRespond.dimensions in both catalogues.',
    ).toEqual([])
  })

  /**
   * The sweep above can only ever see the five categories the fixture carries, and
   * all five are in the catalogue — so on its own it passes whatever the headings
   * actually say. This is the part that can fail on a bad *value*.
   *
   * Two sections of one survey must never read the same words. The respondent then
   * cannot tell whether the form changed subject or the page broke, and the heading's
   * whole job is to say what is being asked. `SurveyRespondForm` now answers that for
   * categories the catalogue has never heard of — it prints the author's own word —
   * but a catalogue that gave two entries the same wording, or gave one of them the
   * generic "more questions", would put the collapse straight back for the values the
   * product itself ships. Nothing else in this directory looks at what a value says:
   * `catalogues.test.ts` compares the two locales to each other, and two locales agree
   * perfectly when both are wrong in the same way.
   */
  it('names each shipped dimension distinctly, and none of them generically', () => {
    // The one deliberate collision: `safety` is the same construct as
    // `psychological_safety`, stored two ways, so it must carry the same words. Any
    // other pair sharing wording is two constructs the respondent cannot tell apart.
    const ALIASES = [['psychological_safety', 'safety']]

    for (const locale of LOCALES) {
      const entries = Object.entries(dimensions(locale))

      // Vacuity control: an emptied or renamed subtree would make both sweeps below
      // pass on nothing at all.
      expect(entries.length, `${locale} has no dimension headings to check`).toBeGreaterThan(5)

      const generic = [
        read(locale, 'surveyRespond.dimensionUnknown'),
        read(locale, 'surveyRespond.dimensionNone'),
      ]
      expect(
        entries.filter(([, heading]) => generic.includes(heading)).map(([key]) => key),
        `${locale}: a dimension headed with the generic is indistinguishable from an ` +
          'uncatalogued one, which is the collapse this heading was fixed for.',
      ).toEqual([])

      const byHeading = new Map<string, string[]>()
      for (const [key, heading] of entries) {
        byHeading.set(heading, [...(byHeading.get(heading) ?? []), key])
      }
      const shared = [...byHeading.values()].filter((keys) => keys.length > 1)
      expect(
        shared,
        `${locale}: a survey carrying both of these would print one heading twice.`,
      ).toEqual(ALIASES)
    }
  })

  it('holds every key the employee screens are built against, in both languages', () => {
    const missing: string[] = []
    for (const locale of LOCALES) {
      for (const key of CONTRACT) {
        const value = read(locale, key)
        if (value === null || value.trim() === '') missing.push(`${locale}: ${key}`)
      }
    }
    expect(
      missing,
      'These keys were published to the agents building the employee screens. ' +
        'Removing or renaming one breaks a page that has no other source for that string.',
    ).toEqual([])
  })

  it('offers no password reset, because the product has no endpoint for one', () => {
    // The design's sign-in screen shows this as static copy rather than a link:
    // there is no reset route to send anyone to, so a link would be a dead end
    // dressed as help. Keeping the shape of the string under test keeps the reason
    // attached to it.
    for (const locale of LOCALES) {
      const help = read(locale, 'auth.passwordHelp') ?? ''
      expect(help).not.toMatch(/https?:|\/reset|<a[\s>]/i)
      expect(help.length).toBeGreaterThan(20)
    }
  })
})
