import type { ReactNode } from 'react'
import { EyeOff, Waves } from 'lucide-react'
import { LanguageSwitcher, useTranslation } from '../../i18n'
import { Chip, SkipLink } from '../ui'
import { ThemeSwitcher } from './ShellControls'

/**
 * The wordmark, split for its two-tone treatment. Same two halves as
 * `SidebarBrand`, and `i18n/noHardcodedStrings.test.ts` already exempts both by
 * name for the reason written out there: `CLIMA|TE` is one logotype, and where the
 * seam falls is a property of the drawn mark rather than of the language.
 */
const BRAND_LEAD = 'CLIMA'
const BRAND_TAIL = 'TE'

/**
 * The frame the three respond flows share: `/survey/:id`, `/surveys/:id/respond`
 * and `/microclimates/:id/respond`.
 *
 * ## Why it is not `AdminLayout`
 *
 * `AdminLayout` is the *administrator's* shell — a role-aware rail built from the
 * JWT claims, a company-context switcher, a notification bell, a sign-out control
 * and a command palette. None of it belongs on the one surface an ordinary
 * employee ever sees. On `/survey/:id` it would be worse than noise: that route is
 * open to anyone holding a link, and every one of those pieces is a way for a
 * company's structure to leak onto it.
 *
 * So this is the standalone, centred layout instead — capped at
 * `--admin-size-content-max`. `AdminLayout` dropped that cap from its own content
 * column and records why it still belongs here: a standalone centred page has no
 * rail beside it, so there is nothing for a centred column to drift away from.
 *
 * ## Why the language and theme pickers are here rather than optional
 *
 * A respondent arriving from an email has no stored preference and no
 * authenticated locale, so the app starts them in whatever `detectLocale()` reads
 * off the browser. On a shared or mis-configured machine that is the wrong
 * language, and this is the one page where being unable to change it means being
 * unable to answer at all. The theme picker is here for the same reason it is on
 * `AuthShell`: `ShellControls` is the only other place it has ever lived, and that
 * is inside the authenticated shell.
 *
 * ## The header carries the brand and the anonymity state, and nothing else
 *
 * It used to carry the words "Organizational Climate Platform" in plain grey, with
 * the two pickers floating beside them — no mark, no wordmark, nothing that says
 * this is the same product that emailed the respondent. For most employees this is
 * the *only* screen of this product they ever see, so it now opens on the lockup
 * the signed-in rail opens on, and (when the survey is anonymous) on the chip that
 * states it before the first question is read.
 *
 * Still no navigation and no account: somebody who followed a link out of an email
 * needs to know what site they are on and that nobody can trace the answers back to
 * them. Anything else here would be a claim about a tenant.
 */
export interface RespondShellProps {
  /** Already-translated label for the skip link, e.g. "Skip to the survey". */
  skipLabel: string
  /**
   * The id the skip link targets and `<main>` carries. Defaults to `respond`.
   * `/survey/:id` passes `survey`, which is the anchor its own test pins.
   */
  contentId?: string
  /**
   * Whether responses to the thing being answered are anonymous. Puts the
   * "Anonymous" chip beside the lockup when it is.
   *
   * Defaults to **off**, deliberately. Anonymity is a per-survey setting the shell
   * cannot know, and a chip that appears by default would be this page making the
   * one promise it is least entitled to guess at. Callers that have the flag pass
   * it; the ones that do not are unaffected.
   */
  anonymous?: boolean
  children: ReactNode
}

export function RespondShell({
  skipLabel,
  contentId = 'respond',
  anonymous = false,
  children,
}: RespondShellProps) {
  const { t } = useTranslation('surveyRespond')

  return (
    <div className="flex min-h-dvh flex-col bg-surface-outer">
      {/* First focusable thing on the page, so a keyboard user is not made to Tab
          through the language and theme pickers on the way to the questions. */}
      <SkipLink href={`#${contentId}`}>{skipLabel}</SkipLink>

      {/* Transparent and unruled, like the shell's own top strip: the card below
          is the only panel, and a filled bar here would read as a second surface
          with a seam between them. */}
      <header className="mx-auto flex w-full max-w-content flex-wrap items-center justify-between gap-inline px-gutter py-inline">
        <span className="flex flex-wrap items-center gap-inline">
          <BrandLockup />
          {/* Beside the lockup rather than inside the form, because it is the
              answer to the question a respondent asks before they read anything:
              can this come back to me. `Chip` requires the word, so the tint is
              never the only carrier of it. */}
          {anonymous ? (
            <Chip tone="accent" label={t('anonymousChip')} icon={<EyeOff aria-hidden="true" />} />
          ) : null}
        </span>
        <span className="flex flex-wrap items-center gap-inline">
          <LanguageSwitcher compact />
          <ThemeSwitcher compact />
        </span>
      </header>

      <main
        id={contentId}
        // **No `overflow` of any kind here, and that is load-bearing.** This
        // `<main>` used to carry `overflow-x-auto`, copied from `AdminLayout`'s
        // panel as a generic wide-content guard. It cost the page its sticky
        // instrument panel: CSS promotes the used value of `overflow-y` to `auto`
        // when the other axis is not `visible`, so `<main>` became the nearest
        // scrollport for every `position: sticky` inside it — and unlike
        // `AdminLayout`'s `<main>` (`h-dvh` shell, `flex-1 overflow-y-auto`, so it
        // genuinely scrolls) this one grows with its content and the DOCUMENT
        // scrolls. A sticky box in a scrollport that never scrolls never sticks.
        // Measured in Chromium at 1440x900 on /survey/s1: `scrollHeight === clientHeight`
        // (1273), and the panel sat at `rect.top = -238` at the page's maximum
        // scroll — the anonymity promise left the screen after the first question
        // and never came back. The guard now sits on the wide rows themselves; see
        // `RespondQuestionField`.
        // `flex flex-col` so a child asking for `flex-1` fills the column. Without
        // it a short state — the thank-you card, a closed survey — renders as a
        // stub stranded at the top of a large empty field, which reads as content
        // that failed to load rather than as a page with little on it.
        className="mx-auto flex w-full max-w-content flex-1 flex-col px-gutter pb-section"
      >
        {children}
      </main>
    </div>
  )
}

