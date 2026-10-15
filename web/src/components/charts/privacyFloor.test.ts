import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ANONYMITY_FLOOR, SINGLE_SEGMENT_FLOOR } from './suppression'
import { MINIMUM_RESPONDENTS } from '../../features/microclimates/microclimatePrivacy'

/**
 * The privacy floor is one number, and four constants in two languages say it.
 *
 * Ruled 2026-10-13: the floor is **3** platform-wide, down from 5. The lane that moved it
 * changed every constant and every interpolated string correctly — and nothing then pinned
 * the result. Every fixture derives its counts from the constant (`MinimumRespondents - 1`
 * and friends), which is right, because a test naming the number would have to be edited on
 * every ruling. But it means the suites test the BOUNDARY and not the VALUE: set the floor
 * back to 5, or to 10, and all 1860 .NET tests and all 5630 web tests still pass.
 *
 * Worse, the two stacks hold the number independently. `ANONYMITY_FLOOR` is what the screens
 * announce and what the client suppresses by; `MinimumGroupSize` is what the server actually
 * enforces. Nothing compared them, so they could disagree — and a UI promising "fewer than 3"
 * over an API withholding below 5 is a privacy claim the product does not keep.
 *
 * So this reads the C# and compares, the same device as `i18n/productName.test.ts`, which
 * exists because `EmailBranding.ProductName` drifted from the app's name for exactly as long
 * as nothing checked. Reading the source beats restating the literal: a second copy of the
 * number is the defect being guarded against.
 *
 * If this fails, the floor moved. That is a decision, not a bug — change `FLOOR` here when the
 * record changes, and not before.
 */
const ROOT = join(process.cwd(), '..')

/** The ruled value. The one place a literal belongs. */
const FLOOR = 3

function csharpConst(relativePath: string, name: string): string {
  const source = readFileSync(join(ROOT, relativePath), 'utf8')
  const match = source.match(new RegExp(`public const int ${name}\\s*=\\s*([^;]+);`))
  expect(match, `${name} not found in ${relativePath} — has it been renamed?`).not.toBeNull()
  return match![1]!.trim()
}

describe('the privacy floor', () => {
  it('pins the single-dimension ruling in both stacks', () => {
    expect(SINGLE_SEGMENT_FLOOR).toBe(1)
    expect(csharpConst('src/ClimateProject.Application/Surveys/SurveyResultsPrivacy.cs', 'MinimumSingleSegmentRespondents'))
      .toBe(String(SINGLE_SEGMENT_FLOOR))
  })

  it('is the number the 2026-10-13 ruling published', () => {
    expect(ANONYMITY_FLOOR).toBe(FLOOR)
  })

  it('is the same number the server enforces', () => {
    // What the screens announce, against what the API actually withholds by.
    expect(csharpConst('src/ClimateProject.Application/Analytics/DemographicSnapshotPrivacy.cs', 'MinimumGroupSize'))
      .toBe(String(ANONYMITY_FLOOR))
  })

  it('is the same number a survey needs before it reports at all', () => {
    expect(csharpConst('src/ClimateProject.Application/Surveys/SurveyResultsPrivacy.cs', 'MinimumRespondents'))
      .toBe(String(ANONYMITY_FLOOR))
  })

  it('is the same number a microclimate needs', () => {
    expect(MINIMUM_RESPONDENTS).toBe(ANONYMITY_FLOOR)
  })

  /**
   * These two are deliberately DERIVED on the server rather than restated, so they cannot
   * drift on their own. Asserting the derivation rather than the value is what keeps that
   * true: a future edit that spells the number here would pass a value check and still be
   * the beginning of the next drift.
   */
  it('is derived, not restated, by the segment and cohort floors', () => {
    expect(csharpConst('src/ClimateProject.Application/Surveys/SurveyResultsPrivacy.cs', 'MinimumSegmentRespondents'))
      .toBe('DemographicSnapshotPrivacy.MinimumGroupSize')
    expect(csharpConst('src/ClimateProject.Application/Surveys/SurveyResponsePrivacy.cs', 'MinimumCohortSize'))
      .toBe('DemographicSnapshotPrivacy.MinimumGroupSize')
  })
})
