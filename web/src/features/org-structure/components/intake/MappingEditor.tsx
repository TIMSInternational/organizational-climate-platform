import { Plus, TriangleAlert } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { Table } from '../../../../components/ui'
import { cn } from '../../../../lib/cn'
import { CanvasChip, CanvasSelect } from '../../next/super/parts'
import type {
  IntakeColumnMapping,
  IntakeDemographicTarget,
  IntakeMapping,
  IntakeRoleTarget,
  IntakeTargets,
} from '../../api/intake'
import { ConfidenceChip, MappingSection, ReasonText } from './IntakeParts'
import {
  COLUMN_TARGETS,
  ROLE_TARGETS,
  columnChoice,
  columnKey,
  columnLetter,
  countLowConfidence,
  demographicKey,
  departmentChoice,
  departmentKey,
  parseColumnChoice,
  parseDepartmentChoice,
  roleKey,
} from './intakeModel'

/**
 * The mapping, editable: what each column is, what each job title becomes, where each area goes,
 * and which option each demographic answer is. Every change goes up as a whole new mapping plus
 * the key of what was touched; nothing here talks to the server — "Aplicar cambios" does.
 *
 * A low-confidence decision the admin has not touched is tinted amber and counted at the top, so
 * the eye goes there first. Sections with nothing in them are not drawn.
 */
