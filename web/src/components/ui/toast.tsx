import { Toaster as SonnerToaster } from 'sonner'
import type { ComponentProps, CSSProperties } from 'react'
import { resolveToasterTheme } from './toasterTheme'

/**
 * Ported from `climate-project/src/components/ui/sonner.tsx`.
 *
 * The legacy version took its theme from `next-themes`, which does not exist
 * here — see `toasterTheme.ts`.
 *
 * Colours come from the token layer via CSS variables rather than sonner's own
 * palette, so a toast matches `Alert`.
 */
export type ToasterProps = ComponentProps<typeof SonnerToaster>

export function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      theme={resolveToasterTheme()}
      style={
        {
          '--normal-bg': 'var(--admin-bg-panel)',
          '--normal-text': 'var(--admin-font-primary)',
          '--normal-border': 'var(--admin-border-panel)',
          '--success-bg': 'var(--admin-accent-bg-green)',
          '--success-text': 'var(--admin-font-primary)',
          '--success-border': 'var(--admin-accent-border-green)',
          '--error-bg': 'var(--admin-accent-bg-red)',
          '--error-text': 'var(--admin-font-primary)',
          '--error-border': 'var(--admin-accent-border-red)',
        } as CSSProperties
      }
      {...props}
    />
  )
}
