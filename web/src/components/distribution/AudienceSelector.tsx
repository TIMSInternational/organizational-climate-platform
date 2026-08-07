import { useTranslation } from '../../i18n'
import { Badge, Checkbox, Label, RadioGroup, RadioGroupItem } from '../ui'
import { estimateAudience, type AudienceMode } from './audience'
import type { Department } from '../../features/org-structure/api/departments'
import type { User } from '../../features/org-structure/api/users'

/**
 * Choosing who gets invited, with a live count of exactly how many people that is.
 *
 * ## Why the count is the point
 *
 * Sending to the wrong audience is not undoable — the mail is out. So the preview is the
 * safeguard, and it has to be the *same* number the server will act on or it is worse
 * than none. `estimateAudience` below therefore mirrors `ResolveAudienceAsync` clause for
 * clause: inactive users excluded, department membership via `departmentId`, and
 * `allTargeted` meaning the survey's own department targets — or the whole company when
 * it targets none, which is the same rule `/surveys/my` applies, so "who gets invited"
 * and "who sees it in their inbox" cannot drift apart.
 *
 * ## Why it cannot offer another company's people
 *
 * It has no way to. `departments` and `users` are passed in already scoped, and the page
 * fetches them for the **survey's** `companyId` after refusing to render at all when that
 * differs from the caller's own scope. The server enforces the same rule twice over
 * (`CanAdminister`, then an audience query filtered on `survey.CompanyId`), but a UI that
 * presents an option and then collects a 403 has already told the admin that another
 * tenant's departments exist.
 */
export interface AudienceSelectorProps {
  mode: AudienceMode
  onModeChange: (mode: AudienceMode) => void
  selectedDepartmentIds: readonly string[]
  onDepartmentsChange: (ids: string[]) => void
  selectedUserIds: readonly string[]
  onUsersChange: (ids: string[]) => void
  /** Already scoped to the survey's company by the caller. */
  departments: readonly Department[]
  /** Already scoped to the survey's company by the caller. */
  users: readonly User[]
  /** The survey's own department targets. Empty means company-wide. */
  surveyDepartmentIds: readonly string[]
  disabled?: boolean
}

function toggle(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id]
}

export default function AudienceSelector({
  mode,
  onModeChange,
  selectedDepartmentIds,
  onDepartmentsChange,
  selectedUserIds,
  onUsersChange,
  departments,
  users,
  surveyDepartmentIds,
  disabled = false,
}: AudienceSelectorProps) {
  const { t } = useTranslation()
  const recipients = estimateAudience(
    mode,
    users,
    selectedDepartmentIds,
    selectedUserIds,
    surveyDepartmentIds,
  )

  return (
    <div className="flex flex-col gap-panel-gap">
      <RadioGroup
        value={mode}
        onValueChange={(next) => onModeChange(next as AudienceMode)}
        disabled={disabled}
        className="flex flex-col gap-inline"
      >
        <div className="flex items-center gap-inline">
          <RadioGroupItem value="allTargeted" id="audience-all-targeted" />
          <Label htmlFor="audience-all-targeted" className="mb-0">
            {surveyDepartmentIds.length === 0
              ? t('surveys.distribution.audienceWholeCompany')
              : t('surveys.distribution.audienceSurveyTargets')}
          </Label>
        </div>
        <div className="flex items-center gap-inline">
          <RadioGroupItem value="departments" id="audience-departments" />
          <Label htmlFor="audience-departments" className="mb-0">
            {t('surveys.distribution.audienceDepartments')}
          </Label>
        </div>
        <div className="flex items-center gap-inline">
          <RadioGroupItem value="users" id="audience-users" />
          <Label htmlFor="audience-users" className="mb-0">
            {t('surveys.distribution.audienceUsers')}
          </Label>
        </div>
      </RadioGroup>

      {mode === 'departments' && (
        <fieldset className="flex flex-col gap-row">
          <legend className="text-sm text-fg-secondary">
            {t('surveys.distribution.audienceDepartments')}
          </legend>
          {departments.map((department) => (
            <label key={department.id} className="mb-0 flex items-center gap-inline">
              <Checkbox
                checked={selectedDepartmentIds.includes(department.id)}
                disabled={disabled}
                onCheckedChange={() => onDepartmentsChange(toggle(selectedDepartmentIds, department.id))}
              />
              <span>{department.name}</span>
            </label>
          ))}
        </fieldset>
      )}

      {mode === 'users' && (
        <fieldset className="flex max-h-80 flex-col gap-row overflow-y-auto">
          <legend className="text-sm text-fg-secondary">
            {t('surveys.distribution.audienceUsers')}
          </legend>
          {/* Inactive users are not offered: the server drops them from the audience, so
              a ticked box that resolves to nobody would make the preview overcount. */}
          {users
            .filter((user) => user.isActive)
            .map((user) => (
              <label key={user.id} className="mb-0 flex items-center gap-inline">
                <Checkbox
                  checked={selectedUserIds.includes(user.id)}
                  disabled={disabled}
                  onCheckedChange={() => onUsersChange(toggle(selectedUserIds, user.id))}
                />
                <span>{user.email}</span>
              </label>
            ))}
        </fieldset>
      )}

      <p className="flex items-center gap-inline text-fg-secondary">
        <Badge variant="outline">{recipients.length}</Badge>
        <span>{t('surveys.distribution.recipientsPreview', { count: recipients.length })}</span>
      </p>
    </div>
  )
}
