import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Checkbox,
  DatePicker,
  Input,
  Label,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  RadioGroup,
  RadioGroupItem,
  SegmentedScale,
  SelectField,
  SkipLink,
  Slider,
  Switch,
  TabsList,
  TabsTrigger,
  Tabs,
  Textarea,
} from './index'
import { TranslationProvider } from '../../i18n'

/**
 * #83's third acceptance criterion, in two halves: **every primitive
 * keyboard-operable with a visible focus indicator.**
 *
 * ## Operable
 *
 * Each interactive primitive is rendered and reached with Tab — not with
 * `.focus()`, and not by `getByRole().focus()`. Those prove the element *can* hold
 * focus; only Tab proves it is in the tab order, which is the thing a keyboard
 * user actually depends on and the thing `tabindex="-1"`, `pointer-events`, or a
 * `<div onClick>` masquerading as a control would break. Activation follows, with
 * Enter or Space as the role dictates, so a control that focuses but does nothing
 * is caught too.
 *
 * ## Visible
 *
 * The app has exactly one focus indicator: the `:focus-visible` outline in
 * `index.css`, drawn from `--admin-focus-ring`. `styles/inkContrast.test.ts`
 * measures that it is distinguishable from every surface and that its width is not
 * zero. What neither of those can see is a component that *deletes* it — an inline
 * `outline` or an `outline-none` in a class list silently kills the ring, tsc and
 * oxlint are both happy, and every rendering assertion still passes. That is a
 * defect this repository has shipped before. So the second half of this file is a
 * source sweep — three of them, because one was not enough:
 *
 * 1. **The blocklist**, over `.ts`/`.tsx`, with an empty allowlist. It now knows
 *    `outline-hidden`, which is Tailwind v4's spelling of v3's `outline-none`.
 *    Missing it was not hypothetical: four primitives (`tabs`, `popover`,
 *    `dropdown-menu`, `select`) were shipping a deleted ring under a green suite.
 * 2. **The allowlist**, over every `outline-*` utility in the app, so the next
 *    rename does not need this file to have heard of it first. Four entries,
 *    each with the reason it draws or moves the ring rather than deleting it.
 * 3. **The stylesheets**, which the source walk never read at all — and a rule in
 *    `@layer components` outranks the `:focus-visible` declaration in
 *    `@layer base`, so three lines of CSS could take the ring off every button
 *    and link in the product without one test noticing.
 */

afterEach(cleanup)

interface Control {
  name: string
  render: () => ReactNode
  /** How this role is activated once focused. */
  activate: '{Enter}' | ' ' | null
  /** Which element must have focus after Tab, when it is not the only one. */
  role?: string
}

const CONTROLS: Control[] = [
  { name: 'Button', render: () => <Button onClick={onAct}>Guardar</Button>, activate: '{Enter}' },
  {
    name: 'Input',
    render: () => (
      <>
        <Label htmlFor="k-input">Nombre</Label>
        <Input id="k-input" />
      </>
    ),
    activate: null,
  },
  {
    name: 'Textarea',
    render: () => (
      <>
        <Label htmlFor="k-textarea">Comentario</Label>
        <Textarea id="k-textarea" />
      </>
    ),
    activate: null,
  },
  {
    name: 'Checkbox',
    render: () => (
      <>
        <Checkbox id="k-check" onCheckedChange={onAct} />
        <Label htmlFor="k-check">Anónima</Label>
      </>
    ),
    activate: ' ',
  },
  {
    name: 'Switch',
    render: () => (
      <>
        <Switch id="k-switch" onCheckedChange={onAct} />
        <Label htmlFor="k-switch">Recordatorios</Label>
      </>
    ),
    activate: ' ',
  },
  {
    name: 'RadioGroupItem',
    render: () => (
      <RadioGroup aria-label="Departamento" onValueChange={onAct}>
        <RadioGroupItem id="k-radio" value="gestion" />
        <Label htmlFor="k-radio">Gestión</Label>
      </RadioGroup>
    ),
    activate: ' ',
  },
  { name: 'Slider', render: () => <Slider aria-label="Avance" defaultValue={[40]} />, activate: null },
  { name: 'SelectField trigger', render: () => <SelectField label="Departamento" options={[]} />, activate: null },
  {
    name: 'DatePicker trigger',
    render: () => <DatePicker placeholder="Elegir" label="Fecha de compromiso" />,
    activate: null,
  },
  {
    name: 'TabsTrigger',
    render: () => (
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Resumen</TabsTrigger>
        </TabsList>
      </Tabs>
    ),
    activate: null,
  },
  { name: 'PaginationLink', render: () => <PaginationLink onClick={onAct}>1</PaginationLink>, activate: '{Enter}' },
  // Prev/Next are how a keyboard user pages through every list in the product,
  // and they were the two members of this family the table did not carry: axe
  // does not read tab order, so `tabIndex={-1}` on either of them passed the
  // whole suite. The table is the only thing that can see it.
  {
    name: 'PaginationPrevious',
    render: () => <PaginationPrevious label="Anterior" onClick={onAct} />,
    activate: '{Enter}',
  },
  {
    name: 'PaginationNext',
    render: () => <PaginationNext label="Siguiente" onClick={onAct} />,
    activate: '{Enter}',
  },
  {
    name: 'AccordionTrigger',
    render: () => (
      <Accordion type="single" collapsible onValueChange={onAct}>
        <AccordionItem value="calculo">
          <AccordionTrigger>¿Cómo se calcula el semáforo?</AccordionTrigger>
          <AccordionContent>Con el promedio de la dimensión.</AccordionContent>
        </AccordionItem>
      </Accordion>
    ),
    activate: '{Enter}',
  },
  { name: 'SkipLink', render: () => <SkipLink href="#main">Saltar al contenido</SkipLink>, activate: null },
  {
    name: 'SegmentedScale',
    render: () => (
      <SegmentedScale min={1} max={5} minLabel="Nunca" maxLabel="Siempre" value={null} onChange={onAct} label="Escala" />
    ),
    activate: ' ',
  },
]

