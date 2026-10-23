import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ChevronDown, ChevronUp, FileClock, History, Lock } from 'lucide-react'
import { PageTopBar } from '../../../components/layout'
import { Button, Chip, ErrorState, LoadingRegion, SkeletonText } from '../../../components/ui'
import { isApiStatus } from '../../../api/authFetch'
import { useTranslation } from '../../../i18n'
import { getCompanySettings } from '../../org-structure/api/companySettings'
import { getSurvey, type SurveyDetail } from '../api/surveys'
import { EmptyRow, Note, Panel, PanelHeading } from '../../shared-next/parts'
import {
  compareSurveyVersions,
  getSurveyHistory,
  HISTORY_LIMIT,
  listSurveyVersions,
  type SurveyAuditEntry,
  type SurveyVersionComparison,
  type SurveyVersionSummary,
} from './api'
import { K, changeRows, entryHeadline, fieldLabel, formatInstant, isKnownTimeZone, reasonLabel, roleName, type ValueContext } from './derive'

/**
 * `/surveys/:id/history` — G17. A survey's change log and its published versions, read-only.
 *
 * Reads `GET /surveys/{id}/history` (who did what, when) and `GET /surveys/{id}/versions`
 * (the content snapshot taken at each publish), and `GET /surveys/{id}/versions/compare` on
 * demand for the field-level difference between a version and the one before it. All three are
 * `CanAdminister`, so the page asks and renders the server's refusal rather than guessing a role.
 *
 * Times are on the company's clock (`settings.timezone`), the browser's only when that cannot
 * be read — and the page prints which.
 *
 * What it never prints, though the payloads carry it: the response count and the
 * "collected responses" flag of a version (response data has no place on an authorship page),
 * and the IP address of an audit entry. There is no restore action: the API has none, and a
 * version is a record of what respondents saw, not a save point.
 */

type Load =
  | { status: 'loading' }
  | { status: 'forbidden' }
  | { status: 'missing' }
  | { status: 'failed' }
  | {
      status: 'ready'
      survey: SurveyDetail
      entries: SurveyAuditEntry[]
      versions: SurveyVersionSummary[]
      timeZone: string
      zoneIsCompany: boolean
    }

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function useSurveyHistoryModel(id: string | undefined) {
  const { locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [state, setState] = useState<Load>({ status: 'loading' })

  const load = useCallback(async () => {
    if (!id) return
    setState({ status: 'loading' })
    try {
      const [survey, history, versions] = await Promise.all([
        getSurvey(baseUrl, id, locale),
        getSurveyHistory(baseUrl, id),
        listSurveyVersions(baseUrl, id, locale),
      ])
      let zone: string | null = null
      try {
        zone = (await getCompanySettings(baseUrl, survey.companyId)).settings?.timezone ?? null
      } catch {
        zone = null
      }
      const zoneIsCompany = isKnownTimeZone(zone)
      setState({
        status: 'ready',
        survey,
        entries: history.entries,
        versions: [...versions.versions].sort((a, b) => b.versionNumber - a.versionNumber),
        timeZone: zoneIsCompany ? (zone as string) : browserTimeZone(),
        zoneIsCompany,
      })
    } catch (error) {
      setState({ status: isApiStatus(error, 403) ? 'forbidden' : isApiStatus(error, 404) ? 'missing' : 'failed' })
    }
  }, [baseUrl, id, locale])

  useEffect(() => {
    void load()
  }, [load])

  return { state, reload: load }
}

export default function SurveyHistoryPage() {
  const { id } = useParams<{ id: string }>()
  const { t, locale } = useTranslation()
  const { state, reload } = useSurveyHistoryModel(id)

  if (state.status === 'loading') {
    return (
      <LoadingRegion loading label={t('common.loading')}>
        <SkeletonText lines={8} />
      </LoadingRegion>
    )
  }
  if (state.status === 'forbidden' || state.status === 'missing') {
    return (
      <ErrorState
        title={t(state.status === 'forbidden' ? `${K}.forbiddenTitle` : `${K}.missingTitle`)}
        description={t(state.status === 'forbidden' ? `${K}.forbiddenBody` : `${K}.missingBody`)}
        action={
          <Button asChild variant="outline">
            <Link to="/surveys">{t(`${K}.backToSurveys`)}</Link>
          </Button>
        }
      />
    )
  }
  if (state.status === 'failed') {
    return (
      <ErrorState
        title={t(`${K}.loadFailed`)}
        action={
          <Button variant="outline" onClick={() => void reload()}>
            {t('common.retry')}
          </Button>
        }
      />
    )
  }

  const { survey, entries, versions, timeZone, zoneIsCompany } = state
  const title = survey.title ?? t('surveys.untitled')
  const ctx: ValueContext = { t, locale, timeZone }

  return (
    <div>
      <PageTopBar
        eyebrow={title}
        title={t(`${K}.title`)}
        description={t(zoneIsCompany ? `${K}.descriptionCompanyZone` : `${K}.descriptionBrowserZone`, { zone: timeZone })}
        breadcrumbs={[
          { label: t('navigation.surveys'), href: '/surveys' },
          { label: title, href: `/surveys/${survey.id}` },
          { label: t(`${K}.crumb`) },
        ]}
        tightBreadcrumb
      />

      <div className="flex flex-col gap-4">
        <Panel aria-labelledby="history-changes" data-testid="history-changes">
          <PanelHeading id="history-changes" title={t(`${K}.changesHeading`)} count={entries.length} />
          {entries.length === 0 ? (
            <EmptyRow icon={<History aria-hidden="true" className="size-4" />} title={t(`${K}.noChanges`)} lines={[]} />
          ) : (
            <ol className="m-0 flex list-none flex-col p-0">
              {entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} ctx={ctx} />
              ))}
            </ol>
          )}
          {entries.length >= HISTORY_LIMIT && (
            <p className="m-0 mt-3 text-xs text-fg-secondary">{t(`${K}.limitReached`, { count: HISTORY_LIMIT })}</p>
          )}
        </Panel>

        <Panel aria-labelledby="history-versions" data-testid="history-versions">
          <PanelHeading id="history-versions" title={t(`${K}.versionsHeading`)} count={versions.length} />
          <p className="-mt-1 mb-3 text-sm text-fg-secondary">{t(`${K}.versionsLead`)}</p>
          {versions.length === 0 ? (
            <EmptyRow icon={<FileClock aria-hidden="true" className="size-4" />} title={t(`${K}.noVersions`)} lines={[t(`${K}.noVersionsBody`)]} />
          ) : (
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {versions.map((version, index) => (
                <VersionRow
                  key={version.id}
                  surveyId={survey.id}
                  version={version}
                  previous={versions[index + 1] ?? null}
                  initiallyOpen={index === 0}
                  ctx={ctx}
                />
              ))}
            </ol>
          )}
        </Panel>

        <Note icon={<Lock aria-hidden="true" className="size-4" />}>{t(`${K}.noRestore`)}</Note>
      </div>
    </div>
  )
}

