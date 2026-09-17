import { describe, it, expect } from 'vitest'
import { buildCreateInput, emptyWizardValues } from './wizardValues'
import { LICENSED_SERVICES, SURVEY_TYPES, licensedServiceLabel } from './surveyVocabulary'
import { CATALOGUES } from '../../i18n/locale'
import { createTranslator } from '../../i18n/translate'

/**
 * The licensed service a survey meters against (#496).
 *
 * The defect these guard against was not a bug in a branch: it was two vocabularies that
 * looked like one. Licensing metered `Survey.Type` against `general_climate` while every
 * survey the wizard can produce is `periodic`/`pulse`/…, so the sets never intersected and
 * no seat was ever spent — with a green suite throughout, because the only place the
 * metered values existed was a fixture that wrote them directly.
 *
 * So the first test here is a set-disjointness assertion rather than a behaviour one. It
 * exists to fail loudly if anybody ever merges the two lists back together.
 */
describe('licensed service', () => {
  it('shares no value with the survey-type vocabulary', () => {
    const types = new Set<string>(SURVEY_TYPES)
    const overlap = LICENSED_SERVICES.filter((service) => types.has(service))

    expect(
      overlap,
      'a licensed service and a survey type are different axes; a shared value means metering can read one for the other',
    ).toEqual([])
  })

  // `emptyWizardValues` leaves the dates blank, and `buildCreateInput` calls `toISOString`
  // on them, so a payload test has to fill them in to reach the field it is about.
  const datedValues = () => ({
    ...emptyWizardValues('es'),
    startDate: '2026-10-01T09:00',
    endDate: '2026-10-31T17:00',
  })

  it('is omitted from the create payload when nothing is chosen', () => {
    const values = datedValues()

    expect(values.serviceType, 'defaulting to a service would meter seats nobody opted into').toBe('')
    expect(buildCreateInput(values, 'c1')).not.toHaveProperty('serviceType')
  })

  it.each(LICENSED_SERVICES)('is sent as %s when chosen', (service) => {
    const values = { ...datedValues(), serviceType: service }

    expect(buildCreateInput(values, 'c1').serviceType).toBe(service)
  })

  /**
   * Read from the catalogue rather than asserting the Spanish here: a literal would be a
   * second copy of the catalogue agreeing with itself. What matters is that every service
   * resolves to something other than its own code — the `label()` fallback returns the code
   * when a key is missing, so an unkeyed service is invisible without this.
   */
  it.each(LICENSED_SERVICES)('has a real label in both catalogues for %s', (service) => {
    for (const locale of ['en', 'es'] as const) {
      const t = createTranslator(CATALOGUES[locale])
      expect(licensedServiceLabel(t, service)).not.toBe(service)
    }
  })
})
