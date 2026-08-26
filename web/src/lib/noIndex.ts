/**
 * The `content` this app asks a crawler for.
 *
 * `nofollow` as well as `noindex`, and it is not belt-and-braces: a shared report may
 * one day carry a link, and a crawler that indexes nothing but still walks outward from
 * a token URL has told a third party the token exists.
 */
export const NO_INDEX_CONTENT = 'noindex, nofollow'

const SELECTOR = 'meta[name="robots"]'

/**
 * Asks crawlers not to index the current page, and returns the undo.
 *
 * ## Why this is a function and not a line in `index.html`
 *
 * `web/index.html` is ONE document served for every route — this is a single-page app
 * with an SPA fallback, so `/login`, `/dashboard` and `/shared/reports/{token}` are all
 * the same HTML. A `<meta name="robots" content="noindex">` there would deindex the
 * whole product, which is a decision about the marketing surface and not one a report
 * page gets to make on its own.
 *
 * So the tag is added by the page that needs it and removed when that page unmounts.
 * Google renders JavaScript before deciding whether to index, and it reads a robots
 * meta tag that was injected by script exactly as it reads one that was in the served
 * HTML — which is what makes this work at all.
 *
 * ## The other half, which is not in this file
 *
 * This is the *weaker* half of the defence. The strong half is an `X-Robots-Tag`
 * response header, because a crawler obeys it without executing any JavaScript at all —
 * and unlike a meta tag it cannot be missed by a fetcher that never renders.
 *
 * That half is `web/vercel.json`, which is where this product sets response headers on
 * the web origin (#367 added HSTS, `X-Frame-Options`, `X-Content-Type-Options`,
 * `Referrer-Policy` and `Permissions-Policy` there after measuring the live response
 * from climate.timsint.com). `/shared/reports/(.*)` carries `X-Robots-Tag: noindex,
 * nofollow`, scoped to that path rather than applied site-wide for the same reason this
 * function exists rather than a line in `index.html`: deindexing the whole product is a
 * decision about the marketing surface, not one a report page gets to make.
 * `noIndex.test.ts` asserts both halves say the same thing, since two spellings of one
 * rule is how they come to disagree.
 *
 * ## Why the undo matters
 *
 * A router transition does not reload the document. Without the cleanup, one visit to a
 * shared report would leave `noindex` on the `<head>` for every page rendered afterwards
 * in that tab — which nobody would notice, because the person who sees it is a crawler
 * and the tab belongs to a human.
 *
 * @returns a cleanup that restores exactly what was there before: the previous `content`
 * if a robots tag already existed, or no tag at all if this call created one.
 */
export function applyNoIndex(): () => void {
  const existing = document.querySelector<HTMLMetaElement>(SELECTOR)

  if (existing) {
    const previous = existing.getAttribute('content')
    existing.setAttribute('content', NO_INDEX_CONTENT)
    return () => {
      // Restore rather than remove: this tag was not ours to delete.
      if (previous === null) existing.removeAttribute('content')
      else existing.setAttribute('content', previous)
    }
  }

  const meta = document.createElement('meta')
  meta.setAttribute('name', 'robots')
  meta.setAttribute('content', NO_INDEX_CONTENT)
  document.head.appendChild(meta)
  return () => {
    meta.remove()
  }
}
