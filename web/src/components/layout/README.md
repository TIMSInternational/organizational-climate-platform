# layout/ — the app shell (#80)

Ported from `climate-project/src/components/layout/`: `AppShell`, `Navbar`,
`MobileNav`, `PageTopBar`, `DashboardGrid`, `DashboardLayout`, `Sidebar`.

The shell itself is `src/app/AdminLayout.tsx`, a router layout route. This folder holds
the parts of it that are reusable by a page.

```tsx
import { PageTopBar, DashboardGrid, GridItem, KPIGrid } from '../../components/layout'
```

## Where each legacy component went

| legacy | here | why |
|---|---|---|
| `AppShell` | **absorbed into `AdminLayout`** | `AdminLayout` already was the shell. A fourth wrapper is the duplicate implementation #80's acceptance criteria rules out. |
| `DashboardLayout` | **not ported** | Its body was an auth gate (`useAuth` → spinner → "please sign in"), which `app/RequireAuth.tsx` already does, plus an `AdminThemeProvider` that `theme/adminTheme.ts` replaced with `initAdminTheme()` in `main.tsx`. |
| `Sidebar` | **absorbed into `AdminLayout`** + `RoleBasedNav` | The rail is 12 lines of layout around `RoleBasedNav`; the user/theme/logout block became `ShellControls`. No logo: this repo ships no `tims.png`. |
| `Navbar` | **`PageTopBar`** | See the naming note below. |
| `PageTopBar` | **not ported** | Its whole body was `<NotificationDropdown />`, which has no data source until #99. |
| `MobileNav` | `MobileNav` | Rebuilt on `Sheet`; see below. |
| `DashboardGrid` | `DashboardGrid` | Minus framer-motion. |

## The naming conflict, stated rather than resolved silently

#80 asks for "`PageTopBar` (page title, breadcrumb slot, action slot)" and to "adopt
it in existing pages". The legacy `PageTopBar` has **none of those** — it is 19 lines
rendering a right-aligned notification bell. The component with the title,
breadcrumbs, description, badge and actions is the legacy **`Navbar.tsx`**, which
despite its name is a page header, not a navigation bar.

So `PageTopBar` here is a port of `Navbar.tsx` under the issue's name. That is what
the issue *describes*, and the only reading under which "adopt it in existing pages"
means anything. The legacy `PageTopBar`'s notification bell is deliberately absent.

`Navbar.tsx`'s four presets (`SurveyNavbar`, `MicroclimateNavbar`, `ActionPlanNavbar`)
are not ported: each hardcodes an English title, description and a breadcrumb trail
pointing at a `/dashboard` route this app does not have yet. A page passes its own
props.

## MobileNav

Below `md` the sidebar is `hidden` and this takes over: a bottom tab bar of up to four
**leaf** destinations plus a "More" drawer holding the full role-aware nav.

- The drawer is a **`Sheet` (Radix Dialog)**. The legacy drawer was a bare
  `position: fixed` div with no focus trap, no Escape and no focus return — opening it
  left keyboard focus on the page behind, and Tab walked out into content the overlay
  had covered. Verified in Chrome: focus now stays inside over 25 tabs and returns to
  the trigger on Escape.
- It closes on navigation (`useLocation`), which Radix cannot know to do.
- A grouped nav item is a *toggle*, not a destination, so `leafNavItems()` replaces it
  with its children rather than letting it occupy a slot.

### Two measured constraints worth knowing before you extend it

- **Tab labels truncate on a small phone.** Five slots at 320px is 56px each; at 10px
  type that is ~9 characters, so "Company Settings" renders as "Configur…" in Spanish.
  Inherent to the legacy four-slot design, not a bug introduced here. If it matters,
  the fix is a `shortLabelKey` in `navSections.ts`, which is a copy decision.
- **The bar's slot order is `navSections.ts`'s order, flattened.** A group's three
  children take slots before the top-level rows after it, so today a configuration
  page (Demographic fields) is on the bar while a primary destination (Microclimates)
  is only in the drawer. Recorded in `MobileNav.test.tsx` rather than "fixed", because
  ranking the bar means stating a hierarchy `navSections.ts` does not currently hold.

