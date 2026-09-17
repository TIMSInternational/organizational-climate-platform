# Dashboard customization — widgets, layouts, themes, preferences (#133)

**Status: legacy behaviour ESTABLISHED from the code; usage cannot be established because
no legacy data exists. RECOMMENDED: drop widgets and themes outright, drop saved layouts,
keep the one preference the product already stores. Awaiting Federico's sign-off.**
Written 2026-09-07 against `main` at `42a60436`, from the legacy repository
`TIMSInternational/climate-project` at `main` = `ab3266c` (last updated 2026-08-01), cloned and grepped whole rather than sampled.

#133's first criterion is *"Usage established, keep/drop decision recorded"* and its own
scope says *"recommend dropping if unused"*. Usage was a question for production data that
no longer exists (`no-data-migration.md`). What the code can still answer is which of the
four routes could have been used at all, and by what — and that turns out to settle it.

## What the legacy customization actually was

Four Next.js routes over four raw Mongo collections, one component (rendered once, in
`CompanyAdminDashboard.tsx:528`) and one hook:

| Route | Collection | Reachable from the UI? |
|---|---|---|
| `api/dashboard/layouts` | `dashboard_layouts` | **Yes** — `DashboardCustomization.tsx` GETs it on mount (`:156-166`) and POSTs on save (`:226-234`); `useDashboardPreferences.ts` GETs/POSTs/DELETEs it (`:99`, `:170`, `:217`) |
| `api/dashboard/preferences` | `dashboard_preferences` | **Yes** — `useDashboardPreferences.ts` GET (`:80`), PUT (`:122`), POST-to-reset (`:147-151`) |
| `api/dashboard/widgets` | `dashboard_configurations` | **No.** No `fetch` of it anywhere in the legacy tree outside the route itself (`grep -rn api/dashboard/widgets src` at `ab3266c`); `DashboardCustomization` takes `availableWidgets` as a prop (`:101`) |
| `api/dashboard/themes` | `dashboard_themes` | **No.** No caller anywhere in the tree; the component's Theme tab reads a local `THEMES` constant (`DashboardCustomization.tsx:117-131`) |

The triage of 2026-08-02 found the same split (keep 2, drop 2) from the call sites alone;
the full-parity reversal restored all four and noted widgets/themes "have no working
reference implementation to port from". Reading the two live routes closely says the
reachable half was not working either:

1. **Layouts could be created and listed, never updated or deleted.** `PUT` and `DELETE`
   query `{ _id: layout_id }` with the raw string (`layouts/route.ts:242, :266, :322, :340`),
   while `insertOne` mints an `ObjectId`, so the match never succeeds. The hook also
   sends `?id=` where the route reads `layout_id` (`useDashboardPreferences.ts:217` vs
   `layouts/route.ts:309`), so delete answered 400 before it could fail to match.
2. **Saving a layout stored the wrong thing and half the time refused.** The component
   keeps the response envelope `{ success, layout }` as if it were a layout (`:237-239`),
   and posts `layout_type: 'list'`, which the route's schema rejects
   (`layouts/route.ts:11` allows `grid | masonry | flex | custom`).
3. **A new user's first preference change failed.** `PUT /preferences` has no upsert and
   returns 404 `'Preferences not found'` (`preferences/route.ts:187-200`); the document
   only exists after a `POST`, which only the reset button sends.
4. **Theme identity lived in three places with three vocabularies**:
   `dashboard_preferences.theme` (default `'default'`), `dashboard_themes` built-ins
   (`default | dark | corporate`, `themes/route.ts:365-491`) and the component's own
   `THEMES` (`default | dark | light | colorful`). Nothing reconciled them.
5. **No role gating in the component**: `userRole` and `useAuth().user` are read and
   never used (`DashboardCustomization.tsx:134, :139`).

So the feature that could be reached was: save a layout that came back malformed, load it,
and edit preferences after a reset. That is the strongest statement about usage the code
can make, and it is not one that argues for a port.

## What the product already has

- **One preferences store, shared with the profile** — #133's fourth criterion — exists.
  `User.Preferences` carries `Language`, `Timezone`, `Theme` and `DashboardLayout`
  (`src/ClimateProject.Domain/Entities/User.cs:67-73`), read and written through
  `GET/PUT /profile/preferences` (`ProfileEndpoints.cs:85-86`), and the profile page's
  theme picker saves through it (`web/src/features/profile/api/profile.test.ts:160-183`).
  There is nowhere else a dashboard preference should live.
- **Themes go through the token layer** — the third criterion — by construction: the web
  has one theme mechanism (`web/src/theme/adminTheme.ts`, `data-theme` on the root), every
  screen is screenshot in both themes, and a stored `Theme` selects one of them. A
  per-tenant custom colour theme (`dashboard_themes` carried 11 colours, 7 typography and
  3 spacing values per row) would bypass exactly the token layer #74 built, which #133's
  own scope forbids.
- **`DashboardGrid` (#80) is ported** (`web/src/components/layout/DashboardGrid.tsx`), so
  the layout primitive the second criterion names exists. What does not exist is any
  screen that lets a user rearrange it — and nothing in the legacy did that either: the
  legacy grid took `widget_positions` from a saved layout the UI could not produce.

## Recommendation, criterion by criterion

| # | Criterion | Recommendation |
|---|---|---|
| 1 | Usage established, keep/drop decision recorded | Established as far as code allows: two of four routes unreachable, the other two broken on update/delete and first save. **Drop widgets, themes and saved layouts.** |
| 2 | If kept, layouts persist per user | Not kept. `User.Preferences.DashboardLayout` already persists the one value a user could meaningfully choose; a per-widget position store is a new feature with no legacy reference |
| 3 | Themes go through the token layer | Already true for the theme the product has; a custom colour theme per tenant is the thing the criterion exists to refuse |
| 4 | Single preferences store shared with profile | Already true (#136). Nothing to build |

If a client asks to rearrange the dashboard, file it as a new story against `DashboardGrid`
and `User.Preferences` — the two pieces that exist — rather than porting five routes that
never agreed with each other.

## Decision

```
api/dashboard/widgets and /themes:  ____  (drop | build from the route handlers, no UI reference)
Saved layouts (api/dashboard/layouts): ____  (drop | build a per-widget layout store as a new story)
Preferences: ____  (keep on User.Preferences, nothing to build | ...)
Decided by: ____
Date: ____
```
