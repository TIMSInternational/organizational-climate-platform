import type { ReactNode } from 'react'
import { LanguageSwitcher, useTranslation } from '../../i18n'
import { BrandLockup, ThemeSwitcher } from '../../components/layout'
import { cn } from '../../lib/cn'
import { useForcedDarkTheme } from '../../theme/useForcedDarkTheme'

/**
 * The frame the five unauthenticated screens share, drawn from the 10 Sep canvas
 * (Login, Register, AuthError, AuthTransition, AccountInactive).
 *
 * ## The geometry, and where each number comes from
 *
 * Every artboard in this group is the same page: a transparent strip carrying the lockup
 * on the left and the language/theme chips on the right (`padding: 14px 16px`), then one
 * 440px column centred on the 1440px ground, 48px below the strip's own 8px of pad, with
 * 32px of floor. The card inside it is the canvas's `.card` — 8px radius on the hairline,
 * a 1px shadow — at `padding: 28px 28px 24px` with 20px between its blocks, and anything
 * that sits *under* the card (the anonymity line, the "already have an account?" row) is
 * 16px below it and outside it.
 *
 * `max-w-110` is that 440px on the 4px spacing unit. It is narrower than `max-w-field`
 * (32rem/512px), which is the primitive's field cap and not this column's width.
 *
 * ## Why this is not `AuthShell`
 *
 * `AuthShell` is the same idea in the previous design language, and it still frames
 * `/accept-invitation/:token` and the pages this lane did not redraw. It is left exactly
 * as it is: reskinning it in place would have silently restyled every caller, including
 * two the canvas never drew. This is the canvas's frame, and the five routes opted into it
 * one at a time.
 *
 * ## The strip is the respond header's, deliberately
 *
 * `BrandLockup size="compact"` plus the two `variant="chip"` pickers is the exact row
 * `RespondShell` draws, because the canvas draws one strip for every page reached without
 * a session — the respond surface and these five. A second implementation of it would
 * drift by a pixel; the tokens and the sizes are already decided there.
 *
 * ## Both themes
 *
 * Every colour is a token utility, so the palette flips with `:root[data-theme]`. The
 * ground is `bg-surface-outer` (`#f8f7fb` in light, `#0f0a1c` in dark) and the card
 * `bg-surface-card`; nothing here is a literal.
 *
 * ## `ground="dark"` — one screen, and only one
 *
 * `/login` opts into a dark ground (`LoginNextPage` records the reasoning). It is a PROP
 * rather than a change to this component's default because six other screens share this
 * frame — register, the three auth states, and the invitation frame — and none of them
 * asked to be redrawn. Passing nothing leaves every one of them exactly as it was.
 *
 * The variant does three things that only make sense together: it pins the palette to dark
 * for as long as the screen is mounted, it drops the theme picker from the strip, and it
 * centres the column. The picker goes because on a screen that is dark whatever you choose,
 * a control offering the choice is a lie — it would appear to do nothing. The language
 * picker stays, because that one still works and is the more important of the two here:
 * the reader may not read English.
 *
 * This variant carried a drifting dot lattice on its ground until 2026-09-21, when
 * Federico ruled it out. The dark itself is his call too and stays.
 */
export function AuthCanvas({ children, ground = 'plain' }: { children: ReactNode; ground?: 'plain' | 'dark' }) {
  const { t } = useTranslation()
  const dark = ground === 'dark'

  return (
    <AuthGround dark={dark}>
      <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[1.05fr_minmax(30rem,0.95fr)]">
        <AuthStage />

        <div className="flex min-h-dvh flex-col">
          {/* Transparent and unruled, like the respond strip: the card below is the only
              surface, and a filled bar here would read as a second one with a seam. The
              lockup rides here only until the stage appears and takes it — two lockups on
              one screen is the kind of thing nobody reports and everybody notices. */}
          <header className="flex w-full flex-wrap items-center justify-between gap-inline px-4 py-3.5">
            <span className="lg:invisible">
              <BrandLockup size="compact" />
            </span>
            <span
              className="flex flex-wrap items-center gap-1.5"
              // Not part of the auth flow itself — grouped so assistive tech can skip past
              // it to the form.
              role="group"
              aria-label={t('shell.settings')}
            >
              <LanguageSwitcher variant="chip" />
              {!dark && <ThemeSwitcher variant="chip" />}
            </span>
          </header>

          {/* Centred in its own column now rather than on the whole page. The card used to
              sit in the top third of 1440px with two thirds of the viewport empty under
              it, which reads as a page that failed to finish loading rather than as a
              composition. */}
          <main id="main" className="flex w-full flex-1 items-center justify-center px-6 pb-10 pt-4 sm:px-10">
            <div className="flex w-full max-w-110 flex-col gap-4">{children}</div>
          </main>
        </div>
      </div>
    </AuthGround>
  )
}

