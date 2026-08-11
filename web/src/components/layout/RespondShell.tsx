import type { ReactNode } from 'react'
import { LanguageSwitcher } from '../../i18n'
import { SkipLink } from '../ui'
import { ThemeSwitcher } from './ShellControls'

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
 * ## The header carries the product name and nothing else
 *
 * No wordmark lockup, no navigation, no account. Somebody who followed a link out
 * of an email needs to know what site they are on; they need nothing else, and
 * anything else here would be a claim about a tenant.
 */
export interface RespondShellProps {
  /** Already-translated label for the skip link, e.g. "Skip to the survey". */
  skipLabel: string
  /**
   * The id the skip link targets and `<main>` carries. Defaults to `respond`.
   * `/survey/:id` passes `survey`, which is the anchor its own test pins.
   */
  contentId?: string
  children: ReactNode
}

export function RespondShell({ skipLabel, contentId = 'respond', children }: RespondShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-outer">
      {/* First focusable thing on the page, so a keyboard user is not made to Tab
          through the language and theme pickers on the way to the questions. */}
      <SkipLink href={`#${contentId}`}>{skipLabel}</SkipLink>

      {/* Transparent and unruled, like the shell's own top strip: the card below
          is the only panel, and a filled bar here would read as a second surface
          with a seam between them. */}
      <header className="mx-auto flex w-full max-w-content flex-wrap items-center justify-between gap-inline px-gutter py-inline">
        {/* The product name, which `i18n/noHardcodedStrings.test.ts` allows
            explicitly: it is a proper noun and is not translated. */}
        <span className="text-sm font-medium text-fg-secondary">
          Organizational Climate Platform
        </span>
        <span className="flex flex-wrap items-center gap-inline">
          <LanguageSwitcher compact />
          <ThemeSwitcher compact />
        </span>
      </header>

      <main
        id={contentId}
        // `overflow-x-auto` for the same reason `AdminLayout` keeps it: anything
        // wider than the column — a long scale row, a wide word — scrolls inside
        // the page rather than pushing the body sideways on a phone.
        // `flex flex-col` so a child asking for `flex-1` fills the column. Without
        // it a short state — the thank-you card, a closed survey — renders as a
        // stub stranded at the top of a large empty field, which reads as content
        // that failed to load rather than as a page with little on it.
        className="mx-auto flex w-full max-w-content flex-1 flex-col overflow-x-auto px-gutter pb-section"
      >
        {children}
      </main>
    </div>
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
