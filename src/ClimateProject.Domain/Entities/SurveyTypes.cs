namespace ClimateProject.Domain.Entities;

/// <summary>
/// The vocabulary of <c>Survey.Type</c>: a survey's cadence and purpose.
/// </summary>
/// <remarks>
/// <para>
/// This axis is NOT <see cref="ClimateServiceTypes"/>. A service is the product line the
/// customer bought (<c>general_climate</c>, <c>organizational_culture</c>, <c>microclimate</c>)
/// and lives in <c>Survey.ServiceType</c>; a type is how often and why a survey is asked. The
/// two do not intersect, which is the whole finding of #496 — metering ran against
/// <c>Survey.Type</c> until then, matched nothing, and spent no seat for anybody.
/// </para>
/// <para>
/// Until this class existed <c>Survey.Type</c> was required and never checked: the create and
/// update endpoints asked only that it be non-blank, so any string at all was storable. That is
/// not a hypothetical. Three surveys in production carry <c>general_climate</c> — a SERVICE
/// name — in their type column, which is exactly the confusion #496 was about, and it surfaced
/// on screen as a raw <c>general_climate</c> option in the Tipo filter on Todas las Encuestas.
/// <c>SurveyEndpoints</c> already named the gap in a comment ("Survey.Type's own lack of
/// validation is exactly how the licence layer came to compare two vocabularies that never
/// intersect") without closing it.
/// </para>
/// <para>
/// The list mirrors <c>SURVEY_TYPES</c> in <c>web/src/features/surveys/surveyVocabulary.ts</c>,
/// which is the order the authoring wizard offers them in and the set the client ships a label
/// for. A value outside it reaches a reader as a bare machine key, because printing an unknown
/// enum as stored is this product's deliberate fallback everywhere.
/// </para>
/// </remarks>
public static class SurveyTypes
{
    public const string Periodic = "periodic";
    public const string Pulse = "pulse";
    public const string Engagement = "engagement";
    public const string Satisfaction = "satisfaction";
    public const string Onboarding = "onboarding";
    public const string Exit = "exit";
    public const string Custom = "custom";

    /// <summary>Every type an author may choose, in the order the wizard offers them.</summary>
    public static readonly IReadOnlyList<string> All =
        [Periodic, Pulse, Engagement, Satisfaction, Onboarding, Exit, Custom];

    /// <summary>
    /// Whether <paramref name="type"/> is one this product can author.
    /// </summary>
    /// <remarks>
    /// Ordinal and case-sensitive, like every other stored vocabulary here: these are column
    /// values, not display text, and <c>Periodic</c> is not <c>periodic</c>.
    /// </remarks>
    public static bool IsKnown(string? type) =>
        type is not null && All.Contains(type, StringComparer.Ordinal);
}