const onAct = vi.fn()

describe('every interactive primitive is reachable and operable by keyboard', () => {
  for (const control of CONTROLS) {
    it(control.name, async () => {
      onAct.mockClear()
      render(<TranslationProvider initialLocale="es">{control.render()}</TranslationProvider>)

      await userEvent.tab()
      const focused = document.activeElement as HTMLElement
      expect(focused, `${control.name} did not take focus on the first Tab`).not.toBe(document.body)
      // The control, not its label: a `<Label htmlFor>` is not focusable, so
      // landing on one would mean the control itself is out of the tab order.
      expect(
        focused.tagName === 'LABEL',
        `${control.name}: Tab landed on the label, not the control`,
      ).toBe(false)

      if (control.activate) {
        await userEvent.keyboard(control.activate)
        expect(onAct, `${control.name} did not respond to ${control.activate}`).toHaveBeenCalled()
      }
    })
  }

  it('covers something — the vacuity control', () => {
    // A table-driven suite whose table is empty is a suite that passes, and a
    // floor set well below the table's real size lets rows be deleted instead:
    // this one sat at 12 while the table held 13, so three primitives could be
    // dropped and the suite would still say it had covered "something". The floor
    // tracks the table, so removing a row is a diff a reviewer sees rather than a
    // silent loss of coverage.
    expect(CONTROLS.length).toBeGreaterThanOrEqual(16)
    expect(CONTROLS.filter((control) => control.activate !== null).length).toBeGreaterThanOrEqual(9)
    // Names, not just a count — otherwise a deleted row can be paid for with a
    // duplicate of one that is easy to pass.
    expect(new Set(CONTROLS.map((control) => control.name)).size).toBe(CONTROLS.length)
  })
})

