/**
 * Whether the shell's header company switcher stands down on this route, because the page
 * itself already names the company it reads — the per-role canvas draws no header switcher
 * on these screens:
 *
 * - `/admin/companies` — the tenant list; "Abrir" is how a tenant is chosen there;
 * - `/admin/companies/:id` and every page under it — the URL names the tenant and the
 *   breadcrumb prints it (Analítica also carries its own context strip). A header reading
 *   "Ninguna empresa seleccionada" above a page about Grupo Meridiano contradicted it;
 * - `/dashboard` with no company selected — Panel de la plataforma carries the canvas's
 *   "Contexto de empresa" strip, which IS the switcher there. Once a company is chosen the
 *   dashboard is that company's Panel de Control and the header switcher comes back, so the
 *   operator can always return to the platform.
 *
 * Every other route keeps the header switcher exactly as before. The switcher renders only
 * for a super administrator in the first place (`CompanyContextSwitcher`), so this is the
 * super administrator's rule and changes nothing for any other role.
 */
export function headerSwitcherStandsDown(pathname: string, selectedCompanyId: string | null): boolean {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/admin/companies' || path.startsWith('/admin/companies/')) return true
  return path === '/dashboard' && !selectedCompanyId
}
