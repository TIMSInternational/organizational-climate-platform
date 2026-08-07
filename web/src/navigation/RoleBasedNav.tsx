import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from '../i18n'
import { activeHref, type NavSection, type NavItem as NavItemType } from './navSections'

/**
 * The tree elbow beside a sub-item, ported from the ForMaps sidebar
 * (`StudentSidebar.tsx`) so the two products' rails are the same shape.
 *
 * Geometry is theirs exactly: a 16x28 box, 1px rules seated at `left: 4`, the
 * corner at `top: 14` -- the vertical middle of a 28px row -- and a continuation
 * stub below it for every item except the last, so the run of children reads as
 * one bracket rather than as detached ticks.
 *
 * `isActive` lights the run down to the selected child, which is why the caller
 * passes `subActive || index <= selectedSubIndex` rather than just `subActive`.
 */
function SubItemBreadcrumb({ isLast, isActive }: { isLast: boolean; isActive: boolean }) {
  const lineColor = 'var(--admin-border-default)'
  const activeColor = 'var(--admin-font-tertiary)'
  return (
    <div aria-hidden="true" style={{ position: 'relative', width: 16, height: 28, flexShrink: 0, marginLeft: 8 }}>
      <div style={{ position: 'absolute', left: 4, top: 0, width: 1, height: 14, background: isActive ? activeColor : lineColor }} />
      <div style={{ position: 'absolute', left: 4, top: 14, width: 8, height: 1, background: isActive ? activeColor : lineColor, borderBottomLeftRadius: 2 }} />
      {!isLast && <div style={{ position: 'absolute', left: 4, top: 14, width: 1, height: 14, background: lineColor }} />}
    </div>
  )
}

export interface RoleBasedNavProps {
  sections: NavSection[]
  /**
   * Icon-only rail. Sub-items are unreachable while collapsed (there is no room
   * to draw the elbow, and a flyout would be a second navigation surface), so a
   * grouped row navigates to its own `href` instead of toggling — which for both
   * roles is the same page as its first child, so nothing becomes unreachable.
   */
  collapsed?: boolean
  /** Called after any row is followed. The mobile drawer closes itself on it. */
  onNavigate?: () => void
}

