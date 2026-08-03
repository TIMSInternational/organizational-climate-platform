import { useTranslation } from '../i18n'
import { ErrorState } from '../components/ui'

// Safe to use translations here: TranslationProvider wraps RouterProvider in
// main.tsx, so it sits above every route element including this errorElement.
//
// #76 asked that the legacy error-handling primitives integrate with this
// boundary rather than duplicate it, so this renders ErrorState instead of
// growing its own markup, and the legacy LoadingErrorBoundary class is not
// ported — the router's errorElement already is that boundary.
export default function RouteErrorBoundary() {
  const { t } = useTranslation()

  return (
    <div style={{ padding: 'var(--admin-size-section-gap)' }}>
      <ErrorState title={t('errors.somethingWentWrong')} description={t('errors.generic')} />
    </div>
  )
}
