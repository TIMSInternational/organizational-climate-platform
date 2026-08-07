import { describe, it, expect } from 'vitest'
import { createTranslator } from '../../i18n'
import en from '../../i18n/en.json'
import es from '../../i18n/es.json'
import {
  ACTION_PLAN_PRIORITIES,
  ACTION_PLAN_STATUSES,
  MEASUREMENT_FREQUENCIES,
  frequencyLabel,
  kpiProgressPercent,
  priorityLabel,
  statusLabel,
} from './actionPlanVocabulary'

const t = createTranslator(en)
const tEs = createTranslator(es)

describe('action plan vocabulary', () => {
  it('has a real label for every value the server will accept', () => {
    // The failure this catches is a *silent* one: `label()` falls back to the raw
    // wire value, so a missing key does not throw or render a key path -- it
    // renders `not_started` at the user and looks almost plausible. Asserting the
    // label differs from the input is what makes that visible.
    for (const status of ACTION_PLAN_STATUSES) {
      expect(statusLabel(t, status), status).not.toBe(status)
      expect(statusLabel(tEs, status), status).not.toBe(status)
    }
    for (const priority of ACTION_PLAN_PRIORITIES) {
      expect(priorityLabel(t, priority), priority).not.toBe(priority)
      expect(priorityLabel(tEs, priority), priority).not.toBe(priority)
    }
    for (const frequency of MEASUREMENT_FREQUENCIES) {
      expect(frequencyLabel(t, frequency), frequency).not.toBe(frequency)
      expect(frequencyLabel(tEs, frequency), frequency).not.toBe(frequency)
    }
  })

  it('translates rather than echoing, in both languages', () => {
    expect(statusLabel(t, 'in_progress')).toBe('In Progress')
    expect(statusLabel(tEs, 'in_progress')).toBe('En Progreso')
    expect(priorityLabel(tEs, 'critical')).toBe('Crítica')
    expect(frequencyLabel(tEs, 'quarterly')).toBe('Trimestral')
  })

  it('returns the server value for a status it has never heard of', () => {
    // Reachable on real data, not theoretical: `RecordProgressAsync` assigns
    // `objective.CurrentStatus = objectiveUpdate.StatusUpdate` with no validation,
    // so an objective's status is free text and the detail page renders it through
    // `statusLabel`. The wrong behaviour here would be printing a key path.
    expect(statusLabel(t, 'blocked_on_vendor')).toBe('blocked_on_vendor')
    expect(statusLabel(tEs, 'blocked_on_vendor')).toBe('blocked_on_vendor')
  })

  it('mirrors the closed vocabularies in ActionPlanValidation exactly', () => {
    // These three drive pickers, so a value missing here is a value an admin
    // cannot set, and an extra one is a guaranteed 400.
    expect([...ACTION_PLAN_STATUSES]).toEqual([
      'not_started',
      'in_progress',
      'completed',
      'overdue',
      'cancelled',
    ])
    expect([...ACTION_PLAN_PRIORITIES]).toEqual(['low', 'medium', 'high', 'critical'])
    expect([...MEASUREMENT_FREQUENCIES]).toEqual(['daily', 'weekly', 'monthly', 'quarterly'])
  })
})

describe('kpiProgressPercent', () => {
  it('reports the ratio as a percentage', () => {
    expect(kpiProgressPercent(25, 100)).toBe(25)
    expect(kpiProgressPercent(3, 4)).toBe(75)
  })

  it('has no answer when the target is zero or negative', () => {
    // `current / 0` is Infinity and `0 / 0` is NaN, either of which renders a
    // <Progress> bar of undefined length. Nothing on the server forces a KPI's
    // TargetValue to be positive, so this is reachable.
    expect(kpiProgressPercent(0, 0)).toBeNull()
    expect(kpiProgressPercent(5, 0)).toBeNull()
    expect(kpiProgressPercent(5, -10)).toBeNull()
  })

  it('clamps an overshoot at 100 rather than drawing past the end of the bar', () => {
    // `RecordProgressAsync` accepts any NewValue, and beating a target is a good
    // outcome -- but a bar 140% full is a rendering bug.
    expect(kpiProgressPercent(140, 100)).toBe(100)
    expect(kpiProgressPercent(-5, 100)).toBe(0)
  })
})
