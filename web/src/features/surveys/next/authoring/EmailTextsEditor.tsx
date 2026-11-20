import { useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import {
  Alert,
  AlertDescription,
  Button,
  SegmentedControl,
  SkeletonText,
  TextField,
  TextareaField,
} from '../../../../components/ui'
import { describeApiError } from '../../../../api/describeApiError'
import type { RespondentContentChanges, RespondentContentView, RespondentTextLocale } from '../../api/respondentContent'
import {
  EMAIL_PARTS,
  emailChangesOf,
  emailDraftOf,
  emailKey,
  inheritedEmailText,
  type EmailDraft,
  type EmailPart,
  type EmailPreview,
  type SurveyMail,
} from '../../api/respondentEmail'

const K = 'surveys.emailTexts'

type PreviewState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; preview: EmailPreview }

/**
 * The words of the survey emails, at one level (a survey or a company), one mail at a time:
 * subject and message per language, what an empty field falls back to, and the mail as it
 * would be received, composed by the server from what is SAVED (lane L2 of
 * `docs/decisions/editable-respondent-content.md`).
 *
 * Shared by «Correo de invitación» (`InvitationEmailDialog`, survey level) and the company's
 * «Correos» section (`CompanyEmailTextsSection`). It loads nothing itself: the caller hands it
 * the respondent-content view and the two calls that save and preview, so each level keeps its
 * own route.
 */
export function EmailTextsEditor({
  view,
  mails,
  initialMail,
  onSave,
  loadPreview,
  onSaved,
}: {
  view: RespondentContentView
  mails: readonly SurveyMail[]
  initialMail?: SurveyMail
  onSave: (changes: RespondentContentChanges) => Promise<RespondentContentView>
  loadPreview: (mail: SurveyMail) => Promise<EmailPreview>
  onSaved?: (message: string) => void
}) {
  const { t } = useTranslation()
  const [current, setCurrent] = useState<RespondentContentView>(view)
  const [mail, setMail] = useState<SurveyMail>(initialMail && mails.includes(initialMail) ? initialMail : mails[0])
  const [loaded, setLoaded] = useState<EmailDraft>(() => emailDraftOf(view, mails))
  const [draft, setDraft] = useState<EmailDraft>(() => emailDraftOf(view, mails))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' })
  const [previewVersion, setPreviewVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    setPreview({ status: 'loading' })
    loadPreview(mail)
      .then((next) => { if (!cancelled) setPreview({ status: 'ready', preview: next }) })
      .catch(() => { if (!cancelled) setPreview({ status: 'error' }) })
    return () => { cancelled = true }
  }, [mail, previewVersion, loadPreview])

  const locales = current.requiredLocales
  const editable = current.editable
  const changes = emailChangesOf(loaded, draft, locales)
  const dirty = Object.keys(changes).length > 0

  const entryOf = (key: string) => current.entries.find((entry) => entry.key === key)

  const edit = (locale: RespondentTextLocale, key: string, text: string) =>
    setDraft((before) => ({ ...before, [locale]: { ...before[locale], [key]: text } }))

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      const saved = await onSave(changes)
      setCurrent(saved)
      const next = emailDraftOf(saved, mails)
      setLoaded(next)
      setDraft(next)
      setPreviewVersion((version) => version + 1)
      onSaved?.(t(`${K}.saved`))
    } catch (cause) {
      setSaveError(describeApiError(cause, t))
    } finally {
      setSaving(false)
    }
  }

  const fallbackOf = (locale: RespondentTextLocale, part: EmailPart) => {
    const inherited = inheritedEmailText(current, locale, emailKey(mail, part))
    return inherited === null ? t(`${K}.inheritsDefault`) : t(`${K}.inheritsCompany`, { text: inherited })
  }

  const everyLocale =
    current.level === 'survey' && locales.length > 1 && entryOf(emailKey(mail, 'subject'))?.requiresEveryLocale === true

  return (
    <div className="flex flex-col gap-panel-gap" data-testid="email-texts-editor">
      {mails.length > 1 && (
        <SegmentedControl
          label={t(`${K}.mailLabel`)}
          value={mail}
          options={mails.map((value) => ({ value, label: t(`${K}.mail.${value}`) }))}
          onChange={setMail}
        />
      )}
      <p className="m-0 text-base text-fg-secondary">{t(`${K}.about.${mail}`)}</p>
      <p className="m-0 text-sm text-fg-secondary">{t(`${K}.placeholders`, { survey: '{survey}', company: '{company}' })}</p>
      {!editable && (
        <Alert variant="default">
          <AlertDescription>{t(current.level === 'survey' ? `${K}.lockedSurvey` : `${K}.lockedCompany`)}</AlertDescription>
        </Alert>
      )}
      {everyLocale && <p className="m-0 text-sm text-fg-secondary">{t(`${K}.everyLocale`)}</p>}
      <div className={locales.length > 1 ? 'grid gap-panel-gap md:grid-cols-2' : 'grid gap-panel-gap'}>
        {locales.map((locale) => (
          <section key={locale} className="flex flex-col gap-panel-gap" data-testid={`email-texts-${locale}`}>
            {locales.length > 1 && <h3 className="m-0 text-xl font-semibold text-fg-primary">{t(`surveys.distribution.locale.${locale}`)}</h3>}
            {EMAIL_PARTS.map((part) => {
              const key = emailKey(mail, part)
              const common = {
                label: t(`${K}.${part}`),
                description: fallbackOf(locale, part),
                value: draft[locale][key] ?? '',
                maxLength: entryOf(key)?.maxLength,
                disabled: !editable || saving,
                onChange: (text: string) => edit(locale, key, text),
              }
              return part === 'subject' ? <TextField key={key} {...common} /> : <TextareaField key={key} rows={8} {...common} />
            })}
          </section>
        ))}
      </div>
      {saveError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}
      <div>
        <Button onClick={() => void save()} disabled={!editable || saving || !dirty}>
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </div>
      <section className="flex flex-col gap-2 border-t border-line-default pt-4" aria-labelledby="email-texts-preview" data-testid="email-texts-preview">
        <h3 id="email-texts-preview" className="m-0 text-xl font-semibold text-fg-primary">{t(`${K}.previewTitle`)}</h3>
        <p className="m-0 text-sm text-fg-secondary">{dirty ? t(`${K}.previewUnsaved`) : t(`${K}.previewSaved`)}</p>
        {preview.status === 'loading' ? (
          <SkeletonText lines={3} />
        ) : preview.status === 'error' ? (
          <p role="status" className="m-0 text-sm text-fg-secondary">{t(`${K}.previewFailed`)}</p>
        ) : (
          <>
            <p className="m-0 text-base text-fg-primary" data-testid="email-texts-preview-subject">
              <span className="font-semibold">{t(`${K}.previewSubject`)}</span> {preview.preview.subject}
            </p>
            {/* The server's own document, every authored value escaped there; sandboxed so it
                can run nothing and reach nothing, whatever it contained. */}
            <iframe
              title={t(`${K}.previewFrame`)}
              sandbox=""
              srcDoc={preview.preview.html}
              className="h-[32rem] w-full rounded-lg border border-line-default bg-surface-card"
            />
          </>
        )}
      </section>
    </div>
  )
}
