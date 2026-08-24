import { useState } from 'react'
import { useTranslation } from '../../../i18n'
import { readSelectedCompanyId, readSessionClaims } from '../../../company-context'
import { QuestionLibraryBrowser } from '../../../components/questions'
import { SURVEY_QUESTION_TYPES, questionTypeLabel } from '../../surveys/surveyVocabulary'
import type { QuestionLibraryItemDetail } from '../api/questionLibrary'

/**
 * The shared question picker (#115), rendered open, for `npm run shot`.
 *
 * ## Why this page has to exist
 *
 * The picker is a dialog inside step 4 of a wizard. `scripts/shot.mjs` navigates to
 * a route and photographs it — it does not click through three wizard steps and then
 * open a modal — and the Vitest suite runs on happy-dom, which has no layout engine
 * at all. Without this route there is no way in this repository to LOOK at the one
 * component the issue is about, and "2769 tests passed" has already been an
 * insufficient answer to "does it render correctly" twice in this codebase.
 *
 * ## Why it costs production nothing
 *
 * `router.tsx` reaches it only through a dynamic `import()` inside the
 * `import.meta.env.DEV` branch, exactly as the #79 chart gallery is reached. Vite
 * replaces `import.meta.env.DEV` with the literal `false` in a production build, so
 * Rollup eliminates the branch and never emits a chunk for this module.
 * `router.test.ts` asserts both halves — the route's absence and the mechanism that
 * makes it absent.
 *
 * ## Why it takes the survey vocabulary
 *
 * It has to pass SOME `typeLabel`, and the survey wizard's is the wider of the two
 * (`ForSurvey` ⊃ `ForMicroclimate`), so a photograph taken here cannot flatter a
 * type the survey side would fail to name.
 */
export default function QuestionLibraryDevPage() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const [picked, setPicked] = useState<QuestionLibraryItemDetail[]>([])

  // The harness writes both the JWT claim and the stored selection; a real page
  // would read `useCompanyScope`, which needs a provider this route sits outside of.
  const companyId = readSelectedCompanyId() ?? readSessionClaims().companyId ?? null

  return (
    <main className="grid gap-panel-gap p-panel">
      <h1 className="m-0">{t('questionLibrary.title')}</h1>
      <p className="m-0 text-fg-secondary">
        {t('questionLibrary.selectedCount', { count: picked.length })}
      </p>
      <QuestionLibraryBrowser
        open={open}
        onOpenChange={setOpen}
        companyId={companyId}
        allowedTypes={SURVEY_QUESTION_TYPES}
        typeLabel={(type) => questionTypeLabel(t, type)}
        // The multiple-choice row in `scripts/shot-fixtures/question-library.json`,
        // opened so the photograph includes the preview body — the one region of
        // this component that has a layout of its own.
        initialPreviewId="a0000000-0000-0000-0000-000000000003"
        onAdd={(items) => setPicked((current) => [...current, ...items])}
      />
    </main>
  )
}
