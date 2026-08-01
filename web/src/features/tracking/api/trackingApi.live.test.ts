// Opt-in, real-network verification of trackingApi.ts against an actual running
// climate-tracking instance. Skipped by default (and by `npm test -- --run`, and by CI) --
// the 9 tests in trackingApi.test.ts only ever exercise a vi.stubGlobal'd fetch, which
// proves this client builds the right requests but never proves climate-tracking actually
// accepts them (in particular: whether CORS is configured yet, see the header comment on
// trackingApi.ts).
//
// To run this file for real:
//   TRACKING_API_LIVE_URL=http://localhost:5081 TRACKING_API_LIVE_TOKEN=<a-valid-jwt> \
//     npm test -- --run trackingApi.live.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { setToken } from '../../../auth/token'
import { getConsolidado } from './trackingApi'

// Cast via globalThis rather than referencing `process` directly -- this project's
// tsconfig doesn't include @types/node, and process is still a real Node global at test
// runtime (vitest runs on Node regardless of the "happy-dom" test environment setting).
const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
const liveUrl = nodeEnv.TRACKING_API_LIVE_URL
const liveToken = nodeEnv.TRACKING_API_LIVE_TOKEN

describe.skipIf(!liveUrl)('trackingApi client (live, opt-in)', () => {
  beforeAll(() => {
    if (liveToken) {
      setToken(liveToken)
    }
  })

  it('gets consolidado from a real climate-tracking instance without throwing', async () => {
    const response = await getConsolidado(liveUrl as string)
    expect(response.conteos).toBeDefined()
  })
})
