import { useTranslation } from '../../i18n'
import { Alert, AlertDescription, Badge, Button, TextField, TextareaField } from '../ui'
import {
  missingInvitationCopy,
  type InvitationCopyByLocale,
  type InvitationCopyField,
} from '../../features/surveys/api/surveyInvitationCopy'
import type { Locale } from '../../i18n'

/**
 * Authoring the invitation subject and message, **side by side in every language the
 * survey is written in**.
 *
 * ## Why not one text box
 *
 * The invitation copy is Tier-1 authored content on paired
 * `invitation_custom_{subject,message}_{en,es}` columns (#195). A survey whose `language`
 * is `both` has two of each, and a single box would file whatever the admin typed into
 * one column and leave the other empty — so half the audience receives an invitation in a
 * language they did not choose, and nothing anywhere reports it. That is the exact
 * failure the paired columns exist to prevent, which is why the write path
 * (`LocalizedInput`) *rejects* a bare string for content authored in `both` rather than
 * guessing which column it belongs in.
 *
 * So: one column per required locale, both visible at once. A single-language survey gets
 * one column and is not asked for a translation it does not need — `requiredLocales` comes
 * from the survey's own `language`, not from the app's locale list.
 *
 * ## What "missing" means here
 *
 * A box is empty either because nothing was ever written, or because what the API
 * returned for that locale arrived **via fallback** — the other language's text, shown
 * because there was nothing else. The read layer refuses to prefill from a fallback (see
 * `surveyInvitationCopy.ts`), because prefilling would make an untranslated field look
 * translated and then, on save, copy English into the Spanish column for real.
 *
 * Missing locales are listed explicitly rather than left as a silently empty box. The
 * server's own publish gate (`ContentPublishValidation`) also checks this, but it runs at
 * publish time — after the invitations may already be queued. This is earlier, not
 * instead.
 */
export interface InvitationCopyEditorProps {
  copy: InvitationCopyByLocale
  requiredLocales: readonly Locale[]
  onChange: (locale: Locale, field: InvitationCopyField, text: string) => void
  onSave: () => void
  saving?: boolean
  /** False for a closed or archived survey — the API refuses a settings edit on one. */
  editable?: boolean
}

export default function InvitationCopyEditor({
  copy,
  requiredLocales,
  onChange,
  onSave,
  saving = false,
  editable = true,
}: InvitationCopyEditorProps) {
  const { t } = useTranslation()
  const missing = missingInvitationCopy(copy, requiredLocales)
  const bilingual = requiredLocales.length > 1

  return (
    <div className="flex flex-col gap-panel-gap">
      {!editable && (
        <Alert variant="default">
          <AlertDescription>{t('surveys.distribution.copyLocked')}</AlertDescription>
        </Alert>
      )}

      {/*
        Side by side on a wide viewport, stacked on a narrow one. Two columns is what
        makes the pair comparable at a glance, which is the whole point of editing them
        together rather than on two screens.
      */}
      <div className={bilingual ? 'grid gap-panel-gap md:grid-cols-2' : 'grid gap-panel-gap'}>
        {requiredLocales.map((locale) => (
          <section key={locale} className="flex flex-col gap-panel-gap">
            <h3 className="flex items-center gap-inline text-xl font-semibold text-fg-primary">
              {t(`surveys.distribution.locale.${locale}`)}
              {!copy[locale].subject.authored && !copy[locale].message.authored && (
                <Badge variant="outline">{t('surveys.distribution.copyUntranslated')}</Badge>
              )}
            </h3>

            <TextField
              label={t('surveys.distribution.invitationSubject')}
              value={copy[locale].subject.text}
              disabled={!editable || saving}
              onChange={(text) => onChange(locale, 'subject', text)}
            />
            <TextareaField
              label={t('surveys.distribution.invitationMessage')}
              value={copy[locale].message.text}
              rows={6}
              disabled={!editable || saving}
              onChange={(text) => onChange(locale, 'message', text)}
            />
          </section>
        ))}
      </div>

      {missing.length > 0 && (
        <Alert variant="default">
          <AlertDescription>
            <span>{t('surveys.distribution.copyMissing')}</span>
            <ul>
              {missing.map((gap) => (
                <li key={`${gap.locale}-${gap.field}`}>
                  {t('surveys.distribution.copyMissingItem', {
                    language: t(`surveys.distribution.locale.${gap.locale}`),
                    field: t(
                      gap.field === 'subject'
                        ? 'surveys.distribution.invitationSubject'
                        : 'surveys.distribution.invitationMessage',
                    ),
                  })}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div>
        <Button onClick={onSave} disabled={!editable || saving}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  )
}
