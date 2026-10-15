import { useMemo, useState } from 'react'
import {
  Button,
  Checkbox,
  Chip,
  Input,
  LoadingRegion,
  SkeletonText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type ChipTone,
} from '../../../../components/ui'
import { useTranslation } from '../../../../i18n'
import { TH_CLASS } from '../../../shared-next/parts'
import {
  MAX_CREDENTIALS_BATCH,
  resendCredentialsBatch,
  type CredentialsResendOutcome,
} from '../../../org-structure/api/users'
import type { SurveyParticipantStatus, SurveyRosterRow } from '../../api/surveys'
import type { ParticipationState } from './useSurveyParticipation'
import { Card, CardHeading } from './parts'
import { formatParticipationDay } from './participationDay'

type Filter = 'all' | SurveyParticipantStatus

type SendState =
  | { phase: 'idle' }
  | { phase: 'sending'; done: number; total: number }
  | { phase: 'done'; requested: number; sent: number; failed: number; outcomes: CredentialsResendOutcome[] }

/**
 * A stable empty roster. A fresh `[]` on every render is a new reference, which makes the
 * `useMemo` below recompute every time and costs a lint warning against a budget with two
 * slots left in it.
 */
const NO_ROWS: readonly SurveyRosterRow[] = []

const STATUS_TONE: Record<SurveyParticipantStatus, ChipTone> = {
  completed: 'good',
  started: 'warning',
  not_started: 'neutral',
}

const STATUS_KEY: Record<SurveyParticipantStatus, string> = {
  completed: 'statusCompleted',
  started: 'statusStarted',
  not_started: 'statusNotStarted',
}

const OUTCOME_KEY: Record<string, string> = {
  not_mass_invite: 'outcomeNotMassInvite',
  inactive: 'outcomeInactive',
  not_found: 'outcomeNotFound',
  send_failed: 'outcomeSendFailed',
}

/**
 * "Quién ya respondió": every invited person, how they sign in, where they stand, and the
 * demographics the import uploaded — never what anybody answered.
 *
 * <p>
 * Three states and not two. "Pendiente" used to mean both "never opened it" and "answered half
 * and was interrupted", and those call for opposite actions: the first person needs their
 * sign-in details again, the second already has them and needs a nudge. On 800 people an
 * administrator cannot tell them apart from one pending list, and this screen is what they
 * watch all launch day.
 * </p>
 *
 * <p>
 * Not gated on `collectParticipantIdentity`. That setting is about asking a LINK visitor for
 * their name; an account holder's state is known because the response carries their user id,
 * so the roster is answerable for a mass invite whether or not the survey asks anybody
 * anything.
 * </p>
 */
