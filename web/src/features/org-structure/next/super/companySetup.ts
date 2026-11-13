import type { SuperCompanyDetailModel } from './useSuperCompanyDetailModel'

/**
 * What a new client still needs before its first survey goes out, read from what the company
 * page already loads. A TIMS operator who created a company used to land back on the list with no
 * word; the decisions that cannot be undone later -- above all the access mode, which a survey
 * freezes at creation -- were nowhere on the way (docs/audits/2026-11-08-operator-ui-walkthrough.md, C).
 */
export type SetupStepId = 'access' | 'brand' | 'departments' | 'fields' | 'people' | 'survey'

export interface SetupStep {
  id: SetupStepId
  done: boolean
  /** Where the step is done; `null` for a section of the company page itself. */
  href: string | null
}

export function companySetupSteps(model: SuperCompanyDetailModel): SetupStep[] {
  const id = model.company.id
  const surveys = model.surveys?.length ?? 0
  return [
    // Decided once a survey exists: from then on the existing surveys keep the mode they froze.
    { id: 'access', done: surveys > 0, href: null },
    { id: 'brand', done: Boolean(model.settings?.branding?.logoUrl), href: null },
    { id: 'departments', done: (model.departments?.length ?? 0) > 0, href: '/departments' },
    { id: 'fields', done: (model.demographicFields?.length ?? 0) > 0, href: `/admin/companies/${id}/demographic-fields` },
    { id: 'people', done: (model.users?.length ?? 0) > 0, href: `/admin/companies/${id}/users` },
    { id: 'survey', done: surveys > 0, href: '/surveys/import' },
  ]
}

/** A client nobody has set up yet: no people or no survey. An established client is not nagged. */
export function needsSetup(model: SuperCompanyDetailModel): boolean {
  return (model.users?.length ?? 0) === 0 || (model.surveys?.length ?? 0) === 0
}
