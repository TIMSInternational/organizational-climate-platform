import { useEffect, useId, useState } from 'react'
import { ApiError } from '../../../../api/authFetch'
import { useTranslation } from '../../../../i18n'
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Input,
} from '../../../../components/ui'

/**
 * "Eliminar" -- `DELETE /surveys/{id}` from the screen (audit G16). `deleteSurvey` existed with no
 * caller; test surveys and abandoned drafts were removed with `delete-survey.sh`.
 *
 * Offered only where the server deletes: nobody has answered (`DeleteSurveyAsync`). The server
 * also counts the responses table, not only the counter this page reads, so a refusal can still
 * come back; it is said in the reader's language, never in the endpoint's English.
 *
 * Deleting cannot be undone and takes the link, the invitations and any per-survey codes with
 * it, so the confirm is TYPED: one word, in the reader's language, before the button wakes. A
 * survey that is live is said to be live -- the people holding its link or a code lose it.
 */
export function DeleteSurveyDialog({
  status,
  open,
  onOpenChange,
  onDelete,
}: {
  status: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDelete: () => Promise<void>
}) {
  const { t } = useTranslation()
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.detail.delete.${key}`, vars)
  const inputId = useId()
  const word = copy('word')
  const [typed, setTyped] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const live = status === 'active' || status === 'scheduled'

  useEffect(() => {
    if (!open) return
    setTyped('')
    setProblem(null)
  }, [open])

  const confirmed = typed.trim().toLocaleUpperCase() === word.toLocaleUpperCase()

  async function remove() {
    if (!confirmed) return
    setDeleting(true)
    setProblem(null)
    try {
      await onDelete()
    } catch (cause) {
      setProblem(
        cause instanceof ApiError
          ? cause.status === 409
            ? copy('refusedResponses')
            : cause.status === 404
              ? copy('refusedGone')
              : t('errors.generic')
          : cause instanceof Error && cause.message
            ? cause.message
            : t('errors.generic'),
      )
      setDeleting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !deleting && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy('title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {live ? copy('bodyLive', { status: t(`surveys.next.detail.statusAdjective.${status}`) }) : copy('body')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={inputId} className="m-0 text-sm font-semibold text-fg-secondary">
            {copy('typeLabel', { word })}
          </label>
          <Input
            id={inputId}
            value={typed}
            autoComplete="off"
            disabled={deleting}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void remove()
            }}
          />
        </div>
        {problem && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>{t('common.cancel')}</AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={!confirmed || deleting} onClick={() => void remove()}>
            {deleting ? copy('deleting') : copy('confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
