namespace ClimateProject.Application.Localization;

/// <summary>
/// Who built the platform, in the reader's language: "Desarrollado por Nexadev" in Spanish,
/// "Powered by Nexadev" otherwise.
/// </summary>
/// <remarks>
/// Ruled 2026-10-21 by Federico: on every screen (<c>web/src/components/layout/PoweredByNexadev.tsx</c>,
/// whose catalogue keys carry the same two sentences), under every email
/// (<c>EmailBranding.Document</c>) and at the foot of every PDF page (<c>PdfDocument.Credit</c>).
/// One place for the wording, so the three cannot drift apart.
/// </remarks>
public static class NexadevCredit
{
    public const string Spanish = "Desarrollado por Nexadev";
    public const string English = "Powered by Nexadev";

    /// <summary>The credit for a locale such as <c>es</c>, <c>es-CR</c> or <c>en</c>. Anything not Spanish reads English.</summary>
    public static string For(string? locale)
        => (locale ?? string.Empty).StartsWith("es", StringComparison.OrdinalIgnoreCase) ? Spanish : English;
}
