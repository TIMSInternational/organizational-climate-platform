import { Chip } from '../../../components/ui'
import { SEMAFORO_PRESENTATION, parseSemaforo } from '../semaforo'
import { useTranslation } from '../../../i18n'

/**
 * One plan's semáforo state, as a word with its own outline beside it.
 *
 * Takes the RAW wire value rather than a parsed `SemaforoEstado`, on purpose: every
 * caller has a `PlanAccion.estadoSemaforo`, which is a `string` because that is what
 * the API sends, and making each of them parse-and-branch is how one of them ends up
 * defaulting an unknown state to green. The branch lives here once.
 *
 * See `semaforo.ts` for why three things carry the state and not one.
 */
export interface SemaforoChipProps {
  /** `PlanAccion.estadoSemaforo` — `"Rojo" | "Amarillo" | "Verde"` in practice. */
  estado: string
  className?: string
}

export default function SemaforoChip({ estado, className }: SemaforoChipProps) {
  const { t } = useTranslation()
  const parsed = parseSemaforo(estado)

  // A state this build does not know renders in the neutral tone, with the server's
  // own word and no glyph — "we are showing you what it said and we cannot interpret
  // it" — rather than borrowing one of the three meanings. Neutral is the only tone
  // that claims nothing.
  if (parsed === null) {
    return <Chip tone="neutral" label={estado || t('tracking.semaforoDesconocido')} className={className} />
  }

  const { tone, icon: Icon, labelKey } = SEMAFORO_PRESENTATION[parsed]
  return (
    <Chip
      tone={tone}
      // `Chip` renders the icon inside an `aria-hidden` wrapper, so the glyph is not
      // read out twice — the label beside it already says the word.
      icon={<Icon />}
      label={t(labelKey)}
      className={className}
    />
  )
}
