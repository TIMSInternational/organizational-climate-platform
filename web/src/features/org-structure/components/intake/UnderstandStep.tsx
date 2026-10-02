import { ArrowLeft, ArrowRight, FileCheck, Lock, PencilLine, ScanText, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from '../../../../i18n'
import { Alert, AlertDescription, AlertTitle, Button, type ChipTone } from '../../../../components/ui'
import { CanvasChip } from '../../next/super/parts'
import type { IntakeAiFacts, IntakeMapping, IntakeSource, IntakeUnderstanding } from '../../api/intake'
import { InsightsCard } from './InsightsCard'
import { MappingEditor } from './MappingEditor'
import { FAILURE_CODES, formatModelName } from './intakeModel'

/**
 * The file-level problems the server names by code. `no_email_column` and `no_name_column` are
 * fixable right here, by marking a column in the mapping; a code outside this set falls back to
 * the server's English rather than to nothing.
 */
const PROBLEM_CODES: ReadonlySet<string> = new Set([
  'no_people_sheet',
  'no_header',
  'missing_column',
  'no_data_rows',
  'no_email_column',
  'no_name_column',
])

const SOURCE_TONE: Record<IntakeSource, ChipTone> = {
  ai: 'accent',
  template: 'good',
  heuristic: 'warning',
  manual: 'neutral',
}

const SOURCE_ICON: Record<IntakeSource, ReactNode> = {
  ai: <Sparkles />,
  template: <FileCheck />,
  heuristic: <ScanText />,
  manual: <PencilLine />,
}

/**
 * Step 2, once the server has answered: "Así entendimos su archivo".
 *
 * Top to bottom it is the order an admin needs to trust it — who read the file and what they
 * concluded, what the AI was and was not shown, the mapping itself with the doubtful decisions
 * flagged, and what deserves a look before approving. Nothing is created from here: "Continuar"
 * only carries the rows to the review table, where the server's verdict still gates approval.
 */
export function UnderstandStep({
  understanding,
  draft,
  edited,
  dirty,
  fixes,
  aiOrigin,
  rowCount,
  busy,
  onMappingChange,
  onApply,
  onContinue,
  onBack,
  onFix,
}: {
  understanding: IntakeUnderstanding
  draft: IntakeMapping
  edited: ReadonlySet<string>
  dirty: boolean
  fixes: Readonly<Record<string, string>>
  /**
   * The model's facts for THIS file: the current response's when the model mapped it, or the
   * first response's once the admin has re-applied a corrected mapping (which calls no model).
   */
  aiOrigin: IntakeAiFacts | null
  rowCount: number
  busy: boolean
  onMappingChange: (next: IntakeMapping, key: string) => void
  onApply: () => void
  onContinue: () => void
  onBack: () => void
  onFix: (from: string, to: string) => void
}) {
  const { t, locale } = useTranslation()
  const { source, failureCode, mapping, file, problems } = understanding
  const sheet = file.sheets.find((s) => s.name === mapping.sheet)
  const number = (value: number, digits = 0) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value)
  const summary = mapping.summary ?? (source === 'ai' ? null : t(`users.intake.understand.noSummary.${source}`))
  const showPrivacy = aiOrigin !== null && (source === 'ai' || source === 'manual')
  const heuristicFallback = source === 'heuristic' || failureCode !== null

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section
        aria-labelledby="intake-understood"
        data-slot="intake-summary"
        className="flex min-w-0 flex-col gap-4 rounded-xl border border-line-default border-l-[3px] border-l-accent-blue bg-surface-card px-5 py-4 shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="intake-understood" className="m-0 text-2xl">
            {t('users.intake.understand.title')}
          </h3>
          <CanvasChip
            tone={SOURCE_TONE[source]}
            icon={SOURCE_ICON[source]}
            label={t(`users.intake.understand.source.${source}`)}
            data-source={source}
          />
        </div>

        {summary && <p className="m-0 max-w-prose text-lg leading-normal text-fg-primary">{summary}</p>}

        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Fact term={t('users.intake.understand.facts.file')}>
            <span className="block truncate" title={file.fileName}>
              {file.fileName}
            </span>
          </Fact>
          <Fact term={t('users.intake.understand.facts.sheet')}>
            {file.sheets.length > 1
              ? t('users.intake.understand.sheetOf', { sheet: mapping.sheet, count: file.sheets.length })
              : mapping.sheet}
          </Fact>
          <Fact term={t('users.intake.understand.facts.people')}>
            <span className="font-mono tabular-nums">{number(rowCount)}</span>
          </Fact>
          <Fact term={t('users.intake.understand.facts.columns')}>
            <span className="font-mono tabular-nums">{number(sheet?.columns ?? mapping.columns.length)}</span>
          </Fact>
        </dl>

        {file.namesNormalised > 0 && (
          <p className="m-0 text-sm text-fg-secondary">
            {t('users.intake.understand.namesNormalised', { count: number(file.namesNormalised) })}
          </p>
        )}

        {aiOrigin && (
          <p data-slot="intake-model" className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-tertiary">
            <span className="inline-flex items-center gap-1.5 font-medium text-fg-secondary">
              <Sparkles aria-hidden="true" className="size-3.5 text-accent-blue" />
              {aiOrigin.cached
                ? t('users.intake.understand.modelCached', { model: formatModelName(aiOrigin.model) })
                : t('users.intake.understand.model', {
                    model: formatModelName(aiOrigin.model),
                    seconds: number(aiOrigin.durationMs / 1000, 1),
                  })}
            </span>
            {!aiOrigin.cached && aiOrigin.inputTokens !== null && aiOrigin.outputTokens !== null && (
              <span className="font-mono tabular-nums">
                {t('users.intake.understand.tokens', {
                  input: number(aiOrigin.inputTokens),
                  output: number(aiOrigin.outputTokens),
                })}
              </span>
            )}
          </p>
        )}
      </section>

      {showPrivacy && aiOrigin && (
        <section
          data-slot="intake-privacy"
          aria-label={t('users.intake.understand.privacyLead')}
          className="flex min-w-0 flex-col gap-3 rounded-xl border border-accent-green-ring bg-accent-green-soft px-5 py-4"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-card text-accent-green-ink [&_svg]:size-4"
            >
              <ShieldCheck />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="m-0 text-lg font-semibold text-fg-primary">{t('users.intake.understand.privacyLead')}</p>
              <p className="m-0 text-sm leading-normal text-fg-secondary">{t('users.intake.understand.privacyBody')}</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ColumnList
              heading={t('users.intake.understand.privacyShared')}
              columns={aiOrigin.categoryColumns}
              icon={null}
              empty={t('users.intake.understand.privacyNone')}
            />
            <ColumnList
              heading={t('users.intake.understand.privacyMasked')}
              columns={aiOrigin.maskedColumns}
              icon={<Lock />}
              empty={t('users.intake.understand.privacyNone')}
            />
          </div>
        </section>
      )}

      {heuristicFallback && (
        <Alert variant="warning" data-slot="intake-fallback">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>
            {failureCode !== null && FAILURE_CODES.has(failureCode)
              ? t(`users.intake.understand.fallbackTitle.${failureCode}`)
              : t('users.intake.understand.fallbackTitle.other')}
          </AlertTitle>
          <AlertDescription>{t('users.intake.understand.fallbackBody')}</AlertDescription>
        </Alert>
      )}

      {problems.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="m-0 list-disc pl-5">
              {problems.map((problem) => (
                <li key={`${problem.sheet}:${problem.code}:${problem.value ?? ''}`}>
                  {PROBLEM_CODES.has(problem.code)
                    ? t(`users.intake.problem.${problem.code}`, { value: problem.value ?? '' })
                    : problem.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <MappingEditor
        mapping={draft}
        targets={understanding.targets}
        edited={edited}
        disabled={busy}
        onChange={onMappingChange}
      />

      {rowCount > 0 && !dirty && (
        <InsightsCard
          insights={understanding.insights}
          skippedRows={file.skippedRows ?? []}
          fixes={fixes}
          disabled={busy}
          onFix={onFix}
        />
      )}

      {rowCount === 0 && !dirty && <p className="m-0 text-sm text-fg-secondary">{t('users.intake.understand.noRows')}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t('common.back')}
        </Button>
        <span className="flex-1" />
        <Button type="button" variant="secondary" onClick={onApply} disabled={busy || !dirty}>
          {t('users.intake.understand.apply')}
        </Button>
        <Button type="button" variant="primary" onClick={onContinue} disabled={busy || dirty || rowCount === 0}>
          {t('users.intake.understand.continue')}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Button>
      </div>
      {dirty && <p className="m-0 text-right text-sm text-fg-tertiary">{t('users.intake.understand.dirtyHint')}</p>}
    </div>
  )
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-2xs font-semibold tracking-wide text-fg-tertiary uppercase">{term}</dt>
      <dd className="m-0 min-w-0 text-base font-medium text-fg-primary">{children}</dd>
    </div>
  )
}

function ColumnList({
  heading,
  columns,
  icon,
  empty,
}: {
  heading: string
  columns: string[]
  icon: ReactNode
  empty: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="m-0 text-xs font-semibold text-fg-secondary">{heading}</p>
      {columns.length === 0 ? (
        <p className="m-0 text-sm text-fg-tertiary">{empty}</p>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {columns.map((column) => (
            <li key={column}>
              <CanvasChip tone="neutral" icon={icon ?? undefined} label={column} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
