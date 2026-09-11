import { useCallback, useState } from 'react'

/** What the last copy did, keyed by what was copied. */
export interface CopyOutcome {
  key: string
  ok: boolean
}

/**
 * Copies a respond link to the clipboard, and remembers whether it worked.
 *
 * The failure is kept, not swallowed: the clipboard API is refused outside a secure
 * context and no-ops in several embedded browsers, and a copy button that did nothing
 * while saying nothing is worse than no button. A caller shows the link itself when
 * `ok` is false, so there is always something a person can select by hand — the same
 * rule `reports/next/ReportShareDialog.tsx` follows.
 */
export function useCopyLink(): { outcome: CopyOutcome | null; copy: (key: string, text: string) => Promise<void> } {
  const [outcome, setOutcome] = useState<CopyOutcome | null>(null)
  const copy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setOutcome({ key, ok: true })
    } catch {
      setOutcome({ key, ok: false })
    }
  }, [])
  return { outcome, copy }
}
