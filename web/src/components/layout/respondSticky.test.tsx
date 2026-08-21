import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { compile } from 'tailwindcss'
import SurveyRespondPage from '../../features/surveys/pages/SurveyRespondPage'
import PublicSurveyRespondPage from '../../features/surveys/pages/PublicSurveyRespondPage'
import MicroclimateRespondPage from '../../features/microclimates/pages/MicroclimateRespondPage'
import { TranslationProvider } from '../../i18n'
import { LOCALE_STORAGE_KEY } from '../../i18n/locale'
import type { SurveyRespondView } from '../../features/surveys/api/surveyResponses'
import type { PublicMicroclimateDetail } from '../../features/microclimates/api/microclimates'

/**
 * The respond instrument must actually stick.
 *
 * ## The defect this exists to stop coming back
 *
 * All three respond routes put the anonymity promise and the progress reading in a
 * `lg:sticky lg:top-gutter` panel beside the questions. `RespondShell`'s `<main>`
 * carried `overflow-x-auto`, copied from `AdminLayout`'s panel as a wide-content
 * guard. CSS promotes the used value of `overflow-y` to `auto` when the other axis
 * is not `visible`, so `<main>` became the nearest scrollport for every
 * `position: sticky` inside it — and `RespondShell`'s `<main>` never scrolls (it
 * grows and the DOCUMENT scrolls), so the panel was pinned to a box that never
 * moved. Measured in Chromium at 1440x900 on `/survey/s1`: `main.scrollHeight ===
 * main.clientHeight === 1273`, and at the page's maximum scroll the panel sat at
 * `getBoundingClientRect().top = -238` where `top-gutter` asks for 12. The
 * anonymity promise left the screen after the first question and never came back.
 *
 * ## What the employee redesign moved, and what it did not
 *
 * On the two SURVEY routes there is no right-hand panel any more. The approved
 * design cuts the rail — its position cost the form a third of the width, left a
 * column of white space below the fold, and, because it collapsed at `lg`, drew
 * nothing at all on a phone, which is where this page is mostly answered. Its
 * contents were redistributed rather than dropped, and they went to two different
 * places for two different reasons:
 *
 * - the anonymity promise became the first full-width block of the page. It is in
 *   view because it is FIRST, not because it sticks, so it is no longer this file's
 *   business; `features/surveys/components/SurveyRespondForm.test.tsx` ("puts the
 *   anonymity promise above the questions, not beside them") is what holds it there.
 * - the answered count and the two actions ride `[data-slot="respond-submit-bar"]`,
 *   a bar stuck to the BOTTOM of the viewport — the one thing on the page that still
 *   has to follow a respondent down a twelve-question form.
 *
 * So the property is unchanged and only the element and the direction moved: the
 * box that must stay in view has to actually stick, and no ancestor's overflow may
 * swallow it.
 *
 * ## The third route has nothing to stick at all, and what is asserted there instead
 *
 * `/microclimates/:id/respond` kept the old rail longer than either survey route did,
 * and it kept it BECAUSE OF THIS FILE: the page's own comments cited the case below as
 * the reason for its `lg:grid-cols-3` layout and `lg:sticky lg:top-gutter` panel. That
 * is a test dictating a design. The approved design's `pulse` screen draws one narrow
 * centred column — eyebrow, one large question, the scale, an optional box, a single
 * Send, and the anonymity line as a footnote — with no rail and no bottom bar, and the
 * page now matches it.
 *
 * The case was not deleted, because the route did not stop having a shape worth
 * pinning; it was re-pointed at the property that survives the rail:
 *
 * - **nothing on that page is sticky**, so the rail cannot come back by accident and
 *   a bar the design does not draw cannot be added without this going red. Not
 *   vacuous: `installStylesheet` compiles both sticky shapes, which is what the
 *   `loads the real stylesheet` case above proves.
 * - **no ancestor of the column would clip or capture it**, measured with the same
 *   `scrollportAncestors` walk as the two survey cases. On a non-sticky column the
 *   consequence is different — the box is not unpinned, it is CUT — but the cause is
 *   the identical `overflow` on an ancestor, and the walker is the identical one.
 * - **the Send action is reachable without a horizontal scroll**: the question card
 *   can shrink below its own min-content width (`min-w-0`), so a long option label
 *   cannot widen the card, the column and then the document, and push the button off
 *   the side of a phone.
 *
 * ## Why the assertions look the way they do
 *
 * The test that named this behaviour before asserted `panel.className` contained
 * `'sticky'`, which is true of a broken page and a working one alike — happy-dom
 * does no layout, so no test in this suite can measure where the box ends up.
 *
 * What happy-dom *does* do is resolve selectors and compute styles, so this
 * compiles the real `src/index.css` through the real Tailwind compiler (the
 * approach `styles/tableOverflow.test.ts` established), puts it in the document,
 * renders the real page, and asserts the two things that are computable:
 *
 * 1. the sticky box itself computes `position: sticky` with the offset it claims —
 *    `bottom: 0px` for the survey bar. The same reading run over every element of the
 *    microclimate page is what proves the pulse has no such box left;
 * 2. no ancestor of it computes an `overflow` that would make that ancestor the
 *    box's scrollport.
 *
 * (2) is the cause rather than the symptom, which is the only half of this a
 * layout-free DOM can hold. Adding `overflow-x-auto` back to `RespondShell`'s
 * `<main>` reddens it.
 *
 * The survey bar carries one assertion the old panel could not: it is re-read at a
 * 390px viewport. `sticky bottom-0` and `lg:sticky lg:bottom-0` are indistinguishable
 * at happy-dom's default 1024px, and the second is the exact defect the redesign was
 * for — an instrument that is not there on the screen the form is answered on.
 */

