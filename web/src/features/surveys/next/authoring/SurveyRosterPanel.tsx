import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import {
  Button,
  Checkbox,
  Chip,
  ConfirmationDialog,
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
import {
  reissueSurveyCredential,
  type SurveyCredentialReissueOutcome,
  type SurveyParticipantStatus,
  type SurveyRosterRow,
} from '../../api/surveys'
import type { ParticipationState } from './useSurveyParticipation'
import { Card, CardHeading } from './parts'
import { formatParticipationDay } from './participationDay'
import { getSurveyRosterCsv, surveyRosterCsvFileName } from './rosterExport'
import { downloadBlobFile } from '../../../../lib/downloadBlobFile'

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
  not_completed: 'neutral',
}

const STATUS_KEY: Record<SurveyParticipantStatus, string> = {
  completed: 'statusCompleted',
  started: 'statusStarted',
  not_started: 'statusNotStarted',
  not_completed: 'statusNotCompleted',
}

/** What one per-row reissue did, kept until the next one so the admin can read it. */
type ReissueState =
  | { phase: 'idle' }
  | { phase: 'done'; name: string; email: string; outcome: SurveyCredentialReissueOutcome | { kind: 'error' } }

const REFUSAL_KEY: Record<string, string> = {
  not_per_survey: 'reissueRefusedNotPerSurvey',
  survey_not_open: 'reissueRefusedNotOpen',
  user_not_found: 'reissueRefusedNotFound',
  user_inactive: 'reissueRefusedInactive',
  not_in_audience: 'reissueRefusedNotInAudience',
  no_credential: 'reissueRefusedNoCode',
  already_signed_in: 'reissueRefusedSignedIn',
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
  const [confirmBatch, setConfirmBatch] = useState(false)
  const [reissueTarget, setReissueTarget] = useState<SurveyRosterRow | null>(null)
  const [reissue, setReissue] = useState<ReissueState>({ phase: 'idle' })
  // The day a key reissued from THIS page was mailed, so the row says so without refetching the
  // whole roster -- the payload is shared with the Participación panel, which owns its fetch.
  const [issuedHere, setIssuedHere] = useState<Readonly<Record<string, string>>>({})
  const [download, setDownload] = useState<'idle' | 'busy' | 'failed'>('idle')

  const roster = state.status === 'ready' ? state.view.roster : NO_ROWS

  /**
   * One key per person per survey. Such a person has no account username, so the account
   * resend behind "Enviar recordatorio" cannot reach them -- and in this mode it must not: an
   * account password would be a wider key than the one the mode hands out. Their sign-in is the
   * survey key, and it is reissued per row.
   */
  const perSurvey = state.status === 'ready' && state.view.credentialMode === 'per_survey'
  const surveyTitle =
    state.status !== 'ready'
      ? ''
      : (locale === 'es'
          ? (state.view.surveyTitleEs ?? state.view.surveyTitleEn)
          : (state.view.surveyTitleEn ?? state.view.surveyTitleEs)) ?? ''

  /**
   * Whether a person's state on this survey means anything. An anonymous survey writes no user
   * id, so every row comes back `not_started` whatever anybody did — rendering that as
   * participation would tell an administrator that 800 people had not answered when the truth
   * is that nobody is counted individually. The people, their usernames and the resend still
   * belong on screen; the state does not.
   */
  const tracked = state.status === 'ready' ? state.view.tracksIndividuals : true

  /**
   * Completion is knowable even when the three states are not. An anonymous survey records a
   * completion in `survey_participations`, apart from the answers, so "finished" and "has not
   * finished" are both facts here while "opened it and stopped" is not.
   */
  const completionOnly = state.status === 'ready' ? state.view.tracksCompletionOnly : false
  const showState = tracked || completionOnly

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return roster.filter((row) => {
      if (filter !== 'all' && row.status !== filter) return false
      if (needle === '') return true
      return (
        row.name.toLocaleLowerCase().includes(needle)
        || row.email.toLocaleLowerCase().includes(needle)
        || (row.username ?? '').toLocaleLowerCase().includes(needle)
        || (row.surveyUsername ?? '').toLocaleLowerCase().includes(needle)
      )
    })
  }, [roster, search, filter])

  // Only the people a resend can actually reach: an account that signs in by email has no
  // generated details, so offering to send it some would be an action that cannot succeed.
  const sendable = perSurvey ? [] : visible.filter((row) => row.username !== null)
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

  /**
   * The roster as a CSV, written by the server from the same rows this panel draws
   * (`GET /surveys/{id}/participation/export`). The whole roster, not the filtered view: the
   * file is the status report ESPH asked for twice, and a search box left typed in would
   * silently send them half of it.
   */
  async function downloadRoster() {
    if (state.status !== 'ready') return
    setDownload('busy')
    try {
      const blob = await getSurveyRosterCsv(baseUrl, state.view.surveyId)
      downloadBlobFile(surveyRosterCsvFileName(copy('downloadFilePrefix'), surveyTitle, new Date()), blob)
      setDownload('idle')
    } catch {
      setDownload('failed')
    }
  }

  async function reissueFor(row: SurveyRosterRow) {
    let outcome: SurveyCredentialReissueOutcome | { kind: 'error' }
    try {
      outcome = await reissueSurveyCredential(baseUrl, state.status === 'ready' ? state.view.surveyId : '', row.userId)
    } catch {
      outcome = { kind: 'error' }
    }
    if (outcome.kind === 'sent') {
      const issuedOn = outcome.issuedOn
      setIssuedHere((current) => ({ ...current, [row.userId]: issuedOn }))
    }
    setReissue({ phase: 'done', name: row.name, email: row.email, outcome })
    setReissueTarget(null)
  }

  // Counts come off the roster rather than the payload's own counters, so a chip can never
  // disagree with the rows under it.
  const filters: { value: Filter; key: string; count: number }[] =
    state.status !== 'ready' || !showState
      ? []
      : tracked
        ? [
            { value: 'all', key: 'filterAll', count: state.view.roster.length },
            { value: 'completed', key: 'filterCompleted', count: state.view.answeredCount },
            { value: 'started', key: 'filterStarted', count: state.view.startedCount },
            { value: 'not_started', key: 'filterNotStarted', count: state.view.notStartedCount },
          ]
        : [
            { value: 'all', key: 'filterAll', count: state.view.roster.length },
            {
              value: 'completed',
              key: 'filterCompleted',
              count: state.view.roster.filter((row) => row.status === 'completed').length,
            },
            {
              value: 'not_completed',
              key: 'filterNotCompleted',
              count: state.view.roster.filter((row) => row.status === 'not_completed').length,
            },
          ]

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
            {!showState ? (
              <p className="m-0 rounded-md border border-line-light bg-surface-icon-box px-3 py-2 text-sm text-fg-secondary">
                {copy('notTracked')}
              </p>
            ) : completionOnly ? (
              <p className="m-0 rounded-md border border-line-light bg-surface-icon-box px-3 py-2 text-sm text-fg-secondary">
                {copy('completionOnlyNote')}
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

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-xs text-fg-secondary">
                {copy('shown', { shown: visible.length, total: state.view.roster.length })}
              </p>
              <Button type="button" variant="outline" size="sm" disabled={download === 'busy'} onClick={() => downloadRoster()}>
                <Download aria-hidden="true" />
                {download === 'busy' ? copy('downloading') : copy('download')}
              </Button>
            </div>

            {download === 'failed' ? (
              <p role="alert" className="m-0 text-sm text-accent-red-ink">
                {copy('downloadFailed')}
              </p>
            ) : null}

            {chosen.length > 0 ? (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-line-light bg-surface-icon-box px-3 py-2">
                <span className="text-sm font-medium">{copy('selected', { count: chosen.length })}</span>
                <Button type="button" variant="primary" disabled={send.phase === 'sending'} onClick={() => setConfirmBatch(true)}>
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

            {reissue.phase === 'done' ? (
              <p
                role="status"
                className={
                  reissue.outcome.kind === 'sent' ? 'm-0 text-sm font-medium' : 'm-0 text-sm font-medium text-accent-red-ink'
                }
              >
                {reissue.outcome.kind === 'sent'
                  ? copy('reissueSent', { name: reissue.name, email: reissue.email })
                  : reissue.outcome.kind === 'send_failed'
                    ? copy('reissueSendFailed', { name: reissue.name })
                    : reissue.outcome.kind === 'refused'
                      ? copy(REFUSAL_KEY[reissue.outcome.code] ?? 'reissueError')
                      : copy('reissueError')}
              </p>
            ) : null}

            {visible.length === 0 ? (
              <p className="m-0 text-sm text-fg-secondary">{copy('empty')}</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-line-light">
                <Table className="text-sm">
                  <TableHeader className="bg-surface-icon-box">
                    <TableRow>
                      {perSurvey ? null : (
                        <TableHead scope="col" className={TH_CLASS}>
                          <Checkbox
                            checked={allShownChosen}
                            disabled={sendable.length === 0}
                            aria-label={copy('selectAll')}
                            onCheckedChange={toggleAllShown}
                          />
                        </TableHead>
                      )}
                      <TableHead scope="col" className={TH_CLASS}>{copy('colPerson')}</TableHead>
                      <TableHead scope="col" className={TH_CLASS}>{copy('colRole')}</TableHead>
                      <TableHead scope="col" className={TH_CLASS}>{copy('colUsuario')}</TableHead>
                      {perSurvey ? (
                        <TableHead scope="col" className={TH_CLASS}>{copy('colCode')}</TableHead>
                      ) : null}
                      {showState ? (
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
                        roleLabel={t(`superadmin.next.users.roles.${row.role}`)}
                        tracked={showState}
                        perSurvey={perSurvey}
                        issuedHere={issuedHere[row.userId] ?? null}
                        onReissue={() => setReissueTarget(row)}
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

      {/* The batch replaces every chosen person's password: the pair already in their inbox
          stops working. That is said BEFORE the send, not only in the note beside the button. */}
      <ConfirmationDialog
        open={confirmBatch}
        onOpenChange={setConfirmBatch}
        title={copy('sendConfirmTitle', { count: chosen.length })}
        description={copy('sendConfirmBody', { count: chosen.length })}
        confirmText={copy('send')}
        cancelText={t('common.cancel')}
        onConfirm={() => sendCredentials()}
      />

      <ConfirmationDialog
        open={reissueTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReissueTarget(null)
        }}
        title={copy('reissueTitle', { name: reissueTarget?.name ?? '' })}
        description={copy('reissueBody', {
          email: reissueTarget?.email ?? '',
          survey: surveyTitle,
          username: reissueTarget?.surveyUsername ?? '',
        })}
        confirmText={copy('reissue')}
        cancelText={t('common.cancel')}
        onConfirm={() => (reissueTarget === null ? undefined : reissueFor(reissueTarget))}
      />
    </section>
  )
}

function RosterRows({
  row,
  roleLabel,
  tracked,
  perSurvey,
  issuedHere,
  onReissue,
  locale,
  copy,
  selected,
  expanded,
  onToggle,
  onToggleDetails,
}: {
  row: SurveyRosterRow
  roleLabel: string
  tracked: boolean
  perSurvey: boolean
  /** The day a reissue from this page mailed this person's key, overriding the loaded one. */
  issuedHere: string | null
  onReissue: () => void
  locale: string
  copy: (key: string, vars?: Record<string, string | number>) => string
  selected: boolean
  expanded: boolean
  onToggle: () => void
  onToggleDetails: () => void
}) {
  const label = (demographic: { labelEs: string | null; labelEn: string | null; field: string }) =>
    (locale === 'es' ? demographic.labelEs : demographic.labelEn) ?? demographic.field

  // Absent on a payload from before the key columns existed; absent reads as "no key".
  const surveyUsername = row.surveyUsername ?? null
  const issuedOn = issuedHere ?? row.credentialIssuedOn ?? null
  const signedInOn = row.lastSignInOn ?? null
  // Five either way: per-survey trades the checkbox for the Código column.
  const columns = 5 + (tracked ? 2 : 0)

  return (
    <>
      <TableRow data-user-id={row.userId}>
        {perSurvey ? null : (
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
        )}
        <TableCell className="px-3 py-2">
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.name}</span>
            <span className="truncate font-mono text-xs text-fg-secondary">{row.email}</span>
          </span>
        </TableCell>
        <TableCell className="px-3 py-2 text-fg-secondary">{roleLabel}</TableCell>
        <TableCell className="px-3 py-2">
          {perSurvey ? (
            // A per-survey person signs in with THIS survey's key, never their email: the
            // account was imported keyless. "Entra con su correo" here was false.
            surveyUsername === null ? (
              <span className="text-xs text-fg-secondary">{copy('noCode')}</span>
            ) : (
              <span className="whitespace-nowrap font-mono text-xs text-fg-secondary">{surveyUsername}</span>
            )
          ) : row.username === null ? (
            <span className="text-xs text-fg-secondary">{copy('noUsuario')}</span>
          ) : (
            <span className="font-mono text-xs text-fg-secondary">{row.username}</span>
          )}
        </TableCell>
        {perSurvey ? (
          <TableCell className="px-3 py-2">
            <span className="flex min-w-48 flex-col items-start gap-1">
              <span className="text-xs">
                {issuedOn === null
                  ? copy('noCode')
                  : copy('codeSent', { date: formatParticipationDay(issuedOn, locale) })}
              </span>
              {issuedOn === null ? null : (
                <span className="text-xs text-fg-secondary">
                  {signedInOn === null
                    ? copy('notSignedIn')
                    : copy('signedInOn', { date: formatParticipationDay(signedInOn, locale) })}
                </span>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                // A used key is in that person's hands: replacing it would lock them out of a
                // survey they may be halfway through. And with no key there is nothing to
                // reissue -- the invitation mints the first one.
                disabled={issuedOn === null || signedInOn !== null}
                aria-label={copy('reissueFor', { name: row.name })}
                aria-describedby={issuedOn === null || signedInOn !== null ? `reissue-why-${row.userId}` : undefined}
                onClick={onReissue}
              >
                {copy('reissue')}
              </Button>
              {issuedOn === null || signedInOn !== null ? (
                <span id={`reissue-why-${row.userId}`} className="text-xs text-fg-secondary">
                  {issuedOn === null ? copy('reissueWhyNoCode') : copy('reissueWhySignedIn')}
                </span>
              ) : null}
            </span>
          </TableCell>
        ) : null}
        {tracked ? (
          <>
            <TableCell className="px-3 py-2">
              <Chip tone={STATUS_TONE[row.status]} label={copy(STATUS_KEY[row.status])} />
            </TableCell>
            <TableCell className="whitespace-nowrap px-3 py-2 text-fg-secondary">
              {row.lastActivityOn === null ? (
                <span className="text-fg-secondary">{copy('noActivity')}</span>
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
          <TableCell colSpan={columns} className="px-3 py-3">
            {row.demographics.length === 0 ? (
              <p className="m-0 text-sm text-fg-secondary">{copy('noDemographics')}</p>
            ) : (
              <dl className="m-0 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                {row.demographics.map((demographic) => (
                  <div key={demographic.field} className="flex min-w-0 items-baseline gap-2">
                    <dt className="text-xs text-fg-secondary">{label(demographic)}</dt>
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
