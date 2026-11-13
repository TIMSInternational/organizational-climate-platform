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
/**
 * ## A picker, and a 44px target, on a phone
 *
 * The chip is 22px and on a phone it is the only control in the respond header — HIG
 * `accessibility.md` › Mobility puts the minimum at 28pt and the default at 44pt, and with
 * `appearance: none` the platform's arrow was gone too, so it read as a static label. Two
 * repairs, both in `index.css` (`.chip-select`), on the `<label>` this module's
 * `CHIP_SELECT_LABEL_CLASS` names:
 *
 * - a small chevron, drawn by the label in the chip's own ink, so the chip reads as a menu;
 * - under `md` or a coarse pointer the `<select>` itself grows to 44px and bleeds 11px above
 *   and below with negative margins, so the row keeps its height while the target doubles,
 *   and the label draws the 22px chip behind it. The `--chip-select-*` properties below are
 *   the switch: the stylesheet sets them on the label for that case, and these fallbacks
 *   are the desktop chip.
 */
export const CHIP_SELECT_LABEL_CLASS = 'chip-select'

export const CHIP_SELECT_STYLE: CSSProperties = {
  // 22px: eleven 2px steps. The chip's height has no token of its own — `ui/chip.tsx`
  // writes it as `h-5.5` on the 4px spacing unit — so it is derived from the spacing
  // scale here rather than typed as a raw length.
  height: 'var(--chip-select-height, calc(var(--admin-space-2) * 11))',
  marginBlock: 'var(--chip-select-bleed, 0)',
  // 18px at the end: the chevron's 8px, inset 6px, plus the chip's gap before it.
  padding: '0 calc(var(--admin-space-8) + var(--admin-space-10)) 0 var(--admin-space-8)',
  borderRadius: 'var(--admin-radius-lg)',
  border: '1px solid var(--chip-select-line, var(--admin-border-default))',
  background: 'var(--chip-select-ground, var(--admin-bg-icon-box))',
  color: 'var(--admin-font-secondary)',
  fontSize: 'var(--admin-text-xs)',
  fontWeight: 'var(--admin-weight-medium)',
  lineHeight: 1,
  appearance: 'none',
  // Sized to the chosen option, not to the widest one: a native `<select>` is as wide as
  // "Sistema" whatever it shows, which drew "Claro" in a chip with a blank tail. Chromium
  // and Safari honour it; elsewhere the chip is simply as wide as it was.
  fieldSizing: 'content',
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