const WEB = process.cwd()
const SRC = join(WEB, 'src')
const NODE_MODULES = join(WEB, 'node_modules')

/** Resolves an `@import` the way Vite does. Same helper as `tableOverflow.test.ts`. */
async function loadStylesheet(id: string, basedir: string) {
  const candidates =
    id.startsWith('.') || id.startsWith('/')
      ? [resolve(basedir, id)]
      : [
          join(NODE_MODULES, id),
          join(NODE_MODULES, `${id}.css`),
          join(NODE_MODULES, id, 'index.css'),
        ]

  for (const path of candidates) {
    try {
      return { path, base: dirname(path), content: await readFile(path, 'utf8') }
    } catch {
      // Try the next candidate; a genuinely missing import throws below.
    }
  }
  throw new Error(`cannot resolve stylesheet "${id}" imported from ${basedir}`)
}

/** Unwraps `@layer name { ... }` in place. happy-dom drops layered rules entirely. */
function flattenLayers(css: string): string {
  let out = ''
  let index = 0

  for (;;) {
    const opener = /@layer\s+[^;{]*\{/g
    opener.lastIndex = index
    const hit = opener.exec(css)
    if (!hit) {
      out += css.slice(index)
      break
    }

    out += css.slice(index, hit.index)

    let depth = 1
    let cursor = opener.lastIndex
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth++
      else if (css[cursor] === '}') depth--
      cursor++
    }
    out += css.slice(opener.lastIndex, cursor - 1)
    index = cursor
  }

  return out.replace(/@layer[^;{]*;/g, '')
}

/**
 * The utilities this file needs compiled.
 *
 * `@source` scanning does not run through the `compile()` API, so the candidate list
 * is explicit. Three groups: what the survey bar is written in (`sticky bottom-0`),
 * the whole `overflow` family, and `min-w-0`.
 *
 * `lg:sticky lg:top-gutter` stays compiled even though no page writes it any more.
 * It is the shape the cut microclimate rail was written in, and it is exactly what
 * the "nothing on this page is sticky" sweep has to be able to SEE: a class that
 * does not compile computes nothing, so the sweep would find nothing and go green
 * against a rail that had come back. Same reasoning as the overflow family below.
 *
 * The overflow family is the NEGATIVE control, and it is a family rather than the one
 * class `RespondShell` actually regressed with. The ancestor sweep can only see a
 * property that computes to something, so a class that is not in this list is a guard
 * this file would let through: with only `overflow-x-auto` compiled, the same defect
 * rewritten as `overflow-hidden` on `<main>` computes nothing, the sweep finds
 * nothing, and the test goes green on a broken page.
 */
const CANDIDATES = [
  'lg:sticky',
  'lg:top-gutter',
  'sticky',
  'top-gutter',
  'bottom-0',
  'overflow-auto',
  'overflow-clip',
  'overflow-hidden',
  'overflow-scroll',
  'overflow-x-auto',
  'overflow-x-hidden',
  'overflow-y-auto',
  'overflow-y-hidden',
  'min-w-0',
]

let stylesheet: string

/**
 * Every used value of `overflow` that turns a box into a scroll container.
 *
 * `visible` is the only one that does not, and happy-dom reports an unset property
 * as the empty string rather than as its initial value — so "not one of these" is
 * the assertion, not "equal to visible".
 */
const SCROLLPORT_VALUES = ['auto', 'scroll', 'hidden', 'clip', 'overlay']

/**
 * Every way the guard can be written, read separately — because the DOM under this
 * test does not fold them into each other.
 *
 * MEASURED rather than assumed: happy-dom's computed style does NOT expand the
 * `overflow` shorthand onto the two axes. `<main class="overflow-hidden">` computes
 * `overflowX === ''`, so a sweep that read only the axes reported "no scrollport"
 * against the exact defect this file exists for, merely rewritten in the shorthand
 * — a green test on a broken page. The shorthand is therefore its own reading, and
 * it is split, because `overflow: hidden auto` is legal and sets the two axes to two
 * different things.
 */
function overflowTokens(computed: CSSStyleDeclaration): string[] {
  return [computed.overflow, computed.overflowX, computed.overflowY]
    .flatMap((value) => value.split(/\s+/))
    .filter((token) => token.length > 0)
}

/**
 * happy-dom's default viewport width, and the one every `lg:` assertion here reads
 * against — `lg` is 64rem/1024px, so this is exactly on the boundary.
 */
const DEFAULT_VIEWPORT_WIDTH = 1024

/** A phone. What the redesign cut the right-hand rail for. */
const PHONE_VIEWPORT_WIDTH = 390

/**
 * happy-dom evaluates media queries against its browser frame's viewport, which is
 * reachable only through `window.happyDOM` — not part of the DOM `Window` type, so
 * it is taken through a narrow structural cast rather than a blanket `any`.
 */
function setViewportWidth(width: number): void {
  const frame = window as unknown as {
    happyDOM: { setViewport(viewport: { width: number }): void }
  }
  frame.happyDOM.setViewport({ width })
}

/**
 * `element`'s own classes, re-resolved at whatever the viewport is NOW.
 *
 * MEASURED, and the reason this is not simply `getComputedStyle(element)`: happy-dom
 * caches an element's computed style and a viewport change does not invalidate it.
 * After `setViewport({ width: 390 })`, `matchMedia('(width >= 64rem)')` correctly
 * returns false while `getComputedStyle(theSameElement)` keeps handing back the `lg`
 * answer it computed at 1024 — so a second reading of the same node is an assertion
 * that cannot fail, which is worse than no assertion at all. A node created after the
 * change resolves correctly, so the phone reading is taken on a fresh probe wearing
 * the class attribute of the real rendered box. The classes are the thing under test;
 * the node they hang on is not.
 */
function stickinessAtCurrentViewport(element: Element): { position: string; bottom: string } {
  const probe = document.createElement('div')
  probe.setAttribute('class', element.getAttribute('class') ?? '')
  document.body.append(probe)
  try {
    const computed = getComputedStyle(probe)
    return { position: computed.position, bottom: computed.bottom }
  } finally {
    probe.remove()
  }
}

/** The sticky box's ancestors, nearest first, up to and including `<html>`. */
function ancestorsOf(element: Element): Element[] {
  const chain: Element[] = []
  let current = element.parentElement
  while (current) {
    chain.push(current)
    current = current.parentElement
  }
  return chain
}

function describeElement(element: Element): string {
  const className = element.getAttribute('class')
  return `<${element.tagName.toLowerCase()}${element.id ? ` id="${element.id}"` : ''}${
    className ? ` class="${className}"` : ''
  }>`
}

/**
 * Every element under `root` that computes `position: sticky`.
 *
 * The inverse reading of the two survey assertions, for the one route whose design
 * pins nothing: instead of naming a box and asking whether it sticks, it asks the
 * whole page whether anything does. Descriptions rather than nodes so a failure names
 * the offender.
 */
function stickyElements(root: Element): string[] {
  return [...root.querySelectorAll('*')]
    .filter((element) => getComputedStyle(element).position === 'sticky')
    .map(describeElement)
}

/** Ancestors that would capture a `position: sticky` descendant. */
function scrollportAncestors(element: Element): string[] {
  return ancestorsOf(element)
    .filter((ancestor) =>
      overflowTokens(getComputedStyle(ancestor)).some((token) =>
        SCROLLPORT_VALUES.includes(token),
      ),
    )
    .map(describeElement)
}

function surveyView(overrides: Partial<SurveyRespondView> = {}): SurveyRespondView {
  return {
    id: 's1',
    title: 'Clima laboral 2026',
    description: null,
    type: 'general_climate',
    language: 'both',
    resolvedLocale: 'es',
    fallbackFields: [],
    startDate: '2026-01-01T00:00:00Z',
    endDate: '2026-12-31T00:00:00Z',
    anonymous: true,
    allowPartialResponses: false,
    autoSave: true,
    randomizeQuestions: false,
    showProgress: true,
    timeLimitMinutes: null,
    questions: [
      {
        id: 'q1',
        text: '¿Qué tan satisfecho estás?',
        type: 'multiple_choice',
        options: [
          { order: 0, value: 'strongly_agree', label: 'Muy de acuerdo' },
          { order: 1, value: 'disagree', label: 'En desacuerdo' },
        ],
        scaleMin: null,
        scaleMax: null,
        scaleLabelMin: null,
        scaleLabelMax: null,
        required: false,
        commentRequired: false,
        commentPrompt: null,
        order: 0,
        category: null,
      },
    ],
    inProgress: null,
    ...overrides,
  }
}

/** The one question shape on this page whose row cannot be made to fit a phone. */
function rankingQuestion(): SurveyRespondView['questions'][number] {
  return {
    id: 'q-rank',
    text: 'Ordene estos temas según lo que más le ayudaría este trimestre.',
    type: 'ranking',
    options: [
      { order: 0, value: 'pay', label: 'Compensación' },
      { order: 1, value: 'growth', label: 'Desarrollo profesional' },
    ],
    scaleMin: null,
    scaleMax: null,
    scaleLabelMin: null,
    scaleLabelMax: null,
    required: false,
    commentRequired: false,
    commentPrompt: null,
    order: 0,
    category: null,
  }
}

function microclimate(): PublicMicroclimateDetail {
  return {
    id: 'm1',
    title: 'Pulso semanal',
    status: 'active',
    language: 'both',
    resolvedLocale: 'es',
    fallbackFields: [],
    questions: [
      {
        id: 'q1',
        text: '¿Qué tan satisfecho estás?',
        type: 'multiple_choice',
        required: true,
        order: 0,
        options: [
          { order: 0, value: 'strongly_agree', label: 'Muy de acuerdo' },
          { order: 1, value: 'disagree', label: 'En desacuerdo' },
        ],
      },
    ],
  }
}

/**
 * The stylesheet has to be in the SAME document the page renders into, so it goes
 * into `<head>` after RTL has taken over `<body>`.
 */
function installStylesheet(): void {
  document.head.innerHTML = `<style>${stylesheet}</style>`
}

function renderAt(path: string, pattern: string, element: React.ReactElement) {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={pattern} element={element} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

/**
 * The bar, reached THROUGH the control the respondent finishes from.
 *
 * `closest` rather than a bare `querySelector('[data-slot=…]')`: the slot is an
 * attribute anyone can put on anything, and what this file is claiming is that the
 * box which sticks is the INSTRUMENT — the reading and the actions that used to be
 * in the rail. Reaching it from the submit button proves the containment by
 * construction, so if the actions ever move back out of the bar this stops finding
 * it rather than measuring an empty div.
 */
async function findSubmitBar(): Promise<HTMLElement> {
  const submit = await screen.findByRole('button', { name: 'Enviar mis respuestas' })
  const bar = submit.closest('[data-slot="respond-submit-bar"]')
  expect(bar, 'the submit action rides the sticky bar').toBeTruthy()
  return bar as HTMLElement
}

describe('the respond instrument sticks', () => {
  beforeAll(async () => {
    const entry = await readFile(join(SRC, 'index.css'), 'utf8')
    const compiled = await compile(entry, {
      base: SRC,
      loadStylesheet,
      async loadModule() {
        throw new Error('index.css is not expected to load a JS plugin')
      },
    })
    stylesheet = flattenLayers(compiled.build(CANDIDATES))
  }, 60_000)

  beforeEach(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    // No `globals: true` in vite.config.ts, so RTL's auto-cleanup never registers.
    cleanup()
    document.head.innerHTML = ''
    // `cleanup()` removes RTL's own containers and nothing else, so the hand-written
    // probe markup the two control cases assign to `document.body.innerHTML` would
    // otherwise still be in the document when the next case sweeps it. Measured: the
    // microclimate case below found `<section id="panel" class="lg:sticky …">` and
    // `<div id="bar" class="sticky bottom-0">` left over from `detects an ancestor
    // that would swallow the sticky panel`, on a page that renders neither.
    document.body.innerHTML = ''
    window.localStorage.clear()
    vi.unstubAllGlobals()
    // A case that reads the bar on a phone must not leave the next one measuring
    // `lg:` utilities against a 390px window.
    setViewportWidth(DEFAULT_VIEWPORT_WIDTH)
  })

  it('loads the real stylesheet', () => {
    // Guard the guard: an empty or unparsed stylesheet computes nothing, which would
    // make `position: sticky` fail and every overflow assertion pass vacuously.
    expect(stylesheet.length).toBeGreaterThan(1000)
    installStylesheet()
    document.body.innerHTML =
      '<div id="panel-probe" class="lg:sticky lg:top-gutter"></div>'
      + '<div id="bar-probe" class="sticky bottom-0"></div>'

    // The microclimate panel's pair, which also proves the `lg` query is evaluated
    // rather than dropped.
    const panelProbe = getComputedStyle(document.getElementById('panel-probe')!)
    expect(panelProbe.position, '`lg:sticky` compiles and the `lg` query matches').toBe('sticky')
    expect(panelProbe.top, '`lg:top-gutter` is --admin-size-shell-gutter').toBe('12px')

    // The survey bar's pair. Unprefixed on purpose: it sticks at every width.
    const barProbe = getComputedStyle(document.getElementById('bar-probe')!)
    expect(barProbe.position, '`sticky` compiles').toBe('sticky')
    expect(barProbe.bottom, '`bottom-0` compiles to a length, not to `calc()`').toBe('0px')
  })

  it('detects an ancestor that would swallow the sticky panel', () => {
    // The companion the sweeps below need: they are all "found nothing", so they
    // would also pass against a walker that can never find anything.
    //
    // Two guards and two sticky shapes, all four combinations. `overflow-x-auto` is
    // the exact class `RespondShell`'s `<main>` had, and it reaches `overflow-y`
    // only through the used-value promotion — so the walker has to read the axis the
    // author did NOT write. `overflow-hidden` is the shorthand, the form a
    // wide-content guard is most often written in, and it is only visible here if
    // the computed style expands it onto both axes.
    installStylesheet()
    for (const guard of ['overflow-x-auto', 'overflow-hidden']) {
      document.body.innerHTML =
        `<main class="${guard}">`
        + '<section id="panel" class="lg:sticky lg:top-gutter"></section>'
        + '<div id="bar" class="sticky bottom-0"></div>'
        + '</main>'
      const panel = document.getElementById('panel')!
      const bar = document.getElementById('bar')!
      expect(getComputedStyle(panel).position).toBe('sticky')
      expect(getComputedStyle(bar).position).toBe('sticky')
      expect(scrollportAncestors(panel), `${guard} above a top-sticky panel`).toEqual([
        `<main class="${guard}">`,
      ])
      expect(scrollportAncestors(bar), `${guard} above a bottom-sticky bar`).toEqual([
        `<main class="${guard}">`,
      ])
    }
  })

  it('is sticky with nothing above it that scrolls on /surveys/:id/respond', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(surveyView()), { status: 200 }),
    )
    installStylesheet()
    renderAt('/surveys/s1/respond', '/surveys/:id/respond', <SurveyRespondPage />)

    const bar = await findSubmitBar()
    const computed = getComputedStyle(bar)
    expect(computed.position, 'the bar is sticky').toBe('sticky')
    expect(computed.bottom, 'and pinned to the bottom edge of its scrollport').toBe('0px')

    // The walk has to have reached the shell, or "no scrollport" is a claim about
    // nothing. `RespondShell` gives `<main>` the id it also uses as the skip target,
    // and the bar is the last child of the `<form>` rather than a sibling of it.
    const chain = ancestorsOf(bar)
    expect(chain.some((element) => element.tagName === 'FORM')).toBe(true)
    expect(chain.some((element) => element.tagName === 'MAIN')).toBe(true)
    expect(chain.some((element) => element.tagName === 'HTML')).toBe(true)

    expect(
      scrollportAncestors(bar),
      'An `overflow` on ANY ancestor makes that ancestor the bar\'s scrollport, '
        + 'and none of them scrolls — the document does — so the bar stops sticking '
        + 'and the answered count and both actions scroll off the bottom. Put the '
        + 'wide-content guard on the wide row itself (see RespondQuestionField\'s '
        + 'ranking <ol>), never on a box the bar sits inside.',
    ).toEqual([])

    // The rail was cut because it drew nothing below `lg` — on a phone, which is
    // where this page is mostly answered. `lg:sticky` would satisfy every assertion
    // above, because happy-dom's window is exactly 1024px, and would reintroduce
    // that defect at the bottom of the screen instead of the side. So the same box
    // is re-read on a phone.
    setViewportWidth(PHONE_VIEWPORT_WIDTH)
    const onPhone = stickinessAtCurrentViewport(bar)
    expect(onPhone.position, 'the bar sticks on a phone too, not only from `lg` up').toBe('sticky')
    expect(onPhone.bottom).toBe('0px')
  })

  it('is sticky with nothing above it that scrolls on the public /survey/:id', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(surveyView()), { status: 200 }),
    )
    installStylesheet()
    renderAt('/survey/s1', '/survey/:id', <PublicSurveyRespondPage />)

    const bar = await findSubmitBar()
    expect(getComputedStyle(bar).position).toBe('sticky')
    expect(getComputedStyle(bar).bottom).toBe('0px')

    // Same vacuity control as the authenticated route: this shell is assembled by a
    // different page component, so "no scrollport" has to be a claim about a walk
    // that actually reached one.
    const chain = ancestorsOf(bar)
    expect(chain.some((element) => element.tagName === 'MAIN')).toBe(true)
    expect(chain.some((element) => element.tagName === 'HTML')).toBe(true)

    expect(scrollportAncestors(bar)).toEqual([])
  })

  /**
   * The pulse pins nothing, so this measures what is left: that it stays a plain
   * reading order, and that nothing above it can clip that order or push the one
   * action off the side of a phone. See the third section of this file's docstring
   * for why the case reads this way rather than asserting a rail that the approved
   * design never drew.
   */
  it('pins nothing, and nothing above the column clips it, on /microclimates/:id/respond', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(microclimate()), { status: 200 }),
    )
    installStylesheet()
    const { container } = renderAt(
      '/microclimates/m1/respond',
      '/microclimates/:id/respond',
      <MicroclimateRespondPage />,
    )

    // Reached through the control the respondent finishes from, for `findSubmitBar`'s
    // reason: what is claimed is a property of the column the Send button is IN, so
    // the containment is proved by construction rather than by a lucky selector.
    const submit = await screen.findByRole('button', { name: 'Enviar' })
    const column = submit.closest('[data-slot="pulse-column"]')
    expect(column, 'the Send action is inside the one column the design draws').toBeTruthy()

    // The rail is gone and no bar replaced it. Not vacuous: `installStylesheet`
    // compiles `sticky`, `lg:sticky`, `bottom-0` and `top-gutter`, which the
    // `loads the real stylesheet` case measures directly — so a rail or a bar
    // reintroduced in either shape computes `sticky` here and is named.
    // The RENDERED tree, not `document.body`: the control cases above write probe
    // markup straight into the body, and a sweep of the body would report their
    // leftovers as this page's.
    expect(
      stickyElements(container),
      'The approved `pulse` screen is one column with nothing pinned to the '
        + 'viewport. A right-hand rail was kept on this route for months because '
        + 'this file asserted one; do not put it back to satisfy a test.',
    ).toEqual([])

    // The walk has to have reached the shell, or "no scrollport" is a claim about
    // nothing.
    const chain = ancestorsOf(column!)
    expect(chain.some((element) => element.tagName === 'MAIN')).toBe(true)
    expect(chain.some((element) => element.tagName === 'HTML')).toBe(true)

    expect(
      scrollportAncestors(column!),
      'An `overflow` on any ancestor makes that ancestor a scrollport, and none of '
        + 'them scrolls — the document does. On this column the cost is not a box '
        + 'that stops sticking but a column that is CUT, with the Send button and '
        + 'the anonymity footnote below the cut. Put the wide-content guard on the '
        + 'wide row itself, never on a box the column sits inside.',
    ).toEqual([])

    // Reachable without a horizontal scroll: the question card is a grid item, so
    // its automatic minimum size is its min-content width. Without `min-w-0` a long
    // unbroken option label widens the card, the card widens the column and the
    // column widens the document — and the button goes off the side of a phone.
    // `detects a card that cannot shrink`, below, is the control for this reading.
    const card = document.querySelector('form fieldset')
    expect(card, 'the question renders in a fieldset inside the form').toBeTruthy()
    expect(getComputedStyle(card!).minWidth).toBe('0px')
  })
})

