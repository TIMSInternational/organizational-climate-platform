import type { ReactNode } from 'react'
import { LanguageSwitcher, useTranslation } from '../i18n'
import { ThemeSwitcher } from '../components/layout'
import { Card, CardContent, CardDescription, CardHeader, H2 } from '../components/ui'
import { HeroRule } from '../components/storefront/StorefrontPrimitives'
import { cn } from '../lib/cn'

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
 * Every colour here is a token utility, so the palette flips with
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
  /**
   * The product lockup. In the admin variant it floats centred above the card;
   * in the storefront variant it anchors the page header, the way the source
   * site wears its brand.
   */
  brand?: ReactNode
  children: ReactNode
  /** Links out of this state: "back to sign in", "create an account". */
  footer?: ReactNode
  /**
   * Which visual language this frame wears.
   *
   * `admin` — the default and what all current callers except sign-in get — is
   * the `--admin-*` language the rest of the app is built in.
   *
   * `storefront` is the Conócete language (`styles/storefront.css`), and it is
   * a different PAGE SKELETON, not a repainted card: a site header carrying the
   * brand, a rule and a tag line with the settings controls opposite; a
   * centred main; serif display over a lede inside one soft-shadowed card; and
   * the footer as fineprint. Reskinning the admin card in place was tried
   * first and read as exactly what it was — admin bones under storefront
   * paint.
   *
   * ## The tension this prop deliberately leaves visible
   *
   * The remarks above argue these pages share a frame so that "five auth
   * states look like one product". A per-caller variant can break that: it is
   * a prop rather than a wholesale change because the alternative was to
   * restyle nine surfaces — including `RespondShell` and
   * `AcceptInvitationPage` — on the strength of a request about one. When the
   * decision is made for the rest, flip the default and delete the prop rather
   * than letting the two languages coexist indefinitely.
   */
  variant?: 'admin' | 'storefront'
}

export function AuthShell({
  title,
  description,
  banner,
  brand,
  children,
  footer,
  variant = 'admin',
}: AuthShellProps) {
  const { t } = useTranslation()

  if (variant === 'storefront') {
    return (
      <div className="flex min-h-dvh flex-col bg-store-ground font-store-sans">
        {/* The source header: brand, a hairline rule, a tag — and the page's
            few controls on the opposite edge. The rule and tag drop on small
            screens the same way the source hides `.rule`/`.tag` under 860px. */}
        <header className="w-full">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-5">
            <div className="flex min-w-0 items-center gap-4">
              {brand}
              <div aria-hidden className="hidden h-5 w-px bg-store-rule sm:block" />
              <span className="hidden text-[0.72rem] font-semibold uppercase tracking-store-kicker text-store-faint sm:block">
                {t('storefront.kicker.climate')}
              </span>
            </div>
            <div
              className="flex shrink-0 flex-wrap items-center justify-end gap-inline"
              // Not part of the auth flow itself — grouped so assistive tech can
              // skip past it to the form. The two selects keep their own inline
              // `var(--admin-*)` styling; an inline style outranks any class set
              // from here, so they are placed rather than repainted.
              role="group"
              aria-label={t('shell.settings')}
            >
              <LanguageSwitcher compact />
              <ThemeSwitcher />
            </div>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="flex w-full max-w-md flex-col gap-5">
            <div className="rounded-store-card border border-store-rule bg-store-surface p-8 shadow-store-card">
              <div className="flex flex-col gap-4">
                {banner}
                {/* The source pairing: serif display, the short accent rule,
                    then the lede in body colour. `text-store-h3` is the fluid
                    step the source uses for section heads — the hero step
                    clamps to 4.4rem and is drawn for a full-width page, not a
                    28rem card. */}
                <h1 className="font-store-serif text-store-h3 leading-tight tracking-store-display text-store-fg">
                  {title}
                </h1>
                <HeroRule />
                {description && (
                  <p className="text-[0.95rem] leading-relaxed text-store-body">{description}</p>
                )}
              </div>
              {/* Field styling lives here, not on each field: the storefront
                  system carries affordance on borders (its one shadow belongs
                  to the card, never to controls), so the input edge takes
                  `--storefront-line-control` — the 3:1 value WCAG 1.4.11 asks
                  of a control boundary; the source's own #E5E3F0 is 1.27:1 and
                  fails it. Inputs sit on the surface itself, as the source
                  draws them: white on white in light, edge-only in dark. */}
              <div
                className={cn(
                  'mt-6 grid gap-4',
                  '[&_input]:h-11 [&_input]:rounded-store-panel [&_input]:border-store-control',
                  '[&_input]:bg-store-surface [&_input]:px-4 [&_input]:text-[0.95rem] [&_input]:text-store-fg',
                  '[&_input::placeholder]:text-store-faint',
                  '[&_label]:text-[0.8rem] [&_label]:font-bold [&_label]:text-store-heading',
                )}
              >
                {children}
              </div>
            </div>

            {/* Fineprint, the way the source closes a page: quiet, centred,
                under the card rather than inside it. */}
            {footer && (
              <div className="flex flex-wrap items-center justify-center gap-inline px-2 text-center text-[0.8rem] leading-relaxed text-store-faint">
                {footer}
              </div>
            )}
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-panel-gap bg-surface-outer p-gutter">
      {brand}
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
        {/* `compact` drops the visible "Select language" span, which at this card's
            448px was wrapping to two lines beside a control it was not labelling
            anyway — the `<select>` carries its own `aria-label`, so the span was a
            duplicate label, not the only one. Same treatment ShellControls already
            gives these two. */}
        <LanguageSwitcher compact />
        <ThemeSwitcher />
      </div>
    </div>
  )
}
