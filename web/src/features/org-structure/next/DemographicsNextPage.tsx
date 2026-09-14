import { readViewerClaims } from '../../../auth/viewerCapabilities'
import AdminDemographicFieldsView from './admin/AdminDemographicFieldsView'
import SuperDemographicFieldsView from './super/SuperDemographicFieldsView'

/**
 * `/admin/companies/:companyId/demographic-fields` — the per-role canvas's *Campos
 * demográficos* (10 Sep), which replaced `DemographicFieldsPage` at this route. The super
 * administrator keeps `SuperDemographicFieldsView` (`SuperDemographicFields` artboard);
 * every other role gets `AdminDemographicFieldsView` (`DemographicFields` artboard), which
 * says so to a role that manages no fields rather than asking for a list it would be refused.
 */
export default function DemographicsNextPage() {
  return readViewerClaims().role === 'super_admin' ? <SuperDemographicFieldsView /> : <AdminDemographicFieldsView />
}
