// The one place in web/src that actually reads VITE_TRACKING_API_BASE_URL. Every
// trackingApi.ts export defaults its `baseUrl` parameter to this.
//
// The note that stood here said no page calls trackingApi.ts because tracking pages were
// out of scope for that plan. #126 brought them in: `features/tracking/pages/` holds the
// plans listing, the plan detail and mis-tareas, and all three reach the service through
// this default. Callers can still pass an explicit baseUrl (tests, or a page pointed at a
// different environment) to override it.
//
// Note that the PICKERS are not here: `api/trackingPickers.ts` talks to climate-project at
// VITE_API_BASE_URL, because the names behind an external nodo/persona id live in that
// service's database and not in climate-tracking's.
export function getTrackingApiBaseUrl(): string {
  return import.meta.env.VITE_TRACKING_API_BASE_URL as string
}
