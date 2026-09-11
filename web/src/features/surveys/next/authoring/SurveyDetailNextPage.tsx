import { useState } from 'react'
import { BarChart3, Copy, Lock, Send, ShieldCheck } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { PageTopBar } from '../../../../components/layout'
import { Alert, AlertDescription, Button, Chip, ErrorState, LoadingRegion, SkeletonText } from '../../../../components/ui'
import { ANONYMITY_FLOOR } from '../../../../components/charts'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { useTranslation } from '../../../../i18n'
import ContentFallbackNotice from '../../components/ContentFallbackNotice'
import { canDistribute } from '../../api/surveyInvitationCopy'
import type { SurveyDetail } from '../../api/surveys'
import { languageLabel, statusLabel, typeLabel } from '../../surveyVocabulary'
import { Note, PanelHeading } from '../../../shared-next/parts'
import { PreviewQuestion, PreviewSection } from './QuestionPreview'
import { Card, Meter, ReadingTile } from './parts'
import {
  absoluteLink,
  dayMonth,
  daysFrom,
  dimensionSections,
  fullDay,
  maskedLink,
  remindersSent,
  responseRate,
  targetedDepartments,
  yearOf,
  sentenceCase,
} from './launch'
import { useSurveyDetailModel, type SurveyDetailModel } from './useSurveyDetailModel'

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
  const { state, reload, transition, duplicate, pending, actionError } = useSurveyDetailModel(id)

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
    />
  )
}