export default function RoleBasedNav({ sections, collapsed = false, onNavigate }: RoleBasedNavProps) {
  const { t } = useTranslation()
  const location = useLocation()
  const pathname = location.pathname
  // Resolved once for the whole rail: which single row wins the current path.
  const selectedHref = activeHref(pathname, sections)
  const [expanded, setExpanded] = useState<string[]>(() => {
    const initiallyExpanded: string[] = []
    for (const section of sections) {
      for (const item of section.items) {
        if (item.sub?.some((sub) => sub.href === selectedHref)) {
          initiallyExpanded.push(item.labelKey)
        }
      }
    }
    return initiallyExpanded
  })

  function toggleExpand(labelKey: string) {
    setExpanded((current) =>
      current.includes(labelKey) ? current.filter((key) => key !== labelKey) : [...current, labelKey],
    )
  }

  function renderItem(item: NavItemType) {
    const isActive = item.href === selectedHref
    // While collapsed a grouped row is a plain link (see `collapsed` above), so
    // it gets a leaf's selected styling too.
    const hasSub = Boolean(item.sub?.length) && !collapsed
    // How far down the run of children the elbow should read as "active". ForMaps
    // lights every rung above the selected one, so the bracket leads the eye to it.
    const selectedSubIndex = item.sub ? item.sub.findIndex((sub) => sub.href === selectedHref) : -1
    const isExpanded = expanded.includes(item.labelKey)
    const label = t(item.labelKey)

    // Ported from the legacy navigation/RoleBasedNav.tsx row: `minHeight: 28,
    // padding: '4px 8px', fontSize: 13, gap-2, rounded-[4px]`, and the same
    // three-way selected state — a selected leaf is white on the blue accent, a
    // selected parent stays on the panel and goes bold, everything else is
    // secondary text.
    const rowStyle = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: collapsed ? 'center' : 'flex-start',
      gap: collapsed ? '0' : 'var(--admin-size-inline-gap)',
      flex: 1,
      width: '100%',
      minWidth: 0,
      minHeight: 'var(--admin-size-control-md)',
      height: 'auto',
      padding: collapsed ? 'var(--admin-space-4)' : `var(--admin-space-4) var(--admin-space-8)`,
      border: 'none',
      borderRadius: 'var(--admin-radius-md)',
      fontFamily: 'inherit',
      fontSize: 'var(--admin-text-base)',
      fontWeight: isActive && hasSub ? 'var(--admin-weight-bold)' : 'var(--admin-weight-medium)',
      textAlign: 'left' as const,
      textDecoration: 'none',
      background: isActive && !hasSub ? 'var(--admin-accent-blue)' : 'transparent',
      color:
        isActive && !hasSub
          ? 'var(--admin-font-on-accent)'
          : isActive
            ? 'var(--admin-font-primary)'
            : 'var(--admin-font-secondary)',
    }

    const rowContent = (
      <>
        <item.icon className="nav-icon" />
        {!collapsed && (
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
          </span>
        )}
        {!collapsed && item.badge && <span className="nav-badge">{item.badge}</span>}
      </>
    )

    return (
      <div key={item.labelKey}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--admin-size-row-gap)' }}>
          {hasSub ? (
            // A grouped row is a disclosure, not a destination. The legacy version
            // rendered it as an `<a>` with `preventDefault()` plus a bare `<svg>`
            // carrying the click — so it announced as a link that goes nowhere, and
            // the chevron was unreachable by keyboard entirely. A `<button>` with
            // `aria-expanded` is the same interaction, correctly named.
            <button
              type="button"
              onClick={() => toggleExpand(item.labelKey)}
              aria-expanded={isExpanded}
              // See the `title` note on the leaf row below: 240px is not enough
              // for "Company Administration", let alone
              // "Administración de Empresa".
              title={label}
              style={rowStyle}
            >
              {rowContent}
              <ChevronRight
                aria-hidden="true"
                style={{
                  width: 'var(--admin-size-icon)',
                  height: 'var(--admin-size-icon)',
                  flexShrink: 0,
                  color: 'var(--admin-font-tertiary)',
                  transform: isExpanded ? 'rotate(90deg)' : 'none',
                  transition: 'transform var(--admin-duration-base) var(--admin-ease-out)',
                }}
              />
            </button>
          ) : (
            <Link
              to={item.href}
              onClick={onNavigate}
              // A collapsed row shows no text, so the accessible name has to come
              // from somewhere.
              aria-label={collapsed ? label : undefined}
              // `title` unconditionally, not only while collapsed. Measured in
              // Chrome: the label box in a 240px rail is 151px, and "Company
              // Administration" at 13px semibold is ~186px — so the row truncates
              // with an ellipsis even in English, and worse in Spanish
              // ("Administración de Empresa", 182px, at a smaller weight). The
              // tooltip is what makes the hidden text recoverable; widening the
              // rail means changing `--admin-size-sidebar`, which is shared token
              // surface (#208 is queued on tokens.css).
              title={label}
              style={rowStyle}
            >
              {rowContent}
            </Link>
          )}
        </div>
        {hasSub && isExpanded && (
          // Ported from ForMaps `StudentSidebar.tsx`: elbow, then the child's own
          // icon in a 16px box, then the label. 28px rows, 13px/500 text, and the
          // active child filled with the accent -- the same treatment the parent
          // rows get, so a selected child does not look like a different control.
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 2 }}>
            {item.sub!.map((sub, index) => {
              const subActive = sub.href === selectedHref
              const isLast = index === item.sub!.length - 1
              const SubIcon = sub.icon
              return (
                <Link
                  key={sub.labelKey}
                  to={sub.href}
                  onClick={onNavigate}
                  title={t(sub.labelKey)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    height: 28,
                    padding: '0 4px 0 0',
                    borderRadius: 4,
                    fontSize: 13,
                    fontWeight: 500,
                    textDecoration: 'none',
                    transition: 'background var(--admin-duration-fast) var(--admin-ease-out)',
                    color: subActive ? 'var(--admin-font-on-accent)' : 'var(--admin-font-secondary)',
                    background: subActive ? 'var(--admin-accent-blue)' : 'transparent',
                  }}
                >
                  <SubItemBreadcrumb isLast={isLast} isActive={subActive || index <= selectedSubIndex} />
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, flexShrink: 0 }}>
                    {SubIcon ? (
                      <SubIcon
                        aria-hidden="true"
                        style={{ width: 14, height: 14, color: subActive ? 'var(--admin-font-on-accent)' : 'var(--admin-font-tertiary)' }}
                      />
                    ) : null}
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t(sub.labelKey)}
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <nav
      aria-label={t('shell.mainNavigation')}
      // ForMaps `StudentSidebar` nav padding, verbatim: the rail's own gutter
      // rather than the shell's, so the rows sit where theirs do.
      style={{ flex: 1, overflowY: 'auto', padding: collapsed ? '4px 6px 8px 6px' : '4px 8px 8px 8px' }}
    >
      {sections.map((section, index) => (
        <div key={section.titleKey || index} style={{ marginBottom: 8 }}>
          {section.titleKey && !collapsed && (
            <div className="nav-section-title">{t(section.titleKey)}</div>
          )}
          {section.items.map(renderItem)}
        </div>
      ))}
    </nav>
  )
}
