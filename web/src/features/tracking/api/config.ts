// The one place in web/src that actually reads VITE_TRACKING_API_BASE_URL. Every
// trackingApi.ts export defaults its `baseUrl` parameter to this, so the env var is wired
// up end-to-end (not just documented in web/.env.example) even though no page in this repo
// calls trackingApi.ts yet -- building tracking pages is out of scope for this plan (see
// "Global Constraints" in docs/superpowers/plans/2026-08-01-tracking-integration-api.md).
// Callers can still pass an explicit baseUrl (e.g. tests, or a future page that needs a
// different environment) to override this default.
export function getTrackingApiBaseUrl(): string {
  return import.meta.env.VITE_TRACKING_API_BASE_URL as string
}
