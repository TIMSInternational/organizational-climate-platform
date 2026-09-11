import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  AlertDescription,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  SkeletonText,
  TextField,
} from '../../../../components/ui'
import { useTranslation } from '../../../../i18n'
import { getQuestionBankItem, listQuestionBankItems, type QuestionBankItem } from '../../../questions/api/questionBank'
import { dimensionLabel } from '../../dimensionLabel'
import { SURVEY_QUESTION_TYPES, languageLabel, questionTypeLabel } from '../../surveyVocabulary'
import type { SurveyQuestionValues } from '../../wizardValues'
import { bankQuestion } from './templateRows'

/**
 * "Agregar pregunta · del banco" — the question bank (`GET /admin/question-bank`) as a picker.
 *
 * The first producer of `SourceQuestionBankItemId` (SurveyDtos.cs:155-168: "no shipped client
 * sends it yet"): a question added from here carries the bank item it came from, so bank usage
 * and effectiveness count it. The list is read when the picker opens, never with the page. The
 * company's own rows and the global ones are offered — `companyId` null is a global row — so a
 * super_admin, whom the server shows every tenant's rows, is offered only the survey company's.
 */
export function QuestionBankPicker({
  open,
  onOpenChange,
  companyId,
  takeKey,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  takeKey: () => string
  onAdd: (question: SurveyQuestionValues) => void
}) {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.builder.bank.${key}`, vars)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [items, setItems] = useState<QuestionBankItem[]>([])
  const [search, setSearch] = useState('')
  const [added, setAdded] = useState<string[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setStatus('loading')
    setAdded([])
    setFailed(false)
    listQuestionBankItems(baseUrl)
      .then((result) => {
        if (cancelled) return
        setItems(result.items)
        setStatus('ready')
      })
      .catch(() => !cancelled && setStatus('error'))
    return () => {
      cancelled = true
    }
  }, [open, baseUrl])

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return items.filter(
      (item) =>
        item.isActive &&
        (item.companyId === null || item.companyId === companyId) &&
        (SURVEY_QUESTION_TYPES as readonly string[]).includes(item.type) &&
        (needle === '' || (item.text ?? '').toLocaleLowerCase().includes(needle)),
    )
  }, [items, search, companyId])

  async function add(item: QuestionBankItem) {
    setBusyId(item.id)
    setFailed(false)
    try {
      const detail = await getQuestionBankItem(baseUrl, item.id)
      onAdd(bankQuestion(detail, takeKey()))
      setAdded((current) => [...current, item.id])
    } catch {
      setFailed(true)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy('title')}</DialogTitle>
          <DialogDescription>{copy('description')}</DialogDescription>
        </DialogHeader>
        {status === 'error' && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{copy('loadFailed')}</AlertDescription>
          </Alert>
        )}
        {failed && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{copy('addFailed')}</AlertDescription>
          </Alert>
        )}
        <TextField label={copy('search')} value={search} onChange={setSearch} />
        {status === 'loading' ? (
          <SkeletonText lines={4} />
        ) : status === 'ready' && visible.length === 0 ? (
          <p className="m-0 text-sm text-fg-secondary">{copy('empty')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="bank-items">
            {visible.map((item) => {
              const isAdded = added.includes(item.id)
              return (
                <li key={item.id} className="flex items-center gap-3 rounded-lg border border-line-default px-3 py-2.5">
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="text-base font-medium text-fg-primary">{item.text}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Chip label={dimensionLabel(item.category, t)} />
                      <Chip label={questionTypeLabel(t, item.type)} />
                      <Chip label={copy('writtenIn', { language: languageLabel(t, item.language) })} />
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isAdded || busyId !== null}
                    onClick={() => void add(item)}
                  >
                    {isAdded ? copy('added') : copy('add')}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