## DashboardGrid

`DashboardGrid` / `GridItem` / `KPIGrid` / `ChartGrid` / `DetailGrid`, for #132 and
#133. Always one column on a phone.

The responsive class tables live in `./gridClasses.ts`, not inline — the reason is
written at the top of that file, and it is a real trap: `` `grid-cols-${n}` `` compiles
to nothing, and a table of class strings is invisible to
`styles/utilityExistence.test.ts`'s sweep. The module exists so the guard can import
and check them.

## QueryProvider — the explicit decision #80 asks for

**Not ported.** The app keeps `useEffect` fetching for now.

Reasons, in order of weight:

1. **It is not a shell concern.** A server-state cache changes how all thirteen Batch 3
   page issues are written and how the ten existing pages fetch. Landing it inside the
   shell PR makes it un-reviewable and couples two unrelated changes.
2. **It is a dependency decision.** `@tanstack/react-query` is a new runtime dependency
   in a repo that pins `recharts` exactly and holds `npm audit` at 0 at every severity.
   That is a call to make deliberately, with the pin and the audit checked.
3. **The pain it solves is not yet felt.** The concrete cost of `useEffect` fetching
   here is visible and small: ten pages each carry a `reload()` and a
   `loading`/`error` pair, and all ten sit on the `react-hooks(exhaustive-deps)`
   warnings that make up **9 of the lint budget's 10**. That is a genuine argument
   *for* adopting it — but it is an argument for its own issue, where the exhaustive-deps
   warnings can be retired as part of the change rather than left at zero headroom.

If it is adopted, it belongs in `main.tsx` beside `TranslationProvider`, and the
migration should be page-by-page with the feature-folder `api/` modules unchanged —
they are already plain `async` functions, which is exactly the shape a query function
wants.

`SessionProvider` is NextAuth-specific and is not ported, per the issue: this app uses
JWT-in-header via `src/auth/`.

## What rendering it in Chrome found that the test suite could not

happy-dom computes no layout, no colours and no overflow, so none of the following was
visible to the 759-test suite. All were measured at 320/390/768/1024/1440px, in both
themes and both languages.

1. **Four WCAG AA contrast failures, all light-mode-only.** `--admin-font-tertiary`
   #818181 on the panel is **3.90:1** at 13px (page description); the global
   `a { color: --admin-accent-blue }` #2E9098 is **3.78:1** at 12px (breadcrumb links)
   and at 10px (active tab label). All four now clear 4.5:1. The dark palette passed
   every one of them (4.60–4.75:1), which is precisely how a light-only failure
   survives review. The icons keep the accent hue legitimately — a graphic is held to
   1.4.11's 3:1, which #2E9098 clears.
2. **Tables rendered up to 150px outside the content panel** at 320–390px on Users,
   Companies, Action Plans and Demographic fields. Cause: `index.css` gives every
   `table` `width: 100%` and every `th` `white-space: nowrap`, so min-content exceeds
   the panel. Fixed by `overflow-x-auto` on the panel, which scopes the scroll inside
   the card. Same root cause as the #79 HeatMap defect.
3. **The drawer's close button sat on the first nav row's disclosure chevron** at
   390px. Fixed with `pt-10` on the drawer, rather than moving the button, which is
   shared #76 surface.
4. **Sidebar rows truncate at 240px even in English** — the label box is 151px and
   "Company Administration" is ~186px. Every row now carries a `title`, since widening
   the rail means changing `--admin-size-sidebar` in the shared `styles/tokens.css`.
5. **One Spanish word overflowed the description box** at 320px
   ("Retroalimentación", 120px in a 110px box). Fixed with `break-words`.

Verified clean afterwards across all 180 render combinations: no document-level
horizontal scroll, no console errors or warnings, `PageTopBar` present on all nine
pages, the skip link is the first tab stop and becomes visible on focus, and the hidden
mobile bar contributes **zero** tab stops on desktop.
