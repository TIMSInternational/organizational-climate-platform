import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setToken } from '../../../auth/token'
import {
  NOTIFICATION_CHANNELS,
  createNotificationTemplate,
  getNotificationTemplate,
  listNotificationTemplates,
  previewNotificationTemplate,
  updateNotificationTemplate,
  type NotificationTemplateDetail,
  type NotificationTemplateListItem,
  type NotificationTemplatePreview,
} from './notificationTemplates'

const baseUrl = 'http://api.test'

const listItem: NotificationTemplateListItem = {
  id: 't1',
  name: 'Survey invitation',
  type: 'survey_invitation',
  channel: 'email',
  companyId: 'c1',
  isActive: true,
  isDefault: false,
}

const detail: NotificationTemplateDetail = {
  id: 't1',
  name: 'Survey invitation',
  type: 'survey_invitation',
  channel: 'email',
  subject: 'Your survey is ready',
  title: 'Survey ready',
  content: 'Hello {{name}}',
  htmlContent: null,
  companyId: 'c1',
  isActive: true,
  isDefault: false,
  createdBy: 'u1',
  createdAt: '2026-08-01T09:00:00Z',
  updatedAt: '2026-08-01T09:00:00Z',
  variables: [
    {
      id: 'v1',
      name: 'name',
      type: 'string',
      required: true,
      description: 'Recipient first name',
      defaultValue: null,
    },
  ],
  rules: [{ id: 'r1', condition: 'role == admin', modifications: null }],
  contentLanguage: 'en',
  resolvedLocale: 'en',
  fallbackFields: [],
}

