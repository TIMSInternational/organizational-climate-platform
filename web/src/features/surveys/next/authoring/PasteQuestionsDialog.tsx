import { useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '../../../../components/ui'
import { CanvasSelect } from '../../../org-structure/next/super/parts'
import type { ContentLanguage, SurveyQuestionValues } from '../../wizardValues'
import {
  buildPastedQuestions,
  parsePastedTable,
  suggestColumns,
  type PasteMapping,
  type PasteProblem,
  type PastedType,
} from './pasteQuestions'

/** The default types a sheet without a type column can take, in the order offered. */
const DEFAULT_TYPES: Record<string, PastedType> = {
  likert5: { type: 'likert', scaleMin: 1, scaleMax: 5 },
  rating10: { type: 'rating', scaleMin: 0, scaleMax: 10 },
  open: { type: 'open_ended', scaleMin: null, scaleMax: null },
  yesNo: { type: 'yes_no', scaleMin: null, scaleMax: null },
}

const NONE = ''

/**
 * «Pegar desde Excel»: a client's own questionnaire into the wizard, verbatim or not at all
 * (`pasteQuestions.ts` holds the rules). The operator pastes the rows, chooses which column is
 * the question -- per language the survey is in -- which is the dimension and which the type,
 * and sees each row as it will be added. One unreadable row stops the whole paste, and the
 * dialog names its line, because a questionnaire that lands half-imported is worse than one that
 * did not land.
 */
export function PasteQuestionsDialog({
  open,
  onOpenChange,
  language,
  takeKeys,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  language: ContentLanguage
  takeKeys: (count: number) => string[]
  onAdd: (questions: SurveyQuestionValues[]) => void
}) {
  const { t } = useTranslation()
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.builder.paste.${key}`, vars)
  const needsEs = language === 'es' || language === 'both'
  const needsEn = language === 'en' || language === 'both'

  const [text, setText] = useState('')
  const [hasHeader, setHasHeader] = useState(false)
  const [textEs, setTextEs] = useState(NONE)
  const [textEn, setTextEn] = useState(NONE)
  const [dimension, setDimension] = useState(NONE)
  const [type, setType] = useState(NONE)
  const [defaultType, setDefaultType] = useState('likert5')
  const [anchors, setAnchors] = useState({ minEs: '', maxEs: '', minEn: '', maxEn: '' })

  useEffect(() => {
    if (!open) return
    setText('')
    setHasHeader(false)
    setTextEs(NONE)
    setTextEn(NONE)
    setDimension(NONE)
    setType(NONE)
    setDefaultType('likert5')
    setAnchors({
      minEs: t('surveys.next.builder.paste.anchorMinEsDefault'),
      maxEs: t('surveys.next.builder.paste.anchorMaxEsDefault'),
      minEn: t('surveys.next.builder.paste.anchorMinEnDefault'),
      maxEn: t('surveys.next.builder.paste.anchorMaxEnDefault'),
    })
  }, [open, t])

  const rows = parsePastedTable(text)
  const columnCount = rows.reduce((most, row) => Math.max(most, row.cells.length), 0)

  // A fresh paste suggests its columns from its own header row; the operator can change any.
  function paste(next: string) {
    setText(next)
    const suggested = suggestColumns(parsePastedTable(next))
    setHasHeader(suggested.hasHeader)
    const column = suggested.text === null ? NONE : String(suggested.text)
    setTextEs(needsEs ? column : NONE)
    setTextEn(needsEn && !needsEs ? column : NONE)
    setDimension(suggested.dimension === null ? NONE : String(suggested.dimension))
    setType(suggested.type === null ? NONE : String(suggested.type))
  }

  const columnName = (index: number) => {
    const header = hasHeader ? rows[0]?.cells[index] : undefined
    const letter = String.fromCharCode(65 + (index % 26))
    return header ? `${letter} · ${header}` : copy('column', { letter })
  }
  const asIndex = (value: string) => (value === NONE ? null : Number(value))

  const mapping: PasteMapping = {
    hasHeader,
    textEs: asIndex(textEs),
    textEn: asIndex(textEn),
    dimension: asIndex(dimension),
    type: asIndex(type),
    defaultType: DEFAULT_TYPES[defaultType],
    anchors,
  }
  const columnsChosen = (!needsEs || mapping.textEs !== null) && (!needsEn || mapping.textEn !== null)
  // Keys are only drawn on Add: the preview builds with throwaway ones.
  const preview = buildPastedQuestions(rows, mapping, language, (count) => Array.from({ length: count }, (_, i) => `preview-${i}`))
  const ready = rows.length > 0 && columnsChosen && preview.rows.length > 0 && preview.problems.length === 0

  function add() {
    if (!ready) return
    const built = buildPastedQuestions(rows, mapping, language, takeKeys)
    if (built.problems.length > 0) return
    onAdd(built.questions)
    onOpenChange(false)
  }

  const describe = (problem: PasteProblem) =>
    problem.kind === 'no_text'
      ? copy(problem.language === 'es' ? 'problemNoTextEs' : 'problemNoTextEn', { line: problem.line })
      : copy('problemType', { line: problem.line, value: problem.value === '' ? '—' : problem.value })

  const columnSelect = (id: string, label: string, value: string, onChange: (value: string) => void, optional: boolean) => (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <CanvasSelect id={id} className="w-full" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value={NONE}>{optional ? copy('columnNone') : copy('columnChoose')}</option>
        {Array.from({ length: columnCount }, (_, index) => (
          <option key={index} value={String(index)}>
            {columnName(index)}
          </option>
        ))}
      </CanvasSelect>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy('title')}</DialogTitle>
          <DialogDescription>{copy('body')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="paste-questions-text">{copy('pasteLabel')}</Label>
          <Textarea
            id="paste-questions-text"
            value={text}
            rows={5}
            spellCheck={false}
            placeholder={copy('pastePlaceholder')}
            onChange={(event) => paste(event.target.value)}
          />
        </div>
        {rows.length > 0 && (
          <>
            <label className="inline-flex items-center gap-2 text-sm">
              <Checkbox checked={hasHeader} onCheckedChange={(checked) => setHasHeader(checked === true)} />
              {copy('hasHeader')}
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              {needsEs && columnSelect('paste-col-es', copy('columnTextEs'), textEs, setTextEs, false)}
              {needsEn && columnSelect('paste-col-en', copy('columnTextEn'), textEn, setTextEn, false)}
              {columnSelect('paste-col-dimension', copy('columnDimension'), dimension, setDimension, true)}
              {columnSelect('paste-col-type', copy('columnType'), type, setType, true)}
              {type === NONE && (
                <div className="flex min-w-0 flex-col gap-1">
                  <Label htmlFor="paste-default-type">{copy('defaultType')}</Label>
                  <CanvasSelect id="paste-default-type" className="w-full" value={defaultType} onChange={(event) => setDefaultType(event.target.value)}>
                    {Object.keys(DEFAULT_TYPES).map((key) => (
                      <option key={key} value={key}>
                        {copy(`type.${key}`)}
                      </option>
                    ))}
                  </CanvasSelect>
                </div>
              )}
            </div>
            <fieldset className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-2">
              <legend className="mb-1 p-0 text-sm font-medium">{copy('anchors')}</legend>
              {needsEs && (
                <>
                  <AnchorInput id="paste-anchor-min-es" label={copy('anchorMinEs')} value={anchors.minEs} onChange={(minEs) => setAnchors({ ...anchors, minEs })} />
                  <AnchorInput id="paste-anchor-max-es" label={copy('anchorMaxEs')} value={anchors.maxEs} onChange={(maxEs) => setAnchors({ ...anchors, maxEs })} />
                </>
              )}
              {needsEn && (
                <>
                  <AnchorInput id="paste-anchor-min-en" label={copy('anchorMinEn')} value={anchors.minEn} onChange={(minEn) => setAnchors({ ...anchors, minEn })} />
                  <AnchorInput id="paste-anchor-max-en" label={copy('anchorMaxEn')} value={anchors.maxEn} onChange={(maxEn) => setAnchors({ ...anchors, maxEn })} />
                </>
              )}
            </fieldset>
            {columnsChosen && (
              <div className="flex flex-col gap-2" data-testid="paste-preview">
                <p className="m-0 text-sm font-medium" role="status">
                  {preview.problems.length === 0
                    ? copy('readyCount', { count: preview.rows.length })
                    : copy('problemCount', { count: preview.problems.length })}
                </p>
                {preview.problems.length > 0 && (
                  <ul role="alert" className="m-0 flex max-h-40 list-none flex-col gap-0.5 overflow-y-auto p-0 text-sm text-accent-red-ink">
                    {preview.problems.slice(0, 50).map((problem) => (
                      <li key={`${problem.line}-${problem.kind}-${problem.kind === 'no_text' ? problem.language : ''}`}>{describe(problem)}</li>
                    ))}
                  </ul>
                )}
                <ol className="m-0 flex max-h-64 list-none flex-col gap-1 overflow-y-auto rounded-md border border-line-light p-2 text-sm">
                  {preview.questions.map((question, index) => (
                    <li key={question.key} className="flex min-w-0 gap-2">
                      <span className="w-7 shrink-0 text-right font-mono text-xs text-fg-tertiary">{index + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block">{question.textEs || question.textEn || '—'}</span>
                        <span className="block text-xs text-fg-secondary">
                          {[question.category, copy(`typeName.${question.type}`, { min: question.scaleMin ?? '', max: question.scaleMax ?? '' })]
                            .filter((part) => part !== '')
                            .join(' · ')}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
        {rows.length > 0 && !columnsChosen && (
          <Alert>
            <AlertDescription>{copy('chooseText')}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="primary" disabled={!ready} onClick={add}>
            {copy('add', { count: preview.rows.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AnchorInput({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}
