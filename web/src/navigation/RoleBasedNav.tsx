import { useEffect, useState } from 'react'
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

/**
 * Which of the three row treatments a row is wearing, as a data attribute.
 *
 * The fill and the text colour used to be inline styles, computed here from
 * `isActive`/`hasSub`. That is why no row in this rail had a hover affordance
 * (parked at PR #12's review, item 2 of #169): an inline `background:
 * transparent` beats any stylesheet rule short of `!important`, so `.nav-row:hover`
 * could not have worked while the resting state was written into the element. The
 * three states moved onto this attribute and their colours into `index.css`, where
 * `:hover` and `:focus-visible` are ordinary rules.
 *
 * - `selected` — the row that owns the current path: accent fill, on-accent text.
 * - `parent-selected` — an expanded group sitting on its own path: no fill, primary
 *   text, and bold (still inline, because weight is not a state the stylesheet
 *   needs to reason about).
 * - absent — everything else: secondary text on the rail's own surface.
 */
type NavRowState = 'selected' | 'parent-selected' | undefined

/** Where a collapsed-rail flyout is anchored, in viewport coordinates. */
interface FlyoutAnchor {
  /** `labelKey` of the group the flyout belongs to. Only one is ever open. */
  key: string
  top: number
  left: number
}

export interface RoleBasedNavProps {
  sections: NavSection[]
  /**
   * Icon-only rail.
   *
   * The sub-tree cannot be drawn in a 52px column — there is no room for the
   * elbow, let alone a label — so a grouped row stays a plain link to its own
   * `href` and its children move into a hover/focus flyout. Before that flyout
   * existed every child but the first was unreachable without expanding the rail
   * (3 destinations across the two roles: System settings for a super_admin, Users
   * and Demographic fields for a company_admin), because both groups' `href` is
   * the same page as their first child.
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
  const [flyout, setFlyout] = useState<FlyoutAnchor | null>(null)

  // Nothing may outlive the state that produced it: expanding the rail removes
  // the flyout's reason to exist (the children are drawn in place again), and a
  // navigation means the pointer is about to be somewhere else entirely. Both are
  // reachable without a `mouseleave` — the collapse control is outside this
  // component, and a flyout link's own click unmounts nothing by itself.
  useEffect(() => {
    setFlyout(null)
  }, [collapsed, pathname])

  /**
   * Expansion is keyed by `labelKey`, and #169 adds the pin for that rather than
   * the keying itself — `toggleExpand` already took a `labelKey` on `main`.
   *
   * The rail's first version keyed on `item.label`, a raw English literal on the
   * nav item (`label: 'Companies'`), so two groups whose copy coincided toggled in
   * lockstep; `2ad4c37` replaced every `label` with a catalogue key when the shell
   * was translated. `labelKey` is a catalogue path
   * (`navigation.systemAdministration`), which is unique per entry and identical in
   * every locale, so the collision cannot come back through a translation either.
   * `climate-project#22` suggested `href` instead; `labelKey` is preferred here
   * because a company_admin's group `href` interpolates their company id, so
   * keying on it would silently reset the group's open/closed state the moment
   * that id changed. What was missing was a test: `RoleBasedNav.test.tsx` now pins
   * the locale-independence directly, with two groups whose labels translate to
   * the same string in both catalogues.
   */
  function toggleExpand(labelKey: string) {
    setExpanded((current) =>
      current.includes(labelKey) ? current.filter((key) => key !== labelKey) : [...current, labelKey],
    )
  }

  function openFlyout(key: string, anchor: HTMLElement) {
    const rect = anchor.getBoundingClientRect()
    setFlyout({ key, top: rect.top, left: rect.right })
  }

  function renderItem(item: NavItemType) {
    const hasChildren = Boolean(item.sub?.length)
    // While collapsed a grouped row is a plain link with a flyout (see `collapsed`
    // above), so it gets a leaf's selected styling too.
    const hasSub = hasChildren && !collapsed
    const hasFlyout = hasChildren && collapsed
    const isActive = item.href === selectedHref
    const childSelected = item.sub?.some((sub) => sub.href === selectedHref) ?? false
    // A collapsed group stands in for its whole sub-tree — the children are not
    // rendered in the rail at all — so it carries the selection when one of them
    // owns the path. Without this the rail showed *no* selected row at all while
    // collapsed on System settings, Users or Demographic fields. It cannot double
    // up: the children this borrows from are not rows while collapsed.
    const isFilled = !hasSub && (isActive || childSelected)
    const navState: NavRowState = isFilled ? 'selected' : isActive && hasSub ? 'parent-selected' : undefined
    // How far down the run of children the elbow should read as "active". ForMaps
    // lights every rung above the selected one, so the bracket leads the eye to it.
    const selectedSubIndex = item.sub ? item.sub.findIndex((sub) => sub.href === selectedHref) : -1
    const isExpanded = expanded.includes(item.labelKey)
    const isFlyoutOpen = hasFlyout && flyout?.key === item.labelKey
    const label = t(item.labelKey)

    // Ported from the legacy navigation/RoleBasedNav.tsx row: `minHeight: 28,
    // padding: '4px 8px', fontSize: 13, gap-2, rounded-[4px]`, and the same
    // three-way selected state — a selected leaf is white on the blue accent, a
    // selected parent stays on the panel and goes bold, everything else is
    // secondary text. The two colour properties live in `index.css` now, keyed on
    // `data-nav-state`; see `NavRowState` for why.
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
    }

