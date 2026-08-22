import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import {
  EXPORT_TREATMENT,
  SUBJECT_LINK,
  exportTreatmentLabelPath,
  getMyDataExport,
  readConsentRecord,
  subjectLinkLabelPath,
  type SubjectAccessExport,
} from './gdpr'

const baseUrl = 'http://api.test'

/**
 * Shaped exactly as `GET /gdpr/access` answers: camelCase everywhere except the record
 * dictionaries, whose keys are EF property names, with owned types flattened as
 * `Navigation.Property`. Asserted against a real response by
 * `tests/ClimateProject.IntegrationTests/Gdpr/SubjectAccessWireShapeTests.cs`.
 */
const EXPORT: SubjectAccessExport = {
  subject: {
    userId: '11111111-1111-1111-1111-111111111111',
    email: 'person@acme.com',
    name: 'A Person',
  },
  generatedAt: '2026-08-20T09:00:00Z',
  complete: false,
  sources: [
    { name: 'organizational-climate-platform', included: true, detail: 'Read in full.' },
    { name: 'climate-tracking', included: false, detail: 'NOT INCLUDED.' },
  ],
  limitations: ['Free-text answers are opaque strings.'],
  sections: [
    {
      entity: 'User',
      table: 'users',
      link: SUBJECT_LINK.subject,
      treatment: EXPORT_TREATMENT.fullRecord,
      lawfulBasis: 'Art. 6(1)(b)',
      retention: 'For as long as the account exists',
      recordCount: 1,
      records: [
        {
          _link: 'Id',
          Email: 'person@acme.com',
          PasswordHash: '[redacted: credential]',
          ConsentUpdatedAt: '2026-07-01T08:00:00Z',
          'Consent.Essential': true,
          'Consent.Analytics': false,
          'Consent.Marketing': false,
          'Notifications.EmailSurveys': true,
        },
      ],
    },
  ],
}

function respond(body: unknown, status = 200) {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(body), { status }))
}

describe('gdpr api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  /**
   * The security property of this client, the same one `profile.test.ts` asserts. The
   * endpoint accepts `?userId=`, and with it an administrator can export a colleague — so
   * the absence of that parameter is what keeps a *self-service* page self-service. A
   * request that grew a user id would be a page that can disclose somebody else's data.
   */
  it('asks about the caller and puts no user id anywhere', async () => {
    respond(EXPORT)
    await getMyDataExport(baseUrl)

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('http://api.test/gdpr/access')
    expect(String(url)).not.toContain('userId')
    expect(String(url)).not.toContain('?')
    expect(init?.body).toBeUndefined()
  })

  it('returns the export as the API shaped it', async () => {
    respond(EXPORT)
    const result = await getMyDataExport(baseUrl)
    expect(result.complete).toBe(false)
    expect(result.sections[0].table).toBe('users')
  })

  it('throws the API message rather than swallowing a failure', async () => {
    respond({ message: 'User not found' }, 404)
    await expect(getMyDataExport(baseUrl)).rejects.toThrow('User not found')
  })

  describe('readConsentRecord', () => {
    /**
     * The consent columns are only legible through the export, because no endpoint reads
     * `UserConsent`. Reading them by prefix rather than from a fixed list of six is what
     * makes a seventh column appear on the page instead of being silently withheld.
     */
    it('reads every Consent.* column out of the account record, and nothing else', () => {
      const consent = readConsentRecord(EXPORT)!
      expect(consent.flags).toEqual([
        { name: 'Essential', granted: true },
        { name: 'Analytics', granted: false },
        { name: 'Marketing', granted: false },
      ])
      expect(consent.updatedAt).toBe('2026-07-01T08:00:00Z')
    })

    it('surfaces a consent column this build has never heard of', () => {
      const withExtra: SubjectAccessExport = {
        ...EXPORT,
        sections: [
          {
            ...EXPORT.sections[0],
            records: [{ ...EXPORT.sections[0].records[0], 'Consent.Biometrics': true }],
          },
        ],
      }
      expect(readConsentRecord(withExtra)!.flags).toContainEqual({
        name: 'Biometrics',
        granted: true,
      })
    })

    it('reports no stamp rather than a bogus one when the column is null', () => {
      const unstamped: SubjectAccessExport = {
        ...EXPORT,
        sections: [
          {
            ...EXPORT.sections[0],
            records: [{ ...EXPORT.sections[0].records[0], ConsentUpdatedAt: null }],
          },
        ],
      }
      expect(readConsentRecord(unstamped)!.updatedAt).toBeNull()
    })

    it('returns null when the export carries no account record to read', () => {
      expect(readConsentRecord({ ...EXPORT, sections: [] })).toBeNull()
      expect(
        readConsentRecord({
          ...EXPORT,
          sections: [{ ...EXPORT.sections[0], recordCount: 0, records: [] }],
        }),
      ).toBeNull()
    })
  })

  /**
   * `link` and `treatment` are the underlying integers of two C# enums, because the API
   * registers no string-enum converter. These are the exact values
   * `SubjectAccessWireShapeTests` pins on the server.
   */
  describe('enum label paths', () => {
    it('maps every value the API can send today', () => {
      expect(subjectLinkLabelPath(0)).toBe('privacy.linkNone')
      expect(subjectLinkLabelPath(1)).toBe('privacy.linkSubject')
      expect(subjectLinkLabelPath(2)).toBe('privacy.linkActor')
      expect(subjectLinkLabelPath(3)).toBe('privacy.linkThroughParent')

      expect(exportTreatmentLabelPath(0)).toBe('privacy.treatmentNone')
      expect(exportTreatmentLabelPath(1)).toBe('privacy.treatmentFull')
      expect(exportTreatmentLabelPath(2)).toBe('privacy.treatmentReference')
    })

    /**
     * Null, not a guess. The caller renders the raw wire value for a null, so a category
     * added to the server shows up untranslated rather than being mislabelled as one of
     * the ones this build knows — on a page about what is held, a wrong label is worse
     * than an ugly one.
     */
    it('refuses to name a value it does not know', () => {
      expect(subjectLinkLabelPath(4)).toBeNull()
      expect(exportTreatmentLabelPath(9)).toBeNull()
    })
  })
})
