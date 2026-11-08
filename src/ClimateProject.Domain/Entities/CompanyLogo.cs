namespace ClimateProject.Domain.Entities;

/// <summary>
/// A company's uploaded logo, one per company. Kept out of <see cref="Company"/> so that the bytes
/// are never loaded with every company read. Served unauthenticated at
/// <c>GET /public/company-logos/{companyId}</c> and reached by the web through a same-origin path
/// (<c>/logos/{companyId}?v=…</c>) that the branding's <c>LogoUrl</c> points at.
/// </summary>
public class CompanyLogo
{
    public Guid CompanyId { get; set; }

    public byte[] Content { get; set; } = [];

    /// <summary><c>image/png</c>, <c>image/jpeg</c> or <c>image/webp</c> — read off the bytes, never the request.</summary>
    public string ContentType { get; set; } = string.Empty;

    /// <summary>Hex SHA-256 of <see cref="Content"/>: the cache-busting version and the ETag.</summary>
    public string Sha256 { get; set; } = string.Empty;

    public DateTimeOffset UpdatedAt { get; set; }
}
