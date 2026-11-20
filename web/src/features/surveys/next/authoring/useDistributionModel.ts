import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { administersSurvey, readViewerClaims } from '../../../../auth/viewerCapabilities'
import { listDepartments, type Department } from '../../../org-structure/api/departments'
import { listUsers, type User } from '../../../org-structure/api/users'
import { credentialModeOf as companyCredentialModeOf, getCompanySettings, type CredentialMode } from '../../../org-structure/api/companySettings'
import {
  getSurvey,
  setSurveyCollectParticipantIdentity,
  setSurveySelfDeclaredDemographics,
  setSurveyCredentialMode,
  setSurveyOneSessionOnly,
  type SurveyCredentialMode,
  type SurveyDetail,
} from '../../api/surveys'
import {
  createSurveyInvitations,
  getSurveyDistribution,
  isPerSurvey,
  isPersonalLink,
  listSurveyInvitations,
  regenerateSurveyLink,
  resendSurveyInvitation,
  revokeSurveyInvitation,
  revokeSurveyLink,
  updateSurveyDistribution,
  type SurveyAudienceSelection,
  type SurveyDistributionDetail,
  type SurveyInvitationBatchResult,
  type SurveyInvitationList,
} from '../../api/surveyDistribution'
import { ApiError } from '../../../../api/authFetch'
import { describeApiError, describeKnownRefusal } from '../../../../api/describeApiError'
import { describeNotAuthorized } from '../../api/authorizedList'
import { credentialModeOf } from './audienceEdit'

export interface DistributionModel {
  survey: SurveyDetail
  /** Null when the survey has no distribution row yet — the normal state of a new survey. */
  distribution: SurveyDistributionDetail | null
  invitations: SurveyInvitationList
  /** The survey company's directory; empty for a viewer scoped elsewhere, who is offered nothing. */
  departments: Department[]
  users: User[]
  /** The viewer administers the survey's own company — the audience may be read and changed. */
  scoped: boolean
  /**
   * The company's IANA zone, which the survey's window is written in; `null` when it could not
   * be read (the page then reads the browser's, and says nothing it cannot back). Read exactly
   * as the detail page reads it (`useSurveyDetailModel`), so the two print one close date.
   */
  timeZone?: string | null
  /**
   * The mode «Cómo entran las personas» returns the survey to when it is switched OFF
   * (`linkOffModeFor`): the mode the survey had when the page loaded, or the company's when it
   * was already `personal_link`. Null when neither is known -- the company's settings could not be
   * read -- and then the switch does not offer to turn it off at all.
   */
  linkOffMode?: CredentialMode | null
}

/**
 * Where turning `personal_link` OFF takes a survey, and never a hard-coded `shared`.
 *
 * The API cannot undo a wrong answer: `shared` -> `per_survey` is frozen (`credential_mode_frozen`,
 * #617). A `per_survey` survey switched on and then off that landed on `shared` -- in a company
 * whose accounts have no password, because its people sign in with per-survey keys -- would mint
 * invitation rows and no keys, and nobody could sign in to answer it (review of 2026-11-18). So:
 *
 * - the survey's own mode, when it is not `personal_link` -- on and off again in one visit puts it
 *   back exactly as it was;
 * - otherwise the company's mode, which is the mode a new survey in that company takes
 *   (`NewSurveyDefaults.Apply`), and the one its accounts are set up for;
 * - otherwise null: nothing known, nothing offered.
 */
export function linkOffModeFor(
  surveyMode: ReturnType<typeof credentialModeOf>,
  companyMode: CredentialMode | null,
): CredentialMode | null {
  return surveyMode === 'personal_link' ? companyMode : surveyMode
}

export type DistributionState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; model: DistributionModel }

/**
 * Calls one send may make before it gives up on its own. 100 keys a call (`MaxCredentialBatch`)
 * makes this 5,000 people -- eight times ESPH's 617 -- so it is a guard against a server that
 * keeps answering "remaining" without progress, never a limit anybody meets.
 */
export const MAX_SEND_CALLS = 50

/** A send in flight: keys mailed so far over the people who held none when it started. */
export interface SendProgress {
  done: number
  /** Null until the first call answers: before that nobody knows how many still need a key. */
  total: number | null
}

/**
 * What one press of "Enviar" did, summed over every call it made — the server's numbers, not the
 * page's: `issued` is `credentialsIssued`, `remaining` is the last call's `remaining`.
 */
