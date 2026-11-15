import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_VARIABLES } from './crossOptions'

/**
 * The builder's limit is the server's limit. It reads the C# rather than restating the number:
 * a second copy of the constant is how the builder came to offer six variables to an endpoint
 * that refuses more than three.
 */
const CS = join(process.cwd(), '..', 'src', 'ClimateProject.Application', 'Surveys', 'SurveyResultsFilter.cs')

describe('the cross builder variable limit', () => {
  it('is the number the results endpoint accepts', () => {
    const match = /public const int MaxSelectors = (\d+);/.exec(readFileSync(CS, 'utf8'))
    expect(match, 'SurveyResultsFilter.MaxSelectors not found').not.toBeNull()
    expect(MAX_VARIABLES).toBe(Number(match![1]))
  })
})
