import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import {
  Button,
  Checkbox,
  DatePicker,
  Input,
  Label,
  PaginationLink,
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
 * source sweep, and its allowlist is empty on purpose.
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
    // A table-driven suite whose table is empty is a suite that passes.
    expect(CONTROLS.length).toBeGreaterThanOrEqual(12)
    expect(CONTROLS.filter((control) => control.activate !== null).length).toBeGreaterThanOrEqual(6)
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
  const FORBIDDEN = /\boutline-none\b|\boutline-0\b|outline:\s*['"]?(?:none|0)\b/

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
    expect(FORBIDDEN.test("style={{ outline: 'none' }}")).toBe(true)
    expect(FORBIDDEN.test('className="focus-visible:outline-offset-[-2px]"')).toBe(false)
  })

  it('the one focus indicator still exists in index.css', () => {
    const index = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8')
    expect(index).toMatch(/:focus-visible\s*\{[^}]*outline:\s*var\(--admin-focus-ring-width\)/)
  })
})
