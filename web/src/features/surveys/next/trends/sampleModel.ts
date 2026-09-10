/**
 * SAMPLE DATA. This is not a measurement of anything.
 *
 * Everything else on `/surveys/climate-trends/next` is read from
 * `GET /surveys/climate-trends`. This one figure is not, because no endpoint provides
 * it today: `grep -rni 'climateTarget\|targetScore' web/src` finds nothing outside the
 * dashboard's own sample, and the company settings payload
 * (`GET /admin/companies/{id}/settings`, `CompanyEndpoints.cs`) carries no target field.
 * That payload is the natural home for it; until it holds one, the page marks every
 * region the target feeds with the "sample data" chip, and `isSample` on the model
 * stays `true`.
 *
 * The value is the approved mockup's Grupo Meridiano target, so the screen can be
 * compared against the design.
 */
export const SAMPLE_TARGET = 3.7