export function MappingEditor({
  mapping,
  targets,
  edited,
  disabled,
  onChange,
}: {
  mapping: IntakeMapping
  targets: IntakeTargets
  edited: ReadonlySet<string>
  disabled: boolean
  onChange: (next: IntakeMapping, key: string) => void
}) {
  const { t } = useTranslation()
  const low = countLowConfidence(mapping, edited)
  const hasNameColumn = mapping.columns.some((c) => c.target === 'name')
  const demographicLabel = (field: string) =>
    targets.demographics.find((d) => d.field === field)?.label ?? field
  const selectDemographics = targets.demographics.filter(
    (d): d is IntakeDemographicTarget & { options: string[] } =>
      d.type === 'select' && d.options !== null && mapping.demographicValues.some((v) => v.field === d.field),
  )

  const lowRow = (confidence: string, key: string) => confidence === 'low' && !edited.has(key)
  const rowClass = (isLow: boolean) => cn(isLow && 'bg-accent-amber-soft')

  function setColumn(column: IntakeColumnMapping, value: string) {
    const { target, demographicField } = parseColumnChoice(value)
    onChange(
      {
        ...mapping,
        columns: mapping.columns.map((c) => (c.column === column.column ? { ...c, target, demographicField } : c)),
      },
      columnKey(column.column),
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {low > 0 && (
        <p
          data-slot="intake-low-confidence"
          className="m-0 flex items-start gap-2 rounded-lg border border-accent-amber-ring bg-accent-amber-soft px-3.5 py-2.5 text-sm text-fg-primary"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-amber" />
          <span>{t('users.intake.mapping.lowConfidence', { count: low })}</span>
        </p>
      )}

      <MappingSection
        id="intake-map-columns"
        heading={t('users.intake.mapping.columnsTitle')}
        note={t('users.intake.mapping.columnsNote')}
      >
        <Table aria-labelledby="intake-map-columns">
          <thead>
            <tr>
              <th>{t('users.intake.mapping.fileColumn')}</th>
              <th>{t('users.intake.mapping.usedAs')}</th>
              <th>{t('users.intake.mapping.confidence')}</th>
              <th>{t('users.intake.mapping.reason')}</th>
            </tr>
          </thead>
          <tbody>
            {mapping.columns.map((column) => {
              const key = columnKey(column.column)
              const isLow = lowRow(column.confidence, key)
              const header = column.header.trim() || t('users.intake.mapping.emptyHeader')
              const choice = columnChoice(column)
              const knownDemographic =
                column.target !== 'demographic' ||
                targets.demographics.some((d) => d.field === column.demographicField)
              return (
                <tr key={column.column} data-low-confidence={isLow || undefined} className={rowClass(isLow)}>
                  <td className="min-w-40 align-top">
                    <span className="flex flex-col">
                      <span className="font-medium text-fg-primary">{header}</span>
                      <span className="font-mono text-2xs text-fg-tertiary">
                        {t('users.intake.mapping.columnRef', { letter: columnLetter(column.column) })}
                      </span>
                    </span>
                  </td>
                  <td className="align-top">
                    <CanvasSelect
                      className="min-w-44"
                      aria-label={t('users.intake.mapping.usedAs') + ' · ' + header}
                      value={choice}
                      disabled={disabled}
                      onChange={(e) => setColumn(column, e.target.value)}
                    >
                      {COLUMN_TARGETS.map((target) => (
                        <option key={target} value={target}>
                          {t(`users.intake.mapping.target.${target}`)}
                        </option>
                      ))}
                      {targets.demographics.map((d) => (
                        <option key={d.field} value={`demographic:${d.field}`}>
                          {t('users.intake.mapping.demographicTarget', { label: d.label ?? d.field })}
                        </option>
                      ))}
                      {!knownDemographic && (
                        <option value={choice}>
                          {t('users.intake.mapping.demographicTarget', { label: column.demographicField ?? '' })}
                        </option>
                      )}
                      <option value="ignore">{t('users.intake.mapping.target.ignore')}</option>
                    </CanvasSelect>
                  </td>
                  <td className="align-top">
                    <ConfidenceChip confidence={column.confidence} edited={edited.has(key)} />
                  </td>
                  <td className="min-w-56 align-top">
                    <ReasonText reason={column.reason} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </MappingSection>

      <MappingSection id="intake-map-settings" heading={t('users.intake.mapping.settingsTitle')}>
        <div className="flex flex-wrap gap-4">
          {hasNameColumn && (
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-fg-secondary">
              {t('users.intake.mapping.nameOrder')}
              <CanvasSelect
                className="w-60"
                value={mapping.nameOrder}
                disabled={disabled}
                onChange={(e) =>
                  onChange({ ...mapping, nameOrder: e.target.value as IntakeMapping['nameOrder'] }, 'nameOrder')
                }
              >
                <option value="first_last">{t('users.intake.mapping.nameOrderValue.first_last')}</option>
                <option value="last_first">{t('users.intake.mapping.nameOrderValue.last_first')}</option>
              </CanvasSelect>
            </label>
          )}
          <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-fg-secondary">
            {t('users.intake.mapping.defaultRole')}
            <CanvasSelect
              className="w-60"
              value={mapping.defaultRole}
              disabled={disabled}
              onChange={(e) =>
                onChange({ ...mapping, defaultRole: e.target.value as IntakeRoleTarget }, 'defaultRole')
              }
            >
              {ROLE_TARGETS.map((role) => (
                <option key={role} value={role}>
                  {t(`users.intake.role.${role}`)}
                </option>
              ))}
            </CanvasSelect>
          </label>
        </div>
      </MappingSection>

      {mapping.roleValues.length > 0 && (
        <MappingSection
          id="intake-map-roles"
          heading={t('users.intake.mapping.rolesTitle')}
          note={t('users.intake.mapping.rolesNote')}
        >
          <Table aria-labelledby="intake-map-roles">
            <thead>
              <tr>
                <th>{t('users.intake.mapping.sourceValue')}</th>
                <th>{t('users.intake.mapping.role')}</th>
                <th>{t('users.intake.mapping.confidence')}</th>
                <th>{t('users.intake.mapping.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {mapping.roleValues.map((value) => {
                const key = roleKey(value.source)
                const isLow = lowRow(value.confidence, key)
                return (
                  <tr key={value.source} data-low-confidence={isLow || undefined} className={rowClass(isLow)}>
                    <td className="min-w-40 align-top font-medium text-fg-primary">{value.source}</td>
                    <td className="align-top">
                      <CanvasSelect
                        className="min-w-36"
                        aria-label={t('users.intake.mapping.role') + ' · ' + value.source}
                        value={value.target}
                        disabled={disabled}
                        onChange={(e) =>
                          onChange(
                            {
                              ...mapping,
                              roleValues: mapping.roleValues.map((v) =>
                                v.source === value.source ? { ...v, target: e.target.value as IntakeRoleTarget } : v,
                              ),
                            },
                            key,
                          )
                        }
                      >
                        {ROLE_TARGETS.map((role) => (
                          <option key={role} value={role}>
                            {t(`users.intake.role.${role}`)}
                          </option>
                        ))}
                      </CanvasSelect>
                    </td>
                    <td className="align-top">
                      <ConfidenceChip confidence={value.confidence} edited={edited.has(key)} />
                    </td>
                    <td className="min-w-56 align-top">
                      <ReasonText reason={value.reason} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </MappingSection>
      )}

      {mapping.departmentValues.length > 0 && (
        <MappingSection
          id="intake-map-departments"
          heading={t('users.intake.mapping.departmentsTitle')}
          note={t('users.intake.mapping.departmentsNote')}
        >
          <Table aria-labelledby="intake-map-departments">
            <thead>
              <tr>
                <th>{t('users.intake.mapping.sourceValue')}</th>
                <th>{t('users.intake.mapping.department')}</th>
                <th>{t('users.intake.mapping.confidence')}</th>
                <th>{t('users.intake.mapping.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {mapping.departmentValues.map((value) => {
                const key = departmentKey(value.source)
                const isLow = lowRow(value.confidence, key)
                // The name a "create" would use: the one the model proposed, or the file's own.
                const newName = value.createNew && value.department ? value.department : value.source
                const existingUnknown =
                  !value.createNew && value.department !== null && !targets.departments.includes(value.department)
                return (
                  <tr key={value.source} data-low-confidence={isLow || undefined} className={rowClass(isLow)}>
                    <td className="min-w-40 align-top font-medium text-fg-primary">{value.source}</td>
                    <td className="align-top">
                      <CanvasSelect
                        className="min-w-44"
                        aria-label={t('users.intake.mapping.department') + ' · ' + value.source}
                        value={departmentChoice(value)}
                        disabled={disabled}
                        onChange={(e) =>
                          onChange(
                            {
                              ...mapping,
                              departmentValues: mapping.departmentValues.map((v) =>
                                v.source === value.source ? { ...v, ...parseDepartmentChoice(e.target.value) } : v,
                              ),
                            },
                            key,
                          )
                        }
                      >
                        <option value="none">{t('users.intake.mapping.unassigned')}</option>
                        {targets.departments.map((name) => (
                          <option key={name} value={`existing:${name}`}>
                            {name}
                          </option>
                        ))}
                        {existingUnknown && <option value={`existing:${value.department}`}>{value.department}</option>}
                        <option value={`new:${newName}`}>{t('users.intake.mapping.createDepartment', { name: newName })}</option>
                      </CanvasSelect>
                    </td>
                    <td className="align-top">
                      <span className="flex flex-wrap gap-1.5">
                        {value.createNew && value.department && (
                          <CanvasChip tone="neutral" icon={<Plus />} label={t('users.intake.mapping.newChip')} />
                        )}
                        <ConfidenceChip confidence={value.confidence} edited={edited.has(key)} />
                      </span>
                    </td>
                    <td className="min-w-56 align-top">
                      <ReasonText reason={value.reason} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </MappingSection>
      )}

      {selectDemographics.map((field) => {
        const values = mapping.demographicValues.filter((v) => v.field === field.field)
        const headingId = `intake-map-demographic-${field.field}`
        const label = demographicLabel(field.field)
        return (
          <MappingSection
            key={field.field}
            id={headingId}
            heading={t('users.intake.mapping.demographicsTitle', { label })}
            note={t('users.intake.mapping.demographicsNote')}
          >
            <Table aria-labelledby={headingId}>
              <thead>
                <tr>
                  <th>{t('users.intake.mapping.sourceValue')}</th>
                  <th>{t('users.intake.mapping.option')}</th>
                  <th>{t('users.intake.mapping.confidence')}</th>
                </tr>
              </thead>
              <tbody>
                {values.map((value) => {
                  const key = demographicKey(value.field, value.source)
                  const isLow = lowRow(value.confidence, key)
                  return (
                    <tr key={value.source} data-low-confidence={isLow || undefined} className={rowClass(isLow)}>
                      <td className="min-w-40 align-top font-medium text-fg-primary">{value.source}</td>
                      <td className="align-top">
                        <CanvasSelect
                          className="min-w-40"
                          aria-label={label + ' · ' + value.source}
                          value={value.target ?? ''}
                          disabled={disabled}
                          onChange={(e) =>
                            onChange(
                              {
                                ...mapping,
                                demographicValues: mapping.demographicValues.map((v) =>
                                  v.field === value.field && v.source === value.source
                                    ? { ...v, target: e.target.value === '' ? null : e.target.value }
                                    : v,
                                ),
                              },
                              key,
                            )
                          }
                        >
                          <option value="">{t('users.intake.mapping.noOption')}</option>
                          {value.target !== null && !field.options.includes(value.target) && (
                            <option value={value.target}>{value.target}</option>
                          )}
                          {field.options.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </CanvasSelect>
                      </td>
                      <td className="align-top">
                        <ConfidenceChip confidence={value.confidence} edited={edited.has(key)} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          </MappingSection>
        )
      })}
    </div>
  )
}
