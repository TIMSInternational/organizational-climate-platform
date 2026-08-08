import { PanelLeftClose, PanelLeftOpen, Waves } from 'lucide-react'
import { useTranslation } from '../../i18n'

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
 * **The mark.** ForMaps ships `/logo-icon.svg`; this product has no logo asset at
 * all (`public/favicon.svg` is still the stock Vite lightning bolt). Rather than
 * invent one, the mark is the `Waves` glyph the nav already uses for
 * Microclimates, set in a 28px tinted tile at `borderRadius: 7` — the same tile
 * and the same radius as the avatar in `SidebarUserMenu`, so the rail opens and
 * closes on the same shape.
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
          <span style={{ color: 'var(--admin-font-primary)' }}>{BRAND_LEAD}</span>
          <span style={{ color: 'var(--admin-accent-blue)' }}>{BRAND_TAIL}</span>
        </span>
      </div>
      {toggle}
    </div>
  )
}

/**
 * The mark. `aria-hidden` because the wordmark beside it already names the
 * product, and while collapsed the rail's own `aria-label` does — an announced
 * "Waves" would be noise either way.
 */
function Mark({ size }: { size: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
        // 7px, matching the avatar tile in `SidebarUserMenu` — ForMaps' own
        // `borderRadius: 7`, which is between `--admin-radius-lg` (6) and
        // `--admin-radius-xl` (8) and so has no token of its own.
        borderRadius: 7,
        background: 'var(--admin-accent-bg-blue)',
        color: 'var(--admin-accent-blue)',
      }}
    >
      <Waves style={{ width: Math.round(size * 0.6), height: Math.round(size * 0.6) }} />
    </span>
  )
}
