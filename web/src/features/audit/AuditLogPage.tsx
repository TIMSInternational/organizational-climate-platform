import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { CATALOGUES } from '../../i18n/locale'
import type { Locale } from '../../i18n/translate'
import { PageTopBar } from '../../components/layout'
import {
  Button,
  Chip,
  EmptyState,
  NetworkError,
  SelectField,
  SkeletonText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextField,
} from '../../components/ui'
import { ApiError } from '../../api/authFetch'
import { useCompanyScope } from '../../company-context'
import { useCompanyName } from '../../company-context/useCompanyName'
import { TH_CLASS } from '../shared-next/parts'
import { getCompanySettings } from '../org-structure/api/companySettings'
import { getAuditLogs, type AuditLogPage } from './api'
import {
  auditActionLabel,
  formatAuditInstant,
  knownAuditActions,
  safeTimeZone,
  zonedDayBoundary,
} from './auditActions'

const PAGE_SIZE = 50

/** Radix `Select` refuses an empty value, so "every action" is a sentinel that is never sent. */
const ALL_ACTIONS = '__all__'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; page: AuditLogPage }
  | { status: 'forbidden' }
  | { status: 'error' }

/**
 * `/admin/audit` — "Registro de auditoría" (audit gap G21): who did what, to what, when, in the
 * company's own trail. Read-only, paged, filterable by action and by day.
 *
 * `GET /audit/logs` existed since #143 with no screen. A company_admin reads their own tenant
 * (the server ignores any other `companyId` they send); a super_admin reads the company chosen in
 * the header, so one table never mixes two tenants or two time zones. Everyone else is refused by
 * the server and is never offered the row (`navSections.ts`).
 *
 * Every time is in the COMPANY's zone (its settings), not the browser's: an administrator in
 * Costa Rica reading a row with a support engineer elsewhere must be looking at the same clock.
 * Every action is a label (`auditActions.ts`), never the code the API stores.
 */
