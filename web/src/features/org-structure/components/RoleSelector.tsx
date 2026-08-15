import { useTranslation } from '../../../i18n'
import { ROLES, roleLabelKey } from '../labels'

/**
 * The role picker on every invite and edit form.
 *
 * The list itself lives in `../labels.ts` alongside its translations, so the set
 * of roles and the words for them cannot drift apart — this component used to
 * hold the array and render the raw wire value (`company_admin`) as the option
 * text, which is what a Spanish administrator read.
 *
 * An unrecognised role still renders, as its raw token: the value the server
 * sent is a more honest thing to show than a made-up English word, and it keeps
 * a role added on the API side selectable before this catalogue catches up.
 */
interface RoleSelectorProps {
  value: string
  onChange: (role: string) => void
  disabled?: boolean
}

export default function RoleSelector({ value, onChange, disabled }: RoleSelectorProps) {
  const { t } = useTranslation()

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {ROLES.map((role) => {
        const key = roleLabelKey(role)
        return (
          <option key={role} value={role}>
            {key ? t(key) : role}
          </option>
        )
      })}
    </select>
  )
}
