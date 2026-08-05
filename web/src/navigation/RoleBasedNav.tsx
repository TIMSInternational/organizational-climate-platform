import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from '../i18n'
import type { NavSection, NavItem as NavItemType } from './navSections'

function SubItemBreadcrumb({ isLast, isActive }: { isLast: boolean; isActive: boolean }) {
  const lineColor = 'var(--admin-border-default)'
  const activeColor = 'var(--admin-font-tertiary)'
  const midline = 'calc(var(--admin-size-control-md) / 2)'
  return (
    // The elbow is drawn on the nav row's own geometry: the box is one icon wide
    // and one control tall, and the corner sits at half a control height — the
    // vertical centre of the row — so the elbow keeps meeting the label mid-line
    // if the control height ever changes.
    <div
      aria-hidden="true"
      style={{
        position: 'relative',
        width: 'var(--admin-size-icon)',
        height: 'var(--admin-size-control-md)',
        flexShrink: 0,
        marginLeft: 'var(--admin-size-inline-gap)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 'var(--admin-space-4)',
          top: 0,
          width: 'var(--admin-space-1)',
          height: midline,
          background: isActive ? activeColor : lineColor,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 'var(--admin-space-4)',
          top: midline,
          width: 'var(--admin-space-8)',
          height: 'var(--admin-space-1)',
          background: isActive ? activeColor : lineColor,
          borderBottomLeftRadius: 'var(--admin-radius-sm)',
        }}
      />
      {!isLast && (
        <div
          style={{
            position: 'absolute',
            left: 'var(--admin-space-4)',
            top: midline,
            width: 'var(--admin-space-1)',
            height: midline,
            background: lineColor,
          }}
        />
      )}
    </div>
  )
}

function matchesRoute(pathname: string, href: string) {
  if (href === '/dashboard') {
    return pathname === '/dashboard' || pathname === '/'
  }
  return pathname.startsWith(href)
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
  const [expanded, setExpanded] = useState<string[]>(() => {
    const initiallyExpanded: string[] = []
    for (const section of sections) {
      for (const item of section.items) {
        if (item.sub?.some((sub) => matchesRoute(pathname, sub.href))) {
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
    const isActive = matchesRoute(pathname, item.href)
    // While collapsed a grouped row is a plain link (see `collapsed` above), so
    // it gets a leaf's selected styling too.
    const hasSub = Boolean(item.sub?.length) && !collapsed
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
          <div>
            {item.sub!.map((sub, index) => (
              <div key={sub.labelKey} style={{ display: 'flex', alignItems: 'center' }}>
                <SubItemBreadcrumb isLast={index === item.sub!.length - 1} isActive={matchesRoute(pathname, sub.href)} />
                <Link
                  to={sub.href}
                  onClick={onNavigate}
                  title={t(sub.labelKey)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: `var(--admin-space-4) var(--admin-space-8)`,
                    borderRadius: 'var(--admin-radius-md)',
                    fontSize: 'var(--admin-text-sm)',
                    textDecoration: 'none',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: matchesRoute(pathname, sub.href)
                      ? 'var(--admin-font-primary)'
                      : 'var(--admin-font-secondary)',
                  }}
                >
                  {t(sub.labelKey)}
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <nav aria-label={t('shell.mainNavigation')}>
      {sections.map((section, index) => (
        <div key={section.titleKey || index} style={{ marginBottom: 'var(--admin-size-panel-gap)' }}>
          {section.titleKey && !collapsed && (
            <div className="nav-section-title">{t(section.titleKey)}</div>
          )}
          {section.items.map(renderItem)}
        </div>
      ))}
    </nav>
  )
}
