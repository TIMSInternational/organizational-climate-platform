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
 * The instrument panel must actually stick.
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
 * ## Why the assertions look the way they do
 *
 * The test that named this behaviour before asserted `panel.className` contained
 * `'sticky'`, which is true of a broken page and a working one alike — happy-dom
 * does no layout, so no test in this suite can measure where the panel ends up.
 *
 * What happy-dom *does* do is resolve selectors and compute styles, so this
 * compiles the real `src/index.css` through the real Tailwind compiler (the
 * approach `styles/tableOverflow.test.ts` established), puts it in the document,
 * renders the real page, and asserts the two things that are computable:
 *
 * 1. the panel itself computes `position: sticky` with `top: 12px` — through the
 *    `lg` media query, which happy-dom evaluates against its 1024px `innerWidth`;
 * 2. no ancestor of it computes an `overflow` that would make that ancestor the
 *    panel's scrollport.
 *
 * (2) is the cause rather than the symptom, which is the only half of this a
 * layout-free DOM can hold. Adding `overflow-x-auto` back to `RespondShell`'s
 * `<main>` reddens it.
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
 * is explicit. `overflow-x-auto` is here as the NEGATIVE control — `detects an
 * ancestor that would swallow the sticky panel` needs the rule to exist in the
 * stylesheet for the walker to have anything to find.
 */
const CANDIDATES = [
  'lg:sticky',
  'lg:top-gutter',
  'sticky',
  'top-gutter',
  'overflow-x-auto',
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

/** The panel's ancestors, nearest first, up to and including `<html>`. */
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

/** Ancestors that would capture a `position: sticky` descendant. */
function scrollportAncestors(element: Element): string[] {
  return ancestorsOf(element)
    .filter((ancestor) => {
      const computed = getComputedStyle(ancestor)
      return (
        SCROLLPORT_VALUES.includes(computed.overflowX)
        || SCROLLPORT_VALUES.includes(computed.overflowY)
      )
    })
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

describe('the respond instrument panel sticks', () => {
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
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('loads the real stylesheet', () => {
    // Guard the guard: an empty or unparsed stylesheet computes nothing, which would
    // make `position: sticky` fail and every overflow assertion pass vacuously.
    expect(stylesheet.length).toBeGreaterThan(1000)
    installStylesheet()
    document.body.innerHTML = '<div id="probe" class="lg:sticky lg:top-gutter"></div>'
    const probe = getComputedStyle(document.getElementById('probe')!)
    expect(probe.position, '`lg:sticky` compiles and the `lg` query matches').toBe('sticky')
    expect(probe.top, '`lg:top-gutter` is --admin-size-shell-gutter').toBe('12px')
  })

  it('detects an ancestor that would swallow the sticky panel', () => {
    // The companion the sweeps below need: they are all "found nothing", so they
    // would also pass against a walker that can never find anything. This is the
    // exact shape `RespondShell`'s `<main>` had.
    installStylesheet()
    document.body.innerHTML =
      '<main class="overflow-x-auto"><section id="panel" class="lg:sticky lg:top-gutter"></section></main>'
    const panel = document.getElementById('panel')!
    expect(getComputedStyle(panel).position).toBe('sticky')
    expect(scrollportAncestors(panel)).toEqual(['<main class="overflow-x-auto">'])
  })

  it('is sticky with nothing above it that scrolls on /surveys/:id/respond', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(surveyView()), { status: 200 }),
    )
    installStylesheet()
    renderAt('/surveys/s1/respond', '/surveys/:id/respond', <SurveyRespondPage />)

    const panel = await screen.findByRole('region', { name: 'Sobre esta encuesta' })
    const computed = getComputedStyle(panel)
    expect(computed.position, 'the panel is sticky at `lg`').toBe('sticky')
    expect(computed.top, 'and offset by the shell gutter').toBe('12px')

    // The walk has to have reached the shell, or "no scrollport" is a claim about
    // nothing. `RespondShell` gives `<main>` the id it also uses as the skip target.
    const chain = ancestorsOf(panel)
    expect(chain.some((element) => element.tagName === 'MAIN')).toBe(true)
    expect(chain.some((element) => element.tagName === 'HTML')).toBe(true)

    expect(
      scrollportAncestors(panel),
      'An `overflow` on ANY ancestor makes that ancestor the panel\'s scrollport, '
        + 'and none of them scrolls — the document does — so the panel stops sticking '
        + 'and the anonymity promise scrolls off the top. Put the wide-content guard on '
        + 'the wide row itself (see RespondQuestionField\'s ranking <ol>), never on a '
        + 'box the panel sits inside.',
    ).toEqual([])
  })

  it('is sticky with nothing above it that scrolls on the public /survey/:id', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(surveyView()), { status: 200 }),
    )
    installStylesheet()
    renderAt('/survey/s1', '/survey/:id', <PublicSurveyRespondPage />)

    const panel = await screen.findByRole('region', { name: 'Sobre esta encuesta' })
    expect(getComputedStyle(panel).position).toBe('sticky')
    expect(scrollportAncestors(panel)).toEqual([])
  })

  it('is sticky with nothing above it that scrolls on /microclimates/:id/respond', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(microclimate()), { status: 200 }),
    )
    installStylesheet()
    renderAt('/microclimates/m1/respond', '/microclimates/:id/respond', <MicroclimateRespondPage />)

    const panel = await screen.findByRole('region', { name: 'Sobre esta sesión' })
    expect(getComputedStyle(panel).position).toBe('sticky')
    expect(scrollportAncestors(panel)).toEqual([])
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