/**
 * The mark and the wordmark, with nothing attached to them.
 *
 * ## Why this exists rather than a call to `SidebarBrand`
 *
 * `SidebarBrand` is the *head of the rail*: it takes `collapsed` and
 * `onToggleCollapsed` and draws a collapse toggle beside the lockup. Neither the
 * respond header nor the sign-in card has a rail to collapse, so calling it would
 * mean rendering a control that toggles nothing. Its `Mark` is a module-private
 * function there, so the lockup itself could not be reached without exporting it.
 *
 * So the lockup is defined once, here, and the two shells that are not
 * `AdminLayout` — the respond header and `auth/LoginPage` — both render *this*.
 * Every part of it is `SidebarBrand`'s verbatim: the same `Waves` glyph (this
 * product has no logo asset; `public/favicon.svg` is still the stock Vite bolt),
 * the same 28px tinted tile, the same two-tone `CLIMA|TE`. The one deliberate
 * follow-up is that `SidebarBrand` should call this too rather than keep its own
 * copy — that is an edit to the rail, with the rail's own tests, not a side effect
 * of giving the respondent a wordmark.
 *
 * ## The two sizes that are not tokens
 *
 * The tile's `rounded-md` is 6px against `SidebarBrand`'s one-off `borderRadius: 7`
 * (7 is between `--admin-radius-lg` and `--admin-radius-xl` and has no token), and
 * the wordmark is `text-xl` — 16px against the prototype's 15. Both round to the
 * nearest existing step rather than earning a one-off value; the 28px tile, which
 * is what makes the lockup line up with the controls beside it, is exact.
 *
 * ## Contrast
 *
 * `text-accent-blue` is 3.74:1 on the panel, under AA for text this size. That is
 * correct here and nowhere else on these pages: WCAG 1.4.3 exempts text that is
 * part of a logotype, and this half-word is the drawn mark rather than copy —
 * which is also why `features/surveys/respondContrast.test.ts` measures the chip
 * word and the prose but not this. Nothing else in either shell inks with it.
 */
export function BrandLockup() {
  return (
    <span data-slot="brand-lockup" className="flex items-center gap-inline">
      {/* `aria-hidden` for `SidebarBrand`'s reason: the wordmark beside it already
          names the product, and an announced "Waves" would be noise. */}
      <span
        aria-hidden="true"
        className="grid size-icon-box shrink-0 place-items-center rounded-md bg-accent-blue-soft text-accent-blue"
      >
        <Waves className="size-icon" />
      </span>
      {/* One `<span>`, two coloured halves — not two words with a space, which is
          what a screen reader would otherwise announce. */}
      <span className="whitespace-nowrap text-xl font-bold tracking-tight">
        <span className="text-fg-primary">{BRAND_LEAD}</span>
        <span className="text-accent-blue">{BRAND_TAIL}</span>
      </span>
    </span>
  )
}

/**
 * The block over the questions: what this is, what it is called, what it is for.
 *
 * The eyebrow names the kind of thing (a survey, a live session) because the
 * `<h1>` is the survey's own title and a respondent arriving from an email has no
 * other context for it. `max-w-prose` on the description rather than on the
 * column: it is prose that becomes unreadable at full width, and the same
 * measurement that removed the shell's width cap put an uncapped description at
 * 132 characters per line.
 */
export function RespondCaption({
  eyebrow,
  title,
  description,
}: {
  /** Already-translated. */
  eyebrow: string
  /** Already-translated. Rendered as the page's `<h1>`. */
  title: string
  /** Author-written content, in the language the payload resolved to. */
  description?: string | null
}) {
  return (
    <header className="grid gap-1 border-b border-line-light pb-panel-gap">
      <span className="text-2xs font-semibold uppercase tracking-eyebrow text-fg-secondary">
        {eyebrow}
      </span>
      <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">{title}</h1>
      {description ? <p className="max-w-prose text-base text-fg-secondary">{description}</p> : null}
    </header>
  )
}

/**
 * One reading, in the instrument's typographic rule.
 *
 * The value is set in `--admin-font-mono` with tabular figures; the label and the
 * sub-line stay in the sans face. `KpiTile` states the same rule for a number it
 * can format itself — this is the form for a reading that is not a bare number: a
 * countdown, a date, a fraction.
 */
export function RespondReading({
  label,
  value,
  sub,
}: {
  /** Already-translated. */
  label: string
  /** The reading itself. Set in mono with tabular figures. */
  value: string
  /** Already-translated line under the value. */
  sub?: string
}) {
  return (
    <div className="grid gap-0.5 rounded-lg border border-line-light bg-surface-icon-box p-3">
      <span className="text-2xs font-semibold uppercase tracking-label text-fg-secondary">
        {label}
      </span>
      <span className="font-mono text-xl font-semibold tracking-tight tabular-nums text-fg-primary">
        {value}
      </span>
      {sub ? <span className="text-xs text-fg-secondary">{sub}</span> : null}
    </div>
  )
}