/**
 * The panel beside the form: the product's own frame, carrying its promise.
 *
 * ## Why the shell colour and not a picture
 *
 * The ground is `bg-surface-shell` — the exact indigo the signed-in sidebar is painted in,
 * and one of the few tokens that is dark in BOTH themes. Signing in then reads as stepping
 * into the product rather than arriving at a marketing page bolted to its front, and it
 * costs no bytes, needs no asset pipeline, and cannot drift from the app's palette because
 * it IS the app's palette.
 *
 * The depth is two radial washes and a vignette, placed as a single light source high on
 * the left. It is deliberately not a texture: the drifting dot lattice that sat here on
 * 21 Sep was wallpaper — pattern without meaning — and Federico ruled it out the same day.
 * A light has somewhere it comes from; a lattice does not.
 *
 * ## Hidden below `lg`, and that is the whole mobile story
 *
 * On a phone the form IS the page: a stacked hero above it would push the first field
 * under the fold, which on a sign-in screen is the one thing that must never happen. The
 * strip keeps the lockup at those widths, which is why it carries `lg:invisible` rather
 * than being deleted.
 */
function AuthStage() {
  const { t } = useTranslation()
  return (
    <aside
      // Decorative and duplicative: the form column carries the lockup, the heading and
      // every control. A screen reader that reads this panel reads the brand twice before
      // reaching the first field.
      aria-hidden="true"
      className="relative hidden overflow-hidden bg-surface-shell lg:flex lg:flex-col lg:justify-between"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(70% 55% at 18% 12%, color-mix(in oklab, var(--color-accent-blue) 42%, transparent) 0%, transparent 70%),' +
            'radial-gradient(55% 45% at 88% 96%, color-mix(in oklab, var(--color-accent-purple) 34%, transparent) 0%, transparent 72%),' +
            'radial-gradient(120% 90% at 50% 50%, transparent 40%, rgb(0 0 0 / 0.38) 100%)',
        }}
      />
      <div className="relative flex flex-col gap-3 px-12 pt-10">
        <BrandLockup size="compact" />
      </div>
      <div className="relative flex flex-col gap-5 px-12 pb-14">
        {/* The app's display face, taken from the element rule `index.css` puts on h1/h2
            rather than left to the body sans — the card beside this panel sets its own
            heading in the serif, and two faces for one voice is what made the first
            version read as a different product's marketing page. Weight stays regular:
            the face ships ONE weight and a synthesised 600 is the fake bold `fonts.css`
            exists to avoid. */}
        <p className="m-0 max-w-[16ch] font-store-serif text-store-display font-normal leading-[1.05] text-fg-on-accent">
          {t('auth.next.stageHeadline')}
        </p>
        <p className="m-0 max-w-[46ch] text-reading text-fg-on-accent/70">{t('auth.next.stageBody')}</p>
      </div>
    </aside>
  )
}

/**
 * The ground under the strip and the column.
 *
 * Split out so the dark pin is a hook call on a component that only exists in the dark
 * variant: hooks cannot be called conditionally, and `AuthCanvas` is rendered by seven
 * screens of which one wants it.
 */
function AuthGround({ dark, children }: { dark: boolean; children: ReactNode }) {
  return dark ? (
    <ForcedDarkGround>{children}</ForcedDarkGround>
  ) : (
    <div className="flex min-h-dvh flex-col bg-surface-outer">{children}</div>
  )
}

function ForcedDarkGround({ children }: { children: ReactNode }) {
  useForcedDarkTheme()
  // Identical markup to the plain ground; the hook is the whole difference. `bg-surface-outer`
  // resolves to the dark palette because the hook has pinned the attribute above it.
  return <div className="flex min-h-dvh flex-col bg-surface-outer">{children}</div>
}

/** The canvas's `.card` at the auth boards' own padding. */
export function AuthCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      data-slot="auth-card"
      className={cn(
        'flex min-w-0 flex-col gap-5 rounded-xl border border-line-default bg-surface-card px-7 pb-6 pt-7 shadow-sm',
        className,
      )}
    >
      {children}
    </section>
  )
}

