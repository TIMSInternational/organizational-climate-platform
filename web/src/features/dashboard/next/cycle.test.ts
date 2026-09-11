import { describe, it, expect } from 'vitest'
import {
  isBelowTarget,
  nameHead,
  nextWaveCode,
  printedMove,
  printedReading,
  sentenceName,
  targetStanding,
  targetStep,
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

describe('a reading is judged at the decimal it prints, against the canvas’s bands', () => {
  it('gives every cell of the Dashboard artboard’s map the step the artboard paints it', () => {
    // build_admin.py tint(): ≤2,6 deep red · ≤3,4 pale red · ≤3,7 grey · ≤4,0 pale blue · else mid blue.
    const artboard: [number, number][] = [
      [2.4, 0], [2.6, 0], [2.8, 1], [3.0, 1], [3.2, 1], [3.4, 1],
      [3.5, 2], [3.6, 2], [3.7, 2], [3.8, 3], [4.0, 3], [4.2, 4], [4.3, 4], [4.4, 4],
    ]
    expect(artboard.map(([value]) => [value, targetStep(value, 3.7)])).toEqual(artboard)
  })

  it('judges the PRINTED reading at every band edge, never the raw one', () => {
    expect(targetStep(2.64, 3.7)).toBe(0) // prints 2,6
    expect(targetStep(2.66, 3.7)).toBe(1) // prints 2,7
    expect(targetStep(3.44, 3.7)).toBe(1) // prints 3,4
    expect(targetStep(3.46, 3.7)).toBe(2) // prints 3,5
    expect(targetStep(3.74, 3.7)).toBe(2) // prints 3,7
    expect(targetStep(3.75, 3.7)).toBe(3) // prints 3,8
    expect(targetStep(4.04, 3.7)).toBe(3) // prints 4,0
    expect(targetStep(4.06, 3.7)).toBe(4) // prints 4,1
  })

  it('words a reading by the same step, so a chip never contradicts a tint', () => {
    // 3,67 prints "3,7" beside "meta 3,7": on target. 3,46 prints "3,5": the grey band.
    expect(targetStanding(3.67, 3.7)).toBe('on')
    expect(targetStanding(3.46, 3.7)).toBe('on')
    expect(targetStanding(3.44, 3.7)).toBe('below')
    expect(targetStanding(3.75, 3.7)).toBe('above')
    expect(isBelowTarget(3.67, 3.7)).toBe(false)
    expect(isBelowTarget(3.3, 3.7)).toBe(true)
    expect(isBelowTarget(3.8, 3.7)).toBe(false)
  })

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
