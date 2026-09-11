import { useState, type ReactNode } from 'react'
import { useParams } from 'react-router'
import { Check, FileText, Filter, Lock, Plus, Shield } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { ANONYMITY_FLOOR, KpiTile, isSuppressed } from '../../../../components/charts'
import { PROTECTED_HATCH } from '../../../../components/charts/suppression'
import { Button, EmptyState, LoadingRegion, NetworkError, SkeletonText, Table } from '../../../../components/ui'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { cn } from '../../../../lib/cn'
import type { DemographicField } from '../../api/demographicFields'
import { peoplePerValue } from '../../components/demographicReach'
import { fieldVerdict, usableCuts } from '../super/demographics'
import { CanvasChip, IconBox, Panel } from '../super/parts'
import { FieldForm, FloorRules } from '../super/SuperDemographicFieldsView'
import { mergedRanges } from './adminDemographics'
import { SAMPLE_CATALOGUE } from './sampleCatalogue'
import { useAdminDemographicsModel } from './useAdminDemographicsModel'

const TH =
  'border-b border-line-default bg-transparent px-1.5 pb-2 pt-1 first:pl-3 last:pr-3 text-2xs font-bold uppercase tracking-label whitespace-nowrap text-fg-tertiary'
/**
 * The board's row is a grid with a 12px gap inside 12px of padding; a cell's 6px either side,
 * 12px at the row's two ends, is the same rhythm, so the column widths below are the board's.
 */
const TD = 'px-1.5 py-3 align-middle first:pl-3 last:pr-3'

/** One catalogue line, whether the tenant's own field or the proposal's. */
interface Row {
  key: string
  label: string
  field: string
  type: string
  values: readonly string[]
  required: boolean
  isActive: boolean
  /** The tenant's field, to edit; `null` on a sample row. */
  real: DemographicField | null
}

type Editing = { kind: 'new'; seed: boolean } | { kind: 'field'; field: DemographicField } | null

/**
 * `/admin/companies/:companyId/demographic-fields` for a company administrator — the canvas's
 * *Campos demográficos* (`DemographicFields` artboard, 10 Sep). `DemographicsNextPage`
 * dispatches here for every role but the super administrator.
 *
 * The triage asked for the fields with their options, one primary "Nuevo campo", and the
 * note that a segment under the floor is withheld. A tenant with no field (Grupo Meridiano
 * S.A. today) sees the artboard's proposal — five fields under «Propuesta · datos de
 * ejemplo» and the amber sample chip (`sampleCatalogue.ts`) — with «Personas por valor» and
 * every verdict computed from its REAL active people. Same two reads and the same
 * create/update bodies as the old page: the form is the super administrator's `FieldForm`.
 */
