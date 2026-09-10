import raw from '../../scripts/shot-fixtures/super-meridiano.json?raw'

/**
 * `fetch`, answered from `scripts/shot-fixtures/super-meridiano.json` — the real payloads
 * of the local API on 10 Sep 2026 (the super-admin endpoints, and Grupo Meridiano S.A.'s
 * own reads) — with the screenshot harness's matching rule (`matchFixture` in
 * `scripts/shot-harness.mjs`): a key's path must equal the request's path, its query
 * parameters must all be present on the request, and the key with the most parameters
 * wins. Anything unmatched answers 404, as the harness does.
 *
 * For render tests that must drive a super administrator's screen through its real
 * dispatcher page with the data the shots use, rather than a hand-typed payload.
 */
const FIXTURES = JSON.parse(raw) as Record<string, unknown>

export const MERIDIANO_ID = '16c97c29-07f8-4522-86fc-e6cc56298829'
/** Luis Mora, a leader of Grupo Meridiano S.A. in the same capture. */
export const LUIS_MORA_ID = '64fa2a68-3cef-4644-a7b0-ee3a7315c671'

interface Entry {
  method: string
  pathname: string
  query: URLSearchParams
  body: unknown
}

const ENTRIES: Entry[] = Object.entries(FIXTURES)
  .filter(([key]) => key.includes(' '))
  .map(([key, body]) => {
    const [method, path] = key.split(' ', 2)
    const [pathname, search = ''] = path.split('?', 2)
    return { method, pathname, query: new URLSearchParams(search), body }
  })

export function superMeridianoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), 'http://api.test')
  // The suite runs with `VITE_API_BASE_URL` unset, so the clients ask for
  // `undefined/admin/...`; the fixture's keys are the API's own paths.
  const pathname = url.pathname.replace(/^\/undefined(?=\/)/, '')
  const method = (init?.method ?? 'GET').toUpperCase()
  const candidates = ENTRIES.filter(
    (entry) =>
      entry.method === method &&
      entry.pathname === pathname &&
      [...entry.query.entries()].every(([name, value]) => url.searchParams.get(name) === value),
  )
  if (candidates.length === 0) return Promise.resolve(new Response(null, { status: 404 }))
  const best = candidates.reduce((a, b) => ([...b.query.keys()].length > [...a.query.keys()].length ? b : a))
  return Promise.resolve(new Response(JSON.stringify(best.body), { status: 200 }))
}
