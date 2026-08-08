import { Link } from 'react-router'
import type { Microclimate } from '../api/microclimates'
import { useTranslation } from '../../../i18n'
import { Badge, EmptyState, Table } from '../../../components/ui'
import { statusBadgeVariant, statusLabel } from '../microclimateVocabulary'
import { participationPercent } from '../microclimatePrivacy'

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
          <th>{t('microclimates.createdDate')}</th>
        </tr>
      </thead>
      <tbody>
        {microclimates.map((microclimate) => {
          const rate = participationPercent(
            microclimate.responseCount,
            microclimate.targetParticipantCount,
          )

          return (
            <tr key={microclimate.id}>
              <td>
                <Link to={`/microclimates/${microclimate.id}`}>
                  {microclimate.title ?? t('microclimates.untitled')}
                </Link>
              </td>
              <td>
                <Badge variant={statusBadgeVariant(microclimate.status)}>
                  {statusLabel(t, microclimate.status)}
                </Badge>
              </td>
              <td>
                {t('surveys.responseProgress', {
                  count: microclimate.responseCount,
                  target: microclimate.targetParticipantCount,
                })}
              </td>
              <td>{rate === null ? '—' : `${Math.round(rate)}%`}</td>
              <td>{new Date(microclimate.createdAt).toLocaleDateString(locale)}</td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}