/**
 * The block every one of the five cards opens with: an optional status tile, the eyebrow,
 * the page's `<h1>` in the serif at 24px, and one line of what this screen is for.
 *
 * The tile is 36px in the artboards where it appears — larger than `parts.tsx`'s 32px
 * `IconBox`, which is the icon beside a row rather than the one thing at the top of a
 * card — so it is drawn here rather than borrowed. It is `aria-hidden`: the heading under
 * it carries the meaning, and a lock glyph announced as "lock" says nothing the sentence
 * does not.
 */
export function AuthHeadline({
  eyebrow,
  title,
  description,
  tile,
  tone = 'neutral',
}: {
  eyebrow: string
  title: string
  description?: ReactNode
  tile?: ReactNode
  tone?: 'neutral' | 'critical' | 'warning' | 'good'
}) {
  return (
    <div className="flex flex-col gap-2">
      {tile && (
        <span
          aria-hidden="true"
          data-slot="auth-tile"
          className={cn(
            'mb-1 inline-flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4',
            tone === 'critical' && 'bg-accent-red-soft text-accent-red',
            tone === 'warning' && 'bg-accent-amber-soft text-accent-amber-ink',
            tone === 'good' && 'bg-accent-green-soft text-accent-green-ink',
            tone === 'neutral' && 'bg-surface-icon-box text-accent-blue',
          )}
        >
          {tile}
        </span>
      )}
      <span data-slot="auth-eyebrow" className="text-2xs font-bold uppercase tracking-eyebrow text-fg-label">
        {eyebrow}
      </span>
      <h1 className="m-0 text-3xl">{title}</h1>
      {description !== undefined && <p className="m-0 text-base text-fg-secondary">{description}</p>}
    </div>
  )
}

/**
 * The quiet line under a card: an icon in the lane's tone and one sentence.
 *
 * Both the sign-in and the register boards close with the anonymity promise drawn exactly
 * this way — outside the card, 12px, tertiary ink, the shield in the green ink. It is the
 * one thing an employee about to answer an anonymous survey is actually asking about, so
 * it is on the page rather than in a help article.
 */
export function AuthFootnote({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p data-slot="auth-footnote" className="m-0 flex items-start gap-2 px-1 text-sm leading-normal text-fg-tertiary">
      <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0 text-accent-green-ink [&_svg]:size-3.5">
        {icon}
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/**
 * The hairline-and-word divider between the password form and the Google button — the
 * canvas's `o`. Decorative: `aria-hidden` on the rules, and the word itself is the only
 * thing read out, which is what the artboard draws.
 */
export function AuthDivider({ label }: { label: string }) {
  return (
    // `text-fg-tertiary`, not the canvas's `#8a82a5`: `styles/inkContrast.test.ts` keeps
    // the non-text ink `fg-light` to its two exempt sites, and this word is read.
    <div data-slot="auth-divider" className="flex items-center gap-2.5 text-sm text-fg-tertiary">
      <span aria-hidden="true" className="h-px flex-1 bg-line-light" />
      <span>{label}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-line-light" />
    </div>
  )
}

/**
 * A labelled control the way the auth cards draw one: a 12px semibold label in the primary
 * ink with the canvas's red asterisk, the control, and an 11px helper under it.
 *
 * `parts.tsx`'s `Field` is the same idea for the *admin* boards, where the label is 11px
 * in the secondary ink. These five cards set it at 12px on the primary ink, which is the
 * difference between a form inside a dense screen and the only form on the page.
 *
 * `htmlFor` is required rather than optional: every caller here wraps a real control, and
 * an unlabelled input on the one page every user must pass is the kind of thing a suite
 * with no layout engine cannot see.
 */
export function AuthField({
  htmlFor,
  fieldLabel,
  required = false,
  helper,
  children,
}: {
  htmlFor: string
  fieldLabel: string
  required?: boolean
  helper?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="m-0 flex gap-1 text-sm font-semibold text-fg-primary">
        {fieldLabel}
        {required && (
          <span aria-hidden="true" className="text-accent-red">
            *
          </span>
        )}
      </label>
      {children}
      {helper !== undefined && (
        <span data-slot="auth-field-helper" className="text-xs leading-snug text-fg-tertiary">
          {helper}
        </span>
      )}
    </div>
  )
}
