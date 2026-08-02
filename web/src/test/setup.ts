import { Storage } from 'happy-dom'

/**
 * Repair the Web Storage globals for the test environment.
 *
 * Node 25 enables the Web Storage API by default — it is no longer gated behind
 * `--experimental-webstorage`. That puts Node's own `localStorage` / `sessionStorage`
 * getters on `globalThis` before the happy-dom environment initialises, and happy-dom
 * does not overwrite globals that already exist. Node's implementation is inert unless
 * the process was started with a valid `--localstorage-file`, so the surviving global
 * is an object with no working `setItem` / `getItem` / `clear`.
 *
 * Anything importing `src/auth/token.ts` then dies with
 * `TypeError: localStorage.setItem is not a function`, which took out 56 of 83 tests.
 *
 * `NODE_OPTIONS=--no-experimental-webstorage` also avoids this, but only for whichever
 * entrypoint sets it. Passing the flag through `poolOptions.forks.execArgv` does not
 * work — vitest does not propagate it to the test workers. Installing a real happy-dom
 * `Storage` here fixes every entrypoint and does not depend on an experimental flag
 * that will disappear once Web Storage stabilises.
 *
 * setupFiles run per test file, so each file gets its own isolated Storage.
 */
function installStorage(name: 'localStorage' | 'sessionStorage'): void {
  const existing = (globalThis as Record<string, unknown>)[name] as Storage | undefined

  // Leave a working implementation alone — a real browser, jsdom, or a Node build
  // where Web Storage is properly configured.
  if (existing && typeof existing.setItem === 'function') return

  Object.defineProperty(globalThis, name, {
    value: new Storage(),
    configurable: true,
    writable: true,
    enumerable: false,
  })
}

installStorage('localStorage')
installStorage('sessionStorage')
