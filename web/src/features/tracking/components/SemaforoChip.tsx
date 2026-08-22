import { CircleCheck, CircleHelp, OctagonAlert, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Chip } from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import { cn } from '../../../lib/cn'
import {
  semaforoPresentation,
  toSemaforoEstado,
  type SemaforoEstado,
  type SemaforoShape,
} from '../semaforo'

/**
 * One semáforo state, drawn so that colour is never the only carrier. The single
 * mark this module uses everywhere a state appears — table rows, the KPI strip,
 * the plan detail header and the consolidado's column headings.
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
 * ## Every state on screen comes through here
 *
 * `SemaforoSummary` used to keep its OWN icon map, which is how the shape
 * guarantee pinned in `semaforo.test.ts` came to cover the chips in the table and
 * not the strip above them — the first thing a reader sees. There is one map now
 * (`SHAPE_ICONS`, below) and one table (`semaforo.ts`), and
 * `semaforoTable.test.ts` fails if a second appears.
 *
 * ## Takes the RAW wire value
 *
 * Rather than a parsed `SemaforoEstado`, on purpose: every caller has a
 * `PlanAccion.estadoSemaforo`, which is a `string` because that is what the API
 * sends, and making each of them parse-and-branch is how one of them ends up
 * defaulting an unknown state to green. The branch lives here once.
 *
 * `PlanResponse.EstadoSemaforo` is `EstadoSemaforo.ToString()` — an open string.
 * A fourth state added service-side would arrive as a word this build does not
 * know; it renders neutral, with a question mark and the raw value, instead of
 * being mapped to whichever branch happened to be the `default`. Neutral is the
 * only tone that claims nothing.
 */
export interface SemaforoChipProps {
  /** The raw `estadoSemaforo` from the API — `"Rojo" | "Amarillo" | "Verde"` in practice. */
  estado: string
  className?: string
}

const SHAPE_ICONS: Record<SemaforoShape, ReactNode> = {
  octagon: <OctagonAlert />,
  triangle: <TriangleAlert />,
  circle: <CircleCheck />,
}

/**
 * A state's silhouette on its own, for the places that supply their own word.
 *
 * The consolidado's column headings are the case: a row of three full chips there
 * reads as three controls sitting on top of the data, and repeats the pill the
 * strip directly above it already shows. What those headings need is the mark plus
 * the plain heading text.
 *
 * It lives HERE, beside `SHAPE_ICONS`, rather than in the page — that map is the
 * single point where a state becomes a drawing, and a page that reached for
 * lucide directly would be the second icon map all over again
 * (`semaforoTable.test.ts` fails on exactly that). Exporting a second COMPONENT
 * from this file is fine for `react(only-export-components)`; exporting a
 * non-component would not be.
 *
 * `aria-hidden`, always: every caller renders the word itself, and a screen reader
 * that also announced the shape would say the state twice.
 */
export function SemaforoGlyph({ estado, className }: { estado: SemaforoEstado; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('inline-flex shrink-0 items-center', className)}>
      {SHAPE_ICONS[semaforoPresentation(estado).shape]}
    </span>
  )
}

export default function SemaforoChip({ estado, className }: SemaforoChipProps) {
  const { t } = useTranslation()
  const known = toSemaforoEstado(estado)

  if (!known) {
    return (
      <Chip
        tone="neutral"
        icon={<CircleHelp />}
        // The server's own word when it sent one. A blank is not a word, so it
        // falls back to translated copy rather than rendering an empty chip that
        // reads as a rendering failure.
        label={estado || t('tracking.semaforo.desconocido')}
        className={className}
      />
    )
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