    const rowContent = (
      <>
        <item.icon className="nav-icon" />
        {!collapsed && (
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
          </span>
        )}
        {/* `data-active` so the badge can invert on a filled row. Without it the
            pill is `--admin-accent-blue` on `--admin-accent-bg-blue`, an 8%-alpha
            tint of that same colour — over the solid accent fill of a selected row
            that is teal text on teal, which is unreadable at exactly the moment
            the count matters most. */}
        {!collapsed && item.badge && (
          <span className="nav-badge" data-active={isFilled}>
            {item.badge}
          </span>
        )}
      </>
    )

    return (
      <div
        key={item.labelKey}
        // Hover and focus both open the flyout, and the wrapper owns both because
        // it is the one node that contains the row *and* the panel: React's
        // `onFocus`/`onBlur` are focusin/focusout, so tabbing from the row into a
        // flyout link never leaves this element, and `mouseleave` is DOM-tree
        // based rather than geometric, so the panel counts as inside even though
        // it is positioned outside the rail.
        onMouseEnter={hasFlyout ? (event) => openFlyout(item.labelKey, event.currentTarget) : undefined}
        onMouseLeave={hasFlyout ? () => setFlyout(null) : undefined}
        onFocus={hasFlyout ? (event) => openFlyout(item.labelKey, event.currentTarget) : undefined}
        onBlur={
          hasFlyout
            ? (event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setFlyout(null)
              }
            : undefined
        }
        onKeyDown={
          hasFlyout
            ? (event) => {
                // Escape dismisses without moving focus, which is what makes the
                // flyout escapable for a keyboard user who does not want it.
                if (event.key === 'Escape' && flyout !== null) {
                  event.stopPropagation()
                  setFlyout(null)
                }
              }
            : undefined
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--admin-size-row-gap)' }}>
          {hasSub ? (
            // A grouped row is a disclosure, not a destination. The legacy version
            // rendered it as an `<a>` with `preventDefault()` plus a bare `<svg>`
            // carrying the click — so it announced as a link that goes nowhere, and
            // the chevron was unreachable by keyboard entirely. A `<button>` with
            // `aria-expanded` is the same interaction, correctly named.
            <button
              type="button"
              className="nav-row"
              data-nav-state={navState}
              onClick={() => toggleExpand(item.labelKey)}
              aria-expanded={isExpanded}
              // See the `title` note on the leaf row below. A group row is the
              // tightest of the lot: the chevron and its gap take another 24px,
              // leaving the label 140px of the 220px rail — while carrying the
              // longest label in the nav, `navigation.systemAdministration`
              // ("Administración del Sistema", 26 characters).
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
              className="nav-row"
              data-nav-state={navState}
              onClick={onNavigate}
              // A collapsed row shows no text, so the accessible name has to come
              // from somewhere.
              aria-label={collapsed ? label : undefined}
              // A collapsed group row is still a link — clicking it goes to the
              // group's own page, as it always has — but it also owns a panel, and
              // a screen reader user has no other way to know the sub-tree is
              // there. `aria-expanded` alone carries that, and deliberately no
              // `aria-haspopup`: a bare `aria-haspopup` means `menu`, which
              // commits to a keyboard model (arrow-key roving focus, Home/End,
              // type-ahead) the panel does not implement — it is a `role="group"`
              // of ordinary links that Tab walks through. Announcing "has menu"
              // and then landing the user in something that is not one is worse
              // than announcing nothing. Set only while collapsed: with the rail
              // open the children are rows in the tree and the `<button>` branch
              // above carries `aria-expanded` instead, so nothing announces twice.
              aria-expanded={hasFlyout ? isFlyoutOpen : undefined}
              // `title` unconditionally, not only while collapsed. The label span
              // in `rowContent` above sets `overflow: hidden` + `textOverflow:
              // ellipsis` + `whiteSpace: nowrap`, so anything wider than its box
              // is cut with no way to read the rest, and the box is narrow while
              // the rail is expanded: the rail is 220px
              // (`--admin-size-sidebar`), of which 16px goes to the `<nav>`'s own
              // `4px 8px 8px 8px` gutter, 16px to this row's `var(--admin-space-4)
              // var(--admin-space-8)` padding, 16px to the icon
              // (`--admin-size-icon`) and 8px to the gap
              // (`--admin-size-inline-gap`) — 164px for the label, less again on a
              // row carrying a badge. Whether a given label survives that depends
              // on the locale and on the reader's font settings, neither of which
              // this component can see, so the tooltip is set for all of them
              // rather than guessed at. Widening the rail means changing
              // `--admin-size-sidebar`, which is shared token surface (#208 is
              // queued on tokens.css).
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
            {item.sub!.map((sub, index) => (
              <SubItemRow
                key={sub.labelKey}
                item={sub}
                label={t(sub.labelKey)}
                isActive={sub.href === selectedHref}
                onNavigate={onNavigate}
                elbow={
                  <SubItemBreadcrumb
                    isLast={index === item.sub!.length - 1}
                    isActive={sub.href === selectedHref || index <= selectedSubIndex}
                  />
                }
              />
            ))}
          </div>
        )}
        {isFlyoutOpen && (
          // `position: fixed`, not `absolute`. Both the `<aside>` and the `<nav>`
          // inside it scroll (`overflow-y: auto`), and a scroll container clips on
          // BOTH axes — an absolutely positioned panel would be cut off at the
          // rail's 52px edge, which is the whole width of what it has to escape.
          //
          // The outer box is the mouse bridge: it starts flush against the row's
          // right edge and carries the gap as padding, so the pointer never
          // crosses un-owned pixels on its way to the panel. With the gap as a
          // literal offset the flyout closed under the pointer mid-travel.
          <div
            style={{
              position: 'fixed',
              top: flyout.top,
              left: flyout.left,
              paddingLeft: 'var(--admin-space-4)',
              zIndex: 100,
            }}
          >
            <div
              role="group"
              aria-label={label}
              style={{
                minWidth: 'var(--admin-size-sidebar)',
                maxHeight: '80vh',
                overflowY: 'auto',
                padding: 'var(--admin-space-4)',
                // `--admin-bg-overlay`, NOT `--admin-bg-panel`. This panel is a
                // popover hanging out of the rail, so it renders inside
                // `.on-shell` and inherits the chrome's ink — and `.on-shell`
                // re-points `--admin-bg-overlay` at `--admin-shell-bg-raised`
                // precisely for a popover in that position (`SidebarUserMenu`
                // is the other one), while `--admin-bg-panel` stays the page's
                // white card. Painted from the panel token this printed
                // `--admin-shell-font` #c8d8ec on #ffffff — **1.45:1** for the
                // child links and 2.15:1 for the group heading, measured live in
                // Chromium at /dashboard, light, rail collapsed. That is the same
                // defect, one component away, as the 1.12:1 company switcher:
                // a ground `.on-shell` did not re-point, under ink it did. And it
                // is the collapsed rail's ONLY route to a group's children, which
                // is what #83's last scope line asks be operable. On the raised
                // navy the same two tones are 8.05:1 and 5.43:1 in light, 9.18:1
                // and 5.13:1 in dark — measured by `shellInkContrast.test.ts`,
                // which already holds every shell ink against that ground, and
                // reached from here by `inkContrast.test.ts`'s shell-ground guard.
                background: 'var(--admin-bg-overlay)',
                border: '1px solid var(--admin-border-light)',
                borderRadius: 'var(--admin-radius-xl)',
                boxShadow: 'var(--admin-shadow-lg)',
              }}
            >
              {/* The group's own name, in the same treatment the rail gives a
                  section heading. Without it the panel is a bare list of three
                  links with nothing saying which group they belong to — the label
                  the pointer left behind is an icon. */}
              <div className="nav-section-title">{label}</div>
              {item.sub!.map((sub) => (
                <SubItemRow
                  key={sub.labelKey}
                  item={sub}
                  label={t(sub.labelKey)}
                  isActive={sub.href === selectedHref}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
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

/**
 * One child row, drawn either in the rail under its expanded parent or in the
 * collapsed rail's flyout.
 *
 * One component for both so the two cannot drift: a child is the same 28px row
 * with the same accent fill wherever it is rendered, and the only difference is
 * the elbow, which the rail passes and the flyout does not (there is no run of
 * siblings to bracket in a panel that contains nothing else).
 */
function SubItemRow({
  item,
  label,
  isActive,
  onNavigate,
  elbow,
}: {
  item: NavItemType
  label: string
  isActive: boolean
  onNavigate?: () => void
  elbow?: React.ReactNode
}) {
  const SubIcon = item.icon
  return (
    <Link
      to={item.href}
      className="nav-sub-row"
      data-nav-state={isActive ? 'selected' : undefined}
      onClick={onNavigate}
      title={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--admin-size-inline-gap)',
        height: 'var(--admin-size-control-md)',
        padding: elbow ? '0 var(--admin-space-4) 0 0' : '0 var(--admin-space-8)',
        borderRadius: 'var(--admin-radius-md)',
        fontSize: 'var(--admin-text-base)',
        fontWeight: 'var(--admin-weight-medium)',
        textDecoration: 'none',
      }}
    >
      {elbow}
      {/* The glyph is centred in its own 16x16 box rather than sized to its own
          ink, so every child label starts on the same x as every other one. */}
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, flexShrink: 0 }}>
        {SubIcon ? (
          <SubIcon
            aria-hidden="true"
            style={{ width: 14, height: 14, color: isActive ? 'var(--admin-font-on-accent)' : 'var(--admin-font-tertiary)' }}
          />
        ) : null}
      </span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </Link>
  )
}
