import type { TranslateFn } from '../../../i18n'
import type { ChipTone } from '../../../components/ui'
import { questionTypeLabel, statusLabel } from '../microclimateVocabulary'

/**
 * The words the redesigned microclimate boards use where the old pages used the server's
 * vocabulary verbatim.
 *
 * Two question types have their own name on these screens: `likert` is "Escala de 1 a 5"
 * and `open_ended` is "Una palabra" — the boards' names, because on a microclimate an open
 * answer is only ever read as word frequencies. Every other type keeps the shared
 * `surveys.*` label `microclimateVocabulary` already maps.
 *
 * A live session is "En vivo" on every board rather than the old "Activo".
 */
const TYPE_KEY: Record<string, string> = {
  likert: 'microclimates.next.type.likert',
  open_ended: 'microclimates.next.type.openEnded',
}

export function canvasTypeLabel(t: TranslateFn, type: string): string {
  const key = TYPE_KEY[type]
  return key ? t(key) : questionTypeLabel(t, type)
}

const STATUS_KEY: Record<string, string> = {
  draft: 'microclimates.next.status.draft',
  active: 'microclimates.next.status.active',
  closed: 'microclimates.next.status.closed',
}

export function sessionStatusLabel(t: TranslateFn, status: string): string {
  const key = STATUS_KEY[status]
  return key ? t(key) : statusLabel(t, status)
}

export function sessionStatusTone(status: string): ChipTone {
  return status === 'active' ? 'good' : 'neutral'
}

/** The invitation ladder's rungs, as the Detalle board's chips name them. */
const RUNG_KEY: Record<string, string> = {
  pending: 'microclimates.next.detail.rungPending',
  sent: 'microclimates.next.detail.rungSent',
  opened: 'microclimates.next.detail.rungOpened',
  started: 'microclimates.next.detail.rungStarted',
  completed: 'microclimates.next.detail.rungCompleted',
}

export function rungLabel(t: TranslateFn, state: string): string {
  const key = RUNG_KEY[state]
  return key ? t(key) : state
}
