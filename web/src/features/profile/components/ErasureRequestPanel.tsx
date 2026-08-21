import { useState } from 'react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import type { SubjectIdentity } from '../api/gdpr'
import {
  ANONYMISED_LABEL_PATH,
  DELETED_LABEL_PATH,
  ERASURE_ANONYMISED_TABLES,
  ERASURE_DELETED_TABLES,
  ERASURE_REDACTED_TABLES,
  REDACTED_LABEL_PATH,
} from './privacyScope'

export interface ErasureRequestPanelProps {
  /**
   * Who the request would be about, taken from an export the caller has already asked for.
   * Null before that: the page has no other source of the caller's user id, and inventing
   * one from the token claim would be a second copy of an identity the API already states.
   */
  subject: SubjectIdentity | null
}

/**
 * Erasure (GDPR Art. 17), and the plain statement that it is not a button on this page.
 *
 * ## Why there is nothing here to submit
 *
 * `POST /gdpr/erasure` refuses this, twice over. It is administrators only, so an employee,
 * supervisor or leader gets a `403`; and it explicitly rejects a caller naming their own
 * user id, so a company admin or super admin opening their own privacy page gets a `400`
 * reading *"An administrator cannot erase their own account through this endpoint."* **No
 * role can erase itself**, and there is no request-intake endpoint anywhere in the API for a
 * subject to lodge one against. `GdprEndpoints` and `docs/compliance/gdpr-subject-rights.md`
 * both give the reason and both name this issue: erasure here is irreversible with no undo,
 * so a subject raises a request and a controller acts on it.
 *
 * A button that could only ever fail would be worse than none on a page whose subject is
 * trust, so this panel states the route instead and hands over the identifiers a controller
 * needs. What is missing on the server side — an endpoint that records the request and
 * notifies the tenant's administrators — is reported rather than faked here.
 *
 * ## Why the three lists are table names
 *
 * "Erasure must state plainly what it does and does not remove" is the acceptance criterion
 * this panel exists for, and the only way to keep such a statement true is to derive it from
 * the thing that does the removing. The three lists live in `./privacyScope` — a plain module
 * rather than exports here, because `oxlint`'s `react/only-export-components` counts every
 * non-component export against the repo's `--max-warnings 10` budget, and five of them put it
 * over — and `erasureScope.test.ts` compares them against `SubjectDataMap` by parsing the C#
 * source. The reasons beside them are catalogue copy traceable to `SubjectErasure`'s own
 * `KnownLimitations`, which `erasureScope.test.ts` also pins by anchor phrase.
 */
export default function ErasureRequestPanel({ subject }: ErasureRequestPanelProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState<boolean | null>(null)

  const reference =
    subject === null
      ? null
      : [
          `${t('privacy.referenceUserId')}: ${subject.userId ?? '-'}`,
          `${t('privacy.referenceEmail')}: ${subject.email ?? '-'}`,
          `${t('privacy.referenceName')}: ${subject.name ?? '-'}`,
        ].join('\n')

  async function copy() {
    if (reference === null) return
    try {
      await navigator.clipboard.writeText(reference)
      setCopied(true)
    } catch {
      // A denied or absent clipboard is not a failure worth an alert: the text is on
      // screen and selectable, so the reader can still take it.
      setCopied(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('privacy.erasureTitle')}</CardTitle>
        <CardDescription>{t('privacy.erasureDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-panel-gap">
        <Alert variant="info" role="note">
          <AlertTitle>{t('privacy.erasureNotSelfServiceTitle')}</AlertTitle>
          <AlertDescription>
            <p>{t('privacy.erasureNotSelfService')}</p>
            <p className="mt-2">{t('privacy.erasureHowToAsk')}</p>
          </AlertDescription>
        </Alert>

        <TreatmentList
          headingKey="privacy.erasureDeletedTitle"
          noteKey="privacy.erasureDeletedNote"
          tables={ERASURE_DELETED_TABLES}
          labelPaths={DELETED_LABEL_PATH}
        />

        <TreatmentList
          headingKey="privacy.erasureAnonymisedTitle"
          noteKey="privacy.erasureAnonymisedNote"
          tables={ERASURE_ANONYMISED_TABLES}
          labelPaths={ANONYMISED_LABEL_PATH}
        />

        <TreatmentList
          headingKey="privacy.erasureRedactedTitle"
          noteKey="privacy.erasureRedactedNote"
          tables={ERASURE_REDACTED_TABLES}
          labelPaths={REDACTED_LABEL_PATH}
        />

        <section className="grid gap-inline">
          <h3 className="text-base font-medium text-fg-primary">
            {t('privacy.erasureKeepsTitle')}
          </h3>
          <ul className="grid gap-2 pl-4 text-sm text-fg-secondary [list-style:disc]">
            <li>{t('privacy.erasureKeepsAudit')}</li>
            <li>{t('privacy.erasureKeepsAttribution')}</li>
            <li>{t('privacy.erasureKeepsFreeText')}</li>
            <li>{t('privacy.erasureKeepsSnapshots')}</li>
            <li>{t('privacy.erasureKeepsOtherTenants')}</li>
            <li>{t('privacy.erasureKeepsTracking')}</li>
            <li>{t('privacy.erasureKeepsTrackingSession')}</li>
          </ul>
        </section>

        {reference !== null && (
          <section className="grid gap-inline">
            <h3 className="text-base font-medium text-fg-primary">
              {t('privacy.referenceTitle')}
            </h3>
            <p className="text-sm text-fg-tertiary">{t('privacy.referenceDescription')}</p>
            <pre className="overflow-x-auto rounded-md border border-line-panel bg-surface-icon-box p-3 text-sm text-fg-primary">
              {reference}
            </pre>
            <div className="flex flex-wrap items-center gap-inline">
              <Button type="button" onClick={copy}>
                {t('privacy.referenceCopy')}
              </Button>
              {copied !== null && (
                <span className="text-sm text-fg-tertiary" role="status">
                  {copied ? t('privacy.referenceCopied') : t('privacy.referenceCopyFailed')}
                </span>
              )}
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  )
}

function TreatmentList({
  headingKey,
  noteKey,
  tables,
  labelPaths,
}: {
  headingKey: string
  noteKey: string
  tables: readonly string[]
  labelPaths: Record<string, string>
}) {
  const { t } = useTranslation()

  return (
    <section className="grid gap-inline">
      <h3 className="text-base font-medium text-fg-primary">{t(headingKey)}</h3>
      <p className="text-sm text-fg-tertiary">{t(noteKey)}</p>
      <ul className="grid gap-2 pl-4 text-sm text-fg-secondary [list-style:disc]">
        {tables.map((table) => {
          const path = labelPaths[table]
          return (
            <li key={table}>
              <code className="text-sm">{table}</code>
              {path !== undefined && <> — {t(path)}</>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
