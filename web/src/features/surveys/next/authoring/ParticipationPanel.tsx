import { useState } from 'react'
import {
  Button,
  LoadingRegion,
  SkeletonText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui'
import { useTranslation } from '../../../../i18n'
import { TH_CLASS } from '../../../shared-next/parts'
import type { ParticipationState } from './useSurveyParticipation'
import { Card, CardHeading } from './parts'
import { formatParticipationDay } from './participationDay'

/** Rows drawn before "Y N más": a list of names is read top-down, and a long one scrolls the page away. */
export const PARTICIPATION_PREVIEW_ROWS = 8

/**
 * "Participación": who has FINISHED, and who has not — never what anybody answered.
 *
 * Reads `GET /surveys/{id}/participation`, which is built from `survey_participations` and the
 * company's user list and nothing else: there is no answer, área or time of day in the payload
 * for this screen to leak, so the guarantee does not rest on what is drawn here.
 *
 * "Pendientes" is the company's active users with an email and no participation row. A
 * respondent who answered without an email cannot be matched to anybody, so the panel says so
 * rather than letting a pending list that never shrinks read as people not answering.
 */
export default function ParticipationPanel({ state }: { state: ParticipationState }) {
  const { t, locale } = useTranslation()
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.participation.${key}`, vars)
  const [showAllAnswered, setShowAllAnswered] = useState(false)
  const [showAllPending, setShowAllPending] = useState(false)

  return (
    <section aria-label={copy('title')} className="mt-6" data-testid="participation-panel">
      <Card className="flex flex-col gap-3 px-4 py-4">
        <CardHeading title={copy('title')} />
        <p className="m-0 text-sm text-fg-secondary">{copy('intro')}</p>

        {state.status === 'idle' ? null : state.status === 'loading' ? (
          <LoadingRegion loading label={t('common.loading')}>
            <SkeletonText lines={3} />
          </LoadingRegion>
        ) : state.status === 'error' ? (
          <p role="alert" className="m-0 text-sm text-accent-red-ink">
            {copy('loadFailed')}
          </p>
        ) : !state.view.collectsParticipantIdentity && state.view.answeredCount === 0 ? (
          <p className="m-0 text-sm text-fg-secondary">{copy('off')}</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2" data-testid="participation-answered">
              <h3 className="m-0 flex items-baseline gap-2 text-base">
                {copy('answered')}
                <span className="font-mono text-sm tabular-nums text-fg-secondary">{state.view.answeredCount}</span>
              </h3>
              {state.view.answered.length === 0 ? (
                <p className="m-0 text-sm text-fg-secondary">{copy('answeredEmpty')}</p>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-md border border-line-light">
                    <Table className="text-sm">
                      <TableHeader className="bg-surface-icon-box">
                        <TableRow>
                          <TableHead scope="col" className={TH_CLASS}>{copy('name')}</TableHead>
                          <TableHead scope="col" className={TH_CLASS}>{copy('email')}</TableHead>
                          <TableHead scope="col" className={TH_CLASS}>{copy('day')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(showAllAnswered ? state.view.answered : state.view.answered.slice(0, PARTICIPATION_PREVIEW_ROWS)).map(
                          (person, index) => (
                            <TableRow key={`${person.email ?? person.name}-${index}`}>
                              <TableCell className="px-3 py-2 font-medium">{person.name}</TableCell>
                              <TableCell className="px-3 py-2 font-mono text-xs text-fg-secondary">
                                {person.email ?? copy('noEmail')}
                              </TableCell>
                              <TableCell className="whitespace-nowrap px-3 py-2 text-fg-secondary">
                                {formatParticipationDay(person.participatedOn, locale)}
                              </TableCell>
                            </TableRow>
                          ),
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  {!showAllAnswered && state.view.answered.length > PARTICIPATION_PREVIEW_ROWS ? (
                    <Button type="button" variant="outline" className="self-start" onClick={() => setShowAllAnswered(true)}>
                      {copy('more', { count: state.view.answered.length - PARTICIPATION_PREVIEW_ROWS })}
                    </Button>
                  ) : null}
                </>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-2" data-testid="participation-pending">
              <h3 className="m-0 flex items-baseline gap-2 text-base">
                {copy('pending')}
                <span className="font-mono text-sm tabular-nums text-fg-secondary">{state.view.pendingCount}</span>
              </h3>
              {state.view.pending.length === 0 ? (
                <p className="m-0 text-sm text-fg-secondary">{copy('pendingEmpty')}</p>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-md border border-line-light">
                    <Table className="text-sm">
                      <TableHeader className="bg-surface-icon-box">
                        <TableRow>
                          <TableHead scope="col" className={TH_CLASS}>{copy('name')}</TableHead>
                          <TableHead scope="col" className={TH_CLASS}>{copy('email')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(showAllPending ? state.view.pending : state.view.pending.slice(0, PARTICIPATION_PREVIEW_ROWS)).map(
                          (person) => (
                            <TableRow key={person.email}>
                              <TableCell className="px-3 py-2 font-medium">{person.name}</TableCell>
                              <TableCell className="px-3 py-2 font-mono text-xs text-fg-secondary">{person.email}</TableCell>
                            </TableRow>
                          ),
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  {!showAllPending && state.view.pending.length > PARTICIPATION_PREVIEW_ROWS ? (
                    <Button type="button" variant="outline" className="self-start" onClick={() => setShowAllPending(true)}>
                      {copy('more', { count: state.view.pending.length - PARTICIPATION_PREVIEW_ROWS })}
                    </Button>
                  ) : null}
                </>
              )}
              <p className="m-0 text-xs text-fg-secondary">{copy('pendingNote')}</p>
            </div>
          </div>
        )}
      </Card>
    </section>
  )
}