export default function SurveyRosterPanel({ state }: { state: ParticipationState }) {
  const { t, locale } = useTranslation()
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.roster.${key}`, vars)
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [send, setSend] = useState<SendState>({ phase: 'idle' })

  const roster = state.status === 'ready' ? state.view.roster : NO_ROWS

  /**
   * Whether a person's state on this survey means anything. An anonymous survey writes no user
   * id, so every row comes back `not_started` whatever anybody did — rendering that as
   * participation would tell an administrator that 800 people had not answered when the truth
   * is that nobody is counted individually. The people, their usernames and the resend still
   * belong on screen; the state does not.
   */
  const tracked = state.status === 'ready' ? state.view.tracksIndividuals : true

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return roster.filter((row) => {
      if (filter !== 'all' && row.status !== filter) return false
      if (needle === '') return true
      return (
        row.name.toLocaleLowerCase().includes(needle)
        || row.email.toLocaleLowerCase().includes(needle)
        || (row.username ?? '').toLocaleLowerCase().includes(needle)
      )
    })
  }, [roster, search, filter])

  // Only the people a resend can actually reach: an account that signs in by email has no
  // generated details, so offering to send it some would be an action that cannot succeed.
  const sendable = visible.filter((row) => row.username !== null)
  const chosen = [...selected].filter((id) => roster.some((row) => row.userId === id))
  const allShownChosen = sendable.length > 0 && sendable.every((row) => selected.has(row.userId))

  function toggle(userId: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(userId)) next.add(userId)
      return next
    })
  }

  function toggleAllShown() {
    setSelected((current) => {
      const next = new Set(current)
      for (const row of sendable) {
        if (allShownChosen) next.delete(row.userId)
        else next.add(row.userId)
      }
      return next
    })
  }

  function toggleDetails(userId: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(userId)) next.add(userId)
      return next
    })
  }

  /**
   * Chunked at the API's cap, sequentially. The send is inline rather than queued — the
   * plaintext password exists only until it is hashed — so each request holds a database
   * connection for as long as it takes to mail its chunk. Sequential chunks also mean a
   * failure costs one chunk rather than the whole roster, and every id comes back with its
   * own outcome: a count that silently shrank is how "all sent" was reported once already.
   */
  async function sendCredentials() {
    const ids = chosen
    if (ids.length === 0) return
    const chunks: string[][] = []
    for (let at = 0; at < ids.length; at += MAX_CREDENTIALS_BATCH) {
      chunks.push(ids.slice(at, at + MAX_CREDENTIALS_BATCH))
    }

    setSend({ phase: 'sending', done: 0, total: ids.length })
    const outcomes: CredentialsResendOutcome[] = []
    let done = 0
    for (const chunk of chunks) {
      try {
        const result = await resendCredentialsBatch(baseUrl, chunk)
        outcomes.push(...result.outcomes)
      } catch {
        // A chunk that never reached the server is still every one of its people failing, and
        // saying so beats a summary that quietly counts fewer than were asked for.
        outcomes.push(
          ...chunk.map((userId) => ({
            userId,
            email: null,
            delivered: false,
            failureReason: null,
            code: 'send_failed',
          })),
        )
      }
      done += chunk.length
      setSend({ phase: 'sending', done, total: ids.length })
    }

    setSend({
      phase: 'done',
      requested: ids.length,
      sent: outcomes.filter((o) => o.delivered).length,
      failed: outcomes.filter((o) => !o.delivered).length,
      outcomes,
    })
    setSelected(new Set())
  }

  const filters: { value: Filter; key: string; count: number }[] =
    state.status === 'ready' && tracked
      ? [
          { value: 'all', key: 'filterAll', count: state.view.roster.length },
          { value: 'completed', key: 'filterCompleted', count: state.view.answeredCount },
          { value: 'started', key: 'filterStarted', count: state.view.startedCount },
          { value: 'not_started', key: 'filterNotStarted', count: state.view.notStartedCount },
        ]
      : []

  return (
    <section aria-label={copy('title')} className="mt-6" data-testid="survey-roster-panel">
      <Card className="flex flex-col gap-3 px-4 py-4">
        <CardHeading title={copy('title')} />
        <p className="m-0 text-sm text-fg-secondary">{copy('intro')}</p>

        {state.status === 'idle' ? null : state.status === 'loading' ? (
          <LoadingRegion loading label={t('common.loading')}>
            <SkeletonText lines={3} />
          </LoadingRegion>
        ) : state.status === 'error' ? (
          <p role="alert" className="m-0 text-sm text-accent-red-ink">
            {copy('loadFailed')}
          </p>
        ) : state.view.roster.length === 0 ? (
          <p className="m-0 text-sm text-fg-secondary">{copy('emptyRoster')}</p>
        ) : (
          <>
            {!tracked ? (
              <p className="m-0 rounded-md border border-line-light bg-surface-icon-box px-3 py-2 text-sm text-fg-secondary">
                {copy('notTracked')}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {filters.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant={filter === option.value ? 'primary' : 'outline'}
                  aria-pressed={filter === option.value}
                  onClick={() => setFilter(option.value)}
                >
                  {copy(option.key)}
                  <span className="ml-1.5 font-mono text-xs tabular-nums">{option.count}</span>
                </Button>
              ))}
              <Input
                type="search"
                className="ml-auto max-w-72"
                placeholder={copy('search')}
                aria-label={copy('search')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <p className="m-0 text-xs text-fg-secondary">
              {copy('shown', { shown: visible.length, total: state.view.roster.length })}
            </p>

            {chosen.length > 0 ? (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-line-light bg-surface-icon-box px-3 py-2">
                <span className="text-sm font-medium">{copy('selected', { count: chosen.length })}</span>
                <Button type="button" variant="primary" disabled={send.phase === 'sending'} onClick={() => void sendCredentials()}>
                  {copy('send')}
                </Button>
                <span className="text-xs text-fg-secondary">{copy('sendNote')}</span>
              </div>
            ) : null}

            {send.phase === 'sending' ? (
              <p role="status" className="m-0 text-sm text-fg-secondary">
                {copy('sending', { done: send.done, total: send.total })}
              </p>
            ) : null}

            {send.phase === 'done' ? (
              <div role="status" className="flex flex-col gap-1">
                <p className="m-0 text-sm font-medium">
                  {send.sent === 0
                    ? copy('sendFailed')
                    : send.failed === 0
                      ? copy('sentAll', { sent: send.sent, requested: send.requested })
                      : copy('sentSome', { sent: send.sent, requested: send.requested, failed: send.failed })}
                </p>
                {send.outcomes
                  .filter((outcome) => !outcome.delivered)
                  .map((outcome) => (
                    <p key={outcome.userId} className="m-0 text-xs text-fg-secondary">
                      <span className="font-mono">{outcome.email ?? outcome.userId}</span>
                      {' — '}
                      {copy(OUTCOME_KEY[outcome.code ?? 'send_failed'] ?? 'outcomeSendFailed')}
                    </p>
                  ))}
              </div>
            ) : null}

            {visible.length === 0 ? (
              <p className="m-0 text-sm text-fg-secondary">{copy('empty')}</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-line-light">
                <Table className="text-sm">
                  <TableHeader className="bg-surface-icon-box">
                    <TableRow>
                      <TableHead scope="col" className={TH_CLASS}>
                        <Checkbox
                          checked={allShownChosen}
                          disabled={sendable.length === 0}
                          aria-label={copy('selectAll')}
                          onCheckedChange={toggleAllShown}
                        />
                      </TableHead>
                      <TableHead scope="col" className={TH_CLASS}>{copy('colPerson')}</TableHead>
                      <TableHead scope="col" className={TH_CLASS}>{copy('colUsuario')}</TableHead>
                      {tracked ? (
                        <>
                          <TableHead scope="col" className={TH_CLASS}>{copy('colStatus')}</TableHead>
                          <TableHead scope="col" className={TH_CLASS}>{copy('colLast')}</TableHead>
                        </>
                      ) : null}
                      <TableHead scope="col" className={TH_CLASS} />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((row) => (
                      <RosterRows
                        key={row.userId}
                        row={row}
                        tracked={tracked}
                        locale={locale}
                        copy={copy}
                        selected={selected.has(row.userId)}
                        expanded={expanded.has(row.userId)}
                        onToggle={() => toggle(row.userId)}
                        onToggleDetails={() => toggleDetails(row.userId)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </Card>
    </section>
  )
}

function RosterRows({
  row,
  tracked,
  locale,
  copy,
  selected,
  expanded,
  onToggle,
  onToggleDetails,
}: {
  row: SurveyRosterRow
  tracked: boolean
  locale: string
  copy: (key: string, vars?: Record<string, string | number>) => string
  selected: boolean
  expanded: boolean
  onToggle: () => void
  onToggleDetails: () => void
}) {
  const label = (demographic: { labelEs: string | null; labelEn: string | null; field: string }) =>
    (locale === 'es' ? demographic.labelEs : demographic.labelEn) ?? demographic.field

  return (
    <>
      <TableRow data-user-id={row.userId}>
        <TableCell className="px-3 py-2">
          <Checkbox
            checked={selected}
            // An account that signs in by email has no generated details, so there is nothing
            // a resend could send it.
            disabled={row.username === null}
            aria-label={copy('selectRow', { name: row.name })}
            onCheckedChange={onToggle}
          />
        </TableCell>
        <TableCell className="px-3 py-2">
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.name}</span>
            <span className="truncate font-mono text-xs text-fg-tertiary">{row.email}</span>
          </span>
        </TableCell>
        <TableCell className="px-3 py-2">
          {row.username === null ? (
            <span className="text-xs text-fg-tertiary">{copy('noUsuario')}</span>
          ) : (
            <span className="font-mono text-xs text-fg-secondary">{row.username}</span>
          )}
        </TableCell>
        {tracked ? (
          <>
            <TableCell className="px-3 py-2">
              <Chip tone={STATUS_TONE[row.status]} label={copy(STATUS_KEY[row.status])} />
            </TableCell>
            <TableCell className="whitespace-nowrap px-3 py-2 text-fg-secondary">
              {row.lastActivityOn === null ? (
                <span className="text-fg-tertiary">{copy('noActivity')}</span>
              ) : (
                formatParticipationDay(row.lastActivityOn, locale)
              )}
            </TableCell>
          </>
        ) : null}
        <TableCell className="px-3 py-2 text-right">
          <Button
            type="button"
            variant="outline"
            aria-expanded={expanded}
            aria-label={copy(expanded ? 'detailsHide' : 'details', { name: row.name })}
            onClick={onToggleDetails}
          >
            {expanded ? '−' : '+'}
          </Button>
        </TableCell>
      </TableRow>
      {expanded ? (
        <TableRow data-details-for={row.userId}>
          <TableCell colSpan={tracked ? 6 : 4} className="px-3 py-3">
            {row.demographics.length === 0 ? (
              <p className="m-0 text-sm text-fg-secondary">{copy('noDemographics')}</p>
            ) : (
              <dl className="m-0 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                {row.demographics.map((demographic) => (
                  <div key={demographic.field} className="flex min-w-0 items-baseline gap-2">
                    <dt className="text-xs text-fg-tertiary">{label(demographic)}</dt>
                    <dd className="m-0 truncate text-sm">{demographic.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}
