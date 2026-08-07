import { BellIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu'
import { Badge } from './badge'
import { Button } from './button'
import { ScrollArea } from './scroll-area'

/**
 * Ported from `climate-project/src/components/ui/notification-dropdown.tsx`.
 *
 * The legacy version was 447 framer-motion-heavy lines that also **fetched its own
 * data** and knew the shape of a legacy notification row. #77 says to keep the data
 * contract generic because #99 consumes this, so the fetch is gone: it takes a list
 * and callbacks, and the caller owns loading and paging.
 *
 * Built on the #76 `DropdownMenu`, so focus handling and Escape come from there
 * rather than being re-implemented.
 */
export interface NotificationItem {
  id: string
  title: string
  /** Optional supporting line. */
  description?: string
  /** Pre-formatted by the caller, which owns locale-aware date formatting. */
  timestamp?: string
  read?: boolean
}

export interface NotificationDropdownProps {
  notifications: NotificationItem[]
  /** Accessible name for the trigger, e.g. `t('notifications.title')`. */
  triggerLabel: string
  /** Heading inside the menu. */
  heading: string
  /** Shown when there is nothing to list. */
  emptyText: string
  onSelect?: (notification: NotificationItem) => void
  /** Rendered at the foot of the menu — a "mark all read" or "see all" action. */
  footer?: ReactNode
}

export function NotificationDropdown({
  notifications,
  triggerLabel,
  heading,
  emptyText,
  onSelect,
  footer,
}: NotificationDropdownProps) {
  const unread = notifications.filter((notification) => !notification.read).length

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={triggerLabel} className="relative">
          <BellIcon aria-hidden="true" />
          {unread > 0 && (
            <Badge
              variant="destructive"
              // The count is decorative here: the accessible name on the trigger
              // already carries it via aria-label from the caller if they choose.
              aria-hidden="true"
              className="absolute -top-1 -right-1 min-w-4 px-1 py-0 text-2xs"
            >
              {/* Capped, and capped at the same 99 the sidebar's `.nav-badge` uses
                  (`withUnreadBadge` in navigation/navSections.ts). Rendered in
                  Chrome at 150 unread: the rail said "99+" and this said "150",
                  two numbers for one fact a screen apart — and an uncapped
                  three-digit count on a 32px icon button overhangs the bell on
                  both sides. The precise figure is on the trigger's accessible
                  name, which the caller builds from the real count. */}
              {unread > 99 ? '99+' : unread}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>{heading}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <p className="px-2 py-3 text-center text-sm text-fg-tertiary">{emptyText}</p>
        ) : (
          <ScrollArea className="max-h-72">
            {notifications.map((notification) => (
              <DropdownMenuItem
                key={notification.id}
                onSelect={() => onSelect?.(notification)}
                className="flex-col items-start gap-0.5"
              >
                <span
                  className={cn(
                    'text-base',
                    notification.read ? 'text-fg-secondary' : 'font-medium text-fg-primary',
                  )}
                >
                  {notification.title}
                </span>
                {notification.description && (
                  <span className="text-sm text-fg-tertiary">{notification.description}</span>
                )}
                {notification.timestamp && (
                  <span className="text-2xs text-fg-light">{notification.timestamp}</span>
                )}
              </DropdownMenuItem>
            ))}
          </ScrollArea>
        )}
        {footer && (
          <>
            <DropdownMenuSeparator />
            {footer}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
