import { describe, it, expect } from 'vitest'
import es from './es.json'

/*
 * The respondent and tracking screens address the reader as «usted». A «tú» value left
 * among them reads as a different author mid-page. This walks the Spanish catalogue under
 * the namespaces those screens print from, plus the few keys they borrow from shared
 * namespaces, and fails on any unambiguous second-person-informal form.
 */
const NAMESPACES = ['tracking', 'surveyRespond', 'employee', 'auth', 'notifications', 'privacy']
const BORROWED = [
  'dashboard.myDashboardDescription',
  'dashboard.myDashboardInDepartment',
  'dashboard.pendingSurveys',
  'dashboard.completedSurveys',
  'dashboard.closingTodayBody',
  'navigation.trackingDashboardDesc',
  'navigation.trackingMisTareasDesc',
]

const TU_WORDS = [
  'tu', 'tus', 'tú', 'te', 'ti', 'contigo', 'tienes', 'tengas', 'puedes', 'puedas',
  'quieres', 'necesitas', 'estás', 'eres', 'sabes', 'lees', 'registras', 'diriges',
  'participas', 'esperas', 'estabas',
  // tú clitic imperatives. Whether «-alo» is tú or usted depends on the verb's class
  // (déjalo is tú, elíjala is usted), so these are named rather than matched by shape.
  'revísalo', 'cópialo', 'cópialos', 'elígela', 'restáurala', 'duplícala', 'archívala',
  'emítela', 'déjalo', 'déjala', 'pídele', 'inténtalo',
]
const TU_WORD = new RegExp(`(?<![\\p{L}])(${TU_WORDS.join('|')})(?![\\p{L}])`, 'iu')
// Preterites in -aste/-iste (completaste, abriste). The exceptions are third-person
// presents or nouns that share the ending.
const TU_PRETERITE = /(?<![\p{L}])\p{L}+(aste|iste)(?![\p{L}])/iu
const NOT_PRETERITE = /^(existe|insiste|consiste|asiste|resiste|contraste)$/i

type Node = string | { [key: string]: Node }

function flatten(node: Node, prefix: string, out: Map<string, string>): void {
  if (typeof node === 'string') {
    out.set(prefix, node)
    return
  }
  for (const [key, child] of Object.entries(node)) flatten(child, prefix ? `${prefix}.${key}` : key, out)
}

function tuForm(value: string): string | null {
  const word = TU_WORD.exec(value)
  if (word) return word[0]
  const preterite = TU_PRETERITE.exec(value)
  if (preterite && !NOT_PRETERITE.test(preterite[0])) return preterite[0]
  return null
}

describe('respondent and tracking copy speaks usted', () => {
  const all = new Map<string, string>()
  flatten(es as Node, '', all)

  it('carries no tú form in Spanish', () => {
    const offending: string[] = []
    for (const [key, value] of all) {
      const inScope = NAMESPACES.some((ns) => key.startsWith(`${ns}.`)) || BORROWED.includes(key)
      if (!inScope) continue
      const form = tuForm(value)
      if (form) offending.push(`${key}: «${form}» in «${value}»`)
    }
    expect(offending).toEqual([])
  })

  it('still reads every borrowed key it guards', () => {
    expect(BORROWED.filter((key) => !all.has(key))).toEqual([])
  })
})
