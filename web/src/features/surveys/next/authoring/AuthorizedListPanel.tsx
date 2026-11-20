import { useEffect, useId, useRef, useState } from 'react'
import { ShieldCheck, Upload } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CheckboxField,
  Chip,
  LoadingState,
  Note,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextareaField,
  TextField,
} from '../../../../components/ui'
import { describeApiError } from '../../../../api/describeApiError'
import { useTranslation } from '../../../../i18n'
import { byCount } from '../../../../i18n/plural'
import {
  AuthorizedListRefusal,
  addAuthorizedPerson,
  getAuthorizedList,
  parseAuthorizedPaste,
  pasteAuthorizedList,
  publishAuthorizedList,
  removeAuthorizedPerson,
  useOutsideAuthorizedList,
  type AuthorizedListView,
} from '../../api/authorizedList'

const baseUrl = import.meta.env.VITE_API_BASE_URL as string

/** Rows the table shows before «Ver las n». */
export const AUTHORIZED_PREVIEW_ROWS = 10

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; view: AuthorizedListView }

/**
 * «Lista autorizada del cliente» on the Distribución page (ruled 2026-11-19,
 * `docs/decisions/editable-respondent-content.md`, ruling 3): the addresses the client named for
 * this survey, who added each and when, and the two ways to fill it — one at a time, or a pasted
 * column (or a CSV / text file read the same way). While the list holds anybody, the API refuses
 * every send, resend, reissue or reminder to anyone else, naming them; this panel is where the
 * operator widens it when the client says so.
 *
 * Self-contained, like the respondent-texts dialog: it loads and saves on its own, and publishes
 * what it holds (`publishAuthorizedList`) so the roster can mark who is outside the list without
 * a second read.
 */
