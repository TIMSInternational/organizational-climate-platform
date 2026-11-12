import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Plus, Shield, Trash2 } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageHeader } from '../../../../components/layout'
import {
  Button,
  Chip,
  ConfirmationDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Input,
  Label,
  LoadingState,
  Note,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableHead,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../../../components/ui'
import { isApiStatus } from '../../../../api/authFetch'
import { describeApiError } from '../../../../api/describeApiError'
import { useCompanyScope } from '../../../../company-context/useCompanyScope'
import { calendarDayLong } from '../../../../lib/calendarDay'
import { listSurveys, type SurveyListItem } from '../../../surveys/api/surveys'
import { dimensionLabel } from '../../../surveys/dimensionLabel'
import { licensedServiceLabel } from '../../../surveys/surveyVocabulary'
import {
  createBenchmarkGroup,
  deleteBenchmarkGroup,
  getBenchmarkGroupOptions,
  listBenchmarkGroups,
  previewBenchmarkGroup,
  readBenchmarkGroup,
  type BenchmarkGroup,
  type BenchmarkGroupOptions,
  type BenchmarkGroupReading,
} from '../../api/benchmarkGroups'
import CohortDimensionBars from '../../components/CohortDimensionBars'
import { belowSummary, dimensionStanding, printedIndex, signedDelta } from './derive'

/**
 * `/analytics/benchmarks` for a super admin: one company read against a reference group
 * computed from the platform's own clients (ruled 3 Nov 2026; the design approved the same
 * day). It replaces, for TIMS, the hand-entered references, which stay one link away.
 *
 * The page says the three things the old one chose silently -- which survey, which group,
 * how far from the group -- and a group short of companies says so instead of a number.
 *
 * Apple design (11 Nov): `PageHeader` with "Nuevo grupo" as the one primary, the sort as a
 * `SegmentedControl`, bordered cards with no shadow, figures in the sans at tabular figures,
 * the table primitive's sentence-case heads, and every chip neutral — a group being ready or
 * short of companies is not a result area, so it is no longer green or amber.
 */

type Sort = 'gap' | 'survey'
const ANY = '__any'

function day(iso: string | null | undefined, locale: string): string {
  return iso ? calendarDayLong(Date.parse(iso), locale) : ''
}

export default function BenchmarkGroupsPage() {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [params, setParams] = useSearchParams()
  const scope = useCompanyScope()
  const companyId = scope.status === 'ready' ? scope.companyId : undefined

  const [tab, setTab] = useState(params.get('tab') === 'grupos' ? 'groups' : 'compare')
  const [groups, setGroups] = useState<BenchmarkGroup[] | null>(null)
  const [groupsError, setGroupsError] = useState<string | null>(null)
  const [surveys, setSurveys] = useState<SurveyListItem[]>([])
  const [surveyId, setSurveyId] = useState<string | null>(null)
  const [reading, setReading] = useState<BenchmarkGroupReading | null>(null)
  const [readingError, setReadingError] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('gap')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<BenchmarkGroup | null>(null)

  const loadGroups = useCallback(async () => {
    try {
      setGroups(await listBenchmarkGroups(baseUrl))
      setGroupsError(null)
    } catch (err) {
      setGroupsError(describeApiError(err, t))
    }
  }, [baseUrl, t])

  useEffect(() => {
    void loadGroups()
  }, [loadGroups])

  useEffect(() => {
    setSurveyId(null)
    if (!companyId) return
    let cancelled = false
    void listSurveys(baseUrl, { companyId, status: 'closed' }, locale).then(
      (list) => {
        if (cancelled) return
        setSurveys([...list].sort((a, b) => String(b.endDate ?? '').localeCompare(String(a.endDate ?? ''))))
      },
      () => !cancelled && setSurveys([]),
    )
    return () => {
      cancelled = true
    }
  }, [baseUrl, companyId, locale])

  const requestedGroup = params.get('grupo')
  const chosenGroup = groups?.find((group) => group.id === requestedGroup) ?? groups?.[0]
  const chosenGroupId = chosenGroup?.id

  const chooseGroup = (id: string) => {
    const next = new URLSearchParams(params)
    next.set('grupo', id)
    setParams(next, { replace: true })
  }

  useEffect(() => {
    setReading(null)
    setReadingError(null)
    if (!chosenGroupId || !companyId) return
    let cancelled = false
    void readBenchmarkGroup(baseUrl, chosenGroupId, companyId, surveyId, locale).then(
      (result) => !cancelled && setReading(result),
      (err) => !cancelled && setReadingError(describeApiError(err, t)),
    )
    return () => {
      cancelled = true
    }
  }, [baseUrl, chosenGroupId, companyId, surveyId, locale, t])

  return (
    <div>
      <PageHeader
        eyebrow={reading?.companyName ?? undefined}
        title={t('navigation.references')}
        description={t('benchmarks.groups.description')}
        primaryAction={
          tab === 'groups' ? (
            <Button type="button" variant="primary" size="canvas" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              {t('benchmarks.groups.newGroup')}
            </Button>
          ) : undefined
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-5">
        <TabsList className="self-start">
          <TabsTrigger value="compare">{t('benchmarks.groups.tabCompare')}</TabsTrigger>
          <TabsTrigger value="groups">
            {t('benchmarks.groups.tabGroups')}
            {groups && <span className="ml-1.5 text-sm tabular-nums text-fg-tertiary">{groups.length}</span>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="compare" className="flex flex-col gap-5">
          {groupsError ? (
            <ErrorState title={t('benchmarks.groups.loadFailed')} description={groupsError} />
          ) : groups === null ? (
            <LoadingState rows={6} label={t('common.loading')} />
          ) : groups.length === 0 ? (
            <EmptyState
              title={t('benchmarks.groups.noGroupsTitle')}
              description={t('benchmarks.groups.noGroupsBody')}
              action={
                <Button type="button" variant="outline" onClick={() => setTab('groups')}>
                  {t('benchmarks.groups.goToGroups')}
                </Button>
              }
            />
          ) : !companyId ? (
            <EmptyState title={t('benchmarks.groups.pickCompanyTitle')} description={t('benchmarks.groups.pickCompanyBody')} />
          ) : (
            <>
              <div
                data-slot="choices"
                className="flex flex-wrap items-end gap-x-5 gap-y-3 rounded-xl border border-line-panel bg-surface-card px-5 py-4"
              >
                <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:min-w-64">
                  <Label htmlFor="bench-survey">{t('benchmarks.groups.survey')}</Label>
                  <Select value={surveyId ?? reading?.survey?.id ?? undefined} onValueChange={setSurveyId}>
                    <SelectTrigger id="bench-survey" className="w-full sm:w-96">
                      <SelectValue placeholder={t('benchmarks.groups.noSurvey')} />
                    </SelectTrigger>
                    <SelectContent>
                      {surveys.map((survey) => (
                        <SelectItem key={survey.id} value={survey.id}>
                          {t('benchmarks.groups.surveyOption', {
                            survey: survey.title ?? t('surveys.untitled'),
                            date: day(survey.endDate, locale),
                          })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <span className="pb-2 text-sm text-fg-tertiary">{t('benchmarks.groups.against')}</span>
                <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:min-w-64">
                  <Label htmlFor="bench-group">{t('benchmarks.groups.group')}</Label>
                  <Select value={chosenGroupId} onValueChange={chooseGroup}>
                    <SelectTrigger id="bench-group" className="w-full sm:w-104">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {groups.map((group) => (
                        <SelectItem key={group.id} value={group.id}>
                          {t(group.companyCount === 1 ? 'benchmarks.groups.groupOptionOne' : 'benchmarks.groups.groupOption', {
                            group: group.name,
                            count: group.companyCount,
                          })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="m-0 max-w-72 pb-1 text-sm text-fg-tertiary xl:ml-auto">{t('benchmarks.groups.companyHint')}</p>
              </div>

              {readingError ? (
                <ErrorState title={t('benchmarks.groups.readFailed')} description={readingError} />
              ) : reading === null || chosenGroup === undefined ? (
                <LoadingState rows={6} label={t('common.loading')} />
              ) : (
                <ReadingRegion reading={reading} group={chosenGroup} sort={sort} onSort={setSort} t={t} locale={locale} />
              )}

              <Note data-slot="privacy-note" icon={<Shield />}>
                {t('benchmarks.groups.privacy', {
                  service: licensedServiceLabel(t, chosenGroup?.serviceType ?? ''),
                  minimum: chosenGroup?.minimumCompanies ?? 3,
                })}
              </Note>
            </>
          )}
        </TabsContent>

        <TabsContent value="groups" className="flex flex-col gap-3">
          <p className="m-0 text-sm text-fg-secondary">{t('benchmarks.groups.groupsIntro')}</p>
          {groupsError ? (
            <ErrorState title={t('benchmarks.groups.loadFailed')} description={groupsError} />
          ) : groups === null ? (
            <LoadingState rows={4} label={t('common.loading')} />
          ) : groups.length === 0 ? (
            <EmptyState title={t('benchmarks.groups.groupsEmptyTitle')} description={t('benchmarks.groups.groupsEmptyBody')} />
          ) : (
            <GroupsTable groups={groups} onDelete={setDeleting} t={t} locale={locale} />
          )}
          <p className="m-0 text-sm">
            <Link to="/analytics/benchmarks?vista=referencias" className="inline-flex min-h-11 items-center text-accent-blue-ink pointer-fine:min-h-0">
              {t('benchmarks.groups.manualReferences')}
            </Link>
          </p>
        </TabsContent>
      </Tabs>

      <CreateGroupDialog
        open={creating}
        onOpenChange={setCreating}
        baseUrl={baseUrl}
        onCreated={async (group) => {
          setCreating(false)
          await loadGroups()
          chooseGroup(group.id)
        }}
      />

      <ConfirmationDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('benchmarks.groups.deleteTitle', { group: deleting?.name ?? '' })}
        description={t('benchmarks.groups.deleteBody')}
        confirmText={t('benchmarks.groups.deleteConfirm')}
        cancelText={t('common.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!deleting) return
          await deleteBenchmarkGroup(baseUrl, deleting.id)
          setDeleting(null)
          await loadGroups()
        }}
      />
    </div>
  )
}

function ReadingRegion({
  reading,
  group,
  sort,
  onSort,
  t,
  locale,
}: {
  reading: BenchmarkGroupReading
  group: BenchmarkGroup
  sort: Sort
  onSort: (sort: Sort) => void
  t: TranslateFn
  locale: string
}) {
  const company = reading.companyName ?? ''
  const service = licensedServiceLabel(t, group.serviceType)
  const box = (slot: string, title: string, description: string) => (
    <div data-slot={slot} className="rounded-xl border border-line-panel bg-surface-card">
      <EmptyState title={title} description={description} />
    </div>
  )
  switch (reading.kind) {
    case 'ready':
      return <Ready reading={reading} sort={sort} onSort={onSort} t={t} locale={locale} />
    case 'insufficient':
      return box(
        'insufficient',
        t('benchmarks.groups.shortTitle'),
        t(
          reading.companyCount === 0
            ? 'benchmarks.groups.shortBodyNone'
            : reading.companyCount === 1
              ? 'benchmarks.groups.shortBodyOne'
              : 'benchmarks.groups.shortBody',
          { company, count: reading.companyCount, minimum: reading.minimumCompanies },
        ),
      )
    case 'no_survey':
      return box(
        'no-survey',
        t('benchmarks.groups.noSurveyTitle', { company, service }),
        t('benchmarks.groups.noSurveyBody', { service }),
      )
    case 'service_mismatch':
      return box(
        'service-mismatch',
        t('benchmarks.groups.mismatchTitle'),
        t('benchmarks.groups.mismatchBody', {
          survey: reading.survey?.serviceType
            ? licensedServiceLabel(t, reading.survey.serviceType)
            : t('benchmarks.groups.serviceNone'),
          group: service,
        }),
      )
    case 'survey_suppressed':
      return box('survey-suppressed', t('benchmarks.groups.suppressedTitle'), t('benchmarks.groups.suppressedBody'))
    default:
      return null
  }
}

function Ready({
  reading,
  sort,
  onSort,
  t,
  locale,
}: {
  reading: BenchmarkGroupReading
  sort: Sort
  onSort: (sort: Sort) => void
  t: TranslateFn
  locale: string
}) {
  // Every number on screen is a whole index, and every gap is taken between the printed
  // numbers, so "1 punto" is always the difference of the two figures shown (`printedIndex`).
  const mine = printedIndex(reading.companyIndex) ?? 0
  const theirs = printedIndex(reading.groupMedian) ?? 0
  const gap = mine - theirs
  const company = reading.companyName ?? ''
  const headline =
    gap === 0
      ? t('benchmarks.groups.headlineLevel', { company })
      : t(
          Math.abs(gap) === 1
            ? gap > 0
              ? 'benchmarks.groups.headlineAboveOne'
              : 'benchmarks.groups.headlineBelowOne'
            : gap > 0
              ? 'benchmarks.groups.headlineAbove'
              : 'benchmarks.groups.headlineBelow',
          { company, points: Math.abs(gap) },
        )

  const dimensions = useMemo(
    () =>
      reading.dimensions.map((d) => ({
        key: d.key,
        name: dimensionLabel(d.key, t),
        score: printedIndex(d.score),
        median: printedIndex(d.median),
      })),
    [reading.dimensions, t],
  )
  const below = belowSummary(dimensions)
  const standings = dimensions.map((d) => dimensionStanding(d.score, d.median))
  const compared = standings.filter((s) => s.standing !== 'none').length
  const above = standings.filter((s) => s.standing === 'above').length
  const sorted = useMemo(() => {
    if (sort === 'survey') return dimensions
    // Widest gap against first; a dimension with no group median goes last.
    const delta = (d: (typeof dimensions)[number]) => dimensionStanding(d.score, d.median).delta ?? Number.POSITIVE_INFINITY
    return [...dimensions].sort((a, b) => delta(a) - delta(b))
  }, [dimensions, sort])

  return (
    <>
      <section
        data-slot="headline"
        className="grid gap-5 rounded-xl border border-line-panel bg-surface-card px-5 py-4.5 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center"
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="mb-0 text-2xl">{headline}</h2>
          <p className="m-0 text-base text-fg-secondary">
            {!below.compared
              ? t('benchmarks.groups.sublineNoMedians')
              : below.widest
                ? t('benchmarks.groups.subline', {
                    above,
                    compared,
                    dimension: below.widest.name,
                    delta: signedDelta(dimensionStanding(below.widest.score, below.widest.median).delta ?? 0, locale),
                  })
                : t('benchmarks.groups.sublineNoneBelow', { compared })}
          </p>
        </div>
        <Stat label={t('benchmarks.groups.companyIndex')} value={mine} sub={t('benchmarks.next.indexUnit')} />
        <Stat
          label={t('benchmarks.groups.groupMedian')}
          value={theirs}
          sub={t('benchmarks.groups.groupMedianSub', { count: reading.companyCount })}
        />
      </section>

      <CohortDimensionBars
        dimensions={sorted.map((d) => ({ key: d.key, label: d.name, score: d.score, cohortMedian: d.median }))}
        locale={locale}
        heading={
          <span className="flex w-full min-w-0 flex-wrap items-center gap-3 sm:w-auto">
            <span className="min-w-0">{t('benchmarks.next.byDimensionHeading')}</span>
            <SegmentedControl<Sort>
              label={t('benchmarks.groups.sortLabel')}
              value={sort}
              onChange={onSort}
              fullWidth
              // Full width on a phone, where the two labels need the whole card; its own size beside
              // the title from sm up.
              className="font-sans tracking-normal sm:inline-flex sm:w-auto"
              options={[
                { value: 'gap', label: t('benchmarks.groups.sortGap') },
                { value: 'survey', label: t('benchmarks.groups.sortSurvey') },
              ]}
            />
          </span>
        }
        summary={null}
        cohortSize={reading.companyCount}
        surveyTitle={null}
      />
    </>
  )
}

function Stat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="flex flex-col gap-0.5 md:border-l md:border-line-default md:pl-5">
      <span className="text-2xs font-semibold uppercase tracking-tile text-fg-label">{label}</span>
      <span className="text-kpi-hero font-semibold tracking-display tabular-nums text-fg-primary">{value}</span>
      <span className="text-sm text-fg-tertiary">{sub}</span>
    </div>
  )
}


function GroupsTable({
  groups,
  onDelete,
  t,
  locale,
}: {
  groups: BenchmarkGroup[]
  onDelete: (group: BenchmarkGroup) => void
  t: TranslateFn
  locale: string
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-line-panel bg-surface-card">
      <Table className="min-w-200">
        <thead>
          <tr className="border-b border-line-default">
            <TableHead>{t('benchmarks.groups.colGroup')}</TableHead>
            <TableHead>{t('benchmarks.groups.colCriteria')}</TableHead>
            <TableHead>{t('benchmarks.groups.colCompanies')}</TableHead>
            <TableHead>{t('benchmarks.groups.colStatus')}</TableHead>
            <TableHead>{t('benchmarks.groups.colLatest')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('benchmarks.groups.colActions')}</span>
            </TableHead>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            // A member is read against the OTHERS, so a group is ready for any of its own
            // companies only with one more than the minimum.
            const missing = group.minimumCompanies + 1 - group.companyCount
            return (
              <tr key={group.id} data-group-id={group.id} className="border-b border-line-light last:border-b-0">
                <td className="px-3 py-3 text-base font-semibold text-fg-primary">{group.name}</td>
                <td className="px-3 py-3">
                  <span className="flex flex-wrap gap-1.5">
                    <Chip tone="neutral" label={licensedServiceLabel(t, group.serviceType)} />
                    <Chip tone="neutral" label={group.industry ?? t('benchmarks.groups.anyIndustry')} />
                    <Chip tone="neutral" label={group.companySize ?? t('benchmarks.groups.anySize')} />
                    <Chip tone="neutral" label={group.country ?? t('benchmarks.groups.anyCountry')} />
                  </span>
                </td>
                <td className="px-3 py-3 text-base tabular-nums text-fg-primary">
                  {group.companyCount}
                  <span className="ml-1.5 text-sm text-fg-tertiary">
                    {t('benchmarks.groups.minimum', { minimum: group.minimumCompanies })}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <Chip
                    tone="neutral"
                    label={missing <= 0 ? t('benchmarks.groups.statusReady') : t('benchmarks.groups.statusShort', { missing })}
                  />
                </td>
                <td className="px-3 py-3 text-sm text-fg-secondary">
                  {group.latestSurveyOn ? day(group.latestSurveyOn, locale) : '—'}
                </td>
                <td className="px-3 py-3 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('benchmarks.groups.deleteFor', { group: group.name })}
                    onClick={() => onDelete(group)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </div>
  )
}

function CreateGroupDialog({
  open,
  onOpenChange,
  baseUrl,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  baseUrl: string
  onCreated: (group: BenchmarkGroup) => Promise<void>
}) {
  const { t } = useTranslation()
  const [options, setOptions] = useState<BenchmarkGroupOptions | null>(null)
  const [name, setName] = useState('')
  const [industry, setIndustry] = useState(ANY)
  const [companySize, setCompanySize] = useState(ANY)
  const [country, setCountry] = useState(ANY)
  const [serviceType, setServiceType] = useState('general_climate')
  const [preview, setPreview] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || options) return
    void getBenchmarkGroupOptions(baseUrl).then(setOptions, () => setOptions({ industries: [], companySizes: [], countries: [], serviceTypes: [] }))
  }, [open, options, baseUrl])

  const criteria = useMemo(
    () => ({
      industry: industry === ANY ? null : industry,
      companySize: companySize === ANY ? null : companySize,
      country: country === ANY ? null : country,
      serviceType,
    }),
    [industry, companySize, country, serviceType],
  )

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setPreview(null)
    void previewBenchmarkGroup(baseUrl, criteria).then(
      (count) => !cancelled && setPreview(count),
      () => !cancelled && setPreview(null),
    )
    return () => {
      cancelled = true
    }
  }, [open, baseUrl, criteria])

  const reset = () => {
    setName('')
    setIndustry(ANY)
    setCompanySize(ANY)
    setCountry(ANY)
    setServiceType('general_climate')
    setError(null)
  }

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      const group = await createBenchmarkGroup(baseUrl, { name: name.trim(), ...criteria })
      reset()
      await onCreated(group)
    } catch (err) {
      setError(isApiStatus(err, 409) ? t('benchmarks.groups.nameTaken') : describeApiError(err, t))
    } finally {
      setSaving(false)
    }
  }

  const select = (id: string, label: string, value: string, onChange: (v: string) => void, values: string[], any?: string) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {any !== undefined && <SelectItem value={ANY}>{any}</SelectItem>}
          {values.map((v) => (
            <SelectItem key={v} value={v}>
              {id === 'g-instrument' ? licensedServiceLabel(t, v) : v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  const minimum = 3
  const enough = preview !== null && preview > minimum

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent closeLabel={t('common.close')} className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl">{t('benchmarks.groups.newGroupTitle')}</DialogTitle>
          <DialogDescription>{t('benchmarks.groups.newGroupBody')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (name.trim()) void submit()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="g-name">{t('benchmarks.groups.fieldName')}</Label>
            <Input id="g-name" value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {select('g-instrument', t('benchmarks.groups.fieldInstrument'), serviceType, setServiceType, options?.serviceTypes ?? ['general_climate'])}
            {select('g-sector', t('benchmarks.groups.fieldSector'), industry, setIndustry, options?.industries ?? [], t('benchmarks.groups.anyIndustry'))}
            {select('g-size', t('benchmarks.groups.fieldSize'), companySize, setCompanySize, options?.companySizes ?? [], t('benchmarks.groups.anySize'))}
            {select('g-country', t('benchmarks.groups.fieldCountry'), country, setCountry, options?.countries ?? [], t('benchmarks.groups.anyCountry'))}
          </div>
          {/* Blue (info) when the criteria reach the minimum, the quiet grey when they do not:
              green and amber are result areas, and the sentence says which case it is. */}
          <Note data-slot="preview" data-enough={enough || undefined} tone={enough ? 'info' : 'neutral'}>
            {preview === null
              ? t('common.loading')
              : t(preview === 1 ? 'benchmarks.groups.previewOne' : 'benchmarks.groups.preview', { count: preview, minimum })}
          </Note>
          {error && (
            <p role="alert" className="m-0 text-sm text-accent-red-ink">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={saving || name.trim() === ''}>
              {saving ? t('benchmarks.groups.creating') : t('benchmarks.groups.createGroup')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
