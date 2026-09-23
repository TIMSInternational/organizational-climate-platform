import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { ClimateMark } from './ClimateMark'

/**
 * The head of the sidebar: the mark, the wordmark, and the collapse control.
 *
 * Ported from the ForMaps rail (`app/dashboard/_components/StudentSidebar.tsx`,
 * the "Logo bar" block) so the two products' rails start the same way. Geometry
 * is theirs verbatim:
 *
 * - the bar is `padding: 14px 10px 10px 12px` expanded, `14px 6px 10px` collapsed
 * - `justify-content: space-between`, so the mark sits left and the toggle right
 * - mark 28x28, `gap: 8` to the wordmark, which is 15px/700 at `-0.01em`
 * - the toggle is a 28x28 borderless square at `--admin-radius-md`, tertiary text,
 *   filling with `--admin-bg-hover` on hover — the same control the rail already had
 * - collapsed, the mark shrinks to 24x24 and centres
 *
 * ## What is not theirs
 *
 * **The mark.** ForMaps ships `/logo-icon.svg`. This product had no logo asset at all
 * until 2026-09-23 — the rail drew the `Waves` glyph the nav uses for Microclimates, in a
 * tinted tile, as a stand-in, and `public/favicon.svg` was the stock Vite lightning bolt.
 * It now draws `ClimateMark`, and the tinted tile went with the placeholder: the mark is
 * itself a square of nine cells, so a box behind it would be a second surface around a
 * shape that already has edges.
 *
 * `tone="shell"` and not the default: `--admin-bg-shell` is navy in the LIGHT theme too
 * (#0c1c3a), so a mark that followed the reader's theme would put its two darkest cells
 * at 1.13:1 and 1.25:1 here and lose a third of itself.
 *
 * **The collapsed toggle sits under the mark, not below the bar.** ForMaps pins it
 * `position: absolute; bottom: -32`, which works because their bar is the only
 * thing that can overflow the aside. Here the rail is a plain column and an
 * absolutely-placed button would land on top of the first nav row.
 *
 * ## Why the wordmark is not translated
 *
 * It is a logotype. `CLIMA|TE` is one word split for the two-tone treatment ForMaps
 * gives `FORM|MAPS`, and a split point is a property of the rendered mark rather
 * than of the language — translating it would either move the seam or produce a
 * word the mark is not. `noHardcodedStrings.test.ts` already carries the same
 * exemption for "Organizational Climate Platform" (the product name, rendered
 * untranslated on the public survey page), and both halves are listed there beside
 * it. The bar's only *copy* — the toggle's label and tooltip — goes through `t()`
 * as everything else does.
 */
const BRAND_LEAD = 'CLIMA'
const BRAND_TAIL = 'TE'

export interface SidebarBrandProps {
  collapsed: boolean
  onToggleCollapsed: () => void
}

export function SidebarBrand({ collapsed, onToggleCollapsed }: SidebarBrandProps) {
  const { t } = useTranslation()
  const toggleLabel = collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')

  const toggle = (
    <button
      type="button"
      onClick={onToggleCollapsed}
      aria-expanded={!collapsed}
      aria-label={toggleLabel}
      title={toggleLabel}
      className="size-control-md justify-center rounded-md border-none bg-transparent p-0 text-fg-tertiary hover:bg-state-hover"
    >
      {collapsed ? (
        <PanelLeftOpen aria-hidden="true" className="size-icon" />
      ) : (
        <PanelLeftClose aria-hidden="true" className="size-icon" />
      )}
    </button>
  )

  if (collapsed) {
    return (
      <div
        data-slot="sidebar-brand"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--admin-space-4)',
          padding: '14px 6px 10px',
        }}
      >
        <Mark size={24} />
        {toggle}
      </div>
    )
  }

  return (
    <div
      data-slot="sidebar-brand"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 10px 10px 12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--admin-space-8)', minWidth: 0 }}>
        <Mark size={28} />
        {/* One `<span>`, two coloured halves — not two words with a space, which is
            what a screen reader would otherwise announce. */}
        <span
          style={{
            fontSize: 15,
            fontWeight: 'var(--admin-weight-bold)',
            letterSpacing: '-0.01em',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: 'var(--admin-brand-lead)' }}>{BRAND_LEAD}</span>
          <span style={{ color: 'var(--admin-brand-tail)' }}>{BRAND_TAIL}</span>
        </span>
      </div>
      {toggle}
    </div>
  )
}

/**
 * The mark, at the rail's two sizes. `ClimateMark` is `aria-hidden` of its own accord:
 * the wordmark beside it names the product, and while collapsed the rail's own
 * `aria-label` does.
 */
function Mark({ size }: { size: number }) {
  return <ClimateMark tone="shell" style={{ width: size, height: size, flexShrink: 0 }} />
}
