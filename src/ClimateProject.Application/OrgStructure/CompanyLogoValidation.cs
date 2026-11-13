namespace ClimateProject.Application.OrgStructure;

/// <summary>
/// What an uploaded logo may be. Raster only: an SVG can carry script, and served from this
/// platform's own origin that would run as the platform; most mail clients refuse SVG anyway, and
/// the logo also goes into the access emails. The type is read off the bytes, never trusted from
/// the request (docs/audits/2026-11-08-operator-ui-walkthrough.md, B4).
/// </summary>
public static class CompanyLogoValidation
{
    /// <summary>512 KB: a logo drawn 32 px high needs a small fraction of this.</summary>
    public const int MaxBytes = 512 * 1024;

    /// <summary>The image type of <paramref name="content"/>, or null when it is not PNG, JPEG or WebP.</summary>
    public static string? ContentTypeOf(ReadOnlySpan<byte> content)
    {
        if (content.Length >= 8 && content[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }))
        {
            return "image/png";
        }

        if (content.Length >= 3 && content[0] == 0xFF && content[1] == 0xD8 && content[2] == 0xFF)
        {
            return "image/jpeg";
        }

        if (content.Length >= 12
            && content[..4].SequenceEqual("RIFF"u8)
            && content.Slice(8, 4).SequenceEqual("WEBP"u8))
        {
            return "image/webp";
        }

        return null;
    }

    /// <summary>The root-relative path the branding stores: same-origin for the web, and versioned.</summary>
    public static string PathFor(Guid companyId, string sha256)
        => $"/logos/{companyId}?v={sha256[..12]}";
}
