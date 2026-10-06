import type { ReactNode } from 'react'
import { LanguageSwitcher, useTranslation } from '../../i18n'
import { BrandLockup, ThemeSwitcher } from '../../components/layout'
import { SkipLink } from '../../components/ui'
import { cn } from '../../lib/cn'

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
 * ## There is no dark variant, and the reason is worth keeping
 *
 * This frame carried a `ground="dark"` prop until 2026-09-22: it pinned the palette dark
 * for the life of the screen, for `/login` alone. "La sede" retired it. The screen is still
 * dark, but the darkness is now `AuthBackdrop` — a photograph under a navy wash, behind the
 * whole page — and a palette pin on top of that turned the artboard's WHITE card dark, so
 * the mechanism was fighting the design it had been written to serve. Nothing passed the
 * prop afterwards, so the prop, `ForcedDarkGround` and `useForcedDarkTheme` went with it.
 *
 * Keep the shape in mind before reaching for a pin again: a screen that wants to LOOK dark
 * wants a ground, not a palette. Pinning the palette also changes every control on top of
 * it, which is only ever right when the whole composition is dark.
 *
 * (`authNextPages.test.tsx` holds what replaced the three pin tests: the reader's stored
 * theme survives a visit to `/login`, and the picker that changes it still works.)
 */
/** Which slice of the product the stage explains on a given screen. */
export type StageVariant = 'product' | 'access' | 'cycle' | 'administration'

/**
 * The stage's content, per variant, as literal key paths so a typo is a failing
 * `keysExist` test rather than a blank panel.
 *
 * One SYSTEM — eyebrow, serif lead, a label/value rail — carrying a DIFFERENT slice of the
 * software on each screen. It was one constant panel for about an hour on 2026-09-22 and
 * Federico's note was "para cada página, información distinta": a panel that says the same
 * thing on five screens is furniture, and nobody reads furniture twice.
 */
const STAGE: Record<
  StageVariant,
  { eyebrow: string; lead: string; rows: readonly (readonly [string, string])[] }
> = {
  product: {
    eyebrow: 'auth.stage.product.eyebrow',
    lead: 'auth.stage.product.lead',
    rows: [
      ['auth.stage.product.measuresLabel', 'auth.stage.product.measures'],
      ['auth.stage.product.followsLabel', 'auth.stage.product.follows'],
    ],
  },
  access: {
    eyebrow: 'auth.stage.access.eyebrow',
    lead: 'auth.stage.access.lead',
    rows: [
      ['auth.stage.access.rolesLabel', 'auth.stage.access.roles'],
      ['auth.stage.access.scopeLabel', 'auth.stage.access.scope'],
    ],
  },
  cycle: {
    eyebrow: 'auth.stage.cycle.eyebrow',
    lead: 'auth.stage.cycle.lead',
    rows: [
      ['auth.stage.cycle.surveyLabel', 'auth.stage.cycle.survey'],
      ['auth.stage.cycle.pulseLabel', 'auth.stage.cycle.pulse'],
      ['auth.stage.cycle.followUpLabel', 'auth.stage.cycle.followUp'],
    ],
  },
  administration: {
    eyebrow: 'auth.stage.administration.eyebrow',
    lead: 'auth.stage.administration.lead',
    rows: [
      ['auth.stage.administration.whoLabel', 'auth.stage.administration.who'],
      ['auth.stage.administration.changesLabel', 'auth.stage.administration.changes'],
    ],
  },
}

