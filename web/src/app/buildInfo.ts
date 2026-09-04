/**
 * Which commit this front end was built from, and when.
 *
 * Both values are baked in at build time by the `build-stamp` plugin in `vite.config.ts`
 * (Vercel's `VERCEL_GIT_COMMIT_SHA`, else `git rev-parse HEAD`, else `unknown`). The same
 * two values are written into the shipped `index.html` as `<meta name="build-commit">` and
 * `<meta name="build-time">`, so an operator can read them with `curl` and compare against
 * the API's `/version` without opening a browser — `web/docs/build-stamp.md`.
 *
 * `unknown` is a legitimate value, not an error: a build that cannot name its commit is
 * still a build.
 */
export interface BuildInfo {
  /** A 40-hex git SHA, or `unknown`. */
  readonly commit: string
  /** ISO-8601 UTC, or `unknown`. */
  readonly builtAt: string
}

function stamped(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value : 'unknown'
}

export const buildInfo: BuildInfo = Object.freeze({
  commit: stamped(import.meta.env.VITE_BUILD_COMMIT),
  builtAt: stamped(import.meta.env.VITE_BUILD_TIME),
})
