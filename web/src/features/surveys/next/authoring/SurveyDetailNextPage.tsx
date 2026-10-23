import { useState } from 'react'
import { BarChart3, CalendarClock, Copy, Lock, Send, ShieldCheck, Trash2, Users } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { PageTopBar } from '../../../../components/layout'
import {
  Alert,
  AlertDescription,
  Button,
  Chip,
  ConfirmationDialog,
  ErrorState,
  LoadingRegion,
  SkeletonText,
} from '../../../../components/ui'
import { ANONYMITY_FLOOR } from '../../../../components/charts'
import { estimateAudience, targetsWholeCompany } from '../../../../components/distribution'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { useCompanyScope } from '../../../../company-context/useCompanyScope'
import { useTranslation } from '../../../../i18n'
import ContentFallbackNotice from '../../components/ContentFallbackNotice'
import { canDistribute } from '../../api/surveyInvitationCopy'
import SharePanel from './SharePanel'
import type { SurveyDetail } from '../../api/surveys'
import { languageLabel, statusLabel, typeLabel } from '../../surveyVocabulary'
import { Note, PanelHeading } from '../../../shared-next/parts'
import { PreviewQuestion, PreviewSection } from './QuestionPreview'
import { Card, CardHeading, Meter, ReadingTile } from './parts'
import {
  dimensionSections,
  remindersSent,
  responseRate,
  surveyAudience,
  targetedDepartments,
  sentenceCase,
} from './launch'
import { useSurveyDetailModel, type SurveyDetailModel } from './useSurveyDetailModel'
import { SurveyWindowDialog } from './SurveyWindowDialog'
import { DeleteSurveyDialog } from './DeleteSurveyDialog'
import { EditAudienceDialog } from './EditAudienceDialog'
import { audienceEditability } from './audienceEdit'
import { browserTimeZone, dayMonthIn, dayTimeIn, daysFromIn, isKnownTimeZone, yearIn, zoneLabel } from './zonedWindow'

/**
 * Detalle de encuesta, redesigned (canvas board "SurveyDetail") — `/surveys/:id`.
 *
 * One page with the builder's right pane as its body: the questions exactly as the respondent
 * meets them, beside the survey's link, its fact sheet and its departments. The four readings
 * above are responses, audience, the close and the status with the one transition the server
 * allows (`allowedStatusTransitions`, never a client table).
 *
 * Every action is offered only to a viewer the server would answer (`useViewerCapabilities`):
 * Duplicar, Distribución and the transitions to `canAuthorSurveys`, Resultados to
 * `canOpenResults` and only once somebody answered. The previous page
 * (`pages/SurveyDetailPage.tsx`) stays in the tree, unrouted, as the wiring reference.
 */
export default function SurveyDetailNextPage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useTranslation()
  const { state, reload, transition, duplicate, saveWindow, saveAudience, remove, pending, actionError } = useSurveyDetailModel(id)

  if (state.status === 'loading') {
    return (
      <LoadingRegion loading label={t('common.loading')}>
        <SkeletonText lines={8} />
      </LoadingRegion>
    )
  }
  if (state.status === 'error') {
    return (
      <ErrorState
        title={t('errors.generic')}
        description={state.message}
        action={
          <Button variant="outline" onClick={() => void reload()}>
            {t('common.retry')}
          </Button>
        }
      />
    )
  }
  return (
    <SurveyDetailView
      model={state.model}
      pending={pending}
      actionError={actionError}
      onTransition={(status) => void transition(status)}
      onDuplicate={() => void duplicate()}
      onSaveWindow={saveWindow}
      onSaveAudience={saveAudience}
      onDelete={remove}
    />
  )
}

