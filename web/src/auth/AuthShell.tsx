import type { ReactNode } from 'react'
import { LanguageSwitcher, useTranslation } from '../i18n'
import { ThemeSwitcher } from '../components/layout'
import { Card, CardContent, CardDescription, CardHeader, H2 } from '../components/ui'

/**
 * The frame every unauthenticated page shares (#81).
 *
 * ## Why these pages get a shell of their own rather than `AdminLayout`
 *
 * `AdminLayout` is the *authenticated* shell: sidebar, company switcher,
 * notification bell, sign-out. Every one of those needs a token, and these pages
 * are precisely the ones reached without a usable one. They sit outside
 * `RequireAuth` in `router.tsx` for the same reason. So the house rule "pages
 * live inside AdminLayout + PageTopBar" cannot apply here, and this is what
 * stands in for it: one frame, so five auth states look like one product instead
 * of five loose forms.
 *
 * ## Language and theme are offered here, not only after sign-in
 *
 * ES/EN is a P1 requirement, and `ShellControls` — the only place either switcher
 * has lived — is inside the authenticated shell. A Spanish-speaking user who
 * cannot get past the login screen therefore had no way to read it in Spanish,
 * and someone on a dark-mode machine had no way to fix a light-mode login page.
 * Both switchers persist to `localStorage`, so the choice made here is the one
 * that greets them on the other side.
 *
 * ## Both themes
 *
 * Every colour here is a `tokens.css` utility (`bg-surface-outer`, `Card`'s
 * `bg-surface-card`, `text-fg-*`), so the palette flips with
 * `:root[data-theme]`. Nothing is a literal, which is the defect this project
 * hits most often: a hardcoded surface reads fine in light mode and disappears in
 * dark.
 */
export interface AuthShellProps {
  /** Already-translated. Rendered as the page's `<h1>`. */
  title: string
  /** Optional supporting line under the title. */
  description?: string
  /**
   * Sits above the title — a status glyph or a `Badge`. Decorative; the title
   * carries the meaning, so nothing depends on it being seen.
   */
  banner?: ReactNode
  children: ReactNode
  /** Links out of this state: "back to sign in", "create an account". */
  footer?: ReactNode
}

export function AuthShell({ title, description, banner, children, footer }: AuthShellProps) {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-panel-gap bg-surface-outer p-gutter">
      <Card className="w-full max-w-md">
        <CardHeader>
          {banner}
          {/* `H2`'s scale, rendered as the page's `h1`: this is the only heading
              on the page so it has to be level 1, but the shell's 24px h1 is
              sized for a full page of content and overwhelms a 448px card. That
              is exactly what `as` exists for. */}
          <H2 as="h1">{title}</H2>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent className="grid gap-panel-gap">{children}</CardContent>
      </Card>

      {footer && <div className="flex flex-wrap items-center justify-center gap-inline text-sm">{footer}</div>}

      <div
        className="flex flex-wrap items-center justify-center gap-inline"
        // Not part of the auth flow itself — grouped so assistive tech can skip
        // past it to the form.
        role="group"
        aria-label={t('shell.settings')}
      >
        <LanguageSwitcher />
        <ThemeSwitcher />
      </div>
    </div>
  )
}