export function AuthCanvas({
  children,
  stage = 'product',
  skipLabel,
}: {
  children: ReactNode
  stage?: StageVariant
  /** Overrides the generic skip label where a screen has a more specific one of its own. */
  skipLabel?: string
}) {
  const { t } = useTranslation()

  return (
    <AuthGround>
      {/* First focusable thing on the page. `InvitationFrame` and `RespondShell` have had
          one since they were written; this frame — seven routes, including the one screen
          every user must pass — did not, so a keyboard user Tabbed through the language
          and theme pickers to reach the first field. */}
      <SkipLink href="#main">{skipLabel ?? t('auth.next.skipToForm')}</SkipLink>
      <div className="relative grid min-h-dvh grid-cols-1 lg:grid-cols-[1.05fr_minmax(30rem,0.95fr)]">
        <AuthStage variant={stage} />

        <div className="flex min-h-dvh flex-col">
          {/* Transparent and unruled, like the respond strip: the card below is the only
              surface, and a filled bar here would read as a second one with a seam. The
              lockup rides here only until the stage appears and takes it — two lockups on
              one screen is the kind of thing nobody reports and everybody notices. */}
          {/* The lockup rides here only until the panel appears and takes it — two lockups
              on one screen is the kind of thing nobody reports and everybody notices. */}
          <header className="flex w-full flex-wrap items-center gap-inline px-4 py-3.5 lg:invisible">
            <BrandLockup size="compact" />
          </header>

          {/* Centred in its own column now rather than on the whole page. The card used to
              sit in the top third of 1440px with two thirds of the viewport empty under
              it, which reads as a page that failed to finish loading rather than as a
              composition. */}
          <main id="main" className="flex w-full flex-1 items-center justify-center px-6 pb-4 pt-4 sm:px-10">
            <div className="flex w-full max-w-110 flex-col gap-4">{children}</div>
          </main>

          {/* The artboard puts these at the foot of the page, not floating over its top
              corner. They are not part of the auth flow, so they come AFTER the form in
              reading order as well as below it — which is also where a reader who needs
              the language picker looks once the form has not helped. */}
          <footer
            className="flex w-full flex-wrap items-center justify-end gap-1.5 px-6 pb-6 pt-2 sm:px-10"
            role="group"
            aria-label={t('shell.settings')}
          >
            <LanguageSwitcher variant="chip" />
            <ThemeSwitcher variant="chip" />
          </footer>
        </div>
      </div>
    </AuthGround>
  )
}

/**
 * The panel beside the form: what this software is, told one slice at a time.
 *
 * ## Why a photograph, and why it is still the shell colour underneath
 *
 * The ground stays `bg-surface-shell` — the navy the signed-in sidebar is painted in — and
 * the photograph sits on it under a navy wash, so the page degrades to the old flat panel
 * if the image never loads. Federico chose this over the flat panel and over a plain
 * centred card on 2026-09-22.
 *
 * What is gone: the two radial washes and the vignette. They read as a gradient smear
 * rather than a light source, and the photograph does the job they were hired for. What was
 * already gone: the drifting dot lattice, ruled out 2026-09-21.
 *
 * ## Why it is no longer `aria-hidden`
 *
 * It used to be, and correctly: it carried a slogan that restated the card beside it, so a
 * screen reader read the brand and the promise twice before reaching the first field. This
 * panel instead carries information that appears nowhere else on the page. Hiding unique
 * content from assistive tech while showing it to sighted desktop users is not a trade
 * worth making, so it is a named `<aside>` — a complementary landmark, which AT can skip in
 * one keystroke, and which is what the old comment actually wanted.
 *
 * Exactly one brand lockup sits in the accessibility tree at every width: below `lg` this
 * panel is `display: none` and the header carries it; at `lg` and up the header's is
 * `visibility: hidden` and this one carries it.
 *
 * ## Hidden below `lg`, and that is the whole mobile story
 *
 * On a phone the form IS the page: a stacked panel above it would push the first field
 * under the fold, which on a sign-in screen is the one thing that must never happen.
 */