export function SurveyDetailView({
  model,
  pending,
  actionError,
  onTransition,
  onDuplicate,
  onSaveWindow,
  onSaveAudience,
  onDelete,
  now = new Date(),
}: {
  model: SurveyDetailModel
  pending: string | null
  actionError: string | null
  onTransition: (status: string) => void
  onDuplicate: () => void
  /** Moves the response window; absent, the dates are not offered for editing. */
  onSaveWindow?: (window: { startDate?: string; endDate: string }) => Promise<void>
  /** Rewrites the survey's targets; absent, "Editar audiencia" is not offered. */
  onSaveAudience?: (targets: { departmentIds?: string[]; userIds: string[] }) => Promise<void>
  /** Deletes the survey; absent, "Eliminar" is not offered. */
  onDelete?: () => Promise<void>
  now?: Date
}) {
  const { t, locale } = useTranslation()
  const caps = useViewerCapabilities()
  const { survey, departments, distribution, invitations, users } = model
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.detail.${key}`, vars)
  const title = survey.title ?? t('surveys.untitled')
  // The survey's own targets, BOTH kinds — `departmentIds` alone reported a survey aimed at
  // people by name as company-wide.
  const surveyTargets = { departmentIds: survey.departmentIds, userIds: survey.userIds }
  // ONE audience, the one Distribución prints (`surveyAudience`): the invited once invitations
  // exist, the directory's resolution before that, the stated target only when neither is read.
  const audience = surveyAudience({
    invited: invitations?.summary.total ?? null,
    resolved:
      users === null
        ? null
        : estimateAudience('allTargeted', users, { departmentIds: [], userIds: [] }, surveyTargets).length,
    stated: survey.targetAudienceCount,
  })
  const rate = responseRate(survey.responseCount, audience?.count ?? null)
  const targets = targetedDepartments(survey.departmentIds, departments)
  const reminders = remindersSent(invitations?.invitations ?? null)
  const sections = dimensionSections(survey.questions)
  const canAuthor = caps.canAuthorSurveys
  // A super administrator carries no tenant until they pick one, so `canAuthorSurveys` is
  // false and every authoring control vanishes -- Duplicar, Distribución, the transitions --
  // while Resultados stays, because `canOpenResults` admits SUPER_ADMIN unconditionally. The
  // page then looks complete and merely lacks the thing the reader came for. That silence
  // cost a real client conversation: the team concluded the product could not share a link.
  // Eight other pages already branch on this state; this one did not.
  const scope = useCompanyScope()
  const needsCompany = !canAuthor && scope.status === 'needs-selection'
  const editable = survey.isContentEditable && survey.responseCount === 0
  // The company's clock, which the window is read and written in. The browser's only when the
  // company's cannot be read -- and the editor prints whichever zone it is using.
  const timeZone = isKnownTimeZone(model.timeZone) ? model.timeZone : browserTimeZone()
  // Counted in the same zone the sheet prints, so the tile, the sheet and "Activar" agree.
  const closesIn = daysFromIn(survey.endDate, now, timeZone)
  const opensIn = daysFromIn(survey.startDate, now, timeZone)
  // `canDistribute` is `AllowsScheduleEdit` (draft, scheduled, active): exactly where
  // `PUT /surveys/{id}` takes a new window.
  const windowEditable = canAuthor && onSaveWindow !== undefined && canDistribute(survey.status)
  // `DeleteSurveyAsync` deletes in any status while nobody has answered, and only then.
  const deletable = canAuthor && onDelete !== undefined && survey.responseCount === 0
  const [editingWindow, setEditingWindow] = useState(false)
  // "Editar audiencia": offered to an author wherever the page can save it, DISABLED with the
  // reason once the survey has ended (`survey_ended_audience_frozen`, #627) rather than hidden,
  // so the reader learns why the audience no longer moves.
  const audienceOffered = canAuthor && onSaveAudience !== undefined
  const audienceFrozen = audienceEditability(survey) === 'ended'
  const [editingAudience, setEditingAudience] = useState(false)
  const [deleting, setDeleting] = useState(false)

  return (
    <div>
      <PageTopBar
        title={title}
        eyebrow={copy('eyebrow', { type: typeLabel(t, survey.type), count: survey.questions.length })}
        description={survey.description ?? undefined}
        breadcrumbs={[{ label: t('navigation.surveys'), href: '/surveys' }, { label: title }]}
        tightBreadcrumb
        actions={
          <>
            {deletable && (
              <Button type="button" variant="outline" disabled={pending !== null} onClick={() => setDeleting(true)}>
                <Trash2 aria-hidden="true" className="size-icon" />
                {copy('delete.action')}
              </Button>
            )}
            {canAuthor && (
              <Button type="button" variant="outline" disabled={pending !== null} onClick={onDuplicate}>
                <Copy aria-hidden="true" className="size-icon" />
                {copy('duplicate')}
              </Button>
            )}
            {survey.responseCount > 0 && caps.canOpenResults(survey) && (
              <Button asChild variant="outline">
                <Link to={`/surveys/${survey.id}/results`}>
                  <BarChart3 aria-hidden="true" className="size-icon" />
                  {copy('results')}
                </Link>
              </Button>
            )}
            {canAuthor && canDistribute(survey.status) && (
              <Button asChild variant="primary">
                <Link to={`/surveys/${survey.id}/distribution`}>
                  <Send aria-hidden="true" className="size-icon" />
                  {copy('distribution')}
                </Link>
              </Button>
            )}
            {caps.canOpenResults(survey) && <Button asChild variant="outline"><Link to={`/surveys/${survey.id}/history`}>{t('surveys.next.history.open')}</Link></Button>}
          </>
        }
      />

      {needsCompany && (
        <p
          role="status"
          data-testid="detail-needs-company"
          className="m-0 rounded-lg border border-line-light bg-surface-panel px-4 py-3 text-sm text-fg-secondary"
        >
          <b className="font-semibold text-fg-primary">{t('companyContext.chooseACompany')}</b>{' '}
          {t('companyContext.chooseACompanyDescription')}
        </p>
      )}

      <ContentFallbackNotice
        language={survey.language}
        resolvedLocale={survey.resolvedLocale}
        fallbackFields={survey.fallbackFields}
      />

      {actionError && (
        <Alert variant="destructive" role="alert" className="mb-5">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {/* `-mt-1`: the header's 24px bottom margin collapses with this one, and the artboard puts
          the tiles 20px under the hairline (measured: 217.3 → 237.3). */}
      <section aria-label={copy('readings')} className="-mt-1 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="detail-readings">
        <ReadingTile
          testId="tile-responses"
          label={copy('responses')}
          value={survey.responseCount}
          unit={
            audience === null || rate === null
              ? copy('responsesNoTarget')
              : copy('responsesOf', { target: audience.count, rate })
          }
        >
          {rate !== null && <Meter percent={rate} label={copy('responses')} />}
        </ReadingTile>
        <ReadingTile
          testId="tile-audience"
          label={copy('audience')}
          value={audience?.count ?? null}
          unit={
            targetsWholeCompany(surveyTargets)
              ? copy('audienceCompany')
              : survey.departmentIds.length === 0
                ? copy('audiencePeople')
                : survey.userIds.length > 0
                  ? copy('audienceMixed')
                  : copy(survey.departmentIds.length === 1 ? 'audienceOneDepartment' : 'audienceDepartments', {
                      count: survey.departmentIds.length,
                    })
          }
        >
          {targets.names.length > 0 && <span className="text-sm text-fg-secondary">{targets.names.join(' · ')}</span>}
        </ReadingTile>
        <ReadingTile
          testId="tile-closes"
          label={
            closesIn !== null && closesIn < 0
              ? // A draft or a scheduled survey never opened, so it did not "close": its window
                // simply passed. "CERRÓ" there sat beside a live "Activar" (walkthrough, finding 9).
                survey.status === 'draft' || survey.status === 'scheduled'
                ? copy('closesPassed')
                : copy('closed')
              : copy('closes')
          }
          value={dayMonthIn(survey.endDate, timeZone, locale)}
          unit={closeLine(copy, yearIn(survey.endDate, timeZone), closesIn)}
        >
          {reminders !== null && (
            <span className="text-sm text-fg-secondary">
              {reminders === 0 ? copy('remindersNone') : copy(reminders === 1 ? 'remindersOne' : 'remindersSome', { count: reminders })}
            </span>
          )}
        </ReadingTile>
        <StatusTile
          survey={survey}
          canAuthor={canAuthor}
          pending={pending}
          onTransition={onTransition}
          endPassed={closesIn !== null && closesIn < 0}
          onEditWindow={windowEditable ? () => setEditingWindow(true) : undefined}
        />
      </section>

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Card className="flex min-w-0 flex-col gap-3 px-5 pb-4.5 pt-4" data-testid="detail-questions">
          <PanelHeading
            title={copy('questions')}
            count={survey.questions.length}
            aside={
              <span className="inline-flex flex-wrap items-center gap-2">
                <Chip label={languageLabel(t, survey.resolvedLocale)} />
                {editable && canAuthor ? (
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/surveys/${survey.id}/questions`}>{copy('editQuestions')}</Link>
                  </Button>
                ) : (
                  !editable && <Chip icon={<Lock className="size-3" />} label={copy('readOnly')} />
                )}
              </span>
            }
          />
          {/* `-mt-3` cancels the heading's 12px margin: the line sits the card's 12px gap under it. */}
          <p className="-mt-3 mb-0 text-sm text-fg-secondary">
            {editable
              ? copy('editableLine')
              : survey.responseCount > 0 && survey.isContentEditable
                ? copy('lockedResponses')
                : copy('lockedStatus', { status: copy(`statusAdjective.${survey.status}`) })}
          </p>
          {sections.length === 0 ? (
            <p className="m-0 text-sm text-fg-secondary">{copy('noQuestions')}</p>
          ) : (
            <div className="flex flex-col gap-3.5 pt-1">
              {sections.map((section) => (
                <PreviewSection key={`${section.index}-${section.category}`} category={section.category} index={section.index} count={section.count}>
                  {section.questions.map(({ question, position }) => (
                    <PreviewQuestion key={question.id} question={question} position={position} total={survey.questions.length} />
                  ))}
                </PreviewSection>
              ))}
            </div>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          {distribution !== undefined && (
            <LinkCard
              link={distribution?.publicLink ?? null}
              accessType={distribution?.accessType}
              surveyId={survey.id}
            />
          )}
          <Card className="flex flex-col gap-2.5 px-5 pb-4.5 pt-4" data-testid="detail-sheet">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardHeading title={copy('sheet')} />
              {windowEditable && (
                <Button type="button" variant="outline" size="sm" disabled={pending !== null} onClick={() => setEditingWindow(true)}>
                  <CalendarClock aria-hidden="true" className="size-3.5" />
                  {copy('window.edit')}
                </Button>
              )}
            </div>
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-fg-secondary">{copy('type')}</dt>
              <dd className="m-0">{sentenceCase(typeLabel(t, survey.type), locale)}</dd>
              {/* Day AND time, on the company's clock: the window is an instant to the minute
                  (the lifecycle job opens and closes on it), and the editor beside this writes
                  in the same zone, so what is read here is what was typed there. */}
              <dt className="text-fg-secondary">{opensIn !== null && opensIn > 0 ? copy('opens') : copy('opened')}</dt>
              <dd className="m-0 font-mono tabular-nums" data-testid="sheet-start">{dayTimeIn(survey.startDate, timeZone, locale)}</dd>
              <dt className="text-fg-secondary">{copy('closesRow')}</dt>
              <dd className="m-0 font-mono tabular-nums" data-testid="sheet-end">{dayTimeIn(survey.endDate, timeZone, locale)}</dd>
              <dt className="text-fg-secondary">{copy('window.zoneRow')}</dt>
              <dd className="m-0 break-words">{zoneLabel(timeZone)}</dd>
              <dt className="text-fg-secondary">{copy('language')}</dt>
              <dd className="m-0">{languageLabel(t, survey.language)}</dd>
              <dt className="text-fg-secondary">{copy('floor')}</dt>
              <dd className="m-0">{copy('floorValue', { floor: ANONYMITY_FLOOR })}</dd>
              {/* No "Plantilla" row: `SurveyDetail` carries no template id or name
                  (SurveyDtos.cs:83-111), and a name matched by title would be a guess. */}
            </dl>
          </Card>
          <Card className="flex flex-col gap-2.5 px-5 pb-4.5 pt-4" data-testid="detail-departments">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardHeading title={copy('departments')} />
              {audienceOffered && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending !== null || audienceFrozen}
                  aria-describedby={audienceFrozen ? 'audience-frozen-reason' : undefined}
                  onClick={() => setEditingAudience(true)}
                >
                  <Users aria-hidden="true" className="size-3.5" />
                  {copy('audienceEdit.action')}
                </Button>
              )}
            </div>
            {audienceOffered && audienceFrozen && (
              <p id="audience-frozen-reason" className="m-0 text-sm text-fg-secondary" data-testid="audience-frozen">
                {copy('audienceEdit.endedReason')}
              </p>
            )}
            {targetsWholeCompany(surveyTargets) ? (
              <p className="m-0 text-sm">{copy('wholeCompany')}</p>
            ) : survey.departmentIds.length === 0 ? (
              // Aimed at people and no department. This card said "Toda la empresa", which
              // is the rule for a survey that targets NEITHER, under a heading that is
              // about departments — so the one card naming the audience named the wrong one.
              <p className="m-0 text-sm">{copy('departmentsNoneButPeople', { count: survey.userIds.length })}</p>
            ) : targets.names.length === 0 ? (
              <p className="m-0 text-sm text-fg-secondary">{copy('departmentsUnlisted', { count: survey.departmentIds.length })}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
                {targets.names.map((name) => (
                  // `mb-0`: index.css's 4px <li> margin made the artboard's 24px rows 28px.
                  <li key={name} className="mb-0 flex items-center justify-between gap-2">
                    <span>{name}</span>
                    {/* No count per group, ever, on this page: the floor applies to what a
                        group answered, and the only honest reading mid-run is none. */}
                    <span className="font-mono text-fg-secondary">{copy('responsesDash')}</span>
                  </li>
                ))}
              </ul>
            )}
            {/* Targeted BOTH ways: the list above is only half the audience, and a card
                that stops at the departments understates who gets the survey. */}
            {survey.departmentIds.length > 0 && survey.userIds.length > 0 && (
              <p className="m-0 text-sm text-fg-secondary">
                {copy('departmentsAlsoPeople', { count: survey.userIds.length })}
              </p>
            )}
            <p className="m-0 text-xs leading-normal text-fg-secondary">{copy('departmentsNote', { floor: ANONYMITY_FLOOR })}</p>
          </Card>
          <Note icon={<ShieldCheck aria-hidden="true" />} className="border border-line-light">
            {copy('privacyNote', { floor: ANONYMITY_FLOOR })}
          </Note>
        </div>
      </div>

      {windowEditable && onSaveWindow && (
        <SurveyWindowDialog
          survey={survey}
          timeZone={timeZone}
          open={editingWindow}
          onOpenChange={setEditingWindow}
          onSave={onSaveWindow}
          now={() => now}
        />
      )}
      {audienceOffered && !audienceFrozen && onSaveAudience && (
        <EditAudienceDialog
          survey={survey}
          departments={departments}
          users={users}
          hasPublicLink={Boolean(distribution?.publicLink)}
          open={editingAudience}
          onOpenChange={setEditingAudience}
          onSave={onSaveAudience}
        />
      )}
      {deletable && onDelete && (
        <DeleteSurveyDialog status={survey.status} open={deleting} onOpenChange={setDeleting} onDelete={onDelete} />
      )}
    </div>
  )
}

