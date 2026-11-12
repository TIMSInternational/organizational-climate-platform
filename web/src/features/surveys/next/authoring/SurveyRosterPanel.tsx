import { useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, ChevronDown, Clock, Download } from 'lucide-react'
import {
  Button,
  Card,
  Checkbox,
  Chip,
  ConfirmationDialog,
  Input,
  LoadingState,
  Note,
  SegmentedControl,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui'
import { useTranslation } from '../../../../i18n'
import { readViewerClaims } from '../../../../auth/viewerCapabilities'
import {
  MAX_CREDENTIALS_BATCH,
  resendCredentialsBatch,
  type CredentialsResendOutcome,
} from '../../../org-structure/api/users'
import {
  reissueSurveyCredential,
  remindSurveyCredential,
  revokeSurveyCredential,
  type SurveyCredentialReissueOutcome,
  type SurveyCredentialRemindOutcome,
  type SurveyCredentialRevokeOutcome,
  type SurveyDeliveryProblem,
  type SurveyParticipantStatus,
  type SurveyRosterRow,
} from '../../api/surveys'
import { createSurveyInvitations } from '../../api/surveyDistribution'
import { ApiError } from '../../../../api/authFetch'
import type { ParticipationState } from './useSurveyParticipation'
import { chaseActionFor } from './chaseAction'
import { formatParticipationDay } from './participationDay'
import { getSurveyRosterCsv, surveyRosterCsvFileName } from './rosterExport'
import { downloadBlobFile } from '../../../../lib/downloadBlobFile'
import { ResponseExclusionDialog } from './ResponseExclusionDialog'

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

/**
 * A participant's state is not a result, so every chip is the neutral grey (green, amber and red
 * are the three result areas and nothing else). The glyph tells finished from started at a glance;
 * the word is always there, so the state never rests on the glyph either.
 */
const STATUS_ICON: Partial<Record<SurveyParticipantStatus, ReactNode>> = {
  completed: <CheckCircle2 />,
  started: <Clock />,
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

type RemindState =
  | { phase: 'idle' }
  | { phase: 'done'; name: string; email: string; outcome: SurveyCredentialRemindOutcome | { kind: 'error' } }

type RevokeState =
  | { phase: 'idle' }
  | { phase: 'done'; name: string; outcome: SurveyCredentialRevokeOutcome | { kind: 'error' } }

/** What sending ONE person their first code did. */
type SendCodeOutcome = 'sent' | 'not_sent' | 'already_had' | 'not_open' | 'error'
type SendCodeState = { phase: 'idle' } | { phase: 'done'; name: string; email: string; outcome: SendCodeOutcome }

/** The local calendar day, as the roster's day fields are written (`YYYY-MM-DD`). */
function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * A reminder shares six of its seven refusals with a reissue, and they mean the same thing, so
 * they reuse the same sentences rather than keeping a second copy that can drift. Only
 * `already_completed` is its own: it cannot happen to a reissue, which refuses a signed-in
 * person long before it gets as far as asking whether they finished.
 */
const REMIND_REFUSAL_KEY: Record<string, string> = {
  not_per_survey: 'reissueRefusedNotPerSurvey',
  survey_not_open: 'reissueRefusedNotOpen',
  user_not_found: 'reissueRefusedNotFound',
  user_inactive: 'reissueRefusedInactive',
  not_in_audience: 'reissueRefusedNotInAudience',
  no_credential: 'reissueRefusedNoCode',
  already_completed: 'remindRefusedCompleted',
}

const REVOKE_REFUSAL_KEY: Record<string, string> = {
  not_per_survey: 'revokeRefusedNotPerSurvey',
  user_not_found: 'revokeRefusedNotFound',
  no_credential: 'revokeRefusedNoCode',
  has_responses: 'revokeRefusedHasResponses',
}

const REFUSAL_KEY: Record<string, string> = {
  not_per_survey: 'reissueRefusedNotPerSurvey',
  survey_not_open: 'reissueRefusedNotOpen',
  user_not_found: 'reissueRefusedNotFound',
  user_inactive: 'reissueRefusedInactive',
  not_in_audience: 'reissueRefusedNotInAudience',
  no_credential: 'reissueRefusedNoCode',
  already_signed_in: 'reissueRefusedSignedIn',
  super_admin_only: 'reissueRefusedSuperAdminOnly',
}

/** What the mail service reported, as the roster says it. */
const DELIVERY_PROBLEM_KEY: Record<SurveyDeliveryProblem, string> = {
  bounced: 'deliveryBounced',
  bounced_temporarily: 'deliveryBouncedTemporarily',
  marked_spam: 'deliveryMarkedSpam',
  rejected: 'deliveryRejected',
}

/**
 * A password handed over in person: on screen until the operator dismisses it, then gone. It is
 * held in component state only -- never storage, never the URL -- because nothing on the server
 * keeps the plaintext either, and this is its only copy.
 */
type HandedOver = { name: string; username: string; password: string; hadSignedIn: boolean }

const SEND_CODE_OUTCOME_KEY: Record<SendCodeOutcome, string> = {
  sent: 'sendCodeSent',
  not_sent: 'sendCodeNotSent',
  already_had: 'sendCodeAlreadyHad',
  not_open: 'sendCodeNotOpen',
  error: 'sendCodeError',
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
  const [remind, setRemind] = useState<RemindState>({ phase: 'idle' })
  const [remindTarget, setRemindTarget] = useState<SurveyRosterRow | null>(null)
  const [reissue, setReissue] = useState<ReissueState>({ phase: 'idle' })
  // The day a key reissued from THIS page was mailed, so the row says so without refetching the
  // whole roster -- the payload is shared with the Participación panel, which owns its fetch.
  const [issuedHere, setIssuedHere] = useState<Readonly<Record<string, string>>>({})
  // Reminders sent from THIS page, for the same reason as `issuedHere`: one write updates the
  // row instead of refetching eight hundred of them. Before this existed a reminder left no
  // trace anywhere, so an operator working a client's list of names had no way to tell whether
  // they had already written to somebody -- including from an earlier sitting.
  const [remindedHere, setRemindedHere] = useState<Readonly<Record<string, { on: string | null; count: number }>>>({})
  const [revokeTarget, setRevokeTarget] = useState<SurveyRosterRow | null>(null)
  const [revoke, setRevoke] = useState<RevokeState>({ phase: 'idle' })
  // Keys withdrawn from THIS page, for the same reason as `issuedHere`: the roster payload is
  // fetched once for the whole page and shared with the Participación panel, which owns that
  // fetch, so a write here updates the row rather than refetching eight hundred of them.
  const [revokedHere, setRevokedHere] = useState<ReadonlySet<string>>(new Set())
  const [download, setDownload] = useState<'idle' | 'busy' | 'failed'>('idle')
  const [handoverTarget, setHandoverTarget] = useState<SurveyRosterRow | null>(null)
  const [handedOver, setHandedOver] = useState<HandedOver | null>(null)
  const [sendCodeTarget, setSendCodeTarget] = useState<SurveyRosterRow | null>(null)
  const [sendCode, setSendCode] = useState<SendCodeState>({ phase: 'idle' })
  // Taking one finished response out of the results, or putting it back (super admins only).
  // The outcome is kept per row like `issuedHere`: the payload is the Participación panel's.
  const [exclusionTarget, setExclusionTarget] = useState<{ row: SurveyRosterRow; exclude: boolean } | null>(null)
  const [excludedHere, setExcludedHere] = useState<Readonly<Record<string, boolean>>>({})
  const [exclusionNote, setExclusionNote] = useState<string | null>(null)

  /**
   * Only a super admin may receive a password to hand over: the server refuses anybody else
   * (`super_admin_only`), because a company that could read its employee's password could sign
   * in as them to a survey promised to be anonymous to it. The button follows the same rule so
   * a company admin is never offered an action that cannot succeed.
   */
  const superAdmin = readViewerClaims().role === 'super_admin'

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
   * This person's reminder history as it stands at the moment the dialog opens: a send made from
   * this page if there was one, otherwise what the roster loaded, and null when they have never
   * been reminded. Null is what makes the dialog's extra sentence conditional rather than a
   * sentence about zero.
   */
  const remindAlready = (() => {
    if (remindTarget === null) return null
    const here = remindedHere[remindTarget.userId]
    const on = here?.on ?? remindTarget.lastRemindedOn ?? null
    const count = here?.count ?? remindTarget.reminderCount ?? 0
    return on === null || count === 0 ? null : { on, count }
  })()

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

  /**
   * A new password for this survey, shown ONCE here instead of mailed -- for the person TIMS has
   * to give it to in person: a paper questionnaire, an address their own company's gateway
   * rejects, a client contact who asked to pass it on herself. Between 26 Oct and 3 Nov 2026
   * each of those took an SQL edit of the person's email address.
   *
   * <p>A key already used to sign in is replaced too (`replaceUsedKey`): somebody who signed in
   * once and lost the password is exactly who asks for this, and the dialog said so first.</p>
   */
  async function handoverFor(row: SurveyRosterRow) {
    const usedKey = (row.lastSignInOn ?? null) !== null
    let outcome: SurveyCredentialReissueOutcome | { kind: 'error' }
    try {
      outcome = await reissueSurveyCredential(baseUrl, state.status === 'ready' ? state.view.surveyId : '', row.userId, {
        delivery: 'handover',
        replaceUsedKey: usedKey,
      })
    } catch {
      outcome = { kind: 'error' }
    }
    setHandoverTarget(null)
    if (outcome.kind === 'handed_over') {
      const issuedOn = outcome.issuedOn
      setIssuedHere((current) => ({ ...current, [row.userId]: issuedOn }))
      setHandedOver({ name: row.name, username: outcome.username, password: outcome.password, hadSignedIn: outcome.hadSignedIn })
      setReissue({ phase: 'idle' })
      return
    }
    setReissue({ phase: 'done', name: row.name, email: row.email, outcome })
  }

  /**
   * Sends ONE person their first code for this survey: `POST /surveys/{id}/invitations` naming
   * only them. The server resolves the id within the survey's own company, mints for nobody who
   * already holds a key, and mails nobody else.
   *
   * <p>The only alternative on this page was "Enviar códigos", which mails everyone in the
   * audience still without a key -- on a department-targeted survey that includes people the
   * client never listed, which is the 28 Oct 2026 incident. So one person whose key was withdrawn
   * by mistake (4 Nov), or a new hire added mid-survey, took a script
   * (docs/audits/2026-11-08-operator-ui-walkthrough.md, A3).</p>
   */
  async function sendCodeFor(row: SurveyRosterRow) {
    let outcome: SendCodeOutcome
    try {
      const result = await createSurveyInvitations(baseUrl, state.status === 'ready' ? state.view.surveyId : '', {
        userIds: [row.userId],
      })
      outcome = result.credentialsIssued > 0 ? 'sent' : result.credentialsNotSent > 0 ? 'not_sent' : 'already_had'
    } catch (error) {
      outcome =
        error instanceof ApiError && (error.code === 'survey_not_distributable' || error.code === 'survey_window_closed')
          ? 'not_open'
          : 'error'
    }
    if (outcome === 'sent') {
      const issuedOn = today()
      setIssuedHere((current) => ({ ...current, [row.userId]: issuedOn }))
      // A key minted here supersedes a withdrawal made here earlier in this sitting.
      setRevokedHere((current) => {
        if (!current.has(row.userId)) return current
        const next = new Set(current)
        next.delete(row.userId)
        return next
      })
    }
    setSendCode({ phase: 'done', name: row.name, email: row.email, outcome })
    setSendCodeTarget(null)
  }

  /**
   * Reminds one person to finish, without minting anything.
   *
   * <p>Nothing is marked locally afterwards, unlike `reissueFor` -- there is no new issue date,
   * because no key changed. The row is as true after this call as it was before, which is the
   * whole difference between the two actions.</p>
   */
  async function remindFor(row: SurveyRosterRow) {
    let outcome: SurveyCredentialRemindOutcome | { kind: 'error' }
    try {
      outcome = await remindSurveyCredential(baseUrl, state.status === 'ready' ? state.view.surveyId : '', row.userId)
    } catch {
      outcome = { kind: 'error' }
    }
    if (outcome.kind === 'sent') {
      setRemindedHere((seen) => ({
        ...seen,
        [row.userId]: { on: outcome.remindedOn, count: outcome.reminderCount },
      }))
    }
    setRemind({ phase: 'done', name: row.name, email: row.email, outcome })
    setRemindTarget(null)
  }

  /**
   * Withdraws one person's key for this survey. On success the row is marked locally so it
   * reads "Sin código" at once and the button cannot be pressed twice; the account, the
   * audience and the invitation are untouched, so nothing else on the page moves.
   */
  async function revokeFor(row: SurveyRosterRow) {
    let outcome: SurveyCredentialRevokeOutcome | { kind: 'error' }
    try {
      outcome = await revokeSurveyCredential(baseUrl, state.status === 'ready' ? state.view.surveyId : '', row.userId)
    } catch {
      outcome = { kind: 'error' }
    }
    if (outcome.kind === 'revoked') {
      setRevokedHere((current) => new Set(current).add(row.userId))
    }
    setRevoke({ phase: 'done', name: row.name, outcome })
    setRevokeTarget(null)
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

  const filterOptions = filters.map((option) => ({ value: option.value, label: `${copy(option.key)} · ${option.count}` }))

  return (
    <section aria-label={copy('title')} className="mt-6" data-testid="survey-roster-panel">
      <Card className="px-5">
        <h2 className="m-0 text-2xl">{copy('title')}</h2>
        <p className="m-0 text-sm text-fg-secondary">{copy('intro')}</p>

        {state.status === 'idle' ? null : state.status === 'loading' ? (
          <LoadingState rows={3} label={t('common.loading')} />
        ) : state.status === 'error' ? (
          <p role="alert" className="m-0 text-sm text-accent-red-ink">
            {copy('loadFailed')}
          </p>
        ) : state.view.roster.length === 0 ? (
          <p className="m-0 text-sm text-fg-secondary">{copy('emptyRoster')}</p>
        ) : (
          <>
            {!showState ? (
              <Note className="text-sm">{copy('notTracked')}</Note>
            ) : completionOnly ? (
              <Note className="text-sm">{copy('completionOnlyNote')}</Note>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              {/* The spec's `.seg` from `sm` up: one row, the chosen filter raised on the track.
                  Below `sm` four segments with their counts do not fit in one row, and a wrapped
                  track stops reading as one-of-N (r390-seg.png). HIG `segmented-controls.md`
                  § "Best practices": "keep segment size consistent"; HIG `pop-up-buttons.md`
                  § "Best practices": "Consider using a pop-up button when space is limited". So
                  under `sm` the same options and counts are a native pop-up. Neither is drawn
                  when there is nothing to filter by (a survey that records no state). */}
              {filterOptions.length > 0 && (
              <>
              <SegmentedControl
                label={copy('filterLabel')}
                className="hidden max-w-full sm:inline-flex"
                data-testid="roster-filter-segmented"
                value={filter}
                options={filterOptions}
                onChange={setFilter}
              />
              <span data-testid="roster-filter-popup" className="relative inline-flex w-full min-w-0 sm:hidden">
                <select
                  aria-label={copy('filterLabel')}
                  value={filter}
                  onChange={(event) => setFilter(event.target.value as Filter)}
                  className="h-9 w-full min-w-0 appearance-none truncate rounded-md border border-line-control bg-surface-input py-0 pl-3 pr-8 text-base tabular-nums text-fg-primary pointer-coarse:min-h-11"
                >
                  {filterOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary"
                />
              </span>
              </>
              )}
              <Input
                type="search"
                className="w-full sm:ml-auto sm:max-w-72"
                placeholder={copy('search')}
                aria-label={copy('search')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-sm tabular-nums text-fg-secondary">
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
              <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-fill-subtle px-4 py-2.5">
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
                      <span>{outcome.email ?? outcome.userId}</span>
                      {' — '}
                      {copy(OUTCOME_KEY[outcome.code ?? 'send_failed'] ?? 'outcomeSendFailed')}
                    </p>
                  ))}
              </div>
            ) : null}

            {handedOver === null ? null : (
              <div
                role="status"
                aria-label={copy('handoverDoneTitle', { name: handedOver.name })}
                className="flex flex-col gap-2 rounded-xl bg-surface-fill-subtle px-4 py-3"
              >
                <p className="m-0 text-sm font-medium">{copy('handoverDoneTitle', { name: handedOver.name })}</p>
                <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  <dt className="text-xs text-fg-secondary">{copy('handoverUsername')}</dt>
                  <dd className="m-0 font-mono text-sm">{handedOver.username}</dd>
                  <dt className="text-xs text-fg-secondary">{copy('handoverPassword')}</dt>
                  <dd className="m-0 font-mono text-sm">{handedOver.password}</dd>
                </dl>
                <p className="m-0 text-xs text-fg-secondary">{copy('handoverDoneNote')}</p>
                {handedOver.hadSignedIn ? (
                  <p className="m-0 text-xs text-fg-secondary">{copy('handoverDoneSignedIn')}</p>
                ) : null}
                <div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setHandedOver(null)}>
                    {copy('handoverDismiss')}
                  </Button>
                </div>
              </div>
            )}

            {sendCode.phase === 'done' ? (
              <p
                role="status"
                className={sendCode.outcome === 'sent' ? 'm-0 text-sm font-medium' : 'm-0 text-sm font-medium text-accent-red-ink'}
              >
                {copy(SEND_CODE_OUTCOME_KEY[sendCode.outcome], { name: sendCode.name, email: sendCode.email })}
              </p>
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

            {remind.phase === 'done' ? (
              <p
                role="status"
                className={
                  remind.outcome.kind === 'sent' ? 'm-0 text-sm font-medium' : 'm-0 text-sm font-medium text-accent-red-ink'
                }
              >
                {remind.outcome.kind === 'sent'
                  ? copy('remindSent')
                  : remind.outcome.kind === 'send_failed'
                    ? copy('remindFailed')
                    : remind.outcome.kind === 'refused'
                      ? copy(REMIND_REFUSAL_KEY[remind.outcome.code] ?? 'reissueError')
                      : copy('reissueError')}
              </p>
            ) : null}

            {revoke.phase === 'done' ? (
              <p
                role="status"
                className={
                  revoke.outcome.kind === 'revoked' ? 'm-0 text-sm font-medium' : 'm-0 text-sm font-medium text-accent-red-ink'
                }
              >
                {revoke.outcome.kind === 'revoked'
                  ? // A live session is said out loud rather than left to be discovered: sessions
                    // are stamped per person, so one opened with this key cannot be ended without
                    // ending that person's other surveys' sessions too.
                    revoke.outcome.hadSignedIn
                    ? copy('revokeDoneSignedIn', { name: revoke.name })
                    : copy('revokeDone', { name: revoke.name })
                  : revoke.outcome.kind === 'refused'
                    ? copy(REVOKE_REFUSAL_KEY[revoke.outcome.code] ?? 'revokeError')
                    : copy('revokeError')}
              </p>
            ) : null}

            {exclusionNote === null ? null : (
              <p role="status" className="m-0 text-sm font-medium">
                {exclusionNote}
              </p>
            )}

            {visible.length === 0 ? (
              <p className="m-0 text-sm text-fg-secondary">{copy('empty')}</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-line-panel">
                <Table className="text-sm">
                  <TableHeader>
                    <TableRow>
                      {perSurvey ? null : (
                        <TableHead scope="col">
                          <Checkbox
                            checked={allShownChosen}
                            disabled={sendable.length === 0}
                            aria-label={copy('selectAll')}
                            onCheckedChange={toggleAllShown}
                          />
                        </TableHead>
                      )}
                      <TableHead scope="col">{copy('colPerson')}</TableHead>
                      <TableHead scope="col">{copy('colRole')}</TableHead>
                      <TableHead scope="col">{copy('colUsuario')}</TableHead>
                      {perSurvey ? (
                        <TableHead scope="col">{copy('colCode')}</TableHead>
                      ) : null}
                      {showState ? (
                        <>
                          <TableHead scope="col">{copy('colStatus')}</TableHead>
                          <TableHead scope="col">{copy('colLast')}</TableHead>
                        </>
                      ) : null}
                      <TableHead scope="col" />
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
                        remindedHere={remindedHere[row.userId] ?? null}
                        revokedHere={revokedHere.has(row.userId)}
                        onReissue={() => setReissueTarget(row)}
                        onSendCode={() => setSendCodeTarget(row)}
                        superAdmin={superAdmin}
                        onHandover={() => setHandoverTarget(row)}
                        onRemind={() => setRemindTarget(row)}
                        onRevoke={() => setRevokeTarget(row)}
                        excluded={excludedHere[row.userId] ?? row.excludedFromResults === true}
                        onExclusion={(exclude) => setExclusionTarget({ row, exclude })}
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

      {/* The opposite promise to the reissue dialog below, and said just as plainly: this one
          changes nothing. An operator who has been told all month that resending replaces the
          password needs to read that this does not. */}
      <ConfirmationDialog
        open={remindTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemindTarget(null)
        }}
        title={copy('remindTitle', { name: remindTarget?.name ?? '' })}
        // The history is appended to the promise, not substituted for it: somebody being
        // reminded a second time still needs telling that nothing about their sign-in changes.
        // ESPH's client sent SEVEN names on 2026-10-30 and five were mailed; a list that
        // arrives again next week overlaps, and this sentence is what stops the overlap
        // becoming a second identical mail nobody meant to send.
        description={[
          copy('remindBody', { email: remindTarget?.email ?? '', survey: surveyTitle }),
          remindAlready === null
            ? null
            : copy(remindAlready.count > 1 ? 'remindBodyAgainSome' : 'remindBodyAgainOne', {
                count: remindAlready.count,
                date: formatParticipationDay(remindAlready.on, locale),
              }),
        ]
          .filter((line) => line !== null)
          .join(' ')}
        confirmText={copy(remindAlready === null ? 'remind' : 'remindAgain')}
        cancelText={t('common.cancel')}
        onConfirm={() => (remindTarget === null ? undefined : remindFor(remindTarget))}
      />

      {/* Names the one recipient and the rule, before anything is sent. */}
      <ConfirmationDialog
        open={sendCodeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setSendCodeTarget(null)
        }}
        title={copy('sendCodeTitle', { name: sendCodeTarget?.name ?? '' })}
        description={copy('sendCodeBody', { email: sendCodeTarget?.email ?? '', survey: surveyTitle })}
        confirmText={copy('sendCode')}
        cancelText={t('common.cancel')}
        onConfirm={() => (sendCodeTarget === null ? undefined : sendCodeFor(sendCodeTarget))}
      />

      <ConfirmationDialog
        open={reissueTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReissueTarget(null)
        }}
        title={copy('reissueTitle', { name: reissueTarget?.name ?? '' })}
        // A permanent bounce is said BEFORE another mail goes to the same dead address: on 20 Oct
        // ten ESPH addresses bounced and two were re-sent to the same address days later.
        description={[
          copy('reissueBody', {
            email: reissueTarget?.email ?? '',
            survey: surveyTitle,
            username: reissueTarget?.surveyUsername ?? '',
          }),
          reissueTarget?.deliveryProblem === 'bounced' && reissueTarget.deliveryProblemOn
            ? copy('reissueBodyBounced', { date: formatParticipationDay(reissueTarget.deliveryProblemOn, locale) })
            : null,
        ]
          .filter((line) => line !== null)
          .join(' ')}
        confirmText={copy('reissue')}
        cancelText={t('common.cancel')}
        onConfirm={() => (reissueTarget === null ? undefined : reissueFor(reissueTarget))}
      />

      {/* The handover says, before anything changes, that nothing is mailed, that the password is
          shown once, and -- for a key already used -- that a session open elsewhere stays open. */}
      <ConfirmationDialog
        open={handoverTarget !== null}
        onOpenChange={(open) => {
          if (!open) setHandoverTarget(null)
        }}
        title={copy('handoverTitle', { name: handoverTarget?.name ?? '' })}
        description={[
          copy('handoverBody', { survey: surveyTitle, username: handoverTarget?.surveyUsername ?? '' }),
          (handoverTarget?.lastSignInOn ?? null) !== null ? copy('handoverBodySignedIn') : null,
        ]
          .filter((line) => line !== null)
          .join(' ')}
        confirmText={copy('handover')}
        cancelText={t('common.cancel')}
        onConfirm={() => (handoverTarget === null ? undefined : handoverFor(handoverTarget))}
      />

      {/* What withdrawing a key does and does NOT do, before it is done: the survey closes to
          this person, their other surveys keep working, and the email already sent cannot be
          unsent. */}
      <ConfirmationDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null)
        }}
        title={copy('revokeTitle', { name: revokeTarget?.name ?? '' })}
        description={copy('revokeBody', {
          name: revokeTarget?.name ?? '',
          survey: surveyTitle,
          username: revokeTarget?.surveyUsername ?? '',
        })}
        confirmText={copy('revoke')}
        cancelText={t('common.cancel')}
        onConfirm={() => (revokeTarget === null ? undefined : revokeFor(revokeTarget))}
      />

      {superAdmin && state.status === 'ready' ? (
        <ResponseExclusionDialog
          surveyId={state.view.surveyId}
          target={exclusionTarget?.row ?? null}
          exclude={exclusionTarget?.exclude ?? true}
          onOpenChange={(open) => {
            if (!open) setExclusionTarget(null)
          }}
          onDone={(row, excluded) => {
            setExcludedHere((current) => ({ ...current, [row.userId]: excluded }))
            setExclusionNote(t(`surveys.next.roster.exclusion.${excluded ? 'excludeDone' : 'restoreDone'}`, { name: row.name }))
          }}
        />
      ) : null}
    </section>
  )
}

function RosterRows({
  row,
  roleLabel,
  tracked,
  perSurvey,
  issuedHere,
  remindedHere,
  revokedHere,
  onReissue,
  onSendCode,
  onRemind,
  onRevoke,
  superAdmin,
  onHandover,
  excluded,
  onExclusion,
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
  /** A reminder sent from this page, overriding the loaded history for the same reason. */
  remindedHere: { on: string | null; count: number } | null
  /** Withdrawn from this page: the row reads as having no key whatever the payload said. */
  revokedHere: boolean
  onReissue: () => void
  /** Sends a person who holds no key for this survey their first one, and nobody else. */
  onSendCode: () => void
  onRemind: () => void
  onRevoke: () => void
  /** A super admin may hand a new password over in person; nobody else is offered it. */
  superAdmin: boolean
  onHandover: () => void
  /** This person's response is out of the results. Only ever true for a super admin. */
  excluded: boolean
  /** Opens the exclusion dialog: true to take the response out, false to put it back. */
  onExclusion: (exclude: boolean) => void
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
  // A key withdrawn from this page is gone, so it outranks both the payload and a reissue.
  const surveyUsername = revokedHere ? null : row.surveyUsername ?? null
  const issuedOn = revokedHere ? null : issuedHere ?? row.credentialIssuedOn ?? null
  const signedInOn = revokedHere ? null : row.lastSignInOn ?? null
  // A reminder sent from this page outranks the payload. A withdrawn key takes its reminder
  // history with it: the cell then reads as holding no key at all, and "reminded twice" about a
  // key nobody holds would be a claim about nothing.
  const remindedOn = revokedHere ? null : remindedHere?.on ?? row.lastRemindedOn ?? null
  const reminderCount = revokedHere ? 0 : remindedHere?.count ?? row.reminderCount ?? 0
  // Decided from what this row shows NOW, not from the payload: a key reissued or withdrawn on
  // this page has already moved `issuedOn`, and the action has to follow it.
  const chase = chaseActionFor(
    // `surveyUsername` here is the revoke-aware one above: a key withdrawn on this page is gone, and
    // reading the payload's username kept such a row looking as if it still held one.
    { status: row.status, surveyUsername, credentialIssuedOn: issuedOn, lastSignInOn: signedInOn },
    perSurvey ? 'per_survey' : 'shared',
  )
  // The server refuses a withdrawal for anyone who has answered, so the button says so instead
  // of offering an action that cannot succeed. `not_completed` is the ANONYMOUS survey's "we
  // cannot know", so it is not treated as having answered -- the server decides that one.
  const hasAnswered = row.status === 'completed' || row.status === 'started'
  // What the mail service reported about this key's mail. A key reissued or handed over from
  // this page is newer than any failure the payload knows about, and a withdrawn one has no mail.
  const deliveryProblem = revokedHere || issuedHere !== null ? null : row.deliveryProblem ?? null
  const deliveryProblemOn = row.deliveryProblemOn ?? null
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
            <span className="truncate text-sm text-fg-secondary">{row.email}</span>
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
              {/* Shown only when there IS one. A "never reminded" line on every row of eight
                  hundred would be noise, and its absence already says so -- unlike the sign-in
                  line above, where "has not signed in" is the finding an operator is looking
                  for. The count is what separates "reminded once, last week" from "reminded
                  four times": the same date, and a different decision about chasing again. */}
              {deliveryProblem === null || deliveryProblemOn === null ? null : (
                <span className="text-xs font-medium text-accent-red-ink">
                  {copy(DELIVERY_PROBLEM_KEY[deliveryProblem], { date: formatParticipationDay(deliveryProblemOn, locale) })}
                </span>
              )}
              {issuedOn === null || remindedOn === null ? null : (
                <span className="text-xs text-fg-secondary">
                  {reminderCount > 1
                    ? copy('remindedTimes', {
                        count: reminderCount,
                        date: formatParticipationDay(remindedOn, locale),
                      })
                    : copy('remindedOnce', { date: formatParticipationDay(remindedOn, locale) })}
                </span>
              )}
              {/* Which chase this person needs, from the one module that decides it. Until the
                  reminder existed, somebody who had signed in got a DISABLED reissue and a note
                  saying why -- a dead end on exactly the people worth chasing. Now they get the
                  action that fits them. */}
              {chase === 'invite' ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={copy('sendCodeFor', { name: row.name })}
                  onClick={onSendCode}
                >
                  {copy('sendCode')}
                </Button>
              ) : chase === 'remind' ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  // Says which it is. Clicking "Enviar recordatorio" on somebody who was
                  // reminded yesterday reads as the first one; the label is the last chance to
                  // notice before a second mail leaves.
                  aria-label={copy(reminderCount > 0 ? 'remindAgainFor' : 'remindFor', { name: row.name })}
                  onClick={onRemind}
                >
                  {copy(reminderCount > 0 ? 'remindAgain' : 'remind')}
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    // With no key there is nothing to reissue -- the invitation mints the first
                    // one. `chase` has already taken the signed-in case to the reminder above,
                    // so what is left here is "never used it" (send a new one) and "finished".
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
                </>
              )}
              {/* Any key not yet finished with, used or not: the in-person route is for exactly the
                  people the mailed routes cannot reach. */}
              {superAdmin && issuedOn !== null && row.status !== 'completed' ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={copy('handoverFor', { name: row.name })}
                  onClick={onHandover}
                >
                  {copy('handover')}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                // With no key there is nothing to withdraw, and the server refuses somebody who
                // has answered -- withdrawing their key would not withdraw the response.
                disabled={issuedOn === null || hasAnswered}
                aria-label={copy('revokeFor', { name: row.name })}
                aria-describedby={issuedOn === null || hasAnswered ? `revoke-why-${row.userId}` : undefined}
                onClick={onRevoke}
              >
                {copy('revoke')}
              </Button>
              {issuedOn === null || hasAnswered ? (
                <span id={`revoke-why-${row.userId}`} className="text-xs text-fg-secondary">
                  {issuedOn === null ? copy('revokeWhyNoCode') : copy('revokeWhyAnswered')}
                </span>
              ) : null}
            </span>
          </TableCell>
        ) : null}
        {tracked ? (
          <>
            <TableCell className="px-3 py-2">
              <span className="flex flex-col items-start gap-1">
                <Chip tone="neutral" icon={STATUS_ICON[row.status]} label={copy(STATUS_KEY[row.status])} />
                {excluded ? <Chip tone="neutral" label={copy('exclusion.excludedChip')} /> : null}
                {/* Only somebody who FINISHED has a response in the results to take out, and
                    only TIMS may: the server refuses anyone else, and a client administrator
                    never learns whose response left (it would undo the anonymity by subtraction). */}
                {superAdmin && row.status === 'completed' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={copy(excluded ? 'exclusion.restoreFor' : 'exclusion.excludeFor', { name: row.name })}
                    onClick={() => onExclusion(!excluded)}
                  >
                    {copy(excluded ? 'exclusion.restore' : 'exclusion.exclude')}
                  </Button>
                ) : null}
              </span>
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
            variant="ghost"
            size="icon"
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
