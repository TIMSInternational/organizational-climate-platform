import { Link } from 'react-router'
import type { Microclimate } from '../api/microclimates'
import { useTranslation } from '../../../i18n'
import { Badge, EmptyState, Table } from '../../../components/ui'
import { ProtectedCell, isSuppressed } from '../../../components/charts'
import { statusBadgeVariant, statusLabel } from '../microclimateVocabulary'
import { MINIMUM_RESPONDENTS, participationPercent } from '../microclimatePrivacy'

/**
 * The microclimate listing.
 *
 * Two things changed with #127-#129 and both were rendering the wire verbatim:
 * `status` printed the server's own `draft`/`active`/`closed` under a Spanish UI,
 * and a null resolved title printed as nothing at all. `title` is null when the
 * microclimate has no text in *any* language — the resolver returns null rather
 * than an empty string or a key path (#195) — so the caller has to decide, and an
 * unlabelled row that is also an unlabelled link is unusable.
 *
 * The participation column is the reason to look at this table at all, so it is a
 * percentage next to the raw counts rather than counts alone. It is omitted, not
 * zeroed, when a session records no target: a rate over an invented denominator
 * reads as "0% participation" when the truth is "nobody said how many people were
 * expected".
 *
 * ## The Results column shows the floor being enforced
 *
 * A session below `MINIMUM_RESPONDENTS` renders `<ProtectedCell>` — hatched,
 * locked, and named *protected* by its accessible label — in place of the link.
 * That is the redesign's first principle: **protected is shown, never hidden**. An
 * empty cell would read as missing data, i.e. as the product having failed to
 * collect something, when the truth is the opposite.
 *
 * It is also not decoration. `MicroclimateResultsPage` renders its wording through
 * `MicroclimateWordPanel`, which runs `microclimatePrivacy.suppressWordCloud` and
 * withholds every word when the session is under `MINIMUM_RESPONDENTS` — the same
 * 5. So the link would lead to a page that can only say "withheld"; the listing
 * says it here instead of sending someone down a corridor.
 *
 * **The count behind a locked cell is never announced by it.** `ProtectedCell`
 * takes `responses` and renders none of it. The Responses column beside it does
 * show the count, and that is deliberate rather than an oversight:
 * `microclimatePrivacy.ts` argues it at length — participation counts identify
 * nobody and are the number that tells an admin whether to keep chasing. The floor
 * is about *what people said*.
 *
 * A `draft` session is not locked, because there is nothing to lock: it has never
 * been opened. It says so.
 *
 * ## Readings are mono, prose is not
 *
 * Every figure — the response counts, the participation rate, the date — carries
 * `font-mono tabular-nums`; the title and the status word do not. That is the one
 * typographic rule the redesign repeats everywhere, and it is what makes a column
 * of rates scan as a measurement rather than as text.
 */
export default function MicroclimateList({ microclimates }: { microclimates: Microclimate[] }) {
  const { t, locale } = useTranslation()

  if (microclimates.length === 0) {
    return (
      <EmptyState
        fill
        title={t('microclimates.noMicroclimates')}
        description={t('microclimates.createFirstMicroclimate')}
      />
    )
  }

  return (
    <Table>
      <thead>
        <tr>
          <th>{t('microclimates.title')}</th>
          <th>{t('common.status')}</th>
          <th>{t('dashboard.responses')}</th>
          <th>{t('microclimates.columnParticipation')}</th>
          <th>{t('microclimates.columnResults')}</th>
          <th>{t('microclimates.createdDate')}</th>
        </tr>
      </thead>
      <tbody>
        {microclimates.map((microclimate) => {
          const rate = participationPercent(
            microclimate.responseCount,
            microclimate.targetParticipantCount,
          )
          const name = microclimate.title ?? t('microclimates.untitled')

          return (
            <tr key={microclimate.id}>
              <td>
                <Link to={`/microclimates/${microclimate.id}`} className="font-semibold">
                  {name}
                </Link>
              </td>
              <td>
                <Badge variant={statusBadgeVariant(microclimate.status)}>
                  {statusLabel(t, microclimate.status)}
                </Badge>
              </td>
              <td className="font-mono tabular-nums text-fg-secondary">
                {/* "31 of 0" is not a reading. `targetParticipantCount` is
                    nullable in practice — a session opened without a roster
                    records zero — and the Participation cell beside this one
                    already renders an em dash rather than dividing by it (see
                    `participationPercent`). The count on its own is the honest
                    statement, and it is the same one the live card above makes
                    with `microclimates.liveNoTarget`. */}
                {microclimate.targetParticipantCount > 0
                  ? t('surveys.responseProgress', {
                      count: microclimate.responseCount,
                      target: microclimate.targetParticipantCount,
                    })
                  : t('microclimates.responsesNoTarget', { count: microclimate.responseCount })}
              </td>
              <td className="font-mono font-semibold tabular-nums">
                {rate === null ? '—' : `${Math.round(rate)}%`}
              </td>
              <td>
                {microclimate.status === 'draft' ? (
                  <span className="text-fg-tertiary">{t('microclimates.resultsPending')}</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <ProtectedCell
                      responses={microclimate.responseCount}
                      threshold={MINIMUM_RESPONDENTS}
                      description={name}
                      // The lock is an inline glyph in a table cell, so it needs a
                      // box of its own — `ProtectedCell` sizes to its content, and
                      // its content when suppressed is one 12px padlock.
                      suppressedClassName="h-5 w-7"
                    >
                      <Link to={`/microclimates/${microclimate.id}/results`}>
                        {t('microclimates.openResults')}
                      </Link>
                    </ProtectedCell>
                    {/* The word, beside the hatch. Hatched-and-locked alone is a
                        texture; the redesign asks for hatched, locked *and
                        labelled*, because a texture is what a reader has to guess
                        at. `aria-hidden` because `ProtectedCell` already carries
                        the same statement as its accessible name — assistive
                        technology should hear it once, not twice.

                        Both this and the cell decide with `isSuppressed` called on
                        the same two arguments, so they cannot disagree about which
                        rows are locked.

                        A closed session with *zero* responses is locked too, and
                        deliberately not given a distinct "nothing to show" state.
                        Splitting the two would publish the one fact
                        `ProtectedCell` is written never to publish — how far under
                        the floor a cell sits — because "no responses" and
                        "protected" would then be readable as 0 versus 1..4. */}
                    {isSuppressed(microclimate.responseCount, MINIMUM_RESPONDENTS) && (
                      <span
                        aria-hidden="true"
                        className="text-2xs font-semibold uppercase tracking-label text-accent-amber-ink"
                      >
                        {t('charts.protectedWord')}
                      </span>
                    )}
                  </span>
                )}
              </td>
              <td className="font-mono tabular-nums text-fg-secondary">
                {new Date(microclimate.createdAt).toLocaleDateString(locale)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}
