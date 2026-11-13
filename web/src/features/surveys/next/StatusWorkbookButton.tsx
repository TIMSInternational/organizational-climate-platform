import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  RadioGroup,
  RadioGroupItem,
} from '../../../components/ui'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import { listSurveys } from '../api/surveys'
import { companyStatusFileName, getCompanyStatusWorkbook, type StatusWorkbookFormat } from '../api/statusExport'
import { statusLabel } from '../surveyVocabulary'
import { distributedSurveys, type StatusWorkbookChoice } from './statusWorkbookChoices'

/**
 * The status workbook button, and the dialog that asks WHICH sheets go in it.
 *
 * <p>
 * Shared by the tenant surveys list and the super-admin one, so the file TIMS sends a client is
 * produced the same way whoever downloads it.
 * </p>
 *
 * ## It reads the company's surveys itself
 *
 * The obvious shortcut is to pass in the rows the page has already loaded. That is wrong here:
 * the list pages send the reader's search and type filters to `GET /surveys`, so those rows are
 * whatever the reader last searched for. A picker built on them would offer three sheets to
 * someone who had typed nothing and one sheet to someone who had typed "clima", while calling
 * itself the company's status. So the dialog loads the company's own unfiltered list when it
 * opens, and the page's filters cannot reach the file.
 *
 * ## What you ticked is what you get
 *
 * The request always names the ticked ids. Sending "no filter" for a full selection would be
 * shorter, but it asks the server for whatever it considers distributed NOW — which can include
 * a survey that went out since the dialog opened, putting a sheet in a client's file that the
 * operator never saw. Naming them means a survey deleted meanwhile is refused instead, and the
 * refusal says to reload; for a file that goes to a client that is the better of the two.
 *
 * <p>
 * The one exception is a company with nothing distributed: there is nothing to name, so the
 * request carries no ids and the server answers with its "no surveys" sheet rather than an
 * error, which is what it did before this dialog existed.
 * </p>
 */
export function StatusWorkbookButton({
  companyId,
  companyName,
  baseUrl,
  label,
}: {
  companyId: string
  companyName: string
  baseUrl: string
  /** The trigger's text, so each page keeps the wording its readers already know. */
  label: string
}) {
  const { t, locale } = useTranslation()
  const [open, setOpen] = useState(false)
  /** `null` while the company's list is still loading. */
  const [surveys, setSurveys] = useState<StatusWorkbookChoice[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  /** `null` until something is ticked or unticked, meaning "all of them". */
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  /**
   * The file's layout. Kept across openings on purpose: an operator who sends ESPH its format
   * every morning should not have to pick it every morning.
   */
  const [format, setFormat] = useState<StatusWorkbookFormat>('standard')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setSurveys(null)
    setLoadFailed(false)
    setPicked(null)
    setFailed(false)
    listSurveys(baseUrl, { companyId }, locale)
      .then((rows) => {
        if (!cancelled) setSurveys(distributedSurveys(rows, companyId))
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, baseUrl, companyId, locale])

  const choices = surveys ?? []
  const selected = picked ?? new Set(choices.map((survey) => survey.id))
  const allTicked = choices.length > 0 && selected.size === choices.length
  const nothingTicked = choices.length > 0 && selected.size === 0

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }

  async function download() {
    setBusy(true)
    setFailed(false)
    try {
      const ids = choices.filter((survey) => selected.has(survey.id)).map((survey) => survey.id)
      const blob = await getCompanyStatusWorkbook(baseUrl, companyId, ids, format)
      downloadBlobFile(companyStatusFileName('estado', companyName, new Date()), blob)
      setOpen(false)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Download aria-hidden="true" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto" closeLabel={t('surveys.next.statusWorkbook.close')}>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>{t('surveys.next.statusWorkbook.description')}</DialogDescription>
          </DialogHeader>
          {loadFailed ? (
            <p className="m-0 text-sm text-accent-red-ink" role="alert">
              {t('surveys.next.statusWorkbook.loadFailed')}
            </p>
          ) : surveys === null ? (
            <p className="m-0 text-sm text-fg-secondary">{t('surveys.next.statusWorkbook.loading')}</p>
          ) : choices.length === 0 ? (
            <p className="m-0 text-sm text-fg-secondary">{t('surveys.next.statusWorkbook.none')}</p>
          ) : (
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                {/*
                  An explicit `aria-label` beside the visible text: a Radix checkbox is a
                  `<button>`, which `<label for>` does not name, so without it the control
                  reaches a screen reader unnamed.
                */}
                <Checkbox
                  aria-label={t('surveys.next.statusWorkbook.all')}
                  checked={allTicked}
                  onCheckedChange={() =>
                    setPicked(allTicked ? new Set() : new Set(choices.map((survey) => survey.id)))
                  }
                />
                <span>{t('surveys.next.statusWorkbook.all')}</span>
              </label>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {choices.map((survey) => {
                  const name = survey.title ?? t('surveys.next.statusWorkbook.untitled')
                  return (
                    <li key={survey.id}>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          aria-label={name}
                          checked={selected.has(survey.id)}
                          onCheckedChange={() => toggle(survey.id)}
                        />
                        <span>{name}</span>
                        <span className="text-fg-secondary">{statusLabel(t, survey.status)}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          {choices.length > 0 && (
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 p-0 text-sm font-medium">{t('surveys.next.statusWorkbook.formatLabel')}</legend>
              <RadioGroup
                aria-label={t('surveys.next.statusWorkbook.formatLabel')}
                value={format}
                onValueChange={(next) => setFormat(next === 'progress' ? 'progress' : 'standard')}
                className="gap-2"
              >
                {(['standard', 'progress'] as const).map((option) => {
                  const itemId = `status-workbook-format-${option}`
                  return (
                    <div key={option} className="flex items-start gap-2">
                      <RadioGroupItem id={itemId} value={option} aria-describedby={`${itemId}-help`} className="mt-1" />
                      <label htmlFor={itemId} className="min-w-0 cursor-pointer">
                        <span className="block text-sm font-medium text-fg-primary">
                          {t(option === 'progress' ? 'surveys.next.statusWorkbook.formatProgress' : 'surveys.next.statusWorkbook.formatStandard')}
                        </span>
                        <span id={`${itemId}-help`} className="block text-sm text-fg-secondary">
                          {t(
                            option === 'progress'
                              ? 'surveys.next.statusWorkbook.formatProgressHelp'
                              : 'surveys.next.statusWorkbook.formatStandardHelp',
                          )}
                        </span>
                      </label>
                    </div>
                  )
                })}
              </RadioGroup>
            </fieldset>
          )}
          {failed && (
            <p className="m-0 text-sm text-accent-red-ink" role="alert">
              {t('surveys.next.statusWorkbook.failed')}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('surveys.next.statusWorkbook.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={busy || nothingTicked || surveys === null || loadFailed}
              onClick={() => void download()}
            >
              {busy ? t('surveys.next.statusWorkbook.busy') : t('surveys.next.statusWorkbook.download')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
