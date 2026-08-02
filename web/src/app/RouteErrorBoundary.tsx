import { useTranslation } from '../i18n'

// Safe to use translations here: TranslationProvider wraps RouterProvider in
// main.tsx, so it sits above every route element including this errorElement.
export default function RouteErrorBoundary() {
  const { t } = useTranslation()

  return (
    <div style={{ padding: 'var(--admin-size-section-gap)' }}>
      <p role="alert">{t('errors.somethingWentWrong')}</p>
    </div>
  )
}
