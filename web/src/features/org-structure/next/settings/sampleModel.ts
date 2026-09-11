/**
 * SAMPLE DATA. Not a measurement, and not a stored value.
 *
 * The CompanySettings artboard's Marca card prints a sender name ("Nombre del remitente").
 * No endpoint stores one: `CompanyBrandingDto`
 * (`src/ClimateProject.Application/OrgStructure/CompanySettingsDtos.cs`) carries `LogoUrl`,
 * `PrimaryColor`, `SecondaryColor`, `FontFamily` and `CustomCss` and nothing else, and
 * `PUT /admin/companies/{id}/settings` accepts the same five. A `senderName` field on that DTO
 * is the endpoint that will provide it. Until then the screen draws the field read-only with
 * the "Datos de muestra" chip, filled with the tenant's own name (which the mail sender uses
 * today only because nothing else is configured).
 */
export const SAMPLE_SENDER_NAME_FROM_COMPANY = true
