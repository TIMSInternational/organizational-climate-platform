import type { ComponentProps } from 'react'
import { useTranslation } from '../../i18n'
import { byCount } from '../../i18n/plural'
import { cn } from '../../lib/cn'
import { CanvasLockIcon } from './canvasGlyphs'

/**
 * A group the privacy floor withholds, drawn as the Apple design's `.prot`: a 13px padlock
 * and "Menos de {floor}" in the secondary ink, 12px medium.
 *
 * ## What it must never do
 *
 * `docs/decisions/privacy-floor-is-three.md`: a suppressed group never yields a number — not
 * on screen, not in an accessible name, not by subtraction, and an absent count is never a 0.
 * So this component takes **no count at all**. The only figure it prints is `floor`, the
 * threshold the group fell under, which is policy and not data.
 *
 * `floor` comes from the payload (the server's floor for this surface — 3 for a cross, the
 * whole survey, a public link or a leader's own team; 1 for a single department shown to an
 * administrator), never from a constant here. A floor that is not a positive whole number —
 * a field the payload did not carry, `NaN` from a bad parse — prints "Protegido" with no
 * figure rather than "Menos de NaN" or a guessed 3: it fails closed.
 *
 * ## What a screen reader hears
 *
 * The short visible words are a fragment ("Menos de 3" — of what?), so they are hidden from
 * assistive technology and a full sentence is read instead: "Grupo protegido: menos de 3
 * respuestas". Both come from the catalogue (`ui.protected.*`); nothing is passed in.
 */
export type ProtectedStateProps = Omit<ComponentProps<'span'>, 'children'> & {
  /** The privacy floor the group fell under, from the payload. */
  floor: number | null | undefined
}

export function ProtectedState({ floor, className, ...props }: ProtectedStateProps) {
  const { t } = useTranslation()
  const valid = typeof floor === 'number' && Number.isInteger(floor) && floor > 0

  return (
    <span
      data-slot="protected-state"
      className={cn(
        'inline-flex items-center gap-1.25 whitespace-nowrap text-xs font-medium text-fg-tertiary',
        className,
      )}
      {...props}
    >
      <CanvasLockIcon className="size-3.25 shrink-0" />
      <span aria-hidden="true">{valid ? t('ui.protected.short', { floor }) : t('ui.protected.noFloor')}</span>
      <span className="sr-only">
        {valid
          ? t(byCount(floor, 'ui.protected.longOne', 'ui.protected.long'), { floor })
          : t('ui.protected.noFloorLong')}
      </span>
    </span>
  )
}
