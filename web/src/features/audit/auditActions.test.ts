import { describe, expect, it } from 'vitest'
import es from '../../i18n/es.json'
import en from '../../i18n/en.json'
import { createTranslator } from '../../i18n/translate'
import type { Messages } from '../../i18n/translate'
import {
  auditActionFromKey,
  auditActionKey,
  auditActionLabel,
  formatAuditInstant,
  knownAuditActions,
  safeTimeZone,
  zonedDayBoundary,
} from './auditActions'

const tEs = createTranslator(es as Messages, en as Messages)

describe('audit action labels', () => {
  it('names a code in Spanish, never printing the code', () => {
    const label = auditActionLabel(tEs, 'surveys.status.update')
    expect(label).toBe(es.audit.actions.surveys__status__update)
    expect(label).not.toContain('surveys')
  })

  it('reads an unknown code as the generic label, not as the code or a key path', () => {
    const label = auditActionLabel(tEs, 'some.route.added.later.create')
    expect(label).toBe(es.audit.unknownAction)
    expect(label).not.toMatch(/some|route|audit\./)
  })

  it('a hostile code cannot walk into the catalogue or the prototype chain', () => {
    expect(auditActionLabel(tEs, '__proto__')).toBe(es.audit.unknownAction)
    expect(auditActionLabel(tEs, 'constructor')).toBe(es.audit.unknownAction)
  })

  it('every labelled key turns back into the code it names, so the filter sends a real action', () => {
    const keys = Object.keys(es.audit.actions)
    expect(keys.length).toBeGreaterThan(80)
    for (const key of keys) {
      expect(auditActionKey(auditActionFromKey(key))).toBe(key)
      // A dotted path inside a key would be read as nesting by `translate.ts`.
      expect(key).not.toContain('.')
    }
  })

  it('offers every labelled code to the filter, sorted by what the reader sees', () => {
    const actions = knownAuditActions(es as Messages, tEs, 'es')
    expect(actions).toHaveLength(Object.keys(es.audit.actions).length)
    const labels = actions.map((action) => auditActionLabel(tEs, action))
    expect([...labels].sort((a, b) => a.localeCompare(b, 'es'))).toEqual(labels)
  })
})

describe('the company clock', () => {
  it('a day filter means the company’s day, not UTC’s', () => {
    expect(zonedDayBoundary('2026-10-21', 'America/Costa_Rica', false)).toBe('2026-10-21T06:00:00.000Z')
    expect(zonedDayBoundary('2026-10-21', 'America/Costa_Rica', true)).toBe('2026-10-22T05:59:59.999Z')
    expect(zonedDayBoundary('2026-10-21', 'UTC', false)).toBe('2026-10-21T00:00:00.000Z')
    expect(zonedDayBoundary('not a day', 'UTC', false)).toBeUndefined()
  })

  it('prints an instant on the company’s clock', () => {
    expect(formatAuditInstant('2026-10-22T19:05:00Z', 'es', 'America/Costa_Rica')).toContain('13:05')
    expect(formatAuditInstant('2026-10-22T19:05:00Z', 'es', 'UTC')).toContain('19:05')
  })

  it('a zone the runtime does not know falls back to UTC instead of throwing', () => {
    expect(safeTimeZone('Mars/Olympus_Mons')).toBe('UTC')
    expect(safeTimeZone(null)).toBe('UTC')
    expect(safeTimeZone('America/Costa_Rica')).toBe('America/Costa_Rica')
  })
})