function EntryRow({ entry, ctx }: { entry: SurveyAuditEntry; ctx: ValueContext }) {
  const { t } = ctx
  const fields = entry.action === 'updated' ? (entry.changes?.fields ?? []) : []
  return (
    <li data-slot="history-entry" className="flex flex-col gap-1.5 border-b border-line-light py-3 first:pt-0 last:border-b-0 last:pb-0 sm:flex-row sm:gap-4">
      <time dateTime={entry.timestamp} className="shrink-0 font-mono text-xs leading-6 text-fg-secondary tabular-nums sm:w-44">
        {formatInstant(entry.timestamp, ctx.timeZone, ctx.locale)}
      </time>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-sm font-semibold text-fg-primary">{entryHeadline(t, entry)}</span>
        <span className="text-xs text-fg-secondary">
          {t(`${K}.by`, { name: entry.userName, role: roleName(t, entry.userRole) })}
        </span>
        {fields.length > 0 && (
          <ul aria-label={t(`${K}.changedFields`)} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {fields.map((path) => (
              <li key={path}>
                <Chip label={fieldLabel(t, path)} />
              </li>
            ))}
          </ul>
        )}
        {entry.action === 'duplicated' && entry.entityId && (
          <Link to={`/surveys/${entry.entityId}`} className="text-xs text-accent-blue-ink underline underline-offset-2">
            {t(`${K}.openCopy`)}
          </Link>
        )}
      </div>
    </li>
  )
}

type Compare = { status: 'idle' } | { status: 'loading' } | { status: 'failed' } | { status: 'ready'; comparison: SurveyVersionComparison }

