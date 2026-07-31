import { Shield, Building2 } from 'lucide-react'

export interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
  sub?: NavItem[]
}

export interface NavSection {
  title: string
  items: NavItem[]
}

export const navSections: NavSection[] = [
  {
    title: '',
    items: [
      {
        label: 'System Administration',
        href: '/admin/companies',
        icon: Shield,
        sub: [
          { label: 'Companies', href: '/admin/companies', icon: Building2 },
        ],
      },
    ],
  },
]
