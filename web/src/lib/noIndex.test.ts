import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyNoIndex, NO_INDEX_CONTENT } from './noIndex'

function robotsTags(): HTMLMetaElement[] {
  return [...document.querySelectorAll<HTMLMetaElement>('meta[name="robots"]')]
}

describe('applyNoIndex', () => {
  afterEach(() => {
    for (const tag of robotsTags()) tag.remove()
  })

  it('adds a robots tag asking crawlers not to index or follow', () => {
    applyNoIndex()

    const [tag] = robotsTags()
    expect(tag).toBeTruthy()
    expect(tag.getAttribute('content')).toBe(NO_INDEX_CONTENT)
    expect(NO_INDEX_CONTENT).toContain('noindex')
    expect(NO_INDEX_CONTENT).toContain('nofollow')
  })

  /**
   * A router transition does not reload the document, so a tag left behind after the
   * shared report unmounts would `noindex` every page rendered next in that tab — and
   * the only party that would ever notice is a crawler.
   */
  it('removes the tag it added when the page unmounts', () => {
    const undo = applyNoIndex()
    expect(robotsTags()).toHaveLength(1)

    undo()

    expect(robotsTags()).toHaveLength(0)
  })

  it('restores a robots tag that was already there rather than deleting it', () => {
    const existing = document.createElement('meta')
    existing.setAttribute('name', 'robots')
    existing.setAttribute('content', 'index, follow')
    document.head.appendChild(existing)

    const undo = applyNoIndex()
    expect(existing.getAttribute('content')).toBe(NO_INDEX_CONTENT)

    undo()

    expect(robotsTags()).toHaveLength(1)
    expect(existing.getAttribute('content')).toBe('index, follow')
  })

  it('leaves exactly one robots tag behind when applied twice over', () => {
    const outer = applyNoIndex()
    const inner = applyNoIndex()

    expect(robotsTags()).toHaveLength(1)

    inner()
    outer()

    expect(robotsTags()).toHaveLength(0)
  })
})

/**
 * The half of `noindex` that does not depend on a crawler running JavaScript.
 *
 * `applyNoIndex` is the meta tag, and a meta tag is only read by a fetcher that renders
 * the page. `web/vercel.json` is where this product sets response headers on the web
 * origin — #367 put HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`
 * and `Permissions-Policy` there after measuring the live response from
 * climate.timsint.com — so it is where the header half belongs, and it was missing.
 *
 * Both directions are asserted, because a rule that covers nothing and a rule that
 * covers the entire product are equally green if you only check one. Deindexing every
 * page of the product is a *different* decision, about the marketing surface, and a
 * `source` that widened to `/(.*)` would make it silently.
 */
describe('the X-Robots-Tag half, in web/vercel.json', () => {
  interface HeaderRule {
    source: string
    headers: { key: string; value: string }[]
  }

  // `process.cwd()` is `web/` under vitest, the same anchor `test/repoHygiene.test.ts`
  // uses to sweep the repository from this suite.
  const config = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')) as {
    headers: HeaderRule[]
  }

  function headerFor(rule: HeaderRule | undefined, key: string): string | undefined {
    return rule?.headers.find((header) => header.key.toLowerCase() === key)?.value
  }

  const sharedReports = config.headers.find((rule) => rule.source.startsWith('/shared/reports'))

  it('asks crawlers not to index a shared report before any JavaScript runs', () => {
    expect(headerFor(sharedReports, 'x-robots-tag')).toBe(NO_INDEX_CONTENT)
  })

  /**
   * And the `source` has to match a real token URL. A pattern is unverifiable by
   * inspection: `/shared/reports` without the trailing group matches the collection path
   * and no token under it, which is every URL that is actually shared.
   */
  it('covers the route the tokens are handed out under', () => {
    const pattern = new RegExp(`^${sharedReports?.source ?? '(?!)'}$`)

    expect(pattern.test('/shared/reports/sh4r3d-t0k3n')).toBe(true)
    expect(pattern.test('/dashboard')).toBe(false)
  })

  /**
   * The other direction. `noIndex.ts` says in as many words that deindexing the whole
   * product is not a decision a report page gets to make, and the site-wide block is
   * where that would happen by accident.
   */
  it('does not deindex the rest of the product', () => {
    const siteWide = config.headers.find((rule) => rule.source === '/(.*)')

    expect(siteWide).toBeTruthy()
    expect(headerFor(siteWide, 'x-robots-tag')).toBeUndefined()
  })
})
