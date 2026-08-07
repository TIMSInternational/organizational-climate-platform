/**
 * The app shell (#80).
 *
 * There is deliberately **no `AppShell` component**. The legacy shell was
 * `AppShell` + `DashboardLayout` + `Sidebar` wrapping each other, and this app
 * already had `app/AdminLayout.tsx` doing that job as a router layout route. A
 * fourth wrapper would have been the duplicate shell implementation #80's
 * acceptance criteria rules out, so `AdminLayout` absorbed the parts of `AppShell`
 * that were not already there (the scroll container, the responsive sidebar, the
 * mobile overlay) and the pieces that are genuinely reusable live here.
 *
 * `DashboardLayout` is not ported either: its whole body was an auth gate
 * (`useAuth` → loading spinner → "please sign in") which `app/RequireAuth.tsx`
 * already does, plus an `AdminThemeProvider` that `theme/adminTheme.ts` replaced
 * with a module-level `initAdminTheme()` call in `main.tsx`.
 */

export { PageTopBar, type PageTopBarProps, type PageBreadcrumb } from './PageTopBar'
export { MobileNav, type MobileNavProps } from './MobileNav'
export {
  DashboardGrid,
  GridItem,
  KPIGrid,
  ChartGrid,
  DetailGrid,
  type DashboardGridProps,
  type GridItemProps,
  type GridColumns,
  type GridGap,
} from './DashboardGrid'
export { ShellControls, ThemeSwitcher, type ShellControlsProps } from './ShellControls'
export { CompanyContextSwitcher } from './CompanyContextSwitcher'
export {
  CommandPalette,
  SearchTrigger,
  OPEN_COMMAND_PALETTE_EVENT,
  type CommandPaletteProps,
} from './CommandPalette'
export { QuickActions, type QuickAction, type QuickActionsProps } from './QuickActions'
export {
  JourneyTimeline,
  type JourneyStep,
  type JourneyStatus,
  type JourneyTimelineProps,
} from './JourneyTimeline'
export { SidebarBrand, type SidebarBrandProps } from './SidebarBrand'
export { SidebarUserMenu } from './SidebarUserMenu'