export function SurveyDetailView({
  model,
  pending,
  actionError,
  onTransition,
  onDuplicate,
  now = new Date(),
}: {
  model: SurveyDetailModel
  pending: string | null
  actionError: string | null
  onTransition: (status: string) => void
  onDuplicate: () => void
  now?: Date
}) {
  const { t, locale } = useTranslation()
  const caps = useViewerCapabilities()
  const { survey, departments, distribution, invitations } = model
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.detail.${key}`, vars)
  const title = survey.title ?? t('surveys.untitled')
  const rate = responseRate(survey.responseCount, survey.targetAudienceCount)
  const targets = targetedDepartments(survey.departmentIds, departments)
  const closesIn = daysFrom(survey.endDate, now)
  const opensIn = daysFrom(survey.startDate, now)
  const reminders = remindersSent(invitations?.invitations ?? null)
  const sections = dimensionSections(survey.questions)
  const canAuthor = caps.canAuthorSurveys
  const editable = survey.isContentEditable && survey.responseCount === 0

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
          </>
        }
      />

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

      <section aria-label={copy('readings')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ReadingTile
          testId="tile-responses"
          label={copy('responses')}
          value={survey.responseCount}
          unit={
            survey.targetAudienceCount === null || rate === null
              ? copy('responsesNoTarget')
              : copy('responsesOf', { target: survey.targetAudienceCount, rate })
          }
        >
          {rate !== null && <Meter percent={rate} label={copy('responses')} />}
        </ReadingTile>
        <ReadingTile
          testId="tile-audience"
          label={copy('audience')}
          value={survey.targetAudienceCount}
          unit={
            survey.departmentIds.length === 0
              ? copy('audienceCompany')
              : copy(survey.departmentIds.length === 1 ? 'audienceOneDepartment' : 'audienceDepartments', {
                  count: survey.departmentIds.length,
                })
          }
        >
          {targets.names.length > 0 && <span className="text-sm text-fg-secondary">{targets.names.join(' · ')}</span>}
        </ReadingTile>
        <ReadingTile
          testId="tile-closes"
          label={closesIn !== null && closesIn < 0 ? copy('closed') : copy('closes')}
          value={dayMonth(survey.endDate, locale)}
          unit={closeLine(copy, yearOf(survey.endDate), closesIn)}
        >
          {reminders !== null && (
            <span className="text-sm text-fg-secondary">
              {reminders === 0 ? copy('remindersNone') : copy(reminders === 1 ? 'remindersOne' : 'remindersSome', { count: reminders })}
            </span>
          )}
        </ReadingTile>
        <StatusTile survey={survey} canAuthor={canAuthor} pending={pending} onTransition={onTransition} />
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
          <p className="-mt-2 mb-0 text-sm text-fg-secondary">
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
          {distribution !== undefined && <LinkCard link={distribution?.publicLink ?? null} />}
          <Card className="flex flex-col gap-2.5 px-5 pb-4.5 pt-4" data-testid="detail-sheet">
            <PanelHeading title={copy('sheet')} />
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-fg-secondary">{copy('type')}</dt>
              <dd className="m-0">{sentenceCase(typeLabel(t, survey.type), locale)}</dd>
              <dt className="text-fg-secondary">{opensIn !== null && opensIn > 0 ? copy('opens') : copy('opened')}</dt>
              <dd className="m-0 font-mono tabular-nums">{fullDay(survey.startDate, locale)}</dd>
              <dt className="text-fg-secondary">{copy('closesRow')}</dt>
              <dd className="m-0 font-mono tabular-nums">{fullDay(survey.endDate, locale)}</dd>
              <dt className="text-fg-secondary">{copy('language')}</dt>
              <dd className="m-0">{languageLabel(t, survey.language)}</dd>
              <dt className="text-fg-secondary">{copy('floor')}</dt>
              <dd className="m-0">{copy('floorValue', { floor: ANONYMITY_FLOOR })}</dd>
              <dt className="text-fg-secondary">{copy('anonymity')}</dt>
              <dd className="m-0">{survey.settings.anonymous ? copy('anonymous') : copy('identified')}</dd>
            </dl>
          </Card>
          <Card className="flex flex-col gap-2.5 px-5 pb-4.5 pt-4" data-testid="detail-departments">
            <PanelHeading title={copy('departments')} />
            {survey.departmentIds.length === 0 ? (
              <p className="m-0 text-sm">{copy('wholeCompany')}</p>
            ) : targets.names.length === 0 ? (
              <p className="m-0 text-sm text-fg-secondary">{copy('departmentsUnlisted', { count: survey.departmentIds.length })}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
                {targets.names.map((name) => (
                  <li key={name} className="flex items-center justify-between gap-2">
                    <span>{name}</span>
                    {/* No count per group, ever, on this page: the floor applies to what a
                        group answered, and the only honest reading mid-run is none. */}
                    <span className="font-mono text-fg-secondary">{copy('responsesDash')}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="m-0 text-xs text-fg-secondary">{copy('departmentsNote', { floor: ANONYMITY_FLOOR })}</p>
          </Card>
          <Note icon={<ShieldCheck aria-hidden="true" />} className="border border-line-light">
            {copy('privacyNote', { floor: ANONYMITY_FLOOR })}
          </Note>
        </div>
      </div>
    </div>
  )
}

function closeLine(copy: (key: string, vars?: Record<string, string | number>) => string, year: string, days: number | null): string {
  if (days === null) return year
  if (days === 0) return copy('closesToday', { year })
  if (days === 1) return copy('closesTomorrow', { year })
  if (days > 1) return copy('closesIn', { year, days })
  return copy('closedAgo', { year, days: Math.abs(days) })
}

/** `SurveyStatuses.All` — the statuses this screen has a verb and a meaning for. */
const KNOWN_STATUSES: readonly string[] = ['draft', 'scheduled', 'active', 'closed', 'archived']

function StatusTile({
  survey,
  canAuthor,
  pending,
  onTransition,
}: {
  survey: SurveyDetail
  canAuthor: boolean
  pending: string | null
  onTransition: (status: string) => void
}) {
  const { t } = useTranslation()
  const copy = (key: string) => t(`surveys.next.detail.${key}`)
  const tone = survey.status === 'active' ? 'good' : survey.status === 'draft' || survey.status === 'scheduled' ? 'accent' : 'neutral'
  return (
    <div data-testid="tile-status" className="flex min-w-0 flex-col gap-2 rounded-lg border border-line-default bg-surface-card px-4 py-3.5 shadow-xs">
      <span className="text-2xs font-bold uppercase tracking-wider text-fg-label">{copy('status')}</span>
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
                disabled={pending !== null}
                onClick={() => onTransition(status)}
              >
                {status === 'closed' && <Lock aria-hidden="true" className="size-3.5" />}
                {KNOWN_STATUSES.includes(status) ? copy(`verb.${status}`) : statusLabel(t, status)}
              </Button>
            ))}
          </span>
        </div>
      )}
    </div>
  )
}

function LinkCard({ link }: { link: string | null }) {
  const { t } = useTranslation()
  const copy = (key: string) => t(`surveys.next.detail.${key}`)
  const [copied, setCopied] = useState(false)
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return (
    <Card className="flex flex-col gap-2 px-4 py-3.5" data-testid="detail-link">
      <span className="text-2xs font-bold uppercase tracking-wider text-fg-label">{copy('link')}</span>
      {link === null ? (
        <p className="m-0 text-sm text-fg-secondary">{copy('noLink')}</p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div className="flex h-8 min-w-0 flex-1 items-center overflow-hidden text-ellipsis whitespace-nowrap rounded border border-line-default bg-surface-card px-2.5 font-mono text-sm text-fg-primary">
              {maskedLink(link, origin)}
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={copied ? copy('copied') : copy('copyLink')}
              onClick={() => {
                void navigator.clipboard?.writeText(absoluteLink(link, origin)).then(() => setCopied(true))
              }}
            >
              <Copy aria-hidden="true" className="size-icon" />
            </Button>
          </div>
          <span className="text-sm text-fg-secondary">{copy('linkHelp')}</span>
        </>
      )}
    </Card>
  )
}