export type SendOutcome =
  | {
      /** `per_survey` mails keys; `personal_link` mails each person their own link. Same loop, same numbers. */
      kind: 'per_survey' | 'personal_link'
      issued: number
      /** Null when no call answered at all: then nobody knows how many still need a key. */
      remaining: number | null
      /** Every address whose mail failed during this send, once each. */
      failedEmails: string[]
      /** A call failed: the send stopped with people still to reach. Running it again resumes. */
      stopped: boolean
    }
  | { kind: 'shared'; created: number; skipped: number }

/** Every write the page offers. */
export interface DistributionActions {
  invite: (selection: SurveyAudienceSelection) => void
  createLink: () => void
  regenerateLink: () => void
  revokeLink: () => void
  revokeInvitation: (invitationId: string) => void
  /** `personal_link` only: mail ONE person a fresh link; their previous one stops working. */
  resendInvitation: (invitationId: string, email: string) => void
  /**
   * Moves the survey to or from `personal_link`. The API accepts it only while nothing has been
   * issued under the current mode, and answers 400 `credential_mode_in_use` otherwise. Off is
   * `DistributionModel.linkOffMode`, never a hard-coded `shared`.
   */
  setCredentialMode: (next: SurveyCredentialMode) => void
  /** Turns the public link's self-declared demographic questions on or off. */
  setSelfDeclaredDemographics: (next: boolean) => void
  /** Turns "ask who is answering" on the public link on or off. */
  setCollectParticipantIdentity: (next: boolean) => void
  setOneSessionOnly: (next: boolean) => void
  /** `accessRules.activeOutsideSchedule`: the open link opens before the start date. */
  setOpensBeforeStart: (next: boolean) => void
}

/**
 * The model behind `/surveys/:surveyId/distribution` — THE wiring seam of Distribución,
 * redesigned. The reads and writes are the previous page's (`pages/SurveyDistributionPage.tsx`,
 * kept as the wiring reference): the survey first, because its `companyId` decides whether the
 * directory may be asked for at all; then the distribution (null on 404) and the invitation list
 * in the reader's language, whose `anonymity.guarantee` is the sentence the server writes.
 *
 * Of the old page's writes, the reminder is deliberately NOT here: it answers zeros by design, and
 * the 2026-11-18 ruling kept it that way ("reminders still never"). The per-invitation resend and
 * the invitation's own text came back with that ruling, for `personal_link` surveys only -- the
 * one mode whose email reads the text and whose resend answers (410 in the other two). The text is
 * edited in `InvitationEmailDialog`, which loads and saves on its own.
 */