const preview: NotificationTemplatePreview = {
  subject: 'Your survey is ready',
  title: 'Survey ready',
  content: 'Hello Ada',
  htmlContent: null,
  matchedRuleIds: ['r1'],
  missingRequiredVariables: [],
  resolvedLocale: 'es',
  fallbackFields: ['subject'],
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe('notification templates api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists templates, unwrapping the response envelope', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ templates: [listItem] }))
    const result = await listNotificationTemplates(baseUrl)
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/notification-templates`, expect.anything())
    expect(result).toEqual([listItem])
  })

  it('returns an empty list rather than throwing when the envelope is missing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({}))
    await expect(listNotificationTemplates(baseUrl)).resolves.toEqual([])
  })

  it('passes the SuperAdmin companyId filter, url-encoded', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ templates: [] }))
    await listNotificationTemplates(baseUrl, { companyId: 'c 1' })
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/notification-templates?companyId=c+1`,
      expect.anything(),
    )
  })

  it('omits the companyId parameter entirely when it is not supplied', async () => {
    // A blank `?companyId=` is not the same request: it would be a filter for a
    // template belonging to no company rather than no filter at all.
    vi.mocked(fetch).mockResolvedValueOnce(ok({ templates: [] }))
    await listNotificationTemplates(baseUrl)
    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).not.toContain('companyId')
  })

  it('gets one template and passes the requested locale', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok(detail))
    const result = await getNotificationTemplate(baseUrl, 't1', { lang: 'es' })
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/notification-templates/t1?lang=es`,
      expect.anything(),
    )
    expect(result).toEqual(detail)
  })

  it('omits lang when the caller wants the template’s own language', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok(detail))
    await getNotificationTemplate(baseUrl, 't1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/notification-templates/t1`, expect.anything())
  })

  it('creates a template, sending a locale map for each authored field', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 201 }))
    await createNotificationTemplate(baseUrl, {
      name: 'Survey invitation',
      type: 'survey_invitation',
      channel: 'email',
      subject: { en: 'Your survey is ready', es: 'Tu encuesta esta lista' },
      companyId: 'c1',
    })
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe(`${baseUrl}/notification-templates`)
    expect(init!.method).toBe('POST')
    expect(JSON.parse(String(init!.body))).toEqual({
      name: 'Survey invitation',
      type: 'survey_invitation',
      channel: 'email',
      subject: { en: 'Your survey is ready', es: 'Tu encuesta esta lista' },
      companyId: 'c1',
    })
  })

  it('accepts a bare string for a localised field, attributed to the template’s own language', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 201 }))
    await createNotificationTemplate(baseUrl, {
      name: 'Survey invitation',
      type: 'survey_invitation',
      channel: 'in_app',
      title: 'Survey ready',
    })
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(JSON.parse(String(init!.body)).title).toBe('Survey ready')
  })

  it('drops omitted locales instead of sending an explicit null', async () => {
    // On update, null is the request that BLANKS a translation while omission means
    // "leave as stored". A client that named every field would wipe the English copy
    // of a template whose editor only touched the Spanish one.
    vi.mocked(fetch).mockResolvedValueOnce(ok(detail))
    await updateNotificationTemplate(baseUrl, 't1', { subject: { es: 'Tu encuesta esta lista' } })
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe(`${baseUrl}/notification-templates/t1`)
    expect(init!.method).toBe('PUT')
    const sent = JSON.parse(String(init!.body))
    expect(sent).toEqual({ subject: { es: 'Tu encuesta esta lista' } })
    expect('title' in sent).toBe(false)
    expect('content' in sent).toBe(false)
  })

  it('sends an empty child list verbatim, because [] clears rows and omission does not', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok(detail))
    await updateNotificationTemplate(baseUrl, 't1', { variables: [] })
    const [, init] = vi.mocked(fetch).mock.calls[0]
    const sent = JSON.parse(String(init!.body))
    expect(sent.variables).toEqual([])
    expect('rules' in sent).toBe(false)
  })

  it('previews a template with variables and a locale in the body, not the query string', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok(preview))
    const result = await previewNotificationTemplate(baseUrl, 't1', {
      variables: { name: 'Ada' },
      lang: 'es',
    })
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe(`${baseUrl}/notification-templates/t1/preview`)
    expect(String(url)).not.toContain('lang=')
    expect(init!.method).toBe('POST')
    expect(JSON.parse(String(init!.body))).toEqual({ variables: { name: 'Ada' }, lang: 'es' })
    expect(result).toEqual(preview)
  })

  it('reports which fields fell back to another language rather than hiding it', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok(preview))
    const result = await previewNotificationTemplate(baseUrl, 't1', { lang: 'es' })
    expect(result.resolvedLocale).toBe('es')
    expect(result.fallbackFields).toEqual(['subject'])
  })

  it('sends the bearer token on every call', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ templates: [] }))
    await listNotificationTemplates(baseUrl)
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer test-token')
  })

  it('surfaces the server message on a failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Template not found' }), { status: 404 }),
    )
    await expect(getNotificationTemplate(baseUrl, 'missing')).rejects.toThrow('Template not found')
  })

  it('offers every schema channel for authoring, including the one dispatch cannot deliver', () => {
    // Templates target all four; dispatch excludes `push`. Collapsing the two lists
    // would either forbid authoring a push template or let a dispatch claim a delivery
    // this repo has no infrastructure for.
    expect([...NOTIFICATION_CHANNELS]).toEqual(['email', 'in_app', 'push', 'sms'])
  })

  it('models resolved content, never En/Es-shaped fields', () => {
    // #195's binding constraint: no read DTO may expose per-language fields, so no
    // client type may declare one. Asserted against the source text because a type
    // that does not exist cannot be asserted about at runtime, and this is the exact
    // shape a future edit would reintroduce by copying the entity.
    const source = readFileSync(
      join(process.cwd(), 'src/features/notifications/api/notificationTemplates.ts'),
      'utf8',
    )
    // Matches a DECLARATION (`subjectEn: string`), not a mention: the module's own
    // doc comment names the shape it forbids, and a bare word match would fail on that.
    expect(source).not.toMatch(/(subject|title|content|htmlContent)E[ns]\s*\??\s*:/i)
    expect(source).toContain('resolvedLocale')
    expect(source).toContain('fallbackFields')
  })
})
