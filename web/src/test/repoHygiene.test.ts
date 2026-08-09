import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * The pipeline-report placement guard (#171).
 *
 * ## What went wrong
 *
 * Eight dot-prefixed directories accumulated in the repo root — `.slice2-reports/`,
 * `.microclimates-reports/`, `.tracking-integration-reports-v2/` and five more — one
 * per domain pipeline run, 34 tracked markdown files between them. Nothing ignored
 * them and nothing had decided where they belonged, so each run simply added another.
 * #171 moved them to `docs/pipeline-reports/`, one directory per plan; the reasoning is
 * in `docs/decisions/pipeline-report-directories.md`.
 *
 * ## Why a test and not just the `.gitignore` line
 *
 * A `.gitignore` pattern is unverifiable by inspection. The two root-anchored
 * `-reports` patterns at the bottom of `.gitignore` have to do opposite things at
 * once — swallow a *root* report directory while leaving `docs/pipeline-reports/`
 * completely alone — and a rule that over-matched would hide the archive we just
 * committed rather than protect it. Both halves are asserted below, because a pattern
 * that ignores everything and a pattern that ignores nothing are equally green if you
 * only check one direction.
 *
 * The third block keeps the index in `docs/pipeline-reports/README.md` honest in both
 * directions: a run added without a row, and a row left pointing at a directory that
 * was renamed away, are the two ways this archive rots.
 *
 * ## Why it lives in the web suite
 *
 * It is not web-specific, but `npm test` in `web/` is the only always-on harness in
 * CI that runs arbitrary Node, and `src/app/router.test.ts` and
 * `src/i18n/noHardcodedStrings.test.ts` already established repo-sweeping guards here.
 * A guard nobody runs is not a guard.
 */

const WEB = process.cwd()
const REPO_ROOT = resolve(WEB, '..')
const PIPELINE_REPORTS = join(REPO_ROOT, 'docs', 'pipeline-reports')

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' })
}

/**
 * `git check-ignore -q` exits 0 when the path is ignored and 1 when it is not, so the
 * answer is only in the exit status — anything else means git itself failed and must
 * not be read as "not ignored".
 */
function isIgnored(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', path], { cwd: REPO_ROOT, stdio: 'pipe' })
    return true
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 1) return false
    throw error
  }
}

/** Top-level directories whose name is `.<something>-reports<maybe-suffix>`. */
const ROOT_REPORT_DIR = /^\.[^/]*-reports[^/]*\//

describe('repo hygiene: per-domain pipeline reports', () => {
  it('has no report directory tracked at the repo root', () => {
    const tracked = git('ls-files', '-z').split('\0').filter(Boolean)

    // Sanity: an empty listing would make the assertion below pass vacuously.
    expect(tracked.length).toBeGreaterThan(100)

    expect(tracked.filter((path) => ROOT_REPORT_DIR.test(path))).toEqual([])
  })

  it('ignores a fresh report directory written to the repo root', () => {
    // None of these exist; check-ignore evaluates the rules against the path either
    // way, which is the point — the guard has to hold for the *next* run's name too.
    expect(isIgnored('.slice4-reports/task-1-report.md')).toBe(true)
    expect(isIgnored('.notifications-reports/final-fix-report.md')).toBe(true)
    // The `-v2` shape that `.tracking-integration-reports-v2/` had: the suffix means
    // the name does not end in `-reports`, so it needs the second pattern.
    expect(isIgnored('.tracking-integration-reports-v2/fix-report.md')).toBe(true)
    expect(isIgnored('.some-domain-reports-v3/fix-report.md')).toBe(true)
  })

  it('leaves the committed archive and ordinary sources alone', () => {
    expect(isIgnored('docs/pipeline-reports/README.md')).toBe(false)
    expect(isIgnored('docs/pipeline-reports/2026-08-01-reports-analytics/task-1-report.md')).toBe(
      false,
    )
    // The patterns are root-anchored; a nested path that happens to match the shape
    // must survive.
    expect(isIgnored('docs/superpowers/plans/2026-08-01-reports-analytics.md')).toBe(false)
    expect(isIgnored('web/src/features/analytics/api/insights.ts')).toBe(false)
  })

  it('indexes every archived run in the README, and every indexed run exists', () => {
    const readme = readFileSync(join(PIPELINE_REPORTS, 'README.md'), 'utf8')

    const onDisk = readdirSync(PIPELINE_REPORTS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    expect(onDisk.length).toBeGreaterThan(0)

    // Rows link the directory as `[`name/`](name/)`; take the link targets so a
    // directory merely *mentioned* in prose does not count as indexed.
    const indexed = [...readme.matchAll(/\]\((\d{4}-\d{2}-\d{2}-[a-z0-9-]+)\/\)/g)]
      .map((match) => match[1])
      .sort()

    expect(indexed).toEqual(onDisk)

    for (const name of onDisk) {
      const files = readdirSync(join(PIPELINE_REPORTS, name))
      expect(files.length, `${name} is empty`).toBeGreaterThan(0)
    }
  })

  it('has a working link for every plan the README cites', () => {
    const readme = readFileSync(join(PIPELINE_REPORTS, 'README.md'), 'utf8')

    const links = [...readme.matchAll(/\]\((\.\.\/[^)]+\.md)\)/g)].map((match) => match[1])

    expect(links.length).toBeGreaterThan(0)

    const broken = links.filter((link) => !existsSync(resolve(PIPELINE_REPORTS, link)))
    expect(broken).toEqual([])
  })
})
