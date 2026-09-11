import type { CSSProperties } from 'react'

/**
 * The canvas's `.chip`, for a native `<select>`.
 *
 * The respond strip draws its two pickers — "Español" beside "Claro" — as the 22px chip
 * every artboard of 10 Sep uses (RespondSurveyPhone, RespondConfirmationPhone,
 * RespondMicroclimatePhone): 8px in, 6px corners, the recessed surface with a hairline,
 * 11px medium secondary ink. That is `ui/chipVariants.ts`'s neutral tone, drawn here as
 * an inline style because both pickers style their `<select>` inline and read the same
 * `--admin-*` tokens a utility would.
 *
 * Still a `<select>`: the keyboard and screen-reader behaviour `LanguageSwitcher` and
 * `ThemeSwitcher` were written for is kept whole. `appearance: none` takes the
 * platform's arrow off so the box is the chip and nothing else; the options list still
 * opens exactly as it did.
 *
 * One module for both pickers so they cannot drift a pixel apart in the one row where
 * they sit side by side.
 */
export const CHIP_SELECT_STYLE: CSSProperties = {
  // 22px: eleven 2px steps. The chip's height has no token of its own — `ui/chip.tsx`
  // writes it as `h-5.5` on the 4px spacing unit — so it is derived from the spacing
  // scale here rather than typed as a raw length.
  height: 'calc(var(--admin-space-2) * 11)',
  padding: '0 var(--admin-space-8)',
  borderRadius: 'var(--admin-radius-lg)',
  border: '1px solid var(--admin-border-default)',
  background: 'var(--admin-bg-icon-box)',
  color: 'var(--admin-font-secondary)',
  fontSize: 'var(--admin-text-xs)',
  fontWeight: 'var(--admin-weight-medium)',
  lineHeight: 1,
  appearance: 'none',
  cursor: 'pointer',
}

/**
 * The `<label>` around a chip select. `index.css` gives every `<label>` a 12px bottom
 * margin for the form-row case; beside another chip in a centred row that margin lifted
 * the first chip 6px above its neighbour, which is visible on the respond strip of every
 * rehearsal screenshot taken before this existed.
 */
export const CHIP_SELECT_LABEL_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  marginBottom: 0,
}
