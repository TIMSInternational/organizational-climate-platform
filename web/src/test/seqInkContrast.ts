import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

/**
 * Runs `scripts/check-seq-contrast.mjs` and hands back what it measured.
 *
 * The tests deliberately measure through the **committed script** rather than
 * through a copy of the WCAG formula written in a test file. A guard that
 * reimplements the thing it is guarding can agree with itself while both are
 * wrong, and the script is what a human runs when changing a hex — so it is the
 * script whose numbers have to be trusted, and therefore the script that CI has
 * to exercise (#208).
 */

export const SEQ_INK_SCRIPT = join(process.cwd(), 'scripts', 'check-seq-contrast.mjs')

export interface SeqInkRow {
  theme: 'light' | 'dark'
  step: number
  fill: string
  ink: string
  ratio: number
  passes: boolean
}

export interface SeqInkReport {
  /** Process exit code. 0 only when every pairing clears the threshold. */
  status: number
  threshold: number
  rows: SeqInkRow[]
  /** Present instead of `rows` when the stylesheet could not be read at all. */
  error?: string
  stderr: string
}

/** @param cssPath stylesheet to measure; defaults to the real `src/styles/tokens.css`. */
export function measureSeqInkContrast(cssPath?: string): SeqInkReport {
  const args = ['--json', ...(cssPath ? ['--css', cssPath] : [])]
  const run = spawnSync(process.execPath, [SEQ_INK_SCRIPT, ...args], { encoding: 'utf8' })

  if (run.error) throw run.error
  let parsed: { threshold?: number; rows?: SeqInkRow[]; error?: string }
  try {
    parsed = JSON.parse(run.stdout) as typeof parsed
  } catch {
    throw new Error(`check-seq-contrast.mjs printed no JSON.\nstdout: ${run.stdout}\nstderr: ${run.stderr}`)
  }

  return {
    status: run.status ?? 1,
    threshold: parsed.threshold ?? Number.NaN,
    rows: parsed.rows ?? [],
    error: parsed.error,
    stderr: run.stderr,
  }
}
