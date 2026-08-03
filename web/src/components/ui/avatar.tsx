import * as AvatarPrimitive from '@radix-ui/react-avatar'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/avatar.tsx`.
 *
 * Sized to `--admin-size-icon-box` (28px), the legacy Sidebar avatar tile, rather
 * than shadcn's 40px default — 40px would tower over a 28px nav row.
 */
export function Avatar({ className, ...props }: ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        'relative flex size-icon-box shrink-0 overflow-hidden rounded-full',
        className,
      )}
      {...props}
    />
  )
}

export function AvatarImage({
  className,
  ...props
}: ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('aspect-square size-full object-cover', className)}
      {...props}
    />
  )
}

export function AvatarFallback({
  className,
  ...props
}: ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'flex size-full items-center justify-center rounded-full',
        'bg-surface-icon-box text-2xs font-medium text-fg-secondary',
        className,
      )}
      {...props}
    />
  )
}
