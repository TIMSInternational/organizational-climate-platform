/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    // See the comment in src/test/setup.ts: Node's built-in Web Storage shadows the
    // happy-dom one. Repairing it here, in config, means a bare `vitest run`, an IDE
    // runner and CI all behave identically — previously only the `test` npm script
    // worked, because the workaround lived in a NODE_OPTIONS flag on that one script.
    setupFiles: ['./src/test/setup.ts'],
  },
})
