import { describe, it, expect } from 'vitest'
import {
  nameHead,
  nextWaveCode,
  printedMove,
  printedReading,
  sentenceName,
} from './derive'
import { todayCalendarDay } from '../../../lib/calendarDay'

describe('the next slot of a quarterly cycle', () => {
  it('names the quarter after, and the next year after a Q4', () => {
    expect(nextWaveCode('Q2', '2026-05-13')).toBe('Q3')
    expect(nextWaveCode('Q4', '2026-10-10T02:03:39Z')).toBe('Q1 2027')
    expect(nextWaveCode('Q3 2026', undefined)).toBe('Q4 2026')
    expect(nextWaveCode('Q4 2026', undefined)).toBe('Q1 2027')
  })

  it('names nothing for a wave that is not a quarter, or a Q4 with no year to roll', () => {
    expect(nextWaveCode('Pulso de marzo', '2026-03-01')).toBeNull()
    expect(nextWaveCode('Q4', undefined)).toBeNull()
  })
})

// Which band a reading is in — judged at the decimal it prints — is
// `components/charts/resultBands.test.ts`; this keeps the printing half.
describe('a reading is printed at the decimal every card prints', () => {
  it('rounds to the decimal a cell prints', () => {
    expect(printedReading(3.79)).toBe(3.8)
    expect(printedReading(3.67)).toBe(3.7)
    expect(printedReading(2.4)).toBe(2.4)
  })
})

describe('a move is the difference of the readings as printed', () => {
  it('is +0,4 between "3,3" and "3,7" where the raw difference prints +0,3, and +0,5 between "2,8" and "3,3"', () => {
    expect(printedMove(3.67, 3.33)).toBe(0.4)
    expect(printedMove(3.33, 2.75)).toBe(0.5)
    expect(printedMove(3.0, 3.3)).toBe(-0.3)
    // At two decimals, as the climate tiles print their averages.
    expect(printedMove(3.6533, 3.3633, 2)).toBe(0.29)
  })
})

describe('a name inside a sentence', () => {
  it('drops one trailing parenthetical, unless another survey carries the name that is left', () => {
    expect(sentenceName('Encuesta de Clima Q4 (abierta)')).toBe('Encuesta de Clima Q4')
    expect(sentenceName('Encuesta de Clima Q4 (abierta)', ['Encuesta de Clima Q4'])).toBe('Encuesta de Clima Q4 (abierta)')
    expect(sentenceName('Encuesta de Clima Q3')).toBe('Encuesta de Clima Q3')
    expect(sentenceName('(abierta)')).toBe('(abierta)')
  })

  it('keeps the head of a name before a spaced dash, and leaves a hyphenated word whole', () => {
    expect(nameHead('Pulso semanal — ¿cómo fue la semana?')).toBe('Pulso semanal')
    expect(nameHead('Pulso semanal – ¿cómo fue?')).toBe('Pulso semanal')
    expect(nameHead('Auto-evaluación de equipo')).toBe('Auto-evaluación de equipo')
  })
})

describe('today as a day', () => {
  it('is the reader’s calendar day, whatever the hour', () => {
    expect(todayCalendarDay(new Date(2026, 8, 10, 0, 5))).toBe('2026-09-10')
    expect(todayCalendarDay(new Date(2026, 8, 10, 23, 55))).toBe('2026-09-10')
  })
})
