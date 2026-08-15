import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MonoReadings } from './dashboardGrammar'
import type { TranslateFn } from '../../../i18n'

/**
 * The grammar every dashboard composes from. These pin the two properties that make the
 * redesign read as an instrument and that nothing else defends:
 *
 * - a reading interpolated into a translated sentence is set in mono, and
 * - it is formatted the way the tile above it formats its own value.
 *
 * Both survived a mutation before this file existed. Removing `toLocaleString` — which is
 * exactly the state this helper shipped in — left 59 dashboard tests green while rendering
 * `COMPLETED RESPONSES 1,102` above a sub-line reading `of 1284 started`.
 */

// A stand-in catalogue, so these assert the helper's behaviour rather than today's copy.
const t = ((key: string, params?: Record<string, unknown>) => {
  const messages: Record<string, string> = {
    'test.two': 'of {total} started',
    'test.order': '{second} then {first}',
    'test.adjacent': '{a}{b}',
    'test.prose': '{name} has {count} left',
  }
  let out = messages[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) {
    out = out.replaceAll(`{${name}}`, String(value))
  }
  return out
}) as TranslateFn

afterEach(cleanup)

describe('MonoReadings', () => {
  const monoTextOf = (container: HTMLElement) =>
    [...container.querySelectorAll('span.font-mono')].map((el) => el.textContent)

  it('sets the interpolated number in mono and leaves the prose alone', () => {
    const { container } = render(
      <MonoReadings t={t} messageKey="test.two" params={{ total: 19 }} locale="en-US" />,
    )
    expect(monoTextOf(container)).toEqual(['19'])
    expect(container.textContent).toBe('of 19 started')
  })

  it('formats a reading the way the tile beside it formats its value', () => {
    // The defect this closes: `String(1284)` is "1284" while `KpiTile` renders the same
    // magnitude as "1,284", so one tile printed two number formats.
    const { container } = render(
      <MonoReadings t={t} messageKey="test.two" params={{ total: 1284 }} locale="en-US" />,
    )
    expect(monoTextOf(container)).toEqual(['1,284'])
  })

  it('uses the locale it is given, not the runtime default', () => {
    // Five digits, not four, and that is the whole point of this comment: `es-ES` groups
    // from five digits up (CLDR `min2`), so `(1284).toLocaleString('es-ES')` is "1284" with
    // no separator at all while `en-US` gives "1,284". A locale test written at four digits
    // asserts the wrong thing and fails against correct code — it did here first.
    const { container } = render(
      <MonoReadings t={t} messageKey="test.two" params={{ total: 12845 }} locale="es-ES" />,
    )
    expect(monoTextOf(container)).toEqual(['12.845'])
    // And not the English grouping, so a silently ignored locale cannot pass by coincidence.
    expect(monoTextOf(container)).not.toEqual(['12,845'])
  })

  it('keeps readings aligned with their placeholders when the catalogue reorders them', () => {
    // The reason this substitutes markers rather than splitting the English: Spanish puts
    // the same two numbers in the other order.
    const { container } = render(
      <MonoReadings
        t={t}
        messageKey="test.order"
        params={{ first: 1, second: 2 }}
        locale="en-US"
      />,
    )
    expect(monoTextOf(container)).toEqual(['2', '1'])
    expect(container.textContent).toBe('2 then 1')
  })

  it('handles two readings with no prose between them', () => {
    // Adjacent markers yield an empty prose piece between, which must not break the
    // odd-index alternation the mapping relies on.
    const { container } = render(
      <MonoReadings t={t} messageKey="test.adjacent" params={{ a: 4, b: 5 }} locale="en-US" />,
    )
    expect(monoTextOf(container)).toEqual(['4', '5'])
    expect(container.textContent).toBe('45')
  })

  it('passes a string param through as prose, not as a reading', () => {
    // A department name is not a measurement and must not be set in the mono face.
    const { container } = render(
      <MonoReadings
        t={t}
        messageKey="test.prose"
        params={{ name: 'Engineering', count: 3 }}
        locale="en-US"
      />,
    )
    expect(monoTextOf(container)).toEqual(['3'])
    expect(container.textContent).toBe('Engineering has 3 left')
  })
})
