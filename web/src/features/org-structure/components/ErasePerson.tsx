import { useState } from 'react'
import { UserX } from 'lucide-react'
import { describeKnownRefusal } from '../../../api/describeApiError'
import { useTranslation } from '../../../i18n'
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '../../../components/ui'
import { eraseUser } from '../../profile/api/gdpr'
import type { User } from '../api/users'

/**
 * «Eliminar persona» -- the GDPR erasure behind a button (ruled 2026-11-08, offered to super
 * admins; the server also allows a company admin, and refuses anyone erasing themselves).
 *
 * It is NOT «Desactivar». Deactivating keeps everything and can be undone; this overwrites the
 * person's name, email and sign-in for good, closes the account, ends their codes, and leaves
 * their answers in the results with nothing linking them to anybody. The row stays in the
 * database, pseudonymised (sixteen keys hold it), and leaves the people list. The dialog says all
 * of that, and the person's email must be typed to confirm.
 */
export function ErasePerson({ user, onErased }: { user: User; onErased: () => void }) {
  const { t } = useTranslation()
  const copy = (key: string, vars?: Record<string, string | number>) => t(`users.next.erase.${key}`, vars)
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const matches = typed.trim().toLowerCase() === user.email.trim().toLowerCase() && user.email.trim() !== ''

  async function erase() {
    if (!matches) return
    setBusy(true)
    setProblem(null)
    try {
      await eraseUser(baseUrl, user.id)
      setOpen(false)
      onErased()
    } catch (cause) {
      setProblem(describeKnownRefusal(cause, t) ?? copy('failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-light pt-2.5" data-testid="erase-person">
      <span className="text-xs text-fg-secondary">{copy('hint')}</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setTyped('')
          setProblem(null)
          setOpen(true)
        }}
      >
        <UserX aria-hidden="true" className="size-3.5" />
        {copy('action')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent closeLabel={t('common.close')} className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{copy('title', { name: user.name })}</DialogTitle>
            <DialogDescription>{copy('body')}</DialogDescription>
          </DialogHeader>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
            <li>{copy('effectIdentity')}</li>
            <li>{copy('effectAccess')}</li>
            <li>{copy('effectAnswers')}</li>
            <li>{copy('effectLog')}</li>
          </ul>
          <p role="note" className="m-0 text-sm text-accent-red-ink">
            {copy('irreversible')}
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`erase-${user.id}`}>{copy('typeEmail', { email: user.email })}</Label>
            <Input
              id={`erase-${user.id}`}
              value={typed}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
          {problem ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="destructive" disabled={busy || !matches} onClick={() => void erase()}>
              {busy ? copy('erasing') : copy('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
