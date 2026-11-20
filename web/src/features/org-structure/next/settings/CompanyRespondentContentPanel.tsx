import { useEffect, useId, useState } from 'react'
import { Check } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import {
  Alert,
  AlertDescription,
  Button,
  NetworkError,
  SkeletonText,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../../../components/ui'
import { describeApiError } from '../../../../api/describeApiError'
import {
  getCompanyRespondentContent,
  RespondentContentRefusal,
  saveCompanyRespondentContent,
  type RespondentContentByLocale,
  type RespondentContentView,
  type RespondentTextLocale,
} from '../../../surveys/api/respondentContent'
import {
  contentChanges,
  fieldLabelKey,
  hasChanges,
  ownValues,
  placeholderProblems,
  TEXT_LOCALES,
  withValue,
} from '../../../surveys/respondentContentEditor'
import { RespondentContentFields, TextAlignField, type RefusedField } from '../../../surveys/next/authoring/RespondentContentFields'
import { Panel } from '../super/parts'

const C = 'surveys.next.respondentContent'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string | null }
  | { status: 'ready'; view: RespondentContentView; draft: RespondentContentByLocale }

/**
 * «Textos para quien responde» for a whole company: the words its respondents read on every
 * survey that does not set its own (ruled 2026-11-19, `docs/decisions/editable-respondent-content.md`:
 * survey → company → product default, per locale). A client's wording is typed here once, by
 * TIMS or by the client's administrator, and reaches only that client — the audit's gap #1, where
 * every such request had become a code change that reached every client.
 *
 * Both languages, always, in tabs: a company's surveys may be written in either, and a box left
 * empty in a language shows the product default in that language — never the other language's
 * words. The display choice (justified or left) is one for all languages.
 *
 * Loaded and saved on its own, with its own button, through `GET/PUT
 * /admin/companies/{id}/respondent-content`, so the settings form it sits beside does not grow a
 * second state machine. Mounted on both company screens: a super admin's for any company, a
 * company admin's for their own — the same rule the route enforces.
 */
export default function CompanyRespondentContentPanel({ companyId, className }: { companyId: string; className?: string }) {
  const { t } = useTranslation()
  const ids = useId()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<'saved' | 'nothing' | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [refused, setRefused] = useState<RefusedField | null>(null)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    getCompanyRespondentContent(baseUrl, companyId)
      .then((view) => {
        if (!cancelled) setState({ status: 'ready', view, draft: ownValues(view) })
      })
      .catch((cause: unknown) => {
        if (!cancelled) setState({ status: 'error', message: describeApiError(cause, t) })
      })
    return () => {
      cancelled = true
    }
    // `t` is stable per locale; a language switch re-reading the texts is harmless.
  }, [baseUrl, companyId, attempt, t])

  const edit = (locale: RespondentTextLocale | '*', key: string, value: string) => {
    setNotice(null)
    setRefused(null)
    setState((current) => (current.status !== 'ready' ? current : { ...current, draft: withValue(current.draft, locale, key, value) }))
  }

  const problems = state.status === 'ready' ? placeholderProblems(state.view.entries, state.draft, TEXT_LOCALES) : []

  async function save() {
    if (state.status !== 'ready' || problems.length > 0) return
    const changes = contentChanges(ownValues(state.view), state.draft, TEXT_LOCALES)
    if (!hasChanges(changes)) {
      setNotice('nothing')
      return
    }
    setSaving(true)
    setSaveError(null)
    setRefused(null)
    try {
      const view = await saveCompanyRespondentContent(baseUrl, companyId, changes)
      setState({ status: 'ready', view, draft: ownValues(view) })
      setNotice('saved')
    } catch (cause) {
      const reason = describeApiError(cause, t)
      if (cause instanceof RespondentContentRefusal && cause.key !== null) {
        setRefused({ key: cause.key, locale: cause.locale, message: reason })
        setSaveError(
          t(`${C}.refusedField`, {
            field: t(fieldLabelKey(cause.key)),
            locale: cause.locale && cause.locale !== '*' ? t(`surveys.distribution.locale.${cause.locale}`) : '—',
            reason,
          }),
        )
      } else {
        setSaveError(reason)
      }
    } finally {
      setSaving(false)
    }
  }

  const heading = (
    <h2 id={`${ids}-respondent-content`} className="m-0 text-2xl">
      {t(`${C}.company.heading`)}
    </h2>
  )

  return (
    <Panel labelledBy={`${ids}-respondent-content`} heading={heading} meta={t(`${C}.company.meta`)} className={`gap-4 pb-5 ${className ?? ''}`}>
      <div data-slot="company-respondent-content" className="flex flex-col gap-panel-gap">
        <p className="m-0 text-sm text-fg-secondary">{t(`${C}.company.help`)}</p>
        {state.status === 'loading' ? (
          <SkeletonText lines={6} />
        ) : state.status === 'error' ? (
          <NetworkError
            title={t(`${C}.company.loadFailed`)}
            description={state.message ?? undefined}
            onRetry={() => setAttempt((n) => n + 1)}
            retryText={t('common.retry')}
          />
        ) : (
          <>
            <TextAlignField view={state.view} draft={state.draft} disabled={saving} onChange={(value) => edit('*', 'display.textAlign', value)} />
            <Tabs defaultValue={TEXT_LOCALES[0]} className="flex flex-col gap-panel-gap">
              <TabsList>
                {TEXT_LOCALES.map((locale) => (
                  <TabsTrigger key={locale} value={locale}>
                    {t(`surveys.distribution.locale.${locale}`)}
                  </TabsTrigger>
                ))}
              </TabsList>
              {TEXT_LOCALES.map((locale) => (
                <TabsContent key={locale} value={locale}>
                  <RespondentContentFields
                    view={state.view}
                    locale={locale}
                    draft={state.draft}
                    disabled={saving}
                    refused={refused}
                    onChange={edit}
                  />
                </TabsContent>
              ))}
            </Tabs>
            {problems.length > 0 && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>
                  {problems
                    .map((problem) =>
                      t(`${C}.refusedField`, {
                        field: t(fieldLabelKey(problem.key)),
                        locale: t(`surveys.distribution.locale.${problem.locale}`),
                        reason: t(`${C}.unknownPlaceholder`, { placeholder: problem.placeholder }),
                      }),
                    )
                    .join(' ')}
                </AlertDescription>
              </Alert>
            )}
            {saveError && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            )}
            <p role="status" className={notice ? 'm-0 text-sm text-fg-secondary' : 'sr-only'}>
              {notice === 'saved' ? t(`${C}.company.saved`) : notice === 'nothing' ? t(`${C}.company.nothingToSave`) : ''}
            </p>
            <div>
              <Button variant="primary" size="canvas" disabled={saving || problems.length > 0} onClick={() => void save()}>
                <Check aria-hidden="true" />
                {saving ? t('common.saving') : t(`${C}.company.save`)}
              </Button>
            </div>
          </>
        )}
      </div>
    </Panel>
  )
}
