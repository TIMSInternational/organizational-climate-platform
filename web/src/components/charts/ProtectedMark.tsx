import { Lock } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { cn } from '../../lib/cn'

/**
 * The place a withheld reading would have been: a padlock and "Menos de {floor}" — the
 * Apple canvas's `.prot` (TeamHome, the leader's own team). Never a number, never a 0.
 *
 * `floor` is the floor the server applied to THIS payload (`minimumGroupSize` and its
 * kin), passed in rather than read from `ANONYMITY_FLOOR`: an administrator's single
 * department floors at 1 and a leader's team at 3, and a mark that printed a constant
 * would promise one of them a floor the server is not keeping. It is required so a caller
 * cannot forget it. The floor itself is not sensitive; how far under it a group sits is,
 * and this component is never told.
 *
 * The padlock is `aria-hidden` — the words beside it say the same thing.
 */
export default function ProtectedMark({ floor, className }: { floor: number; className?: string }) {
  const { t } = useTranslation()
  return (
    <span
      data-protected-mark=""
      className={cn('inline-flex items-center gap-1.25 text-sm font-medium whitespace-nowrap text-fg-tertiary', className)}
    >
      <Lock aria-hidden="true" className="size-3.25 shrink-0" />
      {t('charts.range.protected', { floor })}
    </span>
  )
}
