import { Link } from 'react-router'
import type { Microclimate } from '../api/microclimates'
import { useTranslation } from '../../../i18n'
import { cn } from '../../../lib/cn'
import { Button, EmptyState, Progress } from '../../../components/ui'
import { ProtectedCell } from '../../../components/charts'
import { MINIMUM_RESPONDENTS, participationPercent } from '../microclimatePrivacy'
import { statusLabel } from '../microclimateVocabulary'

/**
 * The sessions that are open right now, at the top of the Microclimates listing.
 *
 * A microclimate is a thing you run *in a room*, so the screen's first job is to
 * answer "is anything happening, and how far in is it" without anyone opening a
 * row. The count is the reading: mono, tabular, at display size, with the target
 * beside it in prose — the redesign's typographic rule applied to the one number
 * on this screen that moves while you are looking at it.
 *
 * ## Why the results link is gated and the counts are not
 *
 * `Open results` appears only once the session clears `MINIMUM_RESPONDENTS`, and
 * below it the button is *replaced* by `<ProtectedCell>` and the word — the same
 * treatment `MicroclimateList` gives its Results column. Below the floor the word
 * panel on `MicroclimateResultsPage` (`MicroclimateWordPanel`, which runs
 * `suppressWordCloud`) can only report that the wording is withheld, so offering
 * the link would be a corridor to a locked door; showing the lock says a guarantee
 * is being kept, where an absent button would just look like an oversight.
 *
 * The participation counts are shown regardless, which is not an inconsistency —
 * `microclimatePrivacy.ts` sets out why at length. "3 of 40 so far" identifies
 * nobody, and it is precisely the number that tells an admin whether to keep
 * chasing responses. The floor protects *what people said*.
 *
 * ## No polling here
 *
 * The numbers refresh when the listing refreshes. Live-updating is the live view's
 * job (`MicroclimateLivePage`, which uses `charts/usePolling`), and a second
 * polling loop on the index would put every company's open sessions on a timer for
 * a page most people are passing through.
 */
export default function LiveSessionPanel({ sessions }: { sessions: readonly Microclimate[] }) {
  const { t } = useTranslation()

  if (sessions.length === 0) {
    return (
      <EmptyState
        title={t('microclimates.noLiveTitle')}
        description={t('microclimates.noLiveDescription')}
      />
    )
  }

  // Two across only when there are two to put across. A lone card stretched to
  // half the width leaves a hole where the missing one would be.
  const twoAcross = sessions.length > 1

  return (
    <div className={cn('grid gap-inline', twoAcross && 'md:grid-cols-2')}>
      {sessions.map((session, index) => {
        const rate = participationPercent(session.responseCount, session.targetParticipantCount)
        const name = session.title ?? t('microclimates.untitled')

        return (
          <div
            key={session.id}
            // The accent hairline marks these cards out from the tiles above. It
            // is never the only signal (WCAG 1.4.1): the status word sits in the
            // card's own header, top right.
            className={cn(
              'rounded-lg border border-accent-blue-ring bg-surface-icon-box p-card',
              // The odd one out spans the row rather than sitting alone in the
              // left column — the same hole the one-card case above avoids, which
              // three, five or seven sessions would otherwise reintroduce at the
              // bottom of the grid.
              // `twoAcross` is part of the condition, not an accident of it: with
              // one session the grid has a single track, and spanning two would
              // conjure an implicit second column for the card to hang off.
              twoAcross &&
                sessions.length % 2 === 1 &&
                index === sessions.length - 1 &&
                'md:col-span-2',
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-inline">
              <Link to={`/microclimates/${session.id}`} className="font-semibold">
                {name}
              </Link>
              {/* The session's own status, not a hardcoded "Active". The caller
                  passes `microclimateRollup.liveSessions()`, so in practice these
                  are all open — but a component that printed a status it had not
                  read would be free to be wrong the day that changes. */}
              <span className="text-2xs font-semibold uppercase tracking-label text-accent-green-ink">
                {statusLabel(t, session.status)}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-3xl font-semibold tracking-tight tabular-nums">
                {session.responseCount}
              </span>
              <span className="text-xs text-fg-tertiary">
                {session.targetParticipantCount > 0
                  ? t('microclimates.liveRespondedOf', { target: session.targetParticipantCount })
                  : t('microclimates.liveNoTarget')}
              </span>
            </div>

            {/* Omitted rather than drawn at zero when no target was recorded: a
                bar over an invented denominator states a participation rate
                nobody supplied. Same call `participationPercent` makes. */}
            {rate !== null && (
              <Progress
                value={Math.min(100, Math.round(rate))}
                // Capped rather than left to fill the card. A meter running the
                // width of the page reads as a banner; a reading is something you
                // take in at one glance, which is the whole argument of this
                // redesign.
                className="mt-2 max-w-sm"
                // Named, not just "Participation". Two open sessions put two
                // meters on this screen, and a screen-reader user moving between
                // them would otherwise hear the same label twice with no way to
                // tell which room either belongs to.
                aria-label={t('microclimates.liveParticipationLabel', { session: name })}
              />
            )}

            <div className="mt-3 flex flex-wrap items-center gap-inline">
              <Button asChild variant="primary">
                <Link to={`/microclimates/${session.id}/live`}>{t('microclimates.viewLive')}</Link>
              </Button>
              {/* Below the floor the results link is *replaced*, not removed. A
                  button that quietly is not there reads as a product that forgot
                  it; the hatch and the word say a rule is being kept. Same
                  predicate and same two arguments as `ProtectedCell` itself, so
                  the marker and the button can never both appear. */}
              <ProtectedCell
                responses={session.responseCount}
                threshold={MINIMUM_RESPONDENTS}
                description={name}
                suppressedClassName="h-control-sm w-7"
              >
                <Button asChild variant="outline">
                  <Link to={`/microclimates/${session.id}/results`}>
                    {t('microclimates.openResults')}
                  </Link>
                </Button>
              </ProtectedCell>
            </div>
          </div>
        )
      })}
    </div>
  )
}
