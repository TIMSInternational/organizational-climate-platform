import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  HEX_COLOUR,
  LOGO_DATA_URI,
  LOGO_EXTENSIONS,
  LOGO_MAX_LENGTH,
  LOGO_PATH,
  logoValid,
} from './derive'

/**
 * The branding rules exist twice — once in `derive.ts` so the form can refuse before it
 * sends, once in `BrandingValidation.cs` because the API cannot trust a form — and this
 * reads the C# to prove the two agree.
 *
 * Same technique and same reason as `i18n/productName.test.ts`: a second copy of a rule is
 * the defect being guarded against, so the guard quotes the original rather than restating
 * it. The symptom of drift here is specific and bad at diagnosing itself — the form accepts
 * a value, the Save button enables, the request 400s, and what the administrator sees is a
 * button that does nothing.
 */
const CS = join(
  process.cwd(),
  '..',
  'src',
  'ClimateProject.Application',
  'OrgStructure',
  'BrandingValidation.cs',
)

function csharp(): string {
  return readFileSync(CS, 'utf8')
}

/** The pattern `new Regex(@"...")` assigned to a named field. */
function pattern(source: string, field: string): string | null {
  const match = source.match(new RegExp(`${field}\\s*=\\s*new\\(@"([^"]*)"`))
  return match ? match[1] : null
}

/**
 * A JS regex literal escapes `/` as `\/`, because an unescaped slash would end the literal.
 * `.NET` has no such notation and writes it bare, so `^\/brand` and `^/brand` are the same
 * pattern written in two languages.
 *
 * This is the ONLY difference this file forgives, and it is safe to forgive because `/` is
 * not a regex metacharacter: escaped or not it matches exactly one slash. Every other
 * difference — a character class, a quantifier, an anchor — is a real divergence and fails.
 */
function comparable(jsSource: string): string {
  return jsSource.replaceAll('\\/', '/')
}

describe('the branding rules the form and the API each enforce', () => {
  it('agree on the hex colour pattern', () => {
    const match = csharp().match(/public const string HexColourPattern\s*=\s*"([^"]*)"/)

    expect(match, 'HexColourPattern not found — renamed?').not.toBeNull()
    expect(match![1]).toBe(HEX_COLOUR.source)
  })

  it('agree on the logo length cap, which is the database column width', () => {
    const match = csharp().match(/public const int LogoUrlMaxLength\s*=\s*(\d+)/)

    expect(match, 'LogoUrlMaxLength not found — renamed?').not.toBeNull()
    expect(Number(match![1])).toBe(LOGO_MAX_LENGTH)
  })

  it('agree on the root-relative path pattern', () => {
    const cs = pattern(csharp(), 'RelativePath')

    expect(cs, 'RelativePath regex not found — renamed?').not.toBeNull()
    expect(cs).toBe(comparable(LOGO_PATH.source))
  })

  it('agree on the data: image pattern', () => {
    const cs = pattern(csharp(), 'DataImage')

    expect(cs, 'DataImage regex not found — renamed?').not.toBeNull()
    expect(cs).toBe(comparable(LOGO_DATA_URI.source))
  })

  it('agree on the accepted image extensions, in the same order', () => {
    const match = csharp().match(/ImageExtensions\s*=\s*\[([^\]]*)\]/)

    expect(match, 'ImageExtensions not found — renamed?').not.toBeNull()
    const cs = [...match![1].matchAll(/"([^"]*)"/g)].map((m) => m[1])
    expect(cs).toEqual([...LOGO_EXTENSIONS])
  })

  /**
   * The vacuity control the contrast guards all carry, for the same reason: every assertion
   * above compares against a value parsed out of another file, so a rename would otherwise
   * make them all pass over `null`. If this file can be read and the patterns found, the
   * comparisons above mean something.
   */
  it('actually read the C# — the control for every assertion above', () => {
    const source = csharp()

    expect(source.length).toBeGreaterThan(500)
    expect(source).toContain('class BrandingValidation')
    expect(pattern(source, 'RelativePath')).not.toBeNull()
    expect(pattern(source, 'DataImage')).not.toBeNull()
  })
})

describe('logoValid', () => {
  it('accepts a same-origin image path, with or without a cache-busting query', () => {
    expect(logoValid('/brand/esph-logo.svg')).toBe(true)
    expect(logoValid('/brand/acme.png')).toBe(true)
    expect(logoValid('/brand/logo.svg?v=2')).toBe(true)
    expect(logoValid('/brand/UPPER.PNG')).toBe(true)
  })

  it('accepts a blank, because emptying the field is how a logo is removed', () => {
    expect(logoValid('')).toBe(true)
    expect(logoValid('   ')).toBe(true)
  })

  it('accepts a data: image URI', () => {
    expect(logoValid('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
  })

  it('refuses an externally hosted logo', () => {
    // Not a style rule: `vercel.json` sets `img-src 'self' data:`, and an external logo
    // reports every respondent's address to whoever hosts the file.
    expect(logoValid('https://cdn.example.com/logo.png')).toBe(false)
    expect(logoValid('http://example.com/logo.png')).toBe(false)
    expect(logoValid('//example.com/logo.png')).toBe(false)
  })

  it('refuses traversal, backslashes, whitespace and a non-image path', () => {
    expect(logoValid('/brand/../../etc/passwd')).toBe(false)
    expect(logoValid('\\brand\\logo.svg')).toBe(false)
    expect(logoValid('/brand/logo with space.svg')).toBe(false)
    expect(logoValid('/brand/notes.txt')).toBe(false)
    expect(logoValid('/brand/logo')).toBe(false)
    expect(logoValid('brand/logo.svg')).toBe(false)
  })

  it('refuses a data: URI that is not an image', () => {
    expect(logoValid('data:text/html;base64,PHNjcmlwdD4=')).toBe(false)
  })

  it('refuses a value longer than the column', () => {
    expect(logoValid(`/brand/${'a'.repeat(LOGO_MAX_LENGTH)}.svg`)).toBe(false)
  })
})