function VersionRow({
  surveyId,
  version,
  previous,
  initiallyOpen,
  ctx,
}: {
  surveyId: string
  version: SurveyVersionSummary
  previous: SurveyVersionSummary | null
  /** The newest version opens its difference with the one before it; older ones on demand. */
  initiallyOpen: boolean
  ctx: ValueContext
}) {
  const { t, locale } = ctx
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [open, setOpen] = useState(false)
  const [compare, setCompare] = useState<Compare>({ status: 'idle' })
  const diffId = `version-diff-${version.versionNumber}`
  const comparable = previous !== null && version.changes.length > 0
  const previousNumber = previous?.versionNumber ?? null

  const fetchComparison = useCallback(async () => {
    if (previousNumber === null) return
    setCompare({ status: 'loading' })
    try {
      const comparison = await compareSurveyVersions(baseUrl, surveyId, previousNumber, version.versionNumber, locale)
      setCompare({ status: 'ready', comparison })
    } catch {
      setCompare({ status: 'failed' })
    }
  }, [baseUrl, surveyId, previousNumber, version.versionNumber, locale])

  useEffect(() => {
    if (initiallyOpen && comparable) {
      setOpen(true)
      void fetchComparison()
    }
  }, [initiallyOpen, comparable, fetchComparison])

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && compare.status !== 'ready' && compare.status !== 'loading') void fetchComparison()
  }

  const author = version.createdByName ?? t(`${K}.unknownAuthor`)

  return (
    <li data-slot="history-version" className="rounded-md border border-line-light px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{t(`${K}.versionNumber`, { number: version.versionNumber })}</span>
            {version.isCurrent && <Chip tone="accent" label={t(`${K}.current`)} />}
            <Chip label={reasonLabel(t, version.reason)} />
          </span>
          <span className="text-xs text-fg-secondary">
            {t(`${K}.versionMeta`, {
              name: author,
              when: formatInstant(version.createdAt, ctx.timeZone, ctx.locale),
              questions: t(version.questionCount === 1 ? `${K}.questionsOne` : `${K}.questions`, { count: version.questionCount }),
            })}
          </span>
          {previous === null ? (
            <span className="text-xs text-fg-secondary">{t(`${K}.firstVersion`)}</span>
          ) : (
            <span className="text-xs text-fg-secondary">
              {version.changes.length === 0
                ? t(`${K}.sameAsPrevious`, { number: previous.versionNumber })
                : t(version.changes.length === 1 ? `${K}.changesSinceOne` : `${K}.changesSince`, {
                    count: version.changes.length,
                    number: previous.versionNumber,
                  })}
            </span>
          )}
        </div>
        {comparable && (
          <Button type="button" variant="outline" size="sm" aria-expanded={open} aria-controls={diffId} onClick={toggle}>
            {open ? <ChevronUp aria-hidden="true" className="size-3.5" /> : <ChevronDown aria-hidden="true" className="size-3.5" />}
            {open ? t(`${K}.hideChanges`) : t(`${K}.showChanges`)}
          </Button>
        )}
      </div>
      {open && comparable && (
        <div id={diffId} className="mt-3">
          {compare.status === 'loading' || compare.status === 'idle' ? (
            <SkeletonText lines={3} />
          ) : compare.status === 'failed' ? (
            <p role="alert" className="m-0 text-sm text-accent-red-ink">
              {t(`${K}.compareFailed`)}
            </p>
          ) : (
            <DiffTable ctx={ctx} comparison={compare.comparison} />
          )}
        </div>
      )}
    </li>
  )
}

function DiffTable({ ctx, comparison }: { ctx: ValueContext; comparison: SurveyVersionComparison }) {
  const { t } = ctx
  const rows = changeRows(ctx, comparison.from, comparison.to, comparison.changes)
  return (
    <div className="overflow-hidden rounded-md border border-line-light">
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">
          {t(`${K}.diffCaption`, { from: comparison.from.versionNumber, to: comparison.to.versionNumber })}
        </caption>
        <thead className="hidden bg-surface-icon-box sm:table-header-group">
          <tr>
            <th scope="col" className="w-1/4 px-3 py-2 text-left text-2xs font-bold uppercase tracking-wider text-fg-label">
              {t(`${K}.diffField`)}
            </th>
            <th scope="col" className="px-3 py-2 text-left text-2xs font-bold uppercase tracking-wider text-fg-label">
              {t(`${K}.diffBefore`, { number: comparison.from.versionNumber })}
            </th>
            <th scope="col" className="px-3 py-2 text-left text-2xs font-bold uppercase tracking-wider text-fg-label">
              {t(`${K}.diffAfter`, { number: comparison.to.versionNumber })}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.path} data-slot="diff-row" className="flex flex-col border-t border-line-light first:border-t-0 sm:table-row">
              <th scope="row" className="px-3 pt-2 text-left align-top text-xs font-semibold text-fg-primary sm:py-2">
                {row.label}
              </th>
              <td className="break-words px-3 align-top text-fg-secondary sm:py-2">
                <span className="mr-1 text-2xs font-bold uppercase tracking-wider text-fg-label sm:hidden">{t(`${K}.diffBeforeShort`)}</span>
                {row.before === null ? <em className="text-fg-tertiary">{t(`${K}.absent`)}</em> : <span className="line-through decoration-fg-tertiary">{row.before}</span>}
              </td>
              <td className="break-words px-3 pb-2 align-top text-fg-primary sm:py-2">
                <span className="mr-1 text-2xs font-bold uppercase tracking-wider text-fg-label sm:hidden">{t(`${K}.diffAfterShort`)}</span>
                {row.after === null ? <em className="text-fg-tertiary">{t(`${K}.absent`)}</em> : row.after}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
