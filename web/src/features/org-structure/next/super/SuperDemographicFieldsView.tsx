import { useId, useState, type KeyboardEvent } from 'react'
import { useParams } from 'react-router'
import { AlertCircle, AlertTriangle, Check, Columns2, EyeOff, Filter, Plus, Shield, X } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { ANONYMITY_FLOOR, KpiTile } from '../../../../components/charts'
import { Alert, AlertDescription, Button, Input, LoadingRegion, NetworkError, SkeletonText, Switch } from '../../../../components/ui'
import { MonoReadings } from '../../../dashboard/components/dashboardGrammar'
import { createDemographicField, updateDemographicField, type DemographicField } from '../../api/demographicFields'
import { fieldVerdict, isUsableCut, keyFromLabel, meanPerValue, tippingPoint, usableCuts } from './demographics'
import { CanvasChip, CanvasSelect, EmptyNote, Field, IconBox, Panel } from './parts'
import { useSuperDemographicsModel } from './useSuperDemographicsModel'

const TYPES = ['select', 'text', 'number', 'date'] as const
const TYPE_KEY: Readonly<Record<string, string>> = {
  select: 'superadmin.next.demographics.form.typeSelect',
  text: 'superadmin.next.demographics.form.typeText',
  number: 'superadmin.next.demographics.form.typeNumber',
  date: 'superadmin.next.demographics.form.typeDate',
}

/** One decimal, as the canvas prints a mean ("10,5"); the locale writes the comma. */
function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * `/admin/companies/:companyId/demographic-fields` for a super administrator — the
 * canvas's *Campos demográficos (tenant abierto)* (`SuperDemographicFields` artboard).
 * `DemographicFieldsPage` dispatches here for this role and keeps drawing the company
 * administrator's page otherwise.
 *
 * The catalogue with its options and active/inactive chips, and the form for a new field
 * (or an existing one) that states the floor-of-5 verdict BEFORE the field exists: a list
 * of fixed values over this tenant's active people either clears the floor on average or
 * it cannot be offered as a cut, and the screen says which, with the number of values at
 * which it would stop. Same two endpoints and the same create/update bodies as the old page.
 */
