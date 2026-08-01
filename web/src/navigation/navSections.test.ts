import { describe, it, expect } from 'vitest'
import { buildNavSections } from './navSections'

function hrefs(sections: ReturnType<typeof buildNavSections>): string[] {
  return sections.flatMap((section) => section.items.flatMap((item) => [item.href, ...(item.sub ?? []).map((sub) => sub.href)]))
}

describe('buildNavSections', () => {
  it('gives a super_admin links to Companies and System settings, never a company-scoped URL', () => {
    const links = hrefs(buildNavSections('super_admin', 'company-1'))
    expect(links).toContain('/admin/companies')
    expect(links).toContain('/admin/system-settings')
    expect(links.some((href) => href.includes('company-1'))).toBe(false)
  })

  it('gives a company_admin links scoped to their own company only', () => {
    const links = hrefs(buildNavSections('company_admin', 'company-1'))
    expect(links).toContain('/admin/companies/company-1')
    expect(links).toContain('/admin/companies/company-1/users')
    expect(links).toContain('/admin/companies/company-1/demographic-fields')
    expect(links).not.toContain('/admin/system-settings')
  })

  it('returns no nav for a company_admin with no companyId claim', () => {
    expect(buildNavSections('company_admin', undefined)).toEqual([])
  })

  it.each(['employee', 'supervisor', 'leader', undefined])('returns no nav for %s (no admin page exists for this role yet)', (role) => {
    expect(buildNavSections(role, 'company-1')).toEqual([])
  })
})