export function useDistributionModel(surveyId: string) {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [state, setState] = useState<DistributionState>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [progress, setProgress] = useState<SendProgress | null>(null)
  const [outcome, setOutcome] = useState<SendOutcome | null>(null)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const survey = await getSurvey(baseUrl, surveyId, locale)
      const [distribution, invitations] = await Promise.all([
        getSurveyDistribution(baseUrl, surveyId),
        listSurveyInvitations(baseUrl, surveyId, {}, locale),
      ])
      // The survey's own company decides, never the header: gating on the header dropped the
      // roster and every per-person button for a TIMS operator whose header held another client
      // (docs/audits/2026-11-08-operator-ui-walkthrough.md, A1).
      const scoped = administersSurvey(readViewerClaims(), survey)
      let departments: Department[] = []
      let users: User[] = []
      let timeZone: string | null = null
      let companyMode: CredentialMode | null = null
      if (scoped) {
        const [departmentList, userList, settings] = await Promise.allSettled([
          listDepartments(baseUrl, survey.companyId),
          listUsers(baseUrl, survey.companyId),
          getCompanySettings(baseUrl, survey.companyId),
        ])
        departments = departmentList.status === 'fulfilled' ? departmentList.value : []
        users = userList.status === 'fulfilled' ? userList.value : []
        timeZone = settings.status === 'fulfilled' ? (settings.value?.settings?.timezone ?? null) : null
        companyMode = settings.status === 'fulfilled' && settings.value?.settings ? companyCredentialModeOf(settings.value.settings) : null
      }
      // Read once, here, from the survey as it loaded: the refresh after the switch re-reads the
      // survey (now `personal_link`) and keeps this, so on-then-off restores what it was.
      const linkOffMode = linkOffModeFor(credentialModeOf(survey), companyMode)
      setState({ status: 'ready', model: { survey, distribution, invitations, departments, users, scoped, timeZone, linkOffMode } })
    } catch (error) {
      setState({ status: 'error', message: describeApiError(error, t, 'surveys.distribution.loadFailed') })
    }
  }, [baseUrl, locale, surveyId, t])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * `refreshSurvey` exists because the refresh below re-reads the distribution and the
   * invitations but NOT the survey, which is correct for every action that only touches
   * those two. An action that writes `survey.settings` has to ask for it: without this the
   * toggle would flip, the write would succeed, and the control would snap back to the
   * stale value it was rendered from.
   */
  const run = useCallback(
    async (action: () => Promise<string | null>, options?: { refreshSurvey?: boolean }): Promise<boolean> => {
      setBusy(true)
      setActionError(null)
      setNotice(null)
      setOutcome(null)
      try {
        setNotice(await action())
        if (state.status === 'ready') {
          const [distribution, invitations, survey] = await Promise.all([
            getSurveyDistribution(baseUrl, surveyId),
            listSurveyInvitations(baseUrl, surveyId, {}, locale),
            options?.refreshSurvey ? getSurvey(baseUrl, surveyId, locale) : Promise.resolve(null),
          ])
          setState({
            status: 'ready',
            model: { ...state.model, distribution, invitations, ...(survey ? { survey } : {}) },
          })
        }
        return true
      } catch (error) {
        setActionError(describeNotAuthorized(error, t) ?? describeApiError(error, t, 'surveys.distribution.actionFailed'))
        return false
      } finally {
        setBusy(false)
      }
    },
    [baseUrl, locale, state, surveyId, t],
  )

  const send = async (selection: SurveyAudienceSelection) => {
    if (state.status !== 'ready') return
    const perSurvey = isPerSurvey(state.model.invitations)
    const personalLink = isPersonalLink(state.model.invitations)
    // Both mail one message per person, 100 per call, and answer `remaining` -- one loop.
    const batched = perSurvey || personalLink
    setBusy(true)
    setActionError(null)
    setNotice(null)
    setOutcome(null)
    setProgress(batched ? { done: 0, total: null } : null)
    let issued = 0
    let remaining: number | null = null
    let total: number | null = null
    let created = 0
    let skipped = 0
    const failed = new Set<string>()
    let stopped = false
    // A refusal that says WHY no link may go, in the reader's words. Only this one: every other
    // failure keeps the "stopped, resume" outcome below exactly as before.
    let refusal: string | null = null
    try {
      for (let call = 0; call < MAX_SEND_CALLS; call += 1) {
        const result: SurveyInvitationBatchResult = await createSurveyInvitations(baseUrl, surveyId, selection)
        created += result.created
        skipped += result.skippedUserIds.length
        if (!batched) break
        const mailed = perSurvey ? result.credentialsIssued : (result.linksSent ?? 0)
        issued += mailed
        remaining = result.remaining ?? 0
        // Everyone who held no key (or no link) when this started: this call's plus everyone
        // still without one -- which counts the ones whose mail just failed, as it should.
        if (total === null) total = mailed + remaining
        for (const email of (perSurvey ? result.credentialsNotSentEmails : result.linksNotSentEmails) ?? []) failed.add(email)
        setProgress({ done: issued, total })
        if (remaining === 0 || mailed === 0) break
      }
    } catch (error) {
      // The server's message is English and about one call; the page says what it means for
      // the whole send, which is that it can be resumed...
      stopped = true
      // ...except when the API refused a personal link to somebody outside the survey's audience
      // (`personal_link_not_in_audience`): nothing went, and resuming would be refused again. The
      // operator is told why and what to do -- widen the audience, or send to fewer people.
      if (error instanceof ApiError && error.code === 'personal_link_not_in_audience') refusal = describeKnownRefusal(error, t)
      // ...or somebody it would reach is not on the client's authorized list: named, nothing went.
      refusal ??= describeNotAuthorized(error, t)
    }
    setOutcome(
      refusal !== null
        ? null
        : batched
          ? { kind: personalLink ? 'personal_link' : 'per_survey', issued, remaining, failedEmails: [...failed].sort(), stopped }
          : stopped
            ? null
            : { kind: 'shared', created, skipped },
    )
    if (refusal !== null) setActionError(refusal)
    else if (!batched && stopped) setActionError(t('surveys.next.distribution.send.sharedFailed'))
    setProgress(null)
    try {
      const [distribution, invitations] = await Promise.all([
        getSurveyDistribution(baseUrl, surveyId),
        listSurveyInvitations(baseUrl, surveyId, {}, locale),
      ])
      setState({ status: 'ready', model: { ...state.model, distribution, invitations } })
    } catch {
      // The outcome above is already true; a failed re-read leaves the previous counts on screen.
    }
    setBusy(false)
  }

  const perInvitation = (invitationId: string, act: (id: string) => Promise<unknown>) => {
    setBusyInvitationId(invitationId)
    void run(async () => {
      await act(invitationId)
      return null
    }).finally(() => setBusyInvitationId(null))
  }

  const actions: DistributionActions = {
    /**
     * `POST /surveys/{id}/invitations`, repeated until nobody is left (#G9).
     *
     * `per_survey` mints and mails at most 100 keys per call -- each costs a bcrypt hash and a
     * message against App Runner's 120 s request ceiling -- and answers how many people in the
     * audience still hold none. So the SAME request is sent again while that is above zero and
     * the last call made progress. Stopping on a call that issued nothing is what ends a send
     * whose last few addresses refuse every message, instead of retrying them for ever.
     *
     * It is resumable by construction: the server skips anybody who already holds a key, so
     * pressing it again after a failure -- or after the page was closed mid-send -- carries on
     * from where it stopped and mails nobody twice.
     *
     * `shared` mints invitation rows only, in one call, and mails nothing.
     */
    invite: (selection) => void send(selection),
    /** `PUT /surveys/{id}/distribution` with `accessType: 'public'` mints the share link. */
    createLink: () =>
      void run(async () => {
        await updateSurveyDistribution(baseUrl, surveyId, { accessType: 'public' })
        return null
      }),
    /** The old link stops working and a new one is minted. */
    regenerateLink: () =>
      void run(async () => {
        await regenerateSurveyLink(baseUrl, surveyId)
        return null
      }),
    /** The survey is reachable by invitation only afterwards. */
    revokeLink: () =>
      void run(async () => {
        await revokeSurveyLink(baseUrl, surveyId)
        return null
      }),
    revokeInvitation: (invitationId) => perInvitation(invitationId, (id) => revokeSurveyInvitation(baseUrl, surveyId, id)),
    /**
     * `POST /surveys/{id}/invitations/{invitationId}/resend`. Answers again only on a
     * `personal_link` survey (410 in the other two modes, as since 2026-10-19): a new token,
     * mailed; the old link stops working. A failed send keeps the old one and says so (502).
     */
    resendInvitation: (invitationId, email) => {
      setBusyInvitationId(invitationId)
      void run(async () => {
        await resendSurveyInvitation(baseUrl, surveyId, invitationId)
        return t('surveys.next.distribution.link.resent', { email })
      }).finally(() => setBusyInvitationId(null))
    },
    setCredentialMode: (next) =>
      void run(
        async () => {
          await setSurveyCredentialMode(baseUrl, surveyId, next)
          return t(next === 'personal_link' ? 'surveys.next.distribution.link.modeOn' : 'surveys.next.distribution.link.modeOff')
        },
        { refreshSurvey: true },
      ),
    /**
     * `PUT /surveys/{id}` with only `settings.selfDeclaredDemographics`. Legal while the
     * survey is draft, scheduled or active -- the same set `canDistribute` gates the
     * page's other controls on -- so a live survey can start asking without being
     * reopened.
     */
    setSelfDeclaredDemographics: (next) =>
      void run(
        async () => {
          await setSurveySelfDeclaredDemographics(baseUrl, surveyId, next)
          return t(next ? 'surveys.next.share.demographicsOn' : 'surveys.next.share.demographicsOff')
        },
        { refreshSurvey: true },
      ),
    /** The same narrow `PUT` again. Ends resume for respondents with no account. */
    setOneSessionOnly: (next) =>
      void run(
        async () => {
          await setSurveyOneSessionOnly(baseUrl, surveyId, next)
          return t(next ? 'surveys.next.share.oneSessionOnlyOn' : 'surveys.next.share.oneSessionOnlyOff')
        },
        { refreshSurvey: true },
      ),
    /**
     * `PUT /surveys/{id}/distribution` with ONLY `accessRules.activeOutsideSchedule` -- the server
     * applies access rules field by field (`ApplyAccessRules`), so nothing else moves. The start
     * date cannot move once a survey is active (409 `survey_start_frozen`), so this is the only way
     * a QR survey activated early opens now; PROCOMER's demo needed a script for it on 4 Nov 2026.
     */
    setOpensBeforeStart: (next) =>
      void run(async () => {
        await updateSurveyDistribution(baseUrl, surveyId, { accessRules: { activeOutsideSchedule: next } })
        return t(next ? 'surveys.next.share.opensBeforeStartOn' : 'surveys.next.share.opensBeforeStartOff')
      }),
    /** The same narrow `PUT` as the demographics switch, legal on a live survey for the same reason. */
    setCollectParticipantIdentity: (next) =>
      void run(
        async () => {
          await setSurveyCollectParticipantIdentity(baseUrl, surveyId, next)
          return t(next ? 'surveys.next.share.participantIdentityOn' : 'surveys.next.share.participantIdentityOff')
        },
        { refreshSurvey: true },
      ),
  }

  return { state, reload: load, busy, busyInvitationId, notice, actionError, progress, outcome, actions }
}
