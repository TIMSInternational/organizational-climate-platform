import { Lock } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { ProtectedCell, isSuppressed } from '../../../components/charts'
import { Badge } from '../../../components/ui'
import type { WordCloudEntry } from '../api/microclimates'
import { MINIMUM_RESPONDENTS } from '../microclimatePrivacy'
import MicroclimateWordPanel from './MicroclimateWordPanel'

interface LiveOpenAnswersProps {
  words: readonly WordCloudEntry[]
  /** The session's own running total. The floor is about people, not words. */
  responseCount: number
}

/**
 * What people wrote, while they are writing it — or the statement that it is
 * being withheld.
 *
 * ## Why this is a `ProtectedCell` and not an alert
 *
 * The redesign's first principle is that a protected reading is **shown, never
 * hidden**: a blank panel reads as *missing data*, i.e. as the product having
 * failed to collect something, whereas the hatch-and-padlock reads as a guarantee
 * being enforced. `ProtectedCell` is the primitive that expresses that, and it is
 * used here rather than re-drawn so that the live view, the climate map and the
 * departments grid cannot drift into three different-looking floors.
 *
 * `ProtectedCell` renders its children whenever the floor is met, so above the
 * floor this is exactly `MicroclimateWordPanel` and below it the hatched cell.
 * The sentence beside it is gated on `isSuppressed` — the same predicate
 * `ProtectedCell` consults internally (`components/charts/suppression.ts`), so the
 * hatch and the explanation cannot disagree about which state this is in.
 *
 * ## What the withheld state must never say
 *
 * It never renders `responseCount`, and it never renders a distance to the floor.
 * "2 more responses needed" is arithmetic a reader inverts in one step to recover
 * the exact sub-floor count, which is precisely what the floor exists to hide —
 * with a known headcount an exact small count re-identifies people. The floor
 * itself (`MINIMUM_RESPONDENTS`) is a published constant and is safe to state; how
 * far under it this session sits is not.
 *
 * The running participation total *above* this panel keeps updating throughout,
 * and that is deliberate rather than an oversight — see `microclimatePrivacy.ts`:
 * "3 of 40 so far" identifies nobody and is the number that tells an admin whether
 * to keep chasing. What is withheld is the wording, not the count.
 */
export default function LiveOpenAnswers({ words, responseCount }: LiveOpenAnswersProps) {
  const { t } = useTranslation()
  const withheld = isSuppressed(responseCount, MINIMUM_RESPONDENTS)
  const title = t('microclimates.liveOpenAnswersTitle')

  return (
    <section className="flex flex-col gap-inline">
      <div className="flex flex-wrap items-center justify-between gap-inline">
        {/* `h4`, not `H2`: this sits inside the live panel, whose heading is the
            `h3` `RealTimeChartContainer` renders, under the page's `h1`. Sized to
            match `ChartFrame`'s `<figcaption>` so a section heading and the
            caption of the chart beside it do not read as two different ranks. */}
        <h4 className="m-0 text-lg font-semibold text-fg-primary">{title}</h4>
        {withheld && (
          // The word beside the colour, never the colour alone (WCAG 1.4.1) — and
          // the padlock beside the word, so the state survives a greyscale print.
          <Badge variant="warning">
            <Lock aria-hidden="true" className="size-3" />
            {t('microclimates.liveProtectedChip')}
          </Badge>
        )}
      </div>

      <ProtectedCell
        responses={responseCount}
        threshold={MINIMUM_RESPONDENTS}
        description={title}
        // The second legitimate opt-out, for the opposite reason to `ClimateMap`'s:
        // not too little room for the word but too much of the word already. This
        // panel states it twice around the hatch — the `liveProtectedChip` badge
        // above carries a padlock and the word, and `liveProtectedDescription`
        // below names the floor in a sentence. A third "PROTECTED" inside the box
        // would be the same statement three times in one panel.
        showWord={false}
        // The hatch has to read as a withheld *panel*, not as a withheld figure:
        // at cell size it looks like a rendering glitch in the middle of a page.
        // Not taller than this, though — `ProtectedCell` centres a 12px padlock,
        // and past about six rems the glyph is a speck in a large void, which
        // reads as the empty panel this treatment exists to avoid.
        suppressedClassName="h-24 w-full"
      >
        <MicroclimateWordPanel words={words} responseCount={responseCount} />
      </ProtectedCell>

      {withheld && (
        <p className="m-0 text-sm text-fg-secondary">
          {t('microclimates.liveProtectedDescription', { minimum: MINIMUM_RESPONDENTS })}
        </p>
      )}
    </section>
  )
}
