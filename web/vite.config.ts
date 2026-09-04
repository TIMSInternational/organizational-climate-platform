/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Stamp the build with the commit it was built from (operational-readiness item 30).
 *
 * The API answers `/version` with its commit; the web never could, which is why the
 * API/web drift of 2026-09-01 was invisible from the outside. Resolution order: Vercel's
 * `VERCEL_GIT_COMMIT_SHA` (set on every Vercel build), then `git rev-parse HEAD` for a
 * local or CI build, then the literal `unknown` — never a crash, because a build that
 * cannot name its commit is still a build. Two consumers: `<meta name="build-commit">`
 * in the shipped `index.html` (`curl | grep`, no JavaScript needed) and
 * `src/app/buildInfo.ts` for anything in-app. `web/docs/build-stamp.md` has the operator
 * side.
 */
function resolveBuildCommit(): string {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA?.trim()
  if (fromVercel) return fromVercel
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

const BUILD_COMMIT = resolveBuildCommit()
const BUILD_TIME = new Date().toISOString()

function buildStamp(): Plugin {
  return {
    name: 'build-stamp',
    transformIndexHtml(html) {
      return html.replace(
        '</head>',
        `    <meta name="build-commit" content="${BUILD_COMMIT}" />\n    <meta name="build-time" content="${BUILD_TIME}" />\n  </head>`,
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), buildStamp()],
  define: {
    'import.meta.env.VITE_BUILD_COMMIT': JSON.stringify(BUILD_COMMIT),
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(BUILD_TIME),
  },
  // Pinned, and strict rather than a preference. The API allows exactly ONE CORS
  // origin in Development (`Cors:AllowedOrigins` is `["http://localhost:5173"]`), so a
  // dev server that silently moves to 5174 because something holds 5173 does not
  // degrade — every request dies on preflight with "No 'Access-Control-Allow-Origin'",
  // which reads as a CORS misconfiguration rather than as port drift. `strictPort`
  // turns that into a loud failure at startup, where the cause is still visible.
  server: { port: 5173, strictPort: true },
  test: {
    // src/styles/tokens.test.ts imports the stylesheets with `?raw` to assert
    // the ported values; Vitest stubs CSS out of the module graph unless this
    // is on, which would silently hand those assertions an empty string.
    css: true,
    environment: 'happy-dom',
    // See the comment in src/test/setup.ts: Node's built-in Web Storage shadows the
    // happy-dom one. Repairing it here, in config, means a bare `vitest run`, an IDE
    // runner and CI all behave identically — previously only the `test` npm script
    // worked, because the workaround lived in a NODE_OPTIONS flag on that one script.
    setupFiles: ['./src/test/setup.ts'],
  },
})