export default function AdminDemographicFieldsView() {
  const { t, locale } = useTranslation()
  const { companyId } = useParams<{ companyId: string }>()
  const capabilities = useViewerCapabilities()
  const allowed = capabilities.canManageOrg
  const state = useAdminDemographicsModel(companyId, allowed)
  const [editing, setEditing] = useState<Editing>(null)
  const company = state.companyName ?? t('navigation.companyAdministration')
  const isSample = state.status === 'ready' && state.fields.length === 0

  const rows: Row[] = isSample
    ? SAMPLE_CATALOGUE.map((sample) => ({
        key: sample.field,
        label: t(`demographicFields.next.sample.${sample.labelKey}`),
        field: sample.field,
        type: sample.type,
        values: sample.valueKeys.map((value) => t(`demographicFields.next.sample.${value}`)),
        required: sample.required,
        isActive: sample.isActive,
        real: null,
      }))
    : [...state.fields]
        .sort((a, b) => a.order - b.order)
        .map((field) => ({
          key: field.id,
          label: field.label ?? field.field,
          field: field.field,
          type: field.type,
          values: [...(field.options ?? [])].sort((a, b) => a.order - b.order).map((option) => option.label ?? option.value),
          required: field.required,
          isActive: field.isActive,
          real: field,
        }))

  const active = state.fields.filter((field) => field.isActive).length
  const usable = state.people === undefined ? null : usableCuts(state.fields, state.people, ANONYMITY_FLOOR)

  const header = (
    <div className="-mb-6">
      <PageTopBar
        eyebrow={state.companyName ?? t('navigation.companyAdministration')}
        title={t('navigation.demographicFields')}
        description={t('demographicFields.next.description', { floor: ANONYMITY_FLOOR })}
        breadcrumbs={[
          { label: t('navigation.companyAdministration'), href: `/admin/companies/${companyId}` },
          { label: t('navigation.demographicFields') },
        ]}
        actions={
          allowed ? (
            <Button type="button" variant="primary" onClick={() => setEditing(editing ? null : { kind: 'new', seed: false })}>
              <Plus aria-hidden="true" />
              {t('demographicFields.next.newField')}
            </Button>
          ) : undefined
        }
      />
    </div>
  )

  if (!allowed) {
    return (
      <div className="flex flex-col gap-section">
        {header}
        <EmptyState title={t('demographicFields.next.forbidden')} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-section">
      {header}

      {editing && companyId && state.status === 'ready' && (
        <FieldForm
          key={editing.kind === 'field' ? editing.field.id : `new-${String(editing.seed)}`}
          companyId={companyId}
          field={editing.kind === 'field' ? editing.field : null}
          people={state.people}
          nextOrder={state.fields.length + 1}
          seedExample={editing.kind === 'new' && editing.seed}
          onDone={() => {
            setEditing(null)
            state.reload()
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {state.status === 'error' ? (
        <NetworkError
          title={t('demographicFields.next.loadFailed')}
          description={state.error ?? undefined}
          onRetry={state.reload}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={state.status !== 'ready'} label={t('common.loading')}>
          {state.status !== 'ready' ? (
            <SkeletonText lines={6} />
          ) : (
            <div className="flex flex-col gap-section">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <KpiTile
                  label={t('demographicFields.next.tiles.fields')}
                  value={state.fields.length}
                  unit={t('demographicFields.next.tiles.fieldsUnit')}
                  locale={locale}
                  sub={
                    <span>
                      {state.fields.length === 0
                        ? t('demographicFields.next.tiles.fieldsNone')
                        : t('demographicFields.next.tiles.fieldsSome', { active, inactive: state.fields.length - active })}
                    </span>
                  }
                />
                <KpiTile
                  label={t('demographicFields.next.tiles.people')}
                  value={state.people ?? null}
                  unit={t('demographicFields.next.tiles.peopleUnit')}
                  locale={locale}
                  sub={
                    <span>
                      {state.people === undefined ? t('demographicFields.next.tiles.peopleUnavailable') : t('demographicFields.next.tiles.peopleSub')}
                    </span>
                  }
                />
                {usable === null || usable === 0 ? (
                  <KpiTile
                    label={t('demographicFields.next.tiles.cut')}
                    value={state.departments}
                    unit={t('demographicFields.next.tiles.cutUnitDepartments')}
                    locale={locale}
                    sub={<span>{t('demographicFields.next.tiles.cutSubDepartments')}</span>}
                  />
                ) : (
                  <KpiTile
                    label={t('demographicFields.next.tiles.cut')}
                    value={usable}
                    unit={t('demographicFields.next.tiles.cutUnitUsable')}
                    locale={locale}
                    sub={<span>{t('demographicFields.next.tiles.cutSubUsable', { floor: ANONYMITY_FLOOR })}</span>}
                  />
                )}
              </div>

              <div
                data-slot="floor-band"
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-surface-icon-box px-4 py-3 text-sm leading-normal text-fg-secondary"
              >
                <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-card [&_svg]:size-4">
                  <Shield />
                </span>
                <p className="m-0 min-w-0 flex-1">
                  <b className="font-semibold text-fg-primary">{t('demographicFields.next.floor.lead', { floor: ANONYMITY_FLOOR })}</b>{' '}
                  {t('demographicFields.next.floor.text')}
                </p>
                <span className="inline-flex items-center gap-2 text-xs text-fg-tertiary">
                  <HatchSwatch />
                  {t('demographicFields.next.floor.legend', { floor: ANONYMITY_FLOOR })}
                </span>
              </div>

              <Catalogue
                rows={rows}
                isSample={isSample}
                company={company}
                people={state.people}
                onEdit={(row) => setEditing(row.real ? { kind: 'field', field: row.real } : { kind: 'new', seed: true })}
              />

              <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
                <FloorRules />
                <FieldTypes />
              </div>
            </div>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}

function Catalogue({
  rows,
  isSample,
  company,
  people,
  onEdit,
}: {
  rows: readonly Row[]
  isSample: boolean
  company: string
  people: number | undefined
  onEdit: (row: Row) => void
}) {
  const { t } = useTranslation()
  return (
    <section
      aria-labelledby="demographics-catalogue"
      data-sample={isSample ? 'true' : undefined}
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-xl bg-surface-card',
        isSample ? 'border border-dashed border-line-default' : 'border border-line-default shadow-sm',
      )}
    >
      <div className="flex flex-col gap-1.5 px-4 pt-4 pb-3">
        {isSample && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="m-0 text-2xs font-bold uppercase tracking-label text-fg-tertiary">{t('demographicFields.next.catalogue.eyebrowSample')}</p>
            <CanvasChip tone="warning" label={t('dashboard.next.sampleChip')} />
          </div>
        )}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="flex items-baseline gap-2.5">
            <h2 id="demographics-catalogue" className="m-0 text-2xl">
              {isSample ? t('demographicFields.next.catalogue.headingSample') : t('demographicFields.next.catalogue.heading')}
            </h2>
            <span className="font-mono text-xs tabular-nums text-fg-tertiary">{rows.length}</span>
          </div>
          <span className="text-xs text-fg-tertiary">
            {isSample ? t('demographicFields.next.catalogue.metaSample', { company }) : t('demographicFields.next.catalogue.metaReal')}
          </span>
        </div>
        {isSample && people !== undefined && (
          <p className="m-0 max-w-[110ch] text-sm leading-normal text-fg-secondary">
            {t('demographicFields.next.catalogue.textSample', { company, people })}
          </p>
        )}
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[60rem] [&_[data-slot=table-container]]:overflow-visible">
          <Table aria-label={isSample ? t('demographicFields.next.catalogue.headingSample') : t('demographicFields.next.catalogue.heading')}>
            <colgroup>
              {/* The board's 1.2fr / 80px / 2.3fr / 138px / 186px / 76px at 1440, each plus its share of the gap. */}
              <col className="w-54" />
              <col className="w-23" />
              <col />
              <col className="w-37.5" />
              <col className="w-49.5" />
              <col className="w-23.5" />
            </colgroup>
            <thead>
              <tr>
                <th className={TH}>{t('demographicFields.next.catalogue.colField')}</th>
                <th className={TH}>{t('demographicFields.next.catalogue.colType')}</th>
                <th className={TH}>{t('demographicFields.next.catalogue.colValues')}</th>
                <th className={TH}>{t('demographicFields.next.catalogue.colPerValue')}</th>
                <th className={TH}>{t('demographicFields.next.catalogue.colCut')}</th>
                <th className={TH}>
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <CatalogueRow key={row.key} row={row} people={people} onEdit={() => onEdit(row)} />
              ))}
            </tbody>
          </Table>
        </div>
      </div>
    </section>
  )
}

const TYPE_KEY: Readonly<Record<string, string>> = {
  select: 'demographicFields.next.catalogue.typeSelect',
  text: 'demographicFields.next.catalogue.typeText',
  number: 'demographicFields.next.catalogue.typeNumber',
  date: 'demographicFields.next.catalogue.typeDate',
}

function CatalogueRow({ row, people, onEdit }: { row: Row; people: number | undefined; onEdit: () => void }) {
  const { t } = useTranslation()
  const isList = row.type === 'select'
  const count = row.values.length
  const perValue = isList && people !== undefined ? peoplePerValue(people, count) : null
  const verdict = fieldVerdict({ type: row.type, options: row.values.map((value, order) => ({ order, value, label: value })) }, people, ANONYMITY_FLOOR)
  const merged = people === undefined || !isList ? null : mergedRanges(people, count, ANONYMITY_FLOOR)

  let cut: { chip: ReactNode; sub: string }
  if (!row.isActive) {
    cut = { chip: <CanvasChip tone="neutral" label={t('demographicFields.next.catalogue.notOffered')} />, sub: t('demographicFields.next.catalogue.notOfferedSub') }
  } else if (verdict === 'usable') {
    cut = {
      chip: <CanvasChip tone="good" icon={<Check className="size-3" />} label={t('demographicFields.next.catalogue.usable')} />,
      sub: t('demographicFields.next.catalogue.usableSub', { floor: ANONYMITY_FLOOR }),
    }
  } else if (verdict === 'narrow') {
    cut = {
      chip: <CanvasChip tone="warning" icon={<Lock className="size-3" />} label={t('demographicFields.next.catalogue.narrow')} />,
      sub: merged
        ? t('demographicFields.next.catalogue.narrowSub', { ranges: merged.ranges, perValue: merged.perValue })
        : t('demographicFields.next.catalogue.narrowSubNone'),
    }
  } else if (verdict === 'not-a-cut') {
    cut = { chip: <CanvasChip tone="neutral" label={t('demographicFields.next.catalogue.notACut')} />, sub: t('demographicFields.next.catalogue.notACutSub') }
  } else {
    cut = { chip: <span className="text-xs text-fg-tertiary">{t('demographicFields.next.catalogue.unknown')}</span>, sub: '' }
  }

  return (
    <tr data-field={row.field}>
      <td className={TD}>
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-fg-primary">{row.label}</span>
            {row.required && <CanvasChip tone="neutral" label={t('demographicFields.next.catalogue.required')} />}
            {!row.isActive && <CanvasChip tone="neutral" label={t('demographicFields.next.catalogue.inactive')} />}
          </span>
          <span className="font-mono text-2xs text-fg-tertiary">{row.field}</span>
        </div>
      </td>
      <td className={TD}>
        <CanvasChip tone="neutral" label={TYPE_KEY[row.type] ? t(TYPE_KEY[row.type]) : row.type} />
      </td>
      <td className={TD}>
        {isList ? (
          <span className="flex flex-wrap gap-1.5">
            {row.values.map((value) => (
              <CanvasChip key={value} tone="neutral" label={value} />
            ))}
          </span>
        ) : (
          <span className="text-sm text-fg-tertiary">{t('demographicFields.next.catalogue.noLimit')}</span>
        )}
      </td>
      <td className={TD}>
        {!isList ? (
          <span className="text-sm text-fg-tertiary">{t('demographicFields.next.catalogue.notCountable')}</span>
        ) : perValue === null ? (
          <span className="text-sm text-fg-tertiary">{t('demographicFields.next.catalogue.unknown')}</span>
        ) : isSuppressed(perValue, ANONYMITY_FLOOR) ? (
          <span className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1.5 text-sm text-fg-secondary">
              <HatchSwatch />
              {t('demographicFields.next.catalogue.belowFloor', { floor: ANONYMITY_FLOOR })}
            </span>
            <span className="text-2xs text-fg-tertiary">{t('demographicFields.next.catalogue.perValueProtectedSub', { values: count })}</span>
          </span>
        ) : (
          <span className="flex flex-col gap-0.5">
            <span data-per-value className="font-mono text-sm tabular-nums text-fg-primary">
              {perValue}
            </span>
            <span className="text-2xs text-fg-tertiary">
              {t('demographicFields.next.catalogue.perValueSub', { people: people ?? 0, values: count })}
            </span>
          </span>
        )}
      </td>
      <td className={TD}>
        <span className="flex flex-col items-start gap-1">
          {cut.chip}
          {cut.sub && <span className="text-2xs leading-snug text-fg-tertiary">{cut.sub}</span>}
        </span>
      </td>
      <td className={cn(TD, 'text-right')}>
        <Button
          type="button"
          variant="outline"
          aria-label={
            row.real
              ? t('demographicFields.next.catalogue.editNamed', { label: row.label })
              : t('demographicFields.next.catalogue.useNamed', { label: row.label })
          }
          onClick={onEdit}
        >
          {t('demographicFields.next.catalogue.edit')}
        </Button>
      </td>
    </tr>
  )
}

/**
 * The board's protected mark: a 14px square of the recessed surface under `PROTECTED_HATCH`, the
 * stripe every protected cell in the product wears (`ResultsClimateGrid`, `ClimateMap`'s key).
 * Decorative and figure-free — the words beside it («menos de 5») say what it means, and no
 * count is ever drawn in or near it.
 */
function HatchSwatch() {
  return (
    <span
      aria-hidden="true"
      data-slot="protected-swatch"
      className={cn('inline-block size-3.5 shrink-0 rounded-sm border border-line-default bg-surface-icon-box', PROTECTED_HATCH)}
    />
  )
}

function FieldTypes() {
  const { t } = useTranslation()
  const items = [
    { key: 'list', icon: <Filter />, lead: t('demographicFields.next.types.listLead'), text: t('demographicFields.next.types.listText') },
    { key: 'other', icon: <FileText />, lead: t('demographicFields.next.types.otherLead'), text: t('demographicFields.next.types.otherText') },
    { key: 'key', icon: <Lock />, lead: t('demographicFields.next.types.keyLead'), text: t('demographicFields.next.types.keyText') },
  ]
  return (
    <Panel
      labelledBy="demographics-types"
      heading={
        <h2 id="demographics-types" className="m-0 text-2xl">
          {t('demographicFields.next.types.heading')}
        </h2>
      }
    >
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {items.map((item) => (
          <li key={item.key} className="m-0 flex items-start gap-2.5">
            <IconBox size="sm">{item.icon}</IconBox>
            <p className="m-0 text-xs text-fg-secondary">
              <b className="font-semibold">{item.lead}</b> {item.text}
            </p>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
