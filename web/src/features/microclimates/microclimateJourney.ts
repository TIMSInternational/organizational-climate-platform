import type { TranslateFn } from '../../i18n'
import type { JourneyStep } from '../../components/layout'
import { MICROCLIMATE_STATUSES, statusLabel } from './microclimateVocabulary'

/**
 * A microclimate's lifecycle as a set of timeline steps.
 *
 * This is what fills the ForMaps journey on the detail page. Their journey is a
 * to-do list ("Complete Assessments", "Explore Career Paths") with a status derived
 * from whether the student has done the thing. There is no equivalent checklist
 * here, so the honest analogue is the session's own state machine: the three
 * statuses in `MicroclimateValidation.ValidStatuses`, in the only order the product
 * lets them happen (`NEXT_STATUSES` in `MicroclimateDetailPage`, draft → active →
 * closed, one way).
 *
 * Pure, and separate from the page, so the mapping from a wire status to four
 * step states is asserted directly rather than by reading a rendered timeline.
 *
 * ## What an unrecognised status does
 *
 * Every step is `pending` and none is `active`. `ValidStatuses` is closed today, so
 * this cannot happen — but the alternative for a value we do not know is to guess
 * how far along it is, and a journey that claims a session is running when the
 * server called it something else is worse than one that claims nothing.
 * `microclimateVocabulary` makes the same call for the same reason.
 */
export function microclimateJourney(
  t: TranslateFn,
  status: string,
  startTime: string,
  endTime: string,
  locale: string,
): JourneyStep[] {
  const reached = MICROCLIMATE_STATUSES.indexOf(status as (typeof MICROCLIMATE_STATUSES)[number])

  function stateOf(index: number): JourneyStep['status'] {
    if (reached === -1) return 'pending'
    if (index < reached) return 'completed'
    if (index === reached) return status === 'closed' ? 'completed' : 'active'
    return 'pending'
  }

  // A date is only worth showing on a step that has a date. The start is the
  // moment collection opens and the end the moment it stops, so neither belongs on
  // the draft row — a draft session still carries both, because they were chosen
  // when it was created, and printing them there would read as history rather than
  // as a plan.
  const when = (iso: string) => new Date(iso).toLocaleString(locale)

  return [
    {
      id: 'draft',
      title: statusLabel(t, 'draft'),
      description: t('microclimates.journeyDraft'),
      status: stateOf(0),
    },
    {
      id: 'active',
      title: statusLabel(t, 'active'),
      description: t('microclimates.journeyActive'),
      timestamp: reached >= 1 ? when(startTime) : undefined,
      status: stateOf(1),
    },
    {
      id: 'closed',
      title: statusLabel(t, 'closed'),
      description: t('microclimates.dataCollectionCompleted'),
      timestamp: reached >= 2 ? when(endTime) : undefined,
      status: stateOf(2),
    },
  ]
}
