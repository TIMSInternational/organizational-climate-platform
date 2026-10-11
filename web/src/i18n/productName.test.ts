import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every outbound email names the product, and it must be the product's name.
 *
 * `EmailBranding.ProductName` said `Organizational Climate Platform` — a name this product
 * uses nowhere else — while the app title, the brand assets and `noHardcodedStrings.test.ts`
 * all said `OCC — Organizational Climate Check`. Its own doc comment claimed the two matched.
 * Nothing checked, so every invitation and every notification footer went out under a name
 * the client had never seen, for as long as the constant existed.
 *
 * This is that check. It reads the C# rather than restating the string, because a second
 * copy of a literal is the defect it is guarding against.
 */
const CS = join(
  process.cwd(),
  '..',
  'src',
  'ClimateProject.Application',
  'Email',
  'EmailBranding.cs',
)

/** The ALLOWED literal in the hardcoded-strings guard, which is the product's own name. */
const PRODUCT_NAME = 'OCC — Organizational Climate Check'

describe('the product name in outbound email', () => {
  it('is the name the app and the i18n guard use', () => {
    const source = readFileSync(CS, 'utf8')
    const match = source.match(/public const string ProductName\s*=\s*"([^"]*)"/)

    expect(match, 'EmailBranding.ProductName not found — has it been renamed?').not.toBeNull()
    expect(match![1]).toBe(PRODUCT_NAME)
  })

  it('is a literal the hardcoded-strings guard allows, so the two cannot drift apart', () => {
    const guard = readFileSync(join(process.cwd(), 'src', 'i18n', 'noHardcodedStrings.test.ts'), 'utf8')
    expect(guard).toContain(`'${PRODUCT_NAME}'`)
  })
})