export default function AuthorizedListPanel({ surveyId }: { surveyId: string }) {
  const { t, locale } = useTranslation()
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.authorizedList.${key}`, vars)
  const [state, setState] = useState<State>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [paste, setPaste] = useState('')
  const [replace, setReplace] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const fileInputId = useId()

  useEffect(() => {
    let live = true
    getAuthorizedList(baseUrl, surveyId)
      .then((view) => {
        if (!live) return
        setState({ status: 'ready', view })
        publishAuthorizedList(surveyId, view)
      })
      .catch(() => {
        if (live) setState({ status: 'error' })
      })
    return () => {
      live = false
      publishAuthorizedList(surveyId, null)
    }
  }, [surveyId])

  const show = (view: AuthorizedListView) => {
    setState({ status: 'ready', view })
    publishAuthorizedList(surveyId, view)
  }

  const fail = (caught: unknown) => {
    const sentence = describeApiError(caught, t, 'surveys.next.authorizedList.actionFailed')
    const invalid = caught instanceof AuthorizedListRefusal && caught.invalid.length > 0
      ? ` ${copy('invalidEntries', { entries: caught.invalid.join(', ') })}`
      : ''
    setError(sentence + invalid)
  }

  const run = async (act: () => Promise<string | null>) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      setNotice(await act())
    } catch (caught) {
      fail(caught)
    } finally {
      setBusy(false)
    }
  }

  const add = () => run(async () => {
    const person = await addAuthorizedPerson(baseUrl, surveyId, { email, displayName: name.trim() === '' ? null : name })
    show(await getAuthorizedList(baseUrl, surveyId))
    setEmail('')
    setName('')
    return copy('added', { email: person.email })
  })

  const parsed = parseAuthorizedPaste(paste)

  const load = () => run(async () => {
    const result = await pasteAuthorizedList(baseUrl, surveyId, parsed.entries, replace)
    show(result.list)
    setPaste('')
    setReplace(false)
    const summary = copy('result', {
      added: result.added.length,
      already: result.alreadyOnList.length,
      duplicates: result.duplicatesInPaste.length,
    })
    return result.removed.length > 0 ? `${summary} ${copy('resultRemoved', { removed: result.removed.length })}` : summary
  })

  const remove = (personId: string, address: string) => run(async () => {
    await removeAuthorizedPerson(baseUrl, surveyId, personId)
    show(await getAuthorizedList(baseUrl, surveyId))
    return copy('removed', { email: address })
  })

  const readFile = async (file: File | undefined) => {
    if (!file) return
    try {
      setPaste(await file.text())
      setError(null)
    } catch {
      setError(copy('uploadFailed'))
    }
  }

  const day = (iso: string) => {
    const date = new Date(iso)
    return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
  }

  return (
    <section aria-labelledby="authorized-list" className="mt-6" data-testid="authorized-list">
      <Card className="flex flex-col gap-4 px-5">
        <div className="flex flex-col gap-1.5">
          <h2 id="authorized-list" className="m-0 text-2xl">
            {copy('title')}
          </h2>
          <p className="m-0 text-sm text-fg-secondary">{copy('intro')}</p>
        </div>

        {state.status === 'loading' ? (
          <LoadingState />
        ) : state.status === 'error' ? (
          // A status, not an alert: the panel is one part of the page, and a list it could not read
          // must not shout over the page's own send refusals (which ARE alerts).
          <p role="status" className="m-0 text-sm text-accent-red-ink" data-testid="authorized-list-load-failed">
            {copy('loadFailed')}
          </p>
        ) : (
          <>
            <Note role="status" tone={state.view.count > 0 ? 'info' : 'neutral'} icon={<ShieldCheck />} data-testid="authorized-count">
              {state.view.count === 0
                ? copy('none')
                : copy(byCount(state.view.count, 'countOne', 'count'), { count: state.view.count })}
            </Note>

            {!state.view.editable && state.view.lockReason ? (
              <Note role="status">{t(`errors.api.codes.${state.view.lockReason}`)}</Note>
            ) : null}

            {error ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {notice ? (
              <p role="status" className="m-0 text-sm text-fg-secondary">
                {notice}
              </p>
            ) : null}

            {state.view.editable ? (
              <div className="grid gap-5 lg:grid-cols-2">
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void add()
                  }}
                >
                  <h3 className="m-0 text-base font-semibold">{copy('addTitle')}</h3>
                  <TextField type="email" label={copy('emailLabel')} value={email} onChange={setEmail} disabled={busy} required />
                  <TextField label={copy('nameLabel')} value={name} onChange={setName} disabled={busy} maxLength={200} />
                  <div>
                    <Button type="submit" variant="outline" disabled={busy || email.trim() === ''}>
                      {copy('add')}
                    </Button>
                  </div>
                </form>

                <form
                  className="flex flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void load()
                  }}
                >
                  <h3 className="m-0 text-base font-semibold">{copy('pasteTitle')}</h3>
                  <TextareaField
                    label={copy('pasteLabel')}
                    description={copy('pasteHelp')}
                    value={paste}
                    onChange={setPaste}
                    rows={5}
                    disabled={busy}
                  />
                  <input
                    id={fileInputId}
                    ref={fileInput}
                    type="file"
                    accept=".csv,.txt,text/csv,text/plain"
                    disabled={busy}
                    tabIndex={-1}
                    className="sr-only"
                    onChange={(event) => {
                      void readFile(event.target.files?.[0])
                      event.target.value = ''
                    }}
                  />
                  <div>
                    <Button type="button" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
                      <Upload aria-hidden="true" className="size-icon" />
                      {copy('upload')}
                    </Button>
                  </div>
                  {paste.trim() !== '' ? (
                    <div className="flex flex-col gap-1 text-sm text-fg-secondary" data-testid="authorized-paste-read">
                      <p className="m-0">{copy(byCount(parsed.entries.length, 'readOne', 'read'), { count: parsed.entries.length })}</p>
                      {parsed.unreadable.length > 0 ? (
                        <p className="m-0">{copy('unreadable', { lines: parsed.unreadable.slice(0, 5).join(' · ') })}</p>
                      ) : null}
                    </div>
                  ) : null}
                  <CheckboxField
                    label={copy('replace')}
                    description={copy('replaceHelp')}
                    checked={replace}
                    onChange={setReplace}
                    disabled={busy}
                  />
                  <div>
                    <Button type="submit" variant="default" disabled={busy || parsed.entries.length === 0}>
                      {copy('submit')}
                    </Button>
                  </div>
                </form>
              </div>
            ) : null}

            {state.view.count > 0 ? (
              <div className="flex flex-col gap-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{copy('colEmail')}</TableHead>
                      <TableHead>{copy('colName')}</TableHead>
                      <TableHead>{copy('colAddedBy')}</TableHead>
                      <TableHead>{copy('colAddedAt')}</TableHead>
                      {state.view.editable ? <TableHead><span className="sr-only">{copy('remove')}</span></TableHead> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(showAll ? state.view.people : state.view.people.slice(0, AUTHORIZED_PREVIEW_ROWS)).map((person) => (
                      <TableRow key={person.id} data-testid="authorized-row">
                        <TableCell className="px-3 py-2 font-mono text-xs">{person.email}</TableCell>
                        <TableCell className="px-3 py-2">{person.displayName ?? ''}</TableCell>
                        <TableCell className="px-3 py-2 text-fg-secondary">{person.addedByName ?? copy('unknownAdder')}</TableCell>
                        <TableCell className="px-3 py-2 whitespace-nowrap text-fg-secondary">{day(person.addedAt)}</TableCell>
                        {state.view.editable ? (
                          <TableCell className="px-3 py-2 text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              aria-label={copy('removeLabel', { email: person.email })}
                              onClick={() => void remove(person.id, person.email)}
                            >
                              {copy('remove')}
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {state.view.people.length > AUTHORIZED_PREVIEW_ROWS ? (
                  <div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll((all) => !all)}>
                      {showAll ? copy('showFewer') : copy('showAll', { count: state.view.people.length })}
                    </Button>
                  </div>
                ) : null}
                {state.view.editable ? <p className="m-0 text-xs text-fg-secondary">{copy('emptyWarning')}</p> : null}
              </div>
            ) : null}
          </>
        )}
      </Card>
    </section>
  )
}

/**
 * «Fuera de la lista del cliente» beside a roster row whose address is not on the survey's list.
 * Nothing at all while there is no list: then nobody is outside it.
 */
export function OutsideAuthorizedListMark({ email }: { email: string }) {
  const { t } = useTranslation()
  const outside = useOutsideAuthorizedList(email)
  if (!outside) return null
  return (
    <span className="mt-1">
      <Chip tone="warning" label={t('surveys.next.roster.outsideList')} data-testid="outside-authorized-list" />
    </span>
  )
}