describe('nothing in the app deletes the focus ring', () => {
  /**
   * `index.css` gives the whole app one `:focus-visible` outline and that is the
   * only focus indicator there is. Three spellings remove it, all of them silent:
   * Tailwind's `outline-none` / `outline-0`, and a CSS `outline: none` in an inline
   * `style`. The allowlist is deliberately empty — a component that genuinely needs
   * to move the ring should change its `outline-offset` or `outline-color`, as
   * `CommandPalette` now does, not delete it.
   */
  // The quote in `outline: 'none'` is optional so the same expression catches both
  // the CSS spelling and the React inline-style one.
  //
  // `outline-hidden` is Tailwind **v4's** spelling of what v3 called
  // `outline-none`, and this project runs v4 (`tailwindcss@4.3.3`): the compiled
  // rule is `.outline-hidden{--tw-outline-style:none;outline-style:none}` in
  // `@layer utilities`, which beats the `:focus-visible` rule in `@layer base`.
  // Leaving it out of this expression was not hypothetical — four primitives were
  // shipping it when the sweep was written (`tabs`, `popover`, `dropdown-menu`,
  // `select`), and the suite was green over all four.
  const FORBIDDEN =
    /\boutline-none\b|\boutline-0\b|\boutline-hidden\b|outline:\s*['"]?(?:none|0)\b/

  function sources(dir: string, prefix = ''): [string, string][] {
    const found: [string, string][] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`
      if (entry.isDirectory()) found.push(...sources(join(dir, entry.name), `${path}/`))
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        found.push([path, readFileSync(join(dir, entry.name), 'utf8')])
      }
    }
    return found
  }

  it('no component suppresses the outline', () => {
    const files = sources(join(process.cwd(), 'src'))
    // The vacuity control for the sweep: if the walk stopped finding files the
    // assertion below would pass over nothing at all.
    expect(files.length, 'the source sweep found no modules').toBeGreaterThan(100)

    const offenders = files
      .filter(([, source]) =>
        // Comments stripped first. Several primitives explain in prose why they do
        // NOT set `outline-none`, and a guard that reads its own justification as a
        // violation is the mistake this repository has made before.
        FORBIDDEN.test(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')),
      )
      .map(([path]) => path)

    expect(offenders).toEqual([])
  })

  it('the sweep would catch a suppression — the vacuity control', () => {
    // Guard the guard: the regex above is the whole test, so it is tested against
    // each spelling it claims to catch, and against a string that merely mentions
    // the word.
    expect(FORBIDDEN.test('className="p-0 outline-none"')).toBe(true)
    expect(FORBIDDEN.test('className="outline-0"')).toBe(true)
    expect(FORBIDDEN.test('className="text-base outline-hidden"')).toBe(true)
    expect(FORBIDDEN.test('className="focus:outline-hidden"')).toBe(true)
    expect(FORBIDDEN.test("style={{ outline: 'none' }}")).toBe(true)
    expect(FORBIDDEN.test('className="focus-visible:outline-offset-[-2px]"')).toBe(false)
  })

  /**
   * The blocklist above knows the spellings that exist today. This one does not
   * need to.
   *
   * Tailwind renamed the ring-killer between v3 and v4 (`outline-none` →
   * `outline-hidden`) and the blocklist did not follow, which is how four
   * primitives kept shipping a deleted focus ring under a green suite. So every
   * `outline-*` utility anywhere in the app is enumerated and held against a
   * reviewed list: a utility that draws or moves the ring is allowed, and
   * anything else — including a spelling that does not exist yet — is a failure
   * that a person has to look at.
   */
  it('every outline utility in the app is one a reviewer signed off', () => {
    const ALLOWED = new Map([
      ['outline-2', 'ClimateMap: the 2px ring on the selected cell — 1.4.11 at 3:1, not a focus ring'],
      ['outline-offset-2', 'ClimateMap: that ring, held off the cell edge'],
      ['outline-fg-primary', 'ClimateMap: that ring, in the ink that clears 3:1 on every heat step'],
      ['outline-offset-[-2px]', 'CommandPalette: the search field draws the ring inside its own rounded edge'],
    ])

    const used = new Map<string, string[]>()
    for (const [path, source] of sources(join(process.cwd(), 'src'))) {
      const clean = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      // The utility, with any variant prefix (`focus-visible:`, `md:`) dropped —
      // `focus:outline-hidden` and `outline-hidden` are the same declaration.
      for (const hit of clean.matchAll(/\boutline-[\w[\]().%/-]+/g)) {
        used.set(hit[0], [...(used.get(hit[0]) ?? []), path])
      }
    }

    // The vacuity control: this app does draw outlines deliberately, so a sweep
    // that finds none has stopped reading the sources.
    expect(used.size, 'the sweep found no outline utility at all').toBeGreaterThan(0)

    const unreviewed = [...used.entries()]
      .filter(([utility]) => !ALLOWED.has(utility))
      .map(([utility, paths]) => `${utility} (${[...new Set(paths)].join(', ')})`)
    expect(unreviewed).toEqual([])
  })

  /**
   * The same sweep, over the stylesheets.
   *
   * `sources()` walks `.ts`/`.tsx` only, so a rule added to `index.css` was
   * entirely outside it — and a rule in `@layer components` beats the
   * `:focus-visible` declaration in `@layer base`, so three lines of CSS can
   * delete the ring for every button and link in the product with the whole
   * suite green. Nothing in this app has any business suppressing an outline in a
   * stylesheet, so the bar is zero rather than an allowlist.
   */
  it('no stylesheet suppresses the outline', () => {
    const SUPPRESSION = /outline(?:-style|-width|-color)?:\s*(?:none|hidden|0(?:px)?|transparent)\s*(?:;|$|!)/

    function stylesheets(dir: string, prefix = ''): [string, string][] {
      const found: [string, string][] = []
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${prefix}${entry.name}`
        if (entry.isDirectory()) found.push(...stylesheets(join(dir, entry.name), `${path}/`))
        else if (entry.name.endsWith('.css'))
          found.push([
            path,
            readFileSync(join(dir, entry.name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
          ])
      }
      return found
    }

    const files = stylesheets(join(process.cwd(), 'src'))
    expect(files.length, 'the stylesheet sweep found no .css files').toBeGreaterThan(1)

    const offenders = files
      .filter(([, css]) => css.split(/[{};]/).some((declaration) => SUPPRESSION.test(`${declaration};`)))
      .map(([path]) => path)
    expect(offenders).toEqual([])

    // Guard the guard, including the spelling that reads as harmless.
    expect(SUPPRESSION.test('outline: none;')).toBe(true)
    expect(SUPPRESSION.test('outline:0;')).toBe(true)
    expect(SUPPRESSION.test('outline-width: 0px;')).toBe(true)
    expect(SUPPRESSION.test('outline-color: transparent;')).toBe(true)
    expect(SUPPRESSION.test('outline: var(--admin-focus-ring-width) solid var(--admin-focus-ring);')).toBe(false)
    expect(SUPPRESSION.test('outline-offset: -2px;')).toBe(false)
  })

  it('the one focus indicator still exists in index.css', () => {
    const index = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8')
    expect(index).toMatch(/:focus-visible\s*\{[^}]*outline:\s*var\(--admin-focus-ring-width\)/)
  })
})
