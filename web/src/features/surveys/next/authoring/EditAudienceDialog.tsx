import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '../../../../api/authFetch'
import { useTranslation } from '../../../../i18n'
import {
  Alert,
  AlertDescription,
  Button,
  CheckboxField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui'
import { audienceChange, targetsWholeCompany } from '../../../../components/distribution/audience'
import type { Department } from '../../../org-structure/api/departments'
import type { User } from '../../../org-structure/api/users'
import type { SurveyDetail } from '../../api/surveys'
import { PeoplePicker } from './PeoplePicker'
import { choosablePeople } from './peopleTargets'
import { audienceEditability, credentialModeOf, sameIds } from './audienceEdit'

/** Names printed per list before "y N más". */
const NAMES_SHOWN = 6

/**
 * "Editar audiencia" -- an existing survey's departments and named people, changed from the
 * detail page (G14 follow-up). Until this, a survey's audience could be set only when it was
 * created; afterwards only `PUT /surveys/{id}` from a script could move it.
 *
 * What it may change is the server's rule (`audienceEditability`): departments and people on a
 * draft nobody has answered, people only on a scheduled or active survey, nothing once it ended.
 *
 * Before anything is saved it states what saving does, from the company's directory and the
 * respond gate's own rule (`audienceChange`): how many may answer now and after, who gains and
 * who loses access by name, and the two crossings of the "whole company" line. It also says
 * plainly that nobody is notified -- measured: the update writes no notification and no
 * invitation (`SurveyAudienceEditTests`) -- and, on a per-person-key survey, that a person
 * added has no key yet.
 */
export function EditAudienceDialog({
  survey,
  departments,
  users,
  hasPublicLink,
  open,
  onOpenChange,
  onSave,
}: {
  survey: SurveyDetail
  /** The survey company's departments, or null when unread. */
  departments: readonly Department[] | null
  /** The survey company's directory, or null when unread. */
  users: readonly User[] | null
  /** The survey has a live link / QR, which signed-out visitors answer without any audience. */
  hasPublicLink: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (targets: { departmentIds?: string[]; userIds: string[] }) => Promise<void>
}) {
  const { t, locale } = useTranslation()
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.detail.audienceEdit.${key}`, vars)
  const editability = audienceEditability(survey)
  const departmentsEditable = editability === 'all'
  const [departmentIds, setDepartmentIds] = useState<string[]>([])
  const [userIds, setUserIds] = useState<string[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Each opening starts from the survey as it is now, so an abandoned edit never outlives it.
  useEffect(() => {
    if (!open) return
    setDepartmentIds([...survey.departmentIds])
    setUserIds([...survey.userIds])
    setProblem(null)
  }, [open, survey.departmentIds, survey.userIds])

  const departmentNames = useMemo(() => new Map((departments ?? []).map((d) => [d.id, d.name])), [departments])
  const people = useMemo(() => (users === null ? null : choosablePeople(users, departmentNames)), [departmentNames, users])
  const nameOf = useMemo(() => new Map((users ?? []).map((u) => [u.id, u.name || u.email])), [users])

  const current = { departmentIds: survey.departmentIds, userIds: survey.userIds }
  const next = { departmentIds: departmentsEditable ? departmentIds : survey.departmentIds, userIds }
  const changed = !sameIds(current.departmentIds, next.departmentIds) || !sameIds(current.userIds, next.userIds)
  const change = users === null ? null : audienceChange(users, current, next)
  // Targets that resolve to nobody active: a survey nobody can answer. Blocked, as the builder
  // blocks it (#630) -- an empty target set is NOT this, it is the whole company.
  const reachesNobody = change !== null && !targetsWholeCompany(next) && change.after.length === 0
  const live = survey.status === 'scheduled' || survey.status === 'active'
  const perSurveyKeys = credentialModeOf(survey) === 'per_survey'
  // Offered: the active departments, plus any the survey already targets, so a retired one
  // can still be unticked rather than silently kept.
  const offeredDepartments = (departments ?? []).filter((d) => d.isActive !== false || survey.departmentIds.includes(d.id))

  async function save() {
    setProblem(null)
    setSaving(true)
    try {
      await onSave(departmentsEditable ? { departmentIds, userIds } : { userIds })
      onOpenChange(false)
    } catch (cause) {
      setProblem(refusal(cause, copy, t('errors.generic')))
    } finally {
      setSaving(false)
    }
  }

  const audienceSize = (ids: string[], targets: { departmentIds: readonly string[]; userIds: readonly string[] }) =>
    targetsWholeCompany(targets)
      ? copy('wholeCompany', { count: ids.length })
      : copy(ids.length === 1 ? 'peopleOne' : 'peopleMany', { count: ids.length })

  const names = (ids: string[]) => {
    const shown = ids.slice(0, NAMES_SHOWN).map((id) => nameOf.get(id) ?? id)
    const rest = ids.length - shown.length
    // With a remainder the conjunction belongs to "y N más", not to the last name shown:
    // "Javier Araya y Jorge Zúñiga y 22 más" read as two lists.
    if (rest > 0) return `${shown.join(', ')} ${copy('andMore', { count: rest })}`
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(shown)
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !saving && onOpenChange(value)}>
      <DialogContent closeLabel={t('common.close')} className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy('title')}</DialogTitle>
          <DialogDescription>{copy('intro')}</DialogDescription>
        </DialogHeader>

        {departmentsEditable ? (
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" data-testid="audience-edit-departments">
            <legend className="mb-1.5 text-sm font-medium">{copy('departmentsLegend')}</legend>
            {offeredDepartments.length === 0 ? (
              <p className="m-0 text-sm text-fg-secondary">{copy('departmentsNone')}</p>
            ) : (
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {offeredDepartments.map((department) => (
                  <CheckboxField
                    key={department.id}
                    label={department.name}
                    checked={departmentIds.includes(department.id)}
                    disabled={saving}
                    onChange={(checked) =>
                      setDepartmentIds((ids) => (checked ? [...ids, department.id] : ids.filter((id) => id !== department.id)))
                    }
                  />
                ))}
              </div>
            )}
          </fieldset>
        ) : (
          survey.departmentIds.length > 0 && (
            <p className="m-0 text-sm text-fg-secondary" data-testid="audience-edit-departments-locked">
              {copy('departmentsLocked', {
                names: survey.departmentIds.map((id) => departmentNames.get(id) ?? '—').join(' · '),
              })}
            </p>
          )
        )}

        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-sm font-medium">{copy('peopleLegend')}</h3>
          <p className="m-0 text-sm text-fg-secondary">{copy('peopleHelp')}</p>
          {users !== null && <PeoplePicker people={people} users={users} chosen={userIds} onChange={setUserIds} />}
        </div>

        <section
          aria-label={copy('summaryTitle')}
          className="flex flex-col gap-2 rounded-md border border-line-default bg-surface-panel px-4 py-3 text-sm"
          data-testid="audience-consequence"
          aria-live="polite"
        >
          <h3 className="m-0 text-sm font-semibold text-fg-primary">{copy('summaryTitle')}</h3>
          {change === null ? (
            <p className="m-0 text-fg-secondary" role="alert">{copy('directoryUnread')}</p>
          ) : (
            <>
              <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
                <dt className="text-fg-secondary">{copy('beforeLabel')}</dt>
                <dd className="m-0" data-testid="audience-before">{audienceSize(change.before, current)}</dd>
                <dt className="text-fg-secondary">{copy('afterLabel')}</dt>
                <dd className="m-0 font-medium" data-testid="audience-after">{audienceSize(change.after, next)}</dd>
              </dl>
              {!changed && <p className="m-0 text-fg-secondary">{copy('unchanged')}</p>}
              {change.gained.length > 0 && (
                <p className="m-0" data-testid="audience-gained">
                  <b className="font-semibold">{copy(change.gained.length === 1 ? 'gainedOne' : 'gainedMany', { count: change.gained.length })}</b>{' '}
                  {names(change.gained)}
                </p>
              )}
              {change.lost.length > 0 && (
                <p className="m-0" data-testid="audience-lost">
                  <b className="font-semibold">{copy(change.lost.length === 1 ? 'lostOne' : 'lostMany', { count: change.lost.length })}</b>{' '}
                  {names(change.lost)}
                </p>
              )}
              {change.widensToCompany && (
                <p role="note" className="m-0 text-accent-amber-ink" data-testid="audience-widens">{copy('widens')}</p>
              )}
              {change.narrowsFromCompany && (
                <p role="note" className="m-0 text-accent-amber-ink" data-testid="audience-narrows">{copy('narrows')}</p>
              )}
              {reachesNobody && (
                <p role="alert" className="m-0 text-accent-red-ink" data-testid="audience-nobody">{copy('reachesNobody')}</p>
              )}
              {changed && (
                <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-fg-secondary" data-testid="audience-effects">
                  <li className="mb-0" data-testid="audience-no-mail">{copy('nobodyNotified')}</li>
                  {!live && <li className="mb-0">{copy('draftNote')}</li>}
                  {live && change.gained.length > 0 && (
                    <li className="mb-0" data-testid="audience-gained-note">{copy(perSurveyKeys ? 'gainedPerSurvey' : 'gainedShared')}</li>
                  )}
                  {live && change.lost.length > 0 && <li className="mb-0">{copy('lostNote')}</li>}
                  {survey.status === 'active' && <li className="mb-0">{copy('liveNote')}</li>}
                  {hasPublicLink && <li className="mb-0" data-testid="audience-public-link">{copy('publicLink')}</li>}
                </ul>
              )}
            </>
          )}
        </section>

        {problem && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={saving || !changed || change === null || reachesNobody}
            onClick={() => void save()}
          >
            {saving ? t('common.saving') : copy('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The server's refusal in the reader's language. `PUT /surveys/{id}` answers in English, so its
 * message is never shown: the status says which rule refused.
 */
function refusal(cause: unknown, copy: (key: string) => string, generic: string): string {
  if (cause instanceof ApiError) {
    if (cause.status === 400) return copy('refusedInvalid')
    if (cause.status === 409) return copy('refusedStatus')
    if (cause.status === 404) return copy('refusedGone')
  }
  return generic
}
