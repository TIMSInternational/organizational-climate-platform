import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRight, ClipboardList, FileText, MessageCircleQuestion, Network, Search, Target, Users } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui'
import type { NavSection } from '../../navigation/navSections'
import { search, hrefForResult, type SearchEntityType, type SearchResultItem } from '../../features/search/api/search'

/**
 * The Cmd+K palette, ported from the ForMaps shell
 * (`components/command-palette/CommandPalette.tsx`) together with the top-bar
 * button that opens it (`components/layout/PageTopBar.tsx` there — the one this
 * repo's `PageTopBar` is deliberately *not* a port of; see that file's header).
 *
 * Structure is theirs: a 520px-max sheet at 20% from the top, a search row with
 * the glyph, the input and an ESC chip over a hairline, then a scrolling list of
 * grouped items, each an icon tile beside a label and description with a trailing
 * arrow that appears on the selected row.
 *
 * ## Two things are not theirs, both on purpose
 *
 * **The item list is derived, not declared.** ForMaps hardcodes eleven `PAGES` and
 * three `ACTIONS`. Here the items come from `buildNavSections(role, companyId)` —
 * the same call the rail and the mobile bar make — so the palette cannot offer a
 * page the caller's role would be 403'd from, and a nav entry added later appears
 * in it without anyone remembering to. Group headings are the nav section titles
 * for the same reason.
 *
 * **`cmdk` is not a dependency here and this does not add one.** Radix Dialog is
 * already in the tree, so the sheet, the focus trap, the overlay and Escape all
 * come from `ui/dialog.tsx`; what remains is a filtered list and up/down/Enter,
 * which is the ~40 lines below. Adding a package for that would be a new pin to
 * carry, and this repo pins exactly (`recharts 3.10.1`) precisely because it does
 * not want more of them.
 */

/** Dispatched on `window` to open the palette — the top-bar button's only job. */
export const OPEN_COMMAND_PALETTE_EVENT = 'open-command-palette'

interface PaletteItem {
  labelKey: string
  label: string
  description?: string
  href: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  group: string
}

/**
 * The glyph for each searchable kind (#135).
 *
 * A result row is drawn exactly like a nav row -- same icon box, same two lines -- because
 * to the person typing they are the same thing: somewhere to go. Only the group heading
 * distinguishes them.
 */
const RESULT_ICONS: Record<SearchEntityType, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  survey: ClipboardList,
  question: MessageCircleQuestion,
  department: Network,
  user: Users,
  action_plan: Target,
  report: FileText,
}

/** Below this, a query is too broad to be worth a round-trip on every keystroke. */
const MIN_QUERY_LENGTH = 2

/** Per type. The palette is a jump-to affordance, not a results page. */
const RESULT_LIMIT = 5

export interface CommandPaletteProps {
  sections: NavSection[]
}