function AuthStage({ variant }: { variant: StageVariant }) {
  const { t } = useTranslation()
  const { eyebrow, lead, rows } = STAGE[variant]

  return (
    <aside
      aria-label={t(eyebrow)}
      className="on-shell relative hidden lg:flex lg:flex-col"
    >
      <div className="relative flex shrink-0 flex-col gap-3 px-12 pt-10">
        <BrandLockup size="compact" />
      </div>

      {/* Centred in the space under the lockup, so it sits with the card rather than on the
          floor of the screen — `justify-between` put it at the bottom, which read as two
          things stranded at opposite corners. */}
      <div className="relative flex flex-1 flex-col justify-center px-12 pb-14">
        <span className="text-2xs font-bold uppercase tracking-eyebrow text-fg-tertiary">{t(eyebrow)}</span>
        {/* The app's display face, from the element rule `index.css` puts on h1/h2. Weight
            stays regular: the face ships ONE weight and a synthesised 600 is the fake bold
            `fonts.css` exists to avoid. At `text-3xl` rather than the storefront's display
            step, which clamps to 4.4rem and is what made the first version read as a
            marketing page bolted to the front of a product. */}
        <p className="m-0 mt-3 max-w-[29rem] font-store-serif text-3xl font-normal leading-tight text-fg-primary">
          {t(lead)}
        </p>
        <dl className="m-0 mt-7 flex max-w-[34rem] flex-col border-t border-line-light">
          {rows.map(([labelKey, valueKey]) => (
            <div
              key={labelKey}
              className="flex items-baseline gap-5 border-b border-line-light py-3.5 last:border-b-0"
            >
              <dt className="w-28 shrink-0 text-2xs font-bold uppercase tracking-eyebrow text-fg-tertiary">
                {t(labelKey)}
              </dt>
              <dd className="m-0 text-sm leading-normal text-fg-primary">{t(valueKey)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </aside>
  )
}

/**
 * The ground under the strip and the column.
 *
 * It was a two-branch component while `ground="dark"` existed — one branch called the pin
 * hook, because hooks cannot be called conditionally. With the pin gone there is one
 * ground, and `AuthBackdrop` is what makes `/login` dark.
 */
function AuthGround({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col bg-surface-outer">
      <AuthBackdrop />
      {children}
    </div>
  )
}

/**
 * The photograph, under the whole page rather than under the panel.
 *
 * It sat inside the `<aside>` until 2026-09-22, which put a hard vertical seam down the
 * middle of the screen: photograph on the left, flat ground on the right, card floating on
 * the flat half. The artboard has one image across the viewport with the card ON it, and
 * that is the difference between a composition and two panes side by side.
 *
 * `lg` and up only, matching the panel: on a phone the form is the page, and a photograph
 * behind it buys nothing and costs a download.
 *
 * Decorative — `alt=""` — because every word on the panel is text beside it. If the image
 * never loads, the navy ground underneath is the design the auth screens had before it.
 */
function AuthBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden overflow-hidden lg:block">
      <img src="/auth-sede.webp" alt="" className="size-full object-cover" />
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(100deg, color-mix(in srgb, var(--color-surface-shell) 94%, transparent) 0%,' +
            ' color-mix(in srgb, var(--color-surface-shell) 86%, transparent) 38%,' +
            ' color-mix(in srgb, var(--color-surface-shell) 66%, transparent) 100%)',
        }}
      />
    </div>
  )
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
  /** Omitted on `/login`, where it only repeated the wordmark two inches above it. */
  eyebrow?: string
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
      {eyebrow !== undefined && (
        <span data-slot="auth-eyebrow" className="text-2xs font-bold uppercase tracking-eyebrow text-fg-label">
          {eyebrow}
        </span>
      )}
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
 * ink with a quiet asterisk, the control, and an 11px helper under it.
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
          /* Not `text-accent-red` any more. Red means destructive since the navy revalue
             (`docs/decisions/palette-navy-not-purple.md`), and a form whose every required
             field wears the delete colour reads as a form full of errors. Still decorative
             and still `aria-hidden`: `required` on the control is what AT announces. */
          <span aria-hidden="true" className="text-fg-tertiary">
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
