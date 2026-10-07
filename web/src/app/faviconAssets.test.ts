import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The browser tab's icon, and the rule that an SVG which does not PARSE shows nothing.
 *
 * ## Why this file exists
 *
 * `public/favicon.svg` shipped onto `feat/occ-brand` with `--` used as an em-dash inside its
 * own XML comment. XML forbids a double hyphen within a comment, so the file was not
 * well-formed; a browser parses `image/svg+xml` strictly, refuses it, and draws its default
 * icon instead. **The tab silently lost the logo, and twelve green checks said nothing** —
 * nothing in this repository had ever opened these files as XML.
 *
 * The three `brand/*.svg` were valid throughout, which is exactly why it was hard to see:
 * the mark rendered perfectly in the rail and in the respond strip, and only the tab was
 * blank. A guard that watches the rendered app would not have caught it either.
 *
 * ## What these assertions are, and what they are not
 *
 * They are **not** a well-formedness proof. Node ships no XML parser, happy-dom's
 * `DOMParser` accepts `<!-- a -- b -->` without a `parsererror` (measured — a guard built on
 * it is vacuous), and this repository does not add a dependency without a reason that
 * survives procurement (`CLAUDE.md`). So this checks the two ways a *human editing prose into
 * an SVG* actually breaks one: the comment rule that bit us, and a bare ampersand. Both are
 * cheap, deterministic, and have teeth — each was proved by mutation against the real files.
 *
 * A malformed SVG that these two miss is still possible. The honest statement is that the
 * failure mode which reached `main`'s branch cannot reach it again unremarked.
 */
const WEB = resolve(__dirname, '../..')

/** Every SVG this product serves from `public/`. Vite copies `public/` into `dist/` untouched. */
const SHIPPED_SVGS = ['favicon.svg', 'brand/occ-mark.svg', 'brand/occ-logo.svg', 'brand/occ-lockup.svg']

/** The body of each `<!-- … -->`, non-greedy so it ends at the first `-->` exactly as a parser does. */
function commentBodies(svg: string): string[] {
  return [...svg.matchAll(/<!--([\s\S]*?)-->/g)].map((match) => match[1])
}

/** An `&` that does not open a named, decimal or hex character reference. */
const BARE_AMPERSAND = /&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/

describe('the SVGs this product serves', () => {
  it.each(SHIPPED_SVGS)('%s has no double hyphen inside a comment', (name) => {
    const svg = readFileSync(resolve(WEB, 'public', name), 'utf8')
    for (const body of commentBodies(svg)) {
      // The message names the file, because the failure is otherwise a blank tab with no clue.
      expect(body, `${name}: "--" is illegal inside an XML comment; use an em dash`).not.toContain('--')
    }
  })

  it.each(SHIPPED_SVGS)('%s escapes every ampersand', (name) => {
    const svg = readFileSync(resolve(WEB, 'public', name), 'utf8')
    expect(svg).not.toMatch(BARE_AMPERSAND)
  })

  it('the guard bites: it rejects the exact shape that shipped, and accepts the fix', () => {
    const shipped = `<svg xmlns="http://www.w3.org/2000/svg"><!-- the limit -- six figures --><path/></svg>`
    const fixed = `<svg xmlns="http://www.w3.org/2000/svg"><!-- the limit — six figures --><path/></svg>`
    expect(commentBodies(shipped).some((body) => body.includes('--'))).toBe(true)
    expect(commentBodies(fixed).some((body) => body.includes('--'))).toBe(false)
    expect('<svg>a &amp; b</svg>').not.toMatch(BARE_AMPERSAND)
    expect('<svg>a & b</svg>').toMatch(BARE_AMPERSAND)
  })
})

describe('index.html wires the tab icon', () => {
  const html = readFileSync(resolve(WEB, 'index.html'), 'utf8')

  it('declares an SVG icon and an apple-touch-icon, and both files exist', () => {
    const hrefs = [...html.matchAll(/<link[^>]+rel="(?:icon|apple-touch-icon)"[^>]*>/g)].map((link) => {
      const href = /href="([^"]+)"/.exec(link[0])
      return href?.[1] ?? ''
    })
    expect(hrefs).toContain('/favicon.svg')
    expect(hrefs).toContain('/apple-touch-icon.png')
    // A `<link>` pointing at a file Vite will not copy is a 404 and a blank tab.
    for (const href of hrefs) {
      expect(existsSync(resolve(WEB, 'public', href.replace(/^\//, ''))), `${href} is missing from public/`).toBe(true)
    }
  })

  it('the favicon is the brand mark, in the brand red, and square', () => {
    const svg = readFileSync(resolve(WEB, 'public/favicon.svg'), 'utf8')
    // #FB1724 is measured in `docs/`/memory from the artwork TIMS supplied; a favicon that
    // drifts off it is the one place nobody would notice by looking at the app.
    expect(svg).toContain('#FB1724')
    const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1]?.split(/\s+/).map(Number)
    expect(viewBox).toHaveLength(4)
    expect(viewBox?.[2]).toBe(viewBox?.[3])
  })
})
