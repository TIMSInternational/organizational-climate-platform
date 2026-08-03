import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
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

export default function RoleBasedNav({ sections }: { sections: NavSection[] }) {
  const location = useLocation()
  const pathname = location.pathname
  const [expanded, setExpanded] = useState<string[]>(() => {
    const initiallyExpanded: string[] = []
    for (const section of sections) {
      for (const item of section.items) {
        if (item.sub?.some((sub) => matchesRoute(pathname, sub.href))) {
          initiallyExpanded.push(item.label)
        }
      }
    }
    return initiallyExpanded
  })

  function toggleExpand(label: string) {
    setExpanded((current) => (current.includes(label) ? current.filter((l) => l !== label) : [...current, label]))
  }

  function renderItem(item: NavItemType) {
    const isActive = matchesRoute(pathname, item.href)
    const hasSub = Boolean(item.sub?.length)
    const isExpanded = expanded.includes(item.label)

    return (
      <div key={item.label}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--admin-size-row-gap)' }}>
          <Link
            to={item.href}
            onClick={hasSub ? (e) => { e.preventDefault(); toggleExpand(item.label) } : undefined}
            // Ported from the legacy navigation/RoleBasedNav.tsx row:
            // `minHeight: 28, padding: '4px 8px', fontSize: 13, gap-2,
            // rounded-[4px]`, and the same three-way selected state — a selected
            // leaf is white on the blue accent, a selected parent stays on the
            // panel and goes bold, everything else is secondary text.
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--admin-size-inline-gap)',
              flex: 1,
              minWidth: 0,
              minHeight: 'var(--admin-size-control-md)',
              padding: `var(--admin-space-4) var(--admin-space-8)`,
              borderRadius: 'var(--admin-radius-md)',
              fontSize: 'var(--admin-text-base)',
              fontWeight:
                isActive && hasSub ? 'var(--admin-weight-bold)' : 'var(--admin-weight-medium)',
              textDecoration: 'none',
              background: isActive && !hasSub ? 'var(--admin-accent-blue)' : 'transparent',
              color:
                isActive && !hasSub
                  ? 'var(--admin-font-on-accent)'
                  : isActive
                    ? 'var(--admin-font-primary)'
                    : 'var(--admin-font-secondary)',
            }}
          >
            <item.icon className="nav-icon" />
            <span>{item.label}</span>
            {item.badge && <span className="nav-badge">{item.badge}</span>}
          </Link>
          {hasSub && (
            <ChevronRight
              onClick={() => toggleExpand(item.label)}
              style={{
                width: 'var(--admin-size-icon)',
                height: 'var(--admin-size-icon)',
                flexShrink: 0,
                color: 'var(--admin-font-tertiary)',
                transform: isExpanded ? 'rotate(90deg)' : 'none',
                transition: 'transform var(--admin-duration-base) var(--admin-ease-out)',
                cursor: 'pointer',
              }}
            />
          )}
        </div>
        {hasSub && isExpanded && (
          <div>
            {item.sub!.map((sub, index) => (
              <div key={sub.label} style={{ display: 'flex', alignItems: 'center' }}>
                <SubItemBreadcrumb isLast={index === item.sub!.length - 1} isActive={matchesRoute(pathname, sub.href)} />
                <Link
                  to={sub.href}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: `var(--admin-space-4) var(--admin-space-8)`,
                    borderRadius: 'var(--admin-radius-md)',
                    fontSize: 'var(--admin-text-sm)',
                    textDecoration: 'none',
                    color: matchesRoute(pathname, sub.href)
                      ? 'var(--admin-font-primary)'
                      : 'var(--admin-font-secondary)',
                  }}
                >
                  {sub.label}
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <nav>
      {sections.map((section, index) => (
        <div key={section.title || index} style={{ marginBottom: 'var(--admin-size-panel-gap)' }}>
          {section.title && <div className="nav-section-title">{section.title}</div>}
          {section.items.map(renderItem)}
        </div>
      ))}
    </nav>
  )
}