export default function AuditLogPage() {
  const { t, locale } = useTranslation()
  const scope = useCompanyScope()
  const companyName = useCompanyName()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const companyId = scope.status === 'ready' ? scope.companyId : undefined

  const [action, setAction] = useState(ALL_ACTIONS)
  const [fromDay, setFromDay] = useState('')
  const [toDay, setToDay] = useState('')
  const [page, setPage] = useState(1)
  const [timeZone, setTimeZone] = useState<string | null>(null)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  const actions = useMemo(() => knownAuditActions(CATALOGUES[locale as Locale] ?? CATALOGUES.es, t, locale), [locale, t])

  // The company's zone first: a row's time and a day filter both mean nothing without it.
  useEffect(() => {
    if (!companyId) return
    let live = true
    getCompanySettings(baseUrl, companyId)
      .then((response) => {
        if (live) setTimeZone(safeTimeZone(response.settings.timezone))
      })
      .catch(() => {
        // The trail is still worth reading without the zone; UTC is said on screen.
        if (live) setTimeZone('UTC')
      })
    return () => {
      live = false
    }
  }, [baseUrl, companyId])

  useEffect(() => {
    if (!companyId || timeZone === null) return
    let live = true
    setState({ status: 'loading' })
    getAuditLogs(baseUrl, {
      companyId,
      action: action === ALL_ACTIONS ? undefined : action,
      from: fromDay ? zonedDayBoundary(fromDay, timeZone, false) : undefined,
      to: toDay ? zonedDayBoundary(toDay, timeZone, true) : undefined,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((result) => {
        if (live) setState({ status: 'ready', page: result })
      })
      .catch((error: unknown) => {
        if (!live) return
        setState(error instanceof ApiError && error.status === 403 ? { status: 'forbidden' } : { status: 'error' })
      })
    return () => {
      live = false
    }
  }, [baseUrl, companyId, timeZone, action, fromDay, toDay, page, attempt])

  const header = { eyebrow: companyName ?? undefined, title: t('audit.title'), description: t('audit.description') }

  if (scope.status === 'needs-selection') {
    return (
      <div>
        <PageTopBar {...header} />
        <EmptyState title={t('companyContext.chooseACompany')} description={t('companyContext.chooseACompanyDescription')} />
      </div>
    )
  }
  if (!companyId || state.status === 'forbidden') {
    return (
      <div>
        <PageTopBar {...header} />
        <EmptyState title={t('audit.notAllowedTitle')} description={t('audit.notAllowedBody')} />
      </div>
    )
  }

  const filtered = action !== ALL_ACTIONS || fromDay !== '' || toDay !== ''
  const pages = state.status === 'ready' ? Math.max(1, Math.ceil(state.page.total / PAGE_SIZE)) : 1

  function resetTo<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value)
      setPage(1)
    }
  }

  return (
    <div>
      <PageTopBar {...header} />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
        <SelectField
          label={t('audit.filterAction')}
          value={action}
          onChange={resetTo(setAction)}
          options={[
            { value: ALL_ACTIONS, label: t('audit.filterAllActions') },
            ...actions.map((code) => ({ value: code, label: auditActionLabel(t, code) })),
          ]}
        />
        <TextField label={t('audit.filterFrom')} type="date" value={fromDay} onChange={resetTo(setFromDay)} />
        <TextField label={t('audit.filterTo')} type="date" value={toDay} onChange={resetTo(setToDay)} />
        <Button
          type="button"
          variant="outline"
          disabled={!filtered}
          onClick={() => {
            setAction(ALL_ACTIONS)
            setFromDay('')
            setToDay('')
            setPage(1)
          }}
        >
          {t('audit.clearFilters')}
        </Button>
      </div>

      {timeZone !== null ? (
        <p className="mb-3 mt-0 text-xs text-fg-secondary" data-slot="audit-zone">
          {t('audit.timeZoneNote', { zone: timeZone })}
        </p>
      ) : null}

      {state.status === 'loading' ? (
        <SkeletonText lines={8} />
      ) : state.status === 'error' ? (
        <NetworkError
          title={t('audit.loadFailed')}
          onRetry={() => setAttempt((n) => n + 1)}
          retryText={t('common.retry')}
        />
      ) : state.page.items.length === 0 ? (
        <EmptyState title={filtered ? t('audit.emptyFiltered') : t('audit.empty')} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-line-light">
            <Table className="text-sm">
              <TableHeader className="bg-surface-icon-box">
                <TableRow>
                  <TableHead scope="col" className={TH_CLASS}>{t('audit.colWhen')}</TableHead>
                  <TableHead scope="col" className={TH_CLASS}>{t('audit.colActor')}</TableHead>
                  <TableHead scope="col" className={TH_CLASS}>{t('audit.colAction')}</TableHead>
                  <TableHead scope="col" className={TH_CLASS}>{t('audit.colTarget')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.page.items.map((item) => (
                  <TableRow key={item.id} data-audit-id={item.id}>
                    <TableCell className="whitespace-nowrap px-3 py-2 tabular-nums">
                      {formatAuditInstant(item.timestamp, locale, timeZone ?? 'UTC')}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      {item.userName === null && item.userId === null ? (
                        <span className="text-fg-secondary">{t('audit.actorSystem')}</span>
                      ) : item.userName === null ? (
                        <span className="text-fg-secondary">{t('audit.actorUnknown')}</span>
                      ) : (
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{item.userName}</span>
                          {item.userEmail ? (
                            <span className="truncate font-mono text-xs text-fg-secondary">{item.userEmail}</span>
                          ) : null}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <span>{auditActionLabel(t, item.action)}</span>
                        {item.success ? null : <Chip tone="critical" label={t('audit.failed')} />}
                      </span>
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      {item.resourceId ? (
                        <span className="break-all font-mono text-xs text-fg-secondary">{item.resourceId}</span>
                      ) : (
                        <span className="text-fg-secondary">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <nav aria-label={t('audit.pagination')} className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-fg-secondary">
              {t('audit.pageOf', { page: state.page.page, pages, total: state.page.total })}
            </span>
            <span className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft aria-hidden="true" />
                {t('audit.previous')}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                {t('audit.next')}
                <ChevronRight aria-hidden="true" />
              </Button>
            </span>
          </nav>
        </>
      )}
    </div>
  )
}
