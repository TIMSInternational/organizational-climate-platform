/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