function closeLine(copy: (key: string, vars?: Record<string, string | number>) => string, year: string, days: number | null): string {
  if (days === null) return year
  if (days === 0) return copy('closesToday', { year })
  if (days === 1) return copy('closesTomorrow', { year })
  if (days > 1) return copy('closesIn', { year, days })
  if (days === -1) return copy('closedAgoOne', { year })
  return copy('closedAgo', { year, days: Math.abs(days) })
}

/** `SurveyStatuses.All` — the statuses this screen has a verb and a meaning for. */
const KNOWN_STATUSES: readonly string[] = ['draft', 'scheduled', 'active', 'closed', 'archived']

function StatusTile({
  survey,
  canAuthor,
  pending,
  onTransition,
  endPassed,
  onEditWindow,
}: {
  survey: SurveyDetail
  canAuthor: boolean
  pending: string | null
  onTransition: (status: string) => void
  /** The survey's end date is behind today. */
  endPassed: boolean
  /** Opens the date editor; absent where the window cannot be moved. */
  onEditWindow?: () => void
}) {
  const { t } = useTranslation()
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.detail.${key}`, vars)
  // Opening a survey whose window has already ended would take responses for a period that
  // is over; the server's state machine allows it, so the screen is the guard.
  const opensIntoThePast = (status: string) => endPassed && (status === 'active' || status === 'scheduled')
  const verbOf = (status: string) => (KNOWN_STATUSES.includes(status) ? copy(`verb.${status}`) : statusLabel(t, status))
  const tone = survey.status === 'active' ? 'good' : survey.status === 'draft' || survey.status === 'scheduled' ? 'accent' : 'neutral'
  // Closing is the one transition on this tile that cannot be taken back: the server allows
  // `closed → archived` and nothing else out of it, so a mis-click ends the measurement for
  // good and loses whatever half-finished answers were in flight. It fired on a single press
  // until now, while the microclimate detail — a smaller thing to lose — has always asked.
  // The 2026-10-06 walkthrough closed two seeded surveys this way and could not undo it.
  const [confirmClose, setConfirmClose] = useState(false)
  return (
    <div data-testid="tile-status" className="flex min-w-0 flex-col gap-2 rounded-lg border border-line-default bg-surface-card px-4 py-3.5 shadow-xs">
      <span className="text-2xs font-bold uppercase leading-normal tracking-wider text-fg-label">{copy('status')}</span>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={tone} label={statusLabel(t, survey.status)} />
        <span className="text-sm text-fg-secondary">{copy(`meaning.${survey.status}`)}</span>
      </div>
      {canAuthor && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-light pt-1.5">
          <span className="text-sm text-fg-secondary">
            {survey.allowedStatusTransitions.length === 0 ? copy('noneAllowed') : copy('allowed')}
          </span>
          <span className="flex flex-wrap gap-2">
            {survey.allowedStatusTransitions.map((status) => (
              <Button
                key={status}
                type="button"
                size="sm"
                variant="outline"
                disabled={pending !== null || opensIntoThePast(status)}
                onClick={() => (status === 'closed' ? setConfirmClose(true) : onTransition(status))}
              >
                {status === 'closed' && <Lock aria-hidden="true" className="size-3.5" />}
                {verbOf(status)}
              </Button>
            ))}
          </span>
        </div>
      )}
      {/* What each verb does, in the product's words: "Programar" and "Activar" sit side by
          side at equal weight and differ in consequence (walkthrough, finding 9). */}
      {canAuthor && survey.allowedStatusTransitions.some((status) => KNOWN_STATUSES.includes(status)) && (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs text-fg-label" data-testid="status-consequences">
          {survey.allowedStatusTransitions
            .filter((status) => KNOWN_STATUSES.includes(status))
            .map((status) => (
              <li key={status}>{copy('consequence', { verb: verbOf(status), meaning: copy(`meaning.${status}`) })}</li>
            ))}
        </ul>
      )}
      {canAuthor && survey.allowedStatusTransitions.some(opensIntoThePast) && (
        <div className="flex flex-col items-start gap-2" data-testid="status-end-passed-block">
          <p role="note" className="m-0 text-sm text-accent-amber-ink" data-testid="status-end-passed">
            {copy('endPassedWarning')}
          </p>
          {/* The sentence above has always said "cambia primero las fechas"; this is where. A
              duplicated survey keeps its source's past window, and this is how it gets run. */}
          {onEditWindow && (
            <Button type="button" size="sm" variant="outline" disabled={pending !== null} onClick={onEditWindow}>
              <CalendarClock aria-hidden="true" className="size-3.5" />
              {copy('window.edit')}
            </Button>
          )}
        </div>
      )}
      <ConfirmationDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={copy('closeConfirmTitle')}
        description={copy('closeConfirmBody')}
        confirmText={copy('verb.closed')}
        cancelText={t('common.cancel')}
        variant="destructive"
        onConfirm={() => {
          onTransition('closed')
          setConfirmClose(false)
        }}
      />
    </div>
  )
}

/**
 * The share surface on the detail page, which used to be a read-only line of text.
 *
 * This is where an administrator actually lands, so it is where they look for the link. It
 * now carries the same panel as Distribución -- link, QR, copy, download -- in `stacked`
 * form, because this card lives in a ~20rem rail where the side-by-side layout would overflow.
 * `noLink` keeps its sentence and offers no "Crear enlace": minting one is a distribution
 * decision and belongs on the page that owns the launch checklist.
 */
function LinkCard({
  link,
  accessType,
  surveyId,
}: {
  link: string | null
  accessType?: string
  surveyId?: string
}) {
  const { t } = useTranslation()
  const copy = (key: string) => t(`surveys.next.detail.${key}`)
  return (
    <Card className="flex flex-col gap-2 px-4 py-3.5" data-testid="detail-link">
      <span className="text-2xs font-bold uppercase leading-normal tracking-wider text-fg-label">{copy('link')}</span>
      {link === null ? (
        <p className="m-0 text-sm text-fg-secondary">{copy('noLink')}</p>
      ) : (
        <SharePanel
          publicLink={link}
          accessType={accessType}
          surveyId={surveyId}
          stacked
        />
      )}
    </Card>
  )
}