/**
 * Where the wide-content guard went instead.
 *
 * Taking `overflow-x-auto` off `<main>` is only half a fix: something on this page
 * genuinely IS wider than a phone. Measured in Chromium with
 * `scripts/shot-fixtures/respond.json` at a 320px viewport, a ranking question's
 * `<fieldset>` has a min-content width of **300px** — a nowrap rank reading, a
 * label, two 32px buttons, three gaps and two lots of padding, none of which
 * `flex-wrap` can fold — against the 262px the column has. Every other question on
 * that page measures 103–138px. A grid item's automatic minimum size is its
 * min-content width, so the card could not shrink, the column could not shrink, and
 * the DOCUMENT scrolled sideways by 9px.
 *
 * Two utilities fix it and both are load-bearing: `min-w-0` lets the card shrink
 * below its min-content, and `overflow-x-auto` on the `<ol>` gives the row that no
 * longer fits somewhere to go. With both, the only box on the page that scrolls
 * horizontally at 320px is that `<ol>` (measured: scrollWidth 266, clientWidth 228)
 * and the document overflow is 0 at 320/360/390/768/1024/1440.
 */
describe('the wide-content guard sits on the wide row', () => {
  beforeEach(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    document.head.innerHTML = ''
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  async function renderRanking() {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(surveyView({ questions: [rankingQuestion()] })), { status: 200 }),
    )
    installStylesheet()
    renderAt('/surveys/s1/respond', '/surveys/:id/respond', <SurveyRespondPage />)
    // The instructions line only exists on a ranking question, so finding it is
    // proof this rendered the branch under test rather than a choice question.
    await screen.findByText('Ordénelas según su criterio, la más importante primero.')
    const list = document.querySelector('form ol')
    expect(list, 'the ranking renders an <ol>').toBeTruthy()
    return list!
  }

  it('lets a ranking row scroll inside its own list', async () => {
    const list = await renderRanking()
    expect(
      getComputedStyle(list).overflowX,
      'Without this the 266px row has nowhere to go and renders outside the card.',
    ).toBe('auto')
  })

  it('lets the question card shrink below the width of that row', async () => {
    const list = await renderRanking()
    const card = list.closest('fieldset')
    expect(card, 'the <ol> is inside the question fieldset').toBeTruthy()
    expect(
      getComputedStyle(card!).minWidth,
      'A grid item defaults to `min-width: auto`, i.e. its min-content width. '
        + 'Without `min-w-0` the 300px card widens the question column, the column '
        + 'widens the page, and the document scrolls sideways at 320px.',
    ).toBe('0px')
  })

  it('detects a card that cannot shrink', () => {
    // The companion the two assertions above need: both are positive, but a
    // stylesheet that computed nothing would report `""` rather than `0px`/`auto`,
    // so this pins what the DEFAULT looks like through the same harness.
    installStylesheet()
    document.body.innerHTML = '<fieldset id="bare"><ol id="list"></ol></fieldset>'
    expect(getComputedStyle(document.getElementById('bare')!).minWidth).not.toBe('0px')
    expect(getComputedStyle(document.getElementById('list')!).overflowX).not.toBe('auto')
  })
})

