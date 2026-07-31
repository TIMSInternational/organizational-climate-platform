import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import type { NavSection, NavItem as NavItemType } from './navSections'

function SubItemBreadcrumb({ isLast, isActive }: { isLast: boolean; isActive: boolean }) {
  const lineColor = 'var(--admin-border-default)'
  const activeColor = 'var(--admin-font-tertiary)'
  return (
    <div style={{ position: 'relative', width: 16, height: 28, flexShrink: 0, marginLeft: 8 }}>
      <div style={{ position: 'absolute', left: 4, top: 0, width: 1, height: 14, background: isActive ? activeColor : lineColor }} />
      <div style={{ position: 'absolute', left: 4, top: 14, width: 8, height: 1, background: isActive ? activeColor : lineColor, borderBottomLeftRadius: 2 }} />
      {!isLast && <div style={{ position: 'absolute', left: 4, top: 14, width: 1, height: 14, background: lineColor }} />}
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
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Link
            to={item.href}
            onClick={hasSub ? (e) => { e.preventDefault(); toggleExpand(item.label) } : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, textDecoration: 'none', color: isActive ? 'var(--admin-font-primary)' : 'var(--admin-font-secondary)' }}
          >
            <item.icon className="nav-icon" />
            <span>{item.label}</span>
            {item.badge && <span className="nav-badge">{item.badge}</span>}
          </Link>
          {hasSub && (
            <ChevronRight
              onClick={() => toggleExpand(item.label)}
              style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', cursor: 'pointer' }}
            />
          )}
        </div>
        {hasSub && isExpanded && (
          <div>
            {item.sub!.map((sub, index) => (
              <div key={sub.label} style={{ display: 'flex', alignItems: 'center' }}>
                <SubItemBreadcrumb isLast={index === item.sub!.length - 1} isActive={matchesRoute(pathname, sub.href)} />
                <Link to={sub.href} style={{ color: matchesRoute(pathname, sub.href) ? 'var(--admin-font-primary)' : 'var(--admin-font-secondary)', textDecoration: 'none' }}>
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
        <div key={section.title || index}>
          {section.title && <div className="nav-section-title">{section.title}</div>}
          {section.items.map(renderItem)}
        </div>
      ))}
    </nav>
  )
}
