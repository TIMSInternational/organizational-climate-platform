import { CircleCheck, CircleHelp, OctagonAlert, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Chip } from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import { semaforoPresentation, toSemaforoEstado, type SemaforoShape } from '../semaforo'

/**
 * One semáforo state, drawn so that colour is never the only carrier.
 *
 * The client's spec §7 is explicit about the audience — 30+ years' tenure, low
 * digital literacy — and the reports get printed. So each state is a distinct
 * SILHOUETTE plus a Spanish WORD, and the tone is the third signal rather than the
 * first:
 *
 * | state    | shape    | word      |
 * |----------|----------|-----------|
 * | Rojo     | octagon  | Atrasado  |
 * | Amarillo | triangle | En riesgo |
 * | Verde    | circle   | Al día    |
 *
 * Photocopy that in greyscale and all three are still distinguishable twice over.
 * A row of three coloured dots would not be, which is why `semaforo.ts` carries a
 * `shape` beside the `tone` and this component refuses to render a state without
 * one.
 *
 * The glyph is `aria-hidden` (`ui/chip.tsx` does that for every icon it takes) and
 * the word is the accessible name, so a screen reader hears "Atrasado" once rather
 * than hearing a shape described at it.
 *
 * ## An unknown state is not silently green
 *
 * `PlanResponse.EstadoSemaforo` is `EstadoSemaforo.ToString()` — an open string.
 * A fourth state added service-side would arrive as a word this build does not
 * know; it renders neutral, with a question mark and the raw value, instead of
 * being mapped to whichever branch happened to be the `default`.
 */
export interface SemaforoChipProps {
  /** The raw `estadoSemaforo` from the API. */
  estado: string
  className?: string
}

const SHAPE_ICONS: Record<SemaforoShape, ReactNode> = {
  octagon: <OctagonAlert />,
  triangle: <TriangleAlert />,
  circle: <CircleCheck />,
}

export default function SemaforoChip({ estado, className }: SemaforoChipProps) {
  const { t } = useTranslation()
  const known = toSemaforoEstado(estado)

  if (!known) {
    return <Chip tone="neutral" icon={<CircleHelp />} label={estado} className={className} />
  }

  const presentation = semaforoPresentation(known)
  return (
    <Chip
      tone={presentation.tone}
      icon={SHAPE_ICONS[presentation.shape]}
      label={t(presentation.labelKey)}
      className={className}
    />
  )
}
