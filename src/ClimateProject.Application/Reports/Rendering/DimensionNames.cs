using ClimateProject.Application.Localization;

namespace ClimateProject.Application.Reports.Rendering;

/// <summary>
/// The display name of a climate dimension, in a content locale.
///
/// ## Why this exists at all
///
/// A question's <c>Category</c> -- which this product calls a dimension -- is authored free
/// text and is stored exactly as typed, so the server has never had a name to print and the
/// renderers printed the key. On a screen that is invisible, because the client resolves the
/// key through <c>surveyRespond.dimensions.*</c> before drawing it. A PDF has no client, so
/// the report a customer opens printed <c>belonging</c>, <c>recognition</c> and
/// <c>workload</c> where every screen in the product says Pertenencia, Reconocimiento and
/// Carga de trabajo.
///
/// ## The rule, which is the client's rule
///
/// Resolve a key the catalogue names; print anything else exactly as authored. That is the
/// house contract, stated in <c>useAdminDashboardModel.ts</c> as "Categories are authored
/// free text; one the catalogue does not name is shown as is", and it is why this is a
/// lookup with a fallback rather than a translation. A category a customer invented is
/// their word and must survive the round trip unaltered.
///
/// ## This table is a copy, and copies drift
///
/// The source of truth is <c>web/src/i18n/{en,es}.json</c> at <c>surveyRespond.dimensions</c>.
/// This repository has already been bitten once by a C# constant that claimed to match a TS
/// one and did not -- <c>EmailBranding.ProductName</c> -- because the two live in different
/// languages and different test suites and nothing compared them. So the two are pinned to
/// each other by <c>web/src/i18n/dimensionNames.test.ts</c>, which reads THIS file and fails
/// if a key or a name differs in either direction. Add a dimension to the catalogues and
/// that test tells you to add it here.
/// </summary>
internal static class DimensionNames
{
    private static readonly IReadOnlyDictionary<string, string> English = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["psychological_safety"] = "Psychological safety",
        ["workload"] = "Workload",
        ["trust"] = "Trust",
        ["recognition"] = "Recognition",
        ["growth"] = "Growth",
        ["belonging"] = "Belonging",
        ["enps"] = "Recommending this place to work",
        ["priorities"] = "What would help most",
        ["open"] = "In your words",
    };

    private static readonly IReadOnlyDictionary<string, string> Spanish = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["psychological_safety"] = "Seguridad psicológica",
        ["workload"] = "Carga de trabajo",
        ["trust"] = "Confianza",
        ["recognition"] = "Reconocimiento",
        ["growth"] = "Desarrollo",
        ["belonging"] = "Pertenencia",
        ["enps"] = "Recomendar este lugar de trabajo",
        ["priorities"] = "Lo que más ayudaría",
        ["open"] = "En sus palabras",
    };

    /// <summary>
    /// The catalogue for one locale, for the guard test and for <see cref="Resolve"/>.
    /// </summary>
    internal static IReadOnlyDictionary<string, string> For(string? locale)
        => ContentLanguages.NormaliseLocale(locale) == "es" ? Spanish : English;

    /// <summary>
    /// The display name for <paramref name="key"/>, or <paramref name="key"/> itself when the
    /// catalogue has no word for it. Null and blank pass straight through: an unnamed
    /// category is the aggregation's own "no category", not a key to look up.
    /// </summary>
    internal static string? Resolve(string? key, string? locale)
        => string.IsNullOrWhiteSpace(key)
            ? key
            : For(locale).TryGetValue(key, out var name) ? name : key;
}
