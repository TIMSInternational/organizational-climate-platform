using ClimateProject.Application.Exports;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// A company's identity as a workbook wears it: its name, its «Marca» colour and its logo's bytes.
///
/// <para>
/// <b>A logo lives in one of two places.</b> One uploaded through «Marca» is stored in
/// <c>company_logos</c> and its <c>branding_logo_url</c> is <see cref="CompanyLogoValidation.PathFor"/>'s
/// <c>/logos/{id}?v=…</c>; one set as a path -- ESPH's <c>/brand/esph-logo.png</c> -- is a file the WEB
/// app serves, which this API does not have. The second is fetched from the web origin
/// (<c>Email:AppBaseUrl</c>, the host the emails already resolve the same path against), and only
/// that host: <see cref="BrandingValidation"/> stores nothing but root-relative paths, and the
/// address is built here from the configured origin, never from the stored text.
/// </para>
///
/// <para>
/// <b>A logo never fails a download.</b> Missing, unreachable, too large or in a format Excel cannot
/// draw: the workbook is built without it and the cover prints the company's name.
/// </para>
/// </summary>
internal static class WorkbookBrandLoader
{
    /// <summary>One client for the process: a logo fetch is rare, small and must not hold a request up.</summary>
    private static readonly HttpClient Http = new(new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(5) })
    {
        Timeout = TimeSpan.FromSeconds(4),
    };

    public static async Task<WorkbookBrand> LoadAsync(
        ClimateProjectDbContext db,
        Guid companyId,
        IConfiguration configuration,
        CancellationToken cancellationToken,
        ILogger? logger = null,
        Func<Uri, CancellationToken, Task<byte[]?>>? fetch = null)
    {
        var company = await db.Companies
            .AsNoTracking()
            .Where(c => c.Id == companyId)
            .Select(c => new { c.Name, c.Branding.LogoUrl, c.Branding.PrimaryColor })
            .FirstOrDefaultAsync(cancellationToken);
        if (company is null)
        {
            return WorkbookBrand.Product();
        }

        byte[]? logo = null;
        try
        {
            logo = await LogoAsync(db, companyId, company.LogoUrl, configuration, fetch ?? FetchAsync, cancellationToken);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or IOException or FormatException)
        {
            logger?.LogWarning(exception, "Workbook logo for company {CompanyId} could not be read; the cover prints the name instead", companyId);
        }

        return new WorkbookBrand(company.Name, logo, company.PrimaryColor);
    }

    private static async Task<byte[]?> LogoAsync(
        ClimateProjectDbContext db,
        Guid companyId,
        string? logoUrl,
        IConfiguration configuration,
        Func<Uri, CancellationToken, Task<byte[]?>> fetch,
        CancellationToken cancellationToken)
    {
        var path = logoUrl?.Trim();
        if (string.IsNullOrEmpty(path))
        {
            return null;
        }

        if (path.StartsWith("/logos/", StringComparison.Ordinal))
        {
            return await db.CompanyLogos
                .AsNoTracking()
                .Where(l => l.CompanyId == companyId)
                .Select(l => l.Content)
                .FirstOrDefaultAsync(cancellationToken);
        }

        const string pngData = "data:image/png;base64,";
        const string jpegData = "data:image/jpeg;base64,";
        if (path.StartsWith(pngData, StringComparison.OrdinalIgnoreCase) || path.StartsWith(jpegData, StringComparison.OrdinalIgnoreCase))
        {
            var bytes = Convert.FromBase64String(path[(path.IndexOf(',', StringComparison.Ordinal) + 1)..]);
            return bytes.Length <= CompanyLogoValidation.MaxBytes ? bytes : null;
        }

        // A root-relative path on the web origin, and nothing else: not "//host", not a scheme.
        if (!path.StartsWith('/') || path.StartsWith("//", StringComparison.Ordinal)
            || !Uri.TryCreate(configuration["Email:AppBaseUrl"], UriKind.Absolute, out var origin)
            || (origin.Scheme != Uri.UriSchemeHttps && origin.Scheme != Uri.UriSchemeHttp))
        {
            return null;
        }

        var address = new Uri(new Uri(origin.GetLeftPart(UriPartial.Authority)), path);
        if (!string.Equals(address.Host, origin.Host, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        return await fetch(address, cancellationToken);
    }

    private static async Task<byte[]?> FetchAsync(Uri address, CancellationToken cancellationToken)
    {
        using var response = await Http.GetAsync(address, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode || response.Content.Headers.ContentLength > CompanyLogoValidation.MaxBytes)
        {
            return null;
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        int read;
        while ((read = await stream.ReadAsync(chunk, cancellationToken)) > 0)
        {
            buffer.Write(chunk, 0, read);
            if (buffer.Length > CompanyLogoValidation.MaxBytes)
            {
                return null;
            }
        }

        return buffer.ToArray();
    }
}
