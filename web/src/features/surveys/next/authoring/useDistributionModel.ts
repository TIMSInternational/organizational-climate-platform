import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { useCompanyScope } from '../../../../company-context'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { listDepartments, type Department } from '../../../org-structure/api/departments'
import { listUsers, type User } from '../../../org-structure/api/users'
import {
  getSurvey,
  setSurveyCollectParticipantIdentity,
  setSurveySelfDeclaredDemographics,
  setSurveyOneSessionOnly,
  type SurveyDetail,
} from '../../api/surveys'
import {
  createSurveyInvitations,
  getSurveyDistribution,
  isPerSurvey,
  listSurveyInvitations,
  regenerateSurveyLink,
  revokeSurveyInvitation,
  revokeSurveyLink,
  updateSurveyDistribution,
  type SurveyAudienceSelection,
  type SurveyDistributionDetail,
  type SurveyInvitationBatchResult,
  type SurveyInvitationList,
} from '../../api/surveyDistribution'
import { describeApiError } from '../../../../api/describeApiError'

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
      kind: 'per_survey'
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
  /** Turns the public link's self-declared demographic questions on or off. */
  setSelfDeclaredDemographics: (next: boolean) => void
  /** Turns "ask who is answering" on the public link on or off. */
  setCollectParticipantIdentity: (next: boolean) => void
  setOneSessionOnly: (next: boolean) => void
}

/**
 * The model behind `/surveys/:surveyId/distribution` — THE wiring seam of Distribución,
 * redesigned. The reads and writes are the previous page's (`pages/SurveyDistributionPage.tsx`,
 * kept as the wiring reference): the survey first, because its `companyId` decides whether the
 * directory may be asked for at all; then the distribution (null on 404) and the invitation list
 * in the reader's language, whose `anonymity.guarantee` is the sentence the server writes.
 *
 * Three of the old page's writes are deliberately NOT here, because none of them can do what it
 * says: the per-invitation resend (the server answers 410 since the invitation email was deleted),
 * the reminder (it answers zeros by design), and the invitation's own text (no email reads it).
 */
export function useDistributionModel(surveyId: string) {
  const { t, locale } = useTranslation()
  const scope = useCompanyScope()
  const caps = useViewerCapabilities()
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
      const scoped = caps.canAuthorSurveys && scope.status === 'ready' && scope.companyId === survey.companyId
      let departments: Department[] = []
      let users: User[] = []
      if (scoped) {
        const [departmentList, userList] = await Promise.allSettled([
          listDepartments(baseUrl, survey.companyId),
          listUsers(baseUrl, survey.companyId),
        ])
        departments = departmentList.status === 'fulfilled' ? departmentList.value : []
        users = userList.status === 'fulfilled' ? userList.value : []
      }
      setState({ status: 'ready', model: { survey, distribution, invitations, departments, users, scoped } })
    } catch (error) {
      setState({ status: 'error', message: describeApiError(error, t, 'surveys.distribution.loadFailed') })
    }
  }, [baseUrl, caps.canAuthorSurveys, locale, scope.companyId, scope.status, surveyId, t])

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
        setActionError(describeApiError(error, t, 'surveys.distribution.actionFailed'))
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
    setBusy(true)
    setActionError(null)
    setNotice(null)
    setOutcome(null)
    setProgress(perSurvey ? { done: 0, total: null } : null)
    let issued = 0
    let remaining: number | null = null
    let total: number | null = null
    let created = 0
    let skipped = 0
    const failed = new Set<string>()
    let stopped = false
    try {
      for (let call = 0; call < MAX_SEND_CALLS; call += 1) {
        const result: SurveyInvitationBatchResult = await createSurveyInvitations(baseUrl, surveyId, selection)
        created += result.created
        skipped += result.skippedUserIds.length
        if (!perSurvey) break
        issued += result.credentialsIssued
        remaining = result.remaining ?? 0
        // Everyone who held no key when this started: this call's keys plus everyone still
        // without one -- which counts the ones whose mail just failed, as it should.
        if (total === null) total = result.credentialsIssued + remaining
        for (const email of result.credentialsNotSentEmails ?? []) failed.add(email)
        setProgress({ done: issued, total })
        if (remaining === 0 || result.credentialsIssued === 0) break
      }
    } catch {
      // The server's message is English and about one call; the page says what it means for
      // the whole send, which is that it can be resumed.
      stopped = true
    }
    setOutcome(
      perSurvey
        ? { kind: 'per_survey', issued, remaining, failedEmails: [...failed].sort(), stopped }
        : stopped
          ? null
          : { kind: 'shared', created, skipped },
    )
    if (!perSurvey && stopped) setActionError(t('surveys.next.distribution.send.sharedFailed'))
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