export function CommandPalette({ sections }: CommandPaletteProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [results, setResults] = useState<SearchResultItem[]>([])
  const listId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // `metaKey || ctrlKey` so the shortcut is the same on macOS and elsewhere,
      // which is what the chip's label has to say too — see `SearchTrigger`.
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    function onOpenEvent() {
      setOpen(true)
    }
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenEvent)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenEvent)
    }
  }, [])

  // Every destination the current role actually has, flattened. A grouped parent
  // row is a disclosure in the rail rather than a page, so its children stand in
  // for it — the same rule `leafNavItems` applies for the mobile tab bar, except
  // that a group whose parent href differs from every child's (there are none
  // today) would lose the parent, so the parent is kept when it is a real link.
  const items = useMemo<PaletteItem[]>(() => {
    const collected: PaletteItem[] = []
    for (const section of sections) {
      const group = section.titleKey ? t(section.titleKey) : ''
      for (const item of section.items) {
        const children = item.sub ?? []
        const entries = children.length > 0 ? children : [item]
        for (const entry of entries) {
          // `t()` returns the key itself on a miss, which is how the catalogue
          // says "there is no description for this row" without a second table.
          const descriptionKey = `${entry.labelKey}Desc`
          const description = t(descriptionKey)
          collected.push({
            labelKey: entry.labelKey,
            label: t(entry.labelKey),
            description: description === descriptionKey ? undefined : description,
            href: entry.href,
            icon: entry.icon,
            group,
          })
        }
      }
    }
    return collected
  }, [sections, t])

  const navMatches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return items
    return items.filter((item) =>
      `${item.label} ${item.description ?? ''}`.toLowerCase().includes(needle),
    )
  }, [items, query])

  /**
   * Search the data, not just the menu (#135).
   *
   * Debounced and abortable: a palette fires a request per keystroke otherwise, and
   * out-of-order responses would let an earlier, broader query overwrite a later, narrower
   * one -- the classic type-ahead flicker. The abort makes the last request the only one
   * that can write state.
   *
   * Failures are swallowed to an empty list on purpose. The nav half of this palette still
   * works without the API, and an error banner inside a jump-to sheet would be louder than
   * the feature is important. `close()` clears the query, so the next open starts clean.
   */
  useEffect(() => {
    const needle = query.trim()
    if (!open || needle.length < MIN_QUERY_LENGTH) {
      setResults([])
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void search(baseUrl, needle, { limit: RESULT_LIMIT, signal: controller.signal })
        .then((response) => setResults(response.groups.flatMap((group) => group.items)))
        .catch(() => setResults([]))
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, query, baseUrl])

  const resultItems = useMemo<PaletteItem[]>(() => {
    const group = t('shell.commandPaletteResults')
    return results.flatMap((item) => {
      const href = hrefForResult(item)
      // A row with nowhere to go is dropped rather than rendered dead -- see hrefForResult.
      if (!href) return []
      return [{
        labelKey: `search:${item.type}:${item.id}`,
        label: item.title,
        description: item.subtitle ?? undefined,
        href,
        icon: RESULT_ICONS[item.type],
        group,
      }]
    })
  }, [results, t])

  // Destinations first, data second: the menu is instant and local, the results arrive a
  // beat later, and a list that reorders under the cursor mid-type is the thing to avoid.
  const matches = useMemo(() => [...navMatches, ...resultItems], [navMatches, resultItems])

  // A stale index survives a narrowing query and points past the end, which would
  // make Enter do nothing on a list that visibly has rows.
  useEffect(() => {
    setSelected(0)
  }, [query])

  function close() {
    setOpen(false)
    setQuery('')
    setSelected(0)
    setResults([])
  }

  function go(href: string) {
    close()
    navigate(href)
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (matches.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected((index) => (index + 1) % matches.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected((index) => (index - 1 + matches.length) % matches.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      go(matches[selected].href)
    }
  }

  // Keep the highlighted row in view when it is driven by the keyboard rather
  // than the pointer — without this, holding ArrowDown walks the selection off
  // the bottom of a 300px list and the reader loses it.
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('[data-selected="true"]')
    row?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  let previousGroup: string | null = null

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogContent
        showCloseButton={false}
        // ForMaps' sheet: 90vw capped at 520, seated 20% down rather than centred,
        // so the list grows downward into empty space instead of shifting the
        // input as it filters. `p-0` because the search row owns its own padding
        // and the list owns its own; `gap-0` for the same reason.
        //
        // The four measurements are an inline `style` rather than
        // `w-[90vw] max-w-[520px] top-[20%]`: `tokenDiscipline` rejects an
        // arbitrary Tailwind value anywhere under `layout/`, and every other
        // ForMaps geometry ported into this directory (`SidebarUserMenu`'s 28px
        // rows, `RoleBasedNav`'s 16x28 elbow) is written the same way.
        className="translate-y-0 gap-0 overflow-hidden p-0"
        style={{ top: '20%', width: '90vw', maxWidth: 520 }}
        aria-label={t('shell.commandPalette')}
      >
        {/* Radix requires both, and a palette has no visible heading — the input's
            own placeholder is the affordance. */}
        <DialogTitle className="sr-only">{t('shell.commandPalette')}</DialogTitle>
        <DialogDescription className="sr-only">{t('shell.commandPaletteHint')}</DialogDescription>

        <div className="flex items-center gap-inline border-b border-line-default px-4">
          <Search aria-hidden="true" className="size-icon shrink-0 text-fg-tertiary" />
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label={t('shell.commandPalette')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={t('dashboard.searchPlaceholder')}
            className="h-11 w-full border-none bg-transparent p-0 text-fg-primary outline-none"
          />
          <kbd className="hidden shrink-0 items-center rounded-md border border-line-default bg-state-hover px-1.5 text-2xs font-medium text-fg-tertiary sm:inline-flex">
            {t('shell.escapeKey')}
          </kbd>
        </div>

        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={t('shell.commandPalette')}
          className="overflow-y-auto p-2"
          style={{ maxHeight: 300 }}
        >
          {matches.length === 0 ? (
            <p role="status" className="py-6 text-center text-fg-tertiary">
              {t('shell.commandPaletteEmpty')}
            </p>
          ) : (
            matches.map((item, index) => {
              const heading = item.group && item.group !== previousGroup ? item.group : null
              previousGroup = item.group
              const isSelected = index === selected
              return (
                <div key={`${item.labelKey}-${item.href}`}>
                  {heading && <div className="nav-section-title">{heading}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-selected={isSelected}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => go(item.href)}
                    className="flex w-full items-center gap-3 rounded-lg border-none bg-transparent px-3 py-2.5 text-left data-[selected=true]:bg-state-hover"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line-default bg-surface-icon-box">
                      <item.icon aria-hidden="true" className="size-icon text-fg-tertiary" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-fg-primary">{item.label}</span>
                      {item.description && (
                        <span className="block truncate text-xs text-fg-tertiary">
                          {item.description}
                        </span>
                      )}
                    </span>
                    <ArrowRight
                      aria-hidden="true"
                      className="size-icon shrink-0 text-fg-tertiary opacity-0 data-[selected=true]:opacity-100"
                      data-selected={isSelected}
                    />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The top-bar button that opens the palette — ForMaps' `PageTopBar` search
 * control, verbatim in shape: the glyph, then a `Cmd+K` chip that is hidden below
 * `sm` because there is no keyboard there to press it with.
 *
 * A `window` event rather than a shared context, exactly as ForMaps does it: the
 * button sits in the header and the palette at the end of the shell, and an event
 * keeps the two from having to be wrapped in a provider that exists only for
 * them.
 */
export function SearchTrigger() {
  const { t } = useTranslation()
  const label = t('shell.search')

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT))}
      className="flex items-center gap-inline rounded-md border-none bg-transparent px-2 py-1 text-fg-tertiary hover:bg-state-hover hover:text-fg-primary"
    >
      <Search aria-hidden="true" className="size-icon" />
      <kbd className="hidden items-center rounded-md border border-line-default bg-state-hover px-1.5 py-0.5 text-2xs font-medium text-fg-light sm:inline-flex">
        {t('shell.commandKey')}
      </kbd>
    </button>
  )
}