export default function SuperDemographicFieldsView() {
  const { t, locale } = useTranslation()
  const { companyId } = useParams<{ companyId: string }>()
  const state = useSuperDemographicsModel(companyId)
  const [editing, setEditing] = useState<DemographicField | null>(null)
  const companyName = state.company?.name ?? null
  const activeCount = state.fields.filter((field) => field.isActive).length
  const usable = state.people === undefined ? null : usableCuts(state.fields, state.people, ANONYMITY_FLOOR)

  const breadcrumbs = [
    { label: t('navigation.companies'), href: '/admin/companies' },
    ...(companyName ? [{ label: companyName, href: `/admin/companies/${companyId}` }] : []),
    { label: t('navigation.demographicFields') },
  ]

  return (
    <div className="flex flex-col gap-section">
      <div className="-mb-6">
        <PageTopBar
          eyebrow={companyName ?? t('navigation.systemAdministration')}
          title={t('navigation.demographicFields')}
          description={t('superadmin.next.demographics.description', { floor: ANONYMITY_FLOOR })}
          breadcrumbs={breadcrumbs}
        />
      </div>

      {state.status === 'error' ? (
        <NetworkError
          title={t('superadmin.next.demographics.loadFailed')}
          description={state.error ?? undefined}
          onRetry={state.reload}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={state.status === 'loading'} label={t('common.loading')}>
          {state.status === 'loading' ? (
            <SkeletonText lines={6} />
          ) : (
            <div className="flex flex-col gap-section">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <KpiTile
                 
                  label={t('superadmin.next.demographics.tiles.fields')}
                  value={state.fields.length}
                  unit={t('superadmin.next.demographics.tiles.fieldsUnit')}
                  locale={locale}
                  sub={
                    <span>
                      {state.fields.length === 0
                        ? t('superadmin.next.demographics.tiles.fieldsNone')
                        : t('superadmin.next.demographics.tiles.fieldsSome', {
                            active: activeCount,
                            inactive: state.fields.length - activeCount,
                          })}
                    </span>
                  }
                />
                <KpiTile
                 
                  label={t('superadmin.next.demographics.tiles.people')}
                  value={state.people ?? null}
                  unit={t('superadmin.next.demographics.tiles.peopleUnit')}
                  locale={locale}
                  sub={<span>{t('superadmin.next.demographics.tiles.peopleSub')}</span>}
                />
                <KpiTile
                 
                  label={t('superadmin.next.demographics.tiles.usable')}
                  value={usable}
                  unit={t('superadmin.next.demographics.tiles.usableUnit', { count: state.fields.length })}
                  locale={locale}
                  sub={<span>{t('superadmin.next.demographics.tiles.usableSub', { floor: ANONYMITY_FLOOR })}</span>}
                />
              </div>

              <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
                <div className="min-w-0 xl:col-span-7">
                  {companyId && (
                    <FieldForm
                      key={editing?.id ?? 'new'}
                      companyId={companyId}
                      field={editing}
                      people={state.people}
                      nextOrder={state.fields.length + 1}
                      seedExample={state.fields.length === 0}
                      onDone={() => {
                        setEditing(null)
                        state.reload()
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  )}
                </div>
                <div className="flex min-w-0 flex-col gap-4 xl:col-span-5">
                  <Catalogue
                    fields={state.fields}
                    people={state.people}
                    activeDepartments={state.activeDepartments}
                    onEdit={setEditing}
                  />
                  <FloorRules />
                </div>
              </div>
            </div>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}

interface ValueDraft {
  /** The stable value an existing option already has; absent for a new one. */
  value?: string
  text: string
}

/** The canvas's first field's bands, in order. */
const STARTER_VALUES = [
  'superadmin.next.demographics.starter.under1',
  'superadmin.next.demographics.starter.oneToThree',
  'superadmin.next.demographics.starter.threeToFive',
  'superadmin.next.demographics.starter.overFive',
] as const

function FieldForm({
  companyId,
  field,
  people,
  nextOrder,
  seedExample = false,
  onDone,
  onCancel,
}: {
  companyId: string
  field: DemographicField | null
  people: number | undefined
  nextOrder: number
  /**
   * An empty catalogue opens the form on the canvas's first field — tenure, four bands — so the
   * verdict against the floor is on screen before anything is typed. Nothing is created until
   * "Crear campo"; every value can be edited or removed.
   */
  seedExample?: boolean
  onDone: () => void
  onCancel: () => void
}) {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const editing = field !== null
  const seed = !editing && seedExample
  const [label, setLabel] = useState(field?.label ?? (seed ? t('superadmin.next.demographics.starter.label') : ''))
  const [key, setKey] = useState(field?.field ?? (seed ? t('superadmin.next.demographics.starter.key') : ''))
  const [keyTouched, setKeyTouched] = useState(editing)
  const [type, setType] = useState(field?.type ?? 'select')
  const [order, setOrder] = useState(String(field?.order ?? nextOrder))
  const [values, setValues] = useState<ValueDraft[]>(
    seed
      ? STARTER_VALUES.map((valueKey) => ({ text: t(valueKey) }))
      : [...(field?.options ?? [])]
      .sort((a, b) => a.order - b.order)
      .map((option) => ({ value: option.value, text: option.label ?? option.value })),
  )
  const [adding, setAdding] = useState(false)
  const [draftValue, setDraftValue] = useState('')
  const [required, setRequired] = useState(field?.required ?? false)
  const [isActive, setIsActive] = useState(field?.isActive ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = { label: useId(), key: useId(), type: useId(), order: useId(), value: useId(), required: useId(), active: useId() }

  const isList = type === 'select'
  const count = values.length
  const mean = people === undefined ? null : meanPerValue(people, count)
  const usable = people !== undefined && count > 0 && isUsableCut(people, count, ANONYMITY_FLOOR)
  const tipping = people === undefined ? null : tippingPoint(people, count, ANONYMITY_FLOOR)
  const cannotSave = saving || !label.trim() || !key.trim() || (isList && count === 0)

  function addValue() {
    const text = draftValue.trim()
    if (text && !values.some((existing) => existing.text.toLocaleLowerCase() === text.toLocaleLowerCase())) {
      setValues([...values, { text }])
    }
    setDraftValue('')
  }

  function onValueKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      addValue()
    } else if (event.key === 'Escape') {
      setAdding(false)
      setDraftValue('')
    }
  }

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const options = isList
        ? values.map((option) => (option.value ? { value: option.value, label: option.text } : { label: option.text }))
        : undefined
      const position = Number.parseInt(order, 10) || nextOrder
      if (field) {
        await updateDemographicField(baseUrl, field.id, { label: label.trim(), options, required, order: position, isActive })
      } else {
        await createDemographicField(baseUrl, {
          companyId,
          field: key.trim(),
          label: label.trim(),
          type,
          options,
          required,
          order: position,
        })
      }
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('superadmin.next.demographics.form.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel
      accent
      labelledBy="demographics-form"
      heading={
        <h2 id="demographics-form" className="m-0 text-2xl">
          {field
            ? t('superadmin.next.demographics.form.editHeading', { label: field.label ?? field.field })
            : t('superadmin.next.demographics.form.newHeading')}
        </h2>
      }
      meta={t('superadmin.next.demographics.form.meta')}
      className="gap-3.5"
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {t('superadmin.next.demographics.form.saveFailed')}: {error}
          </AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
        <Field
          fieldLabel={t('superadmin.next.demographics.form.label')}
          htmlFor={ids.label}
          required
          helper={t('superadmin.next.demographics.form.labelHelper')}
        >
          <Input
            id={ids.label}
            value={label}
            required
            placeholder={t('superadmin.next.demographics.form.labelPlaceholder')}
            onChange={(event) => {
              setLabel(event.target.value)
              if (!keyTouched) setKey(keyFromLabel(event.target.value))
            }}
            className="w-full"
          />
        </Field>
        <Field
          fieldLabel={t('superadmin.next.demographics.form.key')}
          htmlFor={ids.key}
          required
          helper={t('superadmin.next.demographics.form.keyHelper')}
        >
          <Input
            id={ids.key}
            value={key}
            required
            disabled={editing}
            placeholder={t('superadmin.next.demographics.form.keyPlaceholder')}
            onChange={(event) => {
              setKey(event.target.value)
              setKeyTouched(true)
            }}
            className="w-full font-mono"
          />
        </Field>
        <Field
          fieldLabel={t('superadmin.next.demographics.form.type')}
          htmlFor={ids.type}
          helper={t('superadmin.next.demographics.form.typeHelper')}
        >
          <CanvasSelect id={ids.type} className="w-full" value={type} disabled={editing} onChange={(event) => setType(event.target.value)}>
            {TYPES.map((option) => (
              <option key={option} value={option}>
                {t(TYPE_KEY[option])}
              </option>
            ))}
          </CanvasSelect>
        </Field>
        <Field
          fieldLabel={t('superadmin.next.demographics.form.order')}
          htmlFor={ids.order}
          helper={t('superadmin.next.demographics.form.orderHelper')}
        >
          <Input id={ids.order} inputMode="numeric" value={order} onChange={(event) => setOrder(event.target.value)} className="w-full font-mono" />
        </Field>
      </div>

      {isList && (
        <Field
          fieldLabel={t('superadmin.next.demographics.form.values')}
          // Only the input takes the label: on the button it would replace the button's own
          // name ("Agregar valor") with the field's ("Valores").
          htmlFor={adding ? ids.value : undefined}
          helper={
            count > 0
              ? t('superadmin.next.demographics.form.valuesCount', { count })
              : t('superadmin.next.demographics.form.valuesNone')
          }
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {values.map((option) => (
              // The canvas's value chip carries no remove mark (`.chip`, padding 0 8px). The
              // remove control is still here, for pointer and keyboard alike: `sr-only` keeps it
              // focusable and announced, and it shows on hover or while focus is inside the chip.
              <span
                key={option.text}
                data-value-chip=""
                className="group inline-flex h-5.5 items-center gap-1 rounded-lg border border-line-default bg-surface-icon-box px-2 text-xs font-medium text-fg-secondary focus-within:pr-0.5 hover:pr-0.5"
              >
                {option.text}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('superadmin.next.demographics.form.removeValue', { value: option.text })}
                  onClick={() => setValues(values.filter((existing) => existing !== option))}
                  className="sr-only size-4 rounded-sm text-fg-tertiary group-focus-within:not-sr-only group-hover:not-sr-only [&_svg:not([class*='size-'])]:size-3"
                >
                  <X aria-hidden="true" />
                </Button>
              </span>
            ))}
            {adding ? (
              <Input
                id={ids.value}
                autoFocus
                value={draftValue}
                placeholder={t('superadmin.next.demographics.form.valuePlaceholder')}
                onChange={(event) => setDraftValue(event.target.value)}
                onKeyDown={onValueKey}
                onBlur={() => {
                  addValue()
                  setAdding(false)
                }}
                className="h-6 w-40 text-xs"
              />
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAdding(true)}
                className="h-5.5 rounded-lg border-dashed px-2 text-xs font-medium text-fg-secondary"
              >
                <Plus aria-hidden="true" className="size-3" />
                {t('superadmin.next.demographics.form.addValue')}
              </Button>
            )}
          </div>
        </Field>
      )}

      {isList && people !== undefined && mean !== null && (
        <div
          data-verdict={usable ? 'usable' : 'narrow'}
          className={
            usable
              ? 'flex flex-col gap-1.5 rounded-lg border border-accent-green-ring bg-accent-green-soft px-3.5 py-3'
              : 'flex flex-col gap-1.5 rounded-lg border border-accent-red-ring bg-accent-red-soft px-3.5 py-3'
          }
        >
          <div className="flex items-start gap-2.5">
            {usable ? (
              <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-green-ink" />
            ) : (
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-red" />
            )}
            <p className="m-0 text-base text-fg-primary">
              <b className="font-semibold">
                {usable ? t('superadmin.next.demographics.form.usableLead') : t('superadmin.next.demographics.form.narrowLead')}
              </b>{' '}
              <MonoReadings
                t={t}
                locale={locale}
                messageKey={usable ? 'superadmin.next.demographics.form.usableText' : 'superadmin.next.demographics.form.narrowText'}
                params={{ people, values: count, mean: oneDecimal(mean), floor: ANONYMITY_FLOOR }}
              />
            </p>
          </div>
          {usable && <p className="m-0 pl-6.5 text-xs text-fg-secondary">{t('superadmin.next.demographics.form.usableSub')}</p>}
        </div>
      )}

      {isList && usable && tipping !== null && people !== undefined && (
        <div className="flex items-start gap-2.5 rounded-lg bg-accent-amber-soft px-3.5 py-3 text-xs leading-normal text-fg-secondary">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-accent-amber-ink" />
          <span>
            <MonoReadings
              t={t}
              locale={locale}
              messageKey="superadmin.next.demographics.form.tippingPoint"
              params={{ values: tipping, mean: oneDecimal(people / tipping), floor: ANONYMITY_FLOOR }}
            />
          </span>
        </div>
      )}

      {/* The switch's sentence wraps; the buttons keep their line — as the canvas. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-light pt-2.5 sm:flex-nowrap">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <label htmlFor={ids.required} className="m-0 inline-flex items-center gap-2 text-xs text-fg-secondary">
            <Switch id={ids.required} checked={required} onCheckedChange={setRequired} className="data-[state=checked]:bg-accent-green" />
            <span>
              {t('superadmin.next.demographics.form.required')} · {t('superadmin.next.demographics.form.requiredHelper')}
            </span>
          </label>
          {editing && (
            <label htmlFor={ids.active} className="m-0 inline-flex items-center gap-2 text-xs text-fg-secondary">
              <Switch id={ids.active} checked={isActive} onCheckedChange={setIsActive} className="data-[state=checked]:bg-accent-green" />
              <span>{t('superadmin.next.demographics.form.activeLabel')}</span>
            </label>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => {
              if (field) {
                onCancel()
              } else {
                setLabel('')
                setKey('')
                setKeyTouched(false)
                setValues([])
                setRequired(false)
                setError(null)
              }
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="primary" disabled={cannotSave} onClick={() => void submit()}>
            <Check aria-hidden="true" />
            {field ? t('superadmin.next.demographics.form.saveField') : t('superadmin.next.demographics.form.create')}
          </Button>
        </div>
      </div>
    </Panel>
  )
}

function Catalogue({
  fields,
  people,
  activeDepartments,
  onEdit,
}: {
  fields: readonly DemographicField[]
  people: number | undefined
  activeDepartments: number | null
  onEdit: (field: DemographicField) => void
}) {
  const { t } = useTranslation()
  const ordered = [...fields].sort((a, b) => a.order - b.order)
  return (
    <Panel
      labelledBy="demographics-catalogue"
      heading={
        <h2 id="demographics-catalogue" className="m-0 text-2xl">
          {t('superadmin.next.demographics.catalogue.heading')}
        </h2>
      }
      meta={
        fields.length === 0
          ? t('superadmin.next.demographics.catalogue.emptyMeta')
          : t('superadmin.next.demographics.catalogue.countMeta', { count: fields.length })
      }
    >
      {fields.length === 0 ? (
        <EmptyNote icon={<Filter />} heading={t('superadmin.next.demographics.catalogue.emptyTitle')}>
          {activeDepartments === null
            ? t('superadmin.next.demographics.catalogue.emptyTextNoCount')
            : t('superadmin.next.demographics.catalogue.emptyText', { count: activeDepartments })}
        </EmptyNote>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {ordered.map((field, index) => {
            const verdict = fieldVerdict(field, people, ANONYMITY_FLOOR)
            const name = field.label ?? field.field
            return (
              <li
                key={field.id}
                data-field={field.field}
                className={`m-0 flex items-start justify-between gap-3 py-2.5 ${index > 0 ? 'border-t border-line-light' : ''}`}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="m-0 truncate font-semibold text-fg-primary">
                    {name} <span className="font-mono text-2xs font-normal text-fg-tertiary">{field.field}</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CanvasChip
                      tone={field.isActive ? 'good' : 'neutral'}
                      label={field.isActive ? t('superadmin.next.demographics.catalogue.active') : t('superadmin.next.demographics.catalogue.inactive')}
                    />
                    {verdict !== 'unknown' && (
                      <CanvasChip
                        tone={verdict === 'usable' ? 'good' : verdict === 'narrow' ? 'critical' : 'neutral'}
                        label={
                          verdict === 'usable'
                            ? t('superadmin.next.demographics.catalogue.usable')
                            : verdict === 'narrow'
                              ? t('superadmin.next.demographics.catalogue.narrow')
                              : t('superadmin.next.demographics.catalogue.notACut')
                        }
                      />
                    )}
                    {field.type === 'select' && (
                      <span className="text-2xs text-fg-tertiary">
                        {t('superadmin.next.demographics.catalogue.valuesCount', { count: field.options?.length ?? 0 })}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t('superadmin.next.demographics.catalogue.editNamed', { label: name })}
                  onClick={() => onEdit(field)}
                >
                  {t('superadmin.next.demographics.catalogue.edit')}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function FloorRules() {
  const { t } = useTranslation()
  const rules = [
    { key: 'floor', icon: <Shield />, lead: t('superadmin.next.demographics.rules.floorLead', { floor: ANONYMITY_FLOOR }), text: t('superadmin.next.demographics.rules.floorText') },
    { key: 'zero', icon: <EyeOff />, lead: t('superadmin.next.demographics.rules.zeroLead'), text: t('superadmin.next.demographics.rules.zeroText', { floor: ANONYMITY_FLOOR }) },
    { key: 'open', icon: <Columns2 />, lead: t('superadmin.next.demographics.rules.openLead'), text: t('superadmin.next.demographics.rules.openText') },
  ]
  return (
    <Panel
      labelledBy="demographics-rules"
      heading={
        <h2 id="demographics-rules" className="m-0 text-2xl">
          {t('superadmin.next.demographics.rules.heading')}
        </h2>
      }
    >
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {rules.map((rule) => (
          <li key={rule.key} className="m-0 flex items-start gap-2.5">
            <IconBox size="sm">{rule.icon}</IconBox>
            <p className="m-0 text-xs text-fg-secondary">
              <b className="font-semibold">{rule.lead}</b>
              {rule.key === 'open' ? '' : ' '}
              {rule.text}
            </p>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
