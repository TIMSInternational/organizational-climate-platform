import { describe, it, expect } from 'vitest'
import {
  SEMAFORO_ESTADOS,
  SEMAFORO_PRESENTATION,
  parseSemaforo,
  semaforoCount,
  totalPlanes,
  type SemaforoEstado,
} from './semaforo'
import { CATALOGUES, LOCALES } from '../../i18n/locale'
import { createTranslator } from '../../i18n/translate'

describe('semáforo states', () => {
  /**
   * The client constraint, asserted rather than described.
   *
   * §7's audience reads these screens in greyscale often enough that colour cannot
   * be the signal, so each state carries a distinct OUTLINE as well as a distinct
   * tone. The realistic regression is not "the icon disappeared" — it is two states
   * quietly sharing one glyph while the colours still differ, which looks fine on a
   * screen and is unreadable on a printout.
   */
  it('gives every state its own glyph, so two states are never one shape', () => {
    const icons = SEMAFORO_ESTADOS.map((estado) => SEMAFORO_PRESENTATION[estado].icon)
    expect(new Set(icons).size).toBe(SEMAFORO_ESTADOS.length)
  })

  it('gives every state its own tone, so two states are never one colour either', () => {
    const tones = SEMAFORO_ESTADOS.map((estado) => SEMAFORO_PRESENTATION[estado].tone)
    expect(new Set(tones).size).toBe(SEMAFORO_ESTADOS.length)
  })

  it('names every state in every locale, because the word is the third carrier', () => {
    // A key that does not resolve renders as the dotted path itself, which is
    // worse than English — the same reason `navSections.test.ts` sweeps its labels.
    //
    // `subKey` is swept alongside `labelKey` rather than left to
    // `i18n/keysExist.test.ts`: both reach the screen through `t(identifier)`, which
    // that guard skips as a computed key. This is the check that replaces it.
    for (const locale of LOCALES) {
      const t = createTranslator(CATALOGUES[locale])
      for (const estado of SEMAFORO_ESTADOS) {
        const { labelKey, subKey } = SEMAFORO_PRESENTATION[estado]
        for (const key of [labelKey, subKey]) {
          expect(t(key), `${key} is unresolved in ${locale}`).not.toBe(key)
          expect(t(key).trim(), `${key} is blank in ${locale}`).not.toBe('')
        }
      }
    }
  })

  it('keeps the Spanish word in both catalogues, because the semáforo is the client vocabulary', () => {
    // These pages are Spanish-first (#125) and "Rojo/Amarillo/Verde" is the term
    // the client's own spec uses. Guarding it here means an English catalogue pass
    // cannot quietly rename the states out from under the reader who was trained
    // on them.
    const es = createTranslator(CATALOGUES.es)
    expect(es('tracking.semaforoRojo')).toBe('Rojo')
    expect(es('tracking.semaforoAmarillo')).toBe('Amarillo')
    expect(es('tracking.semaforoVerde')).toBe('Verde')
  })

  it('reads worst-first, which is the order both screens are laid out in', () => {
    expect([...SEMAFORO_ESTADOS]).toEqual(['Rojo', 'Amarillo', 'Verde'])
  })
})

describe('parseSemaforo', () => {
  it('accepts exactly the three values EstadoSemaforo.ToString() can produce', () => {
    expect(parseSemaforo('Rojo')).toBe('Rojo')
    expect(parseSemaforo('Amarillo')).toBe('Amarillo')
    expect(parseSemaforo('Verde')).toBe('Verde')
  })

  it('returns null for a state this build has never heard of, rather than defaulting to Verde', () => {
    // A silent "green" for an unknown state is a confidently wrong reading, and
    // this audience has no way to challenge it. See the doc comment.
    expect(parseSemaforo('Azul')).toBeNull()
    expect(parseSemaforo('rojo')).toBeNull()
    expect(parseSemaforo('')).toBeNull()
  })
})

describe('counts', () => {
  const counts = { rojo: 3, amarillo: 5, verde: 11 }

  it('maps each capitalised state to the lower-case field the API sends', () => {
    const seen: Record<SemaforoEstado, number> = {
      Rojo: semaforoCount(counts, 'Rojo'),
      Amarillo: semaforoCount(counts, 'Amarillo'),
      Verde: semaforoCount(counts, 'Verde'),
    }
    expect(seen).toEqual({ Rojo: 3, Amarillo: 5, Verde: 11 })
  })

  it('totals the three, which is what the tablero has instead of a totalPlanes field', () => {
    expect(totalPlanes(counts)).toBe(19)
    expect(totalPlanes({ rojo: 0, amarillo: 0, verde: 0 })).toBe(0)
  })
})
