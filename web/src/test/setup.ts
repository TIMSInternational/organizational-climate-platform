import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// This project does not enable Vitest's `globals: true` (see vite.config.ts), so
// @testing-library/react's automatic afterEach(cleanup) registration -- which relies on
// detecting a global test framework -- never fires. Register it explicitly instead,
// otherwise DOM from one test leaks into the next and queries like getByRole start
// matching multiple elements across tests.
afterEach(() => {
  cleanup()
})
