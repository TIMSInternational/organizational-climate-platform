import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `public/maintenance.html` is the page that stands in for the product while the product is
 * down (`docs/runbooks/cutover.md` C8, `web/docs/maintenance.md`). Vite copies `public/` into
 * `dist/` untouched, so what is asserted here about the source file is what ships.
 *
 * The guarantees are the ones that make it usable in an outage: it needs no second request
 * to render, it says the same thing the in-app 503 screen says, in both languages, Spanish
 * first, and it does not bake in a clock.
 */
const html = readFileSync(resolve(__dirname, '../../public/maintenance.html'), 'utf8')
/** What a reader sees: the file minus the maintainer comment, which may name the very things the page must not contain. */
const visible = html.replace(/<!--[\s\S]*?-->/g, '')
const en = JSON.parse(readFileSync(resolve(__dirname, '../i18n/en.json'), 'utf8')) as { auth: Record<string, string> }
const es = JSON.parse(readFileSync(resolve(__dirname, '../i18n/es.json'), 'utf8')) as { auth: Record<string, string> }

describe('public/maintenance.html', () => {
  it('needs nothing but itself: no script, no stylesheet, no font, no image request', () => {
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet/i)
    expect(html).not.toMatch(/@import|@font-face|url\(/i)
    expect(html).not.toMatch(/<img|<iframe|<object|<embed/i)
    expect(html).not.toMatch(/https:\/\//)
    // The only `http://` allowed is the SVG namespace inside the inlined data-URI favicon.
    expect(html.match(/http:\/\//g)?.length ?? 0).toBe((html.match(/http:\/\/www\.w3\.org\/2000\/svg/g) ?? []).length)
  })

  it('carries the in-app maintenance copy verbatim, Spanish first', () => {
    expect(html).toContain(es.auth.maintenanceTitle)
    expect(html).toContain(es.auth.maintenanceDetail)
    expect(html).toContain(en.auth.maintenanceTitle)
    expect(html).toContain(en.auth.maintenanceDetail)
    expect(html.indexOf(es.auth.maintenanceTitle)).toBeLessThan(html.indexOf(en.auth.maintenanceTitle))
    expect(html).toMatch(/<html lang="es">/)
    expect(html).toMatch(/<section lang="en">/)
  })

  it('renders in both colour schemes from literals and bakes in no clock', () => {
    expect(html).toMatch(/@media \(prefers-color-scheme: dark\)/)
    expect(html).toContain('#f8f7fb') // storefront ground, light
    expect(html).toContain('#120b2b') // storefront ground, dark
    expect(visible).not.toMatch(/\b20\d\d-\d\d-\d\d\b|\d{1,2}:\d\d\s?(am|pm|utc)\b|\bETA\b/i)
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow">/)
  })
})
